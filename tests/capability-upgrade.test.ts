import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,test} from 'vitest';
import {capabilityConfig,upgradeCapabilities,restoreCapabilities} from '../tools/upgrade-capabilities.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0)){const full=fs.realpathSync(root);if(path.dirname(full)!==fs.realpathSync(os.tmpdir())||!path.basename(full).startsWith('harness-capability-upgrade-'))throw new Error('清理越界');fs.rmSync(full,{recursive:true,force:true});}});
test('能力升级恢复旧搜索、安全及媒体配置，保留现有三层记忆、会话策略和运行路径',()=>{
 const raw={defaults:{persona:'当前人设',memory:{shortIntervalMs:12345},behavior:{enabled:true,reply:{other:{probability:24.1}}},legacySession:{api:{vision:false}}},profiles:{'group:1':{persona:'会话人设'}},qqPortable:{directory:'D:/QQ',dataDirectory:'D:/QQdata'},snowluma:{directory:'D:/Snow',mode:'managed',acceptEula:true,acceptPrivacy:true},onebot:{accessToken:'current-token'},legacyGlobal:{webSearch:{provider:'custom:current'}}};
 const upgraded=capabilityConfig(raw,{webSearch:{provider:'bing',maxResults:6,custom:{apiKey:'old-secret'}},security:{browseLock:{enabled:true,hosts:['example.test']}},api:{vision:true,video:true}}, {'group:1':{api:{visionModel:'vision-a'}}});
 expect(upgraded.defaults.memory.shortIntervalMs).toBe(12345);expect(upgraded.defaults.behavior.reply.other.probability).toBe(24.1);expect(upgraded.defaults.legacySession.api).toMatchObject({vision:false,video:true});
 expect(upgraded.profiles['group:1']!.legacySession.api).toMatchObject({visionModel:'vision-a'});expect(upgraded.legacyGlobal).toMatchObject({webSearch:{provider:'custom:current',maxResults:6}});
 expect(upgraded.onebot.accessToken).toBe('current-token');expect(upgraded.qqPortable).toMatchObject(raw.qqPortable);expect(upgraded.snowluma).toMatchObject(raw.snowluma);
 expect(capabilityConfig(upgraded,{webSearch:{provider:'bing'},api:{vision:true}})).toEqual(upgraded);
});
test('迁移逐字段预览脱敏、执行前备份、重复执行幂等，回滚恢复原始字节',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'harness-capability-upgrade-'));roots.push(root);const data=path.join(root,'instance'),old=path.join(root,'reference');fs.mkdirSync(data);fs.mkdirSync(path.join(old,'data'),{recursive:true});
 const bytes=JSON.stringify({defaults:{persona:'当前人设'},model:{apiKey:'current-key'}});fs.writeFileSync(path.join(data,'config.json'),bytes);fs.writeFileSync(path.join(old,'data/config.json'),JSON.stringify({webSearch:{custom:{apiKey:'source-key'}},api:{vision:true}}));
 const preview=upgradeCapabilities(data,old);expect(preview).toMatchObject({applied:false,changed:true});expect(JSON.stringify(preview)).not.toContain('source-key');expect(preview.fields.some(f=>String(f.field).startsWith('legacyGlobal.webSearch'))).toBe(true);expect(fs.readFileSync(path.join(data,'config.json'),'utf8')).toBe(bytes);expect(fs.existsSync(path.join(data,'backups'))).toBe(false);
 const applied=upgradeCapabilities(data,old,true);expect(applied.applied).toBe(true);expect(upgradeCapabilities(data,old,true)).toMatchObject({applied:false,changed:false});
 const backup=(applied as {backup:string}).backup;expect(restoreCapabilities(data,backup)).toEqual({restored:false});restoreCapabilities(data,backup,true);expect(fs.readFileSync(path.join(data,'config.json'),'utf8')).toBe(bytes);expect(()=>restoreCapabilities(data,old)).toThrow('backups');
});
