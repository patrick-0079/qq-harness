// 扩展类型目录：定义「扩展仓库」里有哪些二级页签。
//
// 这是页面级的扩展点之一：
//   · 内置的六类（plugin/tool/mcp/skill/knowledge/promptinject）在这里给 UI 元信息
//   · 第三方可以通过 UI 扩展点 `page.extensions.types` 追加新类型，
//     贡献的 payload 形状与下面的条目一致（id/label/icon/order/template/source）
//
// 字段说明：
//   id        类型 id（与 EXT_TYPES 对应；第三方可自定义）
//   label/icon 页签文案
//   order     排序（小的在前）
//   template  'module' 走旧仓库页（插件/技能，带安装/设置/删除），'cards' 走统一卡片模板
//   listApi   该类型在卡片模板下从哪里取数据（目前统一 /api/extensions?type=）
import { uiExtensionRegistry, UI_SLOTS } from './ui-registry.js';
import { listTabs } from './tab-registry.js';

/** 内置六类的 UI 元信息。 */
export const BUILTIN_TYPE_TABS = [
  // 只有「插件」两页由核心内置（它们是第一公民，始终存在）。
  // 工具 / MCP / 技能 / 知识 / 上下文 的页签由各自的管理器插件注册（见 tab-registry）。
  { id: 'plugin', label: '全局插件', icon: '🌐', order: 10, template: 'module', type: null, scope: 'global', kind: 'plugin' },
  { id: 'chat-plugin', label: '会话插件', icon: '💬', order: 15, template: 'module', type: null, scope: 'session', kind: 'plugin' }
];

/**
 * 列出全部页签：内置 + 第三方通过 UI 扩展点追加的。
 * 第三方的 payload 里带 { id, label, icon, order, type }，template 缺省为 cards。
 */
export function listExtensionTypes(surface = '') {
  const custom = [];
  try {
    const items = uiExtensionRegistry.listBySlot?.('page.extensions.types') || [];
    for (const it of items) {
      const p = it.payload || {};
      const id = String(p.id || it.id || '').trim();
      if (!id) continue;
      custom.push({
        id,
        label: String(p.label || id),
        icon: String(p.icon || '🧩'),
        order: Number(p.order) || 500,
        template: p.template === 'module' ? 'module' : 'cards',
        type: p.type === null ? null : String(p.type || id),
        from: it.ownerId || 'extension'
      });
    }
  } catch { /* 扩展点不可用时只返回内置 */ }

  const seen = new Set(BUILTIN_TYPE_TABS.map((t) => t.id));
  // 管理器注册的页签（顺序与模式由插件自己决定）
  const owned = listTabs().map((t) => ({
    id: t.id, label: t.label, icon: t.icon, order: t.order,
    template: t.mode === 'template' ? 'cards' : t.mode,
    type: t.mode === 'template' ? (t.id) : null,
    dataUrl: t.dataUrl, detailUrl: t.detailUrl, page: t.page, script: t.script,
    hint: t.hint, ownerId: t.ownerId, surface: t.surface || 'repo'
  }));
  const merged = [...BUILTIN_TYPE_TABS, ...owned, ...custom.filter((c) => !seen.has(c.id))];
  const filtered = surface ? merged.filter((t) => t.surface === surface || t.surface === 'both') : merged;
  return filtered.sort((a, b) => (a.order || 100) - (b.order || 100));
}

export { UI_SLOTS };
