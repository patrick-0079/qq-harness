// 扩展类型闸门：六类扩展的纯数据约束表。
//
// 这是微内核改造的核心契约：每种扩展类型允许的导出、清单键、
// 能否注册工具——全部在这里声明，加载器与运行时按此表校验。
//
// 设计原则：
//   1. 类型表是纯数据，不含任何执行逻辑 → 便于测试、版本化、UI 展示
//   2. 插件（plugin）是权力最大的类型，但仅限随应用发布的内置插件
//   3. 越界在加载期被拒绝（loadError），不是警告
//   4. 每种类型有自己的清单文件名与目录约定

/**
 * 扩展类型枚举（v2）。
 *
 * 六类：
 *   tool         — 只注册工具，不碰生命周期（进程内可信）
 *   plugin       — 生命周期与控制面，权力最大（仅限内置可信）
 *   knowledge    — 纯数据（L0-L3 文档），无代码入口
 *   mcp          — 外部 MCP 服务声明（mcp.json），无本地代码
 *   skill        — 沙箱脚本，经 skill_script_run 调用
 *   promptinject — 提示词注入（append/rewrite），同步纯函数
 */
export const EXT_TYPES = {
  tool: {
    id: 'tool',
    label: '工具',
    dir: 'tools',
    manifest: 'tool.json',
    // 允许的入口导出（静态闸：超出即 loadError）
    allowedExports: ['setup', 'register', 'available', 'dispose', 'vars'],
    // 禁止的导出（显式列出便于诊断）
    forbiddenExports: ['hooks', 'providers', 'activate', 'deactivate', 'promptSections'],
    canRegisterTool: true,
    canHook: false,
    canProvide: false,
    canInjectPrompt: false,
    executesCode: true,
    sandboxed: false,
    // 清单键白名单（null = 不限制；v1 兼容期先不限）
    manifestKeys: null,
    description: '只注册工具的扩展。不参与任何生命周期，由模型自行决定何时调用。'
  },

  plugin: {
    id: 'plugin',
    label: '插件',
    dir: 'plugins',
    manifest: 'plugin.json',
    allowedExports: ['setup', 'register', 'hooks', 'providers', 'activate', 'deactivate', 'dispose', 'available', 'promptSections', 'vars'],
    forbiddenExports: [],
    canRegisterTool: false,
    canHook: true,
    canProvide: true,
    canInjectPrompt: false,  // 提示词追加走 promptSections；改写归 promptinject
    executesCode: true,
    sandboxed: false,
    manifestKeys: null,
    description: '生命周期与控制面。权力最大——仅限随应用发布的内置可信插件。'
  },

  knowledge: {
    id: 'knowledge',
    label: '知识',
    dir: 'knowledge',
    manifest: 'knowledge.json',
    allowedExports: [],      // 纯数据，不允许任何 JS 入口
    forbiddenExports: ['setup', 'register', 'hooks', 'providers', 'activate', 'deactivate', 'dispose', 'promptSections'],
    canRegisterTool: false,
    canHook: false,
    canProvide: false,
    canInjectPrompt: false,
    executesCode: false,
    sandboxed: false,
    manifestKeys: null,
    description: '文档型知识。L0 库摘要 → L1 模块简介 → L2 文档简介 → L3 原文。纯数据，不执行代码。'
  },

  mcp: {
    id: 'mcp',
    label: 'MCP',
    dir: 'mcp',
    manifest: 'mcp.json',
    allowedExports: [],      // 纯配置
    forbiddenExports: ['setup', 'register', 'hooks', 'providers', 'activate', 'deactivate', 'dispose'],
    canRegisterTool: false,  // 工具由宿主 MCP 客户端代理注册
    // mcp 工具由管理器以子扩展身份注册（宿主代理），因此允许成为工具 owner
    hostProxyTools: true,
    canHook: false,
    canProvide: false,
    canInjectPrompt: false,
    executesCode: false,
    sandboxed: false,
    manifestKeys: null,
    description: '外部 MCP 服务声明。只要求 mcp.json 配置文件，可选附 md 说明。'
  },

  skill: {
    id: 'skill',
    label: '技能',
    dir: 'skills',
    manifest: 'skill.json',
    allowedExports: [],      // 脚本被沙箱调用，无 ESM 导出
    forbiddenExports: ['setup', 'register', 'hooks', 'providers', 'activate', 'deactivate', 'dispose'],
    canRegisterTool: false,  // 模型只看到 skill_script_run，不看到独立工具
    // 沙箱脚本不直接注册工具；如需按脚本暴露工具，由管理器代理
    hostProxyTools: false,
    canHook: false,
    canProvide: false,
    canInjectPrompt: false,
    executesCode: true,
    sandboxed: true,
    manifestKeys: null,
    description: '沙箱脚本。模型通过 skill_script_run(skillId, script, lang, args) 调用，不能直接执行 shell。'
  },

  promptinject: {
    id: 'promptinject',
    label: '提示词注入',
    dir: 'promptinjects',
    manifest: 'promptinject.json',
    allowedExports: ['meta', 'append', 'rewrite'],
    forbiddenExports: ['setup', 'register', 'hooks', 'providers', 'activate', 'deactivate'],
    canRegisterTool: false,
    canHook: false,
    canProvide: false,
    canInjectPrompt: true,
    executesCode: true,
    sandboxed: false,        // 进程内可信，但只允许同步纯函数
    manifestKeys: null,
    description: '提示词注入。inject.js 导出 meta + append + rewrite，一包可声明多条注入。'
  }
};

/** 全部合法类型 id（用于校验）。 */
export const VALID_TYPE_IDS = Object.keys(EXT_TYPES);

/**
 * 校验模块导出是否符合类型约束。
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function validateExports(typeId, moduleExports = {}) {
  const gate = EXT_TYPES[typeId];
  if (!gate) return { ok: false, violations: [`未知扩展类型：${typeId}`] };

  const violations = [];
  const exportNames = Object.keys(moduleExports).filter((k) => k !== 'internals' && k !== 'default');

  for (const name of exportNames) {
    if (gate.forbiddenExports.includes(name)) {
      violations.push(`类型 ${typeId} 不允许导出 "${name}"（允许：${gate.allowedExports.join(', ') || '无'}）`);
    }
  }

  // 类型声明了 allowedExports 但入口什么都没提供 → 至少要有 setup/register/meta 之一
  if (gate.allowedExports.length > 0) {
    const hasEntry = exportNames.some((n) => gate.allowedExports.includes(n));
    if (!hasEntry && exportNames.length > 0) {
      violations.push(`类型 ${typeId} 需要导出以下之一：${gate.allowedExports.join(' / ')}`);
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * 校验清单是否符合类型约束（静态键检查）。
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function validateManifest(typeId, manifest = {}) {
  const gate = EXT_TYPES[typeId];
  if (!gate) return { ok: false, violations: [`未知扩展类型：${typeId}`] };

  const violations = [];
  if (!manifest.id) violations.push('缺少 id');

  // 纯数据类型不允许声明 entry（无代码入口）
  if (!gate.executesCode && manifest.entry) {
    violations.push(`类型 ${typeId} 是纯数据/配置扩展，不允许 entry（当前：${manifest.entry}）`);
  }

  return { ok: violations.length === 0, violations };
}

/** 由目录名推断期望类型。 */
export function typeOfDir(dirPath) {
  const base = String(dirPath ?? '').replace(/[/\\]+$/, '').split(/[/\\]/).pop();
  for (const gate of Object.values(EXT_TYPES)) {
    if (gate.dir === String(base || '').toLowerCase()) return gate.id;
  }
  return null;
}

/** 内置可信插件 allowlist（编译/发布时填充；空 = 未配置，运行时不信任任何第三方 plugin）。 */
export const BUILTIN_PLUGIN_ALLOWLIST = new Set([
  // 随应用发布的管理器插件（P3+ 逐个添加）：
  // 'ext-knowledge', 'ext-mcp', 'ext-skill', 'ext-tool', 'ext-promptinject'
]);

// ── 插件作用域（scope）──────────────────────────────────────────────────
// 全局插件（plugins/）：可以碰内核与扩展管理面，可以贡献界面。
// 会话插件（chat-plugins/）：只能参与"单个会话"的对话流程，不能碰管理面、不能改界面。
export const SESSION_ALLOWED_HOOKS = new Set([
  // v1 的五个钩子同样是会话期语义（组装上下文/发模型前后/工具前后），必须放行
  'before-context', 'before-llm-messages', 'after-response', 'before-tool', 'after-tool',
  // 事件型旧钩子（单个会话内的事件回调）
  'onMessage', 'onNotice', 'onEvent',
  'message.received', 'trigger.evaluate', 'session.wake', 'context.build',
  'prompt.segments', 'prompt.render', 'messages.before',
  'llm.before', 'llm.after', 'llm.error',
  'tools.resolve', 'tool.before', 'tool.after',
  'reply.before-send', 'reply.after-send', 'reply.failed', 'session.end'
]);

/** 该作用域能否注册某个 hook。 */
export function isHookAllowed(scope, hookId) {
  if (String(scope) !== 'session') return true;
  return SESSION_ALLOWED_HOOKS.has(String(hookId));
}

/** 只有全局插件可以贡献界面。 */
export function canContributeUi(scope) {
  return String(scope) !== 'session';
}