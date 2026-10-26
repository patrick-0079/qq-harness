import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { modelHttpHeadersSchema } from '@qq-harness/contracts';
import {
  configService,
  modelService,
  modelMiddleware,
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
    ctx.provide(modelService, {
      complete: async (messages, tools, signal) => {
        let middleware: ModelMiddleware | undefined;
        try {
          middleware = ctx.use(modelMiddleware);
        } catch {
          /* 可选的模型增强插件。 */
        }
        const base = config.get().model;
        let request = {
          api: base,
          body: {
            model: base.model,
            messages,
            ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
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
        for (let attempt = 0; ; attempt++) {
          ctx.assertActive();
          combined.throwIfAborted();
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
            const response = await fetch(url, {
              method: 'POST',
              headers,
              signal: combined,
              body: JSON.stringify(request.body),
            });
            if (!response.ok) {
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
              const error = new Error(`模型接口 HTTP ${response.status}`) as Error & { retryable: boolean };
              error.retryable = response.status === 429 || response.status >= 500;
              throw error;
            }
            const data = responseSchema.parse(await response.json());
            const raw = data.choices[0]!.message;
            const message: ModelMessage = { ...raw, content: raw.content ?? null };
            middleware?.feedback(request, { ok: true, status: response.status });
            const result = {
              message,
              usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
            };
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
      },
    });
  },
});
