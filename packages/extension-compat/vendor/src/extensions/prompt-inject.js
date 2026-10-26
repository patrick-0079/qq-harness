// 提示词注入类型：promptinject 管理器插件使用的锚点与改写契约。
//
// 注入点按 prompt.js 的实际拼装顺序定义（buildSystemPrompt 两条分支）。
// 每个锚点有明确的位置与分支适用性；rewrite 只能针对注册的 segment id。
//
// 不可绕过：security 段有不可关闭的底线（core.safety-floor），
// 改写只能在底线之上加严，不能删除底线。

/**
 * 追加锚点（append `at`）。
 *
 * 与 prompt.js 的两条分支对应：
 *   A（提示词库选中）：promptText → security → tool-protocol → sections → admin
 *   B（内置分支）：identity → security → tool-protocol → guidelines → sections → admin
 */
export const PROMPT_ANCHORS = {
  'before-all': {
    label: '全段之前',
    position: 0,
    branches: ['builtin', 'library'],
    allowsDynamic: false,
    description: '系统提示最前（身份句之前）'
  },
  'after-identity': {
    label: '身份/人设之后',
    position: 10,
    branches: ['builtin', 'library'],
    allowsDynamic: false,
    description: '身份句或人设正文之后，核心规则之前'
  },
  'after-security': {
    label: '安全红线之后',
    position: 20,
    branches: ['builtin', 'library'],
    allowsDynamic: false,
    description: '安全规则段之后'
  },
  'after-tool-protocol': {
    label: '工具协议之后',
    position: 30,
    branches: ['builtin', 'library'],
    allowsDynamic: false,
    description: '工具协议段之后'
  },
  'after-guidelines': {
    label: '行为准则之后',
    position: 40,
    branches: ['builtin'],  // 提示词库分支没有行为准则簇
    allowsDynamic: false,
    description: '行为准则簇之后（提示词库分支退化为 after-tool-protocol）'
  },
  'before-skill-sections': {
    label: '扩展片段之前',
    position: 50,
    branches: ['builtin', 'library'],
    allowsDynamic: false,
    description: '【可用技能】段之前'
  },
  'after-skill-sections': {
    label: '扩展片段之后',
    position: 60,
    branches: ['builtin', 'library'],
    allowsDynamic: false,
    description: '【可用技能】段之后（plugin prompt.build 默认落这里）'
  },
  'before-admin-rules': {
    label: '管理员规则之前',
    position: 70,
    branches: ['builtin', 'library'],
    allowsDynamic: false,
    description: '【管理员附加规则】之前'
  },
  'after-admin-rules': {
    label: '管理员规则之后',
    position: 80,
    branches: ['builtin', 'library'],
    allowsDynamic: false,
    description: '【管理员附加规则】之后'
  },
  'at-tail': {
    label: '系统提示末尾',
    position: 99,
    branches: ['builtin', 'library'],
    allowsDynamic: true,   // 唯一允许动态内容的位置（保护前缀缓存）
    description: '系统提示末尾。唯一允许放动态内容的位置。'
  }
};

/**
 * 改写目标（rewrite `target`）。
 *
 * 这些 id 对应 prompt.js 中的内置段落函数。
 * `security` 可改写但保留安全底线；`persona` 只替换提示词库正文。
 */
export const REWRITE_TARGETS = {
  'identity':         { label: '身份句',           segment: 'builtin',  protected: false },
  'security':         { label: '安全红线',         segment: 'both',    protected: true,  floorNote: '改写只能在底线之上加严，不可删除底线' },
  'tool-protocol':   { label: '工具协议',         segment: 'both',    protected: false },
  'anti-ai-flavor':  { label: '去 AI 味',         segment: 'builtin', protected: false },
  'subjectivity':    { label: '主体性',           segment: 'builtin', protected: false },
  'speak-or-not':    { label: '该说不说',         segment: 'builtin', protected: false },
  'not-a-queue':     { label: '不是队列',         segment: 'builtin', protected: false },
  'human-rhythm':    { label: '真人节奏',         segment: 'builtin', protected: false },
  'not-moderator':   { label: '不当管理员',       segment: 'builtin', protected: false },
  'quote-and-at':    { label: '引用与@',          segment: 'builtin', protected: false },
  'memory-rules':    { label: '记忆规则',         segment: 'builtin', protected: false },
  'sticker-rules':   { label: '表情规则',         segment: 'builtin', protected: false },
  'qq-scene':        { label: 'QQ 场景',          segment: 'builtin', protected: false },
  'report-ban':      { label: '举报封禁',         segment: 'builtin', protected: false },
  'persona':         { label: '人设正文（提示词库）', segment: 'library', protected: false },
  'admin-rules':     { label: '管理员附加规则',   segment: 'both',    protected: false }
};

/** 合法锚点名集合。 */
export const VALID_ANCHORS = new Set(Object.keys(PROMPT_ANCHORS));

/** 合法改写目标集合。 */
export const VALID_TARGETS = new Set(Object.keys(REWRITE_TARGETS));

/**
 * 校验一个注入声明。
 * @param {object} inject — { id, kind: 'append'|'rewrite', at?, target?, priority, title, summary }
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function validateInjectDeclaration(inject) {
  const violations = [];
  if (!inject?.id) violations.push('注入项缺少 id');
  const kind = String(inject?.kind || '');
  if (kind !== 'append' && kind !== 'rewrite') violations.push(`kind 必须是 append 或 rewrite（当前：${kind}）`);

  if (kind === 'append') {
    if (!VALID_ANCHORS.has(inject.at)) {
      violations.push(`append 的锚点 at 非法：${inject.at}（合法：${[...VALID_ANCHORS].join(', ')}）`);
    }
  }
  if (kind === 'rewrite') {
    if (!VALID_TARGETS.has(inject.target)) {
      violations.push(`rewrite 的目标 target 非法：${inject.target}（合法：${[...VALID_TARGETS].join(', ')}）`);
    }
  }

  const priority = Number(inject?.priority);
  if (!Number.isFinite(priority) || priority < 0 || priority > 100) {
    violations.push(`priority 必须是 0~100（当前：${inject?.priority}）`);
  }

  return { ok: violations.length === 0, violations };
}

/**
 * 校验 promptinject 的 inject.js 导出。
 * 静态闸：只允许 meta / append / rewrite；meta.injects 逐项校验。
 */
export function validatePromptInjectExports(moduleExports = {}) {
  const violations = [];
  const allowed = new Set(['meta', 'append', 'rewrite', 'internals', 'default']);
  for (const name of Object.keys(moduleExports)) {
    if (!allowed.has(name)) {
      violations.push(`promptinject 只允许导出 meta/append/rewrite（发现："${name}"）`);
    }
  }
  const meta = moduleExports.meta;
  if (!meta || typeof meta !== 'object' || !Array.isArray(meta.injects)) {
    violations.push('缺少 meta.injects 数组');
  } else {
    for (const inject of meta.injects) {
      const r = validateInjectDeclaration(inject);
      violations.push(...r.violations.map((v) => `注入 ${inject.id || '?'}：${v}`));
    }
  }
  if (typeof moduleExports.append !== 'function' && meta?.injects?.some((i) => i.kind === 'append')) {
    violations.push('声明了 append 注入但未导出 append 函数');
  }
  if (typeof moduleExports.rewrite !== 'function' && meta?.injects?.some((i) => i.kind === 'rewrite')) {
    violations.push('声明了 rewrite 注入但未导出 rewrite 函数');
  }

  return { ok: violations.length === 0, violations };
}

/**
 * 同一 target 多个 rewrite 时的冲突判定。
 * 优先级最高者胜；同优先级取 order 更小的。
 *
 * @param {Array<{ownerId, order, priority, target}>} rewrites
 * @returns {Map<string, string>} target -> 胜出的 ownerId
 */
export function resolveRewriteConflicts(rewrites) {
  const byTarget = new Map();
  for (const r of rewrites) {
    const list = byTarget.get(r.target) || [];
    list.push(r);
    byTarget.set(r.target, list);
  }
  const winners = new Map();
  for (const [target, list] of byTarget) {
    if (list.length === 1) {
      winners.set(target, list[0].ownerId);
    } else {
      // 优先级高的胜出（priority 数值大 = 优先级高）；同优先级取 order 小的
      const sorted = [...list].sort((a, b) =>
        (b.priority || 50) - (a.priority || 50) || (a.order || 100) - (b.order || 100)
      );
      winners.set(target, sorted[0].ownerId);
    }
  }
  return winners;
}
