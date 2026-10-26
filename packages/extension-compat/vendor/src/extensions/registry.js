// 子扩展描述符注册表：管理器插件与核心之间的唯一契约。
//
// 核心不认识具体扩展类型（tool/knowledge/mcp/skill/promptinject）的实现细节，
// 只认描述符表里的 type + id + 状态。管理器插件往这张表登记子包，
// 核心 UI 与 /api/extensions 通用渲染。
//
// 设计要点：
//   1. id 全局唯一（跨类型也不允许重名，避免工具前缀撞车）
//   2. manager 不能认领未登记的 owner（registerToolAs 的前置校验）
//   3. 启用状态按会话作用域读取（overrides.extensions[id]）
//   4. 进程级 activate/deactivate 仅管理共享资源（连接/定时器），
//      不等于单个会话启用——多会话需求由 manager 做引用计数

import { EXT_TYPES } from './types.js';
import { getConfig } from '../config.js';
import { withChatScope, effectiveConfigForChat } from '../chat-profiles.js';

/**
 * 子扩展描述符注册表。
 *
 * 描述符形状：
 * {
 *   type: 'tool' | 'knowledge' | 'mcp' | 'skill' | 'promptinject',
 *   id: string,               // 全局唯一
 *   name: string,             // 显示名
 *   version: string,
 *   managerId: string,        // 登记它的管理器插件 id（如 'ext-knowledge'）
 *   status: 'active' | 'inactive' | 'error' | 'loading',
 *   error?: string,
 *   settingsSchema?: object,  // configSchema（供 UI 渲染表单）
 *   settings?: object,        // 默认值
 *   details?: object          // 类型专属字段透传（工具数/L0-L2 计数/MCP 连接态等）
 * }
 */
export class ExtensionDescriptorRegistry {
  constructor() {
    this.descriptors = new Map();       // id -> descriptor
    this.managers = new Map();          // managerId -> Set<childId>
  }

  /**
   * 登记一个子扩展。
   * @returns {{ ok: boolean, error?: string }}
   */
  register(descriptor) {
    const type = String(descriptor?.type || '').trim();
    const gate = EXT_TYPES[type];
    if (!gate) return { ok: false, error: `未知扩展类型：${type}` };

    const id = String(descriptor?.id || '').trim();
    if (!id) return { ok: false, error: '缺少 id' };
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
      return { ok: false, error: `id 只能包含字母/数字/._-（当前：${id}）` };
    }

    // id 全局唯一：跨类型也不允许重名（工具前缀依赖唯一 owner）
    if (this.descriptors.has(id)) {
      const existing = this.descriptors.get(id);
      if (existing.managerId !== descriptor.managerId) {
        return { ok: false, error: `id "${id}" 已被 ${existing.managerId} 登记为 ${existing.type}` };
      }
      // 同 manager 重复登记 = 热重载，覆盖
    }

    this.descriptors.set(id, {
      type,
      id,
      name: String(descriptor.name || id),
      description: String(descriptor.description || ''),
      version: String(descriptor.version || '0.0.0'),
      managerId: String(descriptor.managerId || ''),
      status: String(descriptor.status || 'active'),
      error: descriptor.error ? String(descriptor.error) : '',
      settingsSchema: descriptor.settingsSchema || {},
      settings: descriptor.settings || {},
      details: descriptor.details || {},
      registeredAt: Date.now()
    });

    // manager 索引
    const mid = String(descriptor.managerId || '');
    if (mid) {
      if (!this.managers.has(mid)) this.managers.set(mid, new Set());
      this.managers.get(mid).add(id);
    }

    return { ok: true };
  }

  /** 注销一个子扩展（连同其 manager 索引）。 */
  unregister(id) {
    const d = this.descriptors.get(id);
    if (!d) return false;
    if (d.managerId && this.managers.has(d.managerId)) {
      this.managers.get(d.managerId).delete(id);
      if (this.managers.get(d.managerId).size === 0) this.managers.delete(d.managerId);
    }
    this.descriptors.delete(id);
    return true;
  }

  /** 注销某 manager 登记的全部子扩展（manager 卸载/失败时调用）。 */
  unregisterByManager(managerId) {
    const ids = [...(this.managers.get(managerId) || [])];
    for (const id of ids) this.unregister(id);
    this.managers.delete(managerId);
    return ids;
  }

  get(id) { return this.descriptors.get(String(id)) || null; }

  /** 查询某 owner 是否已登记且类型允许注册工具。 */
  canOwnerRegisterTool(ownerId) {
    const d = this.descriptors.get(String(ownerId));
    if (!d) return { ok: false, reason: `owner "${ownerId}" 未在描述符表登记` };
    const gate = EXT_TYPES[d.type];
    // 直接注册（tool）或由管理器代理注册（mcp 等 hostProxyTools 类型）
    if (!gate?.canRegisterTool && !gate?.hostProxyTools) {
      return { ok: false, reason: `类型 ${d.type} 不允许注册工具（owner: ${ownerId}）` };
    }
    return { ok: true };
  }

  /** 按类型过滤列表。 */
  listByType(type) {
    return [...this.descriptors.values()].filter((d) => d.type === type);
  }

  list() { return [...this.descriptors.values()]; }

  /** UI 用的状态视图。 */
  statusView(context = {}) {
    return this.list().map((d) => ({
      ...d,
      enabled: this.isSessionEnabled(d.id, context),
      active: d.status === 'active' && this.isSessionEnabled(d.id, context)
    }));
  }

  /**
   * 该子扩展是否有**显式**启用配置（全局默认 / 会话覆盖 / v1 迁移期 config.skills）。
   * 没有显式配置时返回 false，由调用方决定默认值（例如试点包默认可见）。
   */
  hasExplicitConfig(id, context = {}) {
    const key = String(id);
    const dflt = getConfig()?.extensions?.defaults?.[key];
    if (dflt && typeof dflt === 'object' && dflt.enabled !== undefined) return true;

    const chatKey = context.chatKey || '';
    if (chatKey) {
      const scoped = effectiveConfigForChat(chatKey);
      const ov = scoped?.extensions?.overrides?.[key];
      if (ov && typeof ov === 'object' && ov.enabled !== undefined) return true;
    }

    // 迁移期兼容：v1 的 config.skills[id].enabled 仍然有效
    const legacy = getConfig()?.skills?.[key];
    if (legacy && typeof legacy === 'object' && legacy.enabled !== undefined) return true;
    return false;
  }

  /**
   * 会话级启用判定：读 overrides.extensions[id].enabled。
   * 未配置时回落到全局默认 config.extensions.defaults[id]，再回落到 v1 config.skills[id]。
   */
  isSessionEnabled(id, context = {}) {
    // 全局插件（scope=global）不能被单个会话关掉：它的界面/能力是全局的，
    // 半开半关会让控制台和实际行为对不上。开关只在全局配置里。
    if (String(this.descriptors.get(String(id))?.scope) === 'global') return true;
    const key = String(id);
    const chatKey = context.chatKey || '';
    if (chatKey) {
      const scoped = effectiveConfigForChat(chatKey);
      const ov = scoped?.extensions?.overrides?.[key];
      if (ov && typeof ov === 'object' && ov.enabled !== undefined) {
        return ov.enabled !== false;
      }
    }
    // 全局默认
    const dflt = getConfig()?.extensions?.defaults?.[key];
    if (dflt && typeof dflt === 'object' && dflt.enabled !== undefined) return dflt.enabled !== false;
    // 迁移期兼容：v1 命名空间
    const legacy = getConfig()?.skills?.[key];
    if (legacy && typeof legacy === 'object' && legacy.enabled !== undefined) return legacy.enabled !== false;
    // 无配置 = 默认关闭（新装不自动启用）
    return false;
  }

  /** 读取子扩展在当前作用域的设置（全局默认 + 会话覆盖合并）。 */
  settingsOf(id, context = {}) {
    const d = this.descriptors.get(String(id));
    if (!d) return {};
    const base = { ...(d.settings || {}) };
    const chatKey = context.chatKey || '';
    let scoped = null;
    if (chatKey) {
      scoped = effectiveConfigForChat(chatKey);
    } else {
      scoped = getConfig();
    }
    const ov = scoped?.extensions?.overrides?.[id];
    if (ov && typeof ov === 'object') {
      // 整份快照：会话一旦保存过 settings，就用这份完整值（不再跟随全局默认）
      if (ov.settings && typeof ov.settings === 'object') return { ...ov.settings };
      // 兼容早期扁平覆盖（只存差异字段）
      for (const [k, v] of Object.entries(ov)) {
        if (k !== 'enabled' && k !== 'settings' && v !== undefined) base[k] = v;
      }
    }
    return base;
  }

  clear() {
    this.descriptors.clear();
    this.managers.clear();
  }
}

// 模块级单例（与 skillManager 同生命周期）
export const extensionRegistry = new ExtensionDescriptorRegistry();
