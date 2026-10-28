import { createHash } from 'node:crypto';
import { behaviorSchema,modelSelectionSchema,toolSettingsSchema,type ChatSettings } from '@qq-harness/contracts';
import { createCoreUtilities } from '../packages/legacy-core/generated/runtime.mjs';
const algorithms=createCoreUtilities({config:()=>({}),fetch:()=>{throw new Error('迁移不允许联网');},safeFetch:()=>{throw new Error('迁移不允许联网');}});
const object=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
/** 使用固定旧版纯函数规范化实际生效值；只改变存储形状，不改用户策略。 */
export function convertLegacySession(effective:Record<string,any>,global:Record<string,any>,chatKey:string):Partial<ChatSettings> {
 const session=algorithms.session.normalizeSessionConfig(algorithms.session.snapshotSessionConfig(effective));
 const store=object(session.store),api=object(session.api),peak=object(store.peakSchedule),policy=algorithms.trigger.replyPolicyForStore(store);
 const behavior=behaviorSchema.parse({
  enabled:true,reply:policy.reply,keywordRules:policy.rules,
  peakSchedule:{...peak,peak:{...object(peak.peak),reply:algorithms.trigger.peakReplyFor(peak.peak)??policy.reply}},
  historyCount:store.historyCount,markConditionMissRead:store.markConditionMissRead,maxPendingUnread:store.maxPendingUnread,promptAnchor:store.promptAnchor,
  chatActive:session.chatActive,proactive:session.proactive,
  blockedUsers:chatKey.startsWith('group:')?(object(session.blocklist)[chatKey.split(':')[1]!]??[]):[],
  run:{silencePolicy:session.run?.disposition==='off'?'allow':session.run?.disposition==='record'?'auto':'require',maxNudges:session.run?.maxNudges??3,retryAttempts:global.sessionRetryAttempts??2},
 });
 const rawRules=Array.isArray(effective.store?.keywordRules)?effective.store.keywordRules:[];
 behavior.keywordRules=behavior.keywordRules.map((rule,i)=>({...rule,id:rawRules[i]?.id || 'k_'+createHash('sha256').update(rule.mode+'\0'+rule.flags+'\0'+rule.pattern).digest('hex').slice(0,20)}));
 if(session.store)session.store.keywordRules=behavior.keywordRules;
 const providerId=api.provider||global.api?.provider||'';
 return {
  legacySession:session,behavior,tools:toolSettingsSchema.parse(session.tools??{}),
  online:session.availability?.online!==false,
  maxRounds:api.maxRounds??12,
  runTimeoutMs:session.run?.timeoutMs===0?0:(session.run?.timeoutMs??600000),
  silencePolicy:session.run?.disposition??'enforce',commandMute:session.commandMute??{enabled:true,command:'/安静',durationMin:30},
  memoryModel:{useChatModel:session.memory?.useChatModel!==false,providerId:session.memory?.provider??'',model:session.memory?.model??''},
  modelSelection:modelSelectionSchema.parse({providerId,model:api.model||global.api?.model||'',fallbacks:(api.fallbackModels??[]).map((v:Record<string,any>)=>({providerId:v.provider||providerId,model:v.model})),timeoutMs:api.timeoutMs,temperature:api.temperature,thinkingMode:api.thinkingMode,thinkingEffort:api.thinkingEffort==='off'?'':api.thinkingEffort,thinkingBudget:api.thinkingBudget}),
 };
}
