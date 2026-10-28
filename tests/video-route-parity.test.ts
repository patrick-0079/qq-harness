import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,test,vi} from 'vitest';import {parseSync} from 'rolldown/utils';
import {videoParts,resolveVideoRoute} from '../plugins/media-runtime/src/video.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0)){const real=fs.realpathSync(root);if(path.dirname(real)!==fs.realpathSync(os.tmpdir())||!path.basename(real).startsWith('harness-video-route-'))throw new Error('清理越界');fs.rmSync(real,{recursive:true,force:true});}});
const videoReference = new URL('../../backup/source/src/video-reader.js', import.meta.url);
// The public checkout does not redistribute the operator's legacy deployment.
test.skipIf(!fs.existsSync(videoReference))('全部视频模式、模型、插件可用性及 URL 组合与旧路线函数同输入对照',()=>{
 const file=videoReference,source=fs.readFileSync(file,'utf8'),ast=parseSync(file.pathname,source).program;
 const node=(ast.body as any[]).find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='resolveVideoRoute').declaration;
 const old=new Function('const VIDEO_MODES=["auto","native","frames","off"];'+source.slice(node.start,node.end)+';return resolveVideoRoute;')();
 for(const mode of ['auto','native','frames','off','invalid'])for(const videoModel of ['','omni'])for(const framesOk of [false,true])for(const hasUrl of [false,true])expect(resolveVideoRoute({mode,videoModel,framesOk,hasUrl})).toEqual(old({mode,videoModel,framesOk,hasUrl}));
});
test('关闭画面仍可读元信息；auto 原生视频不依赖抽帧；停用抽帧插件明确降级，失败及取消不伪造画面',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'harness-video-route-'));roots.push(root);const bytes=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(20)]),fetch=vi.fn(async()=>new Response(bytes));
 const available=vi.fn(async()=>false),extract=vi.fn(async()=>({frames:[]})),command=vi.fn(async()=>JSON.stringify({format:{duration:'10',format_name:'mp4'},streams:[{codec_type:'video',width:640,height:360}]}));
 const options={frames:4,signal:new AbortController().signal,fetch,command,frameProvider:{available,extract}};
 for(const mode of ['off','frames','auto']){const parts=await videoParts(root,'https://video.fixture.invalid',{...options,mode});expect(parts).toHaveLength(1);expect(JSON.parse((parts[0] as any).text)).toMatchObject({route:'meta',durationSec:10,width:640,height:360,frameCount:0});}
 const native=await videoParts(root,'https://video.fixture.invalid',{...options,mode:'auto',videoModel:'omni'});expect(native.map(p=>p.type)).toEqual(['text','video_url']);expect(extract).not.toHaveBeenCalled();
 available.mockResolvedValue(true);extract.mockResolvedValue({frames:[]});const failed=await videoParts(root,'https://video.fixture.invalid',{...options,mode:'frames'});expect(JSON.parse((failed[0] as any).text).routeReason).toContain('抽帧失败');
 const abort=new AbortController();abort.abort(new Error('测试取消'));await expect(videoParts(root,'https://video.fixture.invalid',{...options,mode:'native',signal:abort.signal,fetch:async(_url,opt)=>{opt?.signal?.throwIfAborted();return new Response(bytes);}})).rejects.toThrow('测试取消');expect(fs.readdirSync(root)).toEqual([]);
});
