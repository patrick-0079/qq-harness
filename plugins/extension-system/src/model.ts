import type { ExtensionHost } from '@qq-harness/extension-compat';
import type { ModelMiddleware } from '@qq-harness/domain';

// 扩展只能贡献参数/转换/重试建议；真正联网、重试预算与取消仍由模型插件负责。
export function legacyModelMiddleware(host: ExtensionHost): ModelMiddleware {
  const manager = host.raw().skillManager;
  const providers = (name: string) => manager.getCapabilityProviders(name, {});
  const warn = (id: string, error: unknown) => manager.recordError(id, error);
  const middleware:ModelMiddleware={
    async request(input) {
      let api = { ...input.api };
      let accountId = '';
      try {
        const picked = input.context?.endpointOverride?undefined:providers('llm.endpoint-pick')[0]?.fn({ model: api.model });
        if (picked?.baseUrl) {
          api = {
            ...api,
            baseUrl: picked.baseUrl,
            apiKey: picked.apiKey || api.apiKey,
            model: picked.model || api.model,
          };
          accountId = picked.id ?? '';
        }
      } catch (error) {
        warn('llm.endpoint-pick', error);
      }
      let body: Record<string, unknown> = { ...input.body, model: api.model };
      for (const provider of providers('llm.request-params')) {
        try {
          const next = await provider.fn({
            body,
            api,
            model: api.model,
            messages: body.messages,
            tools: body.tools,
            context: {...input.context,api,model:api.model,messages:body.messages},
          });
          if (next && typeof next === 'object') {
            body = next.body ?? next;
            if (next.omitTemperature) delete body.temperature;
          }
        } catch (error) {
          warn(provider.skillId, error);
        }
      }
      return { ...input,api, body, accountId };
    },
    async response(result, rawUsage, input) {
      const legacy = {
        ...result,
        usage: {
          ...rawUsage,
          prompt_tokens: rawUsage.prompt_tokens ?? result.usage.input,
          completion_tokens: rawUsage.completion_tokens ?? result.usage.output,
        },
      };
      for (const provider of providers('llm.response')) {
        try {
          const next = await provider.fn({ result: legacy, api: input.api, model: input.api.model });
          if (next?.result) Object.assign(legacy, next.result);
        } catch (error) {
          warn(provider.skillId, error);
        }
      }
      const extra: Record<string, number> = {};
      for (const provider of providers('llm.usage')) {
        try {
          const next = await provider.fn({ result: legacy, usage: legacy.usage, api: input.api });
          for (const [key, value] of Object.entries(next ?? {}))
            extra[key] = (extra[key] ?? 0) + (Number(value) || 0);
        } catch (error) {
          warn(provider.skillId, error);
        }
      }
      return {
        ...result,
        message: legacy.message,
        usage: {
          input: Number(legacy.usage.prompt_tokens) || 0,
          output: Number(legacy.usage.completion_tokens) || 0,
        },
        ...(Object.keys(extra).length ? { extraUsage: {...result.extraUsage,...extra} } : {}),
      };
    },
    async retry(input, status, errorText) {
      for (const provider of providers('llm.retry-advisor')) {
        try {
          const next = await provider.fn({
            body: input.body,
            status,
            errorText,
            api: input.api,
            model: input.api.model,
          });
          if (next?.body) return next.body;
        } catch (error) {
          warn(provider.skillId, error);
        }
      }
    },
    feedback(input, result) {
      try {
        providers('llm.endpoint-feedback')[0]?.fn({ id: input.accountId, ...result });
      } catch (error) {
        warn('llm.endpoint-feedback', error);
      }
    },
  };
  const scope=(input:import('@qq-harness/domain').ModelRequest)=>input.context?.chatKey??'';
  return {
    request:input=>host.scoped(scope(input),()=>middleware.request(input)),
    response:(result,usage,input)=>host.scoped(scope(input),()=>middleware.response(result,usage,input)),
    retry:(input,status,error)=>host.scoped(scope(input),()=>middleware.retry(input,status,error)),
    feedback:(input,result)=>host.scoped(scope(input),()=>middleware.feedback(input,result)),
  };
}
