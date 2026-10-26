// 页面级扩展点：UI 插槽目录与贡献注册表。
//
// 设计约束（见「页面级插件扩展点设计」）：
//   1. 默认只追加，不提供任意 DOM patch；局部替换需 allowReplace
//   2. 第三方/市场扩展只能用声明式组件（后端 schema + 核心 renderer），
//      不能注入 HTML/JS
//   3. 内置可信插件可挂载 ESM UI 模块（kind='module'），但必须经 allowlist 与
//      ShadowRoot 隔离；模块资源由核心静态路由提供，CSP 保持 script-src 'self'
//   4. 插槽目录由核心维护并版本化；未知插槽的贡献被拒绝而非静默丢弃

/** 插槽 API 版本：贡献声明里带 apiVersion，不匹配时拒绝并给出原因。 */
export const UI_SLOT_API_VERSION = 1;

/**
 * 核心维护的 UI 插槽目录。
 *
 * allowedKinds：允许的贡献类型（declarative/模块）
 * allowReplace：是否允许替换该区域默认内容（默认 false = 只追加）
 */
export const UI_SLOTS = {
  'shell.nav.primary': {
    page: 'shell',
    label: '主导航 / 扩展菜单',
    description: '在「扩展」菜单下增加插件自有页面入口',
    allowedKinds: ['declarative', 'module'],
    allowReplace: false,
    maxItems: 12
  },
  'shell.status.right': {
    page: 'shell',
    label: '顶栏状态区',
    description: '顶栏右侧的状态徽标或简短状态块',
    allowedKinds: ['declarative'],
    allowReplace: false,
    maxItems: 6
  },
  'page.chatmanage.session-list.row-actions': {
    page: 'chatmanage',
    label: '会话列表项操作',
    description: '每个会话条目上的操作菜单项',
    allowedKinds: ['declarative'],
    allowReplace: false,
    maxItems: 8
  },
  'page.chatmanage.session-detail.header-actions': {
    page: 'chatmanage',
    label: '会话详情标题操作',
    description: '会话详情标题栏的按钮与状态徽标',
    allowedKinds: ['declarative', 'module'],
    allowReplace: false,
    maxItems: 8
  },
  'page.chatmanage.session-detail.tabs': {
    page: 'chatmanage',
    label: '会话详情子页签',
    description: '在运行记录/存档/记忆之外增加插件自己的子页',
    allowedKinds: ['declarative', 'module'],
    allowReplace: false,
    maxItems: 6
  },
  'page.chatmanage.session-settings.sections': {
    page: 'chatmanage',
    label: '会话设置分区',
    description: '会话个性化面板中的额外设置分区',
    allowedKinds: ['declarative'],
    allowReplace: false,
    maxItems: 8
  },
  'page.prompts.editor.actions': {
    page: 'prompts',
    label: '提示词编辑工具栏',
    description: '提示词管理页的额外操作按钮',
    allowedKinds: ['declarative'],
    allowReplace: false,
    maxItems: 8
  },
  'page.extensions.types': {
    page: 'extensions',
    label: '扩展类型页签',
    description: '向「扩展仓库」追加一个类型页签（payload: id/label/icon/order/template/type）',
    allowedKinds: ['declarative'],
    allowReplace: false,
    maxItems: 12
  },
  'page.settings.model.extra': {
    page: 'settings',
    label: '模型配置附加项',
    description: '在模型配置区增加设置项（如知识库摘要模型）',
    allowedKinds: ['declarative'],
    allowReplace: false,
    maxItems: 4
  },
  'page.usage.summary.cards': {
    page: 'usage',
    label: '用量摘要卡片',
    description: '用量页摘要区的指标卡片或状态面板',
    allowedKinds: ['declarative', 'module'],
    allowReplace: false,
    maxItems: 6
  },
  'page.extensions.repository.card-actions': {
    page: 'plugins',
    label: '扩展仓库卡片操作',
    description: '扩展卡片上的操作按钮（只读/诊断类，不改启停核心控件）',
    allowedKinds: ['declarative'],
    allowReplace: false,
    maxItems: 6
  },
  'page.extensions.repository.detail-tabs': {
    page: 'plugins',
    label: '扩展详情页签',
    description: '扩展详情里的额外信息页签',
    allowedKinds: ['declarative', 'module'],
    allowReplace: false,
    maxItems: 6
  }
};

/** 声明式组件白名单（前端 renderer 只认这些 type）。 */
export const DECLARATIVE_TYPES = new Set([
  'text', 'badge', 'card', 'metric', 'list', 'table', 'form', 'button', 'menuItem', 'link', 'divider'
]);

/** 单值/数组上限，避免扩展用超大 payload 拖垮控制台。 */
const LIMITS = {
  maxDepth: 6,
  maxString: 4000,
  maxArray: 100,
  maxProps: 40
};

/**
 * 净化声明式 payload：只保留白名单类型 + 原始值字段。
 *
 * 前端用 DOM API + textContent 渲染，不会把这个对象当 HTML 解析；
 * 这里再做一次结构限制，防止超大/异常结构。
 *
 * @returns {{ ok: boolean, payload?: object, error?: string }}
 */
export function sanitizePayload(raw, depth = 0) {
  if (depth > LIMITS.maxDepth) return { ok: false, error: 'payload 嵌套超过上限' };
  if (raw === null || raw === undefined) return { ok: true, payload: null };
  if (typeof raw === 'string') {
    return { ok: true, payload: raw.slice(0, LIMITS.maxString) };
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') return { ok: true, payload: raw };
  if (Array.isArray(raw)) {
    const out = [];
    for (const item of raw.slice(0, LIMITS.maxArray)) {
      const r = sanitizePayload(item, depth + 1);
      if (!r.ok) return r;
      out.push(r.payload);
    }
    return { ok: true, payload: out };
  }
  if (typeof raw === 'object') {
    const out = {};
    const entries = Object.entries(raw).slice(0, LIMITS.maxProps);
    for (const [k, v] of entries) {
      // 拒绝 __proto__ / constructor / prototype 之类的原型污染键
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const r = sanitizePayload(v, depth + 1);
      if (!r.ok) return r;
      out[k] = r.payload;
    }
    return { ok: true, payload: out };
  }
  return { ok: true, payload: null };
}

/** 校验一条贡献声明。 */
export function validateContribution(contribution, { isTrustedPlugin = false } = {}) {
  const c = contribution || {};
  const violations = [];

  const point = String(c.point || '');
  const slot = UI_SLOTS[point];
  if (!slot) violations.push(`未知插槽：${point}`);

  const apiVersion = Number(c.apiVersion) || UI_SLOT_API_VERSION;
  if (apiVersion !== UI_SLOT_API_VERSION) {
    violations.push(`插槽 API 版本不匹配：${c.apiVersion}（当前支持 ${UI_SLOT_API_VERSION}）`);
  }

  const kind = String(c.kind || 'declarative');
  if (!['declarative', 'module'].includes(kind)) violations.push(`kind 非法：${kind}`);

  if (slot && !slot.allowedKinds.includes(kind)) {
    violations.push(`插槽 ${point} 不允许 ${kind} 贡献（允许：${slot.allowedKinds.join('/')}）`);
  }

  if (kind === 'module' && !isTrustedPlugin) {
    violations.push('只有随应用发布的内置可信插件可以挂载 UI 模块');
  }

  if (kind === 'declarative') {
    const p = c.payload;
    if (!p || typeof p !== 'object') violations.push('缺少 payload');
    else if (!DECLARATIVE_TYPES.has(String(p.type || ''))) {
      violations.push(`组件类型不在白名单：${p.type}（允许：${[...DECLARATIVE_TYPES].join('/')}）`);
    }
    const sr = sanitizePayload(p);
    if (!sr.ok) violations.push(sr.error);
  }

  if (kind === 'module' && !c.entry) violations.push('module 贡献缺少 entry');

  if (!c.id) violations.push('缺少贡献 id');

  return { ok: violations.length === 0, violations };
}

/**
 * UI 贡献注册表。
 */
export class UIExtensionRegistry {
  constructor() {
    this.contributions = new Map();   // `${ownerId}:${id}` -> contribution
    this.actions = new Map();         // `${ownerId}:${actionId}` -> action def
  }

  /**
   * 登记一条 UI 贡献。
   * @returns {{ok: boolean, error?: string}}
   */
  register(contribution, { isTrustedPlugin = false } = {}) {
    const v = validateContribution(contribution, { isTrustedPlugin });
    if (!v.ok) return { ok: false, error: v.violations.join('；') };

    const ownerId = String(contribution.ownerId || '');
    if (!ownerId) return { ok: false, error: '缺少 ownerId' };

    const key = `${ownerId}:${contribution.id}`;
    this.contributions.set(key, {
      ownerId,
      id: String(contribution.id),
      point: String(contribution.point),
      kind: contribution.kind || 'declarative',
      apiVersion: Number(contribution.apiVersion) || UI_SLOT_API_VERSION,
      order: Number(contribution.order) || 100,
      priority: Number(contribution.priority) || 50,
      title: String(contribution.title || ''),
      entry: contribution.entry ? String(contribution.entry) : '',
      payload: contribution.kind === 'module' ? null : sanitizePayload(contribution.payload).payload,
      actions: Array.isArray(contribution.actions) ? contribution.actions.slice(0, 10).map((a) => ({
        id: String(a?.id || ''),
        label: String(a?.label || '').slice(0, 60),
        actionId: String(a?.actionId || '')
      })) : []
    });
    return { ok: true };
  }

  unregister(ownerId, id) {
    return this.contributions.delete(`${ownerId}:${id}`);
  }

  /** 注销某扩展的全部 UI 贡献与动作。 */
  unregisterByOwner(ownerId) {
    const removed = [];
    for (const key of [...this.contributions.keys()]) {
      if (key.startsWith(`${ownerId}:`)) {
        this.contributions.delete(key);
        removed.push(key);
      }
    }
    for (const key of [...this.actions.keys()]) {
      if (key.startsWith(`${ownerId}:`)) this.actions.delete(key);
    }
    return removed;
  }

  /** 某插槽的贡献（按 order/priority/id 稳定排序）。 */
  listBySlot(point, { enabledOwners = null } = {}) {
    const slot = UI_SLOTS[point];
    const list = [...this.contributions.values()]
      .filter((c) => c.point === point)
      .filter((c) => !enabledOwners || enabledOwners(c.ownerId))
      .sort((a, b) => a.order - b.order || b.priority - a.priority || a.id.localeCompare(b.id));
    return slot ? list.slice(0, slot.maxItems) : list;
  }

  /** 某页面的全部贡献（前端一次拉全）。 */
  listByPage(page) {
    const points = Object.entries(UI_SLOTS)
      .filter(([, slot]) => slot.page === page)
      .map(([id]) => id);
    return [...this.contributions.values()].filter((c) => points.includes(c.point));
  }

  list() { return [...this.contributions.values()]; }

  // ── UI 动作（受控后端调用）────────────────────────────────────────────

  /**
   * 登记一个 UI 动作。owner 必须已登记为子扩展（由管理器插件负责）。
   */
  registerAction({ ownerId, actionId, inputSchema = null, handler, mutates = false }) {
    if (!ownerId || !actionId) throw new Error('UI 动作需要 ownerId 与 actionId');
    if (typeof handler !== 'function') throw new Error('UI 动作需要 handler 函数');
    this.actions.set(`${ownerId}:${actionId}`, {
      ownerId: String(ownerId),
      actionId: String(actionId),
      inputSchema,
      handler,
      mutates: Boolean(mutates)
    });
    return true;
  }

  /**
   * 调用一个 UI 动作（核心统一入口，鉴权/来源校验在 HTTP 层）。
   */
  async invokeAction(ownerId, actionId, args = {}, context = {}) {
    const key = `${ownerId}:${actionId}`;
    const action = this.actions.get(key);
    if (!action) return { ok: false, error: `未知 UI 动作：${key}` };
    try {
      const result = await action.handler(args, context);
      const sr = sanitizePayload(result);
      return { ok: true, result: sr.ok ? sr.payload : null };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  }

  hasAction(ownerId, actionId) {
    return this.actions.has(`${ownerId}:${actionId}`);
  }

  clear() {
    this.contributions.clear();
    this.actions.clear();
  }
}

// 模块级单例
export const uiExtensionRegistry = new UIExtensionRegistry();
