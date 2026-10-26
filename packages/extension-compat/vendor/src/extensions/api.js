// 按类型裁剪的扩展 API：createExtensionApi(type, id, permissions)。
//
// 与 plugin-loader 的 createSkillApi 的区别：
//   1. 按类型返回不同能力面（tool 拿 registerToolAs；plugin 拿 hook 注册；promptinject 什么都不拿）
//   2. registerToolAs(ownerId, def) 以子包身份注册工具，归属正确
//   3. fetch 走 safeFetch（不再是裸 globalThis.fetch）
//   4. notifyToolsChanged() 触发工具集刷新
//
// 六道闸门中的「运行时闸」：越界能力根本拿不到，调用即抛。

import { registerTool, unregisterToolsByOwner as _unregisterByOwner } from './tool-bridge.js';
import { extensionRegistry } from './registry.js';
import { extensionHookBus } from './hook-bus.js';
import { EXT_TYPES, validateExports } from './types.js';
import { docRegistry } from './doc-registry.js';
import { uiExtensionRegistry, UI_SLOTS } from './ui-registry.js';
import { registerTab, unregisterTabsByOwner, listTabs } from './tab-registry.js';
import { renderConfigDeep } from './template-vars.js';
import { registerPromptContributionSource, unregisterPromptContributionSource } from './prompt-pipeline.js';
import { safeFetch } from '../safe-fetch.js';
import { skillManager } from '../skills/manager.js';
import { listPersonaLibrary } from '../config.js';

let toolChangeListeners = new Set();

/** 注册一个「工具集已变化」监听（orchestrator 在启动时挂上以刷新 toolDefs）。 */
export function onToolsChanged(fn) {
  if (typeof fn === 'function') toolChangeListeners.add(fn);
  return () => toolChangeListeners.delete(fn);
}

/** 通知工具集已变化（MCP 连接后 / 懒加载 / 子扩展启用停用时调用）。 */
export function notifyToolsChanged(reason = '') {
  for (const fn of toolChangeListeners) {
    try { fn(reason); } catch { /* 监听异常不阻断通知链 */ }
  }
}

/**
 * 构造按类型裁剪的扩展 API。
 *
 * @param {string} typeId — 扩展类型（tool/plugin/knowledge/mcp/skill/promptinject）
 * @param {string} extId  — 扩展 id
 * @param {string[]} permissions — 权限白名单（如 ['web_fetch']）
 * @returns {object} 该类型的 API 面
 */
export function createExtensionApi(typeId, extId, permissions = [], { scope = 'global', builtin = false } = {}) {
  const gate = EXT_TYPES[typeId];
  if (!gate) throw new Error(`未知扩展类型：${typeId}`);

  const has = (name) => permissions.includes(name);
  const log = (...args) => console.log(`[ext:${extId}]`, ...args);
  const warn = (...args) => console.warn(`[ext:${extId}]`, ...args);

  const base = {
    log,
    warn,
    error: (...args) => console.error(`[ext:${extId}]`, ...args),
    // 人设库（只读，按 id 取正文）：与 v1 api.personaLibrary 同语义
    personaLibrary: () => listPersonaLibrary(),
    // 兼容 v1：查询别的 Skill 是否生效（迁移期保留，后续用 isExtensionEnabled 取代）
    isSkillActive: (id, ctx = {}) => { try { return skillManager.isActive(id, ctx).active; } catch { return false; } },
    // 本扩展设置（manifest.settings 默认值已合并）；与 v1 的 api.config() 同语义
    // 字符串值里的 `{{...}}` 在这里渲染 —— 扩展拿到的是"已转换"的值
    config: () => {
      try { return renderConfigDeep(skillManager.settingsOf(extId), { ownerId: extId }); } catch { return {}; }
    },
    utils: {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      safeJsonParse: (text, fallback = null) => {
        try { return JSON.parse(text); } catch { return fallback; }
      }
    }
  };

  // ── 工具注册通道 ──
  // tool 类型自己注册；plugin（管理器）为子包注册（owner 校验在 registry 里，
  // 只有 tool/mcp/skill 类型的子扩展能成为 owner）。
  if (gate.canRegisterTool || typeId === 'tool' || typeId === 'plugin') {
    base.registerToolAs = (ownerId, def) => {
      // owner 必须已在描述符表登记且类型允许注册工具
      const check = extensionRegistry.canOwnerRegisterTool(ownerId);
      if (!check.ok) throw new Error(check.reason);
      const actualId = registerTool(ownerId, def);
      return actualId;
    };
    base.unregisterToolsByOwner = (ownerId) => _unregisterByOwner(ownerId);
    base.notifyToolsChanged = notifyToolsChanged;
  }

  // ── plugin 类：可注册 hook 监听与能力提供 ──
  if (gate.canHook) {
    base.registerHook = ({ hook, fn, priority }) =>
      extensionHookBus.register({ ownerId: extId, hookId: hook, fn, priority });
    base.unregisterHook = (hookId = null) =>
      extensionHookBus.unregister(extId, hookId);
  }

  // ── plugin 类：可登记子扩展（管理器插件的权力）──
  if (typeId === 'plugin') {
    base.registerSubExtension = (descriptor) =>
      extensionRegistry.register({ ...descriptor, managerId: extId });
    base.unregisterSubExtension = (id) =>
      extensionRegistry.unregister(id);
    base.unregisterSubExtensionsByManager = () =>
      extensionRegistry.unregisterByManager(extId);
    base.listSubExtensions = (type) =>
      type ? extensionRegistry.listByType(type) : extensionRegistry.list();
    // 文档仓库：管理器写入 L2/L3，核心 load_doc 工具读取
    base.docRegistry = docRegistry;
    // 只追加的提示词贡献（知识库 L0/L1、工具目录等）；不能改写核心段落
    base.registerPromptContribution = (source) =>
      registerPromptContributionSource(extId, source);
    base.unregisterPromptContribution = () =>
      unregisterPromptContributionSource(extId);
    // UI 贡献与动作（管理器替子包登记；owner 校验由 ui-registry 做）
    // 只有全局插件能改界面：会话插件的作用域是"一个群"，而界面是全局渲染的，
    // 一旦某个会话关了它会留下"关了一半的界面"，所以这里直接拒绝。
    base.registerUIContribution = (contribution) => {
      if (String(scope) === 'session') throw new Error('会话级插件不能贡献界面（只有全局插件可以）');
      return uiExtensionRegistry.register({ ...contribution, ownerId: contribution.ownerId || extId });
    };
    base.registerUIAction = (action) => {
      if (String(scope) === 'session') throw new Error('会话级插件不能注册界面动作（只有全局插件可以）');
      return uiExtensionRegistry.registerAction({ ...action, ownerId: action.ownerId || extId });
    };
    base.uiSlots = () => Object.keys(UI_SLOTS);
    // 扩展仓库页签：管理器插件在 activate 里注册，deactivate/卸载时按 owner 自动撤销
    base.registerExtensionTab = (spec) => {
      if (String(scope) === 'session') throw new Error('会话级插件不能注册扩展仓库页签');
      // 插件自身没启用 → 不注册页签（页签随开关出现/消失）
      if (skillManager.isEnabled(extId) === false) return null;
      const r = registerTab(spec, { ownerId: extId, scope, builtin: Boolean(builtin) });
      if (!r.ok) throw new Error(r.error);
      return r.tab;
    };
    base.unregisterExtensionTab = () => unregisterTabsByOwner(extId);
    base.listExtensionTabs = () => listTabs();
    // 子扩展在"当前作用域"是否启用（无显式配置时返回 null，由调用方决定默认值）
    base.isExtensionEnabled = (id, chatKey = '') => {
      const d = extensionRegistry.get(id);
      if (!d) return null;
      if (!extensionRegistry.hasExplicitConfig(id, { chatKey })) return null;
      return extensionRegistry.isSessionEnabled(id, { chatKey });
    };
  }

  // ── 各类型都能查询描述符（只读）──
  base.getSubExtension = (id) => extensionRegistry.get(id);
  base.listExtensions = () => extensionRegistry.list();

  // ── 网络权限：只有声明了 web_fetch 才可用，且走 safeFetch ──
  base.fetch = has('web_fetch')
    ? async (url, options = {}) => {
        // SSRF 防护：URL 校验 + 限量读取
        const result = await safeFetch(url, options);
        return result;
      }
    : () => Promise.reject(new Error(`扩展 ${extId} 未声明 web_fetch 权限`));

  return base;
}

/**
 * 校验模块导出是否符合类型约束（加载器在 import 后调用）。
 * 这是六道闸门中的「静态闸」。
 */
export { validateExports };
