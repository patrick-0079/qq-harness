// 提示词注入管理器（内置可信插件）：promptinject 类型的管理器。
//
// 职责：
//   1. 扫描 <root>/promptinjects/*/promptinject.json + inject.js
//   2. 校验 inject.js 导出（只允许 meta/append/rewrite）与注入声明（锚点/target/priority）
//   3. 登记为 promptinject 子扩展，并把注入源注册进提示词管线
//   4. 会话级启用过滤（enabled 钩子）
//
// 类型边界：只做文本变换；不注册工具、不碰生命周期、不执行任意脚本。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { validatePromptInjectExports, PROMPT_ANCHORS, REWRITE_TARGETS } from '../../src/extensions/prompt-inject.js';
import { registerPromptInjectSource, unregisterPromptInjectSource } from '../../src/extensions/prompt-pipeline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..');

let api = null;
let log = () => {};
let cfg = () => ({});
let loaded = [];   // [{ id, file }]

function readManifest(dir) {
  const file = path.join(dir, 'promptinject.json');
  if (!fs.existsSync(file)) return { error: '缺少 promptinject.json' };
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return { raw: JSON.parse(text), file };
  } catch (error) {
    return { error: `promptinject.json 解析失败：${error?.message ?? error}` };
  }
}

/** 扫描并登记全部注入包。 */
async function scanAndRegister() {
  const dirName = String(cfg().docsDir || 'promptinjects');
  const root = path.isAbsolute(dirName) ? dirName : path.join(APP_ROOT, dirName);
  if (!fs.existsSync(root)) {
    log(`注入包目录不存在，跳过：${root}`);
    return { loaded: 0, failed: 0 };
  }

  const max = Math.max(1, Number(cfg().maxPackages) || 20);
  let okCount = 0;
  let failCount = 0;
  const seen = new Set();

  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    if (okCount >= max) { log(`已达上限 ${max}，剩余包跳过`); break; }

    const dir = path.join(root, ent.name);
    const { raw, error } = readManifest(dir);
    if (error) { failCount++; log(`${ent.name}：${error}`); continue; }

    const pkgId = String(raw.id || ent.name);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pkgId)) { failCount++; log(`${ent.name}：id 非法（${pkgId}）`); continue; }
    if (seen.has(pkgId)) { failCount++; log(`重复 id：${pkgId}`); continue; }
    seen.add(pkgId);

    // 入口：manifest.entry 或默认 inject.js，必须锁在包目录内
    const entryRel = String(raw.entry || 'inject.js');
    const entryAbs = path.resolve(dir, entryRel);
    const rel = path.relative(dir, entryAbs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      failCount++; log(`${pkgId}：entry 必须是包内相对路径（${entryRel}）`); continue;
    }
    if (!fs.existsSync(entryAbs)) { failCount++; log(`${pkgId}：入口文件不存在（${entryRel}）`); continue; }

    let mod;
    try {
      mod = await import(`${pathToFileURL(entryAbs).href}?t=${Date.now()}`);
    } catch (err) {
      failCount++; log(`${pkgId}：加载 inject.js 失败（${err?.message ?? err}）`); continue;
    }

    const v = validatePromptInjectExports(mod);
    if (!v.ok) {
      failCount++;
      log(`${pkgId}：注入声明非法 → ${v.violations.slice(0, 5).join('；')}`);
      continue;
    }

    const injects = Array.isArray(mod.meta?.injects) ? mod.meta.injects : [];
    const reg = api.registerSubExtension({
      type: 'promptinject',
      id: pkgId,
      name: String(raw.name || pkgId),
      description: String(raw.description || ''),
      version: String(raw.version || '1.0.0'),
      status: 'active',
      settingsSchema: raw.configSchema || {},
      settings: raw.settings || {},
      details: {
        order: Number(raw.order) || 100,
        dir,
        injects: injects.map((i) => ({
          id: String(i.id),
          kind: String(i.kind),
          at: i.at ? String(i.at) : '',
          target: i.target ? String(i.target) : '',
          priority: Number(i.priority) || 50,
          title: String(i.title || '')
        })),
        anchors: [...new Set(injects.filter((i) => i.kind === 'append').map((i) => String(i.at)))],
        targets: [...new Set(injects.filter((i) => i.kind === 'rewrite').map((i) => String(i.target)))]
      }
    });
    if (reg && reg.ok === false) { failCount++; log(`${pkgId} 登记失败：${reg.error}`); continue; }

    // 注册注入源：append/rewrite 直接引用模块导出的纯函数
    registerPromptInjectSource(pkgId, {
      order: Number(raw.order) || 100,
        dir,
      injects,
      append: typeof mod.append === 'function' ? mod.append : null,
      rewrite: typeof mod.rewrite === 'function' ? mod.rewrite : null,
      enabled: (ctx) => {
        try {
          const explicit = api.isExtensionEnabled?.(pkgId, ctx?.chatKey || '');
          return explicit === null || explicit === undefined ? true : explicit !== false;
        } catch { return true; }
      }
    });

    loaded.push({ id: pkgId, file: entryAbs });
    okCount++;
  }

  log(`提示词注入：扫描 ${root}，加载 ${okCount} 个，失败 ${failCount} 个`);
  return { loaded: okCount, failed: failCount };
}

function clearAll() {
  for (const item of loaded) {
    unregisterPromptInjectSource(item.id);
    api.unregisterSubExtension(item.id);
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
    id: 'context', label: '上下文', icon: '✏️', order: 60,
    surface: 'both',
    mode: 'template', dataUrl: '/api/extensions?type=promptinject', hint: '按锚点追加或改写系统提示'
  });

  if (cfg().enabled === false) { log('提示词注入管理器已关闭'); return; }
  try {
    clearAll();
    await scanAndRegister();
  } catch (error) {
    log(`扫描注入包失败：${error?.message ?? error}`);
  }
}

export function deactivate() {
  
  try { api.unregisterExtensionTab?.(); } catch { /* ignore */ }
try { clearAll(); } catch (error) { log(`停用失败：${error?.message ?? error}`); }
}

export function dispose() { deactivate(); }

export function available() { return true; }

/** 诊断：当前生效的注入项（供 UI 展示锚点/冲突）。 */
export function status() {
  const rows = [];
  for (const item of loaded) {
    const d = api.getSubExtension?.(item.id);
    for (const inj of (d?.details?.injects || [])) rows.push({ pkg: item.id, ...inj });
  }
  const conflicts = {};
  for (const r of rows) {
    if (r.kind !== 'rewrite' || !r.target) continue;
    conflicts[r.target] = (conflicts[r.target] || 0) + 1;
  }
  return {
    packages: loaded.map((l) => l.id),
    injects: rows,
    conflictingTargets: Object.entries(conflicts).filter(([, n]) => n > 1).map(([t, n]) => ({ target: t, count: n })),
    anchors: Object.keys(PROMPT_ANCHORS).length,
    targets: Object.keys(REWRITE_TARGETS).length
  };
}
