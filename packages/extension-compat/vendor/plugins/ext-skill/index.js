// 技能管理器（内置可信插件）：skill 类型的管理器。
//
// 职责：
//   1. 扫描 <root>/skills/<id>/skill.json（type: "skill"），校验清单与 scripts[] 白名单
//   2. 登记为 skill 子扩展，并把脚本注册进执行器（src/sandbox/index.js）
//   3. docs/*.md 进文档仓库；脚本目录通过提示词贡献注入（模型知道有哪些脚本）
//
// 执行：模型只看到 `skill_script_run`，由它按 skillId + 脚本相对路径调用；
// 无容器后端时降级到 worker+vm 沙箱（仅 js）。容器后端由后续插件通过
// registerContainerBackend() 接入，接入后自动优先使用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExports, validateManifest as validateV2Manifest } from '../../src/extensions/types.js';
import { registerSkillScripts, unregisterSkillScripts, isContainerAvailable } from '../../src/sandbox/index.js';
import { renderConfigDeep } from '../../src/extensions/template-vars.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..');
const DOC_EXT = new Set(['.md', '.txt']);

let api = null;
let log = () => {};
let cfg = () => ({});
let loaded = [];   // [{ id, dir, scripts, docIds }]

function readManifest(dir) {
  const file = path.join(dir, 'skill.json');
  if (!fs.existsSync(file)) return { error: '缺少 skill.json' };
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return { raw: JSON.parse(text) };
  } catch (error) {
    return { error: `skill.json 解析失败：${error?.message ?? error}` };
  }
}

/** 校验 scripts[] 声明（路径必须落在包内、只收 .js 或声明的 lang）。 */
function normalizeScripts(dir, rawIds) {
  const out = [];
  const violations = [];
  for (const entry of (Array.isArray(rawIds) ? rawIds : [])) {
    const rel = String(typeof entry === 'string' ? entry : entry?.path || '').replace(/\\/g, '/');
    if (!rel) { violations.push('scripts[] 有空路径'); continue; }
    const abs = path.resolve(dir, rel);
    const relToDir = path.relative(dir, abs);
    if (!relToDir || relToDir.startsWith('..') || path.isAbsolute(relToDir)) {
      violations.push(`脚本越界：${rel}`); continue;
    }
    const lang = String((typeof entry === 'object' && entry?.lang) || 'js').toLowerCase();
    if (lang !== 'js' && !cfg().allowNonJs) {
      violations.push(`${rel}：语言 ${lang} 需要容器后端（当前降级沙箱只支持 js）`);
      continue;
    }
    if (!fs.existsSync(abs)) { violations.push(`脚本不存在：${rel}`); continue; }
    out.push({
      path: rel,
      lang,
      description: String((typeof entry === 'object' && entry?.description) || ''),
      docId: String((typeof entry === 'object' && entry?.docId) || '')
    });
  }
  return { scripts: out, violations };
}

function indexDocs(pkgDir, pkgId) {
  const dir = path.join(pkgDir, 'docs');
  if (!fs.existsSync(dir)) return [];
  const ids = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile() || !DOC_EXT.has(path.extname(ent.name).toLowerCase())) continue;
    let content = '';
    try { content = fs.readFileSync(path.join(dir, ent.name), 'utf8').replace(/^\uFEFF/, ''); } catch { continue; }
    const base = path.basename(ent.name, path.extname(ent.name));
    const docId = `${pkgId}.${base}`;
    const r = api.docRegistry?.register?.({
      id: docId, title: `${pkgId} · ${base}`, layer: 'skill',
      ownerId: pkgId, path: `docs/${ent.name}`, content
    });
    if (r && r.ok === false && !String(r.error || '').includes('已存在')) log(`${docId}：${r.error}`);
    else ids.push(docId);
  }
  return ids;
}

async function scanAndRegister() {
  const dirName = String(cfg().docsDir || 'skills');
  const root = path.isAbsolute(dirName) ? dirName : path.join(APP_ROOT, dirName);
  if (!fs.existsSync(root)) { log(`技能目录不存在，跳过：${root}`); return { loaded: 0, failed: 0 }; }

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

    // 只接管声明了 type: "skill" 的包；v1 旧技能交给旧加载器
    if (String(raw.type || '') !== 'skill') continue;

    const pkgId = String(raw.id || ent.name);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pkgId)) { failCount++; log(`id 非法：${pkgId}`); continue; }
    if (seen.has(pkgId)) { failCount++; log(`重复 id：${pkgId}`); continue; }
    seen.add(pkgId);

    const mv = validateV2Manifest('skill', raw);
    if (!mv.ok) { failCount++; log(`${pkgId} 清单不合规：${mv.violations.join('；')}`); continue; }

    const { scripts, violations } = normalizeScripts(dir, raw.scripts);
    if (violations.length) { failCount++; log(`${pkgId} 脚本声明不合规：${violations.slice(0, 5).join('；')}`); continue; }
    if (!scripts.length) { failCount++; log(`${pkgId}：scripts[] 为空，没有可执行脚本`); continue; }

    // 入口（可选）：声明了就做导出闸门（不允许 hooks/providers/activate）
    const entryRel = String(raw.entry || '');
    if (entryRel) {
      const entryAbs = path.resolve(dir, entryRel);
      const relToDir = path.relative(dir, entryAbs);
      if (relToDir.startsWith('..') || path.isAbsolute(relToDir)) { failCount++; log(`${pkgId}：entry 越界`); continue; }
      if (fs.existsSync(entryAbs)) {
        try {
          const mod = await import(`${pathToFileURLSafe(entryAbs)}?t=${Date.now()}`);
          const ev = validateExports('skill', mod);
          if (!ev.ok) { failCount++; log(`${pkgId} 导出越界：${ev.violations.join('；')}`); continue; }
        } catch (err) {
          failCount++; log(`${pkgId}：入口加载失败（${err?.message ?? err}）`); continue;
        }
      }
    }

    const reg = api.registerSubExtension({
      type: 'skill', id: pkgId,
      description: String(raw.description || ''),
      name: String(raw.name || pkgId),
      version: String(raw.version || '1.0.0'),
      status: 'active',
      settingsSchema: raw.configSchema || {},
      settings: raw.settings || {},
      details: {
        params: renderConfigDeep(Array.isArray(raw.params) ? raw.params : [], { ownerId: pkgId }),
        scripts: scripts.map((s) => ({ path: s.path, lang: s.lang, description: s.description })),
        backend: isContainerAvailable() ? 'container' : 'sandbox', dir
      }
    });
    if (reg && reg.ok === false) { failCount++; log(`${pkgId} 登记失败：${reg.error}`); continue; }

    registerSkillScripts(pkgId, { dir, scripts });
    const docIds = indexDocs(dir, pkgId);
    loaded.push({ id: pkgId, dir, scripts, docIds });
    okCount++;
  }

  log(`技能包：扫描 ${root}，加载 ${okCount} 个，失败 ${failCount} 个`
    + `（后端：${isContainerAvailable() ? '容器' : '降级沙箱(js)'}）`);
  return { loaded: okCount, failed: failCount };
}

function pathToFileURLSafe(abs) {
  const u = new URL('file://');
  u.pathname = abs.replace(/\\/g, '/');
  return u.href;
}

function clearAll() {
  for (const item of loaded) {
    unregisterSkillScripts(item.id);
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
    id: 'skill', label: '技能', icon: '📚', order: 40,
    surface: 'both',
    mode: 'template', dataUrl: '/api/extensions?type=skill', hint: 'LLM 型扩展：注册工具，用不用由模型判断'
  });

  if (cfg().enabled === false) { log('技能管理器已关闭'); return; }
  try { clearAll(); await scanAndRegister(); }
  catch (error) { log(`扫描技能包失败：${error?.message ?? error}`); }

  // 脚本目录：告诉模型有哪些脚本可调（宿主生成，不让扩展自己写提示词）
  try {
    api.registerPromptContribution({
      at: 'after-skill-sections',
      order: 210,
      priority: 35,
      text: () => {
        const all = loaded.filter((l) => l.scripts.length);
        if (!all.length) return '';
        const lines = ['【可用脚本】用 skill_script_run(skillId, script, args) 调用：'];
        for (const pkg of all.slice(0, 12)) {
          for (const s of pkg.scripts.slice(0, 8)) {
            const desc = s.description ? ` — ${s.description}` : '';
            const docs = s.docId ? `（文档 ${s.docId}）` : '';
            lines.push(`- ${pkg.id}/${s.path}${desc}${docs}`);
          }
        }
        return lines.join('\n').slice(0, 2000);
      }
    });
  } catch (error) {
    log(`注册脚本目录失败：${error?.message ?? error}`);
  }
}

export function deactivate() {
  
  try { api.unregisterExtensionTab?.(); } catch { /* ignore */ }
try { clearAll(); api.unregisterPromptContribution?.(); }
  catch (error) { log(`停用失败：${error?.message ?? error}`); }
}

export function dispose() { deactivate(); }
export function available() { return true; }

export function status() {
  return {
    backend: isContainerAvailable() ? 'container' : 'sandbox', dir,
    packages: loaded.map((l) => ({ id: l.id, scripts: l.scripts.map((s) => s.path), docs: l.docIds }))
  };
}
