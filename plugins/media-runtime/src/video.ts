import fs from 'node:fs';
import path from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { ContentPart } from '@qq-harness/contracts';
import { publicFetch } from '@qq-harness/files';
const command=(file:string,args:string[],signal:AbortSignal)=>new Promise<string>((resolve,reject)=>{
 const child=spawn(file,args,{windowsHide:true,signal,stdio:['ignore','pipe','pipe']});let out='',error='';
 child.stdout.on('data',b=>{out=(out+String(b)).slice(-100000);});child.stderr.on('data',b=>{error=(error+String(b)).slice(-10000);});
 child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(new Error(`${path.basename(file)} 退出 ${code}：${error}`)));
});
/** Same route rules as the former VideoReader; the picture capability is independent
 * of the native-video flag. Metadata remains readable when picture input is off. */
export function resolveVideoRoute({mode='auto',videoModel='',framesOk=false,hasUrl=false}:{mode?:string;videoModel?:string;framesOk?:boolean;hasUrl?:boolean}={}){
 const m=['auto','native','frames','off'].includes(mode)?mode:'auto';
 if(m==='off')return {route:'meta',reason:'videoMode=off：只读元信息，不喂画面'};
 if(m==='native')return hasUrl?{route:'native',reason:'videoMode=native：按原生视频输入发送'}:{route:'meta',reason:'videoMode=native，但这条视频没有可用的 http(s) 地址'};
 if(m==='frames')return framesOk?{route:'frames',reason:'videoMode=frames：抽帧成图片'}:{route:'meta',reason:'videoMode=frames，但抽帧不可用（未见 ffmpeg 或 Skill 已关闭）'};
 if(videoModel.trim()&&hasUrl)return {route:'native',reason:'auto：已配置视频专用模型，按原生视频输入发送'};
 return framesOk?{route:'frames',reason:'auto：未配置视频专用模型，改用抽帧'}:{route:'meta',reason:'auto：既没有视频专用模型，抽帧也不可用，只读元信息'};
}
export async function videoParts(root:string,url:string,options:{mode:string;videoModel?:string;frames:number;ffmpeg?:string;ffprobe?:string;signal:AbortSignal;fetch?:typeof publicFetch;command?:typeof command;frameProvider?:{available():Promise<boolean>;extract(input:{filePath:string;count:number;durationSec?:number}):Promise<{frames:string[];times?:number[];error?:string}>}}):Promise<ContentPart[]> {
 const signal=AbortSignal.any([options.signal,AbortSignal.timeout(60000)]),run=options.command??command;
 let bytes:Buffer;
 try{const response=await (options.fetch??publicFetch)(url,{maxBytes:128*1024*1024,signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);bytes=Buffer.from(await response.arrayBuffer());}
 catch(error){signal.throwIfAborted();return [{type:'text',text:JSON.stringify({route:'meta',routeReason:'视频文件不可用',note:`无法获取视频文件，尚未读取画面：${error instanceof Error?error.message:String(error)}`})}];}
 if(bytes.length<12||bytes.subarray(4,8).toString()!=='ftyp')throw new Error('当前仅支持 MP4/MOV 视频内容');
 const folder=path.join(root,randomUUID());fs.mkdirSync(folder,{recursive:true});
 const input=path.join(folder,createHash('sha256').update(bytes).digest('hex')+'.mp4');
 try{
  fs.writeFileSync(input,bytes);const meta:Record<string,unknown>={sizeBytes:bytes.length};let duration:number|undefined;
  try{const info=JSON.parse(await run(options.ffprobe||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',input],signal));const stream=info.streams?.find((s:any)=>s.codec_type==='video');duration=Number(info.format?.duration);if(Number.isFinite(duration)&&duration!>0)meta.durationSec=duration;else duration=undefined;for(const key of ['width','height'])if(Number(stream?.[key])>0)meta[key]=Number(stream[key]);if(info.format?.format_name)meta.format=String(info.format.format_name);}
  catch{signal.throwIfAborted();meta.note='未能探测详细元信息（FFprobe 不可用或格式不支持）';}
  let framesOk=false;
  if(!['native','off'].includes(options.mode)&&!(options.videoModel?.trim()&&options.mode==='auto'))try{if(options.frameProvider)framesOk=await options.frameProvider.available();else{await run(options.ffmpeg||'ffmpeg',['-version'],signal);framesOk=true;}}catch{signal.throwIfAborted();}
  const selected=resolveVideoRoute({mode:options.mode,videoModel:options.videoModel,framesOk,hasUrl:true});meta.route=selected.route;meta.routeReason=selected.reason;
  if(selected.route==='native')return [{type:'text',text:JSON.stringify({...meta,note:'画面已作为视频输入；未提供抽帧图片'})},{type:'video_url',video_url:{url:`data:video/mp4;base64,${bytes.toString('base64')}`}}];
  if(selected.route==='frames'){
   try{
    const count=Math.max(1,Math.min(12,Math.round(options.frames)||4));let images:string[]=[],times:number[]=[];
    if(options.frameProvider){const result=await options.frameProvider.extract({filePath:input,count,durationSec:duration});images=result.frames;times=result.times??[];if(!images.length)throw new Error(result.error||'未提取出画面');}
    else{if(!duration)throw new Error('无法确定视频时长');await run(options.ffmpeg||'ffmpeg',['-hide_banner','-loglevel','error','-i',input,'-vf',`fps=${count/duration},scale=640:-2`,'-frames:v',String(count),path.join(folder,'frame-%02d.jpg')],signal);images=fs.readdirSync(folder).filter(n=>/^frame-\d+\.jpg$/.test(n)).sort().slice(0,count).map(name=>'data:image/jpeg;base64,'+fs.readFileSync(path.join(folder,name)).toString('base64'));if(!images.length)throw new Error('未能提取视频帧');}
    signal.throwIfAborted();if(images.length>12||images.some(image=>!/^data:image\/(?:jpeg|png|webp);base64,/.test(image)))throw new Error('抽帧插件返回了无效的图片输入');
    return [{type:'text',text:JSON.stringify({...meta,frameCount:images.length,frameTimes:times,note:'以下是抽帧截图，不是连续视频；帧之间的过程不可见'})},...images.map(image=>({type:'image_url',image_url:{url:image}}))];
   }catch(error){signal.throwIfAborted();meta.route='meta';meta.routeReason=selected.reason+'；抽帧失败：'+(error instanceof Error?error.message:String(error));}
  }
  return [{type:'text',text:JSON.stringify({...meta,frameCount:0,note:'只读取元信息，未提供画面；不能据此描述视频内容'})}];
 }finally{const relative=path.relative(path.resolve(root),path.resolve(folder));if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))fs.rmSync(folder,{recursive:true,force:true});}
}
