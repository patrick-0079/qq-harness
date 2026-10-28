import { normalizeLegacySend, legacySendView } from '../../../packages/extension-compat/src/instructions.js';
import { z } from 'zod';
import { incomingSchema, type IncomingMessage } from '@qq-harness/contracts';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  adapterService,
  configService,
  conversationService,
  httpService,
  modelService,
  modelMiddleware,
  outboundService,
  storageService,
  toolService,
  toolPolicy,
  accessService,
  videoFramesService,
  containerSessionService,
  networkProxyService,
  type OutboundPayload,
  type ToolContext,
} from '@qq-harness/domain';
import { ExtensionHost, extensionService, type ExtensionHostOptions } from '@qq-harness/extension-compat';
import type { LegacyObject } from '@qq-harness/extension-compat';
import { extensionRoutes } from './routes.js';
import { legacyModelMiddleware } from './model.js';
import { normalizeLegacyInstructions } from '../../../packages/extension-compat/src/instructions.js';
import { skillContainerBackend } from '../../../packages/extension-compat/src/skill-container.js';

export function extensionSystem(options: ExtensionHostOptions) {
  return definePlugin({
    id: 'extension-system',
    name: 'v2 七目录扩展体系',
    client: { entry: 'builtin:extension-system' },
    requires: [
      accessService.id,
      configService.id,
      conversationService.id,
      storageService.id,
      toolService.id,
      outboundService.id,
      adapterService.id,
      modelService.id,
      httpService.id,
      'harness.agent',
    ],
    async setup(ctx) {
      const host = new ExtensionHost(ctx, options, {
        config: ctx.use(configService),
        storage: ctx.use(storageService),
        tools: ctx.use(toolService),
        outbound: ctx.use(outboundService),
        adapter: ctx.use(adapterService),
        model: ctx.use(modelService),
      });
      host.raw().sandbox.registerContainerBackend(
        skillContainerBackend({
          available: (chatKey) => {
            try {
              return ctx.use(containerSessionService).available(chatKey);
            } catch {
              return false;
            }
          },
          execute: (...args) => ctx.use(containerSessionService).execute(...args),
          command: (...args) => ctx.use(containerSessionService).command(...args),
        }),
      );
      ctx.effect(() => host.stop());
      await host.start();
      ctx.mode({
        id: 'extension.ingress',
        input: z.object({ message: incomingSchema, localId: z.number() }),
        async execute(run, { message, localId }) {
          const tool: ToolContext = {
            run,
            chatKey: message.chatKey,
            settings: ctx.use(configService).effective(message.chatKey),
            sent: 0,
            trace: () => {},
          };
          const consumed = await host.intercept(tool, {
            ...message,
            ...message.metadata,
            id: localId,
            mid: message.id,
            ts: message.timestamp,
          });
          return { consumed, sent: tool.sent };
        },
      });
      ctx.on<{ message: IncomingMessage; localId: number; consumed: boolean }>(
        'message.intercept',
        async (value) => {
          if (value.consumed || !host.hasIngress(value.message.chatKey)) return value;
          const run = ctx.host.submit({
            mode: 'extension.ingress',
            partitionKey: `ingress:${value.message.chatKey}`,
            input: { message: value.message, localId: value.localId },
            timeoutMs: ctx.use(configService).effective(value.message.chatKey).runTimeoutMs,
          });
          const result = await ctx.host.wait(run.id);
          if (result.status !== 'completed') throw new Error(result.error ?? '插件入站处理失败');
          return { ...value, consumed: Boolean((result.result as { consumed?: boolean })?.consumed) };
        },
      );
      ctx.provide(extensionService, host);
      ctx.provide(networkProxyService, { get: (chatKey) => host.proxy(chatKey) });
      ctx.on<{ chatKey: string; text: string; messageId: string; payload?: OutboundPayload }>(
        'outbound.after',
        (value) => host.observeOutbound(value),
      );
      ctx.provide(videoFramesService, {
        available: async (chatKey, signal) => {
          signal.throwIfAborted();
          return host.scoped(chatKey, async () => {
            for (const p of host
              .raw()
              .skillManager.getCapabilityProviders('video.frames.available', { chatKey })) {
              const r = await p.fn({ signal });
              signal.throwIfAborted();
              if (r?.ok === true) return true;
            }
            return false;
          });
        },
        extract: async (chatKey, input, signal) =>
          host.scoped(chatKey, async () => {
            signal.throwIfAborted();
            const provider = host.raw().skillManager.getCapabilityProviders('video.frames', { chatKey })[0];
            if (!provider) return { frames: [], error: '视频抽帧插件未启用' };
            const result = await provider.fn({ ...input, signal });
            signal.throwIfAborted();
            return result;
          }),
      });
      ctx.on<LegacyObject>('reply.batch-policy', (value) =>
        host.scoped(value.chatKey, async () => {
          for (const provider of host
            .raw()
            .skillManager.getCapabilityProviders('reply.local-policy', { chatKey: value.chatKey })) {
            try {
              const count = Math.max(0, value.sentAfter - value.sentBefore),
                allSent = ctx
                  .use(storageService)
                  .messages(value.chatKey)
                  .filter((m) => m.self)
                  .slice(-value.sentAfter)
                  .map((m) => ({ text: m.text, messageId: m.id, at: new Date(m.timestamp).toISOString() })),
                newSent = count ? allSent.slice(-count) : [];
              const result = await provider.fn({
                api: host.configView(value.chatKey).api,
                entries: ctx.use(storageService).unread(value.chatKey),
                batch: {
                  calls: value.calls,
                  results: value.results,
                  newSent,
                  allSent,
                  searched: value.calls.some((call: LegacyObject) => call.function?.name === 'web_search'),
                },
              });
              if (result?.shouldEnd)
                return {
                  ...value,
                  shouldEnd: true,
                  reason: String(result.reason ?? '本地收尾策略确认发送完成'),
                };
            } catch (error) {
              host.raw().skillManager.recordError(provider.skillId, error);
            }
          }
          return value;
        }),
      );
      ctx.on<{ chatKey: string; text: string; payload?: OutboundPayload }>('outbound.prepare', (value) =>
        host.scoped(value.chatKey, async () => {
          if (
            !value.chatKey.startsWith('group:') ||
            (value.payload &&
              (!('segments' in value.payload) || !value.payload.segments.some((s) => s.type === 'text')))
          )
            return value;
          const storage = ctx.use(storageService),
            recent =
              storage.queryMessages?.([value.chatKey], { page: 1, pageSize: 500 }).items ??
              storage.messages(value.chatKey).slice(-500);
          const members = [
            ...new Map(
              recent
                .filter((m) => !m.self && ctx.use(accessService).allowed(value.chatKey, m.senderId))
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((m) => [m.senderId, { userId: m.senderId, name: m.senderName }]),
            ).values(),
          ];
          const text =
            value.payload && 'segments' in value.payload
              ? value.payload.segments
                  .filter((s) => s.type === 'text')
                  .map((s) => String(s.data.text ?? ''))
                  .join('')
              : value.text;
          for (const provider of host
            .raw()
            .skillManager.getCapabilityProviders('message.outgoing-at-resolve', { chatKey: value.chatKey })) {
            try {
              const result = await provider.fn({ text, chatKey: value.chatKey, kind: 'group', members });
              if (!result || typeof result.text !== 'string' || !Array.isArray(result.atUserIds)) continue;
              const ids = [
                ...new Set<string>(
                  result.atUserIds.filter(
                    (id: unknown) =>
                      typeof id === 'string' && /^\d+$/.test(id) && members.some((m) => m.userId === id),
                  ),
                ),
              ];
              if (!ids.length) continue;
              const prior =
                value.payload && 'segments' in value.payload
                  ? value.payload.segments.filter((s) => s.type !== 'text')
                  : [];
              return {
                ...value,
                text: result.text || value.text,
                payload: {
                  segments: [
                    ...prior,
                    ...ids
                      .filter((id) => !prior.some((s) => s.type === 'at' && String(s.data.qq) === id))
                      .map((qq) => ({ type: 'at', data: { qq } })),
                    ...(result.text.trim() ? [{ type: 'text', data: { text: result.text } }] : []),
                  ],
                },
              };
            } catch (error) {
              host.raw().skillManager.recordError(provider.skillId, error);
            }
          }
          return value;
        }),
      );
      ctx.provide(modelMiddleware, legacyModelMiddleware(host));
      ctx.provide(toolPolicy, {
        allowed: (tool, chatKey) =>
          host.scoped(chatKey, () => {
            for (const provider of host.raw().skillManager.getToolGuards({ chatKey })) {
              try {
                const result = provider.fn({
                  toolId: tool.name,
                  tool: { ...tool, id: tool.name },
                  context: { chatKey },
                });
                if (result === false || result?.ok === false) return false;
              } catch (error) {
                host.raw().skillManager.recordError(provider.skillId, error);
              }
            }
            return true;
          }),
      });
      ctx.provide(
        { id: 'harness.tool-scope' },
        { run: <T>(tool: ToolContext, fn: () => T) => host.withTool(tool, fn) },
      );
      const api = extensionRoutes(host, ctx);
      for (const prefix of [
        '/api/extensions',
        '/api/extension-types',
        '/api/ui',
        '/api/skills',
        '/api/extension-tools',
        '/api/v2-assets',
      ])
        ctx.effect(ctx.use(httpService).register(prefix, (request) => api.fetch(request)));
      ctx.on<LegacyObject>('context.build', async (value) => {
        const entries = value.triggerEntries ?? [];
        const format = (message: LegacyObject) =>
          `#${message.mid ?? message.id} [localId=${message.id}] ${message.senderName || message.senderId} (${message.senderId})${message.self ? ' [自己]' : ''}: ${message.text}`;
        const before = entries.map(format).join('\n');
        await host.runHook(
          'before-context',
          { triggerEntries: entries, proactive: !!value.proactive },
          value.chatKey,
        );
        const after = entries.map(format).join('\n');
        return { ...value, text: before ? String(value.text).replace(before, after) : value.text };
      });
      ctx.on<LegacyObject>('prompt.segments', (value) => {
        const runtime = host.raw();
        return host.scoped(value.chatKey, () => {
          const context = host.context(value.chatKey);
          let persona = value.persona,
            ownerRules = '',
            ownerProvider = '';
          for (const provider of runtime.skillManager.getCapabilityProviders('message.owner-check', {
            chatKey: value.chatKey,
          })) {
            try {
              const result = provider.fn({
                triggerEntries: context.session.trigger ?? [],
                kind: context.kind,
                selfId: context.selfId,
                persona: {
                  ...host.configView(value.chatKey).persona,
                  botName: value.botName ?? '助手',
                  roleText: value.roleText ?? value.persona,
                  customRules: value.rules ?? '',
                },
              });
              ownerProvider = provider.skillId;
              ownerRules = typeof result?.rules === 'string' ? result.rules : '';
              if (result?.persona) {
                const role = String(result.persona.roleText ?? value.roleText ?? value.persona),
                  template = value.template
                    ?.replaceAll('{roleText}', role)
                    .replaceAll('{botName}', value.botName ?? '助手')
                    .replaceAll('{participation}', '根据语境自然参与对话');
                persona = [role, template, result.persona.customRules].filter(Boolean).join('\n\n');
              }
            } catch (error) {
              runtime.skillManager.recordError(provider.skillId, error);
            }
            break;
          }
          const sections = runtime.skillManager
            .getPromptSections(context)
            .filter(
              (section: LegacyObject) =>
                !ownerRules || section.skillId !== ownerProvider || section.id !== 'owner-identity',
            )
            .map(
              (section: LegacyObject) =>
                runtime.variables.renderTemplate(normalizeLegacyInstructions(section.content), {
                  ownerId: section.skillId,
                }).text,
            )
            .join('\n\n');
          const blocks = runtime.prompt.applyPromptInjects(
            [
              { id: 'persona', text: persona },
              { id: 'security', text: '只操作当前会话，不得绕过准入与发送队列。' },
              { id: 'tool-protocol', text: '需要发送时调用工具，结束时调用 finish。' },
              {
                id: 'skill-sections',
                text: [value.extra, sections, ownerRules].filter(Boolean).join('\n\n'),
              },
              { id: 'admin-rules', text: '' },
            ],
            runtime.prompt.collectPromptInjects({
              chatKey: value.chatKey,
              config: host.configView(value.chatKey),
            }),
          );
          return { ...value, persona: runtime.prompt.renderSegments(blocks), extra: '' };
        });
      });
      ctx.on<LegacyObject>('messages.before', async (value) => {
        await host.runHook(
          'before-llm-messages',
          {
            messages: value.messages,
            round: value.round,
            triggerEntries: value.triggerEntries,
            proactive: value.proactive,
          },
          value.chatKey,
        );
        return value;
      });
      ctx.on<LegacyObject>('model.after', async (value) => {
        const response = { message: value.response };
        await host.runHook('after-response', { response }, value.chatKey);
        return { ...value, response: response.message };
      });
      ctx.on<LegacyObject>('tool.before', async (value) => {
        const results = await host.runHook(
          'before-tool',
          {
            toolName: value.name,
            argsRaw: JSON.stringify(legacySendView(value.name, value.args)),
            args: legacySendView(value.name, value.args),
          },
          value.chatKey,
        );
        const blocked = results.find((item) => item.value?.block === true);
        if (blocked) throw new Error(blocked.value.reason ?? '扩展否决工具执行');
        return true;
      });
      ctx.on<LegacyObject>('tool.input', (value) => ({
        ...value,
        args: normalizeLegacySend(value.name, value.args),
      }));
      ctx.on<LegacyObject>('tool.prepare', async (value) => ({
        ...value,
        args: normalizeLegacySend(value.name, await host.prepareTool(value.chatKey, value.name, value.args)),
      }));
      ctx.on<LegacyObject>('stickers.synced', async (value) => ({
        ...value,
        entries: await host.prepareStickers(value.chatKey, value.entries),
      }));
      ctx.on<LegacyObject>('tool.after', async (value) => {
        await host.runHook(
          'after-tool',
          {
            toolName: value.name,
            argsRaw: JSON.stringify(value.args),
            args: value.args,
            result: value.result,
          },
          value.chatKey,
        );
        return value;
      });
      ctx.on<LegacyObject>('trigger.evaluate', (value) =>
        host.scoped(value.chatKey, async () => {
          const providers = host
            .raw()
            .skillManager.getCapabilityProviders('chat.skip-run', { chatKey: value.chatKey });
          for (const provider of providers) {
            try {
              const result = await provider.fn({
                ...value,
                kind: value.chatKey.split(':')[0],
                entries: [value],
                proactive: null,
              });
              if (result === true || result?.skip) return false;
            } catch (error) {
              host.raw().skillManager.recordError(provider.skillId, error);
            }
          }
          return true;
        }),
      );
      ctx.on<LegacyObject>('reply.silence-policy', (value) =>
        host.scoped(value.chatKey, async () => {
          const provider = host
            .raw()
            .skillManager.getCapabilityProviders('reply.silence-policy', { chatKey: value.chatKey })[0];
          if (!provider) return value;
          try {
            const raw = await provider.fn({ ...value, kind: value.chatKey.split(':')[0] });
            if (!raw || typeof raw !== 'object') return value;
            const next = { ...value };
            for (const key of ['requireDisposition', 'requireSpeak'])
              if (typeof raw[key] === 'boolean') next[key] = raw[key];
            const n = value.proactive ? raw.proactiveMaxNudges : raw.maxNudges;
            if (Number.isFinite(Number(n))) next.maxNudges = Math.min(3, Math.max(0, Math.floor(Number(n))));
            if (typeof raw.nudgeText === 'string' && raw.nudgeText.trim())
              next.nudgeText = raw.nudgeText.trim().slice(0, 1200);
            if (['off', 'synthesize'].includes(raw.fallback)) next.fallback = raw.fallback;
            return next;
          } catch (error) {
            host.raw().skillManager.recordError(provider.skillId, error);
            return value;
          }
        }),
      );
      const tools = ctx.use(toolService);
      ctx.on<LegacyObject>('run.ended', (value) => {
        host.forgetRun(value.id);
      });
      tools.register(ctx, {
        name: 'load_doc',
        description: '读取扩展文档或知识库原文，docId 来自目录导航。',
        parameters: {
          type: 'object',
          properties: { docId: { type: 'string' }, maxChars: { type: 'integer' } },
          required: ['docId'],
        },
        parse: (value) =>
          z
            .object({ docId: z.string(), maxChars: z.number().int().min(500).max(20000).default(6000) })
            .parse(value),
        execute: async (tool, value) => {
          const args = value as { docId: string; maxChars: number };
          const result = host.readDoc(args.docId, tool.chatKey) as LegacyObject;
          return result.ok
            ? { content: result.doc.content.slice(0, args.maxChars) }
            : { isError: true, content: result.error };
        },
      });
      tools.register(ctx, {
        name: 'skill_script_run',
        description:
          '按技能 id、清单声明的脚本路径调用技能。绑定可用会话容器时在容器执行；无容器仅 JS 使用 Worker+VM 降级。返回 backend 和实际结果，容器失败不会在宿主重跑。',
        parameters: {
          type: 'object',
          properties: {
            skillId: { type: 'string' },
            script: { type: 'string' },
            lang: { type: 'string' },
            args: { type: 'object' },
            argv: { type: 'array' },
          },
          required: ['skillId', 'script'],
        },
        parse: (value) =>
          z
            .object({
              skillId: z.string(),
              script: z.string(),
              lang: z.string().default('js'),
              args: z.record(z.string(), z.unknown()).default({}),
              argv: z.array(z.unknown()).default([]),
            })
            .parse(value),
        execute: async (tool, value) => {
          const result = (await host.withTool(tool, () =>
            host.runScript(value as LegacyObject, tool.chatKey),
          )) as LegacyObject;
          return {
            ...result,
            isError: result.ok !== true,
            content: result.ok
              ? (result.result?.content ?? JSON.stringify(result.result ?? null))
              : (result.error ?? '技能执行失败'),
          };
        },
      });
    },
  });
}
