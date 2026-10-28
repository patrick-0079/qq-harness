import {expect,test} from 'vitest';import {legacyArchive,todayAccounting} from '../packages/extension-compat/src/archive-bridge.js';import type {Archive,RunDetail} from '@qq-harness/contracts';
test('统计桥使用真实用量，索引不暴露旧提示词；详情缺失和未知计费明确保留不可用状态',()=>{
 const now=Date.now(),archive:Archive={id:'a',chatKey:'group:1',startedAt:now-1000,endedAt:now,status:'completed',sent:1,trace:[],usage:{input:100,output:20,extra:{cached_tokens:40},models:[{providerId:'p',model:'chat',input:100,output:20,cost:null,currency:'USD'}]},legacy:{prompt:'秘密上下文',messages:[{content:'历史原文'}]}};
 expect(JSON.stringify(legacyArchive(archive))).not.toContain('秘密上下文');expect(legacyArchive(archive).payloadAvailable).toBe(false);expect(legacyArchive(archive,undefined,true)).toMatchObject({prompt:'秘密上下文',payloadAvailable:true});
 expect(todayAccounting([archive],now)).toMatchObject({usage:{promptTokens:100,completionTokens:20,cachedTokens:40,runs:1},cost:{exact:false,unavailable:true,missingCostSessions:1}});
 const paid={...archive,usage:{...archive.usage,models:[{providerId:'p',model:'chat',input:100,output:20,cost:0.1,currency:'CNY'}]}};expect(todayAccounting([paid],now).cost).toMatchObject({exact:true,unavailable:false,cost:0.1});
 const detail:RunDetail={version:1,id:'a',chatKey:'group:1',startedAt:now,status:'completed',expiresAt:now+1000,events:[{id:'m',sequence:1,at:now,kind:'model.response',title:'模型接口响应'},{id:'n',sequence:2,at:now,kind:'model.response',title:'第 1 轮模型输出'},{id:'t',sequence:3,at:now,kind:'tool.result',title:'web_search',data:{args:{query:'示例'},result:{content:'结果'}}}]};
 const full=legacyArchive(archive,detail,true);expect(full.usage.calls).toBe(1);expect(full.messages).toHaveLength(2);expect(full.messages[1]).toMatchObject({toolCall:{name:'web_search',args:{query:'示例'}}});
});
