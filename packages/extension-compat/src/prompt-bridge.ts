import type {ModelMessage} from '@qq-harness/domain';
/** Keep variable plugin material at the request tail so cached system prefixes
 * do not shift on every incoming speaker or alias lookup. */
export function appendDynamicTail(messages:ModelMessage[],value:unknown){
 const text=String(value??'').trim();if(!Array.isArray(messages)||!text)return false;
 for(let i=messages.length-1;i>=0;i--){const message=messages[i]!;if(message.role!=='user')continue;
  if(typeof message.content==='string'){message.content+='\n\n'+text;return true;}
  if(Array.isArray(message.content)){message.content.push({type:'text',text:'\n\n'+text});return true;}
 }
 messages.push({role:'user',content:text});return true;
}
export function stripMentions(entry:{text?:unknown;atNames?:unknown}){
 let text=String(entry?.text??'').replace(/\[CQ:at[^\]]*\]/g,' ');
 for(;;){const start=text.indexOf('[引用');if(start<0)break;let depth=0,end=-1;for(let i=start;i<text.length;i++){if(text[i]==='[')depth++;else if(text[i]===']'&&--depth===0){end=i;break;}}if(end<0)break;text=text.slice(0,start)+' '+text.slice(end+1);}
 if(Array.isArray(entry?.atNames)&&entry.atNames.length){for(const name of entry.atNames){const value=String(name??'').trim();if(value.startsWith('@')&&value.length>1)text=text.split(value).join(' ');}return text;}
 return text.replace(/@[^\s]{1,24}/g,' ');
}
