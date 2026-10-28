import { z } from 'zod';
import {Hono} from 'hono';
import {webSettingsSchema} from '@qq-harness/contracts';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { configService, storageService, toolService, webService,httpService,networkProxyService } from '@qq-harness/domain';
import { publicFetch,configuredFetch,browseGuard,redactConfigTree,redactKnownSecrets,restoreMaskedSecrets } from '@qq-harness/files';
import { createCoreUtilities } from '../../../packages/legacy-core/generated/runtime.mjs';
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
export function createWebTools(network:{searchFetch?:typeof fetch;pageFetch?:typeof publicFetch}={}){return definePlugin({
  id: 'web-tools',
  name: '联网搜索、页面抓取与日历',
  requires: [configService.id, storageService.id, toolService.id,httpService.id],
  setup(ctx) {
    const config = ctx.use(configService),
      storage = ctx.use(storageService),
      tools = ctx.use(toolService);
    const proxy = () => {
      let transport; try { transport = ctx.use(networkProxyService); } catch { /* Optional proxy provider. */ }
      return transport?.get();
    };
    const utilities = (signal: AbortSignal) =>
      createCoreUtilities({
        config: () => config.get().legacyGlobal,
        fetch: (url, options = {}) =>
          (network.searchFetch??((input,init)=>configuredFetch(input,init,proxy())))(url, {
            ...options,
            signal: AbortSignal.any([ctx.signal, signal, ...(options.signal ? [options.signal] : [])]),
          }),
        safeFetch: async (url, options = {}) => {
          const guard=options.browseLocked?browseGuard(config.get().legacyGlobal.security):undefined;
          const response = await (network.pageFetch??publicFetch)(url, {
            signal: AbortSignal.any([ctx.signal, signal]),
            maxBytes: 200000,
            truncate: true,
            allowUrl: guard,
            proxy: proxy()?.webFetch === false ? undefined : proxy(),
          });
          const bytes=await response.arrayBuffer(),charset=response.headers.get('content-type')?.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]??'utf-8';
          let body:string;try{body=new TextDecoder(charset).decode(bytes);}catch{body=new TextDecoder().decode(bytes);}
          return {
            url:response.url||url,
            statusCode: response.status,
            truncated: response.headers.get('x-harness-truncated')==='true'||body.length > 50000,
            body: body.slice(0, 50000),
          };
        },
      });
    const available = () => obj(config.get().legacyGlobal.webSearch).enabled !== false;
    ctx.provide(webService, {
      search: (query, signal) => utilities(signal).web.webSearch(query),
      fetch: (url, signal, browseLocked = false) => utilities(signal).web.webFetch(url, { browseLocked }),
      images: (query, limit, signal) => utilities(signal).web.searchImages(query, { limit,browseLocked:true }),
    });
    ctx.mode({id:'web.test',input:z.object({query:z.string().trim().min(1).max(2000)}),async execute(run,{query}){return ctx.use(webService).search(query,run.signal);}});
    const api=new Hono();
    api.onError((error,c)=>c.json({error:{message:error instanceof z.ZodError?'搜索设置参数无效':redactKnownSecrets(error.message,config.get())}},400));
    api.get('/api/web/settings',c=>c.json(redactConfigTree(webSettingsSchema.parse(config.get().legacyGlobal.webSearch??{}))));
    api.patch('/api/web/settings',async c=>{
      const raw=await c.req.json(),parsed=webSettingsSchema.partial().parse(raw);
      const patch=Object.fromEntries(Object.entries(parsed).filter(([key])=>Object.hasOwn(raw,key)));
      const restored=restoreMaskedSecrets(patch,config.get().legacyGlobal.webSearch??{});
      config.patch({legacyGlobal:{webSearch:restored}});
      return c.json(redactConfigTree(webSettingsSchema.parse(config.get().legacyGlobal.webSearch??{})));
    });
    api.post('/api/web/test',async c=>{
      const body=z.object({query:z.string().trim().min(1).max(2000)}).parse(await c.req.json());
      const run=ctx.host.submit({mode:'web.test',partitionKey:'admin:web-test',input:body,timeoutMs:60000});
      const result=await ctx.host.wait(run.id);
      if(result.status!=='completed')return c.json({error:{message:redactKnownSecrets(result.error??'搜索测试未完成',config.get())},runId:run.id},409);
      return c.json({runId:run.id,result:result.result});
    });
    ctx.effect(ctx.use(httpService).register('/api/web',(request)=>api.fetch(request)));
    tools.register(ctx, {
      name: 'web_search',
      displayName: '联网搜索',
      category: 'web',
      description: '使用配置的搜索服务查找网页，返回标题、链接和摘要。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
      available,
      parse: (a) => z.object({ query: z.string().min(1).max(2000) }).parse(a),
      execute: async (c, a) => ctx.use(webService).search((a as { query: string }).query, c.run.signal),
    });
    tools.register(ctx, {
      name: 'web_fetch',
      displayName: '读取网页',
      category: 'web',
      description: '抓取 HTTP(S) 网页正文，执行 URL、重定向及内网访问检查。',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' } },
        required: ['url'],
        additionalProperties: false,
      },
      available,
      parse: (a) => z.object({ url: z.url() }).parse(a),
      execute: async (c, a) => {
        const result=await ctx.use(webService).fetch((a as { url: string }).url,c.run.signal,true),data=obj(result),body=String(data.body??data.content??data.text??'');
        return {...data,body:undefined,content:body.slice(0,20000),truncated:data.truncated===true||body.length>20000};
      },
    });
    tools.register(ctx, {
      name: 'search_images',
      displayName: '搜索图片',
      category: 'web',
      description: '从配置的多图源搜索图片，返回可供 send_image 使用的原始地址。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'integer' } },
        required: ['query'],
        additionalProperties: false,
      },
      available,
      parse: (a) =>
        z
          .object({ query: z.string().min(1).max(2000), limit: z.number().int().min(1).max(30).default(8) })
          .parse(a),
      execute: async (c, a) => {
        const v = a as { query: string; limit: number };
        const images=await ctx.use(webService).images(v.query, v.limit, c.run.signal);
        return {query:v.query,count:Array.isArray(images)?images.length:0,images};
      },
    });
    tools.register(ctx, {
      name: 'check_holiday',
      displayName: '查询节日',
      category: 'system',
      description: '查询今天或未来若干天最近的中国常见节日，days=0只查今天。',
      parameters: { type: 'object', properties: { days: { type: 'number' } } },
      parse: (a) => z.object({ days: z.number().min(0).default(7) }).parse(a),
      execute: async (_c, a) => {
        const days = (a as { days: number }).days;
        const calendar = utilities(ctx.signal).calendar;
        const today=calendar.holidayOn();
        return {today,upcoming:days===0?(today?{...(today as object),date:new Date().toLocaleDateString('sv-SE'),daysAway:0}:null):calendar.upcomingHoliday(Math.min(366,Math.floor(days))),note:today?'今天是节日，可自然表达祝福。':'可参考最近的节日安排，不要编造节日。'};
      },
    });
    tools.register(ctx, {
      name: 'report_feedback',
      displayName: '记录运行反馈',
      category: 'system',
      description: '向本地管理控制台记录问题、警告或建议，不发送到其他聊天。',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          level: { type: 'string', enum: ['info', 'warning', 'error'] },
        },
        required: ['message'],
      },
      parse: (a) =>
        z
          .object({
            message: z.string().min(1).max(4000),
            level: z.enum(['info', 'warning', 'error']).default('info'),
          })
          .parse(a),
      execute: async (c, a) => {
        const previous = storage.state('feedback', 'items');
        const item = { ...(a as object), chatKey: c.chatKey, runId: c.run.id, at: Date.now() };
        storage.setState('feedback', 'items', [
          ...(Array.isArray(previous) ? previous : []).slice(-199),
          item,
        ]);
        ctx.host.publish('feedback.created', { chatKey: c.chatKey });
        return { reported:true,recorded: true };
      },
    });
  },
});}
export const webTools=createWebTools();
