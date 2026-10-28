import type {ContentPart} from './media.js';
/** MCP 与旧扩展媒体结果在边界归一化；媒体作为后续 user 输入，tool 响应保留文本。 */
export function normalizeToolContent(parts:unknown[]):ContentPart[]{
 return parts.flatMap<ContentPart>(value=>{
  if(!value||typeof value!=='object')return [{type:'text',text:String(value??'')}];
  const v=value as Record<string,any>;
  if(v.type==='text')return [{type:'text',text:String(v.text??'')}];
  if(v.type==='image'&&typeof v.data==='string'&&/^image\/(?:png|jpeg|webp|gif)$/.test(String(v.mimeType)))return [{type:'image_url',image_url:{url:`data:${v.mimeType};base64,${v.data}`}}];
  if(v.type==='image_url'&&typeof v.image_url?.url==='string')return [{type:'image_url',image_url:v.image_url}];
  if(v.type==='video_url'&&typeof v.video_url?.url==='string')return [{type:'video_url',video_url:v.video_url}];
  return [{type:'text',text:JSON.stringify(v)}];
 });
}
