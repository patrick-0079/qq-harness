import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('旧包离线检查在独立子进程阻断网络、子进程和测试目录外的数据读写', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-offline-audit-')),
    outside = path.join(os.tmpdir(), 'outside-' + path.basename(root) + '.txt');
  try {
    fs.writeFileSync(outside, '不能被插件读取');
    const source = `import fs from 'node:fs';import {request} from 'node:https';import {spawn} from 'node:child_process';import {offlineAuditGuard} from ${JSON.stringify(new URL('../tools/offline-audit-guard.ts', import.meta.url).href)};const guard=offlineAuditGuard(${JSON.stringify(root)},${JSON.stringify(path.resolve('.'))});const result=[];for(const fn of [()=>request('https://fixture.invalid'),()=>spawn('never-start-this'),()=>fs.readFileSync(${JSON.stringify(outside)}),()=>fs.writeFileSync(${JSON.stringify(outside)},'禁止覆盖'),()=>process.exit(9)]){try{fn();result.push(false)}catch{result.push(true)}}fs.writeFileSync(${JSON.stringify(path.join(root, 'owned.txt'))},'仅测试数据');const attempts=guard.attempts;guard.stop();console.log(JSON.stringify({result,attempts}));`;
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      windowsHide: true,
    });
    const result = JSON.parse(output.trim());
    expect(result.result).toEqual([true, true, true, true, true]);
    expect(result.attempts.map((a: any) => a.kind)).toEqual(['network', 'process', 'process']);
    expect(fs.readFileSync(outside, 'utf8')).toBe('不能被插件读取');
    expect(fs.readFileSync(path.join(root, 'owned.txt'), 'utf8')).toBe('仅测试数据');
  } finally {
    const full = fs.realpathSync(root);
    if (
      path.dirname(full) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(full).startsWith('harness-offline-audit-')
    )
      throw new Error('清理越界');
    fs.rmSync(full, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});
