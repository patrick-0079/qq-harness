// 扩展包导入：把 zip 里的内容识别成某种扩展类型，落到对应根目录。
//
// 为什么单独一个模块：`zip-install.js` 只服务插件市场（只认 skill.json / plugin.json，
// 且落点写死 skills/ plugins/）。扩展仓库现在有六种类型，需要：
//   1) 按清单名判型（tool / mcp / knowledge / promptinject / skill / plugin）
//   2) 没有清单但有 md/txt 的包，按「知识库」处理
//   3) 支持 dry-run 预览（先看要装什么、会不会冲突，再决定要不要写盘）
//   4) 覆盖安装（同 id 已存在时可选择覆盖；默认拒绝，避免误伤用户改动）
//
// 安全边界复用 `validateZipStructure`：禁绝对路径 / `..`、禁可执行后缀、文件数与解压总量上限。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateZipStructure } from '../zip-install.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 清单文件名 → 扩展类型。顺序即优先级（同时存在多个时取更具体的）。 */
const MANIFEST_TYPES = new Map([
  ['tool.json', 'tool'],
  ['mcp.json', 'mcp'],
  ['knowledge.json', 'knowledge'],
  ['promptinject.json', 'promptinject'],
  ['skill.json', 'skill'],
  ['plugin.json', 'plugin']
]);

/** 扩展类型 → 落盘根目录（相对仓库根）。 */
const ROOT_BY_TYPE = {
  tool: 'tools',
  mcp: 'mcp',
  knowledge: 'knowledge',
  promptinject: 'promptinjects',
  skill: 'skills',
  plugin: 'plugins'
};

const TYPE_LABEL = {
  tool: '工具包',
  mcp: 'MCP 服务',
  knowledge: '知识库',
  promptinject: '上下文注入',
  skill: '技能包',
  plugin: '插件'
};

const DOC_RE = /\.(md|txt)$/i;

function dirOf(name) {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

function baseOf(name) {
  return name.slice(name.lastIndexOf('/') + 1);
}

function depthOf(name) {
  const d = dirOf(name);
  return d ? d.split('/').length : 0;
}

function readJson(entry) {
  try { return JSON.parse(entry.data.toString('utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

/**
 * 分析一个 zip 包（不写盘）。
 *
 * @returns {{
 *   type: string, typeLabel: string, id: string, name: string, version: string,
 *   root: string, files: Array<{rel: string, size: number}>, totalSize: number,
 *   targetDir: string, conflict: boolean, manifest: object|null, warnings: string[]
 * }}
 */
export function analyzeZip(buffer, opts = {}) {
  return analyzeEntries(validateZipStructure(buffer), opts);
}

/**
 * 分析一组文件条目（zip 解出来的，或前端「选择文件夹」直接给的）。
 * @param {Array<{name: string, data: Buffer}>} entries
 */
export function analyzeEntries(entries, { root = '' } = {}) {
  if (!entries.length) throw new Error('安装包是空的');

  for (const e of entries) e.name = e.name.replace(/\\/g, '/');

  // ── 1. 判型：按清单名，取层级最浅的那个 ──────────────────────────────
  const manifests = entries
    .filter((e) => MANIFEST_TYPES.has(baseOf(e.name).toLowerCase()))
    .sort((a, b) => depthOf(a.name) - depthOf(b.name));

  let type = '';
  let rootRel = '';
  let manifestEntry = null;

  if (manifests.length) {
    manifestEntry = manifests[0];
    type = MANIFEST_TYPES.get(baseOf(manifestEntry.name).toLowerCase());
    rootRel = dirOf(manifestEntry.name);
  } else if (entries.some((e) => DOC_RE.test(e.name))) {
    // 没有清单但有文档：当成「知识库」（目录即模块，.summery 会自动生成）
    type = 'knowledge';
    const names = entries.map((e) => e.name);
    const first = names[0].split('/')[0];
    if (first && names.every((n) => n.startsWith(`${first}/`))) rootRel = first;
    else rootRel = '';
  } else {
    throw new Error('安装包里没有识别到扩展清单（tool.json / mcp.json / knowledge.json / promptinject.json / skill.json / plugin.json），也没有 .md / .txt 文档');
  }

  // ── 2. 取模块内的相对文件 ────────────────────────────────────────────
  const prefix = rootRel ? `${rootRel}/` : '';
  const files = entries
    .filter((e) => (prefix ? e.name.startsWith(prefix) : true))
    .map((e) => ({ rel: prefix ? e.name.slice(prefix.length) : e.name, data: e.data }))
    .filter((e) => e.rel && !e.rel.endsWith('/'));
  if (!files.length) throw new Error('安装包结构异常：模块目录为空');

  const manifest = manifestEntry && dirOf(manifestEntry.name) === rootRel ? readJson(manifestEntry) : null;

  // ── 3. 定 id：清单 id → 目录末级名 → 文件名 ─────────────────────────
  const rawId = String(manifest?.id || rootRel.split('/').pop() || '').trim();
  const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(rawId) ? rawId : '';
  if (!safeId) {
    throw new Error(`无法确定合法的扩展 id（清单里是「${rawId || '空'}」）。id 只能包含字母/数字/._-，且以字母或数字开头`);
  }

  const warnings = [];
  if (type === 'tool' && !files.some((f) => /\/(index|.*)\.js$/.test('/' + f.rel))) {
    warnings.push('没有 .js 文件：工具包通常需要一个入口脚本');
  }
  if (type !== 'knowledge' && !manifest) warnings.push('清单文件内容不是合法 JSON，导入后可能加载失败');

  // 允许调用方指定落点根（例如「会话插件」页要装进 chat-plugins/ 而不是 plugins/）
  const rootName = String(root || '').trim() || ROOT_BY_TYPE[type];
  const targetDir = path.join(APP_ROOT, rootName, safeId);
  const totalSize = files.reduce((n, f) => n + f.data.length, 0);

  return {
    type,
    typeLabel: TYPE_LABEL[type] || type,
    id: safeId,
    name: String(manifest?.name || safeId),
    version: String(manifest?.version || ''),
    description: String(manifest?.description || ''),
    root: rootRel,
    files: files.map((f) => ({ rel: f.rel, size: f.data.length })),
    totalSize,
    targetDir,
    relTarget: `${ROOT_BY_TYPE[type]}/${safeId}`,
    conflict: fs.existsSync(targetDir),
    warnings,
    _entries: files
  };
}

/** 只保留可打印的分析结果（不要把 Buffer 发给前端）。 */
export function publicAnalysis(info) {
  const { _entries, ...rest } = info;
  return rest;
}

/**
 * 写盘安装。
 * @param {Buffer} buffer zip 内容
 * @param {{overwrite?: boolean, id?: string}} opts
 */
export async function installZip(buffer, { overwrite = false, id = '', root = '' } = {}) {
  return installEntries(analyzeZip(buffer, { root }), { overwrite, id, root });
}

/** 用已分析好的结果落盘。 */
export async function installEntries(info, { overwrite = false, id = '', root = '' } = {}) {
  const finalId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(String(id)) ? String(id) : info.id;
  // 落点根：显式传的 root 优先（会话插件 → chat-plugins/），否则按类型
  const rootName = String(root || '').trim() || ROOT_BY_TYPE[info.type];
  const relTarget = `${rootName}/${finalId}`;
  const target = path.join(APP_ROOT, relTarget);

  if (fs.existsSync(target) && !overwrite) {
    const err = new Error(`已存在同名扩展：${relTarget}（如需覆盖请确认覆盖安装）`);
    err.conflict = true;
    err.existing = relTarget;
    throw err;
  }

  const backup = `${target}.bak-${Date.now()}`;
  const hadExisting = fs.existsSync(target);
  try {
    if (hadExisting) fs.renameSync(target, backup);
    fs.mkdirSync(target, { recursive: true });
    for (const f of info._entries) {
      const dest = path.join(target, ...f.rel.split('/'));
      const relCheck = path.relative(target, dest);
      if (relCheck.startsWith('..') || path.isAbsolute(relCheck)) throw new Error(`安装包包含非法路径：${f.rel}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.data);
    }
    // 覆盖成功后删备份；失败则回滚
    if (hadExisting) { try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* 忽略 */ } }
  } catch (error) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      if (hadExisting) fs.renameSync(backup, target);
    } catch { /* 回滚失败不掩盖原始错误 */ }
    throw error;
  }

  return {
    ok: true,
    type: info.type,
    typeLabel: info.typeLabel,
    id: finalId,
    name: info.name,
    version: info.version,
    relTarget,
    files: info.files.length,
    replaced: hadExisting
  };
}
