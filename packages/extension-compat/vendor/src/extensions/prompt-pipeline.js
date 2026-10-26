// 提示词段落管线：把系统提示从"硬编码数组"改成"可寻址段落 + 有序注入"。
//
// 为什么需要它：
//   1. promptinject 类型要能按锚点追加、按 target 改写，而现有实现只能
//      在末尾追加 Skill 片段，或在 before-llm-messages 里对整串做字符串手术
//      （分支差异、同锚点顺序、安全段保护都不可验证）
//   2. 段落有稳定 id 后，测试可以逐段快照，重构不会悄悄改变人设行为
//
// 字节兼容：没有注入时，渲染结果必须与改造前完全一致（由快照测试锁定）。
// 渲染规则：段落之间用 "\n\n" 连接（等价于旧实现的 parts 间插 ''）。

import { resolveRewriteConflicts } from './prompt-inject.js';
import { renderTemplate } from './template-vars.js';

/**
 * 内置分支的段落顺序（无提示词库覆盖时）。
 * 与改造前 buildSystemPrompt 的 parts 顺序一一对应。
 */
export const BUILTIN_SEGMENT_ORDER = [
  'identity',
  'security',
  'tool-protocol',
  'anti-ai-flavor',
  'subjectivity',
  'speak-or-not',
  'not-a-queue',
  'human-rhythm',
  'not-moderator',
  'quote-and-at',
  'memory-rules',
  'sticker-rules',
  'qq-scene',
  'report-ban'
];

/** 提示词库分支的段落顺序（人设正文替换行为准则簇）。 */
export const LIBRARY_SEGMENT_ORDER = ['persona', 'security', 'tool-protocol'];

/** 追加锚点 → 段落位置（相对段 id）。 */
export const ANCHOR_ANCHORS = {
  'before-all':            { before: null, after: null, atStart: true },
  'after-identity':        { after: 'identity', afterFallback: 'persona' },
  'after-security':        { after: 'security' },
  'after-tool-protocol':   { after: 'tool-protocol' },
  'after-guidelines':      { after: 'report-ban', afterFallback: 'tool-protocol' },
  'before-skill-sections': { before: 'skill-sections' },
  'after-skill-sections':  { after: 'skill-sections', afterFallback: 'tool-protocol' },
  'before-admin-rules':    { before: 'admin-rules' },
  'after-admin-rules':     { after: 'admin-rules', afterFallback: 'skill-sections' },
  'at-tail':               { atEnd: true }
};

/**
 * 应用提示词注入。
 *
 * @param {Array<{id: string, text: string}>} blocks — 核心段落（顺序即渲染顺序）
 * @param {object} opts
 *   rewrites: Array<{ target, ownerId, fn(original) => string }>
 *   appends:  Array<{ at, ownerId, injectId, text, order, priority }>
 * @returns {Array<{id, text, source?}>} 变换后的段落
 */
export function applyPromptInjects(blocks, { rewrites = [], appends = [] } = {}) {
  let out = blocks.map((b) => ({ ...b }));

  // ── 1. 先应用改写（同 target 只允许一个生效，由调用方 resolveRewriteConflicts 决定） ──
  for (const rw of rewrites) {
    const target = String(rw.target || '');
    if (!target) continue;
    const idx = out.findIndex((b) => b.id === target);
    if (idx < 0) continue;   // 该分支没有这一段：不静默报错，由上层诊断
    const original = out[idx].text;
    let next;
    try {
      next = rw.fn(original);
    } catch (error) {
      // 改写失败保留原文（提示词装配不能因为一个扩展崩掉整轮对话）
      continue;
    }
    if (typeof next !== 'string') continue;
    // 安全底线：security 段改写后不能为空，否则保留原文
    if (target === 'security' && !next.trim()) continue;
    out[idx] = { ...out[idx], text: next, source: rw.ownerId || '' };
  }

  // ── 2. 再插入追加段（按锚点定位） ──
  const sortedAppends = [...appends].sort((a, b) =>
    (Number(a.order) || 100) - (Number(b.order) || 100)
    || (Number(b.priority) || 50) - (Number(a.priority) || 50)
    || String(a.ownerId || '').localeCompare(String(b.ownerId || ''))
  );

  for (const ap of sortedAppends) {
    const text = String(ap.text ?? '');
    if (!text.trim()) continue;
    const at = String(ap.at || 'at-tail');
    const anchor = ANCHOR_ANCHORS[at];
    if (!anchor) continue;   // 非法锚点在加载期已被拒绝，这里防运行期脏数据

    const block = {
      id: `inject:${ap.ownerId || 'unknown'}:${ap.injectId || 'x'}`,
      text,
      source: ap.ownerId || ''
    };

    let insertAt = out.length;   // 默认末尾
    if (anchor.atStart) {
      insertAt = 0;
    } else if (anchor.atEnd) {
      insertAt = out.length;
    } else if (anchor.before) {
      const i = out.findIndex((b) => b.id === anchor.before);
      insertAt = i >= 0 ? i : findFallbackIndex(out, anchor.before);
    } else if (anchor.after) {
      const i = out.findIndex((b) => b.id === anchor.after);
      if (i >= 0) insertAt = i + 1;
      else if (anchor.afterFallback) {
        const j = out.findIndex((b) => b.id === anchor.afterFallback);
        insertAt = j >= 0 ? j + 1 : out.length;
      }
    }

    out.splice(insertAt, 0, block);
  }

  return out;
}

/** before 锚点不存在时的退化位置：插到末尾（宁可位置偏后，也不丢内容）。 */
function findFallbackIndex(blocks, _anchorId) {
  return blocks.length;
}

/**
 * 渲染段落为最终字符串。
 * 无注入时与改造前 `parts.join('\n')` 的字节一致（段落间空行）。
 */
export function renderSegments(blocks) {
  return blocks.map((b) => b.text).join('\n\n');
}

/**
 * 诊断：列出某分支的实际段落 id 顺序。
 * 供 /api/prompt-preview 与测试使用。
 */
export function segmentIds(blocks) {
  return blocks.map((b) => b.id);
}

// ── 注入源注册表 ─────────────────────────────────────────────────────────
//
// promptinject 管理器插件把每个子包登记进来；prompt.js 装配时调用
// collectPromptInjects() 取当前会话生效的注入。
//
// 约束（在加载期已校验，这里防运行期脏数据）：
//   · append/rewrite 必须同步返回字符串；返回 Promise 视为违规跳过
//   · 同 target 多 rewrite 由 resolveRewriteConflicts 决定唯一胜者

const injectSources = new Map();   // ownerId -> { order, injects, append, rewrite, enabled(ctx) }

// 只追加的贡献源（知识库 L0/L1、工具目录等）：不进 rewrite 通道，避免与 promptinject 抢改写权
const contributionSources = new Map(); // ownerId -> { at, order, priority, text(ctx) }

/**
 * 登记一个「只追加」的提示词贡献源。
 * 与 promptinject 的区别：它不能改写核心段落，只能在锚点处追加。
 */
export function registerPromptContributionSource(ownerId, source) {
  if (!ownerId) throw new Error('prompt contribution 缺少 ownerId');
  if (typeof source?.text !== 'function') throw new Error(`prompt contribution ${ownerId} 缺少 text(ctx) 函数`);
  contributionSources.set(String(ownerId), {
    at: String(source.at || 'after-skill-sections'),
    order: Number(source.order) || 100,
    priority: Number(source.priority) || 50,
    text: source.text
  });
}

export function unregisterPromptContributionSource(ownerId) {
  return contributionSources.delete(String(ownerId));
}

/**
 * 登记一个提示词注入源。
 * @param {string} ownerId
 * @param {object} source { order, injects, append, rewrite, enabled? }
 */
export function registerPromptInjectSource(ownerId, source) {
  if (!ownerId) throw new Error('promptinject 缺少 ownerId');
  if (!Array.isArray(source?.injects)) throw new Error(`promptinject ${ownerId} 缺少 injects[]`);
  injectSources.set(String(ownerId), {
    order: Number(source.order) || 100,
    injects: source.injects,
    append: typeof source.append === 'function' ? source.append : null,
    rewrite: typeof source.rewrite === 'function' ? source.rewrite : null,
    enabled: typeof source.enabled === 'function' ? source.enabled : null
  });
}

export function unregisterPromptInjectSource(ownerId) {
  return injectSources.delete(String(ownerId));
}

export function listPromptInjectSources() {
  return [...injectSources.keys()];
}

export function clearPromptInjectSources() {
  injectSources.clear();
  contributionSources.clear();
}

/**
 * 收集当前作用域生效的注入声明。
 *
 * @param {object} ctx — 传给 append/rewrite 的上下文（chatKey/kind/model/persona/config…）
 * @returns {{ rewrites: Array, appends: Array, errors: string[] }}
 */
export function collectPromptInjects(ctx = {}) {
  const rewrites = [];
  const appends = [];
  const errors = [];

  for (const [ownerId, src] of injectSources) {
    // 会话级启用判定交给调用方注入的 enabled 钩子
    if (src.enabled) {
      try {
        if (!src.enabled(ctx)) continue;
      } catch { continue; }
    }

    for (const rule of src.injects) {
      const kind = String(rule?.kind || '');
      try {
        if (kind === 'append') {
          if (!src.append) continue;
          // 先看返回值类型（异步/非字符串要能被识别出来），再做模板渲染
          const raw = src.append({ rule, ctx });
          if (typeof raw !== 'string') {
            if (raw && typeof raw.then === 'function') {
              errors.push(`${ownerId}/${rule.id}：append 返回了 Promise（必须同步）`);
            }
            continue;
          }
          const text = renderTemplate(raw, { ownerId, vars: ctx?.vars }).text;
          if (!text.trim()) continue;
          appends.push({
            at: rule.at,
            ownerId,
            injectId: rule.id,
            text,
            order: src.order,
            priority: Number(rule.priority) || 50
          });
        } else if (kind === 'rewrite') {
          if (!src.rewrite) continue;
          // 改写函数延后到 applyPromptInjects 里执行：它需要拿到原文
          rewrites.push({
            target: rule.target,
            ownerId,
            injectId: rule.id,
            order: src.order,
            priority: Number(rule.priority) || 50,
            fn: (original) => {
              const raw = src.rewrite({ rule, ctx, original });
              if (typeof raw !== 'string') {
                if (raw && typeof raw.then === 'function') {
                  errors.push(`${ownerId}/${rule.id}：rewrite 返回了 Promise（必须同步）`);
                }
                return original;
              }
              return renderTemplate(raw, { ownerId, vars: ctx?.vars }).text;
            }
          });
        }
      } catch (error) {
        errors.push(`${ownerId}/${rule?.id || '?'}：${error?.message ?? error}`);
      }
    }
  }

  // 同 target 只允许一个生效改写
  const winners = resolveRewriteConflicts(rewrites);
  const effectiveRewrites = rewrites.filter((r) => winners.get(r.target) === r.ownerId);

  // 只追加贡献源（知识库/工具目录）：与 promptinject 的 append 走同一条插入链路
  for (const [ownerId, src] of contributionSources) {
    try {
      const text = src.text(ctx);
      if (typeof text !== 'string' || !text.trim()) continue;
      appends.push({
        at: src.at,
        ownerId,
        injectId: 'contribution',
        text,
        order: src.order,
        priority: src.priority
      });
    } catch (error) {
      errors.push(`${ownerId}/contribution：${error?.message ?? error}`);
    }
  }

  return { rewrites: effectiveRewrites, appends, errors, conflicts: winners };
}
