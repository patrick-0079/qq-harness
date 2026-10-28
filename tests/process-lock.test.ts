import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { lockDirectory, processOwnsLock } from '@qq-harness/files';

test('活进程的旧 PID 锁可识别复用，不结束该进程，真实当前锁仍拒绝重复', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-pid-lock-'));
  const locks = path.join(dir, 'locks');
  const release = lockDirectory(dir, locks);
  const file = path.join(
    locks,
    fs.readdirSync(locks).find((name) => name.endsWith('.lock'))!,
  );
  expect(() => lockDirectory(dir, locks)).toThrow('其他 Harness');
  const old = new Date(Date.now() - process.uptime() * 1000 - 60000);
  fs.utimesSync(file, old, old);
  expect(processOwnsLock(process.pid, old.getTime())).toBe(false);
  const replacement = lockDirectory(dir, locks);
  release();
  expect(fs.existsSync(file)).toBe(true);
  expect(processOwnsLock(process.pid, Date.now())).toBe(true);
  replacement();
  expect(fs.existsSync(file)).toBe(false);
});
