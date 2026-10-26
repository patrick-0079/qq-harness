// 工具管理器（内置可信插件）：tool 类型的管理器（主进程执行）。
//
// 职责：
//   1. 扫描 <root>/tools/<id>/tool.json + 入口（默认 index.js）
//   2. 静态闸：只允许 setup/available；出现 hooks/providers/activate 等一律拒绝
//   3. 以子扩展身份注册工具（registerToolAs），工具前缀 <包 id>__
//   4. docs/*.md 进文档仓库，模型可用 load_doc 查看
//
// 类型边界：不提供 hooks/能力；工具在**主进程**执行（与本项目"工具留主线程"的决策一致）。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { validateExports, validateManifest as validateV2Manifest } from '../../src/extensions/types.js';
import { safeFetch } from '../../src/safe-fetch.js';
import { renderConfigDeep } from '../../src/extensions/template-vars.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..');
const DOC_EXT = new Set(['.md', '.txt']);

let api = null;
let log = () => {};
let cfg = () => ({});
let loaded = [];   // [{ id, dir, tools: [] }]

function readManifest(dir) {
  const file = path.join(dir, 'tool.json');
  if (!fs.existsSync(file)) return { error: '缺少 tool.json' };
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return { raw: JSON.parse(text) };
  } catch (error) {
    return { error: `tool.json 解析失败：${error?.message ?? error}` };
  }
}

/** 把 docs/*.md 登记进文档仓库（docId = <包>.<文件名>）。 */
function indexDocs(pkgDir, pkgId) {
  const dir = path.join(pkgDir, 'docs');
  if (!fs.existsSync(dir)) return [];
  const ids = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (!DOC_EXT.has(path.extname(ent.name).toLowerCase())) continue;
    const abs = path.join(dir, ent.name);
    let content = '';
    try { content = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, ''); } catch { continue; }
    const base = path.basename(ent.name, path.extname(ent.name));
    const docId = `${pkgId}.${base}`;
    const r = api.docRegistry?.register?.({
      id: docId, title: `${pkgId} · ${base}`, layer: 'tool',
      ownerId: pkgId, path: `docs/${ent.name}`, content
    });
    if (r && r.ok === false && !String(r.error || '').includes('已存在')) log(`${docId}：${r.error}`);
    else ids.push(docId);
  }
  return ids;
}

/** 为子包构造绑定 owner 的 API（只给必需能力）。 */
function childApi(pkgId, descriptor, permissions = []) {
  const hasWeb = Array.isArray(permissions) && permissions.includes('web_fetch');
  return {
    log: (...a) => log(`[${pkgId}]`, ...a),
    warn: (...a) => log(`[${pkgId}] ⚠`, ...a),
    error: (...a) => log(`[${pkgId}] ✗`, ...a),
    config: () => renderConfigDeep({ ...(descriptor.settings || {}) }, { ownerId: pkgId }),
    registerTool: (def) => api.registerToolAs(pkgId, def),
    fetch: hasWeb
      ? (url, opts) => safeFetch(url, opts)
      : () => Promise.reject(new Error('扩展 ' + pkgId + ' 未声明 web_fetch 权限')),
    unregisterTools: () => api.unregisterToolsByOwner(pkgId)
  };
}

async function scanAndRegister() {
  const dirName = String(cfg().docsDir || 'tools');
  const root = path.isAbsolute(dirName) ? dirName : path.join(APP_ROOT, dirName);
  if (!fs.existsSync(root)) { log(`工具目录不存在，跳过：${root}`); return { loaded: 0, failed: 0 }; }

  const max = Math.max(1, Number(cfg().maxPackages) || 50);
  let okCount = 0;
  let failCount = 0;
  const seen = new Set();

  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    if (okCount >= max) { log(`已达上限 ${max}`); break; }

    const dir = path.join(root, ent.name);
    const { raw, error } = readManifest(dir);
    if (error) { failCount++; log(`${ent.name}：${error}`); continue; }

    const pkgId = String(raw.id || ent.name);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pkgId)) { failCount++; log(`id 非法：${pkgId}`); continue; }
    if (seen.has(pkgId)) { failCount++; log(`重复 id：${pkgId}`); continue; }
    seen.add(pkgId);

    // 清单闸：必须是 tool 类型
    const manifest = { ...raw, type: raw.type || 'tool' };
    if (manifest.type !== 'tool') { failCount++; log(`${pkgId}：tool.json 的 type 必须是 tool（当前 ${manifest.type}）`); continue; }
    const mv = validateV2Manifest('tool', manifest);
    if (!mv.ok) { failCount++; log(`${pkgId} 清单不合规：${mv.violations.join('；')}`); continue; }

    // 入口：锁在包目录内
    const entryRel = String(raw.entry || 'index.js');
    const entryAbs = path.resolve(dir, entryRel);
    const rel = path.relative(dir, entryAbs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { failCount++; log(`${pkgId}：entry 越界`); continue; }
    if (!fs.existsSync(entryAbs)) { failCount++; log(`${pkgId}：入口不存在（${entryRel}）`); continue; }

    let mod;
    try { mod = await import(`${pathToFileURL(entryAbs).href}?t=${Date.now()}`); }
    catch (err) { failCount++; log(`${pkgId}：加载失败（${err?.message ?? err}）`); continue; }

    // 静态闸：只允许 setup/register/available
    const ev = validateExports('tool', mod);
    if (!ev.ok) { failCount++; log(`${pkgId} 导出越界：${ev.violations.join('；')}`); continue; }

    const descriptor = {
      type: 'tool', id: pkgId,
      description: String(raw.description || ''),
      name: String(raw.name || pkgId),
      version: String(raw.version || '1.0.0'),
      status: 'active',
      settingsSchema: raw.configSchema || {},
      settings: raw.settings || {},
      details: { entry: entryRel, dir }
    };
    const reg = api.registerSubExtension(descriptor);
    if (reg && reg.ok === false) { failCount++; log(`${pkgId} 登记失败：${reg.error}`); continue; }

    const before = api.listSubExtensions?.('tool')?.length || 0;
    try {
      const setupFn = typeof mod.setup === 'function' ? mod.setup : (typeof mod.register === 'function' ? mod.register : null);
      if (setupFn) await setupFn(childApi(pkgId, descriptor, Array.isArray(raw.permissions) ? raw.permissions : []));
    } catch (err) {
      failCount++;
      api.unregisterSubExtension(pkgId);
      api.unregisterToolsByOwner?.(pkgId);
      log(`${pkgId}：setup 失败（${err?.message ?? err}）`);
      continue;
    }

    const docIds = indexDocs(dir, pkgId);
    loaded.push({ id: pkgId, dir, docIds, tools: [] });
    okCount++;
    void before;
  }

  if (okCount) api.notifyToolsChanged?.();
  log(`工具包：扫描 ${root}，加载 ${okCount} 个，失败 ${failCount} 个`);
  return { loaded: okCount, failed: failCount };
}

function clearAll() {
  for (const item of loaded) {
    try { api.unregisterToolsByOwner?.(item.id); } catch { /* ignore */ }
    try { api.docRegistry?.unregisterByOwner?.(item.id); } catch { /* ignore */ }
    try { api.unregisterSubExtension(item.id); } catch { /* ignore */ }
  }
  loaded = [];
}

export function setup(hostApi) {
  api = hostApi;
  log = hostApi.log || (() => {});
  cfg = hostApi.config;
}

export async function activate() {
  // 扩展仓库页签：本管理器启用时才出现，停用即消失
  api.registerExtensionTab?.({
    id: 'tool', label: '工具', icon: '🔧', order: 20,
    surface: 'both',
    mode: 'template', dataUrl: '/api/extensions?type=tool', hint: '注册工具，由模型决定何时调用'
  });

  if (cfg().enabled === false) { log('工具管理器已关闭'); return; }
  try { clearAll(); await scanAndRegister(); }
  catch (error) { log(`扫描工具包失败：${error?.message ?? error}`); }
}

export function deactivate() {
  
  try { api.unregisterExtensionTab?.(); } catch { /* ignore */ }
try { clearAll(); api?.notifyToolsChanged?.(); }
  catch (error) { log(`停用失败：${error?.message ?? error}`); }
}

export function dispose() { deactivate(); }
export function available() { return true; }

export function status() {
  return { packages: loaded.map((l) => l.id), docs: loaded.reduce((n, l) => n + l.docIds.length, 0) };
}
