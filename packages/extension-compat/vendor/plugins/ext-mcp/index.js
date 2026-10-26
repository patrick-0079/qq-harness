// MCP 管理器（内置可信插件）：mcp 类型的管理器。
//
// 职责：
//   1. 扫描 <root>/mcp/*/mcp.json，登记为 mcp 类型子扩展
//   2. 连接服务（stdio / streamable HTTP），listTools
//   3. 把每个 MCP 工具注册为**原生 function**：<serverId>__<sanitizedTool>
//   4. 结果内容映射：文本 + image_url parts（不再只给存盘路径）
//   5. 工具策略：allow/deny 名单 + shell 类工具名默认拦截
//
// 类型边界：
//   · 不注册自己的通用工具（模型看到的是每个 MCP 工具的原生 schema）
//   · 连接生命周期归管理器；子扩展卸载时注销工具并关闭连接
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { McpServerConnection } from '../../src/mcp/client.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..');

/** shell 类工具名拦截（默认开启）：模型不该有任何间接执行命令的通道。
 *  不用 \b 边界：`exec_command` / `cmd_run` 这类下划线拼接才是常见形态，
 *  \b 会把它们漏过去（安全拦截宁可多拦）。 */
const SHELL_NAME_RE = /shell|bash|pwsh|powershell|exec|spawn|cmd|terminal|process_start/i;

let api = null;
let log = () => {};
let cfg = () => ({});

const connections = new Map();   // serverId -> { conn, tools: [], registered: [] }

/** 把任意 MCP 工具名清洗成合法 function name 片段（≤38 字符，冲突用哈希兜底）。 */
export function sanitizeToolId(name) {
  const raw = String(name || '').trim();
  let s = raw.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  if (!s) s = 'tool';
  if (s.length <= 38) return s;
  const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 6);
  return `${s.slice(0, 30)}_${hash}`;
}

/** 工具策略判定：allow 模式只放名单内；deny 模式排除名单；shell 名默认拦。 */
export function isToolAllowed(toolName, policy = {}, { blockShellTools = true } = {}) {
  const name = String(toolName || '');
  if (blockShellTools && SHELL_NAME_RE.test(name)) return { ok: false, reason: 'shell 类工具名已拦截' };
  const mode = String(policy.mode || 'deny');
  const names = Array.isArray(policy.names) ? policy.names.map(String) : [];
  if (mode === 'allow') {
    return names.includes(name)
      ? { ok: true }
      : { ok: false, reason: '不在 allow 名单内' };
  }
  return names.includes(name)
    ? { ok: false, reason: '在 deny 名单内' }
    : { ok: true };
}

/** MCP content[] → 工具返回值（文本 + 原生图片 parts）。 */
export function mapToolResult(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const texts = [];
  const media = [];
  for (const item of parts) {
    const type = String(item?.type || '');
    if (type === 'text' && item.text) {
      texts.push(String(item.text));
    } else if (type === 'image' && item.data) {
      const mime = String(item.mimeType || 'image/png');
      media.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${item.data}` } });
      texts.push('[图片]');
    } else if (type === 'audio' && item.data) {
      texts.push('[音频内容已省略]');
    } else if (type === 'resource' && item.resource) {
      texts.push(`[资源 ${item.resource.uri || ''}]${item.resource.text ? `\n${String(item.resource.text).slice(0, 4000)}` : ''}`);
    } else if (type === 'resource_link') {
      texts.push(`[资源链接 ${item.uri || ''}${item.name ? `（${item.name}）` : ''}]`);
    }
  }
  const text = texts.join('\n').trim() || '（该工具没有返回文本内容）';
  const isError = result?.isError === true;
  return media.length ? { content: [{ type: 'text', text }, ...media], isError } : { content: text, isError };
}

/** 读取并校验一个 mcp.json。 */
function readServerConfig(dir) {
  const file = path.join(dir, 'mcp.json');
  if (!fs.existsSync(file)) return { error: '缺少 mcp.json' };
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const raw = JSON.parse(text);
    // 传输方式：transport 为准；type 是历史/可读性别名（demo 包写的就是 type），两者都认
    const transport = (raw.transport || raw.type) === 'http' || raw.url ? 'http' : 'stdio';
    if (transport === 'stdio' && !raw.command) return { error: 'stdio 传输缺少 command' };
    if (transport === 'http' && !raw.url) return { error: 'http 传输缺少 url' };
    return {
      raw: {
        ...raw,
        transport,
        name: String(raw.name || raw.id || path.basename(dir)),
        timeoutMs: Number(raw.timeoutMs) || 30000
      }
    };
  } catch (error) {
    return { error: `mcp.json 解析失败：${error?.message ?? error}` };
  }
}

/** 连接一个服务并注册其工具。 */
async function connectServer(serverId, serverCfg) {
  const conn = new McpServerConnection({
    name: serverId,
    // McpServerConnection 用 type 区分传输（stdio / http）
    type: serverCfg.transport === 'http' ? 'http' : 'stdio',
    command: serverCfg.command,
    args: serverCfg.args,
    env: serverCfg.env,
    url: serverCfg.url,
    headers: serverCfg.headers,
    timeoutMs: serverCfg.timeoutMs
  }, { onLog: (line) => log(`[${serverId}] ${line}`) });

  const state = { conn, tools: [], registered: [] };
  connections.set(serverId, state);

  const ok = await conn.connect();
  if (!ok) {
    log(`${serverId} 连接失败：${conn.error || '未知原因'}`);
    return { ok: false, error: conn.error || '连接失败' };
  }
  // connect() 内部已完成 initialize + tools/list
  const tools = Array.isArray(conn.tools) ? conn.tools : [];

  const maxTools = Math.max(1, Number(cfg().maxToolsPerServer) || 60);
  const policy = serverCfg.toolPolicy || {};
  let registeredCount = 0;
  for (const tool of tools.slice(0, maxTools)) {
    const original = String(tool?.name || '');
    if (!original) continue;
    const verdict = isToolAllowed(original, policy, { blockShellTools: cfg().blockShellTools !== false });
    if (!verdict.ok) {
      log(`${serverId}/${original} 未注册：${verdict.reason}`);
      continue;
    }
    const toolId = sanitizeToolId(original);
    const params = tool?.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} };
    try {
      const fullId = api.registerToolAs(serverId, {
        id: toolId,
        name: `[MCP] ${String(tool?.title || original).slice(0, 40)}`,
        description: String(tool?.description || `MCP 工具 ${original}`).slice(0, 900),
        category: 'query',
        icon: '🧩',
        parameters: params,
        async execute(_ctx, args) {
          const timeout = Math.max(1000, Number(cfg().callTimeoutMs) || 30000);
          const result = await conn.callTool(original, args || {}, timeout);
          return mapToolResult(result);
        }
      });
      state.registered.push({ id: fullId, original, toolId });
      registeredCount++;
    } catch (error) {
      log(`${serverId}/${original} 注册失败：${error?.message ?? error}`);
    }
  }

  state.tools = tools;
  log(`${serverId} 已连接：${tools.length} 个工具，注册 ${registeredCount} 个`);
  return { ok: true, registered: registeredCount, total: tools.length };
}

/** 断开并注销一个服务。 */
function disconnectServer(serverId) {
  const state = connections.get(serverId);
  if (!state) return;
  try { api.unregisterToolsByOwner(serverId); } catch { /* ignore */ }
  try { state.conn.close?.(); } catch { /* ignore */ }
  connections.delete(serverId);
}

/** 扫描全部 mcp 包并连接。 */
async function scanAndConnect() {
  const dirName = String(cfg().docsDir || 'mcp');
  const root = path.isAbsolute(dirName) ? dirName : path.join(APP_ROOT, dirName);
  if (!fs.existsSync(root)) {
    log(`MCP 目录不存在，跳过：${root}`);
    return { connected: 0, failed: 0 };
  }
  let connected = 0;
  let failed = 0;

  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const dir = path.join(root, ent.name);
    const { raw, error } = readServerConfig(dir);
    if (error) { failed++; log(`${ent.name}：${error}`); continue; }

    const serverId = String(raw.id || ent.name);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(serverId)) { failed++; log(`${ent.name}：id 非法`); continue; }

    const reg = api.registerSubExtension({
      type: 'mcp',
      id: serverId,
      name: raw.name,
      description: String(raw.description || ''),
      version: String(raw.version || '1.0.0'),
      status: 'active',
      details: { transport: raw.transport, toolPolicy: raw.toolPolicy || null, dir }
    });
    if (reg && reg.ok === false) { failed++; log(`${serverId} 登记失败：${reg.error}`); continue; }

    try {
      const r = await connectServer(serverId, raw);
      if (r.ok) connected++; else { failed++; api.unregisterSubExtension(serverId); }
    } catch (error) {
      failed++;
      log(`${serverId} 连接异常：${error?.message ?? error}`);
      api.unregisterSubExtension(serverId);
    }
  }

  // 工具集变化：让运行中的会话在下一轮看到新工具
  if (connected) api.notifyToolsChanged?.();
  log(`MCP：扫描 ${root}，连接 ${connected} 个，失败 ${failed} 个`);
  return { connected, failed };
}

function clearAll() {
  for (const id of [...connections.keys()]) disconnectServer(id);
  // 连接失败/未连接但已登记的子扩展也可能有残留工具，一并按 owner 清掉
  try {
    for (const d of api.listSubExtensions('mcp') || []) api.unregisterToolsByOwner(d.id);
  } catch { /* ignore */ }
}

export function setup(hostApi) {
  api = hostApi;
  log = hostApi.log || (() => {});
  cfg = hostApi.config;
}

export async function activate() {
  // 扩展仓库页签：本管理器启用时才出现，停用即消失
  api.registerExtensionTab?.({
    id: 'mcp', label: 'MCP', icon: '🧩', order: 30,
    surface: 'both',
    mode: 'template', dataUrl: '/api/extensions?type=mcp', hint: '外部 MCP 服务，工具以原生 function 暴露'
  });

  if (cfg().enabled === false) { log('MCP 管理器已关闭'); return; }
  if (cfg().autoStart === false) { log('MCP 自动连接已关闭，等首次调用时再连'); return; }
  try {
    clearAll();
    await scanAndConnect();
  } catch (error) {
    log(`扫描 MCP 失败：${error?.message ?? error}`);
  }
}

export function deactivate() {
  
  try { api.unregisterExtensionTab?.(); } catch { /* ignore */ }
try {
    clearAll();
    api?.notifyToolsChanged?.();
  } catch (error) {
    log(`停用 MCP 管理器失败：${error?.message ?? error}`);
  }
}

export function dispose() { deactivate(); }

export function available() { return true; }

// 供测试使用
export const internals = { sanitizeToolId, isToolAllowed, mapToolResult, connections };
