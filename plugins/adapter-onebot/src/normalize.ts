import {randomUUID} from 'node:crypto';
import {incomingSchema,messageSegments,segmentText,type IncomingMessage} from '@qq-harness/contracts';
export function normalizeOneBot(event:Record<string,unknown>,selfId=''):IncomingMessage|undefined{
 const own=String(event.self_id??selfId),user=String(event.user_id??'');
 if(!/^\d+$/.test(user)||user===own)return;
 const poke=event.post_type==='notice'&&event.notice_type==='notify'&&event.sub_type==='poke'&&String(event.target_id)===own;
 if(!poke&&(event.post_type!=='message'||!['group','private'].includes(String(event.message_type))||event.message_id==null))return;
 const kind=poke?(event.group_id?'group':'private'):String(event.message_type),chatKey=`${kind}:${String(kind==='group'?event.group_id:user)}`;
 const sender=event.sender as {card?:string;nickname?:string}|undefined;
 const segments=messageSegments(event.message??event.raw_message??'');
 const parsed=incomingSchema.safeParse({id:poke?`poke:${randomUUID()}`:String(event.message_id),chatKey,senderId:user,senderName:sender?.card||sender?.nickname||'',text:poke?'[拍一拍] 对方拍了拍你':segmentText(segments),atMe:poke||segments.some(s=>s.type==='at'&&String(s.data.qq)===own),timestamp:Number(event.time??Date.now()/1000)*1000,metadata:{segments,selfId:own,...(poke?{poke:true}:{}),rawType:String(event.post_type)}});
 return parsed.success?parsed.data:undefined;
}
