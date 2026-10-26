// 知识库清单校验：结构（不可猜）+ 摘要（Markdown 导航文档，按比例限长）。
//
// 摘要格式（v2）：
//   · L0/L1/L2 都是 **Markdown 文档**，说明下一层主要写了什么
//   · 用**相对路径链接**指向下一层文档，模型据此逐层深入（load_doc 取正文）
//   · 长度上限 = 源文长度的 10%（逐级），并设地板/天花板避免过短或失控
//
// 三态：
//   · 结构非法 → 拒绝加载该库
//   · 摘要缺失 → 自动生成
//   · 摘要非法 → auto 重生成 / strict 拒绝 / off 原样用

/** 各级摘要的字符上限比例（相对源文）。 */
export const SUMMARY_RATIO = 0.1;

/** 各级摘要的长度地板/天花板（字符）。纯比例会让小库摘要短到不可用。 */
export const SUMMARY_BOUNDS = {
  L0: { min: 60, max: 1200 },
  L1: { min: 80, max: 2000 },
  L2: { min: 60, max: 4000 }
};

const DOC_EXT = new Set(['.md', '.txt', '.markdown']);
const PLACEHOLDER_RE = /^(todo|tbd|待补充|待完善|暂无|n\/a|\.{3,}|…+|-+)$/i;

/**
 * 计算某一级的摘要字数上限。
 * @param {number} sourceLength 源文长度（L2 取 L3，L1 取下层 L2 之和，L0 取下层 L1 之和）
 * @param {'L0'|'L1'|'L2'} level
 */
export function summaryCap(sourceLength, level) {
  const bound = SUMMARY_BOUNDS[level] || SUMMARY_BOUNDS.L2;
  const n = Number(sourceLength) || 0;
  const byRatio = Math.round(n * SUMMARY_RATIO);
  return Math.max(bound.min, Math.min(bound.max, byRatio));
}

/**
 * 校验一段摘要（Markdown 允许换行/标题/列表，但仍是"摘要"）。
 * @param {*} text
 * @param {'L0'|'L1'|'L2'} level
 * @param {object} [opts] { title, sourceLength, allowMarkdown=true, requireLinks }
 */
export function validateSummaryText(text, level, {
  title = '', sourceLength = 0, allowMarkdown = true, requireLinks = 0
} = {}) {
  if (typeof text !== 'string') return { ok: false, reason: '不是字符串' };
  const s = text.trim();
  if (!s) return { ok: false, reason: '为空' };

  const cap = summaryCap(sourceLength, level);
  const len = Array.from(s).length;
  if (len > cap) {
    return { ok: false, reason: `超过上限（${len} > ${cap} 字，源文 ${sourceLength} 字的 ${SUMMARY_RATIO * 100}%）` };
  }

  if (!allowMarkdown) {
    if (/[\r\n]/.test(s)) return { ok: false, reason: '含换行（应为单段）' };
    if (/^\s*#{1,6}\s/.test(s)) return { ok: false, reason: '以 Markdown 标题开头' };
  }
  if (/```/.test(s)) return { ok: false, reason: '含代码块（摘要不应包含代码）' };
  if (PLACEHOLDER_RE.test(s.replace(/^#+\s*/gm, '').trim())) return { ok: false, reason: '占位符' };
  if (title && stripMd(s) === String(title).trim()) return { ok: false, reason: '与标题完全相同' };

  if (requireLinks > 0) {
    const links = extractLinks(s);
    if (links.length < requireLinks) {
      return { ok: false, reason: `应至少包含 ${requireLinks} 个指向下一层的相对链接（当前 ${links.length}）` };
    }
  }
  return { ok: true, chars: len, cap };
}

/** 去掉 Markdown 标记后的纯文本（用于占位符/同标题判定）。 */
export function stripMd(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_~>#-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 提取 Markdown 链接目标（只收相对路径，忽略 http/https/mailto/锚点）。 */
export function extractLinks(text) {
  const out = [];
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const href = m[1].trim();
    if (!href || href.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;   // http:, mailto: 等
    out.push(href);
  }
  return out;
}

/**
 * 校验摘要里的相对链接：必须解析到包目录内、且文件存在。
 * @returns {{ ok: boolean, violations: string[], resolved: string[] }}
 */
export function validateSummaryLinks(md, { dir, fsExists = null, baseDir = null } = {}) {
  const violations = [];
  const resolved = [];
  const base = baseDir ? joinPath(dir, baseDir) : dir;
  for (const href of extractLinks(md)) {
    if (path_isAbsolute(href)) { violations.push(`链接不能是绝对路径：${href}`); continue; }
    const target = normalizePosix(joinPath(base, href));
    const pkgRoot = normalizePosix(dir);
    if (pkgRoot && !target.startsWith(`${pkgRoot}/`) && target !== pkgRoot) {
      violations.push(`链接越出包目录：${href}`);
      continue;
    }
    if (fsExists && !fsExists(target)) { violations.push(`链接指向的文件不存在：${href}`); continue; }
    resolved.push(href);
  }
  return { ok: violations.length === 0, violations, resolved };
}

/**
 * 校验一个知识库包的结构。
 *
 * 兼容两种写法：
 *   · 文本摘要：modules[].docs[] 为字符串或 { path, summary }
 *   · Markdown 导航：summaryFile / introFile / docs[].summaryFile 指向包内 md
 */
export function validateKnowledgePackage(raw, { dir = '', fsExists = null } = {}) {
  const violations = [];
  const docEntries = [];

  if (!raw || typeof raw !== 'object') return { ok: false, violations: ['knowledge.json 不是对象'], docEntries };

  const id = String(raw.id || '').trim();
  if (!id) violations.push('缺少 id');
  else if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) violations.push(`id 非法：${id}`);

  const checkFile = (rel, label) => {
    if (!rel) return;
    if (path_isAbsolute(rel)) { violations.push(`${label} 必须是相对路径：${rel}`); return; }
    if (normalizePosix(rel).startsWith('..')) { violations.push(`${label} 越界：${rel}`); return; }
    const ext = String(rel).toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
    if (!DOC_EXT.has(ext)) { violations.push(`${label} 只支持 md/txt：${rel}`); return; }
    if (fsExists && dir && !fsExists(joinPath(dir, rel))) violations.push(`${label} 不存在：${rel}`);
  };

  checkFile(String(raw.summaryFile || ''), 'summaryFile');

  const modules = Array.isArray(raw.modules) ? raw.modules : [];
  const moduleIds = new Set();
  const docIds = new Set();

  for (const [mi, m] of modules.entries()) {
    const mid = String(m?.id || '').trim();
    if (!mid) violations.push(`modules[${mi}] 缺少 id`);
    else if (moduleIds.has(mid)) violations.push(`模块 id 重复：${mid}`);
    else moduleIds.add(mid);

    checkFile(String(m?.introFile || ''), `模块 ${mid} 的 introFile`);

    const docs = Array.isArray(m?.docs) ? m.docs : [];
    for (const [di, d] of docs.entries()) {
      const rel = typeof d === 'string' ? d : String(d?.path || '');
      if (!rel) { violations.push(`modules[${mi}].docs[${di}] 缺少 path`); continue; }
      if (path_isAbsolute(rel)) { violations.push(`文档路径必须是相对路径：${rel}`); continue; }
      if (normalizePosix(rel).startsWith('..')) { violations.push(`文档路径越界：${rel}`); continue; }

      const ext = String(rel).toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
      if (!DOC_EXT.has(ext)) { violations.push(`文档类型不支持（只收 md/txt）：${rel}`); continue; }
      if (fsExists && dir && !fsExists(joinPath(dir, rel))) { violations.push(`文档不存在：${rel}`); continue; }

      const summaryFile = typeof d === 'string' ? '' : String(d?.summaryFile || '');
      if (summaryFile) checkFile(summaryFile, `文档 ${rel} 的 summaryFile`);

      const docId = String(d?.id || `${id}.${mid}.${basenameNoExt(rel)}`);
      if (docIds.has(docId)) { violations.push(`文档 id 重复：${docId}`); continue; }
      docIds.add(docId);

      docEntries.push({
        moduleId: mid,
        moduleIndex: mi,
        docId,
        relPath: rel,
        title: String(d?.title || basenameNoExt(rel)),
        summary: typeof d === 'string' ? '' : String(d?.summary || ''),
        summaryFile
      });
    }
  }

  return { ok: violations.length === 0, violations, docEntries };
}

// ── 路径小工具（零依赖，便于纯函数测试）──────────────────────────────────
function path_isAbsolute(p) {
  const s = String(p);
  return s.startsWith('/') || s.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(s);
}
function normalizePosix(p) {
  const parts = String(p).replace(/\\/g, '/').split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}
function joinPath(dir, rel) {
  return `${String(dir).replace(/[\\/]+$/, '')}/${String(rel).replace(/\\/g, '/')}`;
}
function basenameNoExt(rel) {
  const base = String(rel).replace(/\\/g, '/').split('/').pop() || 'doc';
  return base.replace(/\.[^.]+$/, '');
}
