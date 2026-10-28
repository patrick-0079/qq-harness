// 静默处置策略：**纯函数**，故意与 orchestrator 解耦。
//
// 为什么单独一个文件：
//   · 这条规则（"没发言就必须给理由"）是整个收尾判定的核心，散在 2000 行的
//     orchestrator 里既不好读，也没法单测（私有方法 + 需要整套 mock 环境）。
//   · 插件可以用 `reply.silence-policy` 改写默认模式，而"插件返回什么算合法"
//     需要严格的钳制（布尔/次数/文案长度/兜底语义），这些判定是纯逻辑。
//
// 语义（与 doc/extend_development/plugin-development.md §4.5 一致）：
//   requireDisposition=false → 完全不强制（旧行为）
//   maxNudges=0              → 不追问，只记理由
//   requireSpeak=true        → 必须发言，不接受"给理由了事"
//   fallback='off'           → 追问失败后不合成理由
const MODES = ['enforce', 'record', 'off'];
const CAUSES = ['no-output', 'max-rounds', 'nudge-failed'];

/**
 * 配置 → 默认策略。
 * @param {'enforce'|'record'|'off'} mode  cfg.run.disposition
 * @param {{ maxNudges?: number }} [opts]  cfg.run.maxNudges（默认 3；record 模式强制 0）
 */
export function defaultSilencePolicy(mode = 'enforce', { maxNudges = 3 } = {}) {
  const m = MODES.includes(mode) ? mode : 'enforce';
  const nudgeCap = Math.max(0, Math.min(3, Math.floor(Number(maxNudges) || 0)));
  return {
    requireDisposition: m !== 'off',
    maxNudges: m === 'record' ? 0 : nudgeCap,
    // 主动机会（冷场开话题）：默认不追问 —— 没找到话题就安静结束是常态，
    // 每次追问都是约 17k token 的一整轮调用。
    proactiveMaxNudges: 0,
    requireSpeak: false,
    nudgeText: '',
    fallback: m === 'off' ? 'off' : 'synthesize',
    source: 'core'
  };
}

/**
 * 把插件返回值规整成合法策略（不合法字段一律忽略，回落默认值）。
 * @param {object|null|undefined} raw  插件 provider 的返回值
 * @param {{ mode?: string, source?: string, maxNudges?: number }} opts
 */
export function normalizeSilencePolicy(raw, { mode = 'enforce', source = 'core', maxNudges } = {}) {
  const out = defaultSilencePolicy(mode, { maxNudges });
  if (source && source !== 'core') out.source = String(source);
  if (!raw || typeof raw !== 'object') return out;

  if (typeof raw.requireDisposition === 'boolean') out.requireDisposition = raw.requireDisposition;
  if (Number.isFinite(Number(raw.maxNudges))) {
    out.maxNudges = Math.max(0, Math.min(3, Math.floor(Number(raw.maxNudges))));
  }
  if (Number.isFinite(Number(raw.proactiveMaxNudges))) {
    out.proactiveMaxNudges = Math.max(0, Math.min(3, Math.floor(Number(raw.proactiveMaxNudges))));
  }
  if (typeof raw.requireSpeak === 'boolean') out.requireSpeak = raw.requireSpeak;
  if (typeof raw.nudgeText === 'string' && raw.nudgeText.trim()) {
    out.nudgeText = raw.nudgeText.trim().slice(0, 1200);
  }
  if (raw.fallback === 'off' || raw.fallback === 'synthesize') out.fallback = raw.fallback;
  return out;
}

/** 按本次运行类型取实际使用的追问次数上限。 */
export function nudgesFor(policy, proactive) {
  const n = Number(proactive ? policy?.proactiveMaxNudges : policy?.maxNudges);
  return Math.max(0, Math.min(3, Number.isFinite(n) ? Math.floor(n) : 0));
}

/**
 * 合成"为什么不发言"的理由。
 *
 * 模型自己不说时由系统补一条 —— 管理端必须能看懂"它到底为什么没说话"，
 * 而不是只看到一个没有解释的「未回复」。
 *
 * @param {{ messages?: Array, cause?: string, enforced?: boolean }} args
 * @returns {string} 空串表示调用方要求不记录理由（fallback='off'）
 */
export function silenceReasonOf({ messages = [], cause = 'no-output', enforced = false } = {}) {
  const text = (Array.isArray(messages) ? messages : [])
    // 只统计**原始**模型输出：续问轮的 assistant 内容是"被追问后的回答"，
    // 拿它当"为什么不说话"的证据会自相矛盾。
    .filter((m) => m && m.role === 'assistant' && !m.nudgeRound)
    .map((m) => String(m.content || ''))
    .join('')
    .trim();
  const head = text
    ? `（内部输出 ${text.length} 字，开头：「${text.slice(0, 60).replace(/\s+/g, ' ')}」）`
    : '';
  const reason = CAUSES.includes(cause) ? cause : 'no-output';
  if (reason === 'max-rounds') return `没有发言，也没给出理由：工具轮次耗尽${head}`;
  if (reason === 'nudge-failed') return `没有发言，也没给出理由：系统追问时调用失败${head}`;
  if (enforced) return `没有发言，也没给出理由：系统追问过，模型仍未表态${head}`;
  return `没有发言，也没给出理由：模型没有调用任何工具就结束了${head}`;
}

/** 运行终态元信息（UI 用；集中定义避免前后端文案漂移）。 */
export const SILENCE_KIND_META = {
  stop: { icon: '🏁', title: '模型决定不回复' },
  silent: { icon: '🤐', title: '没有发言，也没给出理由' },
  'no-output': { icon: '🤐', title: '没有发言，也没给出理由' },
  'max-rounds': { icon: '⏱', title: '没有发言，也没给出理由' },
  timeout: { icon: '⌛', title: '处理超时已中止' },
  error: { icon: '⚠', title: '运行出错' },
  // 模型坚称"我发过了"，但本次运行没有任何实际外发；与"决定不回复"是两回事。
  unsent: { icon: '⚠', title: '模型说发了，实际没发出' },
  spoken: { icon: '💬', title: '已发言' }
};
