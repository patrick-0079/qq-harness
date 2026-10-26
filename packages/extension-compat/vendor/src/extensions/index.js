// 扩展系统 v2 入口：微内核改造的核心模块。
//
// 目录结构：
//   types.js          — 六类扩展的纯数据类型闸门
//   registry.js       — 子扩展描述符注册表（会话级启用判定）
//   hook-bus.js       — 扩展 Hook 总线（20 个派发点 + 预算 + fail-open/close）
//   api.js            — 按类型裁剪的扩展 API（createExtensionApi）
//   tool-bridge.js    — registerToolAs 归属桥（子包工具注册）
//   prompt-inject.js  — 提示词注入锚点与改写契约
//
// 加载顺序：本模块不依赖任何管理器插件（bootstrap 铁律），
// 管理器插件在 app.js start() 阶段加载并往这里登记子扩展。

export { EXT_TYPES, VALID_TYPE_IDS, validateExports, validateManifest, typeOfDir, BUILTIN_PLUGIN_ALLOWLIST } from './types.js';
export { ExtensionDescriptorRegistry, extensionRegistry } from './registry.js';
export { ExtensionHookBus, extensionHookBus, HOOK_DEFINITIONS, VALID_HOOK_IDS } from './hook-bus.js';
export { createExtensionApi, onToolsChanged, notifyToolsChanged } from './api.js';
export { registerTool as registerToolAs, unregisterToolsByOwner } from './tool-bridge.js';
export {
  PROMPT_ANCHORS, REWRITE_TARGETS, VALID_ANCHORS, VALID_TARGETS,
  validateInjectDeclaration, validatePromptInjectExports, resolveRewriteConflicts
} from './prompt-inject.js';
