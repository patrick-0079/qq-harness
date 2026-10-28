import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createApplication } from '../apps/server/src/app.js';
import { extensionService, type ExtensionHost } from '@qq-harness/extension-compat';
import { configService, containerRuntimeService } from '@qq-harness/domain';
import { writeJsonAtomic } from '@qq-harness/files';

if (!process.argv.includes('--real')) throw Error('真实容器验收必须显式传 --real；不连接 QQ 或真实模型');
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.join(root, 'var', 'skill-acceptance-' + Date.now());
const folder = path.join(dataDir, 'extensions/skills/acceptance');
fs.mkdirSync(folder, { recursive: true });
writeJsonAtomic(path.join(folder, 'skill.json'), {
  id: 'acceptance',
  type: 'skill',
  scripts: ['run.js', 'hang.js', { path: 'run.py', lang: 'python' }, { path: 'run.sh', lang: 'sh' }],
});
fs.writeFileSync(
  path.join(folder, 'run.js'),
  'module.exports=({args})=>({content:"中文 "+(args.a+args.b),input:args.data});',
);
fs.writeFileSync(path.join(folder, 'hang.js'), 'module.exports=()=>{while(true){}};');
fs.writeFileSync(
  path.join(folder, 'run.py'),
  'import os\nresult={"content":"中文 "+str(args["a"]+args["b"]),"uid":os.getuid(),"home":os.environ["HOME"]}',
);
fs.writeFileSync(path.join(folder, 'run.sh'), 'printf "%s" "$1"');
const app = await createApplication({
  dataDir,
  extensionHotReload: false,
  allowedChats: ['group:999001', 'group:999002'],
  containers: { allowOperations: true },
});
const runtime = app.runtime.use(containerRuntimeService),
  host = app.runtime.use(extensionService) as ExtensionHost;
const results: Record<string, unknown> = {};
let containerId: string | undefined;
try {
  await host.configure('ext-skill', { settings: { allowNonJs: true } });
  const invoke = (script: string, lang: string, signal = new AbortController().signal) =>
    host.withTool(
      {
        chatKey: 'group:999001',
        settings: app.runtime.use(configService).effective('group:999001'),
        sent: 0,
        trace() {},
        run: {
          id: 'container-acceptance',
          signal,
          deadline: Date.now() + 15000,
          revision: 0,
          assertActive() {
            signal.throwIfAborted();
          },
        },
      },
      () =>
        host.runScript(
          {
            skillId: 'acceptance',
            script,
            lang,
            args: { a: 2, b: 3, data: '$(touch /host) `echo unsafe`' },
            argv: ['中文 $(touch /host)'],
          },
          'group:999001',
        ),
    ) as Promise<any>;
  results.fallback = await invoke('run.js', 'js');
  assert.equal((results.fallback as any).backend, 'sandbox');
  runtime.configure({
    enabled: true,
    engine: 'podman',
    image: 'localhost/qq-harness-skills:26.10',
    timeoutMs: 15000,
  });
  containerId = (await runtime.create('group:999001')).id;
  await runtime.command('group:999001', ['sh', '-c', 'printf "%s" "中文绑定验收" > rebind.txt']);
  await runtime.unbind('group:999001');
  assert.equal((await invoke('run.js', 'js')).backend, 'sandbox');
  await runtime.bind('group:999002', containerId);
  assert.notEqual(
    (await runtime.command('group:999002', ['cat', '/home/g999001/workspace/rebind.txt'])).exitCode,
    0,
  );
  await runtime.bind('group:999001', containerId);
  assert.equal((await runtime.command('group:999001', ['cat', 'rebind.txt'])).stdout, '中文绑定验收');
  await runtime.unbind('group:999002');
  await runtime.bind('group:999001', containerId);
  results.rebind = true;
  for (const [script, lang] of [
    ['run.js', 'js'],
    ['run.py', 'python'],
    ['run.sh', 'sh'],
  ]) {
    const result = await invoke(script!, lang!);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.backend, 'container');
    assert.equal(result.result.content, lang === 'sh' ? '中文 $(touch /host)' : '中文 5');
    if (lang === 'python') {
      assert(result.result.uid >= 1000);
      assert.equal(result.result.home, '/home/g999001');
    }
    results[lang!] = result;
  }
  const cancel = new AbortController(),
    pending = invoke('hang.js', 'js', cancel.signal);
  setTimeout(() => cancel.abort(), 300);
  const cancelled = await pending;
  assert.equal(cancelled.ok, false);
  assert.equal((await runtime.inspect('group:999001')).running, true);
  results.cancelled = true;
  const again = await invoke('run.js', 'js');
  assert.equal(again.ok, true);
  results.restart = true;
  results.owner = runtime.bindings().map((b) => ({ chatKey: b.chatKey, image: b.image }));
} finally {
  for (const chat of ['group:999001', 'group:999002']) await runtime.unbind(chat);
  if (containerId) await runtime.removeExisting(containerId);
  else if (runtime.has('group:999001')) await runtime.remove('group:999001');
  await app.stop();
}
writeJsonAtomic(path.join(dataDir, 'acceptance.json'), {
  at: new Date().toISOString(),
  results,
});
console.log(JSON.stringify({ passed: true, dataDir, checks: Object.keys(results) }));
