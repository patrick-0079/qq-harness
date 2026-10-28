import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import { configService,memoryService,storageService,toolService,memberMemoryService } from '@qq-harness/domain';
export function registerMemberMemory(ctx:PluginContext) {
 const tools=ctx.use(toolService),memory=ctx.use(memoryService),storage=ctx.use(storageService),config=ctx.use(configService);
 const members:import('@qq-harness/domain').MemberMemoryService={
  query:(chatKey,userId)=>{
   const order={short:0,medium:1,long:2};
   const records=memory.list(chatKey,userId).filter(r=>r.personId).sort((a,b)=>order[a.tier]-order[b.tier]);
   const unique=new Map<string,typeof records[number]>();for(const r of records){const id=r.factId??`${r.scope}:${r.personId}:${r.key}`;if(!unique.has(id))unique.set(id,r);}
   return [...unique.values()].map(r=>({id:r.id,userId:r.personId!,target:r.personName||storage.messages(chatKey).findLast(m=>m.senderId===r.personId)?.senderName||r.personId!,content:r.text,tier:r.tier,revision:r.revision}));
  },
  append:(chatKey,v)=>{
   const messages=storage.messages(chatKey).filter(m=>m.senderId===v.userId).slice(-3);
   const key=`memberImpression:${v.userId}:`+createHash('sha256').update(v.content).digest('hex').slice(0,24);
   const prior=memory.list(chatKey,v.userId).find(r=>r.key===key&&r.text===v.content);if(prior)return prior;
   return memory.remember({scope:'chat_person',tier:'short',chatKey,personId:v.userId,personName:v.target||messages.at(-1)?.senderName||v.userId,key,text:v.content,visibility:'chat_only',sensitive:false,confidence:.65,importance:.5,pinned:false,sources:messages.map(m=>({chatKey,localId:m.localId,senderId:m.senderId})),origin:'agent',expiresAt:Date.now()+config.effective(chatKey).memory.shortRetentionMs});
  },
  remove:(chatKey,v)=>{
   const selected=members.query(chatKey,v.userId).filter(r=>(v.userId||!v.target||r.target===v.target)&&(!v.content||r.content===v.content));let removed=0;
   for(const value of selected){const record=memory.list(chatKey,value.userId).find(r=>r.id===value.id);if(record?.scope==='chat_person'&&record.chatKey===chatKey){memory.remove(record.id,record.revision);removed++;}}
   return removed;
  },
 };
 ctx.provide(memberMemoryService,members);
 const member=z.object({category:z.literal('memberImpression'),userId:z.string().regex(/^[1-9]\d*$/),target:z.string().max(100).optional(),content:z.string().trim().min(1).max(120)}).strict();
 const append=z.union([member,z.object({text:z.string().trim().min(1).max(4000)}).strict()]);
 tools.register(ctx,{name:'memory_append',displayName:'记录成员印象',category:'memory',description:'记录当前会话成员的稳定印象。使用 category=memberImpression、userId、content（最多120字），target 可填昵称。写入短期记忆，随后按三层规则整理。',parameters:z.toJSONSchema(member),parse:a=>append.parse(a),execute:async(c,a)=>{
  const v=a as z.infer<typeof append>;
  if('text' in v) {
   const note=memory.note(c.chatKey,v.text);
   return {saved:true,noteId:note.id,status:'pending',message:'已保存笔记，等待短期整理'};
  }
  const record=members.append(c.chatKey,v);
  if ('instruction' in record) return {requestId:record.id,status:record.status};
  return {saved:true,id:record.id,tier:record.tier,entry:{userId:record.personId,target:record.personName,content:record.text}};
 }});
 const query=z.object({userId:z.string().regex(/^[1-9]\d*$/).optional()}).strict();
 tools.register(ctx,{name:'memory_query',displayName:'查询会话与成员记忆',category:'memory',description:'查询当前会话的有效三层记忆，可按 userId 筛选成员；短期事实优先，隐藏已更正及删除的版本。',parameters:z.toJSONSchema(query),parse:a=>query.parse(a),execute:async(c,a)=>{
  const records=memory.list(c.chatKey,(a as z.infer<typeof query>).userId);
  return {memberImpression:members.query(c.chatKey,(a as z.infer<typeof query>).userId),content:records.map(r=>r.text).join('\n'),records:records.map(r=>({id:r.id,userId:r.personId,key:r.key,content:r.text,tier:r.tier,revision:r.revision}))};
 }});
 const remove=z.object({category:z.literal('memberImpression'),userId:z.string().regex(/^[1-9]\d*$/).optional(),target:z.string().trim().min(1).max(100).optional(),content:z.string().trim().min(1).max(120).optional()}).strict();
 tools.register(ctx,{name:'memory_remove',displayName:'删除成员印象',category:'memory',description:'删除当前会话成员印象，userId 优先，或按 target 名称。content 可限定一条，不提供条件则删除本会话全部成员印象；删除立即停止检索，并按三层规则传播。',parameters:z.toJSONSchema(remove),parse:a=>remove.parse(a),execute:async(c,a)=>{
  const v=a as z.infer<typeof remove>;
  return {removed:members.remove(c.chatKey,v)};
 }});
}
