// 人工联调准备器：只读旧配置中的当前模型与 OneBot 凭据，不载入旧程序或聊天数据。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2];
const destination = process.argv[3];
const allowedInput = process.argv[4];
if (!source || !destination || !path.isAbsolute(source) || !path.isAbsolute(destination))
  throw new Error('需要旧检出与新数据目录的绝对路径，以及逗号分隔的获许可会话');
const admitted = allowedInput?.split(',').map((value) => value.trim()) ?? [];
if (!admitted.length || admitted.some((value) => !/^(group|private):[0-9]+$/.test(value)))
  throw new Error('第三个参数必须是逗号分隔的获许可会话，例如 group:10001,private:10002');
const relative = path.relative(path.join(root, 'var'), destination);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
  throw new Error('目标必须是本工程 var/ 中独立的新目录');
if (fs.existsSync(destination)) throw new Error('目标已存在，拒绝覆盖联调数据');
const old = JSON.parse(fs.readFileSync(path.join(source, 'data/config.json'), 'utf8'));
const provider = (old.providers ?? []).find((item) => item.id === old.api?.provider);
const key = old.dshProviderKeys?.[old.api?.provider] || provider?.apiKey || old.api?.apiKey;
if (!key || key === '******') throw new Error('未找到当前模型凭据');
const baseUrl = provider?.baseURL || old.api?.baseUrl;
const model = old.api?.model;
if (!baseUrl || !model) throw new Error('缺少当前模型端点/名称');
const config = {
  version: 1,
  acceptAllSessions: false,
  admissions: admitted,
  deniedChats: [],
  deniedUsers: [],
  profiles: {},
  defaults: {
    online: true,
    trigger: 'mention',
    wakeDelayMs: 200,
    drainDelayMs: 500,
    maxRounds: 4,
    runTimeoutMs: 180000,
    persona:
      '你正在进行 QQ Harness 真实消息联调。只处理当前会话的测试请求，用简短中文回答。需要回复时调用 send_message；成功发送后调用 finish({mode:"spoken"})。不要向其他会话发送、查询历史聊天或执行管理动作。',
  },
  model: { baseUrl, model, apiKey: key, timeoutMs: 90000, retries: 0 },
  onebot: {
    wsUrl: old.snowluma?.wsUrl || 'ws://127.0.0.1:3001',
    httpUrl: old.snowluma?.httpUrl || 'http://127.0.0.1:3000',
    accessToken: old.snowluma?.accessToken || '',
    httpAccessToken: old.snowluma?.httpAccessToken || '',
  },
  send: { minIntervalMs: 1500, dedupeMs: 15000, perMinute: 5 },
  plugins: {
    reminders: false,
    'command-direct': false,
    'external-plugins': false,
    'ext-tool': false,
    'ext-mcp': false,
    'ext-skill': false,
    'ext-knowledge': false,
    'ext-promptinject': false,
  },
};
fs.mkdirSync(destination, { recursive: true });
fs.writeFileSync(path.join(destination, 'config.json'), JSON.stringify(config, null, 2) + '\n', {
  mode: 0o600,
});
fs.writeFileSync(
  path.join(destination, 'test-scope.json'),
  JSON.stringify(
    { allowedChats: admitted, preparedAt: new Date().toISOString(), oldBotMustRemainStopped: true },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    prepared: true,
    dataDir: destination,
    allowedChats: admitted,
    model,
    credentialsCopied: true,
    chatHistoryCopied: false,
  }),
);
