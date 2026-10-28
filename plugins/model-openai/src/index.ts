import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { modelHttpHeadersSchema } from '@qq-harness/contracts';
import { firstGifFrame, configuredFetch } from '@qq-harness/files';
import type { ChatSettings } from '@qq-harness/contracts';
import {
  configService,
  modelService,
  modelHttpService,
  modelMiddleware,
  traceService,
  networkProxyService,
  type ModelMessage,
  type ModelMiddleware,
} from '@qq-harness/domain';

const toolCall = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            role: z.literal('assistant'),
            content: z.string().nullable().optional(),
            reasoning_content: z.string().optional(),
            tool_calls: z.array(toolCall).optional(),
          })
          .passthrough(),
        finish_reason:z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .passthrough()
    .optional(),
});
export const modelOpenai = definePlugin({
  id: 'model-openai',
  name: 'OpenAI 兼容模型',
  requires: [configService.id],
  setup(ctx) {
    const config = ctx.use(configService);
    ctx.definePoint({
      id: 'model.http.headers',
      kind: 'transform',
      schema: modelHttpHeadersSchema,
    });
    ctx.provide(modelHttpService, { ready: true });
    const requestModel = async (
      messages: Parameters<import('@qq-harness/domain').ModelService['complete']>[0],
      tools: Parameters<import('@qq-harness/domain').ModelService['complete']>[1],
      signal: AbortSignal,
      base = config.get().model,
      selection?: ChatSettings['modelSelection'],
      capture?: import('@qq-harness/domain').ModelOptions,
    ): Promise<import('@qq-harness/domain').ModelResponse> => {
      let middleware: ModelMiddleware | undefined;
      try {
        middleware = ctx.use(modelMiddleware);
      } catch {
        /* 可选的模型增强插件。 */
      }
      let request:import('@qq-harness/domain').ModelRequest = {
        api: base,
        context:{...capture?.context,chatKey:capture?.chatKey,runId:capture?.runId,auxiliary:capture?.purpose==='auxiliary',endpointOverride:Boolean(capture?.overrides),thinkingMode:selection?.thinkingMode},
        body: {
          model: base.model,
          messages,
          ...(selection?.temperature != null ? { temperature: selection.temperature } : {}),
          ...(capture?.maxTokens?{max_tokens:Math.max(1,Math.min(1000000,Math.floor(capture.maxTokens)))}:{}),
          ...(selection?.thinkingBudget ? {thinking_budget:selection.thinkingBudget} : {}),
          ...(selection?.thinkingEffort ? { reasoning_effort: selection.thinkingEffort } : {}),
          ...(selection?.thinkingMode === 'off'
            ? { reasoning_effort: 'none', enable_thinking: false }
            : selection?.thinkingMode === 'on'
              ? { enable_thinking: true }
              : {}),
          ...(tools.length ? { tools, tool_choice: capture?.toolChoice??'auto' } : {}),
        } as Record<string, unknown>,
      };
      if (middleware) request = await middleware.request(request);
      const cfg = request.api;
      if (!cfg.model || !cfg.apiKey) throw new Error('请先配置模型与 API Key');
      const url = new URL(cfg.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('模型 URL 协议无效');
      if (!url.pathname.replace(/\/$/, '').endsWith('/chat/completions'))
        url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
      const combined = AbortSignal.any([signal, ctx.signal, AbortSignal.timeout(cfg.timeoutMs)]);
      let advised = false;
      let gifRetried=false;
      const record = (
        kind: import('@qq-harness/contracts').TraceKind,
        title: string,
        data: unknown,
        details?: Partial<import('@qq-harness/contracts').RunTraceEvent>,
      ) => {
        if (!capture?.runId) return;
        try {
          return ctx.use(traceService).record(capture.runId, kind, title, data, details);
        } catch {
          /* Trace plugin may be disabled. */
        }
      };
      for (let attempt = 0; ; attempt++) {
        ctx.assertActive();
        combined.throwIfAborted();
        const started = Date.now();
        const requestId = record(
          'model.request',
          `模型请求 · ${String(request.body.model)} · 尝试 ${attempt + 1}`,
          { round: capture?.round, url: url.origin + url.pathname, body: request.body },
          { status: 'running' },
        );
        try {
          const { headers } = await ctx.points.transform(
            'model.http.headers',
            {
              url: url.href,
              model: String(request.body.model ?? cfg.model),
              headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
            },
            combined,
          );
          let transport;
          try { transport = ctx.use(networkProxyService); } catch { /* Optional proxy provider. */ }
          const response = await configuredFetch(url, {
            method: 'POST',
            headers,
            signal: combined,
            body: JSON.stringify(request.body),
          }, transport?.get(capture?.chatKey));
          if (!response.ok) {
            record(
              'model.retry',
              `模型返回 HTTP ${response.status}`,
              { attempt: attempt + 1, status: response.status },
              { parentId: requestId, durationMs: Date.now() - started, status: 'failed' },
            );
            // 错误正文可能含请求凭据或聊天正文；对管理端只暴露状态码。
            const detail = (await response.text()).slice(0, 16000);
            middleware?.feedback(request, { ok: false, status: response.status });
            if (!advised && middleware) {
              advised = true;
              const retry = await middleware.retry(request, response.status, detail);
              if (retry) {
                request.body = retry;
                continue;
              }
            }
            if(!gifRetried&&[400,415].includes(response.status)&&/image|gif|mime|base64|图片|格式/i.test(detail)){
              gifRetried=true;let changed=false;
              const next=await Promise.all((request.body.messages as ModelMessage[]).map(async message=>{
                if(!Array.isArray(message.content))return message;
                const content=await Promise.all(message.content.map(async part=>{
                  if(part.type!=='image_url'||!part.image_url?.url)return part;
                  const url=await firstGifFrame(part.image_url.url);
                  if(!url)return part;changed=true;return {...part,image_url:{...part.image_url,url}};
                }));return {...message,content};
              }));
              if(changed){request.body={...request.body,messages:next};record('model.retry','模型拒绝 GIF，改用首帧重试',{attempt:attempt+1},{parentId:requestId});continue;}
            }
            const error = new Error(`模型接口 HTTP ${response.status}`) as Error & { retryable: boolean };
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
          }
          const data = responseSchema.parse(await response.json());
          const raw = data.choices[0]!.message;
          const message: ModelMessage = { ...raw, content: raw.content ?? null };
          middleware?.feedback(request, { ok: true, status: response.status });
          const extraUsage=Object.fromEntries(Object.entries({cached_tokens:Number((data.usage?.prompt_tokens_details as Record<string,unknown>|undefined)?.cached_tokens??data.usage?.prompt_cache_hit_tokens??0)||0,reasoning_tokens:Number((data.usage?.completion_tokens_details as Record<string,unknown>|undefined)?.reasoning_tokens??0)||0}).filter(([,value])=>value>0));
          const result = {
            message,
            ...(data.choices[0]!.finish_reason?{finishReason:data.choices[0]!.finish_reason}:{}),
            ...(data.usage?{rawUsage:data.usage as Record<string,unknown>}:{}),
            usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
            ...(Object.keys(extraUsage).length?{extraUsage}:{}),
          };
          record(
            'model.response',
            '模型接口响应',
            { usage: result.usage, message: result.message },
            { parentId: requestId, durationMs: Date.now() - started, status: 'completed' },
          );
          return middleware ? middleware.response(result, data.usage ?? {}, request) : result;
        } catch (error) {
          combined.throwIfAborted();
          if (
            attempt >= cfg.retries ||
            (error instanceof Error && 'retryable' in error && !error.retryable) ||
            error instanceof z.ZodError
          )
            throw error;
          await delay(Math.min(3000, 250 * 2 ** attempt), undefined, { signal: combined });
        }
      }
    };
    ctx.provide(modelService, {
      complete: async (messages, tools, signal, options) => {
        if (!options) return requestModel(messages, tools, signal);
        const cfg = config.get(),settings=config.effective(options.chatKey),
          selection = {...settings.modelSelection};
        if(options.temperature!=null)selection.temperature=options.temperature;
        if(options.thinkingMode)selection.thinkingMode=options.thinkingMode;
        const mediaApi=(settings.legacySession.api??{}) as Record<string,unknown>;
        const hasVideo=messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='video_url'));
        const hasImage=messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='image_url'));
        const mediaModel=hasVideo?(mediaApi.videoModel||mediaApi.visionModel):hasImage?mediaApi.visionModel:undefined;
        if(!options.overrides&&typeof mediaModel==='string'&&mediaModel.trim())selection.model=mediaModel.trim();
        if(options.purpose==='memory'&&!settings.memoryModel.useChatModel){selection.providerId=settings.memoryModel.providerId;selection.model=settings.memoryModel.model;selection.fallbacks=[];if(!selection.model)throw new Error('记忆整理的专用模型尚未配置');}
        const choices = [
          { providerId: selection.providerId, model: selection.model },
          ...(options.overrides?[]:selection.fallbacks),
        ];
        let last: unknown;
        for (const choice of choices) {
          signal.throwIfAborted();
          const provider = choice.providerId
            ? cfg.providers.find((p) => p.id === choice.providerId)
            : undefined;
          if (choice.providerId && !provider) {
            last = new Error('会话选择的模型渠道不存在');
            continue;
          }
          const api = {
            ...cfg.model,
            ...(provider ? { baseUrl: provider.baseUrl, apiKey: provider.apiKey } : {}),
            model: choice.model || cfg.model.model,
            timeoutMs: selection.timeoutMs,
            ...options.overrides,
          };
          try {
            const result = await requestModel(messages, tools, signal, api, selection, options);
            return {
              ...result,
              billing: {
                providerId: options.overrides?'':choice.providerId,
                model: api.model,
                currency: provider?.currency ?? 'USD',
                cost:
                  !options.overrides&&provider?.priceInputPerM != null && provider.priceOutputPerM != null
                    ? (result.usage.input * provider.priceInputPerM +
                        result.usage.output * provider.priceOutputPerM) /
                      1000000
                    : null,
              },
            };
          } catch (error) {
            signal.throwIfAborted();
            ctx.signal.throwIfAborted();
            last = error;
          }
        }
        throw last ?? new Error('没有可用的模型');
      },
    });
  },
});
