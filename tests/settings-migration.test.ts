import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  convertSettings,
  readBuiltinPersonas,
  readBuiltinPrompt,
  migrateSettings,
} from '../tools/migrate-settings.js';

function legacy() {
  return {
    api: {
      baseUrl: 'https://stale.invalid/v1',
      apiKey: 'old-key',
      provider: 'current',
      model: 'model-a',
      timeoutMs: 90000,
      maxRounds: 8,
    },
    providers: [{ id: 'current', baseURL: 'https://current.invalid/v1', apiKey: 'older-provider-key' }],
    dshProviderKeys: { current: 'actual-provider-key' },
    persona: { personaId: 'custom-a', botName: '角色甲', participation: 'medium', customRules: '附加规则' },
    customPersonas: [
      { id: 'custom-a', name: '甲', text: '完整原始角色卡甲' },
      { id: 'unused', name: '备用', text: '备用角色原文' },
    ],
    prompts: {
      defaultId: 'prompt-a',
      items: [{ id: 'prompt-a', content: '{botName}/{roleText}/{participation}' }],
    },
    snowluma: {
      wsUrl: 'ws://127.0.0.1:3001',
      httpUrl: 'http://127.0.0.1:3000',
      accessToken: 'ws-secret',
      httpAccessToken: 'http-secret',
    },
    run: { timeoutMs: 600000 },
    availability: { online: true },
    globalBlocklist: ['99'],
    acceptAllSessions: false,
  };
}
test('迁移人设引用、提示词占位符和渠道凭据优先级，摘要不泄露内容', () => {
  const source = legacy();
  const result = convertSettings(
    source,
    [{ key: 'group:123', config: { persona: { personaId: 'builtin' }, availability: { online: false } } }],
    { builtin: { name: '内置', text: '内置角色正文' } },
    '内置风格规则',
  );
  expect(result.config.defaults.persona).toContain('完整原始角色卡甲');
  expect(result.config.defaults.persona).toContain('角色甲/完整原始角色卡甲/');
  expect(result.config.defaults.persona).toContain('send_message({"messages":["正文","下一条"]})');
  expect(result.config.defaults.persona).toContain('"silentReason":"不发言的原因"');
  expect(result.config.profiles['group:123']).toMatchObject({ online: false, runTimeoutMs: 600000 });
  expect(result.config.profiles['group:123']?.persona).toContain('内置角色正文');
  expect(result.config.model).toMatchObject({
    apiKey: 'actual-provider-key',
    baseUrl: 'https://current.invalid/v1',
    model: 'model-a',
  });
  expect(result.config.onebot).toMatchObject({ accessToken: 'ws-secret', httpAccessToken: 'http-secret' });
  expect(result.config.admissions).toEqual(['group:123']);
  expect(result.config.deniedUsers).toEqual(['99']);
  expect(result.catalog.customPersonas).toEqual(source.customPersonas);
  expect(JSON.stringify(result.summary)).not.toMatch(
    /actual-provider-key|ws-secret|http-secret|角色正文|group:123/,
  );
});
test('空提示词库保留内置风格；空会话模型继承默认；独立会话模型完整保留', () => {
  const source = legacy();
  source.prompts = { defaultId: '', items: [] };
  const result = convertSettings(
    source,
    [{ key: 'private:456', config: { api: { model: '', provider: '' }, persona: { personaId: '' } } }],
    {},
    '内置风格规则',
  );
  expect(result.config.profiles['private:456']?.persona).toContain('内置风格规则');
  expect(result.config.model.model).toBe('model-a');
  expect(convertSettings(source, [{ key: 'private:456', config: { api: { model: 'different' } } }], {}, 'rules').config.profiles['private:456']?.modelSelection.model).toBe('different');
  expect(() =>
    convertSettings(
      source,
      [{ key: 'private:456', config: { persona: { personaId: 'missing' } } }],
      {},
      'rules',
    ),
  ).toThrow('引用无法解析');
});
test('解析旧源码仅接受字面量，拒绝执行表达式；提示词形态漂移会失败', () => {
  expect(readBuiltinPersonas('export const PERSONAS = { a: { name: "甲", text: `角色\\n正文` } };')).toEqual({
    a: { name: '甲', text: '角色\n正文' },
  });
  expect(() => readBuiltinPersonas('export const PERSONAS = { a: getSecret() };')).toThrow('可执行表达式');
  const names = [
    'securityRules',
    'antiAiFlavor',
    'subjectivity',
    'notAQueue',
    'humanRhythm',
    'notModerator',
    'reportBan',
  ];
  const prompt = names
    .map((name) => `function ${name}(){ return ['${name}', '原文'].join('\\n'); }`)
    .join('\n');
  expect(readBuiltinPrompt(prompt)).toContain('securityRules\n原文');
  expect(() => readBuiltinPrompt('function securityRules() { return readDisk(); }')).toThrow('结构变化');
});

test('离线迁移演练不落盘，应用保留来源、生成凭据并拒绝覆盖目标', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-migration-'));
  const varRoot = fileURLToPath(new URL('../var/', import.meta.url));
  const target = path.join(varRoot, 'migration-test-' + randomUUID());
  try {
    fs.mkdirSync(path.join(source, 'data/chat-configs'), { recursive: true });
    fs.mkdirSync(path.join(source, 'src'));
    const input = JSON.stringify(legacy());
    fs.writeFileSync(path.join(source, 'data/config.json'), input);
    fs.writeFileSync(
      path.join(source, 'data/chat-configs/group-123.json'),
      JSON.stringify({ key: 'group:123', config: {} }),
    );
    fs.writeFileSync(path.join(source, 'src/personas.js'), 'export const PERSONAS = {};');
    fs.writeFileSync(
      path.join(source, 'src/prompt.js'),
      [
        'securityRules',
        'antiAiFlavor',
        'subjectivity',
        'notAQueue',
        'humanRhythm',
        'notModerator',
        'reportBan',
      ]
        .map((name) => `function ${name}(){return ["规则"].join("\\n");}`)
        .join('\n'),
    );
    expect(migrateSettings(source, target)).toMatchObject({ applied: false, profiles: 1 });
    expect(fs.existsSync(target)).toBe(false);
    expect(migrateSettings(source, target, true)).toMatchObject({ applied: true, profiles: 1 });
    expect(fs.readFileSync(path.join(source, 'data/config.json'), 'utf8')).toBe(input);
    const saved = JSON.parse(fs.readFileSync(path.join(target, 'config.json'), 'utf8'));
    expect(saved.model.apiKey).toBe('actual-provider-key');
    const launch = JSON.parse(fs.readFileSync(path.join(target, 'launch.json'), 'utf8'));
    expect(launch.allowedChats).toBeUndefined();
    expect(launch.token.length).toBeGreaterThanOrEqual(32);
    expect(() => migrateSettings(source, target, true)).toThrow('拒绝覆盖');
  } finally {
    if (
      path.dirname(fs.realpathSync(source)) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(source).startsWith('harness-migration-')
    )
      throw new Error('临时来源目录越界');
    fs.rmSync(source, { recursive: true, force: true });
    if (fs.existsSync(target)) {
      if (
        path.dirname(fs.realpathSync(target)) !== fs.realpathSync(varRoot) ||
        !path.basename(target).startsWith('migration-test-')
      )
        throw new Error('临时目标目录越界');
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
});
