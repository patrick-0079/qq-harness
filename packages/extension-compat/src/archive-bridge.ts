import type {Archive,RunDetail} from '@qq-harness/contracts';
/** Preserve recorded accounting. Missing historical payloads are never invented. */
export function legacyArchive(archive:Archive,detail?:RunDetail,includePayload=false){
 const legacy=archive.legacy&&typeof archive.legacy==='object'?archive.legacy as Record<string,any>:{};
 const responseEvents=detail?.events.filter(e=>e.kind==='model.response')??[],rounds=responseEvents.filter(e=>/^第 \d+ 轮/.test(e.title));
 const usage={promptTokens:archive.usage.input,completionTokens:archive.usage.output,totalTokens:archive.usage.input+archive.usage.output,cachedTokens:archive.usage.extra?.cached_tokens??archive.usage.extra?.prompt_cache_hit_tokens??0,calls:archive.usage.models?.length??legacy.usage?.calls??(rounds.length||responseEvents.length)};
 const messages:Record<string,unknown>[]=[];
 for(const event of detail?.events??[]){
  const data=event.data as any;
  if(event.kind==='model.response'&&(!rounds.length||rounds.includes(event)))messages.push({role:'assistant',content:data?.message?.content??data?.response?.message?.content??null});
  if(event.kind==='tool.result')messages.push({toolCall:{name:data?.name??event.title,args:data?.args??{},result:typeof data?.result==='string'?data.result:JSON.stringify(data?.result??data??''),isError:event.status==='failed'||data?.isError===true}});
 }
 return {...(includePayload?legacy:{}),id:archive.id,chatKey:archive.chatKey,startedAt:archive.startedAt,endedAt:archive.endedAt,status:archive.status,model:archive.usage.models?.[0]?.model??legacy.model??'',usage,messages:includePayload?(detail?messages:legacy.messages??[]):[],payloadAvailable:includePayload&&Boolean(detail||legacy.messages),recordedCost:archive.usage.models?.length&&archive.usage.models.every(m=>m.cost!==null&&m.currency==='CNY')?archive.usage.models.reduce((sum,m)=>sum+(m.cost??0),0):null};
}
export function todayAccounting(archives:Archive[],now=Date.now()){
 const start=new Date(now);start.setHours(0,0,0,0);const rows=archives.filter(a=>a.startedAt>=start.getTime()&&a.startedAt<=now),normalized=rows.map(a=>legacyArchive(a));
 const usage=normalized.reduce((sum,row)=>({promptTokens:sum.promptTokens+row.usage.promptTokens,completionTokens:sum.completionTokens+row.usage.completionTokens,totalTokens:sum.totalTokens+row.usage.totalTokens,cachedTokens:sum.cachedTokens+row.usage.cachedTokens,runs:sum.runs+1}),{promptTokens:0,completionTokens:0,totalTokens:0,cachedTokens:0,runs:0});
 const known=normalized.filter(a=>a.recordedCost!==null),cost=known.reduce((sum,a)=>sum+(a.recordedCost??0),0);
 return {usage,cost:{cost,peakCost:0,offPeakCost:cost,exact:known.length===rows.length,sessions:rows.length,unavailable:known.length<rows.length,missingCostSessions:rows.length-known.length}};
}
