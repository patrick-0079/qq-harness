// 知识库摘要生成：按源文比例（默认 10%）生成 Markdown 导航文档。
//
// 分层语义：
//   L0 库导航：说明本库有哪些模块，链接到各模块的 L1
//   L1 模块导航：说明本模块有哪些文档，链接到各文档的 L2
//   L2 文档摘要：概括这篇文档写了什么，链接到 L3 原文
//   L3 原文：文档正文
//
// 约定：
//   · 长度上限 = 源文长度 × SUMMARY_RATIO（有地板/天花板，见 validate.js）
//   · 摘要里用**相对路径**引用下一层，模型据此逐层深入
//   · 缓存写 sidecar（data/knowledge-summaries/），默认不改用户清单
//   · LLM 失败/超时/无 Key → 抽取式兜底（Markdown 列表，带子级链接）

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { summaryCap, extractLinks, stripMd } from './validate.js';

export const PROMPT_VERSION = 2;   // v2：Markdown 导航 + 比例限长

/** 输入采样：头 2000 + 尾 1000，避免超长文档烧 token。 */
export function sampleContent(content, { head = 2000, tail = 1000 } = {}) {
  const s = String(content || '');
  if (s.length <= head + tail) return s;
  return `${s.slice(0, head)}\n…\n${s.slice(-tail)}`;
}

/** 去掉 Markdown 标记，压缩空白。 */
export function stripMarkdown(text) {
  return stripMd(text);
}

/** 取第一段正文（跳过标题/代码块）。 */
function firstParagraph(content) {
  const lines = String(content || '').split(/\r?\n/);
  const buf = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { if (buf.length) break; continue; }
    if (/^#{1,6}\s/.test(t)) continue;
    if (/^```/.test(t)) break;
    if (/^[-*+]\s/.test(t) || /^\d+\.\s/.test(t)) { buf.push(t.replace(/^[-*+]\s+|^\d+\.\s+/, '')); continue; }
    buf.push(t);
    if (buf.join('').length > 200) break;
  }
  return buf.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 抽取式摘要：Markdown 形式 + 子级链接，保证非空。
 * @param {string} content 源文
 * @param {object|number} opts 兼容旧签名（数字 = maxChars）
 */
export function extractiveSummary(content, opts = {}) {
  const o = typeof opts === 'number' ? { maxChars: opts } : (opts || {});
  const level = o.level || 'L2';
  const title = String(o.title || '');
  const children = Array.isArray(o.children) ? o.children : [];
  const sourceLength = Number(o.sourceLength) || String(content || '').length;
  const cap = Number(o.maxChars) || summaryCap(sourceLength, level);

  const para = firstParagraph(content);
  const head = para ? para.slice(0, Math.max(20, cap - 40)) : '';

  const lines = [];
  if (title) lines.push(`## ${title}`);
  if (head) lines.push(head);
  else if (level !== 'L2') lines.push(`本层包含 ${children.length} 个下级条目。`);
  if (children.length) {
    lines.push('');
    for (const c of children.slice(0, 12)) {
      const label = String(c.title || c.href || '').replace(/[\[\]]/g, '');
      lines.push(c.href ? `- [${label}](${c.href})` : `- ${label}`);
    }
  }
  let text = lines.join('\n').trim();
  if (!text) text = `## ${title || '摘要'}\n（自动摘要不可用）`;
  const chars = Array.from(text);
  if (chars.length > cap) text = chars.slice(0, Math.max(0, cap - 1)).join('') + '…';
  return text;
}

/** 内容哈希（缓存失效判断）。 */
export function hashContent(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 16);
}

/**
 * LLM 摘要：输出 Markdown 导航文档，长度受比例约束。
 * @returns {Promise<string|null>} null = 不可用/失败（调用方回落抽取式）
 */
export async function llmSummary({
  title = '',
  content = '',
  level = 'L2',
  children = [],
  sourceLength = 0,
  model = '',
  timeoutMs = 20000,
  chatCompletion = null
} = {}) {
  if (typeof chatCompletion !== 'function') return null;

  const srcLen = Number(sourceLength) || String(content || '').length;
  const cap = summaryCap(srcLen, level);
  const sample = sampleContent(content);
  if (stripMarkdown(sample).length < 10) return null;

  const levelHint = {
    L0: '这是知识库的导航文档：概括本库主题，并列出各模块（用给出的相对路径链接）',
    L1: '这是模块的导航文档：概括本模块主题，并列出各文档（用给出的相对路径链接）',
    L2: '这是文档摘要：概括它写了什么（可链接到原文）'
  }[level] || '写一段摘要';

  const childLines = children.slice(0, 20)
    .map((c) => `- ${c.title || c.href} → ${c.href || '（无链接）'}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content: '你是知识库编辑。输出 Markdown：可以有小标题与无序列表，不要代码块，不要寒暄。必须严格遵守字数上限。'
    },
    {
      role: 'user',
      content: [
        `标题：${title}`,
        levelHint,
        `字数上限：${cap} 个字符（源文 ${srcLen} 字的 10%，硬限制）。`,
        childLines ? `下一层条目（相对路径，请原样用于链接）：\n${childLines}` : '',
        `\n正文（可能被截断）：\n${sample}`
      ].filter(Boolean).join('\n')
    }
  ];

  try {
    const result = await Promise.race([
      chatCompletion({ messages, overrides: model ? { model } : undefined }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('摘要超时')), timeoutMs))
    ]);
    let text = String(result?.message?.content ?? '').trim();
    if (!text) return null;
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim();
    const chars = Array.from(text);
    if (chars.length > cap) text = chars.slice(0, Math.max(0, cap - 1)).join('') + '…';
    return text;
  } catch {
    return null;
  }
}

/**
 * 摘要缓存（sidecar 文件）。
 * 结构：{ [key]: { hash, level, text, source, promptVersion, at } }
 */
export class SummaryCache {
  constructor({ file = '', log = () => {} } = {}) {
    this.file = file;
    this.log = log;
    this.data = {};
    this.dirty = false;
    this.#load();
  }

  #load() {
    if (!this.file) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object') this.data = parsed;
    } catch { /* 不存在/损坏 → 空缓存 */ }
  }

  get(level, targetId, hash) {
    const entry = this.data[`${level}:${targetId}`];
    if (!entry) return null;
    if (entry.promptVersion !== PROMPT_VERSION) return null;
    if (hash && entry.hash !== hash) return null;
    return entry;
  }

  set(level, targetId, { hash, text, source }) {
    this.data[`${level}:${targetId}`] = {
      hash, text, source, level, promptVersion: PROMPT_VERSION, at: Date.now()
    };
    this.dirty = true;
  }

  save() {
    if (!this.file || !this.dirty) return false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
      this.dirty = false;
      return true;
    } catch (error) {
      this.log(`摘要缓存写入失败：${error?.message ?? error}`);
      return false;
    }
  }

  stats() {
    const out = { user: 0, llm: 0, extractive: 0, invalid: 0, missing: 0 };
    for (const e of Object.values(this.data)) {
      if (out[e.source] !== undefined) out[e.source] += 1;
    }
    return out;
  }
}

export { extractLinks };
