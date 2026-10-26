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
      const access = ctx.use(accessService),
        outbound = ctx.use(outboundService),
        tools = ctx.use(toolService),
        storage = ctx.use(storageService);
      let items = z.array(schema).parse(storage.state('reminders', 'items') ?? []);
      const firing = new Set<string>();
      const save = () => storage.setState('reminders', 'items', items);
      const add = (value: Omit<Reminder, 'id'>) => {
        ctx.assertActive();
        access.assert(value.chatKey);
        const reminder = schema.parse({ ...value, id: randomUUID() });
        if (reminder.dueAt <= Date.now()) throw new Error('提醒时间必须在未来');
        items.push(reminder);
        save();
        return reminder;
      };
      ctx.provide(reminderService, {
        list: () => structuredClone(items),
        add,
        remove: (id) => {
          items = items.filter((value) => value.id !== id);
          save();
        },
      });
      ctx.mode({
        id: 'reminder.deliver',
        partitionKey: (input) => input.chatKey,
        input: schema,
        execute: async (run, reminder) => {
          access.assert(reminder.chatKey);
          await outbound.send(run, reminder.chatKey, reminder.text);
          items = items.filter((value) => value.id !== reminder.id);
          save();
          return { delivered: true };
        },
      });
      const timer = setInterval(() => {
        for (const item of items) {
          if (item.dueAt > Date.now() || firing.has(item.id) || !access.allowed(item.chatKey)) continue;
          firing.add(item.id);
          const run = ctx.host.submit({ mode: 'reminder.deliver', partitionKey: item.chatKey, input: item });
          void ctx.host.wait(run.id).then(() => firing.delete(item.id));
        }
      }, 500);
      ctx.effect(() => clearInterval(timer));
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
