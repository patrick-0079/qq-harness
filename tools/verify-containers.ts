// 人工容器验收：使用独立数据、mock QQ 和模型，只创建/删除带本工程归属标签的临时容器。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../apps/server/src/app.js';
import { containerRuntimeService, containerJobsService, adapterService } from '@qq-harness/domain';
import { runContainerCli } from '@qq-harness/container-runtime';
import type { ContainerBinding } from '@qq-harness/contracts';

const root = fileURLToPath(new URL('../', import.meta.url));
const engine = process.argv.find((v) => v.startsWith('--engine='))?.slice(9) ?? 'podman';
const image = process.argv.find((v) => v.startsWith('--image='))?.slice(8);
if (!['docker', 'podman'].includes(engine) || !image)
  throw new Error('用法：npx tsx tools/verify-containers.ts --engine=podman --image=<本地已有镜像>');
const varDir = path.join(root, 'var');
fs.mkdirSync(varDir, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(varDir, 'container-acceptance-'));
const app = await createApplication({
  dataDir,
  demo: true,
  v2Managers: false,
  containers: { allowOperations: true },
  initialConfig: { acceptAllSessions: false, admissions: ['private:10002'] },
});
const chatKey = 'private:10002';
let binding: ContainerBinding | undefined;
let cleaned = false;
const assert = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
async function until(get: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!get()) {
    if (Date.now() > deadline) throw new Error('容器验收等待超时');
    await new Promise((r) => setTimeout(r, 100));
  }
}
async function tool(name: string, args: unknown) {
  const run = app.runtime.submit({
    mode: 'command.direct',
    partitionKey: chatKey,
    input: { chatKey, tool: name, args },
  });
  const result = await app.runtime.wait(run.id);
  assert(result.status === 'completed', `工具运行失败：${result.error}`);
  const value = result.result as Record<string, unknown>;
  assert(!value.isError, `工具失败：${JSON.stringify(value)}`);
  return value;
}
try {
  let runtime = app.runtime.use(containerRuntimeService);
  runtime.configure({ enabled: true, engine, image });
  binding = await runtime.create(chatKey);
  await tool('container_write', { path: '验收/result.txt', content: '42\n中文验收' });
  assert(
    (await tool('container_read', { path: '验收/result.txt' })).stdout === '42\n中文验收',
    '文件读写不一致',
  );
  assert(
    String((await tool('container_bash', { command: 'printf "command-ok\\n"; uname -s' })).stdout).includes(
      'command-ok',
    ),
    '命令输出不一致',
  );
  let jobs = app.runtime.use(containerJobsService);
  const job = jobs.start(chatKey, {
    command: 'printf "background-ok\\n"',
    workdir: '/tmp/qq-harness-workspace',
  });
  await until(() => jobs.get(chatKey, job.id).status !== 'running');
  assert(jobs.get(chatKey, job.id).status === 'completed', '后台任务未完成');
  const cancel = jobs.start(chatKey, {
    command: 'printf "started\\n"; sleep 60',
    workdir: '/tmp/qq-harness-workspace',
  });
  await until(() => jobs.get(chatKey, cancel.id).stdout.includes('started'));
  await jobs.cancel(chatKey, cancel.id);
  assert(!(await runtime.inspect(chatKey)).running, '取消后容器仍在运行');
  await runtime.start(chatKey);
  assert(
    (await tool('container_read', { path: '验收/result.txt' })).stdout === '42\n中文验收',
    '重启后文件丢失',
  );
  const unloading = jobs.start(chatKey, {
    command: 'printf "started\\n"; sleep 60',
    workdir: '/tmp/qq-harness-workspace',
  });
  await until(() => jobs.get(chatKey, unloading.id).stdout.includes('started'));
  await app.runtime.setEnabled('container-runtime', false);
  const inspected = await runContainerCli(binding.binary, ['container', 'inspect', binding.id], {
    signal: AbortSignal.timeout(10000),
    maxOutputChars: 65536,
  });
  assert(
    inspected.exitCode === 0 && JSON.parse(inspected.stdout)[0].State.Running === false,
    '卸载后容器仍在运行',
  );
  await app.runtime.setEnabled('container-runtime', true);
  runtime = app.runtime.use(containerRuntimeService);
  assert(runtime.has(chatKey), '重新启用后绑定丢失');
  assert(
    (await tool('container_read', { path: '验收/result.txt' })).stdout === '42\n中文验收',
    '重新启用后文件读取失败',
  );
  assert(app.runtime.use(adapterService).sent?.length === 0, '容器验收不应发送 QQ 消息');
  await runtime.remove(chatKey);
  cleaned = true;
  console.log(
    JSON.stringify(
      {
        engine,
        image,
        create: true,
        command: true,
        utf8Files: true,
        backgroundJob: true,
        cancelStopsContainer: true,
        restartPreservesFiles: true,
        unloadStopsContainer: true,
        reenableRestoresBinding: true,
        testContainerRemoved: true,
        qqMessagesSent: 0,
      },
      null,
      2,
    ),
  );
} finally {
  if (!cleaned) {
    try {
      await app.runtime.setEnabled('container-runtime', true);
      const current = app.runtime.use(containerRuntimeService);
      if (current.has(chatKey)) await current.remove(chatKey);
      cleaned = true;
    } catch {
      console.error(`临时容器未清理，请保留归属数据进行排查：${dataDir}`);
    }
  }
  await app.stop();
  if (cleaned) {
    const real = fs.realpathSync(dataDir);
    if (
      path.dirname(real) !== fs.realpathSync(varDir) ||
      !path.basename(real).startsWith('container-acceptance-')
    )
      throw new Error('清理目录越界');
    fs.rmSync(real, { recursive: true, force: true });
  }
}
