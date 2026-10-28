import {z} from 'zod';
export const searchProviderSchema=z.object({
 id:z.string().min(1).max(100),name:z.string().max(100).default(''),type:z.enum(['openai','bing']).default('openai'),baseUrl:z.string().max(2000).default(''),apiKey:z.string().max(10000).default(''),model:z.string().max(200).default(''),count:z.number().int().min(1).max(50).default(6),timeoutMs:z.number().int().min(1000).max(180000).default(20000),
}).passthrough();
const remote=z.object({baseUrl:z.string().max(2000).optional(),apiKey:z.string().max(10000).optional(),model:z.string().max(200).optional(),engine:z.string().max(100).optional(),count:z.number().int().min(1).max(50).optional(),timeoutMs:z.number().int().min(1000).max(180000).optional()}).passthrough();
export const webSettingsSchema=z.object({enabled:z.boolean().default(true),provider:z.string().regex(/^(?:bing|deepseek|zhipu|bocha|baidu|metaso|custom(?::[A-Za-z0-9_-]+)?)$/).default('bing'),searchUrl:z.string().max(2000).default('https://cn.bing.com/search'),maxResults:z.number().int().min(1).max(10).default(6),deepseek:remote.optional(),zhipu:remote.optional(),bocha:remote.optional(),baidu:remote.optional(),metaso:remote.optional(),custom:remote.extend({type:z.enum(['openai','bing']).optional()}).optional(),providers:z.array(searchProviderSchema).max(100).default([])}).passthrough();
export type WebSettings=z.infer<typeof webSettingsSchema>;
export type SearchProvider=z.infer<typeof searchProviderSchema>;
