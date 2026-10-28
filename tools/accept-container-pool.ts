// Explicit manual acceptance, isolated data/mock QQ/model; only test-owned containers are mutated.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../apps/server/src/app.js';
import { containerRuntimeService, containerJobsService, adapterService } from '@qq-harness/domain';
import { runContainerCli } from '@qq-harness/container-runtime';
import { writeJsonAtomic } from '@qq-harness/files';
if (!process.argv.includes('--real')) throw Error('需要显式 --real；使用独立数据和 mock QQ');
const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = fs.mkdtempSync(path.join(root, 'var/container-pool-acceptance-'));
const create = () =>
  createApplication({
    dataDir,
    extensionHotReload: false,
    v2Managers: false,
    allowedChats: ['group:999001', 'private:999002'],
    containers: { allowOperations: true },
  });
let app = await create();
const ids: string[] = [],
  checks: Record<string, unknown> = {};
const A = 'group:999001',
  B = 'private:999002';
const until = async (fn: () => boolean) => {
  const deadline = Date.now() + 15000;
  while (!fn()) {
    if (Date.now() > deadline) throw Error('等待超时');
    await new Promise((r) => setTimeout(r, 60));
  }
};
try {
  let runtime = app.runtime.use(containerRuntimeService);
  runtime.configure({
    enabled: true,
    engine: 'podman',
    image: 'localhost/qq-harness-skills:26.10',
    timeoutMs: 15000,
  });
  const first = await runtime.createResource();
  ids.push(first.id);
  const second = await runtime.createResource();
  ids.push(second.id);
  await runtime.setBindings(A, ids, first.id);
  await runtime.bind(B, first.id);
  assert.equal(runtime.bindings().length, 3);
  checks.manyToMany = true;
  const identity = JSON.parse(
    (
      await runtime.command(A, [
        'python3',
        '-c',
        "import os,json;print(json.dumps({'uid':os.getuid(),'gid':os.getgid(),'home':os.environ['HOME'],'tmp':os.environ['TMPDIR'],'cwd':os.getcwd(),'status':open('/proc/self/status').read()}))",
      ])
    ).stdout,
  );
  assert(identity.uid >= 1000);
  assert.equal(identity.cwd, '/home/g999001/workspace');
  assert.match(identity.status, /CapEff:\s+0000000000000000/);
  assert.match(identity.status, /NoNewPrivs:\s+1/);
  checks.identity = {
    uid: identity.uid,
    gid: identity.gid,
    home: identity.home,
    tmp: identity.tmp,
    capabilities: 0,
    noNewPrivs: true,
  };
  const text = '中文权限验收';
  assert.equal(
    (await runtime.command(A, ['sh', '-c', 'printf "%s" "$1" > secret.txt', 'sh', text])).exitCode,
    0,
  );
  assert.equal((await runtime.command(A, ['cat', 'secret.txt'])).stdout, text);
  const denied = await runtime.command(B, ['cat', '/home/g999001/workspace/secret.txt']);
  assert.notEqual(denied.exitCode, 0);
  assert.match(denied.stderr, /Permission denied/);
  const mode = await runtime.command(A, [
    'stat',
    '-c',
    '%a',
    '/home/g999001',
    '/home/g999001/workspace',
    '/home/g999001/.tmp',
  ]);
  assert.equal(mode.stdout.trim(), '700\n700\n700');
  const other = await runtime.command(A, ['cat', 'secret.txt'], undefined, undefined, second.id);
  assert.notEqual(other.exitCode, 0);
  checks.privateFilesAndSelection = true;
  const jobs = app.runtime.use(containerJobsService);
  const victim = jobs.start(A, { command: 'echo $$; sleep 60' });
  await until(() => jobs.get(A, victim.id).stdout.trim().length > 0);
  const victimPid = Number(jobs.get(A, victim.id).stdout.trim());
  assert(Number.isInteger(victimPid) && victimPid > 1);
  const killAttempt = await runtime.command(B, [
    'python3',
    '-c',
    'import os,signal,sys;os.kill(int(sys.argv[1]),signal.SIGTERM)',
    String(victimPid),
  ]);
  assert.notEqual(killAttempt.exitCode, 0);
  assert.match(killAttempt.stderr, /PermissionError/);
  await jobs.cancel(A, victim.id);
  checks.crossUserSignalDenied = true;
  const sibling = jobs.start(B, { command: 'echo sibling-ready; sleep 4; echo sibling-done' });
  await until(() => jobs.get(B, sibling.id).stdout.includes('sibling-ready'));
  const cancel = jobs.start(A, {
    command:
      "python3 -c 'import os,time;pid=os.fork();os.setsid() if pid==0 else None;child=os.fork() if pid==0 else -1;os._exit(0) if child>0 else None;time.sleep(60)'",
  });
  await until(() => jobs.get(A, cancel.id).stdout.length > 0 || Date.now() - cancel.createdAt > 800);
  // Root inspection is restricted to this newly-created test container.
  const probe = async () =>
    runContainerCli(
      first.binary,
      [
        'container',
        'exec',
        '--user',
        '0',
        first.id,
        'python3',
        '-c',
        "import os,json;print(json.dumps([{'pid':int(p),'uid':os.stat('/proc/'+p).st_uid} for p in os.listdir('/proc') if p.isdigit()]))",
      ],
      { signal: AbortSignal.timeout(5000), maxOutputChars: 10000 },
    );
  const before = JSON.parse((await probe()).stdout);
  assert(before.some((p: any) => p.uid === identity.uid));
  assert.equal((await jobs.cancel(A, cancel.id)).status, 'cancelled');
  const after = JSON.parse((await probe()).stdout);
  assert(!after.some((p: any) => p.uid === identity.uid), 'cancelled process tree remains');
  assert((await runtime.inspect(B)).running);
  await until(() => jobs.get(B, sibling.id).status !== 'running');
  assert.equal(jobs.get(B, sibling.id).status, 'completed');
  assert.match(jobs.get(B, sibling.id).stdout, /sibling-done/);
  checks.cancelOnePreservesSiblingAndContainer = true;
  await assert.rejects(runtime.execute(A, { command: 'sleep 60', timeoutMs: 1000 }));
  assert((await runtime.inspect(A)).running);
  checks.timeoutKeepsContainer = true;
  await runtime.stopResource(first.id);
  await assert.rejects(runtime.command(A, ['id']), /停用/);
  await runtime.startResource(first.id);
  checks.adminDisableEnforced = true;
  await app.runtime.setEnabled('container-runtime', false);
  const inspect = await runContainerCli(first.binary, ['container', 'inspect', first.id], {
    signal: AbortSignal.timeout(5000),
    maxOutputChars: 65536,
  });
  assert.equal(JSON.parse(inspect.stdout)[0].State.Running, true);
  await app.runtime.setEnabled('container-runtime', true);
  runtime = app.runtime.use(containerRuntimeService);
  assert.equal(runtime.bindings().length, 3);
  checks.unloadPreservesPool = true;
  await app.stop();
  app = await create();
  runtime = app.runtime.use(containerRuntimeService);
  assert.equal(runtime.bindings().length, 3);
  assert.equal((await runtime.command(A, ['cat', 'secret.txt'])).stdout, text);
  checks.restartPreservesAccountsAndFiles = true;
  assert.equal(app.runtime.use(adapterService).sent?.length, 0);
  checks.qqMessagesSent = 0;
} finally {
  const runtime = app.runtime.use(containerRuntimeService);
  for (const chat of [A, B]) await runtime.stop(chat).catch(() => {});
  for (const chat of [A, B]) await runtime.unbind(chat).catch(() => {});
  for (const id of ids) await runtime.removeExisting(id);
  await app.stop();
}
writeJsonAtomic(path.join(dataDir, 'acceptance.json'), {
  at: new Date().toISOString(),
  engine: 'podman',
  image: 'localhost/qq-harness-skills:26.10',
  checks,
  cleaned: ids,
});
console.log(JSON.stringify({ passed: true, dataDir, checks }));
