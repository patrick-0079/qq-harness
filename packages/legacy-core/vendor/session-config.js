// 会话级配置：字段白名单、完整快照、清洗、差异与 API 校验（2026-10-23 改版）
//
// 背景（需求原话）：
//   · 每个会话的所有配置都是一个单独文件；改默认配置不能影响其它会话；
//   · 模型配置（含备选模型）下放到会话，但**渠道配置不下放**（baseUrl/Key/
//     提供商目录/价格表仍然是全局唯一一份）。
//
// 为什么单独一个纯函数模块：
//   · 存储层（profile-files.js）只负责文件，合并层（chat-profiles.js）只负责
//     缓存与生命周期。字段白名单/快照/差异这类"没有副作用"的规则放这里，
//     才能被 coverage-offline 直接覆盖，也避免三个文件各写一份白名单。
//
// 快照语义（重要）：
//   · 会话文件里存的是**完整配置**（所有可按会话自定义的顶层分区），不是"与
//     默认的差异"。这样用户改默认设置时，已经独立配置过的会话不会跟着漂移。
//   · 对外仍提供 diffSessionConfig()，用于 UI 显示"本会话哪些分区与当前默认
//     不同"，以及「恢复默认」按钮是否该出现 —— 它只是展示口径，不是存储口径。
//
// 全局专属字段：
//   · 即使历史文件/前端伪造里出现，合并结果也会被 enforceGlobalOnly() 强制
//     回落成全局值。渠道、凭据、安全、SnowLuma、界面、准入口径全部属于这一类。

export const SESSION_CONFIG_SCHEMA = 1;

/** 允许按会话独立保存的顶层分区（也是写入白名单）。 */
export const SESSION_CONFIG_TOP = Object.freeze([
  'persona', 'memory', 'store', 'tools', 'skills',
  'proactive', 'chatActive', 'availability', 'sticker', 'commandMute', 'blocklist',
  'run', 'api'
]);

/**
 * 会话级 `api` 只允许这些字段 —— 也就是"模型选择与请求参数"。
 * 渠道（baseUrl/apiKey）、提供商目录、价格表、官方价开关一律不在此列：
 * 它们属于全局唯一事实，复制进会话文件只会随渠道变更悄悄过期。
 */
export const SESSION_API_KEYS = Object.freeze([
  'model', 'provider', 'fallbackModels',
  'visionModel', 'videoModel', 'videoMode', 'vision', 'video',
  'temperature', 'maxRounds', 'timeoutMs',
  'thinkingMode', 'thinkingEffort', 'thinkingBudget'
]);

/** 永远回落到全局的路径（合并后的防御性兜底）。 */
export const GLOBAL_ONLY_PATHS = Object.freeze([
  ['snowluma'],
  ['api', 'baseUrl'],
  ['api', 'apiKey'],
  ['api', 'useOfficialPrice'],
  ['api', 'priceInputPerM'],
  ['api', 'priceOutputPerM'],
  ['api', 'priceCachedPerM'],
  ['api', 'modelPrices'],
  ['providers'],
  ['providersSourceYaml'],
  ['dshProviderKeys'],
  ['deny'],
  ['globalBlocklist'],
  ['communityExemptions'],
  ['security'],
  ['server'],
  ['ui'],
  ['extensions'],
  ['modelVision'],
  ['acceptAllSessions'],
  ['chatProfiles'],
  ['dispatch'],
  ['maxConcurrentRuns'],
  ['send'],
  ['wakeDelayMs'],
  ['drainDelayMs'],
  ['sessionRetryAttempts'],
  ['persona', 'botName'],
  ['persona', 'selfNickname'],
  ['store', 'keepSessionFiles'],
  ['store', 'maxMessagesPerChat'],
  ['commandMute', 'active']
]);

/** 任何层级都不进会话配置的凭据字段名（比全局脱敏更严格：会话文件会被单独备份/手改）。 */
const SECRET_KEY_RE = /^(apiKey|accessToken|httpAccessToken|cookie|password|secret|token|botToken)$/i;

import { normalizeReply, replyFromLegacy, normalizeKeywordRules, peakReplyFor, replyFromTier } from './trigger.js';
import { sliderToTier } from './tier-slider.js';

const isPlainObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function deepClone(v) {
  if (v === undefined) return v;
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}

export function getPath(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setPath(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i];
    if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  const last = path[path.length - 1];
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

/**
 * 递归剥掉凭据与派生标记。
 * hasXxx / dshProviderKeyPresence 是 GET /api/config 的脱敏产物，回传后若被
 * deepMerge 写进会话文件，会变成"Key 已删除但 hasKey 仍为 true"的脏数据。
 */
export function stripSessionSecrets(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) {
    for (const item of node) stripSessionSecrets(item);
    return node;
  }
  for (const key of Object.keys(node)) {
    if (SECRET_KEY_RE.test(key) || /^has[A-Z][A-Za-z0-9]*$/.test(key) || key === 'dshProviderKeyPresence') {
      delete node[key];
      continue;
    }
    stripSessionSecrets(node[key]);
  }
  return node;
}

/** 只挑出会话级 api 字段。 */
export function pickSessionApi(api) {
  if (!isPlainObj(api)) return undefined;
  const out = {};
  for (const key of SESSION_API_KEYS) {
    if (api[key] !== undefined) out[key] = deepClone(api[key]);
  }
  return out;
}

/** 会话配置里永远不允许出现的子路径（渠道/身份/全局运行参数）。 */
const PROTECTED_SUBPATHS = [
  ['persona', 'botName'],
  ['persona', 'selfNickname'],
  // 人设正文只存在人设库里，按 personaId 实时解析；会话文件再存一份副本只会漂移。
  ['persona', 'roleText'],
  ['persona', 'systemPromptOverride'],
  ['store', 'keepSessionFiles'],
  ['store', 'maxMessagesPerChat'],
  ['commandMute', 'active']
];

function deleteProtected(out) {
  for (const path of PROTECTED_SUBPATHS) {
    const parent = getPath(out, path.slice(0, -1));
    if (!isPlainObj(parent)) continue;
    delete parent[path[path.length - 1]];
  }
}

/**
 * 清洗一份"可能是任意形状"的会话配置 / patch：
 *   · 只保留 SESSION_CONFIG_TOP 顶层；
 *   · api 只保留 SESSION_API_KEYS；
 *   · 删掉全局专属子路径、凭据与派生标记。
 *
 * 注意：这里**不**做默认值补全，也不做 reply 规范化 —— 那些属于
 * normalizeSessionConfig()，写入路径必须再调一次。
 */
export function sanitizeSessionConfig(input) {
  if (!isPlainObj(input)) return {};
  const out = {};
  for (const top of SESSION_CONFIG_TOP) {
    if (input[top] === undefined) continue;
    out[top] = deepClone(input[top]);
  }
  if (out.api !== undefined) {
    const api = pickSessionApi(out.api);
    if (api && Object.keys(api).length) out.api = api;
    else delete out.api;
  }
  deleteProtected(out);
  return stripSessionSecrets(out);
}

/**
 * 建一份会话完整快照：从全局默认值里取所有可按会话自定义的分区。
 * 创建会话 / 迁移旧 chatProfiles / 「恢复默认」都走它，保证新文件总是完整的。
 */
export function snapshotSessionConfig(globalCfg) {
  const global = isPlainObj(globalCfg) ? globalCfg : {};
  const out = {};
  for (const top of SESSION_CONFIG_TOP) {
    if (global[top] === undefined) continue;
    out[top] = deepClone(global[top]);
  }
  if (global.api !== undefined) {
    const api = pickSessionApi(global.api);
    if (api && Object.keys(api).length) out.api = api;
    else delete out.api;
  }
  deleteProtected(out);
  return stripSessionSecrets(out);
}

const clampNum = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const MODEL_MAX = 200;

/** 规范化会话 api 分区（范围钳制 + 备选模型清洗）。 */
export function normalizeSessionApi(api) {
  if (!isPlainObj(api)) return undefined;
  const out = pickSessionApi(api) || {};
  out.model = String(out.model ?? '').trim().slice(0, MODEL_MAX);
  out.provider = String(out.provider ?? '').trim().slice(0, 120);
  out.visionModel = String(out.visionModel ?? '').trim().slice(0, MODEL_MAX);
  out.videoModel = String(out.videoModel ?? '').trim().slice(0, MODEL_MAX);
  out.videoMode = ['auto', 'native', 'frames', 'off'].includes(out.videoMode) ? out.videoMode : 'auto';
  out.vision = out.vision !== false;
  out.video = out.video === true;
  out.temperature = clampNum(out.temperature, 0, 2, 0.8);
  out.maxRounds = Math.round(clampNum(out.maxRounds, 1, 40, 12));
  out.timeoutMs = Math.round(clampNum(out.timeoutMs, 5000, 3600000, 180000));
  out.thinkingMode = ['auto', 'on', 'off'].includes(out.thinkingMode) ? out.thinkingMode : 'auto';
  out.thinkingEffort = ['', 'off', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(out.thinkingEffort ?? ''))
    ? String(out.thinkingEffort ?? '')
    : '';
  out.thinkingBudget = Math.round(clampNum(out.thinkingBudget, 0, 200000, 0));
  // 备选模型：允许跨提供商（每项可带 provider），但必须 cfg 形状合法、去空、限量。
  const list = [];
  for (const raw of Array.isArray(out.fallbackModels) ? out.fallbackModels : []) {
    const model = String(raw?.model ?? '').trim().slice(0, MODEL_MAX);
    if (!model) continue;
    const provider = String(raw?.provider ?? '').trim().slice(0, 120);
    list.push(provider ? { model, provider } : { model });
    if (list.length >= 10) break;
  }
  out.fallbackModels = list;
  return out;
}

/**
 * 规范化整份会话配置：
 *   · 清洗白名单；
 *   · api 范围钳制；
 *   · store.reply/keywordRules/peak 与全局同口径（四类概率 + 旧字段镜像）。
 */
export function normalizeSessionConfig(config, { storePatch = null } = {}) {
  const out = sanitizeSessionConfig(config);
  if (out.api !== undefined) out.api = normalizeSessionApi(out.api);
  if (isPlainObj(out.store)) normalizeStoreInPlace(out.store, isPlainObj(storePatch) ? storePatch : null);
  return out;
}

function normalizeStoreInPlace(store, patchStore = null) {
  // 与 config.js 的 deriveReplyConfigInPlace 同口径，但只作用于这一份文件，
  // 不碰全局配置（会话文件是独立真相）。
  //
  // ⚠️ patchStore 是"这次请求真正改了什么"：旧前端仍可能写 contextSliderPos /
  // contextTier / trigger / keywords 这些**已派生的旧字段**。如果只按合并后的
  // store.reply 归一化，补丁里的滑条会被旧 reply 覆盖（历史上表现为"拖了滑条但
  // 保存后回到原档位"）。因此有 patch 时优先按 patch 的旧字段重新推导 reply。
  const has = (k) => Boolean(patchStore) && Object.prototype.hasOwnProperty.call(patchStore, k);
  if (has('reply')) {
    store.reply = normalizeReply(store.reply);
  } else if (has('contextSliderPos')) {
    const { tier, randomPercent } = sliderToTier(Number(store.contextSliderPos));
    store.reply = replyFromTier(tier, randomPercent);
  } else if (has('trigger') || has('replyProbability')) {
    const derived = replyFromLegacy({ trigger: store.trigger, replyProbability: store.replyProbability });
    if (derived) store.reply = derived;
  } else if (has('contextTier') || has('randomPercent')) {
    store.reply = replyFromTier(store.contextTier, store.randomPercent);
  } else if (isPlainObj(store.reply)) {
    store.reply = normalizeReply(store.reply);
  } else {
    const legacy = replyFromLegacy(store);
    if (legacy) store.reply = legacy;
  }

  if (Array.isArray(store.keywordRules) && (!patchStore || has('keywordRules') || !has('keywords'))) {
    store.keywordRules = normalizeKeywordRules(store.keywordRules);
  } else if (Array.isArray(store.keywords) && store.keywords.length) {
    // 与 config.js 同口径：空的关键词表不生成空 keywordRules —— 否则会话快照会
    // 凭空多出一个 `[]`，与全局默认（没有该键）产生永久 diff，"恢复默认"后
    // 角标也消不掉。
    store.keywordRules = normalizeKeywordRules(store.keywords);
  }
  const peak = store.peakSchedule?.peak;
  if (isPlainObj(peak)) {
    const patchPeak = isPlainObj(patchStore?.peakSchedule?.peak) ? patchStore.peakSchedule.peak : null;
    const patchTouchesPeakLegacy = Boolean(patchPeak)
      && ('trigger' in patchPeak || 'sliderPos' in patchPeak || 'probability' in patchPeak);
    if (isPlainObj(peak.reply) && (!patchTouchesPeakLegacy || isPlainObj(patchPeak?.reply))) {
      peak.reply = normalizeReply(peak.reply);
    } else {
      const derived = peakReplyFor(peak);
      if (derived) peak.reply = derived;
    }
  }
  // 旧字段镜像（2026-10-23 修正）：这里**不再**主动补 contextSliderPos/trigger
  // 等派生字段。会话文件存的是 source-of-truth（reply/keywordRules），运行时
  // storeConfigForChat() 会按 reply 现算旧字段；主动补镜像会让"只改了人设"的
  // 会话也凭空多出 store 差异（恢复默认后角标消不掉），也会覆盖前端这次提交的
  // 滑条值（100 → 规范位置 95）。
}

/** 与当前全局默认不同的子树（仅展示用途；空对象 = 与默认一致）。 */
export function diffSessionConfig(config, globalCfg) {
  const diff = diffNode(isPlainObj(config) ? config : {}, isPlainObj(globalCfg) ? globalCfg : {});
  return diff === undefined ? {} : diff;
}

function diffNode(node, def) {
  if (!isPlainObj(node)) {
    return jsonEq(node, def) ? undefined : deepClone(node);
  }
  const out = {};
  let any = false;
  for (const [key, value] of Object.entries(node)) {
    const dv = isPlainObj(def) ? def[key] : undefined;
    if (isPlainObj(value) && isPlainObj(dv)) {
      const sub = diffNode(value, dv);
      if (sub === undefined) continue;
      out[key] = sub; any = true; continue;
    }
    if (jsonEq(value, dv)) continue;
    out[key] = deepClone(value); any = true;
  }
  return any ? out : undefined;
}

/** 把合并结果里的全局专属字段强制回落到全局值。 */
export function enforceGlobalOnly(merged, globalCfg) {
  const global = isPlainObj(globalCfg) ? globalCfg : {};
  for (const path of GLOBAL_ONLY_PATHS) {
    const gv = getPath(global, path);
    setPath(merged, path, gv === undefined ? undefined : deepClone(gv));
  }
  return stripSessionSecrets(merged);
}

/**
 * 写入路径的 API 校验：provider 必须真实存在于全局提供商目录。
 * @returns {string[]} 问题列表（空 = 合法）
 */
export function validateSessionApi(config, globalCfg) {
  const problems = [];
  const api = isPlainObj(config?.api) ? config.api : null;
  if (!api) return problems;
  const providers = Array.isArray(globalCfg?.providers) ? globalCfg.providers : [];
  const has = (pid) => providers.some((p) => String(p?.id ?? '') === pid);
  if (api.provider && !has(String(api.provider))) problems.push(`提供商不存在：${api.provider}`);
  for (const fb of Array.isArray(api.fallbackModels) ? api.fallbackModels : []) {
    const pid = String(fb?.provider ?? '');
    if (pid && !has(pid)) problems.push(`备选模型的提供商不存在：${pid}`);
  }
  return problems;
}

/**
 * 运行时修正：会话引用的 provider 被删除/改名后，不要让整轮运行 401。
 * 返回 true = 做过回落（调用方负责打日志，避免每个消息刷一条）。
 */
export function fixSessionApiAgainstGlobal(merged, globalCfg) {
  if (!isPlainObj(merged?.api)) return false;
  const globalApi = isPlainObj(globalCfg?.api) ? globalCfg.api : {};
  const providers = Array.isArray(globalCfg?.providers) ? globalCfg.providers : [];
  let fixed = false;
  const pid = String(merged.api.provider ?? '').trim();
  if (pid && !providers.some((p) => String(p?.id ?? '') === pid)) {
    merged.api.provider = String(globalApi.provider ?? '');
    merged.api.model = String(globalApi.model ?? '');
    merged.api.visionModel = String(globalApi.visionModel ?? '');
    merged.api.videoModel = String(globalApi.videoModel ?? '');
    fixed = true;
  }
  if (!String(merged.api.model ?? '').trim()) {
    const gm = String(globalApi.model ?? '');
    if (gm) {
      merged.api.model = gm;
      if (!merged.api.provider) merged.api.provider = String(globalApi.provider ?? '');
      fixed = true;
    }
  }
  // 备选模型里指向已删除提供商的项：保留会每次请求都白试一次，直接剔除。
  if (Array.isArray(merged.api.fallbackModels)) {
    const kept = merged.api.fallbackModels.filter((fb) => {
      const p = String(fb?.provider ?? '');
      return !p || providers.some((x) => String(x?.id ?? '') === p);
    });
    if (kept.length !== merged.api.fallbackModels.length) {
      merged.api.fallbackModels = kept;
      fixed = true;
    }
  }
  return fixed;
}
