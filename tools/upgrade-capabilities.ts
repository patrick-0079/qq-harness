import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {configSchema,type HarnessConfig} from '@qq-harness/contracts';
import {deepMerge,writeJsonAtomic,redactConfigTree} from '@qq-harness/files';
import {acquireDataLock} from '../apps/server/src/lock.js';
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const protocol='【当前工具协议】send_message 只接受 {"messages":["正文","下一条"]}，单条也用字符串数组；finish 使用 mode、silentReason、activeTopic。silent 必填原因，spoken 须有真实成功发送。图片通过 get_message_images 查看，转发通过 read_forward 逐层展开；以当前工具 schema 为准。';
export function capabilityConfig(input:unknown,reference:Record<string,any>,profiles:Record<string,Record<string,any>>={}):HarnessConfig & Record<string,unknown>{
  const current=configSchema.parse(input);
  current.legacyGlobal=deepMerge(reference,current.legacyGlobal) as Record<string,unknown>;
  const update=(settings:HarnessConfig['defaults'],legacy:Record<string,any>)=>{
    const oldApi=legacy.api??reference.api??{},value=settings.legacySession.api,api:Record<string,unknown>={...(value&&typeof value==='object'&&!Array.isArray(value)?value:{})};
    for(const key of ['vision','video','visionModel','videoModel','videoMode'])if(api[key]===undefined&&oldApi[key]!==undefined)api[key]=oldApi[key];
    settings.legacySession={...settings.legacySession,api};
    if(!settings.persona.includes(protocol))settings.persona+='\n\n'+protocol;
  };
  update(current.defaults,reference);
  for(const [key,settings]of Object.entries(current.profiles))update(settings,deepMerge(reference,profiles[key]??{}) as Record<string,any>);
  return {...(input&&typeof input==='object'?input:{}),...configSchema.parse(current)};
}
function differences(before:unknown,after:unknown,prefix=''):Record<string,unknown>[] {
  if(JSON.stringify(before)===JSON.stringify(after))return [];
  const isObject=(v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v);
  if(isObject(before)||isObject(after)){
    const a=(isObject(before)?before:{}) as Record<string,unknown>,b=(isObject(after)?after:{}) as Record<string,unknown>;
    return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(key=>differences(a[key],b[key],prefix?prefix+'.'+key:key));
  }
  const safe=(value:unknown)=>typeof value==='string'&&value.length>500?{length:value.length,sha256:sha(value)}:value;
  return [{field:prefix,before:safe(before),after:safe(after)}];
}
export function previewCapabilities(dataDir:string,sourceRoot:string){
  const file=path.join(dataDir,'config.json'),bytes=fs.readFileSync(file),reference=JSON.parse(fs.readFileSync(path.join(sourceRoot,'data/config.json'),'utf8').replace(/^\uFEFF/,''));
  const profiles:Record<string,Record<string,any>>={},folder=path.join(sourceRoot,'data/chat-configs');
  if(fs.existsSync(folder))for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.json'))){const raw=JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'));profiles[raw.key]=raw.config??{};}
  const config=capabilityConfig(JSON.parse(bytes.toString('utf8')),reference,profiles);
  const changes=differences(redactConfigTree(JSON.parse(bytes.toString('utf8'))),redactConfigTree(config));
  return {config,beforeSha:sha(bytes),changes,changed:sha(JSON.stringify(JSON.parse(bytes.toString('utf8'))))!==sha(JSON.stringify(config))};
}
export function upgradeCapabilities(dataDir:string,sourceRoot:string,apply=false){
  let release:(()=>void)|undefined;
  try{
    if(apply)release=acquireDataLock(dataDir);
    const preview=previewCapabilities(dataDir,sourceRoot),report={version:1,kind:'capabilities-only',changed:preview.changed,fields:preview.changes,preserved:['memory','memoryOverrides','onebot','snowluma','qqPortable','launch','behavior','modelSelection','existing-extension-state']};
    if(!apply||!preview.changed)return {...report,applied:false};
    const file=path.join(dataDir,'config.json');if(sha(fs.readFileSync(file))!==preview.beforeSha)throw new Error('预览后配置发生变化，拒绝覆盖');
    const backup=path.join(dataDir,'backups','capabilities-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8));
    fs.mkdirSync(backup,{recursive:true});fs.copyFileSync(file,path.join(backup,'config.json'));
    writeJsonAtomic(path.join(backup,'manifest.json'),{version:1,beforeSha:preview.beforeSha,at:new Date().toISOString(),kind:'config-only'});
    writeJsonAtomic(path.join(dataDir,'migration','capabilities-preview.json'),report);
    writeJsonAtomic(file,preview.config);
    return {...report,applied:true,backup};
  }finally{release?.();}
}
export function restoreCapabilities(dataDir:string,backup:string,apply=false){
  const base=fs.realpathSync(path.join(dataDir,'backups')),folder=fs.realpathSync(backup),relative=path.relative(base,folder);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('回滚备份必须属于当前实例 backups');
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8')),bytes=fs.readFileSync(path.join(folder,'config.json'));
  if(manifest.version!==1||manifest.kind!=='config-only'||sha(bytes)!==manifest.beforeSha)throw new Error('备份校验失败');
  configSchema.parse(JSON.parse(bytes.toString('utf8')));
  if(apply){const release=acquireDataLock(dataDir);try{const target=path.join(dataDir,'config.json'),temp=target+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,bytes);fs.renameSync(temp,target);}finally{release();}}
  return {restored:apply};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),get=(name:string)=>args.find(a=>a.startsWith(name+'='))?.slice(name.length+1),dataDir=get('--data-dir'),sourceRoot=get('--source'),restore=get('--restore');
  if(!dataDir||!path.isAbsolute(dataDir)||!restore&&(!sourceRoot||!path.isAbsolute(sourceRoot)))throw new Error('需要绝对路径 --data-dir 和 --source；默认预览，执行需 --apply --offline');
  if(args.includes('--apply')&&!args.includes('--offline'))throw new Error('应用前停止后端并传 --offline');
  console.log(JSON.stringify(restore?restoreCapabilities(dataDir,restore,args.includes('--apply')):upgradeCapabilities(dataDir,sourceRoot!,args.includes('--apply')),null,2));
}
