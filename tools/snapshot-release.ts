import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {acquireDataLock} from '../apps/server/src/lock.js';
import {writeJsonAtomic} from '@qq-harness/files';
import {loadLaunch} from '../scripts/live-config.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),source=path.join(root,'var/production');
if(!process.argv.includes('--offline'))throw new Error('先停止后端，再使用 --offline 创建一致性快照');
const release=acquireDataLock(source);
try{
 const target=path.join(root,'var/backups','capabilities-'+new Date().toISOString().replaceAll(':','-'));if(fs.existsSync(target))throw new Error('快照目录已存在');fs.mkdirSync(target,{recursive:true});
 const files:{file:string;sha256:string;bytes:number}[]=[];
 const copy=(from:string,to:string,relative:string)=>{
  const stat=fs.lstatSync(from);if(stat.isSymbolicLink())throw new Error('快照不跟随符号链接：'+relative);
  if(stat.isDirectory()){fs.mkdirSync(to,{recursive:true});for(const name of fs.readdirSync(from)){if(relative==='data'&&['backups','harness.lock'].includes(name))continue;copy(path.join(from,name),path.join(to,name),relative+'/'+name);}}
  else if(stat.isFile()){fs.copyFileSync(from,to);const bytes=fs.readFileSync(to);files.push({file:relative,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}
 };
 const selected=loadLaunch(root).releaseDirectory;copy(source,path.join(target,'data'),'data');copy(selected,path.join(target,'release'),'release');
 writeJsonAtomic(path.join(target,'manifest.json'),{version:2,at:new Date().toISOString(),releaseDirectory:selected,note:'完整停机数据及 launch.json 选定的构建',files});
 console.log(JSON.stringify({snapshot:target,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)}));
}finally{release();}
