import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService, type ExtensionHost } from '@qq-harness/extension-compat';
import { containerRuntimeService, toolService, configService } from '@qq-harness/domain';
import { fakeContainerCli } from './fixtures/container-cli.js';
import { TASK_SCRIPT } from '../plugins/container-runtime/src/task-process.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
async function boot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-skill-execution-'));
  const dir = path.join(dataDir, 'extensions/skills/calculator');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'skill.json'),
    JSON.stringify({
      id: 'calculator',
      type: 'skill',
      scripts: ['run.js', 'hang.js', { path: 'run.py', lang: 'python' }],
    }),
  );
  fs.writeFileSync(path.join(dir, 'run.js'), 'module.exports=({args})=>({content:String(args.a+args.b)});');
  fs.writeFileSync(path.join(dir, 'hang.js'), 'module.exports=()=>new Promise(()=>{});');
  fs.writeFileSync(path.join(dir, 'run.py'), 'result={"content":str(args["a"]+args["b"])}');
  const fake = fakeContainerCli();
  const scripts: { args: string[]; stdin?: string }[] = [];
  let fail = false;
  const app = await createApplication({
    dataDir,
    extensionHotReload: false,
    containers: {
      allowOperations: true,
      cli: async (binary, args, options) => {
        if (args[1] === 'exec' && args.at(-1) === TASK_SCRIPT) {
          scripts.push({ args, stdin: options.stdin });
          if (fail)
            return {
              exitCode: 127,
              stdout: '',
              stderr: 'interpreter missing',
              truncated: false,
            };
          const task = JSON.parse(options.stdin!);
          expect(task.username).toBe('g1');
          expect(task.uid).toBeGreaterThanOrEqual(1000);
          const job = JSON.parse(task.stdin);
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              result: { content: String(job.args.a + job.args.b) },
              logs: [],
            }),
            stderr: '',
            truncated: false,
          };
        }
        return fake.cli(binary, args, options);
      },
    },
  });
  cleanups.push(async () => {
    await app.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const host = app.runtime.use(extensionService) as ExtensionHost;
  await host.configure('ext-skill', { settings: { allowNonJs: true } });
  const call = (script: string, lang = 'js') =>
    host.runScript(
      { skillId: 'calculator', script, lang, args: { a: 2, b: 3 }, argv: [] },
      'group:1',
    ) as Promise<any>;
  return {
    app,
    host,
    call,
    scripts,
    fake,
    setFail: () => {
      fail = true;
    },
  };
}

test('无容器真实 JS Worker 降级；非 JS 不在宿主机执行', async () => {
  const f = await boot();
  expect(await f.call('run.js')).toMatchObject({
    ok: true,
    backend: 'sandbox',
    result: { content: '5' },
    degradedFrom: 'container',
  });
  expect(await f.call('run.py', 'python')).toMatchObject({
    ok: false,
    backend: 'sandbox',
    error: expect.stringContaining('只支持 js'),
  });
  expect(f.scripts).toEqual([]);
});

test.each(['podman', 'docker'] as const)(
  '%s 绑定后 JS/Python 使用受控 stdin；失败不回退宿主',
  async (engine) => {
    const f = await boot();
    const runtime = f.app.runtime.use(containerRuntimeService);
    runtime.configure({ enabled: true, engine });
    await runtime.create('group:1');
    for (const [file, lang] of [
      ['run.js', 'js'],
      ['run.py', 'python'],
    ])
      expect(await f.call(file!, lang)).toMatchObject({
        ok: true,
        backend: 'container',
        result: { content: '5' },
      });
    expect(f.scripts).toHaveLength(2);
    expect(JSON.parse(JSON.parse(f.scripts[0]!.stdin!).stdin).source).toContain('module.exports');
    expect(f.scripts[0]!.args.some((a) => a.includes('args.a+args.b'))).toBe(false);
    f.setFail();
    expect(await f.call('run.js')).toMatchObject({
      ok: false,
      backend: 'container',
      error: expect.stringContaining('interpreter missing'),
    });
    await f.app.runtime.setEnabled('container-session', false);
    expect(await f.call('run.js')).toMatchObject({
      ok: true,
      backend: 'sandbox',
    });
  },
);

test.each(['run', 'extension'] as const)('%s 取消会终止挂起 Worker，且保留调用隔离', async (kind) => {
  const f = await boot();
  const controller = new AbortController();
  const promise = f.host.withTool(
    {
      chatKey: 'group:1',
      settings: f.app.runtime.use(configService).effective('group:1'),
      sent: 0,
      trace() {},
      run: {
        id: 'cancel-skill',
        signal: controller.signal,
        deadline: Date.now() + 5000,
        revision: 0,
        assertActive() {
          controller.signal.throwIfAborted();
        },
      },
    },
    () => f.call('hang.js'),
  );
  await new Promise((r) => setTimeout(r, 50));
  if (kind === 'run') controller.abort();
  else await f.host.configure('calculator', { enabled: false });
  expect(await promise).toMatchObject({
    ok: false,
    cancelled: true,
    backend: 'sandbox',
  });
  if (kind === 'extension') await f.host.configure('calculator', { enabled: true });
  expect(await f.call('run.js')).toMatchObject({ ok: true });
});
