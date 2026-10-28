import { systemControlService } from '@qq-harness/domain';
import { textContent, normalizeToolContent, type ContentPart } from '@qq-harness/contracts';
import { conversationContext, formatMessages, withTriggerFocus, withReplyBudget } from './context.js';
import { z } from 'zod';
import { redactKnownSecrets } from '@qq-harness/files';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  configService,
  storageService,
  accessService,
  modelService,
  toolService,
  traceService,
  hasOutboundEffect,
  outboundService,
  type TraceService,
  type ModelMessage,
  type ToolContext,
} from '@qq-harness/domain';
import { chatKeySchema, modelMessageSchema, type Archive } from '@qq-harness/contracts';

export const agentBasic = definePlugin({
  id: 'agent-basic',
  name: '无状态 Agent 运行模式',
  requires: [
    configService.id,
    storageService.id,
    accessService.id,
    modelService.id,
    toolService.id,
    outboundService.id,
    'harness.basic-tools',
  ],
  setup(ctx) {
    const config = ctx.use(configService),
      storage = ctx.use(storageService),
      access = ctx.use(accessService),
      model = ctx.use(modelService),
      tools = ctx.use(toolService);
    ctx.definePoint({
      id: 'context.build',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: z.object({
        chatKey: chatKeySchema,
        text: z.string(),
        triggerEntries: z.array(z.unknown()).optional(),
        proactive: z.boolean().optional(),
      }),
    });
    ctx.definePoint({
      id: 'prompt.segments',
      kind: 'transform',
      schema: z.object({
        chatKey: chatKeySchema,
        persona: z.string(),
        extra: z.string(),
        roleText: z.string().optional(),
        template: z.string().optional(),
        rules: z.string().optional(),
        botName: z.string().optional(),
      }),
    });
    // 兼容层内部逐扩展执行旧版 5s 超时；外层仍受运行截止时间与取消约束。
    ctx.definePoint({
      id: 'messages.before',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: z.object({
        chatKey: chatKeySchema,
        messages: z.array(modelMessageSchema),
        round: z.number().int().optional(),
        triggerEntries: z.array(z.unknown()).optional(),
        proactive: z.boolean().optional(),
      }),
    });
    ctx.definePoint({
      id: 'model.after',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: z.object({
        chatKey: chatKeySchema,
        response: modelMessageSchema,
      }),
    });
    ctx.definePoint({ id: 'run.ended', kind: 'observe', schema: z.unknown() });
    ctx.definePoint({
      id: 'reply.silence-policy',
      kind: 'transform',
      schema: z.object({
        chatKey: chatKeySchema,
        proactive: z.boolean(),
        requireDisposition: z.boolean(),
        maxNudges: z.number().int().min(0).max(3),
        requireSpeak: z.boolean(),
        nudgeText: z.string(),
        fallback: z.enum(['off', 'synthesize']),
      }),
    });
    ctx.definePoint({
      id: 'reply.batch-policy',
      kind: 'transform',
      timeoutMs: 300000,
      budgetMs: 300000,
      schema: z.object({
        chatKey: chatKeySchema,
        calls: z.array(z.unknown()),
        results: z.array(z.unknown()),
        sentBefore: z.number(),
        sentAfter: z.number(),
        shouldEnd: z.boolean(),
        reason: z.string(),
      }),
    });
    ctx.mode({
      id: 'agent.basic',
      partitionKey: (input) => input.chatKey,
      input: z.object({
        chatKey: chatKeySchema,
        ids: z.array(z.number().int()),
        triggerId: z.number().int().optional(),
        proactive: z.boolean().optional(),
        retryOf: z.string().optional(),
        wake: z
          .object({
            reason: z.string().max(100),
            text: z.string().max(20000),
            unreadFloor: z.number().int().nonnegative(),
          })
          .optional(),
      }),
      execute: async (run, input) => {
        const settings = config.effective(input.chatKey);
        access.assert(input.chatKey);
        const selected = new Set(input.ids);
        const triggers = storage
          .unread(input.chatKey)
          .filter(
            (message) => selected.has(message.localId) && access.allowed(input.chatKey, message.senderId),
          );
        const focus = input.triggerId
          ? (triggers.find((m) => m.localId === input.triggerId) ??
            storage
              .messages(input.chatKey)
              .find((m) => m.localId === input.triggerId && access.allowed(input.chatKey, m.senderId)))
          : undefined;
        if (config.get().paused || !settings.online || (!triggers.length && !input.proactive))
          return { skipped: true };
        const archive: Archive = {
          id: run.id,
          chatKey: input.chatKey,
          startedAt: Date.now(),
          endedAt: 0,
          status: 'running',
          sent: 0,
          triggerIds: triggers.map((m) => m.localId),
          ...(input.retryOf ? { retryOf: input.retryOf } : {}),
          ...(input.wake ? { wakeReason: input.wake.reason } : {}),
          trace: [],
          usage: { input: 0, output: 0 },
        };
        let trace: TraceService | undefined;
        try {
          trace = ctx.use(traceService);
        } catch {
          /* Optional diagnostics must not own the agent lifecycle. */
        }
        trace?.start(run.id, input.chatKey);
        trace?.record(run.id, 'trigger', '触发消息', {
          messages: triggers,
          settings,
        });
        const context: ToolContext = {
          run,
          chatKey: input.chatKey,
          settings,
          sent: 0,
          trace: (type, text) => {
            text = String(redactKnownSecrets(text, config.get()));
            archive.trace.push({ type, text, timestamp: Date.now() });
            ctx.host.publish('run.trace', { id: run.id, type, text });
          },
        };
        storage.markRead(
          input.chatKey,
          triggers.map((message) => message.localId),
        );
        const execute = async () => {
          let replyBudget:
            | ReturnType<NonNullable<import('@qq-harness/domain').OutboundService['openReplyBudget']>>
            | undefined;
          try {
            if (settings.maxReplyMessages > 0) {
              const outbound = ctx.use(outboundService);
              if (!outbound.openReplyBudget) throw Error('当前发送服务不支持回复消息上限，已停止本轮');
              replyBudget = outbound.openReplyBudget(run, settings.maxReplyMessages);
            }
            const built = await ctx.points.transform(
              'context.build',
              {
                chatKey: input.chatKey,
                proactive: !!input.proactive,
                triggerEntries: triggers.map((message) => ({
                  ...message,
                  ...(message.metadata ?? {}),
                  id: message.localId,
                  mid: message.id,
                  ts: message.timestamp,
                })),
                text:
                  (input.wake
                    ? `【任务唤醒】来源：${input.wake.reason}。以下是此前保存的任务说明，请结合当前会话执行；没有实际发送时不得声称已完成。\n${input.wake.text}\n\n`
                    : input.proactive
                      ? '【主动话题机会】当前会话已静默一段时间。结合历史自然开启话题；无合适话题时用 finish 静默结束。\n'
                      : '') +
                  conversationContext(
                    storage,
                    access,
                    input.chatKey,
                    triggers,
                    settings,
                    config.get().deniedUsers,
                    input.wake?.reason === 'proactive',
                  ),
              },
              run.signal,
            );
            const catalog = config.get();
            const personaText = settings.personaSelection.personaId
              ? catalog.personas.find((p) => p.id === settings.personaSelection.personaId)?.text
              : undefined;
            const rawTemplate = settings.personaSelection.promptId
              ? catalog.prompts.find((p) => p.id === settings.personaSelection.promptId)?.text
              : undefined;
            const template = rawTemplate
              ?.replaceAll('{roleText}', personaText ?? settings.persona)
              .replaceAll(
                '{botName}',
                catalog.personas.find((p) => p.id === settings.personaSelection.personaId)?.name ?? '助手',
              )
              .replaceAll('{participation}', '根据语境自然参与对话');
            const prompt = await ctx.points.transform(
              'prompt.segments',
              {
                chatKey: input.chatKey,
                persona: [personaText ?? settings.persona, template, settings.personaSelection.rules]
                  .filter(Boolean)
                  .join('\n\n'),
                extra: '',
                roleText: personaText ?? settings.persona,
                template: rawTemplate,
                rules: settings.personaSelection.rules,
                botName:
                  catalog.personas.find((p) => p.id === settings.personaSelection.personaId)?.name ?? '助手',
              },
              run.signal,
            );
            // 业务安全与工具协议最后追加，增强插件只通过受控阶段贡献文本。
            let messages: ModelMessage[] = [
              {
                role: 'system',
                content: `${prompt.persona}\n${prompt.extra}\n只操作当前会话。需要发言时调用 send_message({"messages":["第一条","第二条"]})，messages 只能传字符串数组，单条也传数组。普通分句使用多个数组元素，代码和表格保留必要换行。每条消息可独立包含 ⟦reply:消息ID⟧ 引用和多个 ⟦at:QQ号⟧；引用和@可同时使用，每条仅首个引用生效。send_message 可传 stop:true 在本次发送处理后直接结束，无需调用 finish。否则结束时调用 finish，silent 必须填写 silentReason，spoken 可省略理由。未发送时不能声称已发送。`,
              },
              {
                role: 'user',
                content: `${focus ? `【本轮触发消息 #${focus.id}】这是启动此次对话的消息，请着重理解并回应；@、拍一拍和关键词触发同样适用。其他消息作为上下文参考。\n焦点消息：${focus.senderName || focus.senderId}：${focus.text.slice(0, 4000)}${focus.text.length > 4000 ? '（焦点摘录已截取，完整内容见上下文）' : ''}\n\n` : ''}${built.text}`,
              },
            ];
            const silence = await ctx.points.transform(
              'reply.silence-policy',
              {
                chatKey: input.chatKey,
                proactive: !!input.proactive,
                requireDisposition: settings.silencePolicy !== 'off',
                maxNudges:
                  input.proactive || settings.silencePolicy !== 'enforce'
                    ? 0
                    : Math.min(3, settings.behavior.run.maxNudges),
                requireSpeak: false,
                nudgeText: '',
                fallback: settings.silencePolicy === 'off' ? ('off' as const) : ('synthesize' as const),
              },
              run.signal,
            );
            let nudges = 0;
            for (let round = 0; round < settings.maxRounds + silence.maxNudges; round++) {
              run.assertActive();
              ctx.assertActive();
              if (round > 0 && !config.get().paused) {
                const received = new Set(triggers.map((m) => m.localId));
                const added = storage
                  .unread(input.chatKey)
                  .filter(
                    (m) =>
                      !received.has(m.localId) &&
                      (!input.wake || m.localId > input.wake.unreadFloor) &&
                      access.allowed(input.chatKey, m.senderId),
                  );
                if (added.length) {
                  triggers.push(...added);
                  storage.markRead(
                    input.chatKey,
                    added.map((m) => m.localId),
                  );
                  messages.push({
                    role: 'user',
                    content: `【运行中新消息】\n${formatMessages(added)}`,
                  });
                  trace?.record(run.id, 'trigger', '运行中追加消息', {
                    messages: added,
                  });
                }
              }
              messages = (
                await ctx.points.transform(
                  'messages.before',
                  {
                    chatKey: input.chatKey,
                    messages,
                    round: round + 1,
                    proactive: !!input.proactive,
                    triggerEntries: triggers.map((m) => ({
                      ...m,
                      ...m.metadata,
                      id: m.localId,
                      mid: m.id,
                      ts: m.timestamp,
                    })),
                  },
                  run.signal,
                )
              ).messages;
              if (focus) messages = withTriggerFocus(messages, focus);
              if (replyBudget) messages = withReplyBudget(messages, replyBudget.limit, replyBudget.used());
              trace?.record(run.id, 'context', `第 ${round + 1} 轮上下文`, {
                messages,
                tools: tools.list(input.chatKey),
              });
              const result = await model.complete(messages, tools.list(input.chatKey), run.signal, {
                chatKey: input.chatKey,
                runId: run.id,
                round: round + 1,
              });
              trace?.record(run.id, 'model.response', `第 ${round + 1} 轮模型输出`, result);
              archive.usage.input += result.usage.input;
              archive.usage.output += result.usage.output;
              if (result.billing)
                (archive.usage.models ??= []).push({
                  ...result.billing,
                  ...result.usage,
                });
              if (result.extraUsage) {
                archive.usage.extra ??= {};
                for (const [key, value] of Object.entries(result.extraUsage))
                  archive.usage.extra[key] = (archive.usage.extra[key] ?? 0) + value;
              }
              const response = (
                await ctx.points.transform(
                  'model.after',
                  { chatKey: input.chatKey, response: result.message },
                  run.signal,
                )
              ).response;
              messages.push(response);
              if (response.content) context.trace('assistant', textContent(response.content));
              if (!response.tool_calls?.length) {
                if (context.sent > 0) {
                  context.finish = { mode: 'spoken', reason: '' };
                  break;
                }
                if (!silence.requireDisposition || nudges >= silence.maxNudges) {
                  context.finish = {
                    mode: 'silent',
                    reason:
                      silence.fallback === 'off'
                        ? ''
                        : `${nudges ? '系统已追问，' : ''}模型未调用发送工具或 finish${response.content ? '；内部输出：' + textContent(response.content).slice(0, 300) : ''}`,
                  };
                  break;
                }
                nudges++;
                messages.push({
                  role: 'user',
                  content:
                    silence.nudgeText ||
                    (silence.requireSpeak
                      ? '请使用发送工具实际回复。'
                      : '请用工具发送你的回复；若决定不发言，请调用 finish({mode:"silent",silentReason:"原因"})。'),
                });
                continue;
              }
              const mediaInputs: ContentPart[] = [];
              const sentBefore = context.sent,
                batchResults: unknown[] = [];
              for (const call of response.tool_calls) {
                run.assertActive();
                const output = await tools.execute(context, call.function.name, call.function.arguments);
                if (replyBudget?.exceeded()) throw Error('已达到本轮回复消息上限，本轮已终止，禁止自动重试');
                const content =
                  output && typeof output === 'object' && 'content' in output ? output.content : undefined;
                const parts = Array.isArray(content) ? normalizeToolContent(content) : undefined;
                if (parts?.some((p) => p.type === 'image_url' || p.type === 'video_url'))
                  mediaInputs.push(
                    {
                      type: 'text',
                      text: `工具 ${call.function.name} 的媒体结果：`,
                    },
                    ...parts,
                  );
                const toolMessage: ModelMessage = {
                  role: 'tool',
                  content: parts
                    ? textContent(parts) || '媒体已附在后续输入中'
                    : typeof content === 'string'
                      ? content
                      : JSON.stringify(output),
                  tool_call_id: call.id,
                };
                messages.push(toolMessage);
                batchResults.push({
                  ...toolMessage,
                  name: call.function.name,
                  isError: Boolean(
                    output && typeof output === 'object' && 'isError' in output && output.isError,
                  ),
                });
                if (
                  !context.stopRequested &&
                  context.finish?.mode === 'silent' &&
                  silence.requireSpeak &&
                  context.sent === 0 &&
                  nudges < silence.maxNudges
                ) {
                  context.finish = undefined;
                  messages.push({
                    role: 'user',
                    content: silence.nudgeText || '本次需要实际发言，请使用发送工具回复。',
                  });
                  nudges++;
                }
                if (context.finish) break;
              }
              if (mediaInputs.length) messages.push({ role: 'user', content: mediaInputs });
              if (context.finish) break;
              const batch = await ctx.points.transform(
                'reply.batch-policy',
                {
                  chatKey: input.chatKey,
                  calls: response.tool_calls,
                  results: batchResults,
                  sentBefore,
                  sentAfter: context.sent,
                  shouldEnd: false,
                  reason: '',
                },
                run.signal,
              );
              // A delivery-shaped tool name is not proof of delivery. An old
              // local policy may mistake a failed poke/voice tool for success.
              if (batch.shouldEnd && context.sent > sentBefore) {
                context.finish = { mode: 'spoken', reason: batch.reason };
                break;
              }
              if (round + 1 >= settings.maxRounds && context.sent > 0) {
                context.finish = { mode: 'spoken', reason: '' };
                break;
              }
              if (round + 1 >= settings.maxRounds && nudges >= silence.maxNudges) break;
            }
            archive.status = context.finish?.unverified
              ? 'unverified'
              : context.finish
                ? context.finish.mode === 'silent'
                  ? 'silent'
                  : 'completed'
                : 'exhausted';
            archive.reason = context.finish?.reason ?? '达到最大工具轮数';
            trace?.record(run.id, 'finish', '本轮结束', {
              finish: context.finish,
              sent: context.sent,
              status: archive.status,
            });
            return { sent: context.sent, finish: context.finish ?? null };
          } catch (error) {
            archive.status = run.signal.aborted || ctx.signal.aborted ? 'cancelled' : 'failed';
            archive.reason = error instanceof Error ? error.message : String(error);
            trace?.record(
              run.id,
              'error',
              '运行失败',
              { message: archive.reason },
              {
                status: archive.status === 'cancelled' ? 'cancelled' : 'failed',
              },
            );
            if (
              !config.get().paused &&
              context.sent === 0 &&
              !hasOutboundEffect(storage, run.id, input.chatKey)
            )
              storage.markRead(
                input.chatKey,
                triggers
                  .filter(
                    (message) => !ctx.use(systemControlService).historical(input.chatKey, message.localId),
                  )
                  .map((message) => message.localId),
                false,
              );
            throw error;
          } finally {
            replyBudget?.release();
            archive.sent = context.sent;
            archive.endedAt = Date.now();
            storage.archive(archive);
            trace?.end(run.id, archive.status);
            ctx.points.observe('run.ended', archive);
          }
        };
        let scope: { run<T>(tool: ToolContext, fn: () => T): T } | undefined;
        try {
          scope = ctx.use({ id: 'harness.tool-scope' });
        } catch {
          /* 扩展作用域由可选插件提供。 */
        }
        return scope ? scope.run(context, execute) : execute();
      },
    });
    ctx.provide({ id: 'harness.agent' }, { mode: 'agent.basic' });
  },
});
