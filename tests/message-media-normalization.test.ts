import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';
import {messageSegments,segmentText} from '@qq-harness/contracts';
import {normalizeOneBot} from '../plugins/adapter-onebot/src/normalize.js';
import {createApplication} from '../apps/server/src/app.js';
import {adapterService,storageService,configService,toolService,type ToolContext} from '@qq-harness/domain';
const apps:Awaited<ReturnType<typeof createApplication>>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.stop();vi.restoreAllMocks();});
test('CQ 字符串和数组均保留图片、引用与 @，实体只解码一次，不把转义后的文字误作消息段',()=>{
 const parts=messageSegments('文字&#91;[CQ:reply,id=-3][CQ:at,qq=10][CQ:image,file=x,url=https://example.test/a?x=1&amp;y=2&#44;3]');
 expect(parts).toEqual([{type:'text',data:{text:'文字['}},{type:'reply',data:{id:'-3'}},{type:'at',data:{qq:'10'}},{type:'image',data:{file:'x',url:'https://example.test/a?x=1&y=2,3'}}]);
 expect(segmentText(parts)).toContain('[图片]');expect(messageSegments('&#91;CQ:image,file=x&#93;')).toEqual([{type:'text',data:{text:'[CQ:image,file=x]'}}]);
 expect(messageSegments('[CQ:bad,constructor=attack,__proto__=attack]')[0]?.data).toEqual({});
 expect(normalizeOneBot({post_type:'message',message_type:'group',message_id:-1,group_id:1,user_id:2,self_id:10,message:'[CQ:at,qq=10][CQ:image,file=x]'})).toMatchObject({atMe:true,text:'@10[图片]',metadata:{segments:expect.any(Array)}});
 expect(normalizeOneBot({post_type:'message',message_type:'group',message_id:1,user_id:2,message:'x'})).toBeUndefined();
});
test('拍自己才进入 @／拍一拍渠道；自己的通知、其他人的通知与不完整事件不触发聊天',()=>{
 const poke={post_type:'notice',notice_type:'notify',sub_type:'poke',self_id:10,user_id:2,target_id:10,group_id:1,time:1};
 expect(normalizeOneBot(poke)).toMatchObject({chatKey:'group:1',senderId:'2',atMe:true,metadata:{poke:true}});
 expect(normalizeOneBot({...poke,target_id:3})).toBeUndefined();expect(normalizeOneBot({...poke,user_id:10})).toBeUndefined();
 expect(normalizeOneBot({...poke,group_id:undefined})).toMatchObject({chatKey:'private:2'});
});
test.each(['sqlite','files'] as const)('转发内容写回 %s 存储，保留原文，重启后从关联消息读取缓存而不访问其他会话',async(storage)=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'harness-forward-store-'));
 const boot=async()=>{const app=await createApplication({dataDir,storage,v2Managers:false,extensionHotReload:false,initialConfig:{acceptAllSessions:true,defaults:{memory:{enabled:false}}}});apps.push(app);return app;};
 let app=await boot();const store=app.runtime.use(storageService);
 store.append({id:'forward',chatKey:'group:1',senderId:'2',senderName:'甲',text:'[转发原文]',atMe:false,timestamp:Date.now(),metadata:{segments:[{type:'forward',data:{id:'r0'}}]}});
 const context=():ToolContext=>({chatKey:'group:1',settings:app.runtime.use(configService).effective('group:1'),sent:0,trace(){},run:{id:'test',signal:new AbortController().signal,deadline:Infinity,revision:0,assertActive(){}}});
 vi.spyOn(app.runtime.use(adapterService),'query').mockResolvedValue({messages:[{sender:{nickname:'乙',user_id:'3'},content:[{type:'text',data:{text:'展开后可检索正文'}}]}]});
 expect(await app.runtime.use(toolService).execute(context(),'read_forward','{"messageId":"forward"}')).toMatchObject({count:1});
 expect(store.messages('group:1')[0]).toMatchObject({text:expect.stringContaining('展开后可检索正文'),metadata:{originalText:'[转发原文]'}});
 await app.stop();apps.pop();app=await boot();const query=vi.spyOn(app.runtime.use(adapterService),'query').mockRejectedValue(new Error('离线，不应请求'));
 expect(await app.runtime.use(toolService).execute(context(),'read_forward','{"messageId":"forward"}')).toMatchObject({count:1});expect(query).not.toHaveBeenCalled();
 const wrong={...context(),chatKey:'group:9'};expect(await app.runtime.use(toolService).execute(wrong,'read_forward','{"messageId":"forward"}')).toHaveProperty('isError',true);
 expect(app.runtime.use(storageService).messages('group:9')).toHaveLength(0);
});
