export interface MessageSegment {type:string;data:Record<string,unknown>;}
const unescape=(value:string)=>value.replace(/&(?:amp|#91|#93|#44);/g,match=>({'&amp;':'&','&#91;':'[','&#93;':']','&#44;':','})[match]??match);
export function messageSegments(value:unknown):MessageSegment[]{
 if(Array.isArray(value))return value.flatMap(item=>item&&typeof item==='object'&&typeof item.type==='string'?[{type:item.type,data:item.data&&typeof item.data==='object'&&!Array.isArray(item.data)?{...item.data}:{}}]:[]);
 if(typeof value!=='string')return [];
 const result:MessageSegment[]=[];let cursor=0;
 while(cursor<value.length){
  const start=value.indexOf('[CQ:',cursor);
  if(start<0){result.push({type:'text',data:{text:unescape(value.slice(cursor))}});break;}
  if(start>cursor)result.push({type:'text',data:{text:unescape(value.slice(cursor,start))}});
  const end=value.indexOf(']',start+4);if(end<0){result.push({type:'text',data:{text:unescape(value.slice(start))}});break;}
  const raw=value.slice(start+4,end),comma=raw.indexOf(','),type=comma<0?raw:raw.slice(0,comma);
  if(!/^[A-Za-z0-9_-]+$/.test(type)){result.push({type:'text',data:{text:unescape(value.slice(start,end+1))}});cursor=end+1;continue;}
  const data:Record<string,unknown>={};for(const part of (comma<0?[]:raw.slice(comma+1).split(','))){const equal=part.indexOf('=');if(equal<1)continue;const key=part.slice(0,equal);if(['__proto__','prototype','constructor'].includes(key))continue;data[key]=unescape(part.slice(equal+1));}
  result.push({type,data});cursor=end+1;
 }
 return result;
}
export function segmentText(segments:MessageSegment[]):string {
 const labels:Record<string,string>={image:'图片',mface:'表情图片',face:'表情',video:'视频',record:'语音',audio:'音频',file:'文件',forward:'合并转发聊天记录'};
 return segments.map(segment=>segment.type==='text'?String(segment.data.text??''):segment.type==='at'?`@${segment.data.qq??''}`:segment.type==='reply'?`[引用消息 #${segment.data.id??''}]`:`[${labels[segment.type]??segment.type}]`).join('');
}
