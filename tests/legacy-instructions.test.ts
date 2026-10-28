import {expect,test} from 'vitest';
import {normalizeLegacyInstructions as normalize} from '../packages/extension-compat/src/instructions.js';
test('旧工具说明迁移为严格数组与新版 finish，第三方参数文字保持原样',()=>{
 expect(normalize('messages 传单个字符串（保留换行），严禁传数组、严禁拆成多条')).toBe('messages 传仅含一个字符串的数组（保留换行），数组只保留这一项、严禁拆成多条');
 expect(normalize('send_message({text:"两行\\n完整内容"}) 然后 finish({summary:"已完成"})')).toBe('send_message({messages:["两行\\n完整内容"]}) 然后 finish({mode:"spoken"})');
 expect(normalize('send_message 调用示例 {"messages":"文字"}')).toContain('"messages":["文字"]');
 for(const other of ['第三方接口 {"messages":"字符串"}','普通表单说明：严禁传数组','群友说：这里的 messages 字段是字符串'])expect(normalize(other)).toBe(other);
});
