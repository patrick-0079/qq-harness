// 扩展仓库的页签注册表：页签归**管理器插件**所有。
//
// 为什么这样做：MCP 本身是一个插件，它的页面就该随它的启停出现/消失。
// 新插件（比如以后加载容器扩展的那个）只要在 activate 里注册一个 tab，
// 扩展仓库就多一个页签 —— 不需要改核心前端。
//
// 三种模式：
//   template —— 核心用统一模板渲染（页头/搜索/筛选/卡片/详情），插件只提供数据地址
//   iframe   —— 插件提供包内 HTML，核心用 sandbox iframe 加载（第三方自定义首选）
//   script   —— 插件提供包内 JS（导出 mount(el, ctx)），**仅内置插件**允许
//
// 所有页签都带 ownerId：插件 deactivate / 卸载时按 owner 批量撤销。

const tabs = new Map();   // id → tab

const MODES = new Set(['template', 'iframe', 'script']);
// 页签出现在哪个界面：repo=扩展仓库，session=会话设置→扩展，both=两处都有
const SURFACES = new Set(['repo', 'session', 'both']);
const ID_RE = /^[a-z][a-z0-9-]*$/;

/**
 * 校验一条页签声明。
 * @returns {{ok: boolean, violations: string[]}}
 */
export function validateTab(spec = {}) {
  const v = [];
  if (!ID_RE.test(String(spec.id || ''))) v.push(`页签 id 不合法：${spec.id}`);
  if (!spec.label) v.push('缺少 label');
  const mode = String(spec.mode || 'template');
  if (!MODES.has(mode)) v.push(`mode 只能是 template/iframe/script：${mode}`);
  if (mode === 'template' && !spec.dataUrl) v.push('template 模式必须提供 dataUrl');
  if (mode === 'iframe' && !spec.page) v.push('iframe 模式必须提供 page（包内 HTML 相对路径）');
  if (mode === 'script' && !spec.script) v.push('script 模式必须提供 script（包内 JS 相对路径）');
  const surface = String(spec.surface || 'repo');
  if (!SURFACES.has(surface)) v.push('surface 只能是 repo/session/both');
  return { ok: v.length === 0, violations: v };
}

/**
 * 注册一个页签。
 * @param {object} spec
 * @param {{ownerId: string, scope?: string, builtin?: boolean}} ctx
 */
export function registerTab(spec, { ownerId, scope = 'global', builtin = false } = {}) {
  if (String(scope) === 'session') {
    return { ok: false, error: '会话级插件不能注册扩展仓库页签（只有全局插件可以）' };
  }
  const check = validateTab(spec);
  if (!check.ok) return { ok: false, error: check.violations.join('；') };

  const mode = String(spec.mode || 'template');
  // 控制台是同源页面：直接执行第三方脚本等于把 token 与整页 DOM 交出去。
  if (mode === 'script' && !builtin) {
    return { ok: false, error: 'script 模式仅限内置插件（第三方请用 iframe）' };
  }

  const tab = {
    id: String(spec.id),
    label: String(spec.label),
    icon: String(spec.icon || '🧩'),
    order: Number(spec.order) || 500,
    mode,
    dataUrl: spec.dataUrl ? String(spec.dataUrl) : '',
    detailUrl: spec.detailUrl ? String(spec.detailUrl) : '',
    page: spec.page ? String(spec.page) : '',
    script: spec.script ? String(spec.script) : '',
    hint: spec.hint ? String(spec.hint) : '',
    surface: String(spec.surface || 'repo'),
    ownerId: String(ownerId || ''),
    scope: String(scope),
    builtin: Boolean(builtin)
  };
  tabs.set(tab.id, tab);
  return { ok: true, tab };
}

export function unregisterTab(id) {
  return tabs.delete(String(id));
}

export function unregisterTabsByOwner(ownerId) {
  let n = 0;
  for (const [id, t] of tabs) {
    if (t.ownerId === String(ownerId)) { tabs.delete(id); n += 1; }
  }
  return n;
}

export function getTab(id) {
  return tabs.get(String(id)) || null;
}

/** 列出页签（按 order 排序）。 */
export function listTabs() {
  return [...tabs.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** 列出某个界面要显示的页签（repo / session）。 */
export function listTabsFor(surface) {
  const s = String(surface);
  return listTabs().filter((t) => t.surface === s || t.surface === 'both');
}

export function clearTabs() {
  tabs.clear();
}
