import { definePlugin } from '@qq-harness/plugin-sdk';
import { incomingSchema } from '@qq-harness/contracts';
import {
  configService,
  storageService,
  accessService,
  adapterService,
  conversationService,
} from '@qq-harness/domain';

export const conversation = definePlugin({
  id: 'conversation',
  name: '聊天触发与聚批',
  requires: [configService.id, storageService.id, accessService.id, adapterService.id, 'harness.agent'],
  setup(ctx) {
    const config = ctx.use(configService),
      storage = ctx.use(storageService),
      access = ctx.use(accessService),
      adapter = ctx.use(adapterService);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const busy = new Set<string>();
    const seen = new Set<string>();
    ctx.definePoint({ id: 'message.received', kind: 'observe', schema: incomingSchema });
    ctx.definePoint({ id: 'trigger.evaluate', kind: 'guard', schema: incomingSchema });
    const start = (chatKey: string) => {
      ctx.assertActive();
      access.assert(chatKey);
      const settings = config.effective(chatKey);
      if (!settings.online) throw new Error('会话已下线');
      const run = ctx.host.submit({
        mode: 'agent.basic',
        partitionKey: chatKey,
        input: { chatKey, ids: storage.unread(chatKey).map((message) => message.localId) },
        timeoutMs: settings.runTimeoutMs,
      });
      busy.add(chatKey);
      void ctx.host.wait(run.id).then((result) => {
        busy.delete(chatKey);
        if (result.status === 'completed' && !ctx.signal.aborted && storage.unread(chatKey).length)
          schedule(chatKey, config.effective(chatKey).drainDelayMs);
      });
      return run.id;
    };
    const schedule = (chatKey: string, ms: number) => {
      if (busy.has(chatKey)) return;
      const old = timers.get(chatKey);
      if (old) clearTimeout(old);
      timers.set(
        chatKey,
        setTimeout(() => {
          timers.delete(chatKey);
          try {
            start(chatKey);
          } catch (error) {
            ctx.log(String(error));
          }
        }, ms),
      );
    };
    const ingest = async (raw: unknown) => {
      ctx.assertActive();
      const message = incomingSchema.parse(raw);
      if (!access.allowed(message.chatKey, message.senderId)) return;
      const key = `${message.chatKey}/${message.id}`;
      if (
        seen.has(key) ||
        storage.messages(message.chatKey).some((value) => value.id === message.id && !value.self)
      )
        return;
      seen.add(key);
      if (seen.size > 10000) seen.delete(seen.values().next().value!);
      const stored = storage.append(message);
      ctx.points.observe('message.received', message);
      const settings = config.effective(message.chatKey);
      if (!settings.online) {
        storage.markRead(message.chatKey, [stored.localId]);
        return;
      }
      if (busy.has(message.chatKey) || timers.has(message.chatKey)) return;
      const trigger =
        settings.trigger === 'all' ||
        message.chatKey.startsWith('private:') ||
        message.atMe ||
        (settings.trigger === 'keyword' && settings.keywords.some((word) => message.text.includes(word)));
      if (!trigger) {
        storage.markRead(message.chatKey, [stored.localId]);
        return;
      }
      try {
        await ctx.points.guard('trigger.evaluate', message, ctx.signal);
        schedule(message.chatKey, settings.wakeDelayMs);
      } catch {
        storage.markRead(message.chatKey, [stored.localId]);
      }
    };
    ctx.effect(
      adapter.subscribe((message) => {
        void ingest(message).catch((error) => ctx.log(String(error)));
      }),
    );
    ctx.effect(() => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    });
    ctx.provide(conversationService, {
      ingest,
      retry: (chatKey) => {
        if (busy.has(chatKey)) throw new Error('会话正在运行');
        return start(chatKey);
      },
    });
  },
});
