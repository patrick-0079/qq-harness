// 知识库管理器（内置可信插件）：目录即模块，摘要写进 .summery 镜像树。
//
// 结构约定：
//   knowledge/<库>/1.md, b.md, C/d.md, C/D/aaa.md
//   knowledge/<库>/.summery/.summery              ← 库根摘要
//   knowledge/<库>/.summery/1.md.summery
//   knowledge/<库>/.summery/C.summery             ← 目录 C 的摘要
//   knowledge/<库>/.summery/C/d.md.summery
//
// 摘要生成：文档 → 目录 → 库根（自底向上），长度按源文 10%（有地板/天花板），
// 内容为 Markdown 导航文档，用相对路径链接下一层。缺失则生成，存在则校验后直接用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatCompletion } from '../../src/llm.js';
import { updateConfig } from '../../src/config.js';
import { scanKnowledgeTree, walkNodes, treeStats, summaryAbsFor, SUMMARY_DIR } from '../../src/knowledge/tree.js';
import { ensureSummaries, readSummary } from '../../src/knowledge/ensure.js';
import { SummaryCache } from '../../src/knowledge/summarize.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..', '..');

let api = null;
let log = () => {};
let cfg = () => ({});
let docs = null;
let chatFn = chatCompletion;

let registered = [];            // [{ id, root, tree }]
let summaryCache = null;
let summaryTask = { running: false, done: 0, total: 0, error: '', stats: null };
let summaryAbort = false;
let summaryScheduled = false;

/** 库根目录。 */
function knowledgeRoot() {
  const dir = String(cfg().docsDir || 'knowledge');
  return path.isAbsolute(dir) ? dir : (dir === 'knowledge' ? path.join(APP_ROOT, 'knowledge') : path.join(APP_ROOT, dir));
}

function ensureCache() {
  if (summaryCache) return summaryCache;
  const base = process.env.QQ_AGENT_DATA_DIR
    ? path.join(process.env.QQ_AGENT_DATA_DIR, 'knowledge-summaries')
    : path.join(APP_ROOT, 'data', 'knowledge-summaries');
  summaryCache = new SummaryCache({ file: path.join(base, 'index.json'), log });
  return summaryCache;
}

/** 扫描 knowledge/ 下每个库并登记（只读结构，不生成摘要）。 */
function scanAndRegister() {
  const root = knowledgeRoot();
  if (!fs.existsSync(root)) { log(`知识库目录不存在，跳过：${root}`); return { loaded: 0 }; }

  let loaded = 0;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
    const libDir = path.join(root, ent.name);
    const libId = ent.name;
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(libId)) { log(`库名非法，跳过：${libId}`); continue; }

    const tree = scanKnowledgeTree(libDir);
    const st = treeStats(tree);
    if (!st.docs) { log(`${libId}：没有可用文档（只收 md/txt），跳过`); continue; }

    const reg = api.registerSubExtension({
      type: 'knowledge', id: libId,
      name: libId, version: '1.0.0', status: 'active',
      description: libId + '（知识库目录：目录即模块，摘要写在 .summery/）',
      details: {
        moduleCount: Math.max(0, st.dirs - 1),
        dir: libDir,
        docCount: st.docs,
        summaryDir: SUMMARY_DIR,
        summaryRoot: `${SUMMARY_DIR}/${SUMMARY_DIR}`
      }
    });
    if (reg && reg.ok === false) { log(`${libId} 登记失败：${reg.error}`); continue; }

    // 文档入 docRegistry（docId = <库>/<相对路径>）
    walkNodes(tree, (node) => {
      if (node.kind !== 'doc') return;
      const docId = `${libId}/${node.relPath}`;
      let content = '';
      try { content = fs.readFileSync(node.abs, 'utf8').replace(/^\uFEFF/, ''); } catch { /* ignore */ }
      const sum = readSummary(libDir, node);
      docs?.register?.({
        id: docId, title: node.name, layer: 'L3', ownerId: libId,
        path: node.relPath, content,
        summary: sum, summarySource: sum ? 'user' : 'missing'
      });
    });

    // 顶层目录作为模块（供注入展示）
    const modules = (tree.children || []).filter((c) => c.kind === 'dir').map((c) => ({
      id: c.relPath,
      title: c.name,
      intro: '',
      docIds: []
    }));
    docs?.registerKb?.({
      id: libId, title: libId, summary: '', summarySource: 'missing',
      scope: 'global', ownerId: libId, modules
    });

    registered.push({ id: libId, root: libDir, tree });
    loaded += 1;
  }
  log(`知识库：扫描 ${root}，登记 ${loaded} 本`);
  return { loaded };
}

/** 后台生成缺失摘要（每个库独立跑）。 */
async function runSummaryTask() {
  if (summaryTask.running) return;
  const targets = registered.slice();
  if (!targets.length) { summaryScheduled = false; return; }
  summaryAbort = false;
  summaryTask = { running: true, done: 0, total: targets.length, error: '', stats: null };
  const cache = ensureCache();
  try {
    for (const item of targets) {
      if (summaryAbort) break;
      const { stats, entries } = await ensureSummaries(item.root, item.tree, {
        chatCompletion: chatFn,
        model: String(cfg().summaryModel || ''),
        useLlm: cfg().summaryUseLlm !== false && String(cfg().summaryMode || 'auto') !== 'off',
        writeFiles: cfg().summaryWriteBack !== false,
        cache, log,
        budgetTokens: Math.max(1000, Number(cfg().summaryBudgetTokens) || 20000)
      });

      // 回填：文档摘要 + 模块摘要 + 库根摘要
      for (const [rel, entry] of entries) {
        if (!rel) continue;
        const node = findNode(item.tree, rel);
        if (node?.kind === 'doc') {
          docs?.setDocSummary?.(`${item.id}/${rel}`, { summary: entry.text, source: entry.source });
        } else {
          docs?.setModuleIntro?.(item.id, rel, { intro: entry.text, source: entry.source });
        }
      }
      const rootEntry = entries.get('');
      if (rootEntry) docs?.setKbSummary?.(item.id, { summary: rootEntry.text, source: rootEntry.source });
      summaryTask.done += 1;
      summaryTask.stats = { ...(summaryTask.stats || {}), ...stats };
    }
  } catch (error) {
    summaryTask.error = String(error?.message ?? error);
    log(`摘要任务失败：${summaryTask.error}`);
  } finally {
    summaryTask.running = false;
    summaryScheduled = false;
    cache.save();
    log(`摘要任务结束：${summaryTask.done}/${summaryTask.total}` + (summaryTask.error ? `（${summaryTask.error}）` : ''));
  }
}

function findNode(tree, rel) {
  if (!rel) return tree;
  const parts = rel.split('/');
  let cur = tree;
  for (const p of parts) {
    const next = (cur.children || []).find((c) => c.name === p);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

export function setup(hostApi) {
  api = hostApi;
  log = hostApi.log || (() => {});
  cfg = hostApi.config;
  docs = hostApi.docRegistry || null;
  if (!docs) log('核心未提供 docRegistry，知识库将无法登记文档');
}

export function activate() {
  // 扩展仓库页签：本管理器启用时才出现，停用即消失
  api.registerExtensionTab?.({
    id: 'knowledge', label: '知识', icon: '🗂️', order: 50,
    surface: 'both',
    mode: 'template', dataUrl: '/api/extensions?type=knowledge', hint: '目录即模块，摘要写入 .summery'
  });

  if (cfg().enabled === false) { log('知识库管理器已关闭'); return; }
  try {
    clearRegistered();
    scanAndRegister();
    summaryScheduled = true;
    setTimeout(() => { runSummaryTask().catch(() => {}); }, 0);

    // UI 扩展点：在「模型配置」区注入"知识库摘要模型"设置项
    try {
      api.registerUIAction({
        actionId: 'set-summary-model',
        handler: (args) => {
          const model = String(args?.model || '').trim();
          setSummaryModel(model);
          return { ok: true, model };
        }
      });
      api.registerUIContribution({
        id: 'summary-model',
        point: 'page.settings.model.extra',
        kind: 'declarative',
        order: 50,
        title: '知识库摘要模型',
        payload: {
          type: 'form',
          submitLabel: '保存摘要模型',
          actionId: 'set-summary-model',
          fields: [
            {
              name: 'model',
              label: '摘要使用的模型（留空 = 默认模型）',
              value: String(cfg().summaryModel || '')
            }
          ]
        }
      });
    } catch (error) {
      log(`注册模型配置 UI 失败：${error?.message ?? error}`);
    }
    api.registerPromptContribution({
      at: 'after-skill-sections',
      order: 200,
      priority: 40,
      text: () => {
        const kbs = (docs?.listKbs?.() || []).filter((kb) => isKbEnabled(kb.id));
        if (!kbs.length) return '';
        const lines = [];
        for (const kb of kbs.slice(0, Number(cfg().maxKbs) || 6)) {
          lines.push(`· ${kb.title}`);
          const rootMd = String(kb.summary || '').trim();
          if (rootMd) for (const ln of rootMd.split(/\r?\n/).slice(0, 12)) lines.push(`  ${ln}`);
          for (const m of (kb.modules || []).slice(0, Number(cfg().maxModulesPerKb) || 12)) {
            const intro = String(m.intro || '').replace(/\s+/g, ' ').slice(0, 120);
            lines.push(`  - ${m.title}${intro ? `：${intro}` : ''}`);
          }
        }
        const budget = Math.max(500, Number(cfg().maxInjectChars) || 3000);
        return `【知识库】以下为目录导航；需要正文时调用 load_doc(docId)：\n${lines.join('\n').slice(0, budget)}`;
      }
    });
  } catch (error) {
    log(`激活失败：${error?.message ?? error}`);
  }
}

/** 保存摘要模型到本扩展设置（全局）。 */
function setSummaryModel(model) {
  try {
    updateConfig({ skills: { 'ext-knowledge': { summaryModel: String(model || '') } } });
    return true;
  } catch (error) {
    log(`保存摘要模型失败：${error?.message ?? error}`);
    return false;
  }
}

function isKbEnabled(kbId) {
  try {
    const d = api.getSubExtension(kbId);
    if (!d) return false;
    const explicit = api.isExtensionEnabled?.(kbId);
    if (explicit !== null && explicit !== undefined) return explicit !== false;
    return true;
  } catch { return false; }
}

function clearRegistered() {
  for (const r of registered) {
    docs?.unregisterByOwner?.(r.id);
    api.unregisterSubExtension(r.id);
  }
  registered = [];
}

export function deactivate() {
  
  try { api.unregisterExtensionTab?.(); } catch { /* ignore */ }
summaryAbort = true;
  summaryScheduled = false;
  try { clearRegistered(); api.unregisterPromptContribution?.(); } catch (error) { log(`停用失败：${error?.message ?? error}`); }
}

export function dispose() { deactivate(); }
export function available() { return true; }

export function summaryStatus() {
  return {
    task: { ...summaryTask },
    scheduled: summaryScheduled,
    libs: registered.map((r) => r.id),
    stats: docs?.summaryStats?.() || null
  };
}

export function __setChatForTest(fn) { chatFn = typeof fn === 'function' ? fn : chatCompletion; }
export { summaryAbsFor };
