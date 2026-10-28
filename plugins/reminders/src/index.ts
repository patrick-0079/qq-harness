import { reminderTime } from './time.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { chatKeySchema } from '@qq-harness/contracts';
import {
  configService,
  accessService,
  outboundService,
  toolService,
  reminderService,
  storageService,
  systemControlService,
  type Reminder,
} from '@qq-harness/domain';

const schema = z.object({
  id: z.string(),
  chatKey: chatKeySchema,
  text: z.string().min(1).max(10000),
  dueAt: z.number(),
});
export function reminders(_dataDir: string) {
  return definePlugin({
    id: 'reminders',
    name: '定时提醒运行模式',
    requires: [configService.id, accessService.id, outboundService.id, toolService.id, storageService.id],
    setup(ctx) {
      const config = ctx.use(configService),
        access = ctx.use(accessService),
        outbound = ctx.use(outboundService),
        tools = ctx.use(toolService),
        storage = ctx.use(storageService);
      let items = z.array(schema).parse(storage.state('reminders', 'items') ?? []);
      const firing = new Map<string, string>();
      const enabled = (chatKey: string) => config.effective(chatKey).plugins[ctx.id] !== false;
      const save = () => storage.setState('reminders', 'items', items);
      const skipExpired = (cutoff: number) => {
        const expired = items.filter((item) => item.dueAt <= cutoff);
        if (!expired.length) return;
        for (const item of expired) {
          storage.setState('reminders-skipped', item.id, { ...item, skippedAt: Date.now() });
          ctx
            .use(systemControlService)
            .log({
              source: 'scheduler',
              actor: 'system',
              action: 'reminder',
              status: 'skipped',
              message: `过期提醒已跳过：${item.id}`,
            });
        }
        items = items.filter((item) => item.dueAt > cutoff);
        save();
      };
      ctx.effect(
        ctx.host.subscribe((event) => {
          if (event.type === 'system.presence') skipExpired(Date.now());
        }),
      );
      const add = (value: Omit<Reminder, 'id'>) => {
        ctx.assertActive();
        access.assert(value.chatKey);
        const reminder = schema.parse({ ...value, id: randomUUID() });
        if (reminder.dueAt <= Date.now()) throw new Error('提醒时间必须在未来');
        items.push(reminder);
        save();
        return structuredClone(reminder);
      };
      ctx.provide(reminderService, {
        list: () => structuredClone(items),
        add,
        remove: (id) => {
          ctx.assertActive();
          items = items.filter((value) => value.id !== id);
          save();
          const runId = firing.get(id);
          if (runId) ctx.host.cancel(runId);
        },
      });
      ctx.mode({
        id: 'reminder.deliver',
        partitionKey: (input) => input.chatKey,
        input: schema,
        execute: async (run, input) => {
          // 排队期间可能被删除；以持久化列表为准，禁止使用已过期或伪造的输入快照。
          const reminder = items.find((item) => item.id === input.id && item.chatKey === input.chatKey);
          if (!reminder || !enabled(reminder.chatKey)) return { delivered: false };
          access.assert(reminder.chatKey);
          await outbound.send(run, reminder.chatKey, reminder.text);
          items = items.filter((value) => value.id !== reminder.id);
          save();
          return { delivered: true };
        },
      });
      const timer = setInterval(() => {
        for (const item of items) {
          if (item.dueAt <= Date.now() && config.get().paused) {
            skipExpired(Date.now());
            continue;
          }
          if (
            item.dueAt > Date.now() ||
            firing.has(item.id) ||
            !access.allowed(item.chatKey) ||
            !enabled(item.chatKey)
          )
            continue;
          try {
            const run = ctx.host.submit({
              mode: 'reminder.deliver',
              partitionKey: item.chatKey,
              input: item,
            });
            firing.set(item.id, run.id);
            void ctx.host
              .wait(run.id)
              .finally(() => firing.delete(item.id))
              .catch((error) => ctx.log(String(error)));
          } catch (error) {
            // 满队列是暂态错误；不能让定时器抛到进程层，也不能永久留下 firing 标记。
            ctx.log(`提醒调度等待重试：${error instanceof Error ? error.message : error}`);
          }
        }
      }, 500);
      ctx.effect(() => clearInterval(timer));
      const setInput = z
        .object({
          text: z.string().trim().min(1).max(10000),
          delayMinutes: z.number().positive().max(525600).optional(),
          atTime: z.string().max(30).optional(),
        })
        .strict();
      tools.register(ctx, {
        name: 'set_reminder',
        displayName: '设置提醒',
        category: 'system',
        description:
          '在当前会话设置提醒。delayMinutes 与 atTime 二选一；atTime 支持 HH:MM（今天或明天）或 YYYY-MM-DD HH:MM，使用北京时间。',
        parameters: z.toJSONSchema(setInput),
        parse: (a) => {
          const v = setInput.parse(a);
          reminderTime(v);
          return v;
        },
        execute: async (c, a) => {
          const v = a as z.infer<typeof setInput>;
          return add({ chatKey: c.chatKey, text: v.text, dueAt: reminderTime(v) });
        },
      });
      tools.register(ctx, {
        name: 'list_reminders',
        displayName: '查看提醒',
        category: 'system',
        description: '列出当前会话的待发送提醒。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        parse: (a) => z.object({}).strict().parse(a),
        execute: async (c) => ({
          reminders: items
            .filter((i) => i.chatKey === c.chatKey)
            .map((i) => ({
              ...i,
              time: new Date(i.dueAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
            })),
        }),
      });
      tools.register(ctx, {
        name: 'cancel_reminder',
        displayName: '取消提醒',
        category: 'system',
        description: '取消当前会话的一条提醒，不允许取消其他会话提醒。',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        parse: (a) =>
          z
            .object({ id: z.string().min(1) })
            .strict()
            .parse(a),
        execute: async (c, a) => {
          const id = (a as { id: string }).id;
          if (!items.some((i) => i.id === id && i.chatKey === c.chatKey))
            throw new Error('当前会话没有该提醒');
          ctx.use(reminderService).remove(id);
          return { cancelled: true, id };
        },
      });
      tools.register(ctx, {
        name: 'reminder_add',
        description: '在当前会话设置未来提醒。',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' }, dueAt: { type: 'number', description: 'Unix 毫秒时间戳' } },
          required: ['text', 'dueAt'],
          additionalProperties: false,
        },
        parse: (args) => z.object({ text: z.string().min(1).max(10000), dueAt: z.number() }).parse(args),
        execute: async (context, args) =>
          add({ ...(args as { text: string; dueAt: number }), chatKey: context.chatKey }),
      });
    },
  });
}
