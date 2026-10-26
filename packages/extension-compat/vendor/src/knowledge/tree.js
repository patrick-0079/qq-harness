// 知识库目录树：每个文件夹是一个模块（可递归），文件是文档。
//
// 约定：
//   knowledge/<库>/1.md, b.md, C/d.md, C/D/aaa.md
//   摘要镜像在同库的 .summery/ 下：
//     .summery/.summery           ← 库根摘要（就用 .summery 这个名字）
//     .summery/1.md.summery
//     .summery/C.summery          ← 目录 C 的摘要
//     .summery/C/d.md.summery
//     .summery/C/D.summery
//     .summery/C/D/aaa.md.summery

import fs from 'node:fs';
import path from 'node:path';

export const SUMMARY_DIR = '.summery';
export const SUMMARY_SUFFIX = '.summery';
const DOC_EXT = new Set(['.md', '.txt', '.markdown']);

/** 扫描一个库根目录，返回树。 */
export function scanKnowledgeTree(rootDir, { maxDepth = 8 } = {}) {
  const root = { kind: 'dir', name: path.basename(rootDir), relPath: '', abs: rootDir, depth: 0, children: [] };
  walk(rootDir, root, 0, maxDepth);
  return root;
}

function walk(dirAbs, node, depth, maxDepth) {
  if (depth >= maxDepth) return;
  let entries = [];
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;   // 跳过 .summery 与隐藏项
    const abs = path.join(dirAbs, ent.name);
    const relPath = node.relPath ? `${node.relPath}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      const child = { kind: 'dir', name: ent.name, relPath, abs, depth: depth + 1, children: [] };
      node.children.push(child);
      walk(abs, child, depth + 1, maxDepth);
    } else if (ent.isFile() && DOC_EXT.has(path.extname(ent.name).toLowerCase())) {
      node.children.push({ kind: 'doc', name: ent.name, relPath, abs, depth: depth + 1 });
    }
  }
  node.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
}

/** 某个节点的摘要文件绝对路径（库根 → .summery/.summery）。 */
export function summaryAbsFor(rootDir, node) {
  const sumRoot = path.join(rootDir, SUMMARY_DIR);
  if (!node.relPath) return path.join(sumRoot, SUMMARY_DIR);   // .summery/.summery
  const parentRel = node.relPath.includes('/') ? node.relPath.slice(0, node.relPath.lastIndexOf('/')) : '';
  const base = path.basename(node.relPath);
  return path.join(sumRoot, parentRel, `${base}${SUMMARY_SUFFIX}`);
}

/** 相对路径（从 fromDir 到 toAbs），正斜杠。 */
export function relLink(fromDirAbs, toAbs) {
  const rel = path.relative(fromDirAbs, toAbs).replace(/\\/g, '/');
  return rel || '.';
}

/** 某节点的「下一层」列表（用于导航摘要的内容与链接）。 */
export function childLinksFor(rootDir, node) {
  if (node.kind !== 'dir') return [];
  return node.children.map((c) => ({
    title: c.name,
    href: relLink(path.dirname(summaryAbsFor(rootDir, node)), summaryAbsFor(rootDir, c)),
    kind: c.kind
  }));
}

/** 前序遍历所有节点（含根）。 */
export function walkNodes(root, fn, parent = null) {
  fn(root, parent);
  for (const c of root.children || []) walkNodes(c, fn, root);
}

/** 统计：文档数、目录数。 */
export function treeStats(root) {
  const out = { docs: 0, dirs: 0, chars: 0 };
  walkNodes(root, (n) => {
    if (n.kind === 'doc') {
      out.docs += 1;
      try { out.chars += fs.statSync(n.abs).size; } catch { /* ignore */ }
    } else {
      out.dirs += 1;
    }
  });
  return out;
}

export { DOC_EXT };
