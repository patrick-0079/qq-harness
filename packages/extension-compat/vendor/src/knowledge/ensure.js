// 生成 .summery 镜像树：文档摘要 → 目录摘要 → 库根摘要（自底向上）。
//
// 每个摘要文件都是 Markdown 导航文档：
//   · 文档摘要：概括该文档，链接到原文
//   · 目录摘要：列出子文件/子目录，链接到各自的 .summery
//   · 库根摘要：列出顶层条目，链接到各自 .summery

import fs from 'node:fs';
import path from 'node:path';
import { summaryCap, validateSummaryText, validateSummaryLinks } from './validate.js';
import { extractiveSummary, llmSummary, hashContent } from './summarize.js';
import { summaryAbsFor, childLinksFor, relLink, SUMMARY_DIR } from './tree.js';
import { recordFingerprints } from './stale.js';

/** 读文件（去 BOM），失败返回 ''。 */
function readText(abs, limit = 200000) {
  try {
    const s = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '');
    return s.length > limit ? s.slice(0, limit) : s;
  } catch { return ''; }
}

/** 写摘要文件（原子写）。 */
export function writeSummary(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  fs.renameSync(tmp, abs);
}

/**
 * 保证一个库的摘要齐备。
 *
 * @param {string} rootDir 库根
 * @param {object} tree    scanKnowledgeTree 的结果
 * @param {object} opts
 *   levelFor(node) → 'L0'|'L1'|'L2'
 *   chatCompletion, model, useLlm, writeFiles, cache, log, budgetTokens
 * @returns {Promise<{ stats, entries: Map<relPath, {text, source, cap}> }>}
 */
export async function ensureSummaries(rootDir, tree, {
  chatCompletion = null, model = '', useLlm = true, writeFiles = true,
  cache = null, log = () => {}, budgetTokens = 20000
} = {}) {
  const entries = new Map();
  const stats = { user: 0, llm: 0, extractive: 0, missing: 0, written: 0, chars: 0 };
  let spent = 0;

  // 自底向上：先文档，再目录（深度从大到小），最后根
  const nodes = [];
  (function collect(n) {
    nodes.push(n);
    for (const c of n.children || []) collect(c);
  })(tree);
  const ordered = [...nodes].sort((a, b) => b.depth - a.depth || (a.kind === 'doc' ? -1 : 1));

  for (const node of ordered) {
    const level = node.depth === 0 ? 'L0' : (node.kind === 'dir' ? 'L1' : 'L2');
    const sumAbs = summaryAbsFor(rootDir, node);
    // 文档摘要的下一层就是原文；目录摘要的下一层是子条目
    const children = node.kind === 'doc'
      ? [{ title: node.name, href: relLink(path.dirname(sumAbs), node.abs) }]
      : childLinksFor(rootDir, node);

    // 源文长度：文档取正文；目录取子摘要之和
    let sourceLength = 0;
    if (node.kind === 'doc') {
      sourceLength = readText(node.abs).length;
    } else {
      for (const c of node.children || []) {
        const e = entries.get(c.relPath);
        sourceLength += e ? String(e.text || '').length : 0;
      }
      if (!sourceLength && node.children?.length) sourceLength = 200 * node.children.length;
    }
    const cap = summaryCap(sourceLength, level);

    const needLinks = children.length ? 1 : 0;
    const checkOpts = { title: node.name, sourceLength, requireLinks: needLinks };

    // 1) 已有摘要文件：校验后直接用
    let existing = '';
    try { if (fs.existsSync(sumAbs)) existing = readText(sumAbs); } catch { /* ignore */ }
    if (existing) {
      const ok = validateSummaryText(existing, level, checkOpts).ok
        && validateSummaryLinks(existing, { dir: rootDir, fsExists: (x) => fs.existsSync(x), baseDir: path.relative(rootDir, path.dirname(sumAbs)) || '.' }).ok;
      if (ok) {
        entries.set(node.relPath, { text: existing, source: 'user', cap, level });
        stats.user += 1;
        continue;
      }
      log(`${node.relPath || '.'}：摘要不合规，重新生成`);
    }

    // 2) 缓存
    let text = '';
    let source = 'llm';
    const hash = hashContent(`${level}|${node.name}|${sourceLength}|${children.map((c) => c.href).join(',')}`);
    const hit = cache ? cache.get(level, node.relPath || '__root__', hash) : null;
    if (hit) {
      text = hit.text; source = hit.source || 'llm';
    } else {
      // 3) LLM → 抽取式
      const content = node.kind === 'doc' ? readText(node.abs) : '';
      if (useLlm && chatCompletion && spent < budgetTokens) {
        const t = await llmSummary({
          title: node.name, content, level, children, sourceLength, model, chatCompletion
        });
        if (t && validateSummaryText(t, level, { ...checkOpts, requireLinks: 0 }).ok) {
          text = t; source = 'llm';
          spent += Math.ceil(sourceLength / 2);
        }
      }
      if (!text) {
        text = extractiveSummary(content || `本层含 ${children.length} 个条目。`, {
          level, maxChars: cap, title: node.name, children, sourceLength
        });
        source = 'extractive';
      }
      if (cache) cache.set(level, node.relPath || '__root__', { hash, text, source });
    }

    entries.set(node.relPath, { text, source, cap, level });
    stats[source] = (stats[source] || 0) + 1;
    stats.chars += text.length;

    // 4) 落盘（只写 .summery 下的文件）
    if (writeFiles) {
      try { writeSummary(sumAbs, text); stats.written += 1; } catch (error) { log(`写摘要失败 ${sumAbs}：${error?.message ?? error}`); }
    }
  }

  // record fingerprints of children for stale detection
  try { if (writeFiles) recordFingerprints(rootDir, tree); } catch { /* ignore */ }
  return { stats, entries };
}

/** 读某节点已有摘要文本（不生成）。 */
export function readSummary(rootDir, node) {
  return readText(summaryAbsFor(rootDir, node));
}

export { SUMMARY_DIR };
