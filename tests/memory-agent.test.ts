import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import {
  configService,
  memoryAgentService,
  memoryService,
  memoryRepository,
  modelService,
  storageService,
  toolService,
  type ModelResponse,
} from '@qq-harness/domain';
import type { MemoryRequest, MemoryRecord } from '@qq-harness/contracts';
const apps: Awaited<ReturnType<typeof createApplication>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of apps.splice(0).reverse()) await app.stop();
});
const output = (...calls: [string, unknown][]): ModelResponse => ({
  message: {
    role: 'assistant',
    content: null,
    tool_calls: calls.map(([name, args], i) => ({
      id: String(i),
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    })),
  },
  usage: { input: 2, output: 3 },
});
const done: [string, unknown] = ['memory_finish', { summary: '已完成指定维护' }];
async function boot(options: Partial<Parameters<typeof createApplication>[0]> = {}) {
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-memory-agent-')),
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: { acceptAllSessions: true, paused: true },
    ...options,
  });
  apps.push(app);
  return app;
}
export async function memoryTask(
  app: Awaited<ReturnType<typeof createApplication>>,
  id: string,
  key = 'group:1',
) {
  const until = Date.now() + 5000;
  for (;;) {
    const task = app.runtime
      .use(memoryAgentService)
      .requests(key)
      .find((t) => t.id === id)!;
    if (!['queued', 'running'].includes(task.status)) return task;
    if (Date.now() > until) throw Error('记忆任务未完成：' + JSON.stringify(task));
    await new Promise((r) => setTimeout(r, 5));
  }
}
function seed(
  app: Awaited<ReturnType<typeof createApplication>>,
  text = '火箭速度 2 km/s\n\n约定周五讨论',
  tier: 'short' | 'medium' | 'long' = 'medium',
  chatKey = 'group:1',
) {
  return app.runtime.use(memoryService).remember({
    scope: 'chat',
    tier,
    chatKey,
    personId: null,
    key: 'rocket-' + tier,
    text,
    document: tier === 'short' ? undefined : { title: '火箭知识', topic: 'rocket', role: 'knowledge' },
    visibility: 'chat_only',
    sensitive: false,
    confidence: 1,
    importance: 0.5,
    pinned: false,
    sources: [],
    origin: 'admin',
    expiresAt: tier === 'long' ? null : Date.now() + 86400000,
  });
}
const update = (r: MemoryRecord, content: string, extra = {}) => ({
  id: r.id,
  expectedRevision: r.revision,
  tier: r.tier,
  scope: r.scope,
  key: r.key,
  content,
  ...extra,
});

test('申请异步受理，独立模型看到当前人设和旧文档，融合提交后立即可读', async () => {
  const app = await boot(),
    agent = app.runtime.use(memoryAgentService),
    old = seed(app);
  const model = vi
    .spyOn(app.runtime.use(modelService), 'complete')
    .mockResolvedValue(output(['memory_write', update(old, '火箭速度 10 km/s\n\n约定周五讨论')], done));
  const task = agent.request({
    chatKey: 'group:1',
    tier: 'medium',
    instruction: '速度更新到10 km/s，保留其他约定',
    targetIds: [old.id],
    idempotencyKey: 'one',
  });
  expect(task.status).toBe('queued');
  expect(agent.read('group:1', old.id)?.text).toContain('2 km/s');
  const result = await memoryTask(app, task.id);
  expect(result.status, result.error).toBe('completed');
  expect(agent.read('group:1', old.id)?.text).toBe('火箭速度 10 km/s\n\n约定周五讨论');
  expect(
    app.runtime
      .use(memoryService)
      .history(old.id, 'group:1')
      .map((h) => h.record.text),
  ).toContain(old.text);
  expect(JSON.stringify(model.mock.calls[0]![0])).toContain('当前人设');
  expect(JSON.stringify(model.mock.calls[0]![0])).toContain('2 km/s');
  expect(agent.request({ chatKey: 'group:1', instruction: '不会重复', idempotencyKey: 'one' }).id).toBe(
    task.id,
  );
});

test('模型工具只有查询、读取、申请与状态，维护写入工具不对对话暴露', async () => {
  const app = await boot(),
    names = app.runtime
      .use(toolService)
      .list('group:1')
      .map((t) => t.function.name);
  expect(names).toEqual(
    expect.arrayContaining(['memory_search', 'memory_get', 'memory_request', 'memory_request_status']),
  );
  for (const name of ['memory_write', 'memory_forget', 'memory_finish', 'memory_update', 'memory_delete'])
    expect(names).not.toContain(name);
});

test('明确遗忘仅影响中期匹配内容，保留其他内容和长期文档，旧结论不能重新写入', async () => {
  const app = await boot(),
    agent = app.runtime.use(memoryAgentService),
    mid = seed(app),
    long = seed(app, '长期另有知识', 'long');
  const model = vi
    .spyOn(app.runtime.use(modelService), 'complete')
    .mockResolvedValue(
      output(['memory_write', update(mid, '约定周五讨论', { forgottenText: '火箭速度 2 km/s' })], done),
    );
  const task = agent.request({
    chatKey: 'group:1',
    tier: 'medium',
    instruction: '遗忘中期记忆：火箭速度 2 km/s',
  });
  expect((await memoryTask(app, task.id)).status).toBe('completed');
  expect(agent.read('group:1', mid.id)?.text).toBe('约定周五讨论');
  expect(agent.read('group:1', long.id)?.text).toBe('长期另有知识');
  const current = agent.read('group:1', mid.id) as MemoryRecord;
  model.mockResolvedValue(output(['memory_write', update(current, '火箭速度 2 km/s')], done));
  const replay = agent.request({ chatKey: 'group:1', tier: 'medium', instruction: '从旧来源重新整理' });
  expect((await memoryTask(app, replay.id)).status).toBe('failed');
  expect(agent.read('group:1', mid.id)?.text).toBe('约定周五讨论');
});

test.each(['sqlite', 'files'] as const)('%s 多文档提交失败全部回滚，任务报告失败', async (storage) => {
  const app = await boot({ storage }),
    agent = app.runtime.use(memoryAgentService),
    first = seed(app),
    second = seed(app, '第二份', 'long');
  vi.spyOn(app.runtime.use(modelService), 'complete').mockResolvedValue(
    output(['memory_write', update(first, '修改一')], ['memory_write', update(second, '修改二')], done),
  );
  const repo = app.runtime.use(memoryRepository),
    save = repo.saveControl.bind(repo);
  let injected = false;
  vi.spyOn(repo, 'saveControl').mockImplementation((value) => {
    if (!injected && JSON.stringify(value).includes('"status":"completed"')) {
      injected = true;
      throw Error('模拟提交失败');
    }
    save(value);
  });
  const task = agent.request({ chatKey: 'group:1', instruction: '同时更新两份文档' });
  expect((await memoryTask(app, task.id)).status).toBe('failed');
  expect(agent.read('group:1', first.id)?.text).toBe(first.text);
  expect(agent.read('group:1', second.id)?.text).toBe(second.text);
});

test('人设可演进，切换与切回重新初始化，其他知识保留，同人设保存不重置', async () => {
  const app = await boot(),
    cfg = app.runtime.use(configService),
    agent = app.runtime.use(memoryAgentService);
  cfg.patch({
    personas: [
      { id: 'shy', name: '胆小', text: '我是胆小的人，倾向少记恐怖细节' },
      { id: 'bold', name: '勇敢', text: '我是勇敢的人' },
    ],
    defaults: { personaSelection: { personaId: 'shy' } },
  });
  expect(agent.persona('group:1')).toContain('胆小');
  const initial = agent.list('group:1', 'long').find((r) => r.document?.role === 'persona')!;
  const knowledge = seed(app, '喜欢茶', 'long');
  vi.spyOn(app.runtime.use(modelService), 'complete').mockResolvedValue(
    output(['memory_write', update(initial, '我依然胆小，但逐渐敢于尝试新事物')], done),
  );
  const task = agent.request({
    chatKey: 'group:1',
    tier: 'long',
    instruction: '根据经历更新自我认知',
    targetIds: [initial.id],
  });
  expect((await memoryTask(app, task.id)).status).toBe('completed');
  expect(agent.persona('group:1')).toContain('逐渐');
  cfg.saveProfile('group:1', { personaSelection: { personaId: 'bold' } });
  expect(agent.persona('group:1')).toBe('我是勇敢的人');
  cfg.saveProfile('group:1', { personaSelection: { personaId: 'shy' } });
  expect(agent.persona('group:1')).toBe('我是胆小的人，倾向少记恐怖细节');
  expect(agent.read('group:1', knowledge.id)?.text).toBe('喜欢茶');
  const id = agent.list('group:1', 'long').find((r) => r.document?.role === 'persona')!.id;
  cfg.saveProfile('group:1', { maxRounds: 8 });
  expect(agent.list('group:1', 'long').find((r) => r.document?.role === 'persona')!.id).toBe(id);
});

test('有歧义时返回待澄清，暂存修改不提交；补充后可继续', async () => {
  const app = await boot(),
    agent = app.runtime.use(memoryAgentService),
    old = seed(app);
  const model = vi
    .spyOn(app.runtime.use(modelService), 'complete')
    .mockResolvedValue(
      output(
        ['memory_write', update(old, '不应提交')],
        ['memory_finish', { summary: '需要澄清', clarification: '要遗忘哪一项？' }],
      ),
    );
  const task = agent.request({ chatKey: 'group:1', instruction: '忘掉那个' });
  expect((await memoryTask(app, task.id)).status).toBe('needs_clarification');
  expect(agent.read('group:1', old.id)?.text).toBe(old.text);
  model.mockResolvedValue(output(['memory_write', update(old, '保留明确约定')], done));
  agent.clarify('group:1', task.id, '只改火箭部分');
  expect((await memoryTask(app, task.id)).status).toBe('completed');
});

test('非法来源或跨层写入不提交，也不推进提炼游标', async () => {
  const app = await boot(),
    agent = app.runtime.use(memoryAgentService),
    old = seed(app, '长期内容', 'long');
  vi.spyOn(app.runtime.use(modelService), 'complete').mockResolvedValue(
    output(['memory_write', update(old, '篡改长期')], done),
  );
  const task = agent.request({
    chatKey: 'group:1',
    tier: 'short',
    instruction: '提炼短期',
    origin: 'schedule',
  });
  expect((await memoryTask(app, task.id)).status).toBe('failed');
  expect(agent.read('group:1', old.id)?.text).toBe('长期内容');
  expect(app.runtime.use(memoryRepository).cursor('group:1')).toBe(0);
  expect(() => agent.request({ chatKey: 'group:1', instruction: '记录', sourceIds: [999] })).toThrow(
    '来源消息',
  );
  const foreign = seed(app, '其他群', 'long', 'group:2');
  expect(() => agent.request({ chatKey: 'group:1', instruction: '删除', targetIds: [foreign.id] })).toThrow(
    '目标不属于',
  );
});

test('personId安全整数规范化，失败细节可读，GET不触发写入或清理', async () => {
  const app = await boot(),
    agent = app.runtime.use(memoryAgentService),
    storage = app.runtime.use(storageService);
  const source = storage.append({
    id: 'm',
    chatKey: 'group:1',
    senderId: '2',
    senderName: '测试',
    text: '喜欢茶',
    atMe: false,
    timestamp: Date.now(),
  });
  vi.spyOn(app.runtime.use(modelService), 'complete').mockResolvedValue(
    output(
      [
        'memory_write',
        {
          tier: 'short',
          scope: 'chat_person',
          personId: 2,
          key: 'drink',
          content: '喜欢茶',
          sourceIds: [source.localId],
        },
      ],
      done,
    ),
  );
  const task = agent.request({ chatKey: 'group:1', instruction: '记录偏好', sourceIds: [source.localId] });
  const result = await memoryTask(app, task.id);
  expect(result.status, result.error).toBe('completed');
  expect(agent.list('group:1', 'short')[0]?.personId).toBe('2');
  const repo = app.runtime.use(memoryRepository),
    before = JSON.stringify({ state: repo.control(), seq: repo.latestIndexSequence() });
  for (const route of ['records', 'notes', 'requests', 'consolidation', 'documents'])
    expect((await app.app.request(`http://127.0.0.1/api/memory/${route}?chatKey=group%3A1`)).status).toBe(
      200,
    );
  expect(JSON.stringify({ state: repo.control(), seq: repo.latestIndexSequence() })).toBe(before);
});

test('运行中切换人设会丢弃旧暂存结果，重排后结合新的人设处理', async () => {
  const app = await boot(),
    cfg = app.runtime.use(configService),
    agent = app.runtime.use(memoryAgentService);
  cfg.patch({
    personas: [
      { id: 'shy', name: '胆小', text: '胆小的初始人设' },
      { id: 'bold', name: '勇敢', text: '勇敢的初始人设' },
    ],
    defaults: { personaSelection: { personaId: 'shy' } },
  });
  agent.persona('group:1');
  const old = agent.list('group:1', 'long').find((r) => r.document?.role === 'persona')!;
  let release!: (response: ModelResponse) => void;
  const model = vi
    .spyOn(app.runtime.use(modelService), 'complete')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(output(done));
  const task = agent.request({ chatKey: 'group:1', instruction: '更新自我认知' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  cfg.saveProfile('group:1', { personaSelection: { personaId: 'bold' } });
  release(output(['memory_write', update(old, '不能污染新的人设')], done));
  expect((await memoryTask(app, task.id)).status).toBe('completed');
  expect(agent.persona('group:1')).toBe('勇敢的初始人设');
  expect(model).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(model.mock.calls[1]![0])).toContain('勇敢的初始人设');
  expect(agent.list('group:1').some((r) => r.text === '不能污染新的人设')).toBe(false);
});

test('维护进程退出后恢复已受理任务，重启不丢申请也不重复提交', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-memory-restart-'));
  const first = await boot({ dataDir });
  vi.spyOn(first.runtime.use(modelService), 'complete').mockImplementation(
    (_messages, _tools, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  const task = first.runtime
    .use(memoryAgentService)
    .request({ chatKey: 'group:1', instruction: '记住：重启恢复验证', tier: 'short' });
  await vi.waitFor(() =>
    expect(
      first.runtime
        .use(memoryAgentService)
        .requests('group:1')
        .find((t) => t.id === task.id)?.status,
    ).toBe('running'),
  );
  await first.stop();
  const second = await boot({ dataDir });
  const result = await memoryTask(second, task.id);
  expect(result.status, result.error).toBe('completed');
  expect(
    second.runtime
      .use(memoryAgentService)
      .list('group:1', 'short')
      .filter((r) => r.text === '重启恢复验证'),
  ).toHaveLength(1);
});

test('兼容文本被遗忘后，读取不会回退旧文件而复活原文', async () => {
  const app = await boot(),
    storage = app.runtime.use(storageService),
    agent = app.runtime.use(memoryAgentService);
  storage.setMemory('group:1', '应遗忘的旧文本');
  const imported = agent.request({ chatKey: 'group:1', instruction: '保留已有文本，不新增内容' });
  await memoryTask(app, imported.id);
  const targets = agent.list('group:1').filter((r) => r.key.startsWith('legacy-text'));
  const task = agent.request({
    chatKey: 'group:1',
    instruction: '遗忘兼容文本记忆',
    targetIds: targets.map((r) => r.id),
  });
  expect((await memoryTask(app, task.id)).status).toBe('completed');
  expect(await (await app.app.request('http://127.0.0.1/api/chats/group%3A1/memory')).json()).toEqual({
    text: '',
  });
});

test('演进人设只替换角色内容，保留提示词模板、附加规则和后续兼容输入', async () => {
  let compatibilityRole = '';
  const app = await boot({
    plugins: [
      {
        id: 'persona-compatibility-observer',
        setup(ctx) {
          ctx.on<{ chatKey: string; persona: string; extra: string; roleText?: string }>(
            'prompt.segments',
            (value) => {
              compatibilityRole = value.roleText ?? '';
              return value;
            },
            90,
          );
        },
      },
    ],
  });
  const cfg = app.runtime.use(configService),
    agent = app.runtime.use(memoryAgentService);
  cfg.patch({
    personas: [{ id: 'role', name: '测试助手', text: '最初的人设' }],
    prompts: [
      { id: 'template', name: '保留模板', text: '模板约束：{botName}；角色={roleText}；{participation}' },
    ],
    defaults: {
      personaSelection: { personaId: 'role', promptId: 'template', rules: '管理员附加规则必须保留' },
    },
  });
  agent.persona('group:1');
  const persona = agent.list('group:1', 'long').find((r) => r.document?.role === 'persona')!;
  const model = vi
    .spyOn(app.runtime.use(modelService), 'complete')
    .mockResolvedValue(output(['memory_write', update(persona, '演进后的自我认知')], done));
  const task = agent.request({
    chatKey: 'group:1',
    instruction: '根据经历演进人设',
    targetIds: [persona.id],
    tier: 'long',
  });
  expect((await memoryTask(app, task.id)).status).toBe('completed');
  model.mockResolvedValue(output(['finish', { mode: 'silent', silentReason: '只读提示词验收' }]));
  cfg.patch({ paused: false });
  cfg.saveProfile('group:1', { online: true });
  const run = app.runtime.submit({
    mode: 'agent.basic',
    partitionKey: 'group:1',
    input: { chatKey: 'group:1', ids: [], proactive: true },
  });
  expect((await app.runtime.wait(run.id)).status).toBe('completed');
  const system = model.mock.calls.at(-1)![0][0]!.content;
  expect(system).toContain('演进后的自我认知');
  expect(system).toContain('模板约束：测试助手；角色=演进后的自我认知');
  expect(system).toContain('管理员附加规则必须保留');
  expect(compatibilityRole).toBe('演进后的自我认知');
  expect(agent.persona('group:1')).toBe('演进后的自我认知');
});
