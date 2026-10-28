import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, test, vi } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { mockSnowluma } from './fixtures/snowluma.js';
import { adapterService, storageService, traceService } from '@qq-harness/domain';
import { publicFetch } from '@qq-harness/files';
const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();vi.restoreAllMocks();});
async function until(fn:()=>unknown){const end=Date.now()+5000;while(!fn()&&Date.now()<end)await new Promise(r=>setTimeout(r,5));expect(Boolean(fn())).toBe(true);}
test('网页抓取逐跳验证、解压 gzip，保留最终 URL，长页面可截断而非整次失败',async()=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/redirect'){res.writeHead(302,{location:'/page'});res.end();return;}
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-encoding':'gzip'});res.end(gzipSync('<title>测试页面</title>'+('中文正文'.repeat(20000))));
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanup.push(()=>new Promise<void>(r=>server.close(()=>r())));
  const url=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/redirect`,hops:string[]=[];
  await expect(publicFetch(url)).rejects.toThrow('内网');
  const response=await publicFetch(url,{allowPrivate:true,maxBytes:50000,truncate:true,allowUrl:url=>{hops.push(url.pathname);}});
  expect(hops).toEqual(['/redirect','/page']);expect(response.url).toContain('/page');expect(response.headers.get('x-harness-truncated')).toBe('true');
  expect(await response.text()).toContain('中文正文');expect(response.headers.get('content-encoding')).toBeNull();
  await expect(publicFetch(url,{allowPrivate:true,maxBytes:100})).rejects.toThrow('超过');
});
test('SnowLuma 协议 mock：搜索、抓网页、多级引用转发、过期图片刷新，图像实际进入专用模型',async()=>{
  const realFetch=globalThis.fetch;
  vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.hostname!=='127.0.0.1')throw new Error('测试禁止外部网络：'+url.hostname);return realFetch(input,init);});
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'harness-capabilities-'));cleanup.push(()=>{const full=fs.realpathSync(root);if(path.dirname(full)!==fs.realpathSync(os.tmpdir())||!path.basename(full).startsWith('harness-capabilities-'))throw new Error('清理越界');fs.rmSync(full,{recursive:true,force:true});});
  const snow=await mockSnowluma();cleanup.push(snow.close);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV9sAAAAASUVORK5CYII=','base64');
  const modelRequests:Record<string,any>[]=[],downloads:string[]=[],searches:string[]=[],pages:string[]=[];
  const ok=(data:unknown)=>({body:{status:'ok',retcode:0,data}});
  snow.actions.set('get_msg',({args})=>ok({group_id:1,message:args.message_id===-1?'[CQ:reply,id=-2]':args.message_id===-2?'[CQ:reply,id=-3]':'[CQ:forward,res_id=fresh-record]'}));
  snow.actions.set('get_forward_msg',({args})=>args.id==='fresh-record'?ok({data:{messages:[{type:'node',data:{name:'转发成员',uin:'22',content:'测试图片[CQ:image,file=qq-image,url=https://images.example.test/expired][CQ:forward,forward_id=nested-record]'}}]}}):{body:{status:'failed',retcode:100,message:'payload is empty'}});
  snow.actions.set('get_image',()=>ok({url:'https://images.example.test/fresh'}));
  snow.actions.set('v1/chat/completions',({args})=>{
    modelRequests.push(args);const round=modelRequests.length;
    const names=round===1?['web_search','web_fetch']:round===2?['read_forward']:round===3?['get_message_images']:['finish'];
    const parameters=round===1?[{query:'查一下 QQ 测试'},{url:'https://docs.example.test/page'}]:round===2?[{messageId:'-1'}]:round===3?[{messageId:'-1'}]:[{mode:'silent',silentReason:'协议测试完成，无需发送聊天'}];
    return {body:{choices:[{message:{role:'assistant',content:null,tool_calls:names.map((name,i)=>({id:`r${round}-${i}`,type:'function',function:{name,arguments:JSON.stringify(parameters[i])}}))}}],usage:{prompt_tokens:10,completion_tokens:5}}};
  });
  const app=await createApplication({dataDir:root,demo:false,allowedChats:['group:1'],v2Managers:false,extensionHotReload:false,
    initialConfig:{acceptAllSessions:false,admissions:['group:1'],model:{baseUrl:snow.config.httpUrl+'/v1',model:'chat-fixture',apiKey:'mock-only',retries:0},onebot:snow.config,defaults:{wakeDelayMs:0,legacySession:{api:{vision:true,visionModel:'vision-fixture'}}},send:{minIntervalMs:0},plugins:{'agent-memory':false,'sticker-tools':false,'image-studio':false,reminders:false}},
    web:{searchFetch:async(url)=>{searches.push(String(url));return new Response('<li data-extra="x" class=\'other b_algo\'><h2><a href="https://docs.example.test/page">测试结果</a></h2><p>测试摘要</p></li>');},pageFetch:async(url)=>{pages.push(url);return new Response('抓取正文',{headers:{'content-type':'text/html; charset=utf-8'}});}},
    media:{fetch:async(url)=>{downloads.push(url);return url.endsWith('/expired')?new Response('expired',{status:403}):new Response(png,{headers:{'content-type':'image/png'}});}},
  });cleanup.push(app.stop);
  await until(()=>app.runtime.use(adapterService).connected()&&snow.calls.some(c=>c.action==='get_login_info'));
  snow.push({post_type:'message',message_type:'group',self_id:888,user_id:2,group_id:1,message_id:-1,time:Date.now()/1000,sender:{nickname:'测试用户'},message:'[CQ:at,qq=888][CQ:reply,id=-2]'});
  await until(()=>app.runtime.use(storageService).archives().length);
  const archive=app.runtime.use(storageService).archives()[0]!;expect(archive.status).toBe('silent');expect(modelRequests).toHaveLength(4);
  expect(searches).toHaveLength(1);expect(pages).toEqual(['https://docs.example.test/page']);expect(downloads).toEqual(['https://images.example.test/expired','https://images.example.test/fresh']);
  expect(snow.calls.filter(c=>c.action==='get_msg').map(c=>c.args.message_id)).toEqual([-1,-2,-3]);
  expect(snow.calls.some(c=>c.action==='get_forward_msg'&&Number(c.args.message_id)<0)).toBe(false);
  const last=modelRequests[3]!;expect(last.model).toBe('vision-fixture');
  expect(last.messages.some((m:any)=>m.role==='user'&&Array.isArray(m.content)&&m.content.some((p:any)=>p.type==='image_url'&&p.image_url.url.startsWith('data:image/png;base64,')))).toBe(true);
  expect(last.messages.filter((m:any)=>m.role==='tool').every((m:any)=>typeof m.content==='string')).toBe(true);
  const results=app.runtime.use(traceService).get(archive.id)!.events.filter(e=>e.kind==='tool.result');expect(results).toHaveLength(5);expect(results.every(e=>e.status==='completed')).toBe(true);
  expect(snow.calls.some(c=>c.action.startsWith('send_'))).toBe(false);
});
