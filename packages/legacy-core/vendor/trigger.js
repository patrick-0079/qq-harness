// 触发条件与回复概率（2026-10-22 活跃设置改版 · 四类概率配置）。
//
// 旧模型（2026-10-21）只有一条全局概率：@/关键词/其余共享同一个旋钮，
// 命中条件后按同一条概率决定是否回复。新模型把"渠道"和"概率"拆开：
//
//   · private  私聊：1v1 没有触发条件，每条私聊消息都是一次候选，只有概率
//   · mention  @ 与拍一拍
//   · keyword  命中关键词；每条规则可以有自己的概率（null = 继承渠道默认）
//   · other    其余消息（既没 @/拍一拍、也没命中关键词）
//
// 语义：渠道命中 = 本轮有机会开始；概率决定是否真的开始。概率未中时
// 本轮什么都不做——不建会话、不调模型，消息保持未读（见 orchestrator）。
//
// 兼容：配置里没有 reply 时，从旧字段（trigger/replyProbability/contextTier/
// contextSliderPos/randomPercent/keywords）推导；只在内存里补全，不写盘。
//
// 本模块零本地依赖（只 import tier-slider），避免 config ↔ prompt 循环依赖。

import { sliderToTier, tierToSlider } from './tier-slider.js';

export const RULE_LIMITS = Object.freeze({
  maxRules: 50,
  maxPattern: 200,
  maxMatchText: 2000
});

export const DEFAULT_REPLY = Object.freeze({
  private: Object.freeze({ probability: 100 }),
  mention: Object.freeze({ enabled: true, probability: 100 }),
  keyword: Object.freeze({ enabled: true, probability: 100 }),
  other: Object.freeze({ enabled: true, probability: 100 })
});

/** 旧"三开关"默认值：保留导出给仍读它的旧代码/测试。 */
export const DEFAULT_TRIGGER = Object.freeze({ mention: true, keyword: false, all: false });

// ── 概率：0~100，保留两位小数（0.01% 精度）──────────────────────────────
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * 钳位到 [0,100] 并保留两位小数。
 * ⚠️ 这里**不能**取整：0.01% 与 24.1% 都是合法值（旧实现的 Math.round
 *    会把 24.1 变成 24、把 0.01 变成 0，属于本轮改版要修掉的问题）。
 */
export const clampProb = (v, fallback = 100) => {
  const raw = (v === null || v === undefined || v === '') ? fallback : v;
  const n = Number(raw);
  const base = Number.isFinite(n) ? n : Number(fallback);
  const safe = Number.isFinite(base) ? base : 100;
  return round2(Math.min(100, Math.max(0, safe)));
};

// ── 触发条件（旧模型，保留给旧适配与测试）────────────────────────────────
/** 规范化触发条件：all 独占；keyword 蕴含 mention；全关回落 mention。 */
export function normalizeTrigger(input) {
  const t = (input && typeof input === 'object') ? input : {};
  const mention = t.mention === true;
  const keyword = t.keyword === true;
  const all = t.all === true;
  if (all) return { mention: false, keyword: false, all: true };
  if (!mention && !keyword) return { mention: true, keyword: false, all: false };
  return { mention: true, keyword, all: false };
}

/** 旧档位 → 新条件（tier 3 的“随机”改由概率表达）。 */
export function triggerFromTier(tier, _randomPercent = 0) {
  const t = Number(tier);
  if (!Number.isFinite(t) || t >= 4) return { mention: false, keyword: false, all: true };
  if (t <= 1) return { mention: true, keyword: false, all: false };
  return { mention: true, keyword: true, all: false };
}

/** 旧档位对应的默认概率：1/2/4 档恒 100；3 档用旧 randomPercent。 */
export function probabilityFromTier(tier, randomPercent = 0) {
  const t = Number(tier);
  if (t === 3) return clampProb(randomPercent);
  return 100;
}

/** 旧条件 + 概率 → 旧派生字段（contextTier/randomPercent/contextSliderPos）。 */
export function legacyFromTrigger(triggerInput, probability = 100) {
  const trigger = normalizeTrigger(triggerInput);
  const prob = clampProb(probability);
  const tier = trigger.all ? 4 : (trigger.keyword ? 2 : 1);
  return {
    contextTier: tier,
    randomPercent: prob,
    contextSliderPos: tierToSlider(tier, prob)
  };
}

// ── 新模型：四类配置 ─────────────────────────────────────────────────────
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const channelEnabled = (v, fallback) => {
  if (!isObj(v)) return fallback;
  return v.enabled !== false;
};

const channelProb = (v, fallback = 100) => {
  if (!isObj(v)) return clampProb(fallback);
  return clampProb(v.probability ?? fallback);
};

/** 规范化四类概率配置；缺省值 = 全开 100%（与旧 tier 4 默认一致）。 */
export function normalizeReply(input) {
  const r = isObj(input) ? input : {};
  return {
    private: { probability: channelProb(r.private, 100) },
    mention: { enabled: channelEnabled(r.mention, true), probability: channelProb(r.mention, 100) },
    keyword: { enabled: channelEnabled(r.keyword, true), probability: channelProb(r.keyword, 100) },
    other: { enabled: channelEnabled(r.other, true), probability: channelProb(r.other, 100) }
  };
}

/** 旧 trigger + 单一概率 → 四类配置（三个群聊渠道共用同一概率）。 */
export function replyFromTrigger(triggerInput, probability = 100) {
  const t = normalizeTrigger(triggerInput);
  const p = clampProb(probability);
  return {
    private: { probability: 100 },
    mention: { enabled: t.mention, probability: p },
    keyword: { enabled: t.keyword, probability: p },
    other: { enabled: t.all, probability: p }
  };
}

/**
 * 旧档位 → 四类配置。
 * tier 3 完整保留旧行为：@ / 关键词必回，其余消息按 randomPercent。
 */
export function replyFromTier(tier, randomPercent = 0) {
  const t = Number(tier);
  const on = () => ({ enabled: true, probability: 100 });
  const off = () => ({ enabled: false, probability: 100 });
  const base = { private: { probability: 100 } };
  if (!Number.isFinite(t) || t >= 4) {
    return { ...base, mention: on(), keyword: on(), other: { enabled: true, probability: 100 } };
  }
  if (t <= 1) return { ...base, mention: on(), keyword: off(), other: off() };
  if (t <= 2) return { ...base, mention: on(), keyword: on(), other: off() };
  return { ...base, mention: on(), keyword: on(), other: { enabled: true, probability: clampProb(randomPercent) } };
}

/**
 * 读一个 store 的旧字段并推导四类配置。
 * @returns {object|null} null = 这个 store 里没有任何触发相关字段（应继承上层）
 */
export function replyFromLegacy(store = {}) {
  if (!isObj(store)) return null;
  if (isObj(store.trigger)) return replyFromTrigger(store.trigger, store.replyProbability ?? 100);
  // 历史行为：滑条位置存在时以位置为唯一真相（旧 updateConfig 的 else 分支就是这么写的，
  // 保存时也会把 contextTier/randomPercent 从位置重新派生）。两者不一致时以位置为准。
  if (Number.isFinite(Number(store.contextSliderPos))) {
    const { tier, randomPercent } = sliderToTier(Number(store.contextSliderPos));
    return replyFromTier(tier, randomPercent);
  }
  if (Number.isFinite(Number(store.contextTier))) {
    const tier = Math.min(4, Math.max(1, Math.round(Number(store.contextTier))));
    const rp = store.randomPercent !== undefined && store.randomPercent !== null ? store.randomPercent : 10;
    return replyFromTier(tier, rp);
  }
  return null;
}

/** 四类配置 → 旧派生字段（供仍读 contextTier/randomPercent/trigger 的旧代码）。 */
export function legacyFromReply(input) {
  const r = normalizeReply(input);
  // 旧档位语义：3 档 = "其余消息按 randomPercent 随机"，4 档 = 其余消息 100%。
  // 因此"其余消息开着"不能一律映射成 4 档，否则 3 档会被写成 4 档。
  const tier = r.other.enabled
    ? (r.other.probability >= 100 ? 4 : 3)
    : (r.keyword.enabled ? 2 : 1);
  return {
    trigger: { mention: r.mention.enabled, keyword: r.keyword.enabled, all: r.other.enabled },
    replyProbability: r.mention.probability,
    contextTier: tier,
    randomPercent: r.other.probability,
    contextSliderPos: tierToSlider(tier, r.other.probability)
  };
}

// ── 关键词规则 ───────────────────────────────────────────────────────────
let ruleSeq = 0;
const newRuleId = () => `k_${Date.now().toString(36)}${(ruleSeq++).toString(36)}`;
const cleanId = (v) => {
  const s = String(v ?? '').trim();
  return /^[A-Za-z0-9_-]{1,32}$/.test(s) ? s : '';
};

/** 编译结果缓存：同一条规则每批只编译一次。key 必须带上 flags（同一 pattern 可有不同标志位）。 */
const regexCache = new Map();
function regexFor(pattern, flags = 'i') {
  const key = `${String(pattern ?? '')}\u0000${String(flags ?? '')}`;
  if (regexCache.has(key)) return regexCache.get(key);
  let re = null;
  try { re = new RegExp(String(pattern ?? ''), String(flags ?? '')); } catch { re = null; }
  if (regexCache.size > 200) regexCache.clear();
  regexCache.set(key, re);
  return re;
}

/** 正则标志位合法字符（按固定顺序规范化；g/y 有 lastIndex 状态，测试前会复位）。 */
const RULE_FLAGS_ORDER = 'dgimsuvy';
const RULE_FLAGS_RE = new RegExp(`^[${RULE_FLAGS_ORDER}]*$`);

/**
 * 规范化用户填写的正则标志位（2026-10-23 需求：标志位由用户填写）。
 *
 * 规则：
 *   · 普通模式恒为 ''（ignored）；
 *   · 正则模式未填 = 'i'（保持 2026-10-22 之前"不区分大小写包含"的既有语义）；
 *   · 只接受 JS 合法字符 d/g/i/m/s/u/v/y，重复字符去重，顺序固定（便于比较/展示）；
 *   · `u` 与 `v` 互斥 —— 交给 new RegExp 校验并给出可读错误。
 */
function normalizeFlags(raw, { mode, strict, index }) {
  if (mode !== 'regex') return '';
  const text = raw === undefined || raw === null ? 'i' : String(raw).trim();
  const flags = text === '' ? '' : [...new Set(text)].join('');
  if (!RULE_FLAGS_RE.test(flags)) {
    if (strict) throw ruleError(index, `正则标志位不合法（只允许 ${RULE_FLAGS_ORDER} 中的字符）：${text}`);
    return null;
  }
  return [...flags].sort((a, b) => RULE_FLAGS_ORDER.indexOf(a) - RULE_FLAGS_ORDER.indexOf(b)).join('');
}


/** 明显可能导致灾难性回溯的写法（启发式，不追求完备）。 */
function looksDangerous(pattern) {
  const p = String(pattern ?? '');
  return [
    /\((?:[^()]*[+*][^()]*)\)[+*{]/,
    /\((?:[^()]*\|[^()]*)\)[+*{]/,
    /(?:\.\*){2,}/,
    /(?:\.\+){2,}/
  ].some((re) => re.test(p));
}

const ruleError = (index, msg) => new Error(`关键词规则第 ${index + 1} 条：${msg}`);

/**
 * 规范化关键词规则。
 * @param {Array<string|object>} input 旧字符串数组或新对象数组
 * @param {{strict?:boolean}} opts strict=true 时非法规则抛错（保存路径用）；
 *        strict=false 时跳过非法规则（加载/运行路径用，绝不抛）
 * @returns {Array<{id:string,pattern:string,mode:'plain'|'regex',probability:number|null,enabled:boolean}>}
 */
export function normalizeKeywordRules(input, { strict = false } = {}) {
  const list = Array.isArray(input) ? input : [];
  if (strict && list.length > RULE_LIMITS.maxRules) {
    throw new Error(`关键词规则最多 ${RULE_LIMITS.maxRules} 条（当前 ${list.length} 条）`);
  }
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    const obj = typeof raw === 'string'
      ? { pattern: raw, mode: 'plain', probability: null, enabled: true }
      : (isObj(raw) ? raw : null);
    if (!obj) {
      if (strict) throw ruleError(i, '不是有效的规则对象');
      continue;
    }
    const pattern = String(obj.pattern ?? '').trim();
    if (!pattern) {
      if (strict) throw ruleError(i, '规则不能为空');
      continue;
    }
    if (pattern.length > RULE_LIMITS.maxPattern) {
      if (strict) throw ruleError(i, `规则超过 ${RULE_LIMITS.maxPattern} 字`);
      continue;
    }
    const mode = obj.mode === 'regex' ? 'regex' : 'plain';
    const flags = normalizeFlags(obj.flags, { mode, strict, index: i });
    if (flags === null) continue;   // strict 已在 normalizeFlags 里抛错；非严格模式跳过坏规则
    let probability = null;
    if (obj.probability !== null && obj.probability !== undefined && obj.probability !== '') {
      const n = Number(obj.probability);
      if (!Number.isFinite(n)) {
        if (strict) throw ruleError(i, '概率必须是 0~100 的数字');
      } else {
        probability = clampProb(n);
      }
    }
    if (mode === 'regex') {
      let compiled = null;
      try { compiled = new RegExp(pattern, flags); } catch { compiled = null; }
      if (!compiled) {
        if (strict) throw ruleError(i, `正则表达式不合法（标志位 ${flags || '无'}）`);
        continue;
      }
      if (looksDangerous(pattern)) {
        if (strict) throw ruleError(i, '正则包含可能导致灾难性回溯的嵌套量词，请简化');
        continue;
      }
    }
    const key = `${mode}:${flags}:${mode === 'plain' ? pattern.toLowerCase() : pattern}`;
    if (seen.has(key)) {
      if (strict) throw ruleError(i, '与前面的规则重复');
      continue;
    }
    seen.add(key);
    out.push({
      id: cleanId(obj.id) || newRuleId(),
      pattern,
      mode,
      flags,
      probability,
      enabled: obj.enabled !== false
    });
    if (out.length >= RULE_LIMITS.maxRules) break;
  }
  return out;
}

/** 这个 store 当前使用的规则（新字段优先；否则把旧 keywords 字符串转成普通规则）。 */
export function keywordRulesFor(store = {}) {
  const s = isObj(store) ? store : {};
  if (Array.isArray(s.keywordRules)) return normalizeKeywordRules(s.keywordRules);
  if (Array.isArray(s.keywords)) return normalizeKeywordRules(s.keywords);
  return [];
}

/**
 * 在文本里找命中的关键词规则。
 * 多条命中取生效概率最高的一条（同分取列表靠前）；概率 100 直接短路。
 * @returns {{rule:object, probability:number, mode:'plain'|'regex'}|null}
 */
export function matchKeywordRules(text, rules, defaultProbability = 100) {
  const hay = String(text ?? '').slice(0, RULE_LIMITS.maxMatchText);
  if (!hay) return null;
  const lower = hay.toLowerCase();
  const fallback = clampProb(defaultProbability);
  let best = null;
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || rule.enabled === false) continue;
    const mode = rule.mode === 'regex' ? 'regex' : 'plain';
    let hit = false;
    if (mode === 'regex') {
      const re = regexFor(rule.pattern, rule.flags ?? 'i');
      // g/y 标志会让 test() 推进 lastIndex：同一批消息里重复测试时必须复位，
      // 否则第二条消息开始就"永远不命中"（2026-10-23 支持自定义标志位后暴露）。
      if (re) re.lastIndex = 0;
      hit = Boolean(re) && re.test(hay);
    } else {
      hit = lower.includes(String(rule.pattern ?? '').toLowerCase());
    }
    if (!hit) continue;
    const probability = (rule.probability === null || rule.probability === undefined)
      ? fallback
      : clampProb(rule.probability);
    if (!best || probability > best.probability) best = { rule, probability, mode };
    if (probability >= 100) break;
  }
  return best;
}

// ── 生效策略（峰谷 / 基础）──────────────────────────────────────────────
/** 从某 store 取基础策略；没有新字段时按旧字段推导。 */
export function replyPolicyForStore(store = {}) {
  const hasReply = isObj(store) && isObj(store.reply);
  const reply = hasReply
    ? normalizeReply(store.reply)
    : (replyFromLegacy(store) || normalizeReply(DEFAULT_REPLY));
  return { reply, rules: keywordRulesFor(store), legacy: !hasReply };
}

/** 高峰侧的四类配置；没有新字段时按 peak.trigger / peak.sliderPos 推导。 */
export function peakReplyFor(peak) {
  if (!isObj(peak)) return null;
  if (isObj(peak.reply)) return normalizeReply(peak.reply);
  if (isObj(peak.trigger)) return replyFromTrigger(peak.trigger, peak.probability ?? 100);
  if (Number.isFinite(Number(peak.sliderPos))) {
    const { tier, randomPercent } = sliderToTier(Number(peak.sliderPos));
    return replyFromTier(tier, randomPercent);
  }
  return null;
}

/**
 * 当前生效的回复策略。
 * 峰谷只覆盖群聊三渠道；**私聊概率不受峰谷影响**（私聊只有一个概率设置）。
 * @returns {{reply:object, rules:Array, peak:boolean, legacy:boolean}}
 */
export function effectiveReplyPolicy(store = {}, at = new Date()) {
  const base = replyPolicyForStore(store);
  const ps = store?.peakSchedule;
  if (isPeakWindow(ps, at)) {
    const peakReply = peakReplyFor(ps.peak);
    if (peakReply) {
      return {
        reply: { ...peakReply, private: base.reply.private },
        rules: base.rules,
        peak: true,
        legacy: base.legacy || !isObj(ps.peak?.reply)
      };
    }
  }
  return { ...base, peak: false };
}

/** 旧接口适配：仍返回 {trigger, probability, peak, legacy}。 */
export function effectiveTrigger(store = {}, at = new Date()) {
  const policy = effectiveReplyPolicy(store, at);
  const r = policy.reply;
  const probability = r.other.enabled
    ? r.other.probability
    : (r.keyword.enabled ? r.keyword.probability : r.mention.probability);
  return {
    trigger: { mention: r.mention.enabled, keyword: r.keyword.enabled, all: r.other.enabled },
    probability,
    peak: policy.peak,
    legacy: policy.legacy
  };
}

/** 读一个 store 的触发配置（旧接口，保留给测试/插件）。 */
export function triggerForStore(store = {}) {
  const policy = replyPolicyForStore(store);
  const r = policy.reply;
  return {
    trigger: { mention: r.mention.enabled, keyword: r.keyword.enabled, all: r.other.enabled },
    probability: r.other.enabled ? r.other.probability : (r.keyword.enabled ? r.keyword.probability : r.mention.probability),
    legacy: policy.legacy
  };
}

/** 1=周一 … 7=周日（ISO 口径）。 */
export function isoWeekday(date = new Date()) {
  const d = date.getDay();          // 0=周日
  return d === 0 ? 7 : d;
}

function normalizeWeekdays(list) {
  if (!Array.isArray(list)) return [];
  const out = [...new Set(list.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))];
  return out.sort((a, b) => a - b);
}

function parseHHMM(raw) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 当前时间是否落在高峰窗口（星期 + 时间；跨零点归属开始日）。 */
export function isPeakWindow(ps, at = new Date()) {
  if (!ps || ps.enabled !== true) return false;
  const start = parseHHMM(ps?.peak?.start);
  const end = parseHHMM(ps?.peak?.end);
  if (start === null || end === null || start === end) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  const days = normalizeWeekdays(ps.weekdays);
  if (!days.length) return start < end ? (minutes >= start && minutes < end) : (minutes >= start || minutes < end);
  if (start < end) {
    if (minutes < start || minutes >= end) return false;
    return days.includes(isoWeekday(at));
  }
  // 跨零点：00:00~end 这一段属于“前一天”的窗口
  if (minutes < end) {
    const prev = new Date(at.getTime() - 24 * 3600 * 1000);
    return days.includes(isoWeekday(prev));
  }
  return minutes >= start && days.includes(isoWeekday(at));
}

/** 当前生效位置的旧滑条值（保留给仍读 sliderPos 的旧代码/测试）。 */
export function resolvePeakSliderPos(store = {}, at = new Date()) {
  const ps = store?.peakSchedule;
  if (!ps || ps.enabled !== true) return null;
  if (!isPeakWindow(ps, at)) return clampSlider(ps.valley?.sliderPos);
  const peak = ps.peak;
  if (isObj(peak?.reply)) return legacyFromReply(peak.reply).contextSliderPos;
  if (isObj(peak?.trigger)) return legacyFromTrigger(peak.trigger, peak.probability).contextSliderPos;
  return clampSlider(peak?.sliderPos);
}

function clampSlider(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
}
