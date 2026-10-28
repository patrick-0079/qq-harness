import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
const dir=path.resolve(process.argv[2]??'');if(!/live-capability-audit-\d+$/.test(dir))throw new Error('只能读取独立联调目录');
if(process.argv.includes('--forward')&&!process.argv.includes('--live'))throw new Error('查询真实协议端必须显式传 --live');
const db=new DatabaseSync(path.join(dir,'harness.sqlite'),{readOnly:true});
try{for(const row of db.prepare('SELECT payload FROM messages').all()){
  const m=JSON.parse(String(row.payload));
  console.log(JSON.stringify({id:m.id,chatKey:m.chatKey,metaKeys:Object.keys(m.metadata??{}),segments:(m.metadata?.segments??m.metadata?.outbound?.segments??[]).map((s:any)=>({type:s.type,data:Object.fromEntries(Object.entries(s.data??{}).map(([k,v])=>{let info:string;if(/^(?:base64:\/\/|data:)/.test(String(v)))info='[binary]';else try{const url=new URL(String(v));info=url.protocol+'//'+url.hostname+' [query omitted]';}catch{info=String(v).slice(0,100);}return [k,info];}))}))}));
  if(process.argv.includes('--forward')&&m.metadata?.outbound?.segments?.some((s:any)=>s.type==='forward')){
    const cfg=JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8')),id=m.metadata.outbound.segments.find((s:any)=>s.type==='forward').data.id;
    const res=await fetch(cfg.onebot.httpUrl+'/get_forward_msg',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+(cfg.onebot.httpAccessToken||cfg.onebot.accessToken)},body:JSON.stringify({id})});
    const safe=(v:any,key=''):any=>typeof v==='string'?(key==='type'?v:v===''?'':/^https?:/.test(v)?new URL(v).origin+' [URL]':'[string '+v.length+']'):Array.isArray(v)?v.map(i=>safe(i)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,safe(x,k)])):v;
    console.log(JSON.stringify(safe(await res.json()),null,2));
  }
}}finally{db.close();}
