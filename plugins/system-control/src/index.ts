import { randomUUID } from 'node:crypto';
import { definePlugin, type RunContext } from '@qq-harness/plugin-sdk';
import {
  configService,
  storageService,
  accessService,
  systemControlService,
  type SystemControlService,
} from '@qq-harness/domain';
import {
  presenceSchema,
  presenceChangeSchema,
  operationsSettingsSchema,
  type IncomingMessage,
  type OperationLog,
} from '@qq-harness/contracts';
import { redactKnownSecrets } from '@qq-harness/files';

/** Business policy stays outside the kernel. State survives unloading the optional operations UI. */
export const systemControl = definePlugin({
  id: 'system-control',
  name: '系统上下线控制',
  requires: [configService.id, storageService.id, accessService.id],
  client: { entry: 'builtin:system-control' },
  setup(ctx) {
    const config = ctx.use(configService),
      storage = ctx.use(storageService),
      access = ctx.use(accessService);
    const old = {
      ...((config.get().legacyGlobal as any)?.skills?.['ops-ctrl'] ?? {}),
      ...((storage.state('extension-system', 'config') as any)?.skills?.['ops-ctrl'] ?? {}),
    };
    if (!config.get().systemPresence) {
      storage.setState('system-control', 'legacy-backup', { operations: old, paused: config.get().paused });
      const allowedIds = String(old.allowedIds ?? '')
        .split(/[,，、;；\s]+/)
        .filter((id) => /^[1-9]\d{4,19}$/.test(id));
      const validOld: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(operationsSettingsSchema.shape)) {
        if (!(key in old)) continue;
        const parsed = schema.safeParse(old[key]);
        if (parsed.success) validOld[key] = parsed.data;
      }
      const operations = operationsSettingsSchema.parse({
        ...validOld,
        allowedIds,
        privateEnabled: old.enabled === true,
        ...((config.initialOperations?.() as object) ?? {}),
      });
      config.patch({
        systemPresence: presenceSchema.parse({
          state:
            config.get().paused ||
            old.offline === true ||
            (config.get().legacyGlobal as any)?.skills?.['ops-ctrl']?.offline === true
              ? 'offline'
              : 'online',
          changedAt: Date.now(),
          source: 'migration',
          reason: old.offline ? String(old.reason ?? '') : '',
        }),
        operations,
      });
    }
    const allowedMode = (owner: string, mode: string) =>
      (owner === 'agent-memory' && mode === 'memory.agent') ||
      (owner === 'ops-control' && mode === 'ops.reply');
    const tickets = new Map<string, { chatKey: string; senderId: string; expires: number }>();
    const replies = new Map<string, { run: RunContext; chatKey: string; senderId: string; text: string }>();
    const signals = new WeakMap<AbortSignal, string>();
    let last = config.get().systemPresence!;
    let floors = (storage.state('system-control', 'watermarks') ?? {}) as Record<string, number>;
    const skip = () => {
      for (const chat of storage.chats()) {
        const unread = storage.unread(chat.chatKey);
        const latest = storage.messages(chat.chatKey).at(-1)?.localId ?? 0;
        floors[chat.chatKey] = Math.max(floors[chat.chatKey] ?? 0, latest);
        storage.markRead(
          chat.chatKey,
          unread.filter((m) => m.localId <= latest).map((m) => m.localId),
        );
        storage.setState('conversation-active', chat.chatKey, 0);
      }
      storage.setState('system-control', 'watermarks', floors);
    };
    const log: SystemControlService['log'] = (entry) => {
      const items = (storage.state('system-control', 'logs') ?? []) as OperationLog[];
      items.push({ ...redactKnownSecrets(entry, config.get()), id: randomUUID(), at: Date.now() });
      storage.setState('system-control', 'logs', items.slice(-1000));
      ctx.host.publish('operations.changed', {});
    };
    const apply = () => {
      const now = config.get().systemPresence!;
      if (now.revision === last.revision && now.state === last.state) return;
      last = now;
      if (now.state === 'offline')
        for (const run of ctx.host.listRuns())
          if (['queued', 'running'].includes(run.status) && !allowedMode(run.owner ?? '', run.mode))
            ctx.host.cancel(run.id);
      skip();
      log({
        source: now.source,
        actor: now.actor,
        action: now.state,
        status: 'ok',
        message:
          now.reason || (now.state === 'offline' ? '系统下线；记忆维护继续' : '系统上线；历史积压已跳过'),
      });
      ctx.host.publish('system.presence', now);
    };
    const authorized = (message: IncomingMessage) => {
      const settings = config.get().operations;
      return (
        settings.privateEnabled &&
        settings.allowedIds.includes(message.senderId) &&
        message.chatKey === `private:${message.senderId}` &&
        /^[/／]ctrl\b/i.test(message.text.trim()) &&
        (access.withinBoundary ?? access.allowed)(message.chatKey, message.senderId) &&
        ctx.host.listPlugins().some((p) => p.id === 'ops-control' && p.status === 'active')
      );
    };
    const assertReply = (id: string, chatKey: string, text: string) => {
      const value = replies.get(id);
      return (
        !!value &&
        value.chatKey === chatKey &&
        value.text === text &&
        !value.run.signal.aborted &&
        config.get().operations.privateEnabled &&
        config.get().operations.allowedIds.includes(value.senderId) &&
        (access.withinBoundary ?? access.allowed)(chatKey, value.senderId)
      );
    };
    const service: SystemControlService = {
      get: () => structuredClone(config.get().systemPresence!),
      change(input, source, actor) {
        const value = presenceChangeSchema.parse(input),
          current = service.get();
        const previous = storage.state('system-control-requests', value.requestId) as
          { input: string; result: typeof current } | undefined;
        const fingerprint = JSON.stringify({ state: value.state, reason: value.reason ?? '', source, actor });
        if (previous) {
          if (previous.input !== fingerprint) throw Error('幂等标识已用于不同操作');
          return previous.result;
        }
        if (value.expectedRevision !== undefined && value.expectedRevision !== current.revision)
          throw Error('系统状态已变化，请刷新后重试');
        if (current.state !== value.state)
          config.patch({
            systemPresence: {
              state: value.state,
              revision: current.revision + 1,
              changedAt: Date.now(),
              source,
              actor,
              reason: value.reason ?? '',
            },
          });
        const result = service.get();
        storage.setState('system-control-requests', value.requestId, { input: fingerprint, result });
        return result;
      },
      assertBusiness() {
        if (service.get().state === 'offline') throw Error('系统已下线');
      },
      authorized,
      issue(message) {
        if (!authorized(message)) throw Error('运维指令未获授权');
        for (const [key, t] of tickets) if (t.expires < Date.now()) tickets.delete(key);
        const ticket = randomUUID();
        tickets.set(ticket, {
          chatKey: message.chatKey,
          senderId: message.senderId,
          expires: Date.now() + 90000,
        });
        return ticket;
      },
      grantReply(run, ticket, text) {
        const auth = tickets.get(ticket);
        tickets.delete(ticket);
        const actual = ctx.host.listRuns().find((r) => r.id === run.id && r.status === 'running');
        if (
          !auth ||
          auth.expires < Date.now() ||
          actual?.owner !== 'ops-control' ||
          actual.mode !== 'ops.reply'
        )
          throw Error('运维回执授权无效');
        replies.set(run.id, { run, ...auth, text });
        return () => {
          replies.delete(run.id);
        };
      },
      isReply: (run, chatKey, text, payload) =>
        payload === undefined && replies.get(run.id)?.run === run && assertReply(run.id, chatKey, text),
      replyId: assertReply,
      bindSignal(run, signal) {
        if (replies.get(run.id)?.run === run) signals.set(signal, run.id);
        return () => {
          signals.delete(signal);
        };
      },
      controlSignal(signal, chatKey) {
        const id = signal && signals.get(signal),
          reply = id && replies.get(id);
        return !!reply && assertReply(id as string, chatKey, reply.text);
      },
      historical: (key, id) => id <= (floors[key] ?? 0),
      log,
      logs: () => structuredClone((storage.state('system-control', 'logs') ?? []) as OperationLog[]),
    };
    ctx.guardRuns((owner, mode) => {
      if (!allowedMode(owner, mode)) service.assertBusiness();
    });
    ctx.effect(
      ctx.host.subscribe((event) => {
        if (event.type === 'config.changed') apply();
      }),
    );
    if (last.state === 'offline') skip();
    ctx.provide(systemControlService, service);
    ctx.effect(() => {
      tickets.clear();
      replies.clear();
    });
  },
});
