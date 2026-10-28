import { liveScope } from './live-scope.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import sharp from 'sharp';
import { createApplication } from '../apps/server/src/app.js';
import { configSchema,textContent,messageSegments } from '@qq-harness/contracts';
import { adapterService,configService,outboundService,storageService,toolService,modelService,type ToolContext } from '@qq-harness/domain';
import { deepMerge,writeJsonAtomic } from '@qq-harness/files';
// Manual, explicitly authorized live test. Never included in npm test/e2e.
if(!process.argv.includes('--live'))throw new Error('只供已授权的人工联调；必须显式传 --live');
const root=fileURLToPath(new URL('../',import.meta.url));
const { allowedChats: allowed, groupId } = liveScope();
const input=JSON.parse(fs.readFileSync(path.join(root,'var/production/config.json'),'utf8'));
const reference=JSON.parse(fs.readFileSync(path.join(root,'../backup/source/data/config.json'),'utf8'));
const reuse=process.argv.find(arg=>arg.startsWith('--reuse='))?.slice(8);
const dataDir=reuse?path.resolve(root,reuse):path.join(root,'var','live-capability-audit-'+Date.now());
if(path.dirname(dataDir)!==path.join(root,'var')||!/^live-capability-audit-\d+$/.test(path.basename(dataDir)))throw new Error('联调目录必须是 var 内独立测试目录');
const cfg=configSchema.parse(deepMerge(input,{acceptAllSessions:false,admissions:allowed,profiles:{},legacyGlobal:reference,defaults:{online:false,legacySession:{api:reference.api},tools:{enabled:true,crossChatSend:false}},plugins:{'agent-memory':false,reminders:false,'command-direct':false,'external-plugins':false,'sticker-tools':false,'image-studio':false},snowluma:{autoStart:false},send:{minIntervalMs:1500,dedupeMs:15000,perMinute:10}}));
cfg.profiles={};cfg.defaults.modelSelection={...cfg.defaults.modelSelection,providerId:'',model:cfg.model.model,fallbacks:[]};
cfg.defaults.legacySession.api={...reference.api,vision:true};
writeJsonAtomic(path.join(dataDir,'config.json'),cfg);
const evidence:{at:string;scope:string[];productionChanged:boolean;checks:Record<string,unknown>[]}={at:new Date().toISOString(),scope:allowed,productionChanged:false,checks:[]};
const record=(name:string,passed:boolean,details:Record<string,unknown>={})=>{const item={name,passed,...details};evidence.checks.push(item);console.log(JSON.stringify(item));};
let app:Awaited<ReturnType<typeof createApplication>>|undefined;
try{
  app=await createApplication({dataDir,demo:false,allowedChats:allowed,extensionHotReload:false,v2Managers:false,snowluma:{allowLaunch:false},qqPortable:{allowLaunch:false},plugins:[{id:'manual-capability-verification',requires:[toolService.id,outboundService.id,modelService.id],setup(ctx){ctx.mode({id:'verify.capabilities',input:z.object({chatKey:z.enum(allowed)}),async execute(run,{chatKey}){
    const tools=ctx.use(toolService),storage=ctx.use(storageService),adapter=ctx.use(adapterService),outbound=ctx.use(outboundService);
    const c:ToolContext={run,chatKey,settings:ctx.use(configService).effective(chatKey),sent:0,trace:()=>{}};
    const call=async(name:string,args:unknown)=>tools.execute(c,name,JSON.stringify(args));
    const check=async(name:string,fn:()=>Promise<Record<string,unknown>>)=>{try{const data=await fn();record(name,true,{chatKey,...data});}catch(error){record(name,false,{chatKey,error:String(error).replace(/https?:\/\/\S+/g,'[URL]').slice(0,500)});}};
    if(chatKey.startsWith('private:')){
      await check('web_search',async()=>{const r=await call('web_search',{query:'QQ 官方网站'}) as any;if(r.isError||!r.results?.length)throw new Error(r.error??JSON.stringify(r).slice(0,300));return {results:r.results.length};});
      await check('web_fetch',async()=>{const r=await call('web_fetch',{url:'https://example.com'}) as any;if(r.isError||!r.content?.includes('Example Domain'))throw new Error(r.error??'正文不符合测试页面');return {status:r.statusCode,characters:r.content.length};});
    }
    const image=await sharp(Buffer.from('<svg width="480" height="240"><rect width="240" height="240" fill="#ff0000"/><rect x="240" width="240" height="240" fill="#0000ff"/></svg>')).png().toBuffer();
    const file='base64://'+image.toString('base64');
    let imageId='';
    await check('image-delivery-and-read',async()=>{
      const existing=storage.messages(chatKey).find(m=>m.self&&m.text==='[功能联调] 图片读取测试，无需回复');
      const sent=existing??await outbound.sendPayload(run,chatKey,'[功能联调] 图片读取测试，无需回复',{segments:[{type:'image',data:{file}}]});imageId=sent.id;
      const recorded=storage.messages(chatKey).find(m=>m.id===imageId)!;
      // A protocol may omit URLs for a just-sent image. Preserve its known source
      // instead of replacing it with empty get_msg fields.
      let remoteLoaded=false;
      try{const actual=await adapter.query('get_msg',{message_id:Number(imageId)},run.signal) as any;const parts=messageSegments(actual.message??actual.raw_message);if(parts.some(p=>p.type==='image'&&(p.data.url||p.data.file))){storage.updateMessage?.(chatKey,recorded.localId,{metadata:{segments:parts}});remoteLoaded=true;}}catch{}
      if(!remoteLoaded)storage.updateMessage?.(chatKey,recorded.localId,{metadata:{outbound:{segments:[{type:'image',data:{file}}]}}});
      const r=await call('get_message_images',{messageId:imageId}) as any;if(r.isError||!Array.isArray(r.content)||!r.content.some((p:any)=>p.type==='image_url'))throw new Error(r.error??'未返回图像部件');
      const result=await ctx.use(modelService).complete([{role:'user',content:[{type:'text',text:'请只描述图中左、右两部分各自的颜色。'},...r.content.filter((p:any)=>p.type==='image_url')]}],[],run.signal,{chatKey,runId:run.id});
      const answer=textContent(result.message.content);if(!(/红|red/i.test(answer)&&/蓝|blue/i.test(answer)))throw new Error('视觉模型未正确识别控制图片');
      return {modelRecognized:true,imageParts:r.content.filter((p:any)=>p.type==='image_url').length,source:remoteLoaded?'qq-url':'recorded-outbound-bytes'};
    });
    await check('read_forward-and-contained-image',async()=>{
      let sent=storage.messages(chatKey).find(m=>m.self&&m.text.startsWith('[合并转发')||m.self&&m.text==='[功能联调] 合并转发读取测试');
      if(!sent){const own=await adapter.query('get_login_info',{},run.signal) as any;
        const prepared=await adapter.query('upload_forward_msg',{messages:[{type:'node',data:{name:'QQ Harness 功能联调',uin:String(own.user_id),content:[{type:'text',data:{text:'合并转发读取测试，无需回复'}}]}}],group_id:Number(groupId)},run.signal) as any;
        const id=prepared.res_id??prepared.forward_id;if(!id)throw new Error('协议端未返回转发资源编号');
        const output=await outbound.sendPayload(run,chatKey,'[功能联调] 合并转发读取测试',{segments:[{type:'forward',data:{id}}]});sent=storage.messages(chatKey).find(m=>m.id===output.id)!;
      }
      const r=await call('read_forward',{messageId:sent.id,refresh:true}) as any;if(r.isError||!r.messages?.length)throw new Error(r.error??'没有转发节点');
      if(r.images){const images=await call('get_message_images',{messageId:sent.id}) as any;if(images.isError||!images.content?.some((p:any)=>p.type==='image_url'))throw new Error(images.error??'转发中的图片未能加载');}
      return {nodes:r.count,images:r.images,mediaVerification:r.images?'QQ 协议图片已加载':'本测试记录仅验收转发文本'};
    });
    return {checks:evidence.checks.filter(c=>c.chatKey===chatKey).length};
  }});}}]});
  const end=Date.now()+15000;while(!app.runtime.use(adapterService).connected()&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
  if(!app.runtime.use(adapterService).connected())throw new Error('OneBot 连接未就绪');
  for(const chatKey of allowed){const run=app.runtime.submit({mode:'verify.capabilities',partitionKey:chatKey,input:{chatKey},timeoutMs:180000});const result=await app.runtime.wait(run.id);if(result.status!=='completed')record('verification-run',false,{chatKey,error:result.error});}
}finally{await app?.stop();writeJsonAtomic(path.join(dataDir,'evidence.json'),evidence);console.log(JSON.stringify({evidence:path.join(dataDir,'evidence.json'),passed:evidence.checks.filter(c=>c.passed).length,total:evidence.checks.length}));}
