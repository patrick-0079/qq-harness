// 旧版管理面使用中国本地时间；不依赖 Windows 服务账户的系统时区。
export function reminderTime(value:{delayMinutes?:number;atTime?:string},now=Date.now()):number {
 if((value.delayMinutes!==undefined)===!!value.atTime)throw new Error('delayMinutes 与 atTime 必须二选一');
 if(value.delayMinutes!==undefined){if(!Number.isFinite(value.delayMinutes)||value.delayMinutes<=0||value.delayMinutes>525600)throw new Error('延迟必须大于0且不超过一年');return now+value.delayMinutes*60000;}
 const input=value.atTime!.trim(),match=/^(?:(\d{4})-(\d{2})-(\d{2})\s+)?(\d{2}):(\d{2})$/.exec(input);
 if(!match)throw new Error('时间格式应为 HH:MM 或 YYYY-MM-DD HH:MM');
 const local=new Date(now+8*3600000), year=match[1]?+match[1]:local.getUTCFullYear(),month=match[2]?+match[2]:local.getUTCMonth()+1,day=match[3]?+match[3]:local.getUTCDate(),hour=+match[4]!,minute=+match[5]!;
 if(hour>23||minute>59||month<1||month>12||day<1||day>31)throw new Error('日期或时间无效');
 const check=new Date(Date.UTC(year,month-1,day,hour,minute));
 if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)throw new Error('日期无效');
 let due=check.getTime()-8*3600000;
 if(!match[1]&&due<=now)due+=86400000;
 if(due<=now)throw new Error('提醒时间必须在未来');
 return due;
}
