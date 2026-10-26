// 知识库摘要的"过期检测"：L0–L2 摘要记录自己覆盖的下一层文件 md5，
// 与磁盘现状比对 —— 有变化就提示"建议重新生成"，**不强制**。
//
// 记录文件：<库>/.summery/meta.json
//   { "nodes": { "<relPath>": { "level": "L2", "md5": { "install.md": "abc..." }, "at": 1761... } } }
//
// 为什么不用 mtime：mtime 会因为拷贝/恢复而整体变化，md5 只看内容。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scanKnowledgeTree, walkNodes, summaryAbsFor, SUMMARY_DIR } from './tree.js';

export const META_FILE = 'meta.json';

function md5File(abs) {
  try { return crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex'); } catch { return ''; }
}

/** 读取（或初始化）meta.json。 */
export function readMeta(rootDir) {
  const file = path.join(rootDir, SUMMARY_DIR, META_FILE);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || { nodes: {} }; }
  catch { return { nodes: {} }; }
}

export function writeMeta(rootDir, meta) {
  const dir = path.join(rootDir, SUMMARY_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, META_FILE);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 计算某节点的"下一层指纹"。
 *   · 目录 → 直接子文件/子目录（目录取其摘要文件）的 md5
 *   · 文档 → 文件自身 md5
 */
export function fingerprintOf(rootDir, node) {
  const out = {};
  if (node.kind === 'doc') {
    out[node.name] = md5File(node.abs);
    return out;
  }
  for (const child of node.children || []) {
    const target = child.kind === 'doc' ? child.abs : summaryAbsFor(rootDir, child);
    out[child.name] = md5File(target);
  }
  return out;
}

/** 把当前指纹写入 meta（生成/重建摘要后调用）。 */
export function recordFingerprints(rootDir, tree = null) {
  const t = tree || scanKnowledgeTree(rootDir);
  const meta = readMeta(rootDir);
  meta.nodes = meta.nodes || {};
  walkNodes(t, (node) => {
    // 只记录 L0/L1/L2（有下层的节点）
    if (node.kind === 'doc' && node.depth === 0) return;
    meta.nodes[node.relPath || '.'] = {
      level: node.depth === 0 ? 'L0' : (node.kind === 'dir' ? 'L1' : 'L2'),
      md5: fingerprintOf(rootDir, node),
      at: Date.now()
    };
  });
  writeMeta(rootDir, meta);
  return meta;
}

/**
 * 检测过期：返回 { stale: [{ node, changed: [...] }], checked, recorded }
 */
export function detectStale(rootDir, tree = null) {
  const t = tree || scanKnowledgeTree(rootDir);
  const meta = readMeta(rootDir);
  const stale = [];
  let checked = 0;
  walkNodes(t, (node) => {
    const key = node.relPath || '.';
    const rec = meta.nodes?.[key];
    if (!rec) return;          // 没记录过 = 不是"过期"，是"还没生成"
    checked += 1;
    const now = fingerprintOf(rootDir, node);
    const changed = [];
    for (const [name, hash] of Object.entries(now)) {
      if (!rec.md5 || rec.md5[name] !== hash) changed.push(name);
    }
    if (changed.length) stale.push({ node: key, level: rec.level, changed, at: rec.at || 0 });
  });
  return { stale, checked, recorded: Object.keys(meta.nodes || {}).length };
}
