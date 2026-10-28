import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readJson,writeJsonAtomic} from '@qq-harness/files';
import {acquireDataLock} from '../apps/server/src/lock.js';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const object=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const list=(v:unknown):Record<string,any>[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'):[];
const safeFile=(root:string,relative:string)=>{const base=path.resolve(root),file=path.resolve(base,relative),rel=path.relative(base,file);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('媒体迁移路径越界');let current=base;if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('数据根不能是符号链接');for(const piece of rel.split(path.sep)){current=path.join(current,piece);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('媒体路径包含符号链接');}return file;};
export function previewNativeMedia(sourceRoot:string,dataDir:string){
 const source=fs.realpathSync(path.join(sourceRoot,'data')),target=path.resolve(dataDir);
 if(source===target||target.startsWith(source+path.sep))throw new Error('不能写入旧数据目录');
 const inputs:{file:string;sha256:string}[]=[],writes:{file:string;bytes:Buffer}[]=[],conflicts:string[]=[];
 const read=(relative:string,fallback:unknown)=>{const file=safeFile(source,relative);if(!fs.existsSync(file))return fallback;const bytes=fs.readFileSync(file);inputs.push({file:relative,sha256:hash(bytes)});return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));};
 const add=(relative:string,bytes:Buffer)=>{const dest=safeFile(target,relative);if(fs.existsSync(dest)&&hash(fs.readFileSync(dest))===hash(bytes))return;writes.push({file:relative,bytes});};
 const assetRoot=safeFile(source,'sticker-images');
 const assets=(dir:string)=>{if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name),relative=path.relative(source,file);if(e.isSymbolicLink())throw new Error('旧表情目录包含符号链接');if(e.isDirectory())assets(file);else if(e.isFile()&&!/\.tmp$|\.lock$/.test(e.name)){const bytes=fs.readFileSync(file);inputs.push({file:relative,sha256:hash(bytes)});const dest=path.join(target,relative);if(fs.existsSync(dest)&&hash(fs.readFileSync(dest))!==hash(bytes))conflicts.push(relative);else add(relative,bytes);}}};assets(assetRoot);
 const old=list(read('stickers.json',[])),current=list(readJson(path.join(target,'stickers.json'),[])),id=(e:Record<string,any>)=>String(e.id??e.emoji_id??e.resId??'');
 const merged=new Map(old.filter(e=>id(e)).map(e=>[id(e),{...e}]));
 for(const value of current){const key=id(value);if(!key)continue;const prior=merged.get(key)??{};const next={...prior,...value};for(const key of ['localNote','usage','desc','note'])if(!String(value[key]??'').trim()&&prior[key])next[key]=prior[key];if(!value.tags?.length&&prior.tags?.length)next.tags=prior.tags;next.usedCount=Math.max(Number(prior.usedCount)||0,Number(value.usedCount)||0);merged.set(key,next);}
 for(const entry of merged.values())entry.usedCount=Math.max(0,Number(entry.usedCount)||0);
 for(const entry of merged.values())for(const key of ['url','localFile'])if(typeof entry[key]==='string'&&entry[key].startsWith('file:///')){
   let name:string;try{name=path.basename(decodeURIComponent(new URL(entry[key]).pathname));}catch{continue;}
   // Only relocate files actually present in the captured owned image directory.
   if(fs.existsSync(path.join(assetRoot,name))&&fs.statSync(path.join(assetRoot,name)).isFile())entry[key]=pathToFileURL(path.join(target,'sticker-images',name)).href;
 }
 if(old.length||current.length)add('stickers.json',Buffer.from(JSON.stringify([...merged.values()],null,2)));
 const oldHistory=object(read('image-studio/history.json',{})),newHistory=object(readJson(path.join(target,'image-studio/history.json'),{}));
 const histories=new Map<string,{key:string;at:number}>();for(const item of [...list(oldHistory.items),...list(newHistory.items)])if(typeof item.key==='string'&&Number.isFinite(Number(item.at))){const prior=histories.get(item.key);if(!prior||Number(item.at)>prior.at)histories.set(item.key,{key:item.key,at:Number(item.at)});}
 if(histories.size)add('image-studio/history.json',Buffer.from(JSON.stringify({version:1,items:[...histories.values()].sort((a,b)=>a.at-b.at).slice(-500)},null,2)));
 const oldTags=object(read('image-studio/tag-dict.json',{})),newTags=object(readJson(path.join(target,'image-studio/tag-dict.json'),{}));
 if(Object.keys(oldTags).length||Object.keys(newTags).length)add('image-studio/tag-dict.json',Buffer.from(JSON.stringify({...oldTags,...newTags},null,2)));
 return {source,target,inputs,writes,conflicts,summary:{stickers:merged.size,images:inputs.filter(i=>i.file.startsWith('sticker-images'+path.sep)).length,history:histories.size,tags:Object.keys({...oldTags,...newTags}).length,filesToWrite:writes.length}};
}
export function migrateNativeMedia(sourceRoot:string,dataDir:string,apply=false){
 let release:(()=>void)|undefined;
 try{if(apply)release=acquireDataLock(dataDir);const p=previewNativeMedia(sourceRoot,dataDir);if(p.conflicts.length)throw new Error('目标存在同名且内容不同的表情文件：'+p.conflicts.join('、'));
  if(!apply||!p.writes.length)return {applied:false,changed:Boolean(p.writes.length),...p.summary};
  for(const input of p.inputs)if(hash(fs.readFileSync(path.join(p.source,input.file)))!==input.sha256)throw new Error('预览后旧媒体数据发生变化');
  const backup=path.join(dataDir,'backups','native-media-'+randomUUID());fs.mkdirSync(backup,{recursive:true});
  const receipt={version:1,at:new Date().toISOString(),inputs:p.inputs,summary:p.summary,backup};
  const allWrites=[...p.writes,{file:'migration/native-media-v1.json',bytes:Buffer.from(JSON.stringify(receipt,null,2))}];
  const files=allWrites.map(({file,bytes})=>{const dest=safeFile(dataDir,file),prior=fs.existsSync(dest)?fs.readFileSync(dest):undefined;if(prior){const saved=safeFile(backup,file);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.writeFileSync(saved,prior);}return {file,before:prior?hash(prior):null,after:hash(bytes)};});
  writeJsonAtomic(path.join(backup,'manifest.json'),{version:1,kind:'native-media',files});
  for(const item of allWrites){const dest=safeFile(dataDir,item.file),temp=dest+'.'+randomUUID()+'.tmp';fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(temp,item.bytes);fs.renameSync(temp,dest);}
  return {applied:true,changed:true,backup,...p.summary};
 }finally{release?.();}
}
export function restoreNativeMedia(dataDir:string,backup:string,apply=false){
 const base=fs.realpathSync(path.join(dataDir,'backups')),folder=fs.realpathSync(backup),relative=path.relative(base,folder);if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('备份不属于实例 backups');
 const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));if(manifest.version!==1||manifest.kind!=='native-media')throw new Error('备份类型错误');
 for(const row of manifest.files){const dest=safeFile(dataDir,row.file),saved=safeFile(folder,row.file);if(row.before&&hash(fs.readFileSync(saved))!==row.before)throw new Error('备份哈希不一致');if(!row.before&&fs.existsSync(dest)&&hash(fs.readFileSync(dest))!==row.after)throw new Error('迁入图片已变化，拒绝删除');}
 if(apply){const release=acquireDataLock(dataDir);try{for(const row of manifest.files){const dest=safeFile(dataDir,row.file);if(row.before){const temp=dest+'.'+randomUUID()+'.tmp';fs.copyFileSync(safeFile(folder,row.file),temp);fs.renameSync(temp,dest);}else fs.rmSync(dest,{force:true});}}finally{release();}}
 return {restored:apply,files:manifest.files.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const args=process.argv.slice(2),get=(k:string)=>args.find(a=>a.startsWith(k+'='))?.slice(k.length+1),source=get('--source'),target=get('--data-dir'),restore=get('--restore');if(!target||!path.isAbsolute(target)||!restore&&(!source||!path.isAbsolute(source)))throw new Error('需要 --source=<旧工程> --data-dir=<新实例>；默认预览');if(args.includes('--apply')&&!args.includes('--offline'))throw new Error('写入前停止后端并加 --offline');console.log(JSON.stringify(restore?restoreNativeMedia(target,restore,args.includes('--apply')):migrateNativeMedia(source!,target,args.includes('--apply')),null,2));}
