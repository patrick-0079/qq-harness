import { liveScope } from './live-scope.js';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {createApplication} from '../apps/server/src/app.js';
import {adapterService,configService,storageService,toolService,modelService,type ToolContext} from '@qq-harness/domain';
import {textContent} from '@qq-harness/contracts';
import {writeJsonAtomic} from '@qq-harness/files';
if(!process.argv.includes('--live'))throw new Error('需要 --live，仅用于用户明确授权的 QQ 私聊');
const root=fileURLToPath(new URL('../',import.meta.url)),dataDir=path.join(root,'var/live-capability-audit-1793069514509');
const { allowedChats } = liveScope();
const key = allowedChats[0], evidence: Record<string, unknown>[] = [];
const app=await createApplication({dataDir,demo:false,allowedChats:[...allowedChats],extensionHotReload:false,v2Managers:false,snowluma:{allowLaunch:false},qqPortable:{allowLaunch:false},plugins:[{id:'live-input-check',requires:[toolService.id],setup(ctx){ctx.mode({id:'live.input',input:z.object({action:z.enum(['instructions','check']),id:z.string().optional()}),async execute(run,{action,id}){
  const storage=ctx.use(storageService),tools=ctx.use(toolService),c:ToolContext={run,chatKey:key,settings:ctx.use(configService).effective(key),sent:0,trace:()=>{}};
  const call=(name:string,args:unknown)=>tools.execute(c,name,JSON.stringify(args));
  if(action==='instructions')return call('send_message',{messages:[
    '【qq-harness 联调】请在这个私聊依次发：① 一张清晰图片，里面有可辨认的物体或文字；② 一条合并转发，包含至少两条消息和一张图片，方便的话再套一层转发；③ 引用/回复这条合并转发，发送“测试读转发”。',
    '搜索和网页抓取我已经自行测通，不用重复发指令。你发来的图片、转发和引用只用于这次功能验收，我会在这里报告读取结果。',
  ]});
  const m=storage.messages(key).find(m=>m.id===id);if(!m)throw new Error('当前私聊找不到测试消息');
  const parts=(m.metadata?.segments??[]) as {type:string}[];
  const item:Record<string,unknown>={messageId:m.id,at:new Date().toISOString(),types:parts.map(p=>p.type)};
  if(parts.some(p=>p.type==='forward'||p.type==='reply')){
    const result=await call('read_forward',{messageId:m.id,refresh:true}) as any;item.forward=!result.isError&&Boolean(result.messages?.length);item.nodes=result.count;item.images=result.images;if(result.isError)item.error=result.error;
    if(item.forward){for(const ref of (result.nested??[]).slice(0,3)){const nested=await call('read_forward',{recordId:ref.recordId}) as any;item.nestedRead=(Number(item.nestedRead)||0)+(nested.isError?0:1);if(!nested.isError)item.images=Number(item.images??0)+Number(nested.images??0);}}
  }
  if(parts.some(p=>p.type==='image')||Number(item.images)>0){
    const result=await call('get_message_images',{messageId:m.id}) as any,images=result.content?.filter((p:any)=>p.type==='image_url')??[];
    item.imageLoaded=images.length;item.imageError=result.error;
    if(images.length){const response=await ctx.use(modelService).complete([{role:'user',content:[{type:'text',text:'这是人工功能联调。请用一句简短中文，描述图片中实际可见的主要物体或文字，不要猜测身份。'},...images]}],[],run.signal,{chatKey:key,runId:run.id});const description=textContent(response.message.content);item.visionCalled=true;item.descriptionLength=description.length;await call('send_message',{messages:[`【读图结果】${description}`]});}
  }
  if(item.forward)await call('send_message',{messages:[`【转发读取】已读取 ${item.nodes} 条节点，图片 ${item.images??0} 张${item.nestedRead?`，已向下展开 ${item.nestedRead} 条嵌套记录`:''}。`]});
  if(item.error||item.imageError)await call('send_message',{messages:['【联调状态】这条记录暂未完整读取成功，我正在检查具体原因。']});
  evidence.push(item);console.log(JSON.stringify(item));writeJsonAtomic(path.join(dataDir,'incoming-evidence.json'),evidence);return item;
}});}}]});
try{
 const end=Date.now()+15000;while(!app.runtime.use(adapterService).connected()&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 const submit=async(action:'instructions'|'check',id?:string)=>{const run=app.runtime.submit({mode:'live.input',partitionKey:key,input:{action,id},timeoutMs:120000});return app.runtime.wait(run.id);};
 const seen=new Set(app.runtime.use(storageService).messages(key).map(m=>m.id));
 if(process.argv.includes('--instructions')){const sent=await submit('instructions');console.log(JSON.stringify({instructions:sent.status}));}
 const until=Date.now()+10*60000;
 console.log(JSON.stringify({listening:true,scope:key,minutes:10}));
 while(Date.now()<until){
  const list=app.runtime.use(storageService).messages(key).filter(m=>!m.self&&!seen.has(m.id));
  for(const m of list){seen.add(m.id);if((m.metadata?.segments as any[])?.some(p=>['image','forward','reply'].includes(p.type)))await submit('check',m.id);}
  if(evidence.length>=3)break;
  await new Promise(r=>setTimeout(r,500));
 }
}finally{await app.stop();console.log(JSON.stringify({stopped:true,checks:evidence.length}));}
