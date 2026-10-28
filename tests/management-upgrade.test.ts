import { fileMemoryRepository } from '../plugins/storage-file/src/memory.js';
import { randomUUID } from 'node:crypto';
import type { MemoryRecord } from '@qq-harness/contracts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  upgradeConfig,
  upgradeManagement,
  restoreManagement,
} from '../tools/upgrade-management.js';
import { openSqliteStorage } from '@qq-harness/storage-sqlite';
test('目录升级保留现有生效配置与凭据，预览无写入，升级幂等且备份可回滚', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-upgrade-')),
    file = path.join(root, 'config.json');
  const raw = {
    model: {
      baseUrl: 'https://fixture.invalid/v1',
      model: 'model-a',
      apiKey: 'current-key',
      timeoutMs: 45000,
    },
    defaults: { persona: '原始完整快照' },
    profiles: { 'group:1': { persona: '独立快照' } },
    admissions: ['group:1'],
  };
  fs.writeFileSync(file, JSON.stringify(raw));
  const before = fs.readFileSync(file, 'utf8');
  fs.mkdirSync(path.join(root, 'migration'));
  const catalog = {
    customPersonas: [{ id: 'role-a', name: '甲', text: '角色原文' }],
    prompts: { items: [{ id: 'prompt-a', content: '{roleText}' }] },
    providers: [{ id: 'p', baseURL: 'https://fixture.invalid/v1', apiKey: 'old-key' }],
    providerKeys: { p: 'stale-key' },
    sourceApi: { provider: 'p' },
  };
  fs.writeFileSync(path.join(root, 'migration/catalog.json'), JSON.stringify(catalog));
  const storage = openSqliteStorage(path.join(root, 'harness.sqlite'));
  storage.store.setState('fixture', 'value', { persisted: true });
  storage.close();
  expect(await upgradeManagement(root)).toMatchObject({
    applied: false,
    personas: 1,
    prompts: 1,
    providers: 1,
  });
  expect(fs.readFileSync(file, 'utf8')).toBe(before);
  expect(fs.existsSync(path.join(root, 'backups'))).toBe(false);
  const result = await upgradeManagement(root, true);
  expect(result).toMatchObject({ applied: true });
  const upgraded = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(upgraded.defaults.persona).toBe(raw.defaults.persona);
  expect(upgraded.profiles['group:1'].persona).toBe('独立快照');
  expect(upgraded.providers[0].apiKey).toBe('current-key');
  expect(upgraded.defaults.modelSelection.timeoutMs).toBe(45000);
  expect(await upgradeManagement(root, true)).toMatchObject({ applied: false, changed: false });
  const backup = (result as { backup: string }).backup;
  expect(restoreManagement(root, backup)).toMatchObject({ restored: false });
  restoreManagement(root, backup, true);
  expect(fs.readFileSync(file, 'utf8')).toBe(before);
  const reopened = openSqliteStorage(path.join(root, 'harness.sqlite'));
  expect(reopened.store.state('fixture', 'value')).toEqual({ persisted: true });
  reopened.close();
  expect(() => restoreManagement(root, path.join(root, 'migration'), true)).toThrow('backups');
});
test('已使用的新目录项与模型选择不会被旧迁移目录覆盖', () => {
  const cfg = upgradeConfig(
    {
      providers: [{ id: 'p', name: '当前', baseUrl: 'https://current.invalid', apiKey: 'new-key' }],
      defaults: { modelSelection: { model: 'current', timeoutMs: 12000 } },
    },
    { providers: [{ id: 'p', baseURL: 'https://old.invalid', apiKey: 'old-key' }] },
  );
  expect(cfg.providers[0]?.apiKey).toBe('new-key');
  expect(cfg.defaults.modelSelection).toMatchObject({ model: 'current', timeoutMs: 12000 });
});

for (const kind of ['sqlite', 'file'] as const)
  test(`${kind} 旧记忆迁至短期且幂等，旧来源不变，回滚恢复原层级与准入边界`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-migrate-memory-'));
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-legacy-memory-'));
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ admissions: ['group:1'] }));
    fs.writeFileSync(
      path.join(root, 'launch.json'),
      JSON.stringify({ port: 3310, allowedChats: ['group:1'] }),
    );
    fs.mkdirSync(path.join(source, 'data/memory/group_1'), { recursive: true });
    const legacy = path.join(source, 'data/memory/group_1/2.json');
    const before = JSON.stringify({
      userId: '2',
      name: '测试成员',
      impressions: [{ content: '旧版喜好', createdAt: 100 }],
    });
    fs.writeFileSync(legacy, before);
    const initial: MemoryRecord = {
      id: randomUUID(),
      tier: 'long',
      scope: 'chat',
      chatKey: 'group:1',
      personId: null,
      key: 'existing',
      text: '原有长期',
      sources: [],
      visibility: 'chat_only',
      sensitive: false,
      confidence: 1,
      importance: 1,
      pinned: false,
      origin: 'admin',
      expiresAt: null,
      createdAt: 100,
      updatedAt: 100,
      lastConfirmedAt: 100,
      revision: 1,
      status: 'active',
    };
    const db = kind === 'sqlite' ? openSqliteStorage(path.join(root, 'harness.sqlite')) : undefined;
    (db?.memory ?? fileMemoryRepository(root)).saveRecord(initial, 0);
    db?.close();
    const options = { referenceRoot: source, sessionAdmission: true };
    expect(await upgradeManagement(root, false, options)).toMatchObject({
      existingMemoriesToShort: 1,
      legacyMemoriesToImport: 1,
    });
    const result = await upgradeManagement(root, true, options);
    expect(result).toMatchObject({
      applied: true,
      importResult: { imported: 1 },
      memoryResult: { converted: 1 },
    });
    const current =
      kind === 'sqlite' ? openSqliteStorage(path.join(root, 'harness.sqlite')) : undefined;
    const repo = current?.memory ?? fileMemoryRepository(root);
    expect(repo.records()).toHaveLength(2);
    expect(
      repo
        .records()
        .every(
          (r) => r.tier === 'short' && r.consolidatedAt === undefined && r.expiresAt! > Date.now(),
        ),
    ).toBe(true);
    expect(
      repo.history(initial.id).find((entry) => entry.record.revision === initial.revision)?.record
        .tier,
    ).toBe('long');
    current?.close();
    expect(
      JSON.parse(fs.readFileSync(path.join(root, 'launch.json'), 'utf8')).allowedChats,
    ).toBeUndefined();
    expect(await upgradeManagement(root, true, options)).toMatchObject({
      changed: false,
      applied: false,
    });
    expect(fs.readFileSync(legacy, 'utf8')).toBe(before);
    restoreManagement(root, (result as { backup: string }).backup, true);
    const restored =
      kind === 'sqlite' ? openSqliteStorage(path.join(root, 'harness.sqlite')) : undefined;
    const restoredRepo = restored?.memory ?? fileMemoryRepository(root);
    expect(restoredRepo.records()).toHaveLength(1);
    expect(restoredRepo.record(initial.id)?.tier).toBe('long');
    restored?.close();
    expect(
      JSON.parse(fs.readFileSync(path.join(root, 'launch.json'), 'utf8')).allowedChats,
    ).toEqual(['group:1']);
  });

test('离线迁移拒绝正在运行的数据目录锁', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-upgrade-lock-'));
  fs.writeFileSync(path.join(root, 'config.json'), '{}');
  fs.writeFileSync(
    path.join(root, 'harness.lock'),
    JSON.stringify({ pid: process.pid, nonce: 'fixture' }),
  );
  await expect(upgradeManagement(root, true)).rejects.toThrow('已有 QQ Harness 实例运行');
  expect(JSON.parse(fs.readFileSync(path.join(root, 'harness.lock'), 'utf8')).nonce).toBe(
    'fixture',
  );
});
