// Generated from the locally vendored extension runtime. Do not edit.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function createLegacyRuntime(__extensionHost) {
const module = { exports: {} }; const exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/extension-compat/bridge/entry.js
var entry_exports = {};
__export(entry_exports, {
  MULTI_PROVIDER_CAPABILITIES: () => MULTI_PROVIDER_CAPABILITIES,
  UI_SLOTS: () => UI_SLOTS,
  builtinModules: () => builtinModules,
  catalog: () => type_catalog_exports,
  createExtensionApi: () => createExtensionApi,
  dependencies: () => dependencies_exports,
  docRegistry: () => docRegistry,
  extensionCore: () => extensions_exports,
  extensionHookBus: () => extensionHookBus,
  extensionRegistry: () => extensionRegistry,
  fetch: () => safe_fetch_exports,
  importer: () => importer_exports,
  injection: () => prompt_inject_exports,
  knowledge: () => tree_exports,
  loadPlugins: () => loadPlugins,
  manifests: () => manifest_exports,
  onToolsChanged: () => onToolsChanged,
  prompt: () => prompt_pipeline_exports,
  sandbox: () => sandbox_exports,
  settings: () => config_exports,
  skillManager: () => skillManager,
  stale: () => stale_exports,
  summaries: () => ensure_exports,
  tabs: () => tab_registry_exports,
  tools: () => tool_registry_exports,
  types: () => types_exports,
  ui: () => ui_registry_exports,
  uiExtensionRegistry: () => uiExtensionRegistry,
  unloadSkill: () => unloadSkill,
  validation: () => validate_exports,
  variables: () => template_vars_exports,
  watchPlugins: () => watchPlugins,
  zip: () => zip_install_exports
});
module.exports = __toCommonJS(entry_exports);

// packages/extension-compat/vendor/src/tool-registry.js
var tool_registry_exports = {};
__export(tool_registry_exports, {
  CATEGORY_META: () => CATEGORY_META,
  availabilityOf: () => availabilityOf,
  clearRegistry: () => clearRegistry,
  getTool: () => getTool,
  getToolAvailability: () => getToolAvailability,
  isToolEnabledLegacy: () => isToolEnabledLegacy,
  listAvailableTools: () => listAvailableTools,
  listCategories: () => listCategories,
  listTools: () => listTools,
  listToolsByCategory: () => listToolsByCategory,
  registerTool: () => registerTool,
  skillErrorText: () => skillErrorText,
  unregisterTool: () => unregisterTool,
  unregisterToolsBySkill: () => unregisterToolsBySkill
});

// packages/extension-compat/vendor/src/skills/errors.js
var SKILL_ERROR = {
  NOT_FOUND: "skill-not-found",
  NOT_LOADED: "skill-not-loaded",
  DISABLED: "skill-disabled",
  UNAVAILABLE: "skill-unavailable",
  TIMEOUT: "skill-timeout",
  CAPABILITY_MISSING: "capability-missing",
  DEPENDENCY_MISSING: "dependency-missing",
  DEPENDENCY_SCOPE_INVALID: "dependency-scope-invalid",
  DEPENDENCY_CYCLE: "dependency-cycle"
};
var REASON_TEXT = {
  [SKILL_ERROR.NOT_FOUND]: "Skill \u4E0D\u5B58\u5728",
  [SKILL_ERROR.NOT_LOADED]: "Skill \u52A0\u8F7D\u5931\u8D25",
  [SKILL_ERROR.DISABLED]: "Skill \u672A\u542F\u7528",
  [SKILL_ERROR.UNAVAILABLE]: "Skill \u4F9D\u8D56\u4E0D\u6EE1\u8DB3",
  [SKILL_ERROR.TIMEOUT]: "Skill \u6267\u884C\u8D85\u65F6",
  [SKILL_ERROR.CAPABILITY_MISSING]: "\u7F3A\u5C11\u6240\u9700\u80FD\u529B",
  [SKILL_ERROR.DEPENDENCY_MISSING]: "\u7F3A\u5C11\u4F9D\u8D56\u63D2\u4EF6",
  [SKILL_ERROR.DEPENDENCY_SCOPE_INVALID]: "\u4F9D\u8D56\u4F5C\u7528\u57DF\u975E\u6CD5",
  [SKILL_ERROR.DEPENDENCY_CYCLE]: "\u63D2\u4EF6\u4F9D\u8D56\u6210\u73AF"
};
var SkillError = class extends Error {
  constructor(code, message, detail = null) {
    super(message || REASON_TEXT[code] || code);
    this.name = "SkillError";
    this.code = code;
    this.detail = detail;
  }
};
function skillErrorText(code) {
  return REASON_TEXT[code] || code;
}

// packages/extension-compat/vendor/src/skills/registry.js
var SkillRegistry = class {
  constructor() {
    this.skills = /* @__PURE__ */ new Map();
    this.order = [];
  }
  /**
   * 注册一个 Skill。重复 id 覆盖（热重载场景），并保留原注册顺序。
   * @returns {{ok: boolean, replaced: boolean, error?: string}}
   */
  register(skill) {
    if (!skill?.manifest?.id) return { ok: false, replaced: false, error: "\u7F3A\u5C11 manifest.id" };
    const id = skill.manifest.id;
    const replaced = this.skills.has(id);
    if (!replaced) this.order.push(id);
    this.skills.set(id, skill);
    return { ok: true, replaced };
  }
  unregister(id) {
    const existed = this.skills.delete(id);
    if (existed) this.order = this.order.filter((x) => x !== id);
    return existed;
  }
  get(id) {
    return this.skills.get(String(id)) ?? null;
  }
  has(id) {
    return this.skills.has(String(id));
  }
  /** 按注册顺序返回全部 Skill。 */
  list() {
    return this.order.map((id) => this.skills.get(id)).filter(Boolean);
  }
  get size() {
    return this.skills.size;
  }
  /** 清空（测试/热重载用）。返回被清空的 id 列表，便于调用方逐个 dispose。 */
  clear() {
    const ids = [...this.order];
    this.skills.clear();
    this.order = [];
    return ids;
  }
};

// packages/extension-compat/vendor/src/skills/capabilities.js
var CapabilityRegistry = class {
  constructor() {
    this.providers = /* @__PURE__ */ new Map();
  }
  /** 注册一个能力提供者。ownerId 用于卸载时批量清理。 */
  provide(capability, ownerId, provider) {
    const cap = String(capability || "").trim();
    if (!cap) return false;
    const isFn = typeof provider === "function";
    const isObj = provider !== null && typeof provider === "object";
    const isPlaceholder = provider === null;
    if (!isFn && !isObj && !isPlaceholder) return false;
    const list = this.providers.get(cap) || [];
    const idx = list.findIndex((p) => p.ownerId === ownerId);
    const entry = { ownerId, provider };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    this.providers.set(cap, list);
    return true;
  }
  /** 某个能力的所有提供者（注册顺序）。 */
  providersOf(capability) {
    return [...this.providers.get(String(capability)) || []];
  }
  has(capability) {
    return (this.providers.get(String(capability)) || []).length > 0;
  }
  /** 已注册的全部能力名。 */
  list() {
    return [...this.providers.keys()];
  }
  /** 移除某个 owner 的所有能力（Skill 卸载时调用）。 */
  removeOwner(ownerId) {
    let removed = 0;
    for (const [cap, list] of this.providers) {
      const next = list.filter((p) => p.ownerId !== ownerId);
      removed += list.length - next.length;
      if (next.length) this.providers.set(cap, next);
      else this.providers.delete(cap);
    }
    return removed;
  }
  clear() {
    const count = [...this.providers.values()].reduce((a, l) => a + l.length, 0);
    this.providers.clear();
    return count;
  }
};

// packages/extension-compat/vendor/src/skills/config.js
var config_exports = {};
__export(config_exports, {
  clearSkillDefaultOff: () => clearSkillDefaultOff,
  getSkillConfig: () => getSkillConfig,
  getSkillConfigFrom: () => getSkillConfigFrom,
  getSkillConfigGlobal: () => getSkillConfigGlobal,
  isSkillEnabledGlobal: () => isSkillEnabledGlobal,
  isSkillEnabledInConfig: () => isSkillEnabledInConfig,
  isSkillEnabledInConfigFor: () => isSkillEnabledInConfigFor,
  isSkillForcedDefaultOff: () => isSkillForcedDefaultOff,
  listConfiguredSkillIds: () => listConfiguredSkillIds,
  markSkillDefaultOff: () => markSkillDefaultOff,
  setSkillConfig: () => setSkillConfig,
  setSkillEnabled: () => setSkillEnabled
});

// packages/extension-compat/bridge/config.js
var ROOT = __extensionHost.root;
var DATA_DIR = __extensionHost.dataDir;
var getConfig = () => __extensionHost.view();
var getGlobalConfig = () => __extensionHost.global();
var updateConfig = (patch) => __extensionHost.update(patch);
var listPersonaLibrary = () => __extensionHost.personas();

// packages/extension-compat/vendor/src/skills/config.js
var forcedDefaultOff = /* @__PURE__ */ new Set();
function markSkillDefaultOff(id) {
  forcedDefaultOff.add(String(id));
}
function clearSkillDefaultOff(id) {
  forcedDefaultOff.delete(String(id));
}
function isSkillForcedDefaultOff(id) {
  return forcedDefaultOff.has(String(id));
}
function getSkillConfigFrom(cfg6, id, defaults = {}) {
  const raw = cfg6?.skills?.[String(id)];
  const merged = { ...defaults || {} };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (v !== void 0) merged[k] = v;
    }
  }
  return merged;
}
function getSkillConfig(id, defaults = {}) {
  return getSkillConfigFrom(getConfig(), id, defaults);
}
function isSkillEnabledInConfigFor(cfg6, id, enabledByDefault = true) {
  const key = String(id);
  if (forcedDefaultOff.has(key)) return false;
  const raw = cfg6?.skills?.[key];
  if (!raw || raw.enabled === void 0) return enabledByDefault !== false;
  return raw.enabled !== false;
}
function isSkillEnabledInConfig(id, enabledByDefault = true) {
  return isSkillEnabledInConfigFor(getConfig(), id, enabledByDefault);
}
function getSkillConfigGlobal(id, defaults = {}) {
  return getSkillConfigFrom(getGlobalConfig(), id, defaults);
}
function isSkillEnabledGlobal(id, enabledByDefault = true) {
  return isSkillEnabledInConfigFor(getGlobalConfig(), id, enabledByDefault);
}
function setSkillConfig(id, patch) {
  const key = String(id);
  if (patch && patch.enabled === true) forcedDefaultOff.delete(key);
  const current = getConfig()?.skills?.[key];
  const next = { ...current && typeof current === "object" ? current : {}, ...patch || {} };
  const cfg6 = updateConfig({ skills: { [key]: next } });
  return cfg6.skills?.[key] || next;
}
function setSkillEnabled(id, enabled) {
  return setSkillConfig(id, { enabled: !!enabled });
}
function listConfiguredSkillIds() {
  const skills = getConfig()?.skills;
  if (!skills || typeof skills !== "object") return [];
  return Object.keys(skills);
}

// packages/extension-compat/vendor/src/skills/manager.js
var DEFAULT_HOOK_TIMEOUT_MS = 5e3;
var MULTI_PROVIDER_CAPABILITIES = /* @__PURE__ */ new Set([
  "llm.request-params",
  "llm.response",
  "llm.usage",
  "llm.retry-advisor",
  "tool.guard",
  "media.download",
  // 运行前闸门：谁有理由说"这一轮别跑"都可以挂一道（如"机器人已下线"），
  // 多个提供者依次问，任一说跳过即跳过（见 orchestrator 的 #wakeInner）。
  "chat.skip-run"
]);
function hydrateConfigSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
  const entries = Object.entries(schema);
  if (!entries.some(([, f]) => f && f.optionsSource === "personas")) return schema;
  let lib = null;
  const out = { ...schema };
  for (const [key, field] of entries) {
    if (!field || typeof field !== "object" || field.optionsSource !== "personas") continue;
    if (!lib) lib = listPersonaLibrary();
    out[key] = {
      ...field,
      values: lib.map((p) => p.id),
      labels: Object.fromEntries(lib.map((p) => [p.id, p.name]))
    };
  }
  return out;
}
var SkillManager = class {
  constructor({ log: log6 = () => {
  } } = {}) {
    this.registry = new SkillRegistry();
    this.capabilities = new CapabilityRegistry();
    this.log = log6;
    this.hookTimeoutMs = DEFAULT_HOOK_TIMEOUT_MS;
    this.errors = /* @__PURE__ */ new Map();
  }
  setLog(fn) {
    if (typeof fn === "function") this.log = fn;
  }
  // ── 注册 / 卸载 ──────────────────────────────────────────────────────────
  /**
   * 注册一个 Skill。
   * @param {object} skill 见文件头部的实例形状说明
   * @returns {{ok: boolean, id: string, error?: string}}
   */
  register(skill) {
    const id = skill?.manifest?.id;
    if (!id) return { ok: false, id: "", error: "\u7F3A\u5C11 manifest.id" };
    const prev = this.registry.get(id);
    if (prev) {
      this.#safeCall(prev, "deactivate", { reason: "reload" });
      if (typeof prev.dispose === "function") {
        try {
          prev.dispose();
        } catch (error) {
          this.#warn(id, "dispose \u5931\u8D25", error);
        }
      }
    }
    this.capabilities.removeOwner(id);
    const r = this.registry.register(skill);
    if (!r.ok) return { ok: false, id, error: r.error };
    for (const [cap, fn] of Object.entries(skill.providers || {})) {
      if (typeof fn === "function") this.capabilities.provide(cap, id, fn);
    }
    for (const cap of skill.manifest.capabilities || []) {
      if (!Object.prototype.hasOwnProperty.call(skill.providers || {}, cap)) {
        this.capabilities.provide(cap, id, null);
      }
    }
    return { ok: true, id, replaced: r.replaced };
  }
  /** 注销 Skill（热重载 / 卸载）。会先 deactivate 再 dispose。 */
  unregister(id, context = {}) {
    const skill = this.registry.get(id);
    if (!skill) return false;
    this.#safeCall(skill, "deactivate", context);
    this.#safeCall(skill, "dispose");
    this.capabilities.removeOwner(id);
    this.registry.unregister(id);
    this.errors.delete(id);
    return true;
  }
  /**
   * 让"注册表内容"与"磁盘上实际存在的 Skill"对齐：
   * 卸载掉已经不在磁盘上的（开发期删目录 / 改名），避免幽灵工具与能力残留。
   * @param {string[]} aliveIds 本次扫描到的全部 id
   * @returns {string[]} 被卸掉的 id
   */
  pruneMissing(aliveIds = [], context = {}) {
    const alive = new Set(aliveIds.map(String));
    const removed = [];
    for (const skill of this.registry.list()) {
      const id = skill?.manifest?.id;
      if (id && !alive.has(id)) {
        this.unregister(id, { ...context, reason: "pruned" });
        removed.push(id);
      }
    }
    return removed;
  }
  // ── 状态查询 ────────────────────────────────────────────────────────────
  isLoaded(id) {
    const skill = this.registry.get(id);
    return Boolean(skill) && skill.loadError == null;
  }
  isEnabled(id) {
    const skill = this.registry.get(id);
    const dflt = skill?.manifest?.enabledByDefault !== false;
    if (String(skill?.manifest?.scope || "global") === "global") return isSkillEnabledGlobal(id, dflt);
    return isSkillEnabledInConfig(id, dflt);
  }
  /**
   * 依赖是否满足。递归检查 requires（带 visited 防环）。
   * Skill 可以自定义 available(ctx) 返回 boolean 或 { ok, reason }。
   */
  isAvailable(id, context = {}, visited = /* @__PURE__ */ new Set(), depStack = /* @__PURE__ */ new Set()) {
    const skill = this.registry.get(id);
    if (!skill) return { ok: false, code: SKILL_ERROR.NOT_FOUND, reason: skillErrorText(SKILL_ERROR.NOT_FOUND) };
    if (skill.loadError) {
      return { ok: false, code: SKILL_ERROR.NOT_LOADED, reason: skill.loadError };
    }
    if (depStack.has(id)) {
      return {
        ok: false,
        code: SKILL_ERROR.DEPENDENCY_CYCLE,
        reason: `\u63D2\u4EF6\u4F9D\u8D56\u6210\u73AF\uFF1A${[...depStack, id].join(" \u2192 ")}`
      };
    }
    const nextStack = new Set(depStack).add(id);
    const manifest = skill.manifest || {};
    const scope = String(manifest.scope || "global");
    for (const depId of manifest.dependsOn || []) {
      const dep = this.registry.get(depId);
      if (!dep) {
        return {
          ok: false,
          code: SKILL_ERROR.DEPENDENCY_MISSING,
          reason: `\u7F3A\u5C11\u4F9D\u8D56\u63D2\u4EF6\uFF1A${depId}`
        };
      }
      const depScope = String(dep.manifest?.scope || "global");
      if (scope === "global" && depScope === "session") {
        return {
          ok: false,
          code: SKILL_ERROR.DEPENDENCY_SCOPE_INVALID,
          reason: `\u5168\u5C40\u63D2\u4EF6\u4E0D\u80FD\u4F9D\u8D56\u4F1A\u8BDD\u63D2\u4EF6\uFF1A${depId}`
        };
      }
      const depStatus = this.isActive(depId, context, new Set(visited), nextStack);
      if (!depStatus.active) {
        return {
          ok: false,
          code: SKILL_ERROR.DEPENDENCY_MISSING,
          reason: `\u4F9D\u8D56\u63D2\u4EF6\u4E0D\u53EF\u7528\uFF1A${depId}\uFF08${depStatus.reason || depStatus.code}\uFF09`
        };
      }
    }
    if (visited.has(id)) return { ok: true, code: null, reason: "" };
    visited.add(id);
    for (const cap of skill.manifest.requires || []) {
      const providers = this.capabilities.providersOf(cap);
      if (!providers.length) {
        return {
          ok: false,
          code: SKILL_ERROR.CAPABILITY_MISSING,
          reason: `\u7F3A\u5C11\u80FD\u529B\uFF1A${cap}`,
          detail: { capability: cap }
        };
      }
      const usable = providers.some((p) => {
        if (p.ownerId === id) return false;
        return this.isActive(p.ownerId, context, visited).active;
      });
      if (!usable) {
        return {
          ok: false,
          code: SKILL_ERROR.CAPABILITY_MISSING,
          reason: `\u80FD\u529B\u63D0\u4F9B\u8005\u4E0D\u53EF\u7528\uFF1A${cap}`,
          detail: { capability: cap }
        };
      }
    }
    if (typeof skill.available === "function") {
      try {
        const r = skill.available(context);
        if (r === false) {
          return { ok: false, code: SKILL_ERROR.UNAVAILABLE, reason: skill.availableReason || "\u81EA\u68C0\u672A\u901A\u8FC7\uFF08\u70B9 \u2699 \u68C0\u67E5\u914D\u7F6E\uFF09" };
        }
        if (r && typeof r === "object" && r.ok === false) {
          return { ok: false, code: SKILL_ERROR.UNAVAILABLE, reason: String(r.reason || "\u81EA\u68C0\u672A\u901A\u8FC7\uFF08\u70B9 \u2699 \u68C0\u67E5\u914D\u7F6E\uFF09"), detail: r.detail };
        }
      } catch (error) {
        return { ok: false, code: SKILL_ERROR.UNAVAILABLE, reason: `\u81EA\u68C0\u5F02\u5E38\uFF1A${error?.message ?? error}` };
      }
    }
    return { ok: true, code: null, reason: "" };
  }
  /**
   * 最终是否实际生效：loaded && enabled && available && 依赖满足。
   * 这里是所有"这个功能能不能用"判断的唯一出口。
   */
  isActive(id, context = {}, visited = /* @__PURE__ */ new Set(), depStack = /* @__PURE__ */ new Set()) {
    if (!this.isLoaded(id)) {
      const avail2 = this.isAvailable(id, context, visited, depStack);
      return { active: false, code: avail2.code || SKILL_ERROR.NOT_LOADED, reason: avail2.reason || skillErrorText(SKILL_ERROR.NOT_LOADED) };
    }
    if (!this.isEnabled(id)) {
      return { active: false, code: SKILL_ERROR.DISABLED, reason: skillErrorText(SKILL_ERROR.DISABLED) };
    }
    const avail = this.isAvailable(id, context, visited, depStack);
    if (!avail.ok) return { active: false, code: avail.code, reason: avail.reason, detail: avail.detail };
    return { active: true, code: null, reason: "" };
  }
  /** UI 用的完整状态列表。 */
  list(context = {}) {
    return this.registry.list().map((skill) => this.status(skill.manifest.id, context));
  }
  status(id, context = {}) {
    const skill = this.registry.get(id);
    if (!skill) {
      return {
        id: String(id),
        name: String(id),
        loaded: false,
        enabled: false,
        available: false,
        active: false,
        code: SKILL_ERROR.NOT_FOUND,
        reason: skillErrorText(SKILL_ERROR.NOT_FOUND)
      };
    }
    const m = skill.manifest;
    const enabled = this.isEnabled(id);
    const a = this.isActive(id, context);
    const missing = (m.requires || []).filter((cap) => !this.capabilities.has(cap));
    const missingPlugins = (m.dependsOn || []).filter((depId) => !this.registry.get(depId));
    const availCheck = this.isAvailable(id, context);
    const needsConfig = !skill.loadError && !availCheck.ok && availCheck.code === SKILL_ERROR.UNAVAILABLE;
    const depCodes = [SKILL_ERROR.DEPENDENCY_MISSING, SKILL_ERROR.DEPENDENCY_SCOPE_INVALID, SKILL_ERROR.DEPENDENCY_CYCLE];
    const missingDeps = !skill.loadError && !availCheck.ok && (availCheck.code === SKILL_ERROR.CAPABILITY_MISSING || depCodes.includes(availCheck.code));
    return {
      id: m.id,
      name: m.name,
      version: m.version,
      apiVersion: m.apiVersion,
      // 全局插件（plugins/）还是会话级插件（chat-plugins/）：仓库页按它分两个页签
      scope: m.scope || "global",
      type: m.type || null,
      category: m.category,
      description: m.description,
      deprecated: m.deprecated,
      source: skill.source || "skill",
      // 目录语义类型 + 所在目录（仓库相对路径）：
      //   kind = 'plugin' 确定性型（能力/钩子，必然触发）
      //   kind = 'skill'  LLM 型（注册工具，模型决定）
      // 放这里而不是让调用方按清单**文件名**去猜目录 —— "文件名"与"目录语义"是两件事，
      // 混用会在改名/挪目录时静默判错（审计脚本原来就是这么脆的）。
      kind: skill.kind || null,
      dir: skill.relDir || "",
      hasSettings: Object.keys(m.settings || {}).length > 0 || Object.keys(m.configSchema || {}).length > 0,
      loaded: !skill.loadError,
      // loadError：本次加载失败的具体原因（清单/入口/setup 抛错）。
      // UI 据此渲染"加载失败"徽章与红色原因行 —— 失败条目现在也会注册进表，
      // 不再表现为"条目凭空消失"。
      loadError: skill.loadError || "",
      enabled,
      available: a.active || ![
        SKILL_ERROR.UNAVAILABLE,
        SKILL_ERROR.CAPABILITY_MISSING,
        SKILL_ERROR.NOT_FOUND,
        SKILL_ERROR.DEPENDENCY_MISSING,
        SKILL_ERROR.DEPENDENCY_SCOPE_INVALID,
        SKILL_ERROR.DEPENDENCY_CYCLE
      ].includes(a.code),
      active: a.active,
      code: a.code,
      reason: a.reason,
      lastError: this.errors.get(id) || "",
      capabilities: [...m.capabilities || []],
      // implementedCapabilities：代码里**实际实现**的能力（providers 的键）。
      // 与声明的 capabilities 对比能发现两类静默故障：
      //   · 声明了但没实现 → 调用方拿到空数组，功能悄悄失效
      //   · 实现了但没声明 → 用户看不出它提供什么，也可能被别人重复实现
      // 放进视图（而不是只写在测试里），是为了让 UI 也能显示成警告。
      implementedCapabilities: Object.keys(skill.providers || {}),
      // 该模块注册的行为钩子名（确定性型常见形态：靠钩子插进主流程）
      hooks: Object.keys(skill.hooks || {}),
      // 当前设置值（密文已脱敏）与字段描述 —— UI 靠这两个渲染"技能设置"弹窗。
      // 放在列表里而不是让前端再发一次请求：技能页本来就要拉一次列表。
      settings: this.settingsView(id),
      configSchema: hydrateConfigSchema(m.configSchema && typeof m.configSchema === "object" ? m.configSchema : {}),
      requires: [...m.requires || []],
      dependsOn: [...m.dependsOn || []],
      optionalDependsOn: [...m.optionalDependsOn || []],
      missingPlugins,
      missingRequires: missing,
      // 仓库页提示（与启停无关）：需要先填配置 / 缺少依赖提供者/插件
      needsConfig,
      configReason: needsConfig ? String(availCheck.reason || "\u9700\u8981\u5148\u586B\u5199\u914D\u7F6E") : "",
      missingDeps,
      depsReason: missingDeps ? String(availCheck.reason || "") : "",
      dependencyReason: depCodes.includes(availCheck.code) ? String(availCheck.reason || "") : "",
      toolIds: [...skill.toolIds || []]
    };
  }
  // ── 开关 ────────────────────────────────────────────────────────────────
  /**
   * 开启 Skill 并调用 activate 生命周期。
   * 配置写入由调用方（routes）负责，这里只管生命周期回调，
   * 避免"改配置"和"跑回调"两件事耦合在一个函数里。
   */
  activate(id, context = {}) {
    const skill = this.registry.get(id);
    if (!skill) throw new SkillError(SKILL_ERROR.NOT_FOUND, `Skill \u4E0D\u5B58\u5728\uFF1A${id}`);
    this.#safeCall(skill, "activate", context);
    return true;
  }
  deactivate(id, context = {}) {
    const skill = this.registry.get(id);
    if (!skill) return false;
    this.#safeCall(skill, "deactivate", context);
    return true;
  }
  /** 当前配置下的 Skill 设置（已合并 manifest 默认值）。 */
  settingsOf(id) {
    const skill = this.registry.get(id);
    if (!skill) return {};
    if (String(skill.manifest?.scope || "global") === "global") {
      return getSkillConfigGlobal(id, skill.manifest.settings || {});
    }
    return getSkillConfig(id, skill.manifest.settings || {});
  }
  // ── 能力 ────────────────────────────────────────────────────────────────
  /**
   * 技能的对外设置视图（给 UI 渲染表单用）。
   *
   * 密文字段（configSchema 里标了 secret: true）脱敏成 '******'：
   * 设置接口会把整个配置回给前端，明文 Key/Cookie 不该出现在响应里。
   * 写入侧约定：收到 '******' 或空串表示"不修改"，保持原值
   * —— 否则用户只是打开表单点了保存，密文就被覆盖成六个星号了。
   *
   * ⚠️ secret 判定还必须**下钻一层**（2026-09-26 审查二轮发现）：
   *   ① 字段名兜底：manifest 作者忘了在 configSchema 标 secret 时，
   *      名字命中 /key|token|secret|cookie|password/i 的字符串字段同样脱敏
   *      —— skills/web-fetch 的 cookie（type=internal，无 secret 标记）曾把
   *      SESSDATA 明文回传给浏览器。
   *   ② 数组内对象：plugins/account-pool 的 settings.accounts[].key 存的是
   *      真实 API Key，字段在数组第二层，顶层判 secret 永远罩不住它。
   *      数组里的条目按"字段名含 key/token/secret/password 的字符串值"逐个
   *      掩码（cookie 不掩：数组里没有这种形态，过度掩码会破坏 UI 结构）。
   */
  settingsView(id) {
    const skill = this.registry.get(id);
    if (!skill) return {};
    const values = this.settingsOf(id);
    const schema = skill.manifest.configSchema || {};
    const SECRET_NAME_RE = /key|token|secret|password|cookie/i;
    const mask = (v) => String(v ?? "").trim() ? "******" : "";
    const isSecretField = (k) => Boolean(schema[k]?.secret) || SECRET_NAME_RE.test(k) && typeof values[k] === "string";
    const out = {};
    for (const [k, v] of Object.entries(values)) {
      if (isSecretField(k)) {
        out[k] = mask(v);
        continue;
      }
      if (Array.isArray(v)) {
        out[k] = v.map((item) => {
          if (!item || typeof item !== "object") return item;
          const clone = { ...item };
          for (const [ik, iv] of Object.entries(clone)) {
            if (SECRET_NAME_RE.test(ik) && typeof iv === "string" && iv.trim()) clone[ik] = "******";
          }
          return clone;
        });
        continue;
      }
      out[k] = v;
    }
    return out;
  }
  /**
   * 该能力是否有**真实实现**的提供者（占位登记不算）。
   * 语义对齐 getCapabilityProviders：两边都以"能用"为准，
   * 避免出现"hasCapability 说能、取提供者却是空"的口径分裂。
   */
  hasCapability(capability) {
    return this.getCapabilityProviders(capability).length > 0;
  }
  /** 取所有**生效中**的能力提供者。context 用于可用性判断。 */
  getCapabilityProviders(capability, context = {}) {
    return this.capabilities.providersOf(capability).filter((p) => p.provider !== null && p.provider !== void 0).filter((p) => this.isActive(p.ownerId, context).active).map((p) => ({ skillId: p.ownerId, fn: p.provider }));
  }
  /** 明确列出能力的不可用原因（UI/排障用）。 */
  explainCapability(capability, context = {}) {
    const all = this.capabilities.providersOf(capability);
    if (!all.length) {
      return { available: false, reason: `\u6CA1\u6709\u4EFB\u4F55 Skill \u63D0\u4F9B\u80FD\u529B\uFF1A${capability}`, providers: [] };
    }
    const details = all.map((p) => {
      const a = this.isActive(p.ownerId, context);
      const implemented = p.provider !== null && p.provider !== void 0;
      return {
        skillId: p.ownerId,
        active: a.active,
        code: a.code,
        reason: a.reason,
        implemented,
        usable: a.active && implemented
      };
    });
    const anyUsable = details.some((d) => d.usable);
    let reason = "";
    if (!anyUsable) {
      reason = details.map((d) => d.implemented ? `${d.skillId}\uFF1A${d.reason || "\u4E0D\u53EF\u7528"}` : `${d.skillId}\uFF1A\u58F0\u660E\u4E86\u80FD\u529B ${capability} \u4F46\u672A\u63D0\u4F9B\u5B9E\u73B0`).join("\uFF1B") || "\u63D0\u4F9B\u8005\u5747\u4E0D\u53EF\u7528";
    }
    return { available: anyUsable, reason, providers: details };
  }
  // ── 扩展点 ──────────────────────────────────────────────────────────────
  /**
   * 顺序执行某个 hook。错误隔离：单个 Skill 抛错只记日志，不影响其它 Skill；
   * 超时同样跳过（Promise.race + unref 定时器，不阻塞进程退出）。
   */
  async runHook(name, context = {}) {
    const results = [];
    for (const skill of this.registry.list()) {
      const fn = skill.hooks?.[name];
      if (typeof fn !== "function") continue;
      const st = this.isActive(skill.manifest.id, context);
      if (!st.active) continue;
      try {
        const out = await this.#withTimeout(fn(context, { skillId: skill.manifest.id }), skill.manifest.id);
        if (out !== void 0) results.push({ skillId: skill.manifest.id, value: out });
      } catch (error) {
        this.#warn(skill.manifest.id, `hook ${name} \u5931\u8D25`, error);
      }
    }
    return results;
  }
  /**
   * 收集提示词片段。priority 降序（数字大的更靠前），
   * 且一律排在核心系统提示词之后由 prompt.js 决定插入位置。
   */
  getPromptSections(context = {}) {
    const out = [];
    for (const skill of this.registry.list()) {
      const st = this.isActive(skill.manifest.id, context);
      if (!st.active) continue;
      const sections = skill.manifest.prompt?.sections || [];
      for (const s of sections) out.push({ ...s, skillId: skill.manifest.id });
      if (typeof skill.promptSections === "function") {
        try {
          const dyn = skill.promptSections(context);
          for (const s of dyn || []) {
            if (!s?.content) continue;
            out.push({
              id: String(s.id || `${skill.manifest.id}-dynamic`),
              title: String(s.title || ""),
              content: String(s.content),
              priority: Math.min(99, Number(s.priority) || 40),
              skillId: skill.manifest.id
            });
          }
        } catch (error) {
          this.#warn(skill.manifest.id, "promptSections \u5931\u8D25", error);
        }
      }
    }
    const byId = /* @__PURE__ */ new Map();
    for (const s of out) byId.set(s.id, s);
    return [...byId.values()].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }
  /** LLM 请求参数转换器（按注册顺序串行，后者能看到前者的输出）。 */
  getRequestTransforms(context = {}) {
    return this.getCapabilityProviders("llm.request-params", context).map((p) => p.fn);
  }
  /** LLM 响应转换器。 */
  getResponseTransforms(context = {}) {
    return this.getCapabilityProviders("llm.response", context).map((p) => p.fn);
  }
  /** LLM usage 附加统计（如 reasoning tokens）。 */
  getUsageTransforms(context = {}) {
    return this.getCapabilityProviders("llm.usage", context).map((p) => p.fn);
  }
  /**
   * 请求失败后是否可以"换个姿势重试"。
   * Skill 只给建议，真正的重试仍由 llm.js 执行 —— 这样超时、abort、
   * 计费、日志、fallback 模型都不会被绕过。
   */
  getRetryAdvisors(context = {}) {
    return this.getCapabilityProviders("llm.retry-advisor", context).map((p) => ({ fn: p.fn, skillId: p.skillId }));
  }
  /** 工具可用性附加判断器：Skill 可以否决自己注册的工具。 */
  getToolGuards(context = {}) {
    return this.getCapabilityProviders("tool.guard", context).map((p) => ({ fn: p.fn, skillId: p.skillId }));
  }
  // ── 汇总 ────────────────────────────────────────────────────────────────
  /** 给 /api/status 用的紧凑摘要。 */
  summary(context = {}) {
    const list = this.list(context);
    return {
      total: list.length,
      active: list.filter((s) => s.active).length,
      disabled: list.filter((s) => s.loaded && !s.enabled).length,
      broken: list.filter((s) => !s.loaded).length,
      capabilities: this.capabilities.list().sort()
    };
  }
  /** 记录一个 Skill 的运行期错误（UI 展示"上次出错"）。 */
  recordError(id, error) {
    const msg = String(error?.message ?? error ?? "").slice(0, 300);
    if (msg) this.errors.set(String(id), msg);
  }
  #warn(id, message, error) {
    const text = `[skill:${id}] ${message}\uFF1A${error?.message ?? error}`;
    try {
      this.log(text);
    } catch {
    }
    this.recordError(id, error);
  }
  #safeCall(skill, method, arg) {
    const fn = skill?.[method];
    if (typeof fn !== "function") return;
    try {
      fn(arg);
    } catch (error) {
      this.#warn(skill.manifest.id, `${method} \u5931\u8D25`, error);
    }
  }
  #withTimeout(promise, id) {
    if (!this.hookTimeoutMs || !Number.isFinite(this.hookTimeoutMs)) return promise;
    let timer = null;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new SkillError(SKILL_ERROR.TIMEOUT, `Skill ${id} \u6267\u884C\u8D85\u65F6\uFF08${this.hookTimeoutMs}ms\uFF09`)), this.hookTimeoutMs);
    });
    return Promise.race([promise, guard]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
};
var skillManager = new SkillManager();

// packages/extension-compat/vendor/src/extensions/types.js
var types_exports = {};
__export(types_exports, {
  BUILTIN_PLUGIN_ALLOWLIST: () => BUILTIN_PLUGIN_ALLOWLIST,
  EXT_TYPES: () => EXT_TYPES,
  SESSION_ALLOWED_HOOKS: () => SESSION_ALLOWED_HOOKS,
  VALID_TYPE_IDS: () => VALID_TYPE_IDS,
  canContributeUi: () => canContributeUi,
  isHookAllowed: () => isHookAllowed,
  typeOfDir: () => typeOfDir,
  validateExports: () => validateExports,
  validateManifest: () => validateManifest
});
var EXT_TYPES = {
  tool: {
    id: "tool",
    label: "\u5DE5\u5177",
    dir: "tools",
    manifest: "tool.json",
    // 允许的入口导出（静态闸：超出即 loadError）
    allowedExports: ["setup", "register", "available", "dispose", "vars"],
    // 禁止的导出（显式列出便于诊断）
    forbiddenExports: ["hooks", "providers", "activate", "deactivate", "promptSections"],
    canRegisterTool: true,
    canHook: false,
    canProvide: false,
    canInjectPrompt: false,
    executesCode: true,
    sandboxed: false,
    // 清单键白名单（null = 不限制；v1 兼容期先不限）
    manifestKeys: null,
    description: "\u53EA\u6CE8\u518C\u5DE5\u5177\u7684\u6269\u5C55\u3002\u4E0D\u53C2\u4E0E\u4EFB\u4F55\u751F\u547D\u5468\u671F\uFF0C\u7531\u6A21\u578B\u81EA\u884C\u51B3\u5B9A\u4F55\u65F6\u8C03\u7528\u3002"
  },
  plugin: {
    id: "plugin",
    label: "\u63D2\u4EF6",
    dir: "plugins",
    manifest: "plugin.json",
    allowedExports: ["setup", "register", "hooks", "providers", "activate", "deactivate", "dispose", "available", "promptSections", "vars"],
    forbiddenExports: [],
    canRegisterTool: false,
    canHook: true,
    canProvide: true,
    canInjectPrompt: false,
    // 提示词追加走 promptSections；改写归 promptinject
    executesCode: true,
    sandboxed: false,
    manifestKeys: null,
    description: "\u751F\u547D\u5468\u671F\u4E0E\u63A7\u5236\u9762\u3002\u6743\u529B\u6700\u5927\u2014\u2014\u4EC5\u9650\u968F\u5E94\u7528\u53D1\u5E03\u7684\u5185\u7F6E\u53EF\u4FE1\u63D2\u4EF6\u3002"
  },
  knowledge: {
    id: "knowledge",
    label: "\u77E5\u8BC6",
    dir: "knowledge",
    manifest: "knowledge.json",
    allowedExports: [],
    // 纯数据，不允许任何 JS 入口
    forbiddenExports: ["setup", "register", "hooks", "providers", "activate", "deactivate", "dispose", "promptSections"],
    canRegisterTool: false,
    canHook: false,
    canProvide: false,
    canInjectPrompt: false,
    executesCode: false,
    sandboxed: false,
    manifestKeys: null,
    description: "\u6587\u6863\u578B\u77E5\u8BC6\u3002L0 \u5E93\u6458\u8981 \u2192 L1 \u6A21\u5757\u7B80\u4ECB \u2192 L2 \u6587\u6863\u7B80\u4ECB \u2192 L3 \u539F\u6587\u3002\u7EAF\u6570\u636E\uFF0C\u4E0D\u6267\u884C\u4EE3\u7801\u3002"
  },
  mcp: {
    id: "mcp",
    label: "MCP",
    dir: "mcp",
    manifest: "mcp.json",
    allowedExports: [],
    // 纯配置
    forbiddenExports: ["setup", "register", "hooks", "providers", "activate", "deactivate", "dispose"],
    canRegisterTool: false,
    // 工具由宿主 MCP 客户端代理注册
    // mcp 工具由管理器以子扩展身份注册（宿主代理），因此允许成为工具 owner
    hostProxyTools: true,
    canHook: false,
    canProvide: false,
    canInjectPrompt: false,
    executesCode: false,
    sandboxed: false,
    manifestKeys: null,
    description: "\u5916\u90E8 MCP \u670D\u52A1\u58F0\u660E\u3002\u53EA\u8981\u6C42 mcp.json \u914D\u7F6E\u6587\u4EF6\uFF0C\u53EF\u9009\u9644 md \u8BF4\u660E\u3002"
  },
  skill: {
    id: "skill",
    label: "\u6280\u80FD",
    dir: "skills",
    manifest: "skill.json",
    allowedExports: [],
    // 脚本被沙箱调用，无 ESM 导出
    forbiddenExports: ["setup", "register", "hooks", "providers", "activate", "deactivate", "dispose"],
    canRegisterTool: false,
    // 模型只看到 skill_script_run，不看到独立工具
    // 沙箱脚本不直接注册工具；如需按脚本暴露工具，由管理器代理
    hostProxyTools: false,
    canHook: false,
    canProvide: false,
    canInjectPrompt: false,
    executesCode: true,
    sandboxed: true,
    manifestKeys: null,
    description: "\u6C99\u7BB1\u811A\u672C\u3002\u6A21\u578B\u901A\u8FC7 skill_script_run(skillId, script, lang, args) \u8C03\u7528\uFF0C\u4E0D\u80FD\u76F4\u63A5\u6267\u884C shell\u3002"
  },
  promptinject: {
    id: "promptinject",
    label: "\u63D0\u793A\u8BCD\u6CE8\u5165",
    dir: "promptinjects",
    manifest: "promptinject.json",
    allowedExports: ["meta", "append", "rewrite"],
    forbiddenExports: ["setup", "register", "hooks", "providers", "activate", "deactivate"],
    canRegisterTool: false,
    canHook: false,
    canProvide: false,
    canInjectPrompt: true,
    executesCode: true,
    sandboxed: false,
    // 进程内可信，但只允许同步纯函数
    manifestKeys: null,
    description: "\u63D0\u793A\u8BCD\u6CE8\u5165\u3002inject.js \u5BFC\u51FA meta + append + rewrite\uFF0C\u4E00\u5305\u53EF\u58F0\u660E\u591A\u6761\u6CE8\u5165\u3002"
  }
};
var VALID_TYPE_IDS = Object.keys(EXT_TYPES);
function validateExports(typeId, moduleExports = {}) {
  const gate = EXT_TYPES[typeId];
  if (!gate) return { ok: false, violations: [`\u672A\u77E5\u6269\u5C55\u7C7B\u578B\uFF1A${typeId}`] };
  const violations = [];
  const exportNames = Object.keys(moduleExports).filter((k) => k !== "internals" && k !== "default");
  for (const name of exportNames) {
    if (gate.forbiddenExports.includes(name)) {
      violations.push(`\u7C7B\u578B ${typeId} \u4E0D\u5141\u8BB8\u5BFC\u51FA "${name}"\uFF08\u5141\u8BB8\uFF1A${gate.allowedExports.join(", ") || "\u65E0"}\uFF09`);
    }
  }
  if (gate.allowedExports.length > 0) {
    const hasEntry = exportNames.some((n) => gate.allowedExports.includes(n));
    if (!hasEntry && exportNames.length > 0) {
      violations.push(`\u7C7B\u578B ${typeId} \u9700\u8981\u5BFC\u51FA\u4EE5\u4E0B\u4E4B\u4E00\uFF1A${gate.allowedExports.join(" / ")}`);
    }
  }
  return { ok: violations.length === 0, violations };
}
function validateManifest(typeId, manifest = {}) {
  const gate = EXT_TYPES[typeId];
  if (!gate) return { ok: false, violations: [`\u672A\u77E5\u6269\u5C55\u7C7B\u578B\uFF1A${typeId}`] };
  const violations = [];
  if (!manifest.id) violations.push("\u7F3A\u5C11 id");
  if (!gate.executesCode && manifest.entry) {
    violations.push(`\u7C7B\u578B ${typeId} \u662F\u7EAF\u6570\u636E/\u914D\u7F6E\u6269\u5C55\uFF0C\u4E0D\u5141\u8BB8 entry\uFF08\u5F53\u524D\uFF1A${manifest.entry}\uFF09`);
  }
  return { ok: violations.length === 0, violations };
}
function typeOfDir(dirPath) {
  const base = String(dirPath ?? "").replace(/[/\\]+$/, "").split(/[/\\]/).pop();
  for (const gate of Object.values(EXT_TYPES)) {
    if (gate.dir === String(base || "").toLowerCase()) return gate.id;
  }
  return null;
}
var BUILTIN_PLUGIN_ALLOWLIST = /* @__PURE__ */ new Set([
  // 随应用发布的管理器插件（P3+ 逐个添加）：
  // 'ext-knowledge', 'ext-mcp', 'ext-skill', 'ext-tool', 'ext-promptinject'
]);
var SESSION_ALLOWED_HOOKS = /* @__PURE__ */ new Set([
  // v1 的五个钩子同样是会话期语义（组装上下文/发模型前后/工具前后），必须放行
  "before-context",
  "before-llm-messages",
  "after-response",
  "before-tool",
  "after-tool",
  // 事件型旧钩子（单个会话内的事件回调）
  "onMessage",
  "onNotice",
  "onEvent",
  "message.received",
  "trigger.evaluate",
  "session.wake",
  "context.build",
  "prompt.segments",
  "prompt.render",
  "messages.before",
  "llm.before",
  "llm.after",
  "llm.error",
  "tools.resolve",
  "tool.before",
  "tool.after",
  "reply.before-send",
  "reply.after-send",
  "reply.failed",
  "session.end"
]);
function isHookAllowed(scope, hookId) {
  if (String(scope) !== "session") return true;
  return SESSION_ALLOWED_HOOKS.has(String(hookId));
}
function canContributeUi(scope) {
  return String(scope) !== "session";
}

// packages/extension-compat/bridge/chat-profiles.js
var effectiveConfigForChat = (chatKey) => __extensionHost.view(chatKey);
var profilePersonaEntries = () => [];

// packages/extension-compat/vendor/src/extensions/registry.js
var ExtensionDescriptorRegistry = class {
  constructor() {
    this.descriptors = /* @__PURE__ */ new Map();
    this.managers = /* @__PURE__ */ new Map();
  }
  /**
   * 登记一个子扩展。
   * @returns {{ ok: boolean, error?: string }}
   */
  register(descriptor) {
    const type = String(descriptor?.type || "").trim();
    const gate = EXT_TYPES[type];
    if (!gate) return { ok: false, error: `\u672A\u77E5\u6269\u5C55\u7C7B\u578B\uFF1A${type}` };
    const id = String(descriptor?.id || "").trim();
    if (!id) return { ok: false, error: "\u7F3A\u5C11 id" };
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
      return { ok: false, error: `id \u53EA\u80FD\u5305\u542B\u5B57\u6BCD/\u6570\u5B57/._-\uFF08\u5F53\u524D\uFF1A${id}\uFF09` };
    }
    if (this.descriptors.has(id)) {
      const existing = this.descriptors.get(id);
      if (existing.managerId !== descriptor.managerId) {
        return { ok: false, error: `id "${id}" \u5DF2\u88AB ${existing.managerId} \u767B\u8BB0\u4E3A ${existing.type}` };
      }
    }
    this.descriptors.set(id, {
      type,
      id,
      name: String(descriptor.name || id),
      description: String(descriptor.description || ""),
      version: String(descriptor.version || "0.0.0"),
      managerId: String(descriptor.managerId || ""),
      status: String(descriptor.status || "active"),
      error: descriptor.error ? String(descriptor.error) : "",
      settingsSchema: descriptor.settingsSchema || {},
      settings: descriptor.settings || {},
      details: descriptor.details || {},
      registeredAt: Date.now()
    });
    const mid = String(descriptor.managerId || "");
    if (mid) {
      if (!this.managers.has(mid)) this.managers.set(mid, /* @__PURE__ */ new Set());
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
    const ids = [...this.managers.get(managerId) || []];
    for (const id of ids) this.unregister(id);
    this.managers.delete(managerId);
    return ids;
  }
  get(id) {
    return this.descriptors.get(String(id)) || null;
  }
  /** 查询某 owner 是否已登记且类型允许注册工具。 */
  canOwnerRegisterTool(ownerId) {
    const d = this.descriptors.get(String(ownerId));
    if (!d) return { ok: false, reason: `owner "${ownerId}" \u672A\u5728\u63CF\u8FF0\u7B26\u8868\u767B\u8BB0` };
    const gate = EXT_TYPES[d.type];
    if (!gate?.canRegisterTool && !gate?.hostProxyTools) {
      return { ok: false, reason: `\u7C7B\u578B ${d.type} \u4E0D\u5141\u8BB8\u6CE8\u518C\u5DE5\u5177\uFF08owner: ${ownerId}\uFF09` };
    }
    return { ok: true };
  }
  /** 按类型过滤列表。 */
  listByType(type) {
    return [...this.descriptors.values()].filter((d) => d.type === type);
  }
  list() {
    return [...this.descriptors.values()];
  }
  /** UI 用的状态视图。 */
  statusView(context = {}) {
    return this.list().map((d) => ({
      ...d,
      enabled: this.isSessionEnabled(d.id, context),
      active: d.status === "active" && this.isSessionEnabled(d.id, context)
    }));
  }
  /**
   * 该子扩展是否有**显式**启用配置（全局默认 / 会话覆盖 / v1 迁移期 config.skills）。
   * 没有显式配置时返回 false，由调用方决定默认值（例如试点包默认可见）。
   */
  hasExplicitConfig(id, context = {}) {
    const key = String(id);
    const dflt = getConfig()?.extensions?.defaults?.[key];
    if (dflt && typeof dflt === "object" && dflt.enabled !== void 0) return true;
    const chatKey = context.chatKey || "";
    if (chatKey) {
      const scoped = effectiveConfigForChat(chatKey);
      const ov = scoped?.extensions?.overrides?.[key];
      if (ov && typeof ov === "object" && ov.enabled !== void 0) return true;
    }
    const legacy = getConfig()?.skills?.[key];
    if (legacy && typeof legacy === "object" && legacy.enabled !== void 0) return true;
    return false;
  }
  /**
   * 会话级启用判定：读 overrides.extensions[id].enabled。
   * 未配置时回落到全局默认 config.extensions.defaults[id]，再回落到 v1 config.skills[id]。
   */
  isSessionEnabled(id, context = {}) {
    if (String(this.descriptors.get(String(id))?.scope) === "global") return true;
    const key = String(id);
    const chatKey = context.chatKey || "";
    if (chatKey) {
      const scoped = effectiveConfigForChat(chatKey);
      const ov = scoped?.extensions?.overrides?.[key];
      if (ov && typeof ov === "object" && ov.enabled !== void 0) {
        return ov.enabled !== false;
      }
    }
    const dflt = getConfig()?.extensions?.defaults?.[key];
    if (dflt && typeof dflt === "object" && dflt.enabled !== void 0) return dflt.enabled !== false;
    const legacy = getConfig()?.skills?.[key];
    if (legacy && typeof legacy === "object" && legacy.enabled !== void 0) return legacy.enabled !== false;
    return false;
  }
  /** 读取子扩展在当前作用域的设置（全局默认 + 会话覆盖合并）。 */
  settingsOf(id, context = {}) {
    const d = this.descriptors.get(String(id));
    if (!d) return {};
    const base = { ...d.settings || {} };
    const chatKey = context.chatKey || "";
    let scoped = null;
    if (chatKey) {
      scoped = effectiveConfigForChat(chatKey);
    } else {
      scoped = getConfig();
    }
    const ov = scoped?.extensions?.overrides?.[id];
    if (ov && typeof ov === "object") {
      if (ov.settings && typeof ov.settings === "object") return { ...ov.settings };
      for (const [k, v] of Object.entries(ov)) {
        if (k !== "enabled" && k !== "settings" && v !== void 0) base[k] = v;
      }
    }
    return base;
  }
  clear() {
    this.descriptors.clear();
    this.managers.clear();
  }
};
var extensionRegistry = new ExtensionDescriptorRegistry();

// packages/extension-compat/vendor/src/tool-registry.js
var registry = /* @__PURE__ */ new Map();
function registerTool(def) {
  if (!def?.id) throw new Error("\u5DE5\u5177\u5FC5\u987B\u63D0\u4F9B id");
  if (!def?.name) throw new Error(`\u5DE5\u5177 ${def.id} \u5FC5\u987B\u63D0\u4F9B name`);
  if (typeof def?.execute !== "function") throw new Error(`\u5DE5\u5177 ${def.id} \u5FC5\u987B\u63D0\u4F9B execute \u51FD\u6570`);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(def.id))) {
    throw new Error(`\u5DE5\u5177 id \u4E0D\u7B26\u5408 OpenAI \u51FD\u6570\u540D\u89C4\u8303 [a-zA-Z0-9_-]{1,64}\uFF1A${def.id}`);
  }
  registry.set(def.id, Object.freeze({
    category: "system",
    icon: "\u{1F527}",
    defaultEnabled: true,
    // core：机器人能正常对话的最低集合。可用性层会忽略分类/单项开关（但总开关仍能
    // 一次性停用全部），设置页的开关锁定并标「核心工具」，避免被误关。
    core: false,
    requiresVision: false,
    requiresSearch: false,
    // skillId：该工具属于哪个 Skill（内置工具为 null）。
    // 用途：Skill 被禁用时，它注册的工具自动不可用；卸载时按 skillId 批量清理。
    skillId: null,
    // requires：需要的能力名（如 'knowledge.search'）。
    // 与 skillId 的区别：skillId 是"谁注册的"，requires 是"运行时必须有什么能力"。
    requires: [],
    ...def
  }));
}
function unregisterTool(id) {
  return registry.delete(String(id));
}
function unregisterToolsBySkill(skillId) {
  const ids = [];
  for (const [id, def] of registry) {
    if (def.skillId && def.skillId === skillId) {
      registry.delete(id);
      ids.push(id);
    }
  }
  return ids;
}
function listTools() {
  return [...registry.values()];
}
function getTool(id) {
  return registry.get(id) ?? null;
}
function listToolsByCategory(category) {
  return listTools().filter((t) => t.category === category);
}
function listCategories() {
  const cats = new Set(listTools().map((t) => t.category));
  return [...cats];
}
function clearRegistry() {
  registry.clear();
}
function getToolAvailability(toolId, context = {}) {
  const def = registry.get(String(toolId));
  if (!def) {
    return { id: String(toolId), enabled: false, code: SKILL_ERROR.NOT_FOUND, reason: "\u5DE5\u5177\u672A\u6CE8\u518C", skillId: null, core: false };
  }
  const {
    // skills 缺省时回落到全局单例，**而不是跳过技能检查**。
    //
    // 这是一个真实存在的坑：原来写成 skills = null，而下面的技能判定是
    // `if (def.skillId && skills)` —— 也就是说"调用方忘了传 skills"会让整段
    // 技能开关检查**静默失效**，所有属于技能的工具都被报成可用。
    // 少传一个参数就关掉一道安全检查，这种默认值方向是反的。
    // 现在默认取单例（生产行为的正确来源），需要注入的测试仍然可以显式传。
    skills = skillManager,
    toolsCfg = {},
    visionEnabled = true,
    searchEnabled = true,
    runtimeContext = {}
  } = context;
  const deny = (code, reason) => ({ id: def.id, enabled: false, code, reason, skillId: def.skillId ?? null, core: def.core === true });
  const isCore = def.core === true;
  if (toolsCfg.enabled === false) {
    return deny("tools-disabled", "\u5DE5\u5177\u603B\u5F00\u5173\u5DF2\u5173\u95ED");
  }
  if (def.skillId && skills) {
    let st = skills.isActive(def.skillId, runtimeContext);
    if (!st?.active && st?.code === SKILL_ERROR.NOT_FOUND) {
      const sub = extensionRegistry.get(def.skillId);
      if (sub) st = { active: extensionRegistry.isSessionEnabled?.(def.skillId, runtimeContext?.chatKey) !== false };
    }
    if (!st.active) {
      return deny(st.code || SKILL_ERROR.DISABLED, `${skillLabel(skills, def.skillId)}\uFF1A${st.reason ?? "\u672A\u542F\u7528"}`);
    }
  }
  const requires = Array.isArray(def.requires) ? def.requires : [];
  if (requires.length && skills) {
    for (const cap of requires) {
      const ex = skills.explainCapability(cap, runtimeContext);
      if (!ex.available) {
        return deny(SKILL_ERROR.CAPABILITY_MISSING, `\u7F3A\u5C11\u80FD\u529B ${cap}\uFF1A${ex.reason}`);
      }
    }
  }
  if (!isCore && toolsCfg.categories?.[def.category] === false) {
    return deny("category-disabled", `\u5206\u7C7B\u300C${def.category}\u300D\u5DF2\u5173\u95ED`);
  }
  if (!isCore) {
    const override = toolsCfg.overrides?.[def.id];
    const enabled = override === void 0 ? def.defaultEnabled !== false : override !== false;
    if (!enabled) {
      return deny("tool-disabled", "\u8BE5\u5DE5\u5177\u5DF2\u88AB\u5355\u72EC\u5173\u95ED");
    }
  }
  if (def.id === "send_to" && toolsCfg.crossChatSend !== true) {
    return deny("tool-disabled", "\u8DE8\u4F1A\u8BDD\u53D1\u9001\u672A\u5F00\u542F\uFF08\u8BBE\u7F6E \u2192 \u5DE5\u5177\u4E0E\u6280\u80FD\uFF09");
  }
  if (def.requiresVision && !visionEnabled) {
    return deny("no-vision", "\u5F53\u524D\u6A21\u578B\u4E0D\u652F\u6301\u56FE\u7247\u8F93\u5165");
  }
  if (def.requiresSearch && !searchEnabled) {
    return deny("no-search", "\u8054\u7F51\u641C\u7D22\u5DF2\u5173\u95ED");
  }
  if (skills) {
    for (const { fn, skillId } of skills.getToolGuards(runtimeContext)) {
      try {
        const r = fn({ toolId: def.id, tool: def, context: runtimeContext });
        if (r === false) return deny("skill-guard", `${skillLabel(skills, skillId)}\uFF1A\u8FD0\u884C\u65F6\u5426\u51B3`);
        if (r && typeof r === "object" && r.ok === false) {
          return deny("skill-guard", String(r.reason || `${skillLabel(skills, skillId)}\uFF1A\u8FD0\u884C\u65F6\u5426\u51B3`));
        }
      } catch {
      }
    }
  }
  return { id: def.id, enabled: true, code: null, reason: "", skillId: def.skillId ?? null, core: isCore };
}
function listAvailableTools(context = {}) {
  return listTools().filter((t) => getToolAvailability(t.id, context).enabled);
}
function availabilityOf(context = {}) {
  return listTools().map((t) => getToolAvailability(t.id, context));
}
function skillLabel(skills, skillId) {
  const st = skills?.status?.(skillId);
  return st?.name || skillId;
}
function isToolEnabledLegacy(def, toolsCfg = {}) {
  return getToolAvailability(def?.id, { toolsCfg }).enabled;
}
var CATEGORY_META = {
  messaging: { name: "\u6D88\u606F\u53D1\u9001", icon: "\u{1F4AC}", description: "\u53D1\u9001\u6587\u5B57\u3001\u8868\u60C5\u3001\u6233\u4E00\u6233\u7B49" },
  sticker: { name: "\u8868\u60C5\u7BA1\u7406", icon: "\u{1F600}", description: "\u6536\u85CF\u3001\u67E5\u770B\u3001\u5907\u6CE8\u8868\u60C5\u5305" },
  query: { name: "\u6D88\u606F\u67E5\u8BE2", icon: "\u{1F50D}", description: "\u67E5\u770B\u5386\u53F2\u6D88\u606F\u3001\u6210\u5458\u5217\u8868\u7B49" },
  memory: { name: "\u8BB0\u5FC6\u7CFB\u7EDF", icon: "\u{1F9E0}", description: "\u8BB0\u5F55\u548C\u67E5\u8BE2\u5BF9\u7FA4\u53CB\u7684\u957F\u671F\u5370\u8C61" },
  web: { name: "\u8054\u7F51\u641C\u7D22", icon: "\u{1F310}", description: "\u641C\u7D22\u7F51\u9875\u3001\u6293\u53D6\u5185\u5BB9" },
  knowledge: { name: "\u77E5\u8BC6\u5E93", icon: "\u{1F4DA}", description: "\u68C0\u7D22\u672C\u5730\u77E5\u8BC6\u5E93\u5E76\u6CE8\u5165\u4E0A\u4E0B\u6587" },
  media: { name: "\u5A92\u4F53\u7406\u89E3", icon: "\u{1F39E}\uFE0F", description: "\u89C6\u9891\u62BD\u5E27\u3001\u56FE\u7247\u6807\u6CE8\u7B49" },
  system: { name: "\u7CFB\u7EDF\u53CD\u9988", icon: "\u2699\uFE0F", description: "\u5411\u63A7\u5236\u53F0\u53CD\u9988\u3001\u7ED3\u675F\u4F1A\u8BDD\u7B49" },
  container: { name: "\u5BB9\u5668\u6C99\u7BB1", icon: "\u{1F4E6}", description: "\u5728\u4F1A\u8BDD\u7ED1\u5B9A\u7684\u5BB9\u5668\u5185\u6267\u884C\u547D\u4EE4/\u8BFB\u5199\u6587\u4EF6/\u5F00\u7EC8\u7AEF" }
};

// packages/extension-compat/vendor/src/skills/manifest.js
var manifest_exports = {};
__export(manifest_exports, {
  DIR_KIND: () => DIR_KIND,
  DIR_SCOPE: () => DIR_SCOPE,
  KIND_LABEL: () => KIND_LABEL,
  SKILL_API_VERSION: () => SKILL_API_VERSION,
  SKILL_API_VERSION_V2: () => SKILL_API_VERSION_V2,
  isManifestUsable: () => isManifestUsable,
  kindOfDir: () => kindOfDir,
  normalizeManifest: () => normalizeManifest
});
var SKILL_API_VERSION = 1;
var SKILL_API_VERSION_V2 = 2;
var V2_TYPES = /* @__PURE__ */ new Set(["tool", "plugin", "knowledge", "mcp", "skill", "promptinject"]);
var DIR_KIND = { plugins: "plugin", "chat-plugins": "plugin", skills: "skill" };
var DIR_SCOPE = { "chat-plugins": "session" };
var KIND_LABEL = { plugin: "\u786E\u5B9A\u6027\u578B", skill: "LLM \u578B" };
function kindOfDir(dirPath) {
  const base = String(dirPath ?? "").replace(/[/\\]+$/, "").split(/[/\\]/).pop();
  return DIR_KIND[String(base || "").toLowerCase()] || null;
}
var VALID_CATEGORIES = /* @__PURE__ */ new Set(["model", "message", "knowledge", "media", "utility"]);
function asArray(value) {
  if (value === null || value === void 0) return [];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
function cleanString(value, fallback = "") {
  const s = String(value ?? "").trim();
  return s || fallback;
}
function normalizeManifest(raw, { fallbackId = "" } = {}) {
  const problems = [];
  if (!raw || typeof raw !== "object") {
    return { manifest: null, problems: ["manifest \u4E0D\u662F\u5BF9\u8C61"] };
  }
  const id = cleanString(raw.id, fallbackId);
  if (!id) problems.push("\u7F3A\u5C11 id");
  if (id && !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    problems.push(`id \u53EA\u80FD\u5305\u542B\u5B57\u6BCD/\u6570\u5B57/._-\uFF08\u5F53\u524D\uFF1A${id}\uFF09`);
  }
  const name = cleanString(raw.name, id || "\u672A\u547D\u540D Skill");
  const version = cleanString(raw.version, "0.0.0");
  const apiVersion = Number(raw.apiVersion) || SKILL_API_VERSION;
  if (apiVersion > SKILL_API_VERSION_V2) {
    problems.push(`apiVersion ${apiVersion} \u9AD8\u4E8E\u5F53\u524D\u652F\u6301\u7684 ${SKILL_API_VERSION_V2}`);
  }
  const declaredType = raw.type ? String(raw.type) : "";
  if (declaredType && !V2_TYPES.has(declaredType)) {
    problems.push(`type \u975E\u6CD5\uFF08${declaredType}\uFF09\uFF0C\u5408\u6CD5\u503C\uFF1A${[...V2_TYPES].join("/")}`);
  }
  const category = VALID_CATEGORIES.has(raw.category) ? raw.category : "utility";
  if (raw.category && !VALID_CATEGORIES.has(raw.category)) {
    problems.push(`category \u975E\u6CD5\uFF08${raw.category}\uFF09\uFF0C\u5DF2\u56DE\u9000\u4E3A utility`);
  }
  const capabilities = [...new Set(asArray(raw.capabilities))];
  const requires = [...new Set(asArray(raw.requires))];
  const dependsOn = [...new Set(asArray(raw.dependsOn))].filter((d) => d && d !== id);
  const optionalDependsOn = [...new Set(asArray(raw.optionalDependsOn))].filter((d) => d && d !== id && !dependsOn.includes(d));
  const selfDep = requires.filter((r) => capabilities.includes(r));
  const requiresClean = requires.filter((r) => !capabilities.includes(r));
  return {
    manifest: {
      id,
      name,
      version,
      apiVersion,
      // v2 类型（null = v1，按目录语义归类）
      type: declaredType || null,
      // 作用域：清单显式声明优先；未声明时由加载器按目录补（chat-plugins/ → session）
      scope: raw.scope === "session" ? "session" : "global",
      enabledByDefault: raw.enabledByDefault !== false,
      category,
      description: cleanString(raw.description, ""),
      author: cleanString(raw.author, ""),
      requires: requiresClean,
      dependsOn,
      optionalDependsOn,
      capabilities,
      configSchema: raw.configSchema && typeof raw.configSchema === "object" ? raw.configSchema : {},
      settings: raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings) ? raw.settings : {},
      prompt: normalizePrompt(raw.prompt),
      deprecated: raw.deprecated === true
    },
    problems
  };
}
function normalizePrompt(prompt) {
  if (!prompt || typeof prompt !== "object") return null;
  const sections = Array.isArray(prompt.sections) ? prompt.sections : [];
  const normalized = sections.map((s, i) => ({
    id: cleanString(s?.id, `section-${i}`),
    title: cleanString(s?.title, ""),
    content: String(s?.content ?? "").trim(),
    // Skill 不得覆盖核心安全规则：priority 上限 99
    priority: Math.min(99, Number(s?.priority) || 50)
  })).filter((s) => s.content);
  if (!normalized.length && !prompt.instruction) return null;
  if (!normalized.length && prompt.instruction) {
    normalized.push({ id: "main", title: "", content: String(prompt.instruction).trim(), priority: 50 });
  }
  return { sections: normalized };
}
function isManifestUsable(manifest, problems) {
  if (!manifest) return false;
  return !problems.some((p) => p.startsWith("\u7F3A\u5C11 id") || p.includes("id \u53EA\u80FD\u5305\u542B"));
}

// packages/extension-compat/vendor/src/skills/dependencies.js
var dependencies_exports = {};
__export(dependencies_exports, {
  hardDepsOf: () => hardDepsOf,
  optionalDepsOf: () => optionalDepsOf,
  topoOrder: () => topoOrder,
  validateDependencies: () => validateDependencies
});
function manifestOf(skill) {
  return skill?.manifest || skill || {};
}
function hardDepsOf(skill) {
  const m = manifestOf(skill);
  return [...new Set(Array.isArray(m.dependsOn) ? m.dependsOn.map(String).filter(Boolean) : [])];
}
function optionalDepsOf(skill) {
  const m = manifestOf(skill);
  return [...new Set(Array.isArray(m.optionalDependsOn) ? m.optionalDependsOn.map(String).filter(Boolean) : [])];
}
function validateDependencies(skills) {
  const byId = /* @__PURE__ */ new Map();
  for (const s of skills || []) {
    const m = manifestOf(s);
    if (m.id) byId.set(String(m.id), s);
  }
  const errors = /* @__PURE__ */ new Map();
  const done = /* @__PURE__ */ new Set();
  const visit = (id, stack) => {
    if (errors.has(id)) return errors.get(id);
    if (done.has(id)) return null;
    if (stack.has(id)) {
      const err = {
        code: SKILL_ERROR.DEPENDENCY_CYCLE,
        reason: `\u63D2\u4EF6\u4F9D\u8D56\u6210\u73AF\uFF1A${[...stack, id].join(" \u2192 ")}`
      };
      errors.set(id, err);
      return err;
    }
    const skill = byId.get(id);
    if (!skill) return null;
    const m = manifestOf(skill);
    const scope = String(m.scope || "global");
    for (const depId of hardDepsOf(skill)) {
      const dep = byId.get(depId);
      if (!dep) {
        const err = { code: SKILL_ERROR.DEPENDENCY_MISSING, reason: `\u7F3A\u5C11\u4F9D\u8D56\u63D2\u4EF6\uFF1A${depId}` };
        errors.set(id, err);
        return err;
      }
      const depScope = String(manifestOf(dep).scope || "global");
      if (scope === "global" && depScope === "session") {
        const err = {
          code: SKILL_ERROR.DEPENDENCY_SCOPE_INVALID,
          reason: `\u5168\u5C40\u63D2\u4EF6\u4E0D\u80FD\u4F9D\u8D56\u4F1A\u8BDD\u63D2\u4EF6\uFF1A${depId}`
        };
        errors.set(id, err);
        return err;
      }
      const sub = visit(depId, new Set(stack).add(id));
      if (sub) {
        const err = { code: sub.code, reason: `${depId}\uFF1A${sub.reason}` };
        errors.set(id, err);
        return err;
      }
    }
    done.add(id);
    return null;
  };
  for (const id of byId.keys()) visit(id, /* @__PURE__ */ new Set());
  return errors;
}
function topoOrder(skills) {
  const byId = /* @__PURE__ */ new Map();
  for (const s of skills || []) {
    const m = manifestOf(s);
    if (m.id) byId.set(String(m.id), s);
  }
  const errors = validateDependencies(skills);
  const order = [];
  const seen = /* @__PURE__ */ new Set();
  const stack = /* @__PURE__ */ new Set();
  const visit = (skill) => {
    const id = String(manifestOf(skill).id);
    if (seen.has(id) || stack.has(id)) return;
    stack.add(id);
    for (const depId of hardDepsOf(skill)) {
      const dep = byId.get(depId);
      if (dep) visit(dep);
    }
    stack.delete(id);
    seen.add(id);
    order.push(skill);
  };
  for (const s of skills || []) visit(s);
  return { order, errors };
}

// packages/extension-compat/vendor/src/extensions/prompt-pipeline.js
var prompt_pipeline_exports = {};
__export(prompt_pipeline_exports, {
  ANCHOR_ANCHORS: () => ANCHOR_ANCHORS,
  BUILTIN_SEGMENT_ORDER: () => BUILTIN_SEGMENT_ORDER,
  LIBRARY_SEGMENT_ORDER: () => LIBRARY_SEGMENT_ORDER,
  applyPromptInjects: () => applyPromptInjects,
  clearPromptInjectSources: () => clearPromptInjectSources,
  collectPromptInjects: () => collectPromptInjects,
  listPromptInjectSources: () => listPromptInjectSources,
  registerPromptContributionSource: () => registerPromptContributionSource,
  registerPromptInjectSource: () => registerPromptInjectSource,
  renderSegments: () => renderSegments,
  segmentIds: () => segmentIds,
  unregisterPromptContributionSource: () => unregisterPromptContributionSource,
  unregisterPromptInjectSource: () => unregisterPromptInjectSource
});

// packages/extension-compat/vendor/src/extensions/prompt-inject.js
var prompt_inject_exports = {};
__export(prompt_inject_exports, {
  PROMPT_ANCHORS: () => PROMPT_ANCHORS,
  REWRITE_TARGETS: () => REWRITE_TARGETS,
  VALID_ANCHORS: () => VALID_ANCHORS,
  VALID_TARGETS: () => VALID_TARGETS,
  resolveRewriteConflicts: () => resolveRewriteConflicts,
  validateInjectDeclaration: () => validateInjectDeclaration,
  validatePromptInjectExports: () => validatePromptInjectExports
});
var PROMPT_ANCHORS = {
  "before-all": {
    label: "\u5168\u6BB5\u4E4B\u524D",
    position: 0,
    branches: ["builtin", "library"],
    allowsDynamic: false,
    description: "\u7CFB\u7EDF\u63D0\u793A\u6700\u524D\uFF08\u8EAB\u4EFD\u53E5\u4E4B\u524D\uFF09"
  },
  "after-identity": {
    label: "\u8EAB\u4EFD/\u4EBA\u8BBE\u4E4B\u540E",
    position: 10,
    branches: ["builtin", "library"],
    allowsDynamic: false,
    description: "\u8EAB\u4EFD\u53E5\u6216\u4EBA\u8BBE\u6B63\u6587\u4E4B\u540E\uFF0C\u6838\u5FC3\u89C4\u5219\u4E4B\u524D"
  },
  "after-security": {
    label: "\u5B89\u5168\u7EA2\u7EBF\u4E4B\u540E",
    position: 20,
    branches: ["builtin", "library"],
    allowsDynamic: false,
    description: "\u5B89\u5168\u89C4\u5219\u6BB5\u4E4B\u540E"
  },
  "after-tool-protocol": {
    label: "\u5DE5\u5177\u534F\u8BAE\u4E4B\u540E",
    position: 30,
    branches: ["builtin", "library"],
    allowsDynamic: false,
    description: "\u5DE5\u5177\u534F\u8BAE\u6BB5\u4E4B\u540E"
  },
  "after-guidelines": {
    label: "\u884C\u4E3A\u51C6\u5219\u4E4B\u540E",
    position: 40,
    branches: ["builtin"],
    // 提示词库分支没有行为准则簇
    allowsDynamic: false,
    description: "\u884C\u4E3A\u51C6\u5219\u7C07\u4E4B\u540E\uFF08\u63D0\u793A\u8BCD\u5E93\u5206\u652F\u9000\u5316\u4E3A after-tool-protocol\uFF09"
  },
  "before-skill-sections": {
    label: "\u6269\u5C55\u7247\u6BB5\u4E4B\u524D",
    position: 50,
    branches: ["builtin", "library"],
    allowsDynamic: false,
    description: "\u3010\u53EF\u7528\u6280\u80FD\u3011\u6BB5\u4E4B\u524D"
  },
  "after-skill-sections": {
    label: "\u6269\u5C55\u7247\u6BB5\u4E4B\u540E",
    position: 60,
    branches: ["builtin", "library"],
    allowsDynamic: false,
    description: "\u3010\u53EF\u7528\u6280\u80FD\u3011\u6BB5\u4E4B\u540E\uFF08plugin prompt.build \u9ED8\u8BA4\u843D\u8FD9\u91CC\uFF09"
  },
  "before-admin-rules": {
    label: "\u7BA1\u7406\u5458\u89C4\u5219\u4E4B\u524D",
    position: 70,
    branches: ["builtin", "library"],
    allowsDynamic: false,
    description: "\u3010\u7BA1\u7406\u5458\u9644\u52A0\u89C4\u5219\u3011\u4E4B\u524D"
  },
  "after-admin-rules": {
    label: "\u7BA1\u7406\u5458\u89C4\u5219\u4E4B\u540E",
    position: 80,
    branches: ["builtin", "library"],
    allowsDynamic: false,
    description: "\u3010\u7BA1\u7406\u5458\u9644\u52A0\u89C4\u5219\u3011\u4E4B\u540E"
  },
  "at-tail": {
    label: "\u7CFB\u7EDF\u63D0\u793A\u672B\u5C3E",
    position: 99,
    branches: ["builtin", "library"],
    allowsDynamic: true,
    // 唯一允许动态内容的位置（保护前缀缓存）
    description: "\u7CFB\u7EDF\u63D0\u793A\u672B\u5C3E\u3002\u552F\u4E00\u5141\u8BB8\u653E\u52A8\u6001\u5185\u5BB9\u7684\u4F4D\u7F6E\u3002"
  }
};
var REWRITE_TARGETS = {
  "identity": { label: "\u8EAB\u4EFD\u53E5", segment: "builtin", protected: false },
  "security": { label: "\u5B89\u5168\u7EA2\u7EBF", segment: "both", protected: true, floorNote: "\u6539\u5199\u53EA\u80FD\u5728\u5E95\u7EBF\u4E4B\u4E0A\u52A0\u4E25\uFF0C\u4E0D\u53EF\u5220\u9664\u5E95\u7EBF" },
  "tool-protocol": { label: "\u5DE5\u5177\u534F\u8BAE", segment: "both", protected: false },
  "anti-ai-flavor": { label: "\u53BB AI \u5473", segment: "builtin", protected: false },
  "subjectivity": { label: "\u4E3B\u4F53\u6027", segment: "builtin", protected: false },
  "speak-or-not": { label: "\u8BE5\u8BF4\u4E0D\u8BF4", segment: "builtin", protected: false },
  "not-a-queue": { label: "\u4E0D\u662F\u961F\u5217", segment: "builtin", protected: false },
  "human-rhythm": { label: "\u771F\u4EBA\u8282\u594F", segment: "builtin", protected: false },
  "not-moderator": { label: "\u4E0D\u5F53\u7BA1\u7406\u5458", segment: "builtin", protected: false },
  "quote-and-at": { label: "\u5F15\u7528\u4E0E@", segment: "builtin", protected: false },
  "memory-rules": { label: "\u8BB0\u5FC6\u89C4\u5219", segment: "builtin", protected: false },
  "sticker-rules": { label: "\u8868\u60C5\u89C4\u5219", segment: "builtin", protected: false },
  "qq-scene": { label: "QQ \u573A\u666F", segment: "builtin", protected: false },
  "report-ban": { label: "\u4E3E\u62A5\u5C01\u7981", segment: "builtin", protected: false },
  "persona": { label: "\u4EBA\u8BBE\u6B63\u6587\uFF08\u63D0\u793A\u8BCD\u5E93\uFF09", segment: "library", protected: false },
  "admin-rules": { label: "\u7BA1\u7406\u5458\u9644\u52A0\u89C4\u5219", segment: "both", protected: false }
};
var VALID_ANCHORS = new Set(Object.keys(PROMPT_ANCHORS));
var VALID_TARGETS = new Set(Object.keys(REWRITE_TARGETS));
function validateInjectDeclaration(inject) {
  const violations = [];
  if (!inject?.id) violations.push("\u6CE8\u5165\u9879\u7F3A\u5C11 id");
  const kind = String(inject?.kind || "");
  if (kind !== "append" && kind !== "rewrite") violations.push(`kind \u5FC5\u987B\u662F append \u6216 rewrite\uFF08\u5F53\u524D\uFF1A${kind}\uFF09`);
  if (kind === "append") {
    if (!VALID_ANCHORS.has(inject.at)) {
      violations.push(`append \u7684\u951A\u70B9 at \u975E\u6CD5\uFF1A${inject.at}\uFF08\u5408\u6CD5\uFF1A${[...VALID_ANCHORS].join(", ")}\uFF09`);
    }
  }
  if (kind === "rewrite") {
    if (!VALID_TARGETS.has(inject.target)) {
      violations.push(`rewrite \u7684\u76EE\u6807 target \u975E\u6CD5\uFF1A${inject.target}\uFF08\u5408\u6CD5\uFF1A${[...VALID_TARGETS].join(", ")}\uFF09`);
    }
  }
  const priority = Number(inject?.priority);
  if (!Number.isFinite(priority) || priority < 0 || priority > 100) {
    violations.push(`priority \u5FC5\u987B\u662F 0~100\uFF08\u5F53\u524D\uFF1A${inject?.priority}\uFF09`);
  }
  return { ok: violations.length === 0, violations };
}
function validatePromptInjectExports(moduleExports = {}) {
  const violations = [];
  const allowed = /* @__PURE__ */ new Set(["meta", "append", "rewrite", "internals", "default"]);
  for (const name of Object.keys(moduleExports)) {
    if (!allowed.has(name)) {
      violations.push(`promptinject \u53EA\u5141\u8BB8\u5BFC\u51FA meta/append/rewrite\uFF08\u53D1\u73B0\uFF1A"${name}"\uFF09`);
    }
  }
  const meta = moduleExports.meta;
  if (!meta || typeof meta !== "object" || !Array.isArray(meta.injects)) {
    violations.push("\u7F3A\u5C11 meta.injects \u6570\u7EC4");
  } else {
    for (const inject of meta.injects) {
      const r = validateInjectDeclaration(inject);
      violations.push(...r.violations.map((v) => `\u6CE8\u5165 ${inject.id || "?"}\uFF1A${v}`));
    }
  }
  if (typeof moduleExports.append !== "function" && meta?.injects?.some((i) => i.kind === "append")) {
    violations.push("\u58F0\u660E\u4E86 append \u6CE8\u5165\u4F46\u672A\u5BFC\u51FA append \u51FD\u6570");
  }
  if (typeof moduleExports.rewrite !== "function" && meta?.injects?.some((i) => i.kind === "rewrite")) {
    violations.push("\u58F0\u660E\u4E86 rewrite \u6CE8\u5165\u4F46\u672A\u5BFC\u51FA rewrite \u51FD\u6570");
  }
  return { ok: violations.length === 0, violations };
}
function resolveRewriteConflicts(rewrites) {
  const byTarget = /* @__PURE__ */ new Map();
  for (const r of rewrites) {
    const list = byTarget.get(r.target) || [];
    list.push(r);
    byTarget.set(r.target, list);
  }
  const winners = /* @__PURE__ */ new Map();
  for (const [target, list] of byTarget) {
    if (list.length === 1) {
      winners.set(target, list[0].ownerId);
    } else {
      const sorted = [...list].sort(
        (a, b) => (b.priority || 50) - (a.priority || 50) || (a.order || 100) - (b.order || 100)
      );
      winners.set(target, sorted[0].ownerId);
    }
  }
  return winners;
}

// packages/extension-compat/vendor/src/extensions/template-vars.js
var template_vars_exports = {};
__export(template_vars_exports, {
  BUILTIN_VARS: () => BUILTIN_VARS,
  applyOffset: () => applyOffset,
  clearVarConverters: () => clearVarConverters,
  formatDate: () => formatDate,
  listVars: () => listVars,
  parseArgs: () => parseArgs,
  registerVarConverters: () => registerVarConverters,
  renderConfigDeep: () => renderConfigDeep,
  renderTemplate: () => renderTemplate,
  unregisterVarConverters: () => unregisterVarConverters,
  validateVarConverter: () => validateVarConverter
});
var VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(([^()]*)\))?\s*\}\}/g;
var NAME_RE = /^[a-z][a-z0-9_]*$/;
function pad(n, w = 2) {
  return String(Math.trunc(Math.abs(n))).padStart(w, "0");
}
var WEEKDAYS = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
function formatDate(date, fmt = "YYYY-MM-DD HH:mm:ss") {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const table = [
    ["YYYY", String(d.getFullYear())],
    ["YY", String(d.getFullYear()).slice(-2)],
    ["MM", pad(d.getMonth() + 1)],
    ["DD", pad(d.getDate())],
    ["HH", pad(d.getHours())],
    ["mm", pad(d.getMinutes())],
    ["ss", pad(d.getSeconds())],
    ["ddd", WEEKDAYS[d.getDay()]],
    ["M", String(d.getMonth() + 1)],
    ["D", String(d.getDate())],
    ["H", String(d.getHours())],
    ["m", String(d.getMinutes())],
    ["s", String(d.getSeconds())]
  ];
  let out = String(fmt);
  for (const [token, value] of table) {
    out = out.split(token).join(value);
  }
  return out;
}
function applyOffset(base, [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0] = {}) {
  const dt = new Date(base instanceof Date ? base.getTime() : base);
  if (!y && !mo && !d && !h && !mi && !s) return dt;
  if (y) dt.setFullYear(dt.getFullYear() + y);
  if (mo) dt.setMonth(dt.getMonth() + mo);
  if (d) dt.setDate(dt.getDate() + d);
  if (h) dt.setHours(dt.getHours() + h);
  if (mi) dt.setMinutes(dt.getMinutes() + mi);
  if (s) dt.setSeconds(dt.getSeconds() + s);
  return dt;
}
var BUILTIN_VARS = {
  date: ({ args, now }) => formatDate(now, args[0] || "YYYY-MM-DD"),
  time: ({ args, now }) => formatDate(now, args[0] || "HH:mm:ss"),
  datetime: ({ args, now }) => formatDate(now, args[0] || "YYYY-MM-DD HH:mm:ss"),
  year: ({ now }) => pad(now.getFullYear(), 4),
  month: ({ now }) => pad(now.getMonth() + 1),
  day: ({ now }) => pad(now.getDate()),
  hour: ({ now }) => pad(now.getHours()),
  minute: ({ now }) => pad(now.getMinutes()),
  second: ({ now }) => pad(now.getSeconds()),
  weekday: ({ args, now }) => formatDate(now, args[0] || "ddd"),
  timestamp: ({ now }) => String(now.getTime()),
  iso: ({ now }) => {
    const off = -now.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const hh = pad(Math.floor(Math.abs(off) / 60));
    const mm = pad(Math.abs(off) % 60);
    return `${formatDate(now, "YYYY-MM-DD")}T${formatDate(now, "HH:mm:ss")}${sign}${hh}:${mm}`;
  },
  date_offset: ({ args, now }) => {
    const [nums, fmt] = splitNumsAndFormat(args, 3);
    return formatDate(applyOffset(now, nums), fmt || "YYYY-MM-DD");
  },
  time_offset: ({ args, now }) => {
    const [nums, fmt] = splitNumsAndFormat(args, 3);
    const off = [0, 0, 0, nums[0] || 0, nums[1] || 0, nums[2] || 0];
    return formatDate(applyOffset(now, off), fmt || "HH:mm:ss");
  },
  datetime_offset: ({ args, now }) => {
    const [nums, fmt] = splitNumsAndFormat(args, 6);
    return formatDate(applyOffset(now, nums), fmt || "YYYY-MM-DD HH:mm:ss");
  }
};
function splitNumsAndFormat(args, maxNums) {
  const nums = [];
  let fmt = "";
  for (const a of args) {
    if (typeof a === "string") {
      fmt = a;
      continue;
    }
    if (typeof a === "number" && nums.length < maxNums) nums.push(a);
  }
  return [nums, fmt];
}
function parseArgs(raw = "") {
  const text = String(raw).trim();
  if (!text) return { ok: true, args: [] };
  const args = [];
  for (const part of text.split(",")) {
    const s = part.trim();
    if (/^-?\d+$/.test(s)) {
      args.push(Number(s));
      continue;
    }
    const m = s.match(/^(['"])(.*)\1$/);
    if (m) {
      args.push(m[2]);
      continue;
    }
    return { ok: false, args: [] };
  }
  return { ok: true, args };
}
var converters = /* @__PURE__ */ new Map();
function validateVarConverter(name, fn) {
  if (!NAME_RE.test(String(name))) return { ok: false, reason: `\u53D8\u91CF\u540D\u4E0D\u5408\u6CD5\uFF1A${name}` };
  if (Object.prototype.hasOwnProperty.call(BUILTIN_VARS, name)) {
    return { ok: false, reason: `\u4E0D\u80FD\u8986\u76D6\u5185\u7F6E\u53D8\u91CF\uFF1A${name}` };
  }
  if (typeof fn !== "function") return { ok: false, reason: `\u53D8\u91CF ${name} \u5FC5\u987B\u662F\u51FD\u6570` };
  if (fn.constructor && fn.constructor.name === "AsyncFunction") {
    return { ok: false, reason: `\u53D8\u91CF ${name} \u5FC5\u987B\u662F\u540C\u6B65\u51FD\u6570\uFF08\u4E0D\u652F\u6301 async\uFF09` };
  }
  return { ok: true };
}
function registerVarConverters(ownerId, vars) {
  if (!vars || typeof vars !== "object") return { ok: true, count: 0 };
  const map = /* @__PURE__ */ new Map();
  const violations = [];
  for (const [name, fn] of Object.entries(vars)) {
    const v = validateVarConverter(name, fn);
    if (!v.ok) {
      violations.push(v.reason);
      continue;
    }
    map.set(name, fn);
  }
  if (map.size) converters.set(String(ownerId), map);
  else converters.delete(String(ownerId));
  return { ok: violations.length === 0, violations, count: map.size };
}
function unregisterVarConverters(ownerId) {
  converters.delete(String(ownerId));
}
function clearVarConverters() {
  converters.clear();
}
function listVars(ownerId = "") {
  const builtin = Object.keys(BUILTIN_VARS).map((name) => ({ name, source: "builtin" }));
  const own = ownerId && converters.has(String(ownerId)) ? [...converters.get(String(ownerId)).keys()].map((name) => ({ name, source: "extension" })) : [];
  return [...builtin, ...own];
}
function renderTemplate(text, { now = /* @__PURE__ */ new Date(), ownerId = "", vars = {} } = {}) {
  const src = String(text ?? "");
  const own = ownerId ? converters.get(String(ownerId)) : null;
  const warnings = [];
  let replaced = 0;
  const out = src.replace(VAR_RE, (whole, name, rawArgs) => {
    const parsed = parseArgs(rawArgs || "");
    if (!parsed.ok) {
      warnings.push(`\u53C2\u6570\u975E\u6CD5\uFF1A${whole}`);
      return whole;
    }
    if (own && own.has(name)) {
      try {
        const value = own.get(name)(parsed.args, { now, vars });
        if (value === void 0 || value === null) {
          warnings.push(`\u53D8\u91CF\u8FD4\u56DE\u7A7A\uFF1A${name}`);
          return whole;
        }
        replaced += 1;
        return String(value);
      } catch (error) {
        warnings.push(`\u53D8\u91CF ${name} \u629B\u9519\uFF1A${error?.message ?? error}`);
        return whole;
      }
    }
    if (Object.prototype.hasOwnProperty.call(BUILTIN_VARS, name)) {
      replaced += 1;
      return BUILTIN_VARS[name]({ args: parsed.args, now });
    }
    if (Object.prototype.hasOwnProperty.call(vars || {}, name)) {
      const v = vars[name];
      replaced += 1;
      return String(v ?? "");
    }
    warnings.push(`\u672A\u77E5\u53D8\u91CF\uFF1A${name}`);
    return whole;
  });
  return { text: out, replaced, warnings };
}
function renderConfigDeep(value, scope = {}) {
  if (typeof value === "string") return renderTemplate(value, scope).text;
  if (Array.isArray(value)) return value.map((v) => renderConfigDeep(v, scope));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renderConfigDeep(v, scope);
    return out;
  }
  return value;
}

// packages/extension-compat/vendor/src/extensions/prompt-pipeline.js
var BUILTIN_SEGMENT_ORDER = [
  "identity",
  "security",
  "tool-protocol",
  "anti-ai-flavor",
  "subjectivity",
  "speak-or-not",
  "not-a-queue",
  "human-rhythm",
  "not-moderator",
  "quote-and-at",
  "memory-rules",
  "sticker-rules",
  "qq-scene",
  "report-ban"
];
var LIBRARY_SEGMENT_ORDER = ["persona", "security", "tool-protocol"];
var ANCHOR_ANCHORS = {
  "before-all": { before: null, after: null, atStart: true },
  "after-identity": { after: "identity", afterFallback: "persona" },
  "after-security": { after: "security" },
  "after-tool-protocol": { after: "tool-protocol" },
  "after-guidelines": { after: "report-ban", afterFallback: "tool-protocol" },
  "before-skill-sections": { before: "skill-sections" },
  "after-skill-sections": { after: "skill-sections", afterFallback: "tool-protocol" },
  "before-admin-rules": { before: "admin-rules" },
  "after-admin-rules": { after: "admin-rules", afterFallback: "skill-sections" },
  "at-tail": { atEnd: true }
};
function applyPromptInjects(blocks, { rewrites = [], appends = [] } = {}) {
  let out = blocks.map((b) => ({ ...b }));
  for (const rw of rewrites) {
    const target = String(rw.target || "");
    if (!target) continue;
    const idx = out.findIndex((b) => b.id === target);
    if (idx < 0) continue;
    const original = out[idx].text;
    let next;
    try {
      next = rw.fn(original);
    } catch (error) {
      continue;
    }
    if (typeof next !== "string") continue;
    if (target === "security" && !next.trim()) continue;
    out[idx] = { ...out[idx], text: next, source: rw.ownerId || "" };
  }
  const sortedAppends = [...appends].sort(
    (a, b) => (Number(a.order) || 100) - (Number(b.order) || 100) || (Number(b.priority) || 50) - (Number(a.priority) || 50) || String(a.ownerId || "").localeCompare(String(b.ownerId || ""))
  );
  for (const ap of sortedAppends) {
    const text = String(ap.text ?? "");
    if (!text.trim()) continue;
    const at = String(ap.at || "at-tail");
    const anchor = ANCHOR_ANCHORS[at];
    if (!anchor) continue;
    const block = {
      id: `inject:${ap.ownerId || "unknown"}:${ap.injectId || "x"}`,
      text,
      source: ap.ownerId || ""
    };
    let insertAt = out.length;
    if (anchor.atStart) {
      insertAt = 0;
    } else if (anchor.atEnd) {
      insertAt = out.length;
    } else if (anchor.before) {
      const i = out.findIndex((b) => b.id === anchor.before);
      insertAt = i >= 0 ? i : findFallbackIndex(out, anchor.before);
    } else if (anchor.after) {
      const i = out.findIndex((b) => b.id === anchor.after);
      if (i >= 0) insertAt = i + 1;
      else if (anchor.afterFallback) {
        const j = out.findIndex((b) => b.id === anchor.afterFallback);
        insertAt = j >= 0 ? j + 1 : out.length;
      }
    }
    out.splice(insertAt, 0, block);
  }
  return out;
}
function findFallbackIndex(blocks, _anchorId) {
  return blocks.length;
}
function renderSegments(blocks) {
  return blocks.map((b) => b.text).join("\n\n");
}
function segmentIds(blocks) {
  return blocks.map((b) => b.id);
}
var injectSources = /* @__PURE__ */ new Map();
var contributionSources = /* @__PURE__ */ new Map();
function registerPromptContributionSource(ownerId, source) {
  if (!ownerId) throw new Error("prompt contribution \u7F3A\u5C11 ownerId");
  if (typeof source?.text !== "function") throw new Error(`prompt contribution ${ownerId} \u7F3A\u5C11 text(ctx) \u51FD\u6570`);
  contributionSources.set(String(ownerId), {
    at: String(source.at || "after-skill-sections"),
    order: Number(source.order) || 100,
    priority: Number(source.priority) || 50,
    text: source.text
  });
}
function unregisterPromptContributionSource(ownerId) {
  return contributionSources.delete(String(ownerId));
}
function registerPromptInjectSource(ownerId, source) {
  if (!ownerId) throw new Error("promptinject \u7F3A\u5C11 ownerId");
  if (!Array.isArray(source?.injects)) throw new Error(`promptinject ${ownerId} \u7F3A\u5C11 injects[]`);
  injectSources.set(String(ownerId), {
    order: Number(source.order) || 100,
    injects: source.injects,
    append: typeof source.append === "function" ? source.append : null,
    rewrite: typeof source.rewrite === "function" ? source.rewrite : null,
    enabled: typeof source.enabled === "function" ? source.enabled : null
  });
}
function unregisterPromptInjectSource(ownerId) {
  return injectSources.delete(String(ownerId));
}
function listPromptInjectSources() {
  return [...injectSources.keys()];
}
function clearPromptInjectSources() {
  injectSources.clear();
  contributionSources.clear();
}
function collectPromptInjects(ctx = {}) {
  const rewrites = [];
  const appends = [];
  const errors = [];
  for (const [ownerId, src] of injectSources) {
    if (src.enabled) {
      try {
        if (!src.enabled(ctx)) continue;
      } catch {
        continue;
      }
    }
    for (const rule of src.injects) {
      const kind = String(rule?.kind || "");
      try {
        if (kind === "append") {
          if (!src.append) continue;
          const raw = src.append({ rule, ctx });
          if (typeof raw !== "string") {
            if (raw && typeof raw.then === "function") {
              errors.push(`${ownerId}/${rule.id}\uFF1Aappend \u8FD4\u56DE\u4E86 Promise\uFF08\u5FC5\u987B\u540C\u6B65\uFF09`);
            }
            continue;
          }
          const text = renderTemplate(raw, { ownerId, vars: ctx?.vars }).text;
          if (!text.trim()) continue;
          appends.push({
            at: rule.at,
            ownerId,
            injectId: rule.id,
            text,
            order: src.order,
            priority: Number(rule.priority) || 50
          });
        } else if (kind === "rewrite") {
          if (!src.rewrite) continue;
          rewrites.push({
            target: rule.target,
            ownerId,
            injectId: rule.id,
            order: src.order,
            priority: Number(rule.priority) || 50,
            fn: (original) => {
              const raw = src.rewrite({ rule, ctx, original });
              if (typeof raw !== "string") {
                if (raw && typeof raw.then === "function") {
                  errors.push(`${ownerId}/${rule.id}\uFF1Arewrite \u8FD4\u56DE\u4E86 Promise\uFF08\u5FC5\u987B\u540C\u6B65\uFF09`);
                }
                return original;
              }
              return renderTemplate(raw, { ownerId, vars: ctx?.vars }).text;
            }
          });
        }
      } catch (error) {
        errors.push(`${ownerId}/${rule?.id || "?"}\uFF1A${error?.message ?? error}`);
      }
    }
  }
  const winners = resolveRewriteConflicts(rewrites);
  const effectiveRewrites = rewrites.filter((r) => winners.get(r.target) === r.ownerId);
  for (const [ownerId, src] of contributionSources) {
    try {
      const text = src.text(ctx);
      if (typeof text !== "string" || !text.trim()) continue;
      appends.push({
        at: src.at,
        ownerId,
        injectId: "contribution",
        text,
        order: src.order,
        priority: src.priority
      });
    } catch (error) {
      errors.push(`${ownerId}/contribution\uFF1A${error?.message ?? error}`);
    }
  }
  return { rewrites: effectiveRewrites, appends, errors, conflicts: winners };
}

// packages/extension-compat/vendor/src/extensions/tab-registry.js
var tab_registry_exports = {};
__export(tab_registry_exports, {
  clearTabs: () => clearTabs,
  getTab: () => getTab,
  listTabs: () => listTabs,
  listTabsFor: () => listTabsFor,
  registerTab: () => registerTab,
  unregisterTab: () => unregisterTab,
  unregisterTabsByOwner: () => unregisterTabsByOwner,
  validateTab: () => validateTab
});
var tabs = /* @__PURE__ */ new Map();
var MODES = /* @__PURE__ */ new Set(["template", "iframe", "script"]);
var SURFACES = /* @__PURE__ */ new Set(["repo", "session", "both"]);
var ID_RE = /^[a-z][a-z0-9-]*$/;
function validateTab(spec = {}) {
  const v = [];
  if (!ID_RE.test(String(spec.id || ""))) v.push(`\u9875\u7B7E id \u4E0D\u5408\u6CD5\uFF1A${spec.id}`);
  if (!spec.label) v.push("\u7F3A\u5C11 label");
  const mode = String(spec.mode || "template");
  if (!MODES.has(mode)) v.push(`mode \u53EA\u80FD\u662F template/iframe/script\uFF1A${mode}`);
  if (mode === "template" && !spec.dataUrl) v.push("template \u6A21\u5F0F\u5FC5\u987B\u63D0\u4F9B dataUrl");
  if (mode === "iframe" && !spec.page) v.push("iframe \u6A21\u5F0F\u5FC5\u987B\u63D0\u4F9B page\uFF08\u5305\u5185 HTML \u76F8\u5BF9\u8DEF\u5F84\uFF09");
  if (mode === "script" && !spec.script) v.push("script \u6A21\u5F0F\u5FC5\u987B\u63D0\u4F9B script\uFF08\u5305\u5185 JS \u76F8\u5BF9\u8DEF\u5F84\uFF09");
  const surface = String(spec.surface || "repo");
  if (!SURFACES.has(surface)) v.push("surface \u53EA\u80FD\u662F repo/session/both");
  return { ok: v.length === 0, violations: v };
}
function registerTab(spec, { ownerId, scope = "global", builtin = false } = {}) {
  if (String(scope) === "session") {
    return { ok: false, error: "\u4F1A\u8BDD\u7EA7\u63D2\u4EF6\u4E0D\u80FD\u6CE8\u518C\u6269\u5C55\u4ED3\u5E93\u9875\u7B7E\uFF08\u53EA\u6709\u5168\u5C40\u63D2\u4EF6\u53EF\u4EE5\uFF09" };
  }
  const check = validateTab(spec);
  if (!check.ok) return { ok: false, error: check.violations.join("\uFF1B") };
  const mode = String(spec.mode || "template");
  if (mode === "script" && !builtin) {
    return { ok: false, error: "script \u6A21\u5F0F\u4EC5\u9650\u5185\u7F6E\u63D2\u4EF6\uFF08\u7B2C\u4E09\u65B9\u8BF7\u7528 iframe\uFF09" };
  }
  const tab = {
    id: String(spec.id),
    label: String(spec.label),
    icon: String(spec.icon || "\u{1F9E9}"),
    order: Number(spec.order) || 500,
    mode,
    dataUrl: spec.dataUrl ? String(spec.dataUrl) : "",
    detailUrl: spec.detailUrl ? String(spec.detailUrl) : "",
    page: spec.page ? String(spec.page) : "",
    script: spec.script ? String(spec.script) : "",
    hint: spec.hint ? String(spec.hint) : "",
    surface: String(spec.surface || "repo"),
    ownerId: String(ownerId || ""),
    scope: String(scope),
    builtin: Boolean(builtin)
  };
  tabs.set(tab.id, tab);
  return { ok: true, tab };
}
function unregisterTab(id) {
  return tabs.delete(String(id));
}
function unregisterTabsByOwner(ownerId) {
  let n = 0;
  for (const [id, t] of tabs) {
    if (t.ownerId === String(ownerId)) {
      tabs.delete(id);
      n += 1;
    }
  }
  return n;
}
function getTab(id) {
  return tabs.get(String(id)) || null;
}
function listTabs() {
  return [...tabs.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
function listTabsFor(surface) {
  const s = String(surface);
  return listTabs().filter((t) => t.surface === s || t.surface === "both");
}
function clearTabs() {
  tabs.clear();
}

// packages/extension-compat/vendor/src/extensions/type-catalog.js
var type_catalog_exports = {};
__export(type_catalog_exports, {
  BUILTIN_TYPE_TABS: () => BUILTIN_TYPE_TABS,
  UI_SLOTS: () => UI_SLOTS,
  listExtensionTypes: () => listExtensionTypes
});

// packages/extension-compat/vendor/src/extensions/ui-registry.js
var ui_registry_exports = {};
__export(ui_registry_exports, {
  DECLARATIVE_TYPES: () => DECLARATIVE_TYPES,
  UIExtensionRegistry: () => UIExtensionRegistry,
  UI_SLOTS: () => UI_SLOTS,
  UI_SLOT_API_VERSION: () => UI_SLOT_API_VERSION,
  sanitizePayload: () => sanitizePayload,
  uiExtensionRegistry: () => uiExtensionRegistry,
  validateContribution: () => validateContribution
});
var UI_SLOT_API_VERSION = 1;
var UI_SLOTS = {
  "shell.nav.primary": {
    page: "shell",
    label: "\u4E3B\u5BFC\u822A / \u6269\u5C55\u83DC\u5355",
    description: "\u5728\u300C\u6269\u5C55\u300D\u83DC\u5355\u4E0B\u589E\u52A0\u63D2\u4EF6\u81EA\u6709\u9875\u9762\u5165\u53E3",
    allowedKinds: ["declarative", "module"],
    allowReplace: false,
    maxItems: 12
  },
  "shell.status.right": {
    page: "shell",
    label: "\u9876\u680F\u72B6\u6001\u533A",
    description: "\u9876\u680F\u53F3\u4FA7\u7684\u72B6\u6001\u5FBD\u6807\u6216\u7B80\u77ED\u72B6\u6001\u5757",
    allowedKinds: ["declarative"],
    allowReplace: false,
    maxItems: 6
  },
  "page.chatmanage.session-list.row-actions": {
    page: "chatmanage",
    label: "\u4F1A\u8BDD\u5217\u8868\u9879\u64CD\u4F5C",
    description: "\u6BCF\u4E2A\u4F1A\u8BDD\u6761\u76EE\u4E0A\u7684\u64CD\u4F5C\u83DC\u5355\u9879",
    allowedKinds: ["declarative"],
    allowReplace: false,
    maxItems: 8
  },
  "page.chatmanage.session-detail.header-actions": {
    page: "chatmanage",
    label: "\u4F1A\u8BDD\u8BE6\u60C5\u6807\u9898\u64CD\u4F5C",
    description: "\u4F1A\u8BDD\u8BE6\u60C5\u6807\u9898\u680F\u7684\u6309\u94AE\u4E0E\u72B6\u6001\u5FBD\u6807",
    allowedKinds: ["declarative", "module"],
    allowReplace: false,
    maxItems: 8
  },
  "page.chatmanage.session-detail.tabs": {
    page: "chatmanage",
    label: "\u4F1A\u8BDD\u8BE6\u60C5\u5B50\u9875\u7B7E",
    description: "\u5728\u8FD0\u884C\u8BB0\u5F55/\u5B58\u6863/\u8BB0\u5FC6\u4E4B\u5916\u589E\u52A0\u63D2\u4EF6\u81EA\u5DF1\u7684\u5B50\u9875",
    allowedKinds: ["declarative", "module"],
    allowReplace: false,
    maxItems: 6
  },
  "page.chatmanage.session-settings.sections": {
    page: "chatmanage",
    label: "\u4F1A\u8BDD\u8BBE\u7F6E\u5206\u533A",
    description: "\u4F1A\u8BDD\u4E2A\u6027\u5316\u9762\u677F\u4E2D\u7684\u989D\u5916\u8BBE\u7F6E\u5206\u533A",
    allowedKinds: ["declarative"],
    allowReplace: false,
    maxItems: 8
  },
  "page.prompts.editor.actions": {
    page: "prompts",
    label: "\u63D0\u793A\u8BCD\u7F16\u8F91\u5DE5\u5177\u680F",
    description: "\u63D0\u793A\u8BCD\u7BA1\u7406\u9875\u7684\u989D\u5916\u64CD\u4F5C\u6309\u94AE",
    allowedKinds: ["declarative"],
    allowReplace: false,
    maxItems: 8
  },
  "page.extensions.types": {
    page: "extensions",
    label: "\u6269\u5C55\u7C7B\u578B\u9875\u7B7E",
    description: "\u5411\u300C\u6269\u5C55\u4ED3\u5E93\u300D\u8FFD\u52A0\u4E00\u4E2A\u7C7B\u578B\u9875\u7B7E\uFF08payload: id/label/icon/order/template/type\uFF09",
    allowedKinds: ["declarative"],
    allowReplace: false,
    maxItems: 12
  },
  "page.settings.model.extra": {
    page: "settings",
    label: "\u6A21\u578B\u914D\u7F6E\u9644\u52A0\u9879",
    description: "\u5728\u6A21\u578B\u914D\u7F6E\u533A\u589E\u52A0\u8BBE\u7F6E\u9879\uFF08\u5982\u77E5\u8BC6\u5E93\u6458\u8981\u6A21\u578B\uFF09",
    allowedKinds: ["declarative"],
    allowReplace: false,
    maxItems: 4
  },
  "page.usage.summary.cards": {
    page: "usage",
    label: "\u7528\u91CF\u6458\u8981\u5361\u7247",
    description: "\u7528\u91CF\u9875\u6458\u8981\u533A\u7684\u6307\u6807\u5361\u7247\u6216\u72B6\u6001\u9762\u677F",
    allowedKinds: ["declarative", "module"],
    allowReplace: false,
    maxItems: 6
  },
  "page.extensions.repository.card-actions": {
    page: "plugins",
    label: "\u6269\u5C55\u4ED3\u5E93\u5361\u7247\u64CD\u4F5C",
    description: "\u6269\u5C55\u5361\u7247\u4E0A\u7684\u64CD\u4F5C\u6309\u94AE\uFF08\u53EA\u8BFB/\u8BCA\u65AD\u7C7B\uFF0C\u4E0D\u6539\u542F\u505C\u6838\u5FC3\u63A7\u4EF6\uFF09",
    allowedKinds: ["declarative"],
    allowReplace: false,
    maxItems: 6
  },
  "page.extensions.repository.detail-tabs": {
    page: "plugins",
    label: "\u6269\u5C55\u8BE6\u60C5\u9875\u7B7E",
    description: "\u6269\u5C55\u8BE6\u60C5\u91CC\u7684\u989D\u5916\u4FE1\u606F\u9875\u7B7E",
    allowedKinds: ["declarative", "module"],
    allowReplace: false,
    maxItems: 6
  }
};
var DECLARATIVE_TYPES = /* @__PURE__ */ new Set([
  "text",
  "badge",
  "card",
  "metric",
  "list",
  "table",
  "form",
  "button",
  "menuItem",
  "link",
  "divider"
]);
var LIMITS = {
  maxDepth: 6,
  maxString: 4e3,
  maxArray: 100,
  maxProps: 40
};
function sanitizePayload(raw, depth = 0) {
  if (depth > LIMITS.maxDepth) return { ok: false, error: "payload \u5D4C\u5957\u8D85\u8FC7\u4E0A\u9650" };
  if (raw === null || raw === void 0) return { ok: true, payload: null };
  if (typeof raw === "string") {
    return { ok: true, payload: raw.slice(0, LIMITS.maxString) };
  }
  if (typeof raw === "number" || typeof raw === "boolean") return { ok: true, payload: raw };
  if (Array.isArray(raw)) {
    const out = [];
    for (const item of raw.slice(0, LIMITS.maxArray)) {
      const r = sanitizePayload(item, depth + 1);
      if (!r.ok) return r;
      out.push(r.payload);
    }
    return { ok: true, payload: out };
  }
  if (typeof raw === "object") {
    const out = {};
    const entries = Object.entries(raw).slice(0, LIMITS.maxProps);
    for (const [k, v] of entries) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      const r = sanitizePayload(v, depth + 1);
      if (!r.ok) return r;
      out[k] = r.payload;
    }
    return { ok: true, payload: out };
  }
  return { ok: true, payload: null };
}
function validateContribution(contribution, { isTrustedPlugin = false } = {}) {
  const c = contribution || {};
  const violations = [];
  const point = String(c.point || "");
  const slot = UI_SLOTS[point];
  if (!slot) violations.push(`\u672A\u77E5\u63D2\u69FD\uFF1A${point}`);
  const apiVersion = Number(c.apiVersion) || UI_SLOT_API_VERSION;
  if (apiVersion !== UI_SLOT_API_VERSION) {
    violations.push(`\u63D2\u69FD API \u7248\u672C\u4E0D\u5339\u914D\uFF1A${c.apiVersion}\uFF08\u5F53\u524D\u652F\u6301 ${UI_SLOT_API_VERSION}\uFF09`);
  }
  const kind = String(c.kind || "declarative");
  if (!["declarative", "module"].includes(kind)) violations.push(`kind \u975E\u6CD5\uFF1A${kind}`);
  if (slot && !slot.allowedKinds.includes(kind)) {
    violations.push(`\u63D2\u69FD ${point} \u4E0D\u5141\u8BB8 ${kind} \u8D21\u732E\uFF08\u5141\u8BB8\uFF1A${slot.allowedKinds.join("/")}\uFF09`);
  }
  if (kind === "module" && !isTrustedPlugin) {
    violations.push("\u53EA\u6709\u968F\u5E94\u7528\u53D1\u5E03\u7684\u5185\u7F6E\u53EF\u4FE1\u63D2\u4EF6\u53EF\u4EE5\u6302\u8F7D UI \u6A21\u5757");
  }
  if (kind === "declarative") {
    const p = c.payload;
    if (!p || typeof p !== "object") violations.push("\u7F3A\u5C11 payload");
    else if (!DECLARATIVE_TYPES.has(String(p.type || ""))) {
      violations.push(`\u7EC4\u4EF6\u7C7B\u578B\u4E0D\u5728\u767D\u540D\u5355\uFF1A${p.type}\uFF08\u5141\u8BB8\uFF1A${[...DECLARATIVE_TYPES].join("/")}\uFF09`);
    }
    const sr = sanitizePayload(p);
    if (!sr.ok) violations.push(sr.error);
  }
  if (kind === "module" && !c.entry) violations.push("module \u8D21\u732E\u7F3A\u5C11 entry");
  if (!c.id) violations.push("\u7F3A\u5C11\u8D21\u732E id");
  return { ok: violations.length === 0, violations };
}
var UIExtensionRegistry = class {
  constructor() {
    this.contributions = /* @__PURE__ */ new Map();
    this.actions = /* @__PURE__ */ new Map();
  }
  /**
   * 登记一条 UI 贡献。
   * @returns {{ok: boolean, error?: string}}
   */
  register(contribution, { isTrustedPlugin = false } = {}) {
    const v = validateContribution(contribution, { isTrustedPlugin });
    if (!v.ok) return { ok: false, error: v.violations.join("\uFF1B") };
    const ownerId = String(contribution.ownerId || "");
    if (!ownerId) return { ok: false, error: "\u7F3A\u5C11 ownerId" };
    const key = `${ownerId}:${contribution.id}`;
    this.contributions.set(key, {
      ownerId,
      id: String(contribution.id),
      point: String(contribution.point),
      kind: contribution.kind || "declarative",
      apiVersion: Number(contribution.apiVersion) || UI_SLOT_API_VERSION,
      order: Number(contribution.order) || 100,
      priority: Number(contribution.priority) || 50,
      title: String(contribution.title || ""),
      entry: contribution.entry ? String(contribution.entry) : "",
      payload: contribution.kind === "module" ? null : sanitizePayload(contribution.payload).payload,
      actions: Array.isArray(contribution.actions) ? contribution.actions.slice(0, 10).map((a) => ({
        id: String(a?.id || ""),
        label: String(a?.label || "").slice(0, 60),
        actionId: String(a?.actionId || "")
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
    const list = [...this.contributions.values()].filter((c) => c.point === point).filter((c) => !enabledOwners || enabledOwners(c.ownerId)).sort((a, b) => a.order - b.order || b.priority - a.priority || a.id.localeCompare(b.id));
    return slot ? list.slice(0, slot.maxItems) : list;
  }
  /** 某页面的全部贡献（前端一次拉全）。 */
  listByPage(page) {
    const points = Object.entries(UI_SLOTS).filter(([, slot]) => slot.page === page).map(([id]) => id);
    return [...this.contributions.values()].filter((c) => points.includes(c.point));
  }
  list() {
    return [...this.contributions.values()];
  }
  // ── UI 动作（受控后端调用）────────────────────────────────────────────
  /**
   * 登记一个 UI 动作。owner 必须已登记为子扩展（由管理器插件负责）。
   */
  registerAction({ ownerId, actionId, inputSchema = null, handler, mutates = false }) {
    if (!ownerId || !actionId) throw new Error("UI \u52A8\u4F5C\u9700\u8981 ownerId \u4E0E actionId");
    if (typeof handler !== "function") throw new Error("UI \u52A8\u4F5C\u9700\u8981 handler \u51FD\u6570");
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
    if (!action) return { ok: false, error: `\u672A\u77E5 UI \u52A8\u4F5C\uFF1A${key}` };
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
};
var uiExtensionRegistry = new UIExtensionRegistry();

// packages/extension-compat/vendor/src/extensions/type-catalog.js
var BUILTIN_TYPE_TABS = [
  // 只有「插件」两页由核心内置（它们是第一公民，始终存在）。
  // 工具 / MCP / 技能 / 知识 / 上下文 的页签由各自的管理器插件注册（见 tab-registry）。
  { id: "plugin", label: "\u5168\u5C40\u63D2\u4EF6", icon: "\u{1F310}", order: 10, template: "module", type: null, scope: "global", kind: "plugin" },
  { id: "chat-plugin", label: "\u4F1A\u8BDD\u63D2\u4EF6", icon: "\u{1F4AC}", order: 15, template: "module", type: null, scope: "session", kind: "plugin" }
];
function listExtensionTypes(surface = "") {
  const custom = [];
  try {
    const items = uiExtensionRegistry.listBySlot?.("page.extensions.types") || [];
    for (const it of items) {
      const p = it.payload || {};
      const id = String(p.id || it.id || "").trim();
      if (!id) continue;
      custom.push({
        id,
        label: String(p.label || id),
        icon: String(p.icon || "\u{1F9E9}"),
        order: Number(p.order) || 500,
        template: p.template === "module" ? "module" : "cards",
        type: p.type === null ? null : String(p.type || id),
        from: it.ownerId || "extension"
      });
    }
  } catch {
  }
  const seen = new Set(BUILTIN_TYPE_TABS.map((t) => t.id));
  const owned = listTabs().map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    order: t.order,
    template: t.mode === "template" ? "cards" : t.mode,
    type: t.mode === "template" ? t.id : null,
    dataUrl: t.dataUrl,
    detailUrl: t.detailUrl,
    page: t.page,
    script: t.script,
    hint: t.hint,
    ownerId: t.ownerId,
    surface: t.surface || "repo"
  }));
  const merged = [...BUILTIN_TYPE_TABS, ...owned, ...custom.filter((c) => !seen.has(c.id))];
  const filtered = surface ? merged.filter((t) => t.surface === surface || t.surface === "both") : merged;
  return filtered.sort((a, b) => (a.order || 100) - (b.order || 100));
}

// packages/extension-compat/vendor/src/sandbox/index.js
var sandbox_exports = {};
__export(sandbox_exports, {
  clearSkillScripts: () => clearSkillScripts,
  getSkillPackage: () => getSkillPackage,
  isContainerAvailable: () => isContainerAvailable,
  listSkillPackages: () => listSkillPackages,
  registerContainerBackend: () => registerContainerBackend,
  registerSkillScripts: () => registerSkillScripts,
  resolveScript: () => resolveScript,
  runInSandbox: () => runInSandbox,
  runSkillScript: () => runSkillScript,
  unregisterSkillScripts: () => unregisterSkillScripts
});
var import_node_worker_threads = require("node:worker_threads");
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var DOC_EXT = /* @__PURE__ */ new Set([".js"]);
var containerBackend = null;
function registerContainerBackend(backend) {
  containerBackend = backend && typeof backend.run === "function" ? backend : null;
}
function isContainerAvailable(context = {}) {
  if (!containerBackend) return false;
  try {
    if (typeof containerBackend.probe === "function") {
      const r = containerBackend.probe(context);
      return r?.ok !== false;
    }
  } catch {
    return false;
  }
  return true;
}
var scripts = /* @__PURE__ */ new Map();
function registerSkillScripts(skillId, pkg) {
  const list = (Array.isArray(pkg?.scripts) ? pkg.scripts : []).map((s) => ({
    path: String(s?.path || "").replace(/\\/g, "/"),
    lang: String(s?.lang || "js").toLowerCase(),
    description: String(s?.description || ""),
    docId: s?.docId ? String(s.docId) : ""
  })).filter((s) => s.path);
  scripts.set(String(skillId), { dir: String(pkg?.dir || ""), scripts: list });
  return list.length;
}
function unregisterSkillScripts(skillId) {
  return scripts.delete(String(skillId));
}
function clearSkillScripts() {
  scripts.clear();
}
function getSkillPackage(skillId) {
  return scripts.get(String(skillId)) || null;
}
function listSkillPackages() {
  return [...scripts.entries()].map(([id, v]) => ({ id, dir: v.dir, scripts: v.scripts }));
}
function resolveScript({ skillId, script, lang = "js" }) {
  const pkg = getSkillPackage(skillId);
  if (!pkg) return { ok: false, error: `\u672A\u77E5\u6280\u80FD\uFF1A${skillId}\uFF08\u672A\u52A0\u8F7D\u6216\u672A\u542F\u7528\uFF09` };
  const wantLang = String(lang || "js").toLowerCase();
  if (wantLang !== "js") {
    return { ok: false, error: `\u964D\u7EA7\u540E\u7AEF\u53EA\u652F\u6301 js\uFF08\u5F53\u524D ${wantLang}\uFF09\uFF1B\u9700\u8981\u5176\u5B83\u8BED\u8A00\u8BF7\u63A5\u5165\u5BB9\u5668\u540E\u7AEF` };
  }
  const rel = String(script || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const entry = pkg.scripts.find((s) => s.path === rel);
  if (!entry) {
    const avail = pkg.scripts.map((s) => s.path).slice(0, 10);
    return { ok: false, error: `\u811A\u672C\u672A\u5728 skill.json \u7684 scripts[] \u4E2D\u58F0\u660E\uFF1A${rel}${avail.length ? `\uFF08\u53EF\u7528\uFF1A${avail.join("\u3001")}\uFF09` : ""}` };
  }
  if (entry.lang !== "js") return { ok: false, error: `\u8BE5\u811A\u672C\u8BED\u8A00\u4E3A ${entry.lang}\uFF0C\u964D\u7EA7\u540E\u7AEF\u53EA\u652F\u6301 js` };
  if (!DOC_EXT.has(import_node_path.default.extname(rel).toLowerCase())) return { ok: false, error: `\u53EA\u5141\u8BB8 .js \u811A\u672C\uFF1A${rel}` };
  const abs = import_node_path.default.resolve(pkg.dir, rel);
  const relToDir = import_node_path.default.relative(pkg.dir, abs);
  if (!relToDir || relToDir.startsWith("..") || import_node_path.default.isAbsolute(relToDir)) {
    return { ok: false, error: `\u811A\u672C\u8DEF\u5F84\u8D8A\u754C\uFF1A${rel}` };
  }
  try {
    const realDir = import_node_fs.default.realpathSync(pkg.dir);
    const realAbs = import_node_fs.default.realpathSync(abs);
    const relReal = import_node_path.default.relative(realDir, realAbs);
    if (relReal.startsWith("..") || import_node_path.default.isAbsolute(relReal)) {
      return { ok: false, error: `\u811A\u672C\u7ECF\u7B26\u53F7\u94FE\u63A5\u8D8A\u754C\uFF1A${rel}` };
    }
  } catch {
  }
  if (!import_node_fs.default.existsSync(abs)) return { ok: false, error: `\u811A\u672C\u4E0D\u5B58\u5728\uFF1A${rel}` };
  let source = "";
  try {
    source = import_node_fs.default.readFileSync(abs, "utf8");
  } catch (e) {
    return { ok: false, error: `\u8BFB\u53D6\u5931\u8D25\uFF1A${e?.message ?? e}` };
  }
  if (source.length > 256 * 1024) return { ok: false, error: "\u811A\u672C\u8D85\u8FC7 256KB \u4E0A\u9650" };
  return { ok: true, abs, source, entry, dir: pkg.dir };
}
var RUNNER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const { source, args, argv, filename, timeoutMs } = workerData;
const logs = [];
const api = {
  log: (...a) => { if (logs.length < 200) logs.push(a.map((x) => String(x)).join(' ')); },
  now: () => Date.now()
};
function done(msg) { try { parentPort.postMessage(msg); } catch { /* ignore */ } }
try {
  const module = { exports: {} };
  const sandbox = Object.create(null);
  sandbox.module = module;
  sandbox.exports = module.exports;
  sandbox.args = args || {};
  sandbox.argv = argv || [];
  sandbox.api = api;
  sandbox.console = { log: api.log };
  const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(String(source), { filename }).runInContext(ctx, { timeout: timeoutMs });
  const fn = module.exports;
  if (typeof fn !== 'function') {
    done({ ok: false, error: '脚本必须导出 module.exports = async ({ args, api }) => ({ content })', logs });
  } else {
    Promise.resolve(fn({ args: sandbox.args, argv: sandbox.argv, api })).then(
      (out) => done({ ok: true, result: out, logs }),
      (e) => done({ ok: false, error: String(e && e.message ? e.message : e), logs })
    );
  }
} catch (e) {
  done({ ok: false, error: String(e && e.message ? e.message : e), logs });
}
`;
async function runInSandbox(job) {
  const startedAt = Date.now();
  const timeoutMs = Math.max(200, Number(job.timeoutMs) || 5e3);
  const memoryMb = Math.min(256, Math.max(16, Number(job.memoryMb) || 64));
  return await new Promise((resolve) => {
    let settled = false;
    let worker = null;
    let timer = null;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        worker?.terminate();
      } catch {
      }
      resolve({
        ...payload,
        logs: Array.isArray(payload.logs) ? payload.logs : [],
        backend: "sandbox",
        durationMs: Date.now() - startedAt
      });
    };
    try {
      worker = new import_node_worker_threads.Worker(RUNNER_SOURCE, {
        eval: true,
        workerData: {
          source: job.source,
          args: job.args || {},
          argv: Array.isArray(job.argv) ? job.argv : [],
          filename: job.abs || "skill-script.js",
          timeoutMs
        },
        resourceLimits: { maxOldGenerationSizeMb: memoryMb }
      });
    } catch (error) {
      finish({ ok: false, error: `\u65E0\u6CD5\u542F\u52A8\u811A\u672C\u6C99\u7BB1\uFF1A${error?.message ?? error}` });
      return;
    }
    timer = setTimeout(() => finish({ ok: false, error: `\u811A\u672C\u6267\u884C\u8D85\u65F6\uFF08${timeoutMs}ms\uFF09` }), timeoutMs + 1500);
    worker.once("message", (msg) => finish(msg));
    worker.once("error", (error) => finish({ ok: false, error: `\u811A\u672C\u8FDB\u7A0B\u5D29\u6E83\uFF1A${error?.message ?? error}` }));
    worker.once("exit", (code) => {
      if (code !== 0) finish({ ok: false, error: `\u811A\u672C\u8FDB\u7A0B\u9000\u51FA\uFF08code ${code}\uFF09` });
    });
  });
}
async function runSkillScript(job) {
  let degrade = null;
  if (containerBackend) {
    let available6 = { ok: true };
    try {
      available6 = typeof containerBackend.available === "function" ? await containerBackend.available(job) : { ok: true };
    } catch (error) {
      available6 = { ok: false, reason: String(error?.message ?? error) };
    }
    if (available6?.ok === false) {
      degrade = { from: "container", reason: String(available6.reason || "\u5BB9\u5668\u4E0D\u53EF\u7528") };
    } else {
      try {
        const out2 = await containerBackend.run(job);
        return { ...out2, backend: out2?.backend || "container" };
      } catch (error) {
        return { ok: false, error: `\u5BB9\u5668\u540E\u7AEF\u5931\u8D25\uFF1A${error?.message ?? error}`, logs: [], backend: "container", durationMs: 0 };
      }
    }
  }
  const hardLimitMs = Math.max(1e3, Number(job.timeoutMs) || 5e3) + 3e3;
  const hard = new Promise((resolve) => {
    const t = setTimeout(() => resolve({
      ok: false,
      error: `\u811A\u672C\u6267\u884C\u8D85\u65F6\uFF08\u786C\u4E0A\u9650 ${hardLimitMs}ms\uFF09`,
      logs: [],
      backend: "sandbox",
      durationMs: hardLimitMs
    }), hardLimitMs);
    t.unref?.();
  });
  const out = await Promise.race([runInSandbox(job), hard]);
  return degrade ? { ...out, degradedFrom: degrade.from, degradeReason: degrade.reason } : out;
}

// packages/extension-compat/vendor/src/extensions/importer.js
var importer_exports = {};
__export(importer_exports, {
  analyzeEntries: () => analyzeEntries,
  analyzeZip: () => analyzeZip,
  installEntries: () => installEntries,
  installZip: () => installZip,
  publicAnalysis: () => publicAnalysis
});
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
var import_node_url = require("node:url");

// packages/extension-compat/vendor/src/zip-install.js
var zip_install_exports = {};
__export(zip_install_exports, {
  unzipToModuleDir: () => unzipToModuleDir,
  validateZipStructure: () => validateZipStructure
});
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var import_node_zlib = require("node:zlib");
var BANNED_EXT = /\.(exe|dll|bat|cmd|ps1|vbs|sh)$/i;
var MAX_FILES = 100;
var MAX_TOTAL = 32 * 1024 * 1024;
var MANIFEST_RE = /(^|\/)(skill|plugin)\.json$/i;
function validateZipStructure(buffer) {
  const entries = parseZip(buffer);
  if (entries.length > MAX_FILES) throw new Error(`\u6587\u4EF6\u6570\u91CF\u8FC7\u591A\uFF08${entries.length} > ${MAX_FILES}\uFF09`);
  let total = 0;
  for (const e of entries) total += e.data.length;
  if (total > MAX_TOTAL) throw new Error("\u89E3\u538B\u540E\u603B\u5927\u5C0F\u8D85\u8FC7 32MB");
  return entries;
}
function dirOf(name) {
  const i = name.lastIndexOf("/");
  return i < 0 ? "" : name.slice(0, i);
}
function readManifestJSON(entry) {
  try {
    return JSON.parse(entry.data.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}
function pickModuleRoot(entries) {
  const manifests = entries.filter((e) => MANIFEST_RE.test(e.name));
  if (!manifests.length) return null;
  const fileSet = new Set(entries.map((e) => e.name));
  const scored = manifests.map((e) => {
    const dir2 = dirOf(e.name);
    const depth = dir2 ? dir2.split("/").length : 0;
    const raw = readManifestJSON(e);
    let hasEntry = false;
    if (!dir2) {
      hasEntry = fileSet.has("index.js") || entries.some((x) => x.name !== e.name);
    } else {
      hasEntry = fileSet.has(`${dir2}/index.js`);
      const entryRel = String(raw?.entry || "").replace(/\\/g, "/").replace(/^\.\//, "");
      if (!hasEntry && entryRel) hasEntry = fileSet.has(`${dir2}/${entryRel}`);
    }
    return { dir: dir2, depth, hasEntry, isSkill: /(^|\/)skill\.json$/i.test(e.name) ? 1 : 0 };
  });
  scored.sort((a, b) => a.depth - b.depth || Number(b.hasEntry) - Number(a.hasEntry) || b.isSkill - a.isSkill);
  return scored[0].dir;
}
function validDirName(name) {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(String(name || ""));
}
async function unzipToModuleDir(buffer, { root, type, preferId = "" }) {
  const entries = validateZipStructure(buffer);
  if (!entries.length) throw new Error("\u5B89\u88C5\u5305\u662F\u7A7A\u7684");
  const baseDir = import_node_path2.default.join(root, type === "plugin" ? "plugins" : "skills");
  for (const e of entries) e.name = e.name.replace(/\\/g, "/");
  const moduleRoot = pickModuleRoot(entries);
  let relEntries;
  if (moduleRoot !== null) {
    const prefix = moduleRoot ? `${moduleRoot}/` : "";
    relEntries = entries.filter((e) => prefix ? e.name.startsWith(prefix) : true).map((e) => ({ ...e, rel: prefix ? e.name.slice(prefix.length) : e.name })).filter((e) => e.rel && !e.rel.endsWith("/"));
  } else {
    const names = entries.map((e) => e.name);
    const firstSeg = names[0].split("/")[0];
    const strip = firstSeg && names.every((n) => n.startsWith(`${firstSeg}/`)) ? firstSeg.length + 1 : 0;
    relEntries = entries.map((e, i) => ({ ...e, rel: names[i].slice(strip) }));
    if (relEntries.some((e) => !e.rel)) throw new Error("\u5B89\u88C5\u5305\u7ED3\u6784\u5F02\u5E38\uFF08\u5265\u6389\u6839\u76EE\u5F55\u540E\u6709\u6761\u76EE\u4E3A\u7A7A\uFF09");
  }
  if (!relEntries.length) throw new Error("\u5B89\u88C5\u5305\u7ED3\u6784\u5F02\u5E38\uFF1A\u6A21\u5757\u76EE\u5F55\u4E3A\u7A7A");
  const manifest = entries.find((e) => MANIFEST_RE.test(e.name) && dirOf(e.name) === (moduleRoot || ""));
  const manifestId = String(readManifestJSON(manifest || { data: Buffer.from("") })?.id || "");
  const rootBase = moduleRoot ? moduleRoot.split("/").pop() : "";
  const dirName = [preferId, manifestId, rootBase, "module"].find(validDirName) || "module";
  let finalName = dirName;
  for (let n = 1; n <= 100; n++) {
    if (!import_node_fs2.default.existsSync(import_node_path2.default.join(baseDir, finalName))) break;
    finalName = `${dirName}_${n}`;
  }
  const target = import_node_path2.default.join(baseDir, finalName);
  try {
    import_node_fs2.default.mkdirSync(target, { recursive: true });
    for (const e of relEntries) {
      const dest = import_node_path2.default.join(target, ...e.rel.split("/"));
      const relCheck = import_node_path2.default.relative(target, dest);
      if (relCheck.startsWith("..") || import_node_path2.default.isAbsolute(relCheck)) {
        throw new Error(`\u5B89\u88C5\u5305\u5305\u542B\u975E\u6CD5\u8DEF\u5F84\uFF1A${e.name}`);
      }
      import_node_fs2.default.mkdirSync(import_node_path2.default.dirname(dest), { recursive: true });
      import_node_fs2.default.writeFileSync(dest, e.data);
    }
    const hasManifest = import_node_fs2.default.existsSync(import_node_path2.default.join(target, "skill.json")) || import_node_fs2.default.existsSync(import_node_path2.default.join(target, "plugin.json"));
    if (!hasManifest) {
      throw new Error("\u5B89\u88C5\u5305\u7ED3\u6784\u5F02\u5E38\uFF1A\u672A\u627E\u5230 skill.json / plugin.json\uFF08\u53EF\u80FD\u591A\u5957\u4E86\u4E00\u5C42\u6587\u4EF6\u5939\uFF09");
    }
  } catch (error) {
    try {
      import_node_fs2.default.rmSync(target, { recursive: true, force: true });
    } catch {
    }
    throw error;
  }
  return finalName;
}
function parseZip(buffer) {
  const sig = (off) => buffer.readUInt32LE(off);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65536); i--) {
    if (sig(i) === 101010256) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("\u4E0D\u662F\u6709\u6548\u7684 zip \u6587\u4EF6");
  const count = buffer.readUInt16LE(eocd + 10);
  let ptr = buffer.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (sig(ptr) !== 33639248) throw new Error("zip \u4E2D\u592E\u76EE\u5F55\u635F\u574F");
    const method = buffer.readUInt16LE(ptr + 10);
    const compSize = buffer.readUInt32LE(ptr + 20);
    const nameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localOff = buffer.readUInt32LE(ptr + 42);
    const name = buffer.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    if (!name.endsWith("/")) {
      if (sig(localOff) !== 67324752) throw new Error("zip \u672C\u5730\u5934\u635F\u574F");
      const lNameLen = buffer.readUInt16LE(localOff + 26);
      const lExtraLen = buffer.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buffer.subarray(dataStart, dataStart + compSize);
      let data;
      if (method === 0) data = Buffer.from(raw);
      else if (method === 8) data = (0, import_node_zlib.inflateRawSync)(raw);
      else throw new Error(`\u4E0D\u652F\u6301\u7684\u538B\u7F29\u65B9\u5F0F\uFF08method=${method}\uFF09\uFF1A${name}`);
      out.push({ name: name.replace(/\\/g, "/"), data });
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  for (const e of out) {
    const parts = e.name.split("/");
    if (e.name.startsWith("/") || parts.includes("..")) throw new Error(`\u5B89\u88C5\u5305\u5305\u542B\u975E\u6CD5\u8DEF\u5F84\uFF1A${e.name}`);
    if (BANNED_EXT.test(e.name)) throw new Error(`\u5B89\u88C5\u5305\u5305\u542B\u7981\u6B62\u7684\u6587\u4EF6\u7C7B\u578B\uFF1A${e.name}`);
  }
  return out;
}

// packages/extension-compat/vendor/src/extensions/importer.js
var APP_ROOT = import_node_path3.default.resolve(import_node_path3.default.dirname((0, import_node_url.fileURLToPath)(__extensionHost.url("src/extensions/importer.js"))), "..", "..");
var MANIFEST_TYPES = /* @__PURE__ */ new Map([
  ["tool.json", "tool"],
  ["mcp.json", "mcp"],
  ["knowledge.json", "knowledge"],
  ["promptinject.json", "promptinject"],
  ["skill.json", "skill"],
  ["plugin.json", "plugin"]
]);
var ROOT_BY_TYPE = {
  tool: "tools",
  mcp: "mcp",
  knowledge: "knowledge",
  promptinject: "promptinjects",
  skill: "skills",
  plugin: "plugins"
};
var TYPE_LABEL = {
  tool: "\u5DE5\u5177\u5305",
  mcp: "MCP \u670D\u52A1",
  knowledge: "\u77E5\u8BC6\u5E93",
  promptinject: "\u4E0A\u4E0B\u6587\u6CE8\u5165",
  skill: "\u6280\u80FD\u5305",
  plugin: "\u63D2\u4EF6"
};
var DOC_RE = /\.(md|txt)$/i;
function dirOf2(name) {
  const i = name.lastIndexOf("/");
  return i < 0 ? "" : name.slice(0, i);
}
function baseOf(name) {
  return name.slice(name.lastIndexOf("/") + 1);
}
function depthOf(name) {
  const d = dirOf2(name);
  return d ? d.split("/").length : 0;
}
function readJson(entry) {
  try {
    return JSON.parse(entry.data.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}
function analyzeZip(buffer, opts = {}) {
  return analyzeEntries(validateZipStructure(buffer), opts);
}
function analyzeEntries(entries, { root = "" } = {}) {
  if (!entries.length) throw new Error("\u5B89\u88C5\u5305\u662F\u7A7A\u7684");
  for (const e of entries) e.name = e.name.replace(/\\/g, "/");
  const manifests = entries.filter((e) => MANIFEST_TYPES.has(baseOf(e.name).toLowerCase())).sort((a, b) => depthOf(a.name) - depthOf(b.name));
  let type = "";
  let rootRel = "";
  let manifestEntry = null;
  if (manifests.length) {
    manifestEntry = manifests[0];
    type = MANIFEST_TYPES.get(baseOf(manifestEntry.name).toLowerCase());
    rootRel = dirOf2(manifestEntry.name);
  } else if (entries.some((e) => DOC_RE.test(e.name))) {
    type = "knowledge";
    const names = entries.map((e) => e.name);
    const first = names[0].split("/")[0];
    if (first && names.every((n) => n.startsWith(`${first}/`))) rootRel = first;
    else rootRel = "";
  } else {
    throw new Error("\u5B89\u88C5\u5305\u91CC\u6CA1\u6709\u8BC6\u522B\u5230\u6269\u5C55\u6E05\u5355\uFF08tool.json / mcp.json / knowledge.json / promptinject.json / skill.json / plugin.json\uFF09\uFF0C\u4E5F\u6CA1\u6709 .md / .txt \u6587\u6863");
  }
  const prefix = rootRel ? `${rootRel}/` : "";
  const files = entries.filter((e) => prefix ? e.name.startsWith(prefix) : true).map((e) => ({ rel: prefix ? e.name.slice(prefix.length) : e.name, data: e.data })).filter((e) => e.rel && !e.rel.endsWith("/"));
  if (!files.length) throw new Error("\u5B89\u88C5\u5305\u7ED3\u6784\u5F02\u5E38\uFF1A\u6A21\u5757\u76EE\u5F55\u4E3A\u7A7A");
  const manifest = manifestEntry && dirOf2(manifestEntry.name) === rootRel ? readJson(manifestEntry) : null;
  const rawId = String(manifest?.id || rootRel.split("/").pop() || "").trim();
  const safeId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(rawId) ? rawId : "";
  if (!safeId) {
    throw new Error(`\u65E0\u6CD5\u786E\u5B9A\u5408\u6CD5\u7684\u6269\u5C55 id\uFF08\u6E05\u5355\u91CC\u662F\u300C${rawId || "\u7A7A"}\u300D\uFF09\u3002id \u53EA\u80FD\u5305\u542B\u5B57\u6BCD/\u6570\u5B57/._-\uFF0C\u4E14\u4EE5\u5B57\u6BCD\u6216\u6570\u5B57\u5F00\u5934`);
  }
  const warnings = [];
  if (type === "tool" && !files.some((f) => /\/(index|.*)\.js$/.test("/" + f.rel))) {
    warnings.push("\u6CA1\u6709 .js \u6587\u4EF6\uFF1A\u5DE5\u5177\u5305\u901A\u5E38\u9700\u8981\u4E00\u4E2A\u5165\u53E3\u811A\u672C");
  }
  if (type !== "knowledge" && !manifest) warnings.push("\u6E05\u5355\u6587\u4EF6\u5185\u5BB9\u4E0D\u662F\u5408\u6CD5 JSON\uFF0C\u5BFC\u5165\u540E\u53EF\u80FD\u52A0\u8F7D\u5931\u8D25");
  const rootName = String(root || "").trim() || ROOT_BY_TYPE[type];
  const targetDir = import_node_path3.default.join(APP_ROOT, rootName, safeId);
  const totalSize = files.reduce((n, f) => n + f.data.length, 0);
  return {
    type,
    typeLabel: TYPE_LABEL[type] || type,
    id: safeId,
    name: String(manifest?.name || safeId),
    version: String(manifest?.version || ""),
    description: String(manifest?.description || ""),
    root: rootRel,
    files: files.map((f) => ({ rel: f.rel, size: f.data.length })),
    totalSize,
    targetDir,
    relTarget: `${ROOT_BY_TYPE[type]}/${safeId}`,
    conflict: import_node_fs3.default.existsSync(targetDir),
    warnings,
    _entries: files
  };
}
function publicAnalysis(info) {
  const { _entries, ...rest } = info;
  return rest;
}
async function installZip(buffer, { overwrite = false, id = "", root = "" } = {}) {
  return installEntries(analyzeZip(buffer, { root }), { overwrite, id, root });
}
async function installEntries(info, { overwrite = false, id = "", root = "" } = {}) {
  const finalId = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(String(id)) ? String(id) : info.id;
  const rootName = String(root || "").trim() || ROOT_BY_TYPE[info.type];
  const relTarget = `${rootName}/${finalId}`;
  const target = import_node_path3.default.join(APP_ROOT, relTarget);
  if (import_node_fs3.default.existsSync(target) && !overwrite) {
    const err = new Error(`\u5DF2\u5B58\u5728\u540C\u540D\u6269\u5C55\uFF1A${relTarget}\uFF08\u5982\u9700\u8986\u76D6\u8BF7\u786E\u8BA4\u8986\u76D6\u5B89\u88C5\uFF09`);
    err.conflict = true;
    err.existing = relTarget;
    throw err;
  }
  const backup = `${target}.bak-${Date.now()}`;
  const hadExisting = import_node_fs3.default.existsSync(target);
  try {
    if (hadExisting) import_node_fs3.default.renameSync(target, backup);
    import_node_fs3.default.mkdirSync(target, { recursive: true });
    for (const f of info._entries) {
      const dest = import_node_path3.default.join(target, ...f.rel.split("/"));
      const relCheck = import_node_path3.default.relative(target, dest);
      if (relCheck.startsWith("..") || import_node_path3.default.isAbsolute(relCheck)) throw new Error(`\u5B89\u88C5\u5305\u5305\u542B\u975E\u6CD5\u8DEF\u5F84\uFF1A${f.rel}`);
      import_node_fs3.default.mkdirSync(import_node_path3.default.dirname(dest), { recursive: true });
      import_node_fs3.default.writeFileSync(dest, f.data);
    }
    if (hadExisting) {
      try {
        import_node_fs3.default.rmSync(backup, { recursive: true, force: true });
      } catch {
      }
    }
  } catch (error) {
    try {
      import_node_fs3.default.rmSync(target, { recursive: true, force: true });
      if (hadExisting) import_node_fs3.default.renameSync(backup, target);
    } catch {
    }
    throw error;
  }
  return {
    ok: true,
    type: info.type,
    typeLabel: info.typeLabel,
    id: finalId,
    name: info.name,
    version: info.version,
    relTarget,
    files: info.files.length,
    replaced: hadExisting
  };
}

// packages/extension-compat/vendor/src/safe-fetch.js
var safe_fetch_exports = {};
__export(safe_fetch_exports, {
  browseLockState: () => browseLockState,
  checkBrowseLock: () => checkBrowseLock,
  hostAllowed: () => hostAllowed,
  isPrivateIp: () => isPrivateIp,
  normalizeDomain: () => normalizeDomain,
  safeFetch: () => safeFetch,
  safeFetchBinary: () => safeFetchBinary,
  safeFetchBinaryToFile: () => safeFetchBinaryToFile,
  validateFetchUrl: () => validateFetchUrl,
  validateImageUrl: () => validateImageUrl
});
var import_node_dns = __toESM(require("node:dns"), 1);
var import_node_net = __toESM(require("node:net"), 1);
var import_node_http = __toESM(require("node:http"), 1);
var import_node_https = __toESM(require("node:https"), 1);
var import_node_fs4 = __toESM(require("node:fs"), 1);
var import_node_path4 = __toESM(require("node:path"), 1);
var import_node_string_decoder = require("node:string_decoder");
var dnsLookup = import_node_dns.default.promises.lookup;
function ipv4FromLast32(lower) {
  const parts = String(lower || "").split(":");
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(last)) return last;
  if (/^[0-9a-f]{1,4}$/.test(secondLast) && /^[0-9a-f]{1,4}$/.test(last)) {
    const num = (parseInt(secondLast, 16) << 16) + parseInt(last, 16);
    return `${num >>> 24 & 255}.${num >>> 16 & 255}.${num >>> 8 & 255}.${num & 255}`;
  }
  return null;
}
function parseEmbeddedIpv4(h) {
  const lower = String(h || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!lower.includes(":")) return null;
  const dotted = lower.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const m = lower.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (m) {
    const num = (parseInt(m[1], 16) << 16) + parseInt(m[2], 16);
    return `${num >>> 24 & 255}.${num >>> 16 & 255}.${num >>> 8 & 255}.${num & 255}`;
  }
  if (lower.startsWith("::ffff:") || lower.startsWith("::")) {
    const embedded = ipv4FromLast32(lower);
    if (embedded) return embedded;
  }
  if (lower.startsWith("64:ff9b")) {
    const embedded = ipv4FromLast32(lower);
    if (embedded) return embedded;
  }
  const nat64 = lower.match(/^64:ff9b:(?:::)?(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/i);
  if (nat64) {
    if (nat64[3]) return nat64[3];
    const num = (parseInt(nat64[1], 16) << 16) + parseInt(nat64[2], 16);
    return `${num >>> 24 & 255}.${num >>> 16 & 255}.${num >>> 8 & 255}.${num & 255}`;
  }
  return null;
}
function isPrivateIp(ip) {
  const h = String(ip || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  const embedded = h.includes(":") ? parseEmbeddedIpv4(h) : null;
  if (embedded) return isPrivateIp(embedded);
  if (import_node_net.default.isIP(h) === 4) {
    const parts = h.split(".").map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) return true;
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    if (parts[0] >= 224) return true;
    return false;
  }
  if (import_node_net.default.isIP(h) === 6) {
    if (h === "::" || h === "::1") return true;
    if (h.startsWith("fc") || h.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(h)) return true;
    if (h.startsWith("fec") || h.startsWith("fed") || h.startsWith("fee") || h.startsWith("fef")) return true;
    if (h.startsWith("2001:db8")) return true;
    if (h.startsWith("2001:2:") || h.startsWith("2001:10:") || h.startsWith("2001:20:")) return true;
    const sixth4 = h.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/i);
    if (sixth4) {
      const num = (parseInt(sixth4[1], 16) << 16) + parseInt(sixth4[2], 16);
      const ipv4 = `${num >>> 24 & 255}.${num >>> 16 & 255}.${num >>> 8 & 255}.${num & 255}`;
      if (isPrivateIp(ipv4)) return true;
    }
    if (h.startsWith("ff")) return true;
    return false;
  }
  return false;
}
async function lookupWithTimeout(hostname) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("DNS \u89E3\u6790\u8D85\u65F6")), 5e3);
  });
  return Promise.race([dnsLookup(hostname, { all: true, verbatim: true }), timeout]).finally(() => clearTimeout(timer));
}
async function resolveSafeHost(hostname, { allowPrivate = false } = {}) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) throw new Error("\u4E3B\u673A\u540D\u4E3A\u7A7A");
  if (!allowPrivate && (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local"))) {
    throw new Error("\u7981\u6B62\u8BBF\u95EE\u5185\u7F51/\u672C\u673A\u5730\u5740");
  }
  if (import_node_net.default.isIP(h)) {
    if (!allowPrivate && isPrivateIp(h)) throw new Error("\u7981\u6B62\u8BBF\u95EE\u5185\u7F51/\u672C\u673A\u5730\u5740");
    return h;
  }
  let addresses;
  try {
    addresses = await lookupWithTimeout(h);
  } catch (error) {
    throw new Error(`\u57DF\u540D\u89E3\u6790\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
  if (!addresses.length) throw new Error("\u57DF\u540D\u6CA1\u6709\u89E3\u6790\u7ED3\u679C");
  if (!allowPrivate) {
    for (const { address } of addresses) {
      if (isPrivateIp(address)) throw new Error("\u57DF\u540D\u89E3\u6790\u5230\u5185\u7F51/\u672C\u673A\u5730\u5740\uFF0C\u5DF2\u963B\u6B62");
    }
  }
  return addresses[0].address;
}
async function validateFetchUrl(raw, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    throw new Error("URL \u65E0\u6548");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("\u4EC5\u5141\u8BB8 http/https");
  if (url.username || url.password) throw new Error("URL \u4E0D\u80FD\u5305\u542B\u51ED\u636E");
  const ip = await resolveSafeHost(url.hostname, { allowPrivate });
  return { url, ip };
}
function normalizeDomain(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  try {
    const u = new URL(s.includes("://") ? s : `http://${s}`);
    return u.hostname.toLowerCase().replace(/^\.+|\.+$/g, "");
  } catch {
    return "";
  }
}
function browseLockState() {
  const lock = getConfig().security?.browseLock || {};
  const enabled = lock.enabled === true;
  const domains = (Array.isArray(lock.hosts) ? lock.hosts : []).map(normalizeDomain).filter(Boolean);
  return { enabled, domains, siteSearchUrl: String(lock.siteSearchUrl || "").trim() };
}
function hostAllowed(host, state = browseLockState()) {
  if (!state.enabled) return true;
  const h = String(host ?? "").toLowerCase().replace(/^\.+|\.+$/g, "");
  if (!h) return false;
  if (!state.domains.length) return false;
  return state.domains.some((d) => h === d || h.endsWith(`.${d}`));
}
function checkBrowseLock(rawUrl, state = browseLockState()) {
  if (!state.enabled) return { enabled: false, host: "", allowed: true };
  let host = "";
  try {
    host = new URL(String(rawUrl ?? "")).hostname.toLowerCase();
  } catch {
    return { enabled: true, host: "", allowed: false };
  }
  return { enabled: true, host, allowed: hostAllowed(host, state) };
}
function sliceByCodePoints(s, max) {
  if (s.length <= max) return s;
  return Array.from(s).slice(0, max).join("");
}
function readBounded(res, maxBytes, asText) {
  return new Promise((resolve, reject) => {
    const decoder = new import_node_string_decoder.StringDecoder("utf8");
    const chunks = [];
    let total = 0;
    let text = "";
    let settled = false;
    const finish = (fn, val) => {
      if (settled) return;
      settled = true;
      fn(val);
    };
    res.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (asText) text += decoder.write(chunk);
      else chunks.push(chunk);
      if (total >= maxBytes) {
        try {
          res.destroy();
        } catch {
        }
        finish(resolve, asText ? sliceByCodePoints(text, maxBytes) : Buffer.concat(chunks).subarray(0, maxBytes));
      }
    });
    res.on("end", () => {
      if (!settled) {
        if (asText) {
          text += decoder.end();
          finish(resolve, sliceByCodePoints(text, maxBytes));
        } else {
          finish(resolve, Buffer.concat(chunks));
        }
      }
    });
    res.on("error", (err) => finish(reject, err));
  });
}
function requestOnce(url, ip, { asBinary = false, maxBytes = 5e4 } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? import_node_https.default : import_node_http.default;
    const port = url.port || (url.protocol === "https:" ? 443 : 80);
    const req = mod.request({
      hostname: ip,
      port,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        host: url.host,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) qq-agent/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,image/avif,image/webp,image/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9"
      },
      servername: url.protocol === "https:" ? url.hostname : void 0,
      rejectUnauthorized: url.protocol === "https:",
      timeout: 2e4
    }, (res) => {
      const statusCode = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        res.resume();
        resolve({ statusCode, redirect: String(res.headers.location || "") });
        return;
      }
      readBounded(res, maxBytes, !asBinary).then((body) => resolve({ statusCode, body, contentType: String(res.headers["content-type"] || "") })).catch(reject);
    });
    req.on("timeout", () => req.destroy(new Error(`\u8BF7\u6C42\u8D85\u65F6\uFF1A${url.hostname}`)));
    req.on("error", reject);
    req.end();
  });
}
var MAX_REDIRECTS = 5;
async function safeFetch(urlString, { browseLocked = false } = {}) {
  const lock = browseLocked ? checkBrowseLock(urlString) : { enabled: false, allowed: true, host: "" };
  if (!lock.allowed) throw new Error(`\u6D4F\u89C8\u9501\u5B9A\uFF1A${lock.host || "\u8BE5\u5730\u5740"} \u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u6E05\u5355\u5185`);
  let { url, ip } = await validateFetchUrl(urlString);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const result = await requestOnce(url, ip, { asBinary: false, maxBytes: 5e4 });
    if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
      if (!result.redirect) throw new Error(`\u91CD\u5B9A\u5411\u7F3A\u5C11 Location: ${result.statusCode}`);
      const next = new URL(result.redirect, url).toString();
      if (browseLocked) {
        const nl = checkBrowseLock(next);
        if (!nl.allowed) throw new Error(`\u6D4F\u89C8\u9501\u5B9A\uFF1A\u91CD\u5B9A\u5411\u76EE\u6807 ${nl.host || "\u672A\u77E5"} \u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u6E05\u5355\u5185`);
      }
      ({ url, ip } = await validateFetchUrl(next));
      continue;
    }
    const body = result.body || "";
    return { url: url.toString(), statusCode: result.statusCode, truncated: body.length >= 5e4, body };
  }
  throw new Error("\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A\uFF0C\u5DF2\u505C\u6B62");
}
async function safeFetchBinary(urlString, maxBytes = 12 * 1024 * 1024, { browseLocked = false } = {}) {
  const lock = browseLocked ? checkBrowseLock(urlString) : { enabled: false, allowed: true, host: "" };
  if (!lock.allowed) throw new Error(`\u6D4F\u89C8\u9501\u5B9A\uFF1A${lock.host || "\u8BE5\u5730\u5740"} \u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u6E05\u5355\u5185`);
  const allowPrivate = getConfig().security?.allowPrivateImageHosts === true;
  let { url, ip } = await validateFetchUrl(urlString, { allowPrivate });
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const result = await requestOnce(url, ip, { asBinary: true, maxBytes });
    if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
      if (!result.redirect) throw new Error(`\u91CD\u5B9A\u5411\u7F3A\u5C11 Location: ${result.statusCode}`);
      const next = new URL(result.redirect, url).toString();
      if (browseLocked) {
        const nl = checkBrowseLock(next);
        if (!nl.allowed) throw new Error(`\u6D4F\u89C8\u9501\u5B9A\uFF1A\u91CD\u5B9A\u5411\u76EE\u6807 ${nl.host || "\u672A\u77E5"} \u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u6E05\u5355\u5185`);
      }
      ({ url, ip } = await validateFetchUrl(next, { allowPrivate }));
      continue;
    }
    if (result.statusCode !== 200) throw new Error(`HTTP ${result.statusCode}`);
    return { buffer: result.body, contentType: result.contentType };
  }
  throw new Error("\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A\uFF0C\u5DF2\u505C\u6B62");
}
function requestToFile(url, ip, dest, { limit = Infinity, timeoutMs = 3e4 } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? import_node_https.default : import_node_http.default;
    const port = url.port || (url.protocol === "https:" ? 443 : 80);
    const req = mod.request({
      hostname: ip,
      port,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        host: url.host,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) qq-agent/1.0",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,image/avif,image/webp,image/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9"
      },
      servername: url.protocol === "https:" ? url.hostname : void 0,
      rejectUnauthorized: url.protocol === "https:",
      // 大文件下载：这是 socket 空闲超时而非总时长上限 —— 数据持续流动时不触发，
      // 卡死的连接才会被掐掉（与 requestOnce 的行为一致，只是上限放宽到 timeoutMs）
      timeout: timeoutMs
    }, (res) => {
      const statusCode = res.statusCode || 0;
      const contentType = String(res.headers["content-type"] || "");
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        res.resume();
        resolve({ statusCode, redirect: String(res.headers.location || ""), bytes: 0, contentType });
        return;
      }
      if (statusCode !== 200) {
        res.resume();
        resolve({ statusCode, bytes: 0, contentType });
        return;
      }
      let total = 0;
      let settled = false;
      let overLimit = false;
      const finish = (val) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try {
          res.destroy();
        } catch {
        }
        reject(err);
      };
      const out = import_node_fs4.default.createWriteStream(dest, { flags: "w" });
      res.on("data", (chunk) => {
        if (settled) return;
        total += chunk.length;
        if (total >= limit) {
          overLimit = true;
          try {
            res.destroy();
          } catch {
          }
          out.end();
          finish({ statusCode, bytes: total, contentType, overLimit });
          return;
        }
        if (!out.write(chunk)) {
          res.pause();
          out.once("drain", () => res.resume());
        }
      });
      res.on("end", () => {
        if (settled) return;
        out.end(() => finish({ statusCode, bytes: total, contentType, overLimit }));
      });
      res.on("error", fail);
      out.on("error", fail);
    });
    req.on("timeout", () => req.destroy(new Error(`\u8BF7\u6C42\u8D85\u65F6\uFF1A${url.hostname}`)));
    req.on("error", reject);
    req.end();
  });
}
async function safeFetchBinaryToFile(urlString, destPath, maxBytes, { timeoutMs = 3e4, browseLocked = false } = {}) {
  const dest = String(destPath || "");
  if (!dest) throw new Error("\u7F3A\u5C11\u76EE\u6807\u6587\u4EF6\u8DEF\u5F84");
  const limit = Math.max(1, Number(maxBytes) || 1);
  const lock = browseLocked ? checkBrowseLock(urlString) : { enabled: false, allowed: true, host: "" };
  if (!lock.allowed) throw new Error(`\u6D4F\u89C8\u9501\u5B9A\uFF1A${lock.host || "\u8BE5\u5730\u5740"} \u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u6E05\u5355\u5185`);
  const allowPrivate = getConfig().security?.allowPrivateImageHosts === true;
  import_node_fs4.default.mkdirSync(import_node_path4.default.dirname(dest), { recursive: true });
  let ok = false;
  try {
    let { url, ip } = await validateFetchUrl(urlString, { allowPrivate });
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const r = await requestToFile(url, ip, dest, { limit, timeoutMs });
      if (r.redirect !== void 0) {
        if (!r.redirect) throw new Error(`\u91CD\u5B9A\u5411\u7F3A\u5C11 Location: ${r.statusCode}`);
        const next = new URL(r.redirect, url).toString();
        if (browseLocked) {
          const nl = checkBrowseLock(next);
          if (!nl.allowed) throw new Error(`\u6D4F\u89C8\u9501\u5B9A\uFF1A\u91CD\u5B9A\u5411\u76EE\u6807 ${nl.host || "\u672A\u77E5"} \u4E0D\u5728\u5141\u8BB8\u7684\u57DF\u540D\u6E05\u5355\u5185`);
        }
        ({ url, ip } = await validateFetchUrl(next, { allowPrivate }));
        continue;
      }
      if (r.statusCode !== 200) throw new Error(`HTTP ${r.statusCode}`);
      if (r.bytes === 0) throw new Error("\u4E0B\u8F7D\u5185\u5BB9\u4E3A\u7A7A");
      if (r.overLimit || r.bytes >= limit) throw new Error(`\u6587\u4EF6\u8FBE\u5230\u5927\u5C0F\u4E0A\u9650\uFF08${limit} \u5B57\u8282\uFF09\uFF0C\u5DF2\u4E2D\u6B62`);
      ok = true;
      return { bytes: r.bytes, contentType: r.contentType };
    }
    throw new Error("\u91CD\u5B9A\u5411\u6B21\u6570\u8FC7\u591A\uFF0C\u5DF2\u505C\u6B62");
  } finally {
    if (!ok) {
      try {
        import_node_fs4.default.rmSync(dest, { force: true });
      } catch {
      }
    }
  }
}
async function validateImageUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    throw new Error("\u56FE\u7247\u5730\u5740\u4E0D\u5408\u6CD5");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("\u53EA\u5141\u8BB8 http(s) \u56FE\u7247\u5730\u5740");
  if (getConfig().security?.allowPrivateImageHosts === true) return url.toString();
  const { url: safeUrl } = await validateFetchUrl(url.toString());
  return safeUrl.toString();
}

// packages/extension-compat/vendor/src/knowledge/tree.js
var tree_exports = {};
__export(tree_exports, {
  DOC_EXT: () => DOC_EXT2,
  SUMMARY_DIR: () => SUMMARY_DIR,
  SUMMARY_SUFFIX: () => SUMMARY_SUFFIX,
  childLinksFor: () => childLinksFor,
  relLink: () => relLink,
  scanKnowledgeTree: () => scanKnowledgeTree,
  summaryAbsFor: () => summaryAbsFor,
  treeStats: () => treeStats,
  walkNodes: () => walkNodes
});
var import_node_fs5 = __toESM(require("node:fs"), 1);
var import_node_path5 = __toESM(require("node:path"), 1);
var SUMMARY_DIR = ".summery";
var SUMMARY_SUFFIX = ".summery";
var DOC_EXT2 = /* @__PURE__ */ new Set([".md", ".txt", ".markdown"]);
function scanKnowledgeTree(rootDir, { maxDepth = 8 } = {}) {
  const root = { kind: "dir", name: import_node_path5.default.basename(rootDir), relPath: "", abs: rootDir, depth: 0, children: [] };
  walk(rootDir, root, 0, maxDepth);
  return root;
}
function walk(dirAbs, node, depth, maxDepth) {
  if (depth >= maxDepth) return;
  let entries = [];
  try {
    entries = import_node_fs5.default.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const abs = import_node_path5.default.join(dirAbs, ent.name);
    const relPath = node.relPath ? `${node.relPath}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      const child = { kind: "dir", name: ent.name, relPath, abs, depth: depth + 1, children: [] };
      node.children.push(child);
      walk(abs, child, depth + 1, maxDepth);
    } else if (ent.isFile() && DOC_EXT2.has(import_node_path5.default.extname(ent.name).toLowerCase())) {
      node.children.push({ kind: "doc", name: ent.name, relPath, abs, depth: depth + 1 });
    }
  }
  node.children.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1);
}
function summaryAbsFor(rootDir, node) {
  const sumRoot = import_node_path5.default.join(rootDir, SUMMARY_DIR);
  if (!node.relPath) return import_node_path5.default.join(sumRoot, SUMMARY_DIR);
  const parentRel = node.relPath.includes("/") ? node.relPath.slice(0, node.relPath.lastIndexOf("/")) : "";
  const base = import_node_path5.default.basename(node.relPath);
  return import_node_path5.default.join(sumRoot, parentRel, `${base}${SUMMARY_SUFFIX}`);
}
function relLink(fromDirAbs, toAbs) {
  const rel = import_node_path5.default.relative(fromDirAbs, toAbs).replace(/\\/g, "/");
  return rel || ".";
}
function childLinksFor(rootDir, node) {
  if (node.kind !== "dir") return [];
  return node.children.map((c) => ({
    title: c.name,
    href: relLink(import_node_path5.default.dirname(summaryAbsFor(rootDir, node)), summaryAbsFor(rootDir, c)),
    kind: c.kind
  }));
}
function walkNodes(root, fn, parent = null) {
  fn(root, parent);
  for (const c of root.children || []) walkNodes(c, fn, root);
}
function treeStats(root) {
  const out = { docs: 0, dirs: 0, chars: 0 };
  walkNodes(root, (n) => {
    if (n.kind === "doc") {
      out.docs += 1;
      try {
        out.chars += import_node_fs5.default.statSync(n.abs).size;
      } catch {
      }
    } else {
      out.dirs += 1;
    }
  });
  return out;
}

// packages/extension-compat/vendor/src/knowledge/validate.js
var validate_exports = {};
__export(validate_exports, {
  SUMMARY_BOUNDS: () => SUMMARY_BOUNDS,
  SUMMARY_RATIO: () => SUMMARY_RATIO,
  extractLinks: () => extractLinks,
  stripMd: () => stripMd,
  summaryCap: () => summaryCap,
  validateKnowledgePackage: () => validateKnowledgePackage,
  validateSummaryLinks: () => validateSummaryLinks,
  validateSummaryText: () => validateSummaryText
});
var SUMMARY_RATIO = 0.1;
var SUMMARY_BOUNDS = {
  L0: { min: 60, max: 1200 },
  L1: { min: 80, max: 2e3 },
  L2: { min: 60, max: 4e3 }
};
var DOC_EXT3 = /* @__PURE__ */ new Set([".md", ".txt", ".markdown"]);
var PLACEHOLDER_RE = /^(todo|tbd|待补充|待完善|暂无|n\/a|\.{3,}|…+|-+)$/i;
function summaryCap(sourceLength, level) {
  const bound = SUMMARY_BOUNDS[level] || SUMMARY_BOUNDS.L2;
  const n = Number(sourceLength) || 0;
  const byRatio = Math.round(n * SUMMARY_RATIO);
  return Math.max(bound.min, Math.min(bound.max, byRatio));
}
function validateSummaryText(text, level, {
  title = "",
  sourceLength = 0,
  allowMarkdown = true,
  requireLinks = 0
} = {}) {
  if (typeof text !== "string") return { ok: false, reason: "\u4E0D\u662F\u5B57\u7B26\u4E32" };
  const s = text.trim();
  if (!s) return { ok: false, reason: "\u4E3A\u7A7A" };
  const cap = summaryCap(sourceLength, level);
  const len = Array.from(s).length;
  if (len > cap) {
    return { ok: false, reason: `\u8D85\u8FC7\u4E0A\u9650\uFF08${len} > ${cap} \u5B57\uFF0C\u6E90\u6587 ${sourceLength} \u5B57\u7684 ${SUMMARY_RATIO * 100}%\uFF09` };
  }
  if (!allowMarkdown) {
    if (/[\r\n]/.test(s)) return { ok: false, reason: "\u542B\u6362\u884C\uFF08\u5E94\u4E3A\u5355\u6BB5\uFF09" };
    if (/^\s*#{1,6}\s/.test(s)) return { ok: false, reason: "\u4EE5 Markdown \u6807\u9898\u5F00\u5934" };
  }
  if (/```/.test(s)) return { ok: false, reason: "\u542B\u4EE3\u7801\u5757\uFF08\u6458\u8981\u4E0D\u5E94\u5305\u542B\u4EE3\u7801\uFF09" };
  if (PLACEHOLDER_RE.test(s.replace(/^#+\s*/gm, "").trim())) return { ok: false, reason: "\u5360\u4F4D\u7B26" };
  if (title && stripMd(s) === String(title).trim()) return { ok: false, reason: "\u4E0E\u6807\u9898\u5B8C\u5168\u76F8\u540C" };
  if (requireLinks > 0) {
    const links = extractLinks(s);
    if (links.length < requireLinks) {
      return { ok: false, reason: `\u5E94\u81F3\u5C11\u5305\u542B ${requireLinks} \u4E2A\u6307\u5411\u4E0B\u4E00\u5C42\u7684\u76F8\u5BF9\u94FE\u63A5\uFF08\u5F53\u524D ${links.length}\uFF09` };
    }
  }
  return { ok: true, chars: len, cap };
}
function stripMd(text) {
  return String(text || "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/[*_~>#-]+/g, " ").replace(/\s+/g, " ").trim();
}
function extractLinks(text) {
  const out = [];
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while (m = re.exec(String(text || ""))) {
    const href = m[1].trim();
    if (!href || href.startsWith("#")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    out.push(href);
  }
  return out;
}
function validateSummaryLinks(md, { dir: dir2, fsExists = null, baseDir = null } = {}) {
  const violations = [];
  const resolved = [];
  const base = baseDir ? joinPath(dir2, baseDir) : dir2;
  for (const href of extractLinks(md)) {
    if (path_isAbsolute(href)) {
      violations.push(`\u94FE\u63A5\u4E0D\u80FD\u662F\u7EDD\u5BF9\u8DEF\u5F84\uFF1A${href}`);
      continue;
    }
    const target = normalizePosix(joinPath(base, href));
    const pkgRoot = normalizePosix(dir2);
    if (pkgRoot && !target.startsWith(`${pkgRoot}/`) && target !== pkgRoot) {
      violations.push(`\u94FE\u63A5\u8D8A\u51FA\u5305\u76EE\u5F55\uFF1A${href}`);
      continue;
    }
    if (fsExists && !fsExists(target)) {
      violations.push(`\u94FE\u63A5\u6307\u5411\u7684\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${href}`);
      continue;
    }
    resolved.push(href);
  }
  return { ok: violations.length === 0, violations, resolved };
}
function validateKnowledgePackage(raw, { dir: dir2 = "", fsExists = null } = {}) {
  const violations = [];
  const docEntries = [];
  if (!raw || typeof raw !== "object") return { ok: false, violations: ["knowledge.json \u4E0D\u662F\u5BF9\u8C61"], docEntries };
  const id = String(raw.id || "").trim();
  if (!id) violations.push("\u7F3A\u5C11 id");
  else if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) violations.push(`id \u975E\u6CD5\uFF1A${id}`);
  const checkFile = (rel, label) => {
    if (!rel) return;
    if (path_isAbsolute(rel)) {
      violations.push(`${label} \u5FC5\u987B\u662F\u76F8\u5BF9\u8DEF\u5F84\uFF1A${rel}`);
      return;
    }
    if (normalizePosix(rel).startsWith("..")) {
      violations.push(`${label} \u8D8A\u754C\uFF1A${rel}`);
      return;
    }
    const ext = String(rel).toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
    if (!DOC_EXT3.has(ext)) {
      violations.push(`${label} \u53EA\u652F\u6301 md/txt\uFF1A${rel}`);
      return;
    }
    if (fsExists && dir2 && !fsExists(joinPath(dir2, rel))) violations.push(`${label} \u4E0D\u5B58\u5728\uFF1A${rel}`);
  };
  checkFile(String(raw.summaryFile || ""), "summaryFile");
  const modules = Array.isArray(raw.modules) ? raw.modules : [];
  const moduleIds = /* @__PURE__ */ new Set();
  const docIds = /* @__PURE__ */ new Set();
  for (const [mi, m] of modules.entries()) {
    const mid = String(m?.id || "").trim();
    if (!mid) violations.push(`modules[${mi}] \u7F3A\u5C11 id`);
    else if (moduleIds.has(mid)) violations.push(`\u6A21\u5757 id \u91CD\u590D\uFF1A${mid}`);
    else moduleIds.add(mid);
    checkFile(String(m?.introFile || ""), `\u6A21\u5757 ${mid} \u7684 introFile`);
    const docs2 = Array.isArray(m?.docs) ? m.docs : [];
    for (const [di, d] of docs2.entries()) {
      const rel = typeof d === "string" ? d : String(d?.path || "");
      if (!rel) {
        violations.push(`modules[${mi}].docs[${di}] \u7F3A\u5C11 path`);
        continue;
      }
      if (path_isAbsolute(rel)) {
        violations.push(`\u6587\u6863\u8DEF\u5F84\u5FC5\u987B\u662F\u76F8\u5BF9\u8DEF\u5F84\uFF1A${rel}`);
        continue;
      }
      if (normalizePosix(rel).startsWith("..")) {
        violations.push(`\u6587\u6863\u8DEF\u5F84\u8D8A\u754C\uFF1A${rel}`);
        continue;
      }
      const ext = String(rel).toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
      if (!DOC_EXT3.has(ext)) {
        violations.push(`\u6587\u6863\u7C7B\u578B\u4E0D\u652F\u6301\uFF08\u53EA\u6536 md/txt\uFF09\uFF1A${rel}`);
        continue;
      }
      if (fsExists && dir2 && !fsExists(joinPath(dir2, rel))) {
        violations.push(`\u6587\u6863\u4E0D\u5B58\u5728\uFF1A${rel}`);
        continue;
      }
      const summaryFile = typeof d === "string" ? "" : String(d?.summaryFile || "");
      if (summaryFile) checkFile(summaryFile, `\u6587\u6863 ${rel} \u7684 summaryFile`);
      const docId = String(d?.id || `${id}.${mid}.${basenameNoExt(rel)}`);
      if (docIds.has(docId)) {
        violations.push(`\u6587\u6863 id \u91CD\u590D\uFF1A${docId}`);
        continue;
      }
      docIds.add(docId);
      docEntries.push({
        moduleId: mid,
        moduleIndex: mi,
        docId,
        relPath: rel,
        title: String(d?.title || basenameNoExt(rel)),
        summary: typeof d === "string" ? "" : String(d?.summary || ""),
        summaryFile
      });
    }
  }
  return { ok: violations.length === 0, violations, docEntries };
}
function path_isAbsolute(p) {
  const s = String(p);
  return s.startsWith("/") || s.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(s);
}
function normalizePosix(p) {
  const parts = String(p).replace(/\\/g, "/").split("/");
  const out = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}
function joinPath(dir2, rel) {
  return `${String(dir2).replace(/[\\/]+$/, "")}/${String(rel).replace(/\\/g, "/")}`;
}
function basenameNoExt(rel) {
  const base = String(rel).replace(/\\/g, "/").split("/").pop() || "doc";
  return base.replace(/\.[^.]+$/, "");
}

// packages/extension-compat/vendor/src/knowledge/stale.js
var stale_exports = {};
__export(stale_exports, {
  META_FILE: () => META_FILE,
  detectStale: () => detectStale,
  fingerprintOf: () => fingerprintOf,
  readMeta: () => readMeta,
  recordFingerprints: () => recordFingerprints,
  writeMeta: () => writeMeta
});
var import_node_fs6 = __toESM(require("node:fs"), 1);
var import_node_path6 = __toESM(require("node:path"), 1);
var import_node_crypto = __toESM(require("node:crypto"), 1);
var META_FILE = "meta.json";
function md5File(abs) {
  try {
    return import_node_crypto.default.createHash("md5").update(import_node_fs6.default.readFileSync(abs)).digest("hex");
  } catch {
    return "";
  }
}
function readMeta(rootDir) {
  const file = import_node_path6.default.join(rootDir, SUMMARY_DIR, META_FILE);
  try {
    return JSON.parse(import_node_fs6.default.readFileSync(file, "utf8")) || { nodes: {} };
  } catch {
    return { nodes: {} };
  }
}
function writeMeta(rootDir, meta) {
  const dir2 = import_node_path6.default.join(rootDir, SUMMARY_DIR);
  import_node_fs6.default.mkdirSync(dir2, { recursive: true });
  const file = import_node_path6.default.join(dir2, META_FILE);
  const tmp = `${file}.tmp-${process.pid}`;
  import_node_fs6.default.writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}
`, "utf8");
  import_node_fs6.default.renameSync(tmp, file);
}
function fingerprintOf(rootDir, node) {
  const out = {};
  if (node.kind === "doc") {
    out[node.name] = md5File(node.abs);
    return out;
  }
  for (const child of node.children || []) {
    const target = child.kind === "doc" ? child.abs : summaryAbsFor(rootDir, child);
    out[child.name] = md5File(target);
  }
  return out;
}
function recordFingerprints(rootDir, tree = null) {
  const t = tree || scanKnowledgeTree(rootDir);
  const meta = readMeta(rootDir);
  meta.nodes = meta.nodes || {};
  walkNodes(t, (node) => {
    if (node.kind === "doc" && node.depth === 0) return;
    meta.nodes[node.relPath || "."] = {
      level: node.depth === 0 ? "L0" : node.kind === "dir" ? "L1" : "L2",
      md5: fingerprintOf(rootDir, node),
      at: Date.now()
    };
  });
  writeMeta(rootDir, meta);
  return meta;
}
function detectStale(rootDir, tree = null) {
  const t = tree || scanKnowledgeTree(rootDir);
  const meta = readMeta(rootDir);
  const stale = [];
  let checked = 0;
  walkNodes(t, (node) => {
    const key = node.relPath || ".";
    const rec = meta.nodes?.[key];
    if (!rec) return;
    checked += 1;
    const now = fingerprintOf(rootDir, node);
    const changed = [];
    for (const [name, hash] of Object.entries(now)) {
      if (!rec.md5 || rec.md5[name] !== hash) changed.push(name);
    }
    if (changed.length) stale.push({ node: key, level: rec.level, changed, at: rec.at || 0 });
  });
  return { stale, checked, recorded: Object.keys(meta.nodes || {}).length };
}

// packages/extension-compat/vendor/src/knowledge/ensure.js
var ensure_exports = {};
__export(ensure_exports, {
  SUMMARY_DIR: () => SUMMARY_DIR,
  ensureSummaries: () => ensureSummaries,
  readSummary: () => readSummary,
  writeSummary: () => writeSummary
});
var import_node_fs8 = __toESM(require("node:fs"), 1);
var import_node_path8 = __toESM(require("node:path"), 1);

// packages/extension-compat/vendor/src/knowledge/summarize.js
var import_node_fs7 = __toESM(require("node:fs"), 1);
var import_node_path7 = __toESM(require("node:path"), 1);
var import_node_crypto2 = __toESM(require("node:crypto"), 1);
var PROMPT_VERSION = 2;
function sampleContent(content, { head = 2e3, tail = 1e3 } = {}) {
  const s = String(content || "");
  if (s.length <= head + tail) return s;
  return `${s.slice(0, head)}
\u2026
${s.slice(-tail)}`;
}
function stripMarkdown(text) {
  return stripMd(text);
}
function firstParagraph(content) {
  const lines = String(content || "").split(/\r?\n/);
  const buf = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (buf.length) break;
      continue;
    }
    if (/^#{1,6}\s/.test(t)) continue;
    if (/^```/.test(t)) break;
    if (/^[-*+]\s/.test(t) || /^\d+\.\s/.test(t)) {
      buf.push(t.replace(/^[-*+]\s+|^\d+\.\s+/, ""));
      continue;
    }
    buf.push(t);
    if (buf.join("").length > 200) break;
  }
  return buf.join(" ").replace(/\s+/g, " ").trim();
}
function extractiveSummary(content, opts = {}) {
  const o = typeof opts === "number" ? { maxChars: opts } : opts || {};
  const level = o.level || "L2";
  const title = String(o.title || "");
  const children = Array.isArray(o.children) ? o.children : [];
  const sourceLength = Number(o.sourceLength) || String(content || "").length;
  const cap = Number(o.maxChars) || summaryCap(sourceLength, level);
  const para = firstParagraph(content);
  const head = para ? para.slice(0, Math.max(20, cap - 40)) : "";
  const lines = [];
  if (title) lines.push(`## ${title}`);
  if (head) lines.push(head);
  else if (level !== "L2") lines.push(`\u672C\u5C42\u5305\u542B ${children.length} \u4E2A\u4E0B\u7EA7\u6761\u76EE\u3002`);
  if (children.length) {
    lines.push("");
    for (const c of children.slice(0, 12)) {
      const label = String(c.title || c.href || "").replace(/[\[\]]/g, "");
      lines.push(c.href ? `- [${label}](${c.href})` : `- ${label}`);
    }
  }
  let text = lines.join("\n").trim();
  if (!text) text = `## ${title || "\u6458\u8981"}
\uFF08\u81EA\u52A8\u6458\u8981\u4E0D\u53EF\u7528\uFF09`;
  const chars = Array.from(text);
  if (chars.length > cap) text = chars.slice(0, Math.max(0, cap - 1)).join("") + "\u2026";
  return text;
}
function hashContent(text) {
  return import_node_crypto2.default.createHash("sha1").update(String(text || "")).digest("hex").slice(0, 16);
}
async function llmSummary({
  title = "",
  content = "",
  level = "L2",
  children = [],
  sourceLength = 0,
  model = "",
  timeoutMs = 2e4,
  chatCompletion: chatCompletion2 = null
} = {}) {
  if (typeof chatCompletion2 !== "function") return null;
  const srcLen = Number(sourceLength) || String(content || "").length;
  const cap = summaryCap(srcLen, level);
  const sample = sampleContent(content);
  if (stripMarkdown(sample).length < 10) return null;
  const levelHint = {
    L0: "\u8FD9\u662F\u77E5\u8BC6\u5E93\u7684\u5BFC\u822A\u6587\u6863\uFF1A\u6982\u62EC\u672C\u5E93\u4E3B\u9898\uFF0C\u5E76\u5217\u51FA\u5404\u6A21\u5757\uFF08\u7528\u7ED9\u51FA\u7684\u76F8\u5BF9\u8DEF\u5F84\u94FE\u63A5\uFF09",
    L1: "\u8FD9\u662F\u6A21\u5757\u7684\u5BFC\u822A\u6587\u6863\uFF1A\u6982\u62EC\u672C\u6A21\u5757\u4E3B\u9898\uFF0C\u5E76\u5217\u51FA\u5404\u6587\u6863\uFF08\u7528\u7ED9\u51FA\u7684\u76F8\u5BF9\u8DEF\u5F84\u94FE\u63A5\uFF09",
    L2: "\u8FD9\u662F\u6587\u6863\u6458\u8981\uFF1A\u6982\u62EC\u5B83\u5199\u4E86\u4EC0\u4E48\uFF08\u53EF\u94FE\u63A5\u5230\u539F\u6587\uFF09"
  }[level] || "\u5199\u4E00\u6BB5\u6458\u8981";
  const childLines = children.slice(0, 20).map((c) => `- ${c.title || c.href} \u2192 ${c.href || "\uFF08\u65E0\u94FE\u63A5\uFF09"}`).join("\n");
  const messages = [
    {
      role: "system",
      content: "\u4F60\u662F\u77E5\u8BC6\u5E93\u7F16\u8F91\u3002\u8F93\u51FA Markdown\uFF1A\u53EF\u4EE5\u6709\u5C0F\u6807\u9898\u4E0E\u65E0\u5E8F\u5217\u8868\uFF0C\u4E0D\u8981\u4EE3\u7801\u5757\uFF0C\u4E0D\u8981\u5BD2\u6684\u3002\u5FC5\u987B\u4E25\u683C\u9075\u5B88\u5B57\u6570\u4E0A\u9650\u3002"
    },
    {
      role: "user",
      content: [
        `\u6807\u9898\uFF1A${title}`,
        levelHint,
        `\u5B57\u6570\u4E0A\u9650\uFF1A${cap} \u4E2A\u5B57\u7B26\uFF08\u6E90\u6587 ${srcLen} \u5B57\u7684 10%\uFF0C\u786C\u9650\u5236\uFF09\u3002`,
        childLines ? `\u4E0B\u4E00\u5C42\u6761\u76EE\uFF08\u76F8\u5BF9\u8DEF\u5F84\uFF0C\u8BF7\u539F\u6837\u7528\u4E8E\u94FE\u63A5\uFF09\uFF1A
${childLines}` : "",
        `
\u6B63\u6587\uFF08\u53EF\u80FD\u88AB\u622A\u65AD\uFF09\uFF1A
${sample}`
      ].filter(Boolean).join("\n")
    }
  ];
  try {
    const result = await Promise.race([
      chatCompletion2({ messages, overrides: model ? { model } : void 0 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("\u6458\u8981\u8D85\u65F6")), timeoutMs))
    ]);
    let text = String(result?.message?.content ?? "").trim();
    if (!text) return null;
    text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
    const chars = Array.from(text);
    if (chars.length > cap) text = chars.slice(0, Math.max(0, cap - 1)).join("") + "\u2026";
    return text;
  } catch {
    return null;
  }
}
var SummaryCache = class {
  constructor({ file = "", log: log6 = () => {
  } } = {}) {
    this.file = file;
    this.log = log6;
    this.data = {};
    this.dirty = false;
    this.#load();
  }
  #load() {
    if (!this.file) return;
    try {
      const parsed = JSON.parse(import_node_fs7.default.readFileSync(this.file, "utf8"));
      if (parsed && typeof parsed === "object") this.data = parsed;
    } catch {
    }
  }
  get(level, targetId, hash) {
    const entry = this.data[`${level}:${targetId}`];
    if (!entry) return null;
    if (entry.promptVersion !== PROMPT_VERSION) return null;
    if (hash && entry.hash !== hash) return null;
    return entry;
  }
  set(level, targetId, { hash, text, source }) {
    this.data[`${level}:${targetId}`] = {
      hash,
      text,
      source,
      level,
      promptVersion: PROMPT_VERSION,
      at: Date.now()
    };
    this.dirty = true;
  }
  save() {
    if (!this.file || !this.dirty) return false;
    try {
      import_node_fs7.default.mkdirSync(import_node_path7.default.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp-${process.pid}`;
      import_node_fs7.default.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
      import_node_fs7.default.renameSync(tmp, this.file);
      this.dirty = false;
      return true;
    } catch (error) {
      this.log(`\u6458\u8981\u7F13\u5B58\u5199\u5165\u5931\u8D25\uFF1A${error?.message ?? error}`);
      return false;
    }
  }
  stats() {
    const out = { user: 0, llm: 0, extractive: 0, invalid: 0, missing: 0 };
    for (const e of Object.values(this.data)) {
      if (out[e.source] !== void 0) out[e.source] += 1;
    }
    return out;
  }
};

// packages/extension-compat/vendor/src/knowledge/ensure.js
function readText(abs, limit = 2e5) {
  try {
    const s = import_node_fs8.default.readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
    return s.length > limit ? s.slice(0, limit) : s;
  } catch {
    return "";
  }
}
function writeSummary(abs, text) {
  import_node_fs8.default.mkdirSync(import_node_path8.default.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  import_node_fs8.default.writeFileSync(tmp, text.endsWith("\n") ? text : `${text}
`, "utf8");
  import_node_fs8.default.renameSync(tmp, abs);
}
async function ensureSummaries(rootDir, tree, {
  chatCompletion: chatCompletion2 = null,
  model = "",
  useLlm = true,
  writeFiles = true,
  cache = null,
  log: log6 = () => {
  },
  budgetTokens = 2e4
} = {}) {
  const entries = /* @__PURE__ */ new Map();
  const stats = { user: 0, llm: 0, extractive: 0, missing: 0, written: 0, chars: 0 };
  let spent = 0;
  const nodes = [];
  (function collect(n) {
    nodes.push(n);
    for (const c of n.children || []) collect(c);
  })(tree);
  const ordered = [...nodes].sort((a, b) => b.depth - a.depth || (a.kind === "doc" ? -1 : 1));
  for (const node of ordered) {
    const level = node.depth === 0 ? "L0" : node.kind === "dir" ? "L1" : "L2";
    const sumAbs = summaryAbsFor(rootDir, node);
    const children = node.kind === "doc" ? [{ title: node.name, href: relLink(import_node_path8.default.dirname(sumAbs), node.abs) }] : childLinksFor(rootDir, node);
    let sourceLength = 0;
    if (node.kind === "doc") {
      sourceLength = readText(node.abs).length;
    } else {
      for (const c of node.children || []) {
        const e = entries.get(c.relPath);
        sourceLength += e ? String(e.text || "").length : 0;
      }
      if (!sourceLength && node.children?.length) sourceLength = 200 * node.children.length;
    }
    const cap = summaryCap(sourceLength, level);
    const needLinks = children.length ? 1 : 0;
    const checkOpts = { title: node.name, sourceLength, requireLinks: needLinks };
    let existing = "";
    try {
      if (import_node_fs8.default.existsSync(sumAbs)) existing = readText(sumAbs);
    } catch {
    }
    if (existing) {
      const ok = validateSummaryText(existing, level, checkOpts).ok && validateSummaryLinks(existing, { dir: rootDir, fsExists: (x) => import_node_fs8.default.existsSync(x), baseDir: import_node_path8.default.relative(rootDir, import_node_path8.default.dirname(sumAbs)) || "." }).ok;
      if (ok) {
        entries.set(node.relPath, { text: existing, source: "user", cap, level });
        stats.user += 1;
        continue;
      }
      log6(`${node.relPath || "."}\uFF1A\u6458\u8981\u4E0D\u5408\u89C4\uFF0C\u91CD\u65B0\u751F\u6210`);
    }
    let text = "";
    let source = "llm";
    const hash = hashContent(`${level}|${node.name}|${sourceLength}|${children.map((c) => c.href).join(",")}`);
    const hit = cache ? cache.get(level, node.relPath || "__root__", hash) : null;
    if (hit) {
      text = hit.text;
      source = hit.source || "llm";
    } else {
      const content = node.kind === "doc" ? readText(node.abs) : "";
      if (useLlm && chatCompletion2 && spent < budgetTokens) {
        const t = await llmSummary({
          title: node.name,
          content,
          level,
          children,
          sourceLength,
          model,
          chatCompletion: chatCompletion2
        });
        if (t && validateSummaryText(t, level, { ...checkOpts, requireLinks: 0 }).ok) {
          text = t;
          source = "llm";
          spent += Math.ceil(sourceLength / 2);
        }
      }
      if (!text) {
        text = extractiveSummary(content || `\u672C\u5C42\u542B ${children.length} \u4E2A\u6761\u76EE\u3002`, {
          level,
          maxChars: cap,
          title: node.name,
          children,
          sourceLength
        });
        source = "extractive";
      }
      if (cache) cache.set(level, node.relPath || "__root__", { hash, text, source });
    }
    entries.set(node.relPath, { text, source, cap, level });
    stats[source] = (stats[source] || 0) + 1;
    stats.chars += text.length;
    if (writeFiles) {
      try {
        writeSummary(sumAbs, text);
        stats.written += 1;
      } catch (error) {
        log6(`\u5199\u6458\u8981\u5931\u8D25 ${sumAbs}\uFF1A${error?.message ?? error}`);
      }
    }
  }
  try {
    if (writeFiles) recordFingerprints(rootDir, tree);
  } catch {
  }
  return { stats, entries };
}
function readSummary(rootDir, node) {
  return readText(summaryAbsFor(rootDir, node));
}

// packages/extension-compat/vendor/src/extensions/index.js
var extensions_exports = {};
__export(extensions_exports, {
  BUILTIN_PLUGIN_ALLOWLIST: () => BUILTIN_PLUGIN_ALLOWLIST,
  EXT_TYPES: () => EXT_TYPES,
  ExtensionDescriptorRegistry: () => ExtensionDescriptorRegistry,
  ExtensionHookBus: () => ExtensionHookBus,
  HOOK_DEFINITIONS: () => HOOK_DEFINITIONS,
  PROMPT_ANCHORS: () => PROMPT_ANCHORS,
  REWRITE_TARGETS: () => REWRITE_TARGETS,
  VALID_ANCHORS: () => VALID_ANCHORS,
  VALID_HOOK_IDS: () => VALID_HOOK_IDS,
  VALID_TARGETS: () => VALID_TARGETS,
  VALID_TYPE_IDS: () => VALID_TYPE_IDS,
  createExtensionApi: () => createExtensionApi,
  extensionHookBus: () => extensionHookBus,
  extensionRegistry: () => extensionRegistry,
  notifyToolsChanged: () => notifyToolsChanged,
  onToolsChanged: () => onToolsChanged,
  registerToolAs: () => registerTool2,
  resolveRewriteConflicts: () => resolveRewriteConflicts,
  typeOfDir: () => typeOfDir,
  unregisterToolsByOwner: () => unregisterToolsByOwner,
  validateExports: () => validateExports,
  validateInjectDeclaration: () => validateInjectDeclaration,
  validateManifest: () => validateManifest,
  validatePromptInjectExports: () => validatePromptInjectExports
});

// packages/extension-compat/vendor/src/extensions/hook-bus.js
var HOOK_DEFINITIONS = {
  // ── 启动/关闭 ──
  "kernel.ready": { phase: "kernel", description: "\u5185\u6838\u670D\u52A1\u5C31\u7EEA\uFF08\u4E0D\u542B\u6269\u5C55\uFF09", failPolicy: "open", timeoutMs: 5e3, totalBudgetMs: 5e3, canVeto: false },
  "kernel.shutdown": { phase: "kernel", description: "\u5185\u6838\u5373\u5C06\u505C\u6B62\uFF08\u6E05\u7406\u8D44\u6E90\uFF09", failPolicy: "open", timeoutMs: 5e3, totalBudgetMs: 5e3, canVeto: false },
  // ── 扩展生命周期 ──
  "extension.load": { phase: "extension", description: "\u5B50\u6269\u5C55\u5373\u5C06\u52A0\u8F7D\uFF08\u53EF\u5426\u51B3\uFF09", failPolicy: "close", timeoutMs: 2e3, totalBudgetMs: 2e3, canVeto: true },
  "extension.unload": { phase: "extension", description: "\u5B50\u6269\u5C55\u5373\u5C06\u5378\u8F7D\uFF08\u53EF\u5426\u51B3\uFF09", failPolicy: "open", timeoutMs: 2e3, totalBudgetMs: 2e3, canVeto: true },
  "extension.activate": { phase: "extension", description: "\u5B50\u6269\u5C55\u5373\u5C06\u6FC0\u6D3B\uFF08\u53EF\u5426\u51B3\uFF09", failPolicy: "open", timeoutMs: 2e3, totalBudgetMs: 2e3, canVeto: true },
  "extension.deactivate": { phase: "extension", description: "\u5B50\u6269\u5C55\u5373\u5C06\u505C\u7528", failPolicy: "open", timeoutMs: 2e3, totalBudgetMs: 2e3, canVeto: false },
  // ── 消息入站 ──
  "message.received": { phase: "message", description: "\u6D88\u606F\u5165\u5E93\u540E\u3001\u89E6\u53D1\u5224\u5B9A\u524D\uFF08\u53EF\u6539\u5199/\u53EF\u62E6\uFF09", failPolicy: "open", timeoutMs: 500, totalBudgetMs: 2e3, canVeto: true },
  "trigger.evaluate": { phase: "trigger", description: "\u89E6\u53D1\u5224\u5B9A\uFF08\u53EF\u5426\u51B3\u5524\u9192\uFF09", failPolicy: "open", timeoutMs: 500, totalBudgetMs: 1e3, canVeto: true },
  "session.wake": { phase: "session", description: "\u4F1A\u8BDD\u5524\u9192\u5F00\u59CB\uFF08\u53EA\u8BFB\uFF09", failPolicy: "open", timeoutMs: 500, totalBudgetMs: 1e3, canVeto: false },
  // ── 上下文/提示词 ──
  "context.build": { phase: "context", description: "\u7EC4\u88C5\u4E0A\u4E0B\u6587\uFF08triggerEntries/store/memory\uFF09", failPolicy: "open", timeoutMs: 2e3, totalBudgetMs: 5e3, canVeto: false },
  "prompt.segments": { phase: "prompt", description: "\u6536\u96C6/\u6539\u5199\u63D0\u793A\u8BCD\u6BB5\u843D", failPolicy: "open", timeoutMs: 1e3, totalBudgetMs: 3e3, canVeto: false },
  "prompt.render": { phase: "prompt", description: "\u6700\u7EC8\u63D0\u793A\u8BCD\u5B57\u7B26\u4E32\u540E\u5904\u7406", failPolicy: "open", timeoutMs: 1e3, totalBudgetMs: 2e3, canVeto: false },
  "messages.before": { phase: "llm", description: "\u6D88\u606F\u5373\u5C06\u53D1\u7ED9\u6A21\u578B\uFF08\u539F\u5730\u6539 messages\uFF09", failPolicy: "open", timeoutMs: 2e3, totalBudgetMs: 3e3, canVeto: false },
  // ── 模型 ──
  "llm.before": { phase: "llm", description: "LLM \u8BF7\u6C42\u4F53\u6539\u5199", failPolicy: "open", timeoutMs: 1e3, totalBudgetMs: 2e3, canVeto: false },
  "llm.after": { phase: "llm", description: "LLM \u54CD\u5E94\u52A0\u5DE5", failPolicy: "open", timeoutMs: 1e3, totalBudgetMs: 2e3, canVeto: false },
  "llm.error": { phase: "llm", description: "LLM \u9519\u8BEF\uFF08\u53EF\u7ED9\u91CD\u8BD5\u5EFA\u8BAE\uFF09", failPolicy: "open", timeoutMs: 500, totalBudgetMs: 1e3, canVeto: false },
  // ── 工具 ──
  "tools.resolve": { phase: "tool", description: "\u672C\u8F6E\u53EF\u89C1\u5DE5\u5177\u96C6\uFF08\u53EF\u6536\u7A84\uFF09", failPolicy: "open", timeoutMs: 500, totalBudgetMs: 1e3, canVeto: false },
  "tool.before": { phase: "tool", description: "\u5DE5\u5177\u6267\u884C\u524D\uFF08\u53EF\u5426\u51B3\uFF09", failPolicy: "close", timeoutMs: 1e3, totalBudgetMs: 2e3, canVeto: true },
  "tool.after": { phase: "tool", description: "\u5DE5\u5177\u6267\u884C\u540E\uFF08\u89C2\u5BDF/\u52A0\u5DE5\u7ED3\u679C\uFF09", failPolicy: "open", timeoutMs: 1e3, totalBudgetMs: 2e3, canVeto: false },
  // ── 发送 ──
  "reply.before-send": { phase: "reply", description: "\u51FA\u7AD9\u524D\uFF08\u53EF\u5426\u51B3/\u6539\u5199\u6587\u672C\u4E0E\u5A92\u4F53\uFF09", failPolicy: "close", timeoutMs: 1e3, totalBudgetMs: 2e3, canVeto: true },
  "reply.after-send": { phase: "reply", description: "\u51FA\u7AD9\u540E\uFF08\u53EA\u8BFB\u7ED3\u679C\uFF09", failPolicy: "open", timeoutMs: 500, totalBudgetMs: 1e3, canVeto: false },
  "reply.failed": { phase: "reply", description: "\u53D1\u9001\u5931\u8D25\uFF08\u53EA\u8BFB\u9519\u8BEF\uFF09", failPolicy: "open", timeoutMs: 500, totalBudgetMs: 1e3, canVeto: false },
  // ── 会话结束 ──
  "session.end": { phase: "session", description: "\u4F1A\u8BDD\u7ED3\u675F\uFF08\u53EA\u8BFB\u6458\u8981\uFF09", failPolicy: "open", timeoutMs: 500, totalBudgetMs: 1e3, canVeto: false },
  // ── 配置 ──
  "config.changed": { phase: "config", description: "\u914D\u7F6E\u53D8\u66F4\uFF08\u53EA\u8BFB\u53D8\u66F4\u952E\uFF09", failPolicy: "open", timeoutMs: 500, totalBudgetMs: 1e3, canVeto: false }
};
var VALID_HOOK_IDS = new Set(Object.keys(HOOK_DEFINITIONS));
var ExtensionHookBus = class {
  // 缓存：每个 hook 的活跃监听排序（注册/注销时失效）
  #cache = /* @__PURE__ */ new Map();
  constructor({ log: log6 = () => {
  } } = {}) {
    this.listeners = /* @__PURE__ */ new Map();
    this.log = log6;
    this.seq = 0;
  }
  /**
   * 注册一个 hook 监听。
   * @param {object} opts
   *   ownerId — 扩展 id（用于排序与归因）
   *   hookId — HOOK_DEFINITIONS 里的合法名
   *   fn     — 监听函数 (context, meta) => any
   *   priority — 排序权重（小的先执行；默认 50）
   */
  register({ ownerId, hookId, fn, priority = 50 }) {
    if (!VALID_HOOK_IDS.has(hookId)) {
      throw new Error(`\u672A\u77E5\u7684\u6269\u5C55 hook\uFF1A${hookId}\uFF08\u5408\u6CD5\u503C\u89C1 HOOK_DEFINITIONS\uFF09`);
    }
    if (typeof fn !== "function") throw new Error(`hook ${hookId} \u7684\u76D1\u542C\u5FC5\u987B\u662F\u51FD\u6570`);
    const list = this.listeners.get(hookId) || [];
    const entry = { ownerId: String(ownerId || ""), fn, priority: Number(priority) || 50, seq: ++this.seq };
    list.push(entry);
    this.listeners.set(hookId, list);
    this.#cache.delete(hookId);
    return true;
  }
  /** 注销某 owner 在某 hook 的全部监听。 */
  unregister(ownerId, hookId = null) {
    for (const [hid, list] of this.listeners) {
      if (hookId && hid !== hookId) continue;
      const next = list.filter((e) => e.ownerId !== ownerId);
      if (next.length !== list.length) {
        if (next.length) this.listeners.set(hid, next);
        else this.listeners.delete(hid);
        this.#cache.delete(hid);
      }
    }
  }
  /** 获取某 hook 的已排序监听（缓存）。 */
  #sorted(hookId) {
    if (this.#cache.has(hookId)) return this.#cache.get(hookId);
    const list = [...this.listeners.get(hookId) || []].sort(
      (a, b) => a.priority - b.priority || a.seq - b.seq
    );
    this.#cache.set(hookId, list);
    return list;
  }
  /** 该 hook 是否有任何监听（空监听零开销）。 */
  hasListeners(hookId) {
    return (this.listeners.get(hookId) || []).length > 0;
  }
  /**
   * 派发一个 hook。
   *
   * @param {string} hookId — 合法 hook 名
   * @param {object} context — 载荷（各 hook 有自己的 schema）
   * @param {object} [opts]
   *   activeFilter — (ownerId) => boolean，只对返回 true 的扩展执行（默认全部）
   * @returns {Promise<{ results: Array<{ownerId, value}>, vetoed: boolean, veto: object|null, errors: number, skipped: number }>}
   */
  async dispatch(hookId, context = {}, opts = {}) {
    const def = HOOK_DEFINITIONS[hookId];
    if (!def) throw new Error(`\u672A\u77E5\u7684\u6269\u5C55 hook\uFF1A${hookId}`);
    const listeners = this.#sorted(hookId);
    if (listeners.length === 0) {
      return { results: [], vetoed: false, veto: null, errors: 0, skipped: 0 };
    }
    const activeFilter = opts.activeFilter || null;
    const results = [];
    let errors = 0;
    let skipped = 0;
    let veto = null;
    let totalMs = 0;
    for (const entry of listeners) {
      if (activeFilter && !activeFilter(entry.ownerId)) {
        skipped++;
        continue;
      }
      if (def.totalBudgetMs > 0 && totalMs >= def.totalBudgetMs) {
        skipped++;
        this.log(`[hook:${hookId}] \u603B\u9884\u7B97 ${def.totalBudgetMs}ms \u5DF2\u7528\u5B8C\uFF0C\u8DF3\u8FC7\u5269\u4F59\u76D1\u542C\uFF08\u542B ${entry.ownerId}\uFF09`);
        continue;
      }
      try {
        const out = await this.#withTimeout(
          entry.fn(context, { ownerId: entry.ownerId, hookId }),
          def.timeoutMs,
          `${entry.ownerId}#${hookId}`
        );
        totalMs += 1;
        if (out !== void 0 && out !== null) {
          results.push({ ownerId: entry.ownerId, value: out });
          if (def.canVeto && !veto) {
            const isVeto = out && typeof out === "object" && (out.block === true || out.veto === true) || out === false;
            if (isVeto) veto = out;
          }
        }
      } catch (error) {
        errors++;
        this.log(`[hook:${hookId}] ${entry.ownerId} \u5931\u8D25\uFF1A${error?.message ?? error}`);
        if (def.failPolicy === "close" && def.canVeto && !veto) {
          veto = { block: true, reason: `hook ${hookId} \u56E0 ${entry.ownerId} \u51FA\u9519\u88AB\u5B89\u5168\u62D2\u7EDD` };
        }
      }
    }
    return {
      results,
      vetoed: Boolean(veto),
      veto,
      errors,
      skipped
    };
  }
  #withTimeout(promise, ms, label) {
    if (!ms || !Number.isFinite(ms)) return promise;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error(`hook \u8D85\u65F6\uFF08${ms}ms\uFF09`)), ms);
        t.unref?.();
      })
    ]);
  }
  /** 列出当前已注册的 hook 与监听数（诊断用）。 */
  stats() {
    const out = {};
    for (const [hid, list] of this.listeners) out[hid] = list.length;
    return out;
  }
  clear() {
    this.listeners.clear();
    this.#cache.clear();
  }
};
var extensionHookBus = new ExtensionHookBus({ log: (...a) => console.log("[ext-hook]", ...a) });

// packages/extension-compat/vendor/src/extensions/tool-bridge.js
function registerTool2(ownerId, def) {
  if (!def?.id) throw new Error("\u5DE5\u5177\u5FC5\u987B\u63D0\u4F9B id");
  if (!ownerId) throw new Error("registerToolAs \u9700\u8981 ownerId");
  const sanitize = (s) => String(s ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
  const oid = sanitize(ownerId).slice(0, 24);
  const tid = sanitize(def.id).slice(0, 38);
  const prefixedId = tid.startsWith(`${oid}__`) ? tid : `${oid}__${tid}`;
  const existing = getTool(prefixedId);
  if (existing && existing.skillId && existing.skillId !== ownerId) {
    console.warn(`[ext] \u26A0\uFE0F \u5DE5\u5177 id \u51B2\u7A81\uFF1A${prefixedId} \u5DF2\u7531 ${existing.skillId} \u6CE8\u518C\uFF0C${ownerId} \u7684\u540C\u540D\u5DE5\u5177\u4F1A\u8986\u76D6\u5B83`);
  }
  registerTool({
    ...def,
    id: prefixedId,
    // skillId 是 tool-registry 的归属字段：这里绑定为 ownerId
    skillId: ownerId,
    _owner: ownerId
  });
  return prefixedId;
}
function unregisterToolsByOwner(ownerId) {
  const ids = [];
  for (const tool of listTools()) {
    if (tool.skillId === ownerId || tool._owner === ownerId) {
      unregisterTool(tool.id);
      ids.push(tool.id);
    }
  }
  return ids;
}

// packages/extension-compat/vendor/src/extensions/doc-registry.js
var MAX_DOC_BYTES = 200 * 1024;
var DocRegistry = class {
  constructor() {
    this.docs = /* @__PURE__ */ new Map();
    this.kbs = /* @__PURE__ */ new Map();
  }
  /**
   * 登记一篇文档。
   * @param {object} doc { id, title, summary, layer?: 'L2'|'L3'|'tool'|'skill', ownerId, content, path }
   */
  register(doc) {
    const id = String(doc?.id || "").trim();
    if (!id) return { ok: false, error: "\u6587\u6863\u7F3A\u5C11 id" };
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/.test(id)) {
      return { ok: false, error: `\u6587\u6863 id \u975E\u6CD5\uFF1A${id}` };
    }
    if (this.docs.has(id)) {
      return { ok: false, error: `\u6587\u6863 id \u5DF2\u5B58\u5728\uFF1A${id}\uFF08\u5148\u767B\u8BB0\u8005\u4F18\u5148\uFF09` };
    }
    let content = typeof doc.content === "string" ? doc.content : "";
    let truncated = false;
    if (content.length > MAX_DOC_BYTES) {
      content = content.slice(0, MAX_DOC_BYTES);
      truncated = true;
    }
    this.docs.set(id, {
      id,
      title: String(doc.title || id),
      summary: String(doc.summary || "").slice(0, 500),
      // 摘要来源：user（清单提供且合法）/ llm / extractive / invalid / missing
      summarySource: String(doc.summarySource || "user"),
      layer: String(doc.layer || "L3"),
      ownerId: String(doc.ownerId || ""),
      path: doc.path ? String(doc.path) : "",
      content,
      truncated
    });
    return { ok: true };
  }
  /** 登记一本知识库（L0 + L1）。 */
  registerKb(kb) {
    const id = String(kb?.id || "").trim();
    if (!id) return { ok: false, error: "\u77E5\u8BC6\u5E93\u7F3A\u5C11 id" };
    this.kbs.set(id, {
      id,
      title: String(kb.title || id),
      summary: String(kb.summary || "").slice(0, 1e3),
      summarySource: String(kb.summarySource || "user"),
      scope: kb.scope === "session" ? "session" : "global",
      ownerId: String(kb.ownerId || ""),
      modules: Array.isArray(kb.modules) ? kb.modules.slice(0, 50) : []
    });
    return { ok: true };
  }
  unregisterKb(id) {
    return this.kbs.delete(String(id));
  }
  /** 按 owner 注销全部文档与知识库（子扩展卸载时调用）。 */
  unregisterByOwner(ownerId) {
    const oid = String(ownerId);
    const removed = { docs: [], kbs: [] };
    for (const [id, d] of this.docs) {
      if (d.ownerId === oid) {
        this.docs.delete(id);
        removed.docs.push(id);
      }
    }
    for (const [id, kb] of this.kbs) {
      if (kb.ownerId === oid) {
        this.kbs.delete(id);
        removed.kbs.push(id);
      }
    }
    return removed;
  }
  get(id) {
    return this.docs.get(String(id)) || null;
  }
  list() {
    return [...this.docs.values()];
  }
  listKbs() {
    return [...this.kbs.values()];
  }
  /**
   * 取正文（供 load_doc 工具）。
   * @returns {{ ok: boolean, doc?: object, error?: string }}
   */
  read(id) {
    const doc = this.get(id);
    if (!doc) return { ok: false, error: `\u672A\u627E\u5230\u6587\u6863\uFF1A${id}` };
    return { ok: true, doc };
  }
  /** 批量取简介（供提示词注入，L0/L1 预算控制）。 */
  summaries({ maxKbs = 6, maxModulesPerKb = 12, maxChars = 3e3 } = {}) {
    const lines = [];
    let used = 0;
    for (const kb of [...this.kbs.values()].slice(0, maxKbs)) {
      const head = `\xB7 ${kb.title}${kb.summary ? `\uFF1A${kb.summary}` : ""}`;
      if (used + head.length > maxChars) break;
      lines.push(head);
      used += head.length;
      for (const m of kb.modules.slice(0, maxModulesPerKb)) {
        const line = `  - ${m.title}${m.intro ? `\uFF1A${m.intro}` : ""}${m.docIds?.length ? `\uFF08\u6587\u6863\uFF1A${m.docIds.join("\u3001")}\uFF09` : ""}`;
        if (used + line.length > maxChars) break;
        lines.push(line);
        used += line.length;
      }
    }
    return lines.join("\n");
  }
  clear() {
    this.docs.clear();
    this.kbs.clear();
  }
  // ── 摘要写入（供管理器后台生成后回填）────────────────────────────────
  /** 更新某文档的 L2 摘要与来源。 */
  setDocSummary(docId, { summary, source = "llm" } = {}) {
    const d = this.docs.get(String(docId));
    if (!d) return false;
    d.summary = String(summary || "").slice(0, 500);
    d.summarySource = String(source);
    return true;
  }
  /** 更新某知识库的 L0 摘要与来源。 */
  setKbSummary(kbId, { summary, source = "llm" } = {}) {
    const kb = this.kbs.get(String(kbId));
    if (!kb) return false;
    kb.summary = String(summary || "").slice(0, 1e3);
    kb.summarySource = String(source);
    return true;
  }
  /** 更新某模块的 L1 简介与来源。 */
  setModuleIntro(kbId, moduleId, { intro, source = "llm" } = {}) {
    const kb = this.kbs.get(String(kbId));
    if (!kb) return false;
    const m = (kb.modules || []).find((x) => String(x.id) === String(moduleId));
    if (!m) return false;
    m.intro = String(intro || "").slice(0, 500);
    m.introSource = String(source);
    return true;
  }
  /** 摘要来源分布（UI 用）。 */
  summaryStats() {
    const out = { user: 0, llm: 0, extractive: 0, invalid: 0, missing: 0, total: 0 };
    const bump = (s) => {
      if (out[s] !== void 0) out[s] += 1;
    };
    for (const d of this.docs.values()) {
      if (d.layer !== "L3") continue;
      out.total += 1;
      bump(d.summarySource || "user");
    }
    for (const kb of this.kbs.values()) {
      out.total += 1;
      bump(kb.summarySource || "user");
      for (const m of kb.modules || []) {
        out.total += 1;
        bump(m.introSource || "user");
      }
    }
    return out;
  }
};
var docRegistry = new DocRegistry();

// packages/extension-compat/vendor/src/extensions/api.js
var toolChangeListeners = /* @__PURE__ */ new Set();
function onToolsChanged(fn) {
  if (typeof fn === "function") toolChangeListeners.add(fn);
  return () => toolChangeListeners.delete(fn);
}
function notifyToolsChanged(reason = "") {
  for (const fn of toolChangeListeners) {
    try {
      fn(reason);
    } catch {
    }
  }
}
function createExtensionApi(typeId, extId, permissions = [], { scope = "global", builtin = false } = {}) {
  const gate = EXT_TYPES[typeId];
  if (!gate) throw new Error(`\u672A\u77E5\u6269\u5C55\u7C7B\u578B\uFF1A${typeId}`);
  const has = (name) => permissions.includes(name);
  const log6 = (...args) => console.log(`[ext:${extId}]`, ...args);
  const warn = (...args) => console.warn(`[ext:${extId}]`, ...args);
  const base = {
    log: log6,
    warn,
    error: (...args) => console.error(`[ext:${extId}]`, ...args),
    // 人设库（只读，按 id 取正文）：与 v1 api.personaLibrary 同语义
    personaLibrary: () => listPersonaLibrary(),
    // 兼容 v1：查询别的 Skill 是否生效（迁移期保留，后续用 isExtensionEnabled 取代）
    isSkillActive: (id, ctx = {}) => {
      try {
        return skillManager.isActive(id, ctx).active;
      } catch {
        return false;
      }
    },
    // 本扩展设置（manifest.settings 默认值已合并）；与 v1 的 api.config() 同语义
    // 字符串值里的 `{{...}}` 在这里渲染 —— 扩展拿到的是"已转换"的值
    config: () => {
      try {
        return renderConfigDeep(skillManager.settingsOf(extId), { ownerId: extId });
      } catch {
        return {};
      }
    },
    utils: {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      safeJsonParse: (text, fallback = null) => {
        try {
          return JSON.parse(text);
        } catch {
          return fallback;
        }
      }
    }
  };
  if (gate.canRegisterTool || typeId === "tool" || typeId === "plugin") {
    base.registerToolAs = (ownerId, def) => {
      const check = extensionRegistry.canOwnerRegisterTool(ownerId);
      if (!check.ok) throw new Error(check.reason);
      const actualId = registerTool2(ownerId, def);
      return actualId;
    };
    base.unregisterToolsByOwner = (ownerId) => unregisterToolsByOwner(ownerId);
    base.notifyToolsChanged = notifyToolsChanged;
  }
  if (gate.canHook) {
    base.registerHook = ({ hook, fn, priority }) => extensionHookBus.register({ ownerId: extId, hookId: hook, fn, priority });
    base.unregisterHook = (hookId = null) => extensionHookBus.unregister(extId, hookId);
  }
  if (typeId === "plugin") {
    base.registerSubExtension = (descriptor) => extensionRegistry.register({ ...descriptor, managerId: extId });
    base.unregisterSubExtension = (id) => extensionRegistry.unregister(id);
    base.unregisterSubExtensionsByManager = () => extensionRegistry.unregisterByManager(extId);
    base.listSubExtensions = (type) => type ? extensionRegistry.listByType(type) : extensionRegistry.list();
    base.docRegistry = docRegistry;
    base.registerPromptContribution = (source) => registerPromptContributionSource(extId, source);
    base.unregisterPromptContribution = () => unregisterPromptContributionSource(extId);
    base.registerUIContribution = (contribution) => {
      if (String(scope) === "session") throw new Error("\u4F1A\u8BDD\u7EA7\u63D2\u4EF6\u4E0D\u80FD\u8D21\u732E\u754C\u9762\uFF08\u53EA\u6709\u5168\u5C40\u63D2\u4EF6\u53EF\u4EE5\uFF09");
      return uiExtensionRegistry.register({ ...contribution, ownerId: contribution.ownerId || extId });
    };
    base.registerUIAction = (action) => {
      if (String(scope) === "session") throw new Error("\u4F1A\u8BDD\u7EA7\u63D2\u4EF6\u4E0D\u80FD\u6CE8\u518C\u754C\u9762\u52A8\u4F5C\uFF08\u53EA\u6709\u5168\u5C40\u63D2\u4EF6\u53EF\u4EE5\uFF09");
      return uiExtensionRegistry.registerAction({ ...action, ownerId: action.ownerId || extId });
    };
    base.uiSlots = () => Object.keys(UI_SLOTS);
    base.registerExtensionTab = (spec) => {
      if (String(scope) === "session") throw new Error("\u4F1A\u8BDD\u7EA7\u63D2\u4EF6\u4E0D\u80FD\u6CE8\u518C\u6269\u5C55\u4ED3\u5E93\u9875\u7B7E");
      if (skillManager.isEnabled(extId) === false) return null;
      const r = registerTab(spec, { ownerId: extId, scope, builtin: Boolean(builtin) });
      if (!r.ok) throw new Error(r.error);
      return r.tab;
    };
    base.unregisterExtensionTab = () => unregisterTabsByOwner(extId);
    base.listExtensionTabs = () => listTabs();
    base.isExtensionEnabled = (id, chatKey = "") => {
      const d = extensionRegistry.get(id);
      if (!d) return null;
      if (!extensionRegistry.hasExplicitConfig(id, { chatKey })) return null;
      return extensionRegistry.isSessionEnabled(id, { chatKey });
    };
  }
  base.getSubExtension = (id) => extensionRegistry.get(id);
  base.listExtensions = () => extensionRegistry.list();
  base.fetch = has("web_fetch") ? async (url, options = {}) => {
    const result = await safeFetch(url, options);
    return result;
  } : () => Promise.reject(new Error(`\u6269\u5C55 ${extId} \u672A\u58F0\u660E web_fetch \u6743\u9650`));
  return base;
}

// packages/extension-compat/vendor/src/plugin-loader.js
var import_node_fs9 = __toESM(require("node:fs"), 1);
var import_node_path9 = __toESM(require("node:path"), 1);
var import_node_util = require("node:util");
var import_node_url2 = require("node:url");
var APP_ROOT2 = import_node_path9.default.resolve(import_node_path9.default.dirname((0, import_node_url2.fileURLToPath)(__extensionHost.url("src/plugin-loader.js"))), "..");
var SKILLS_DIR = import_node_path9.default.resolve(APP_ROOT2, "skills");
var PLUGINS_DIR = import_node_path9.default.resolve(APP_ROOT2, "plugins");
var CHAT_PLUGINS_DIR = import_node_path9.default.resolve(APP_ROOT2, "chat-plugins");
function adaptLegacyPrompt(raw, manifest) {
  if (manifest.prompt?.sections?.length) return manifest;
  const p = raw?.prompt;
  if (!p || typeof p !== "object") return manifest;
  const lines = [];
  if (p.when) lines.push(`\u4F55\u65F6\u4F7F\u7528\uFF1A${String(p.when).trim()}`);
  if (Array.isArray(p.examples) && p.examples.length) {
    const ex = p.examples.map((x) => String(x ?? "").trim()).filter(Boolean);
    if (ex.length) lines.push(`\u793A\u4F8B\uFF1A${ex.join(" / ")}`);
  }
  if (p.instruction) lines.push(String(p.instruction).trim());
  if (!lines.length) return manifest;
  manifest.prompt = {
    sections: [{ id: "legacy", title: manifest.name || manifest.id, content: lines.join("\n"), priority: 50 }]
  };
  return manifest;
}
var runtimeSender = null;
function setSkillRuntime({ sender = null } = {}) {
  runtimeSender = sender || null;
}
function createSkillApi(skillId, permissions = []) {
  const has = (name) => permissions.includes(name);
  return {
    // 发送队列：插件若需要直发（文件/通知）必须先走它，避免绕过限频与留档。
    // ⚠️ 以前这里没有 sender，导致 sleep-schedule 的发送补丁永远挂不上。
    get sender() {
      return runtimeSender;
    },
    // 注册工具（自动加 skillId 前缀 + 绑定来源，便于开关联动与批量清理）
    registerTool: (def) => {
      if (!def?.id) throw new Error("\u5DE5\u5177\u5FC5\u987B\u63D0\u4F9B id");
      const sanitize = (s) => String(s ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
      const sid = sanitize(skillId).slice(0, 24);
      const tid = sanitize(def.id).slice(0, 38);
      const prefixedId = tid.startsWith(`${sid}__`) ? tid : `${sid}__${tid}`;
      const existing = getTool(prefixedId);
      if (existing && existing.skillId && existing.skillId !== skillId) {
        console.warn(`[skill] \u26A0\uFE0F \u5DE5\u5177 id \u51B2\u7A81\uFF1A${prefixedId} \u5DF2\u7531 ${existing.skillId} \u6CE8\u518C\uFF0C${skillId} \u7684\u540C\u540D\u5DE5\u5177\u4F1A\u8986\u76D6\u5B83`);
      }
      registerTool({ ...def, id: prefixedId, skillId, _plugin: skillId });
      return prefixedId;
    },
    // 读取本 Skill 的配置（默认值已由 manifest.settings 合并）
    config: () => skillManager.settingsOf(skillId),
    /**
     * 读人设库（只读）：[{ id, name, text, builtin, usage }]。
     *
     * 2026-10-22 起人设正文只在库里存一份，会话按 id 引用 —— 需要"按人设切换"
     * 的插件（如 persona-picker）必须按 id 取正文，不能自己读 config.json 里
     * 的 customPersonas（那份副本已经不存在了，而且按名称存值会在改名后失效）。
     */
    personaLibrary: () => listPersonaLibrary(profilePersonaEntries()),
    // 查询其它 Skill 是否生效（用于"我依赖的知识库没开就别硬跑"这类判断）
    isSkillActive: (id, ctx = {}) => skillManager.isActive(id, ctx).active,
    /**
     * 软依赖调用：问"谁提供这个能力"，有就调、没有就静默返回 undefined。
     *
     * 与 manifest.requires 的区别（这个区分很重要）：
     *   requires          **硬依赖** —— 缺了就把本 Skill 判定为不可用，UI 显示"依赖未就绪"
     *   api.capability()  **软依赖** —— 有能力就增强，没有就降级，本 Skill 照常工作
     * 例：发言标签想在有"主人识别"模块时自动加〔主人〕标记，
     *     但没装那个模块时绝不该因此变成不可用 —— 那就该用软依赖。
     *
     * 只取第一个生效的提供者（约定：同类能力只应有一个提供者）。
     */
    capability: (name, args = {}) => {
      for (const p of skillManager.getCapabilityProviders(name, {})) {
        try {
          return p.fn(args);
        } catch {
          return void 0;
        }
      }
      return void 0;
    },
    hasCapability: (name) => skillManager.hasCapability(name),
    // 日志。
    // ⚠️ 必须先 util.format(...args) 再加前缀：format 只把**第一个参数**当格式串，
    //    如果写成 console.log(前缀, ...args)，前缀占掉第一位，插件写的
    //    log('已加载（%s~%s）', a, b) 里的 %s 就永远不会被替换（打印字面 %s）。
    log: (...args) => console.log(`[skill:${skillId}]`, (0, import_node_util.format)(...args)),
    warn: (...args) => console.warn(`[skill:${skillId}]`, (0, import_node_util.format)(...args)),
    error: (...args) => console.error(`[skill:${skillId}]`, (0, import_node_util.format)(...args)),
    // 只有声明了 web_fetch 权限才拿得到 fetch
    fetch: has("web_fetch") ? __extensionHost.legacyFetch : () => Promise.reject(new Error(`Skill ${skillId} \u672A\u58F0\u660E web_fetch \u6743\u9650`)),
    utils: {
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      safeJsonParse: (text, fallback = null) => {
        try {
          return JSON.parse(text);
        } catch {
          return fallback;
        }
      }
    }
  };
}
function readManifest(dir2) {
  const skillPath = import_node_path9.default.join(dir2, "skill.json");
  const pluginPath = import_node_path9.default.join(dir2, "plugin.json");
  let file = null;
  let source = "skill";
  if (import_node_fs9.default.existsSync(skillPath)) file = skillPath;
  else if (import_node_fs9.default.existsSync(pluginPath)) {
    file = pluginPath;
    source = "plugin";
  }
  if (!file) return { error: "\u7F3A\u5C11 skill.json / plugin.json", source };
  try {
    let text = import_node_fs9.default.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 65279) text = text.slice(1);
    const raw = JSON.parse(text);
    return { raw, source, file };
  } catch (error) {
    return { error: `\u6E05\u5355\u89E3\u6790\u5931\u8D25\uFF1A${error.message}`, source };
  }
}
function lintKindPlacement(kind, { manifest, toolIds, providers, hooks }, log6) {
  if (!kind) return;
  const hasTools = (toolIds || []).length > 0;
  const provides = Object.keys(providers || {}).length > 0 || Object.keys(hooks || {}).length > 0;
  if (kind === "skill" && !hasTools) {
    log6(`[skill] \u26A0\uFE0F ${manifest.id} \u5728 skills/\uFF08LLM \u578B\uFF09\u5374\u6CA1\u6709\u6CE8\u518C\u4EFB\u4F55\u5DE5\u5177\uFF1A\u6A21\u578B\u770B\u4E0D\u5230\u5B83\uFF0C\u529F\u80FD\u4E0D\u4F1A\u88AB\u89E6\u53D1\u3002\u8981\u4E48 registerTool\uFF0C\u8981\u4E48\u628A\u5B83\u79FB\u5230 plugins/\uFF08\u786E\u5B9A\u6027\u578B\uFF09\u3002`);
  }
  if (kind === "plugin" && !provides) {
    log6(`[skill] \u26A0\uFE0F ${manifest.id} \u5728 plugins/\uFF08\u786E\u5B9A\u6027\u578B\uFF09\u5374\u6CA1\u6709\u63D0\u4F9B\u80FD\u529B\u6216\u94A9\u5B50\uFF1A\u6CA1\u6709\u4EFB\u4F55\u4EE3\u7801\u4F1A\u53BB\u8C03\u7528\u5B83\u3002\u8981\u4E48 export providers / hooks\uFF0C\u8981\u4E48\u628A\u5B83\u79FB\u5230 skills/\uFF08LLM \u578B\uFF0C\u6CE8\u518C\u5DE5\u5177\uFF09\u3002`);
  }
}
async function loadSkillDir(dir2, { log: log6 = console.log, kind = null } = {}) {
  const dirName = import_node_path9.default.basename(dir2);
  const found = readManifest(dir2);
  const hadPrevious = found.error ? null : skillManager.isLoaded(
    // manifest 还没解析出来时用目录名当 id 兜底（normalizeManifest 的 fallbackId 同源）
    found.raw?.id ? String(found.raw.id) : dirName
  );
  const failRegister = (id, error) => {
    const existing = skillManager.registry.get(id);
    if (existing && !existing.loadError) {
      skillManager.errors.set(id, `${error}\uFF08\u5DF2\u6CBF\u7528\u65E7\u7248\u672C\u7EE7\u7EED\u8FD0\u884C\uFF09`);
      return { dir: dir2, loaded: false, id, error: `${error}\uFF08\u4FDD\u7559\u65E7\u7248\u672C\uFF09` };
    }
    skillManager.register({
      manifest: { id, name: id, version: "0.0.0", apiVersion: SKILL_API_VERSION, requires: [], capabilities: [], settings: {}, configSchema: {}, prompt: null },
      source: found.source,
      dir: dir2,
      relDir: import_node_path9.default.relative(APP_ROOT2, dir2).replace(/\\/g, "/"),
      kind,
      api: null,
      toolIds: [],
      available: null,
      availableReason: "",
      activate: null,
      deactivate: null,
      dispose: () => {
        unregisterToolsBySkill(id);
      },
      hooks: {},
      providers: {},
      promptSections: null,
      loadError: error
    });
    skillManager.errors.set(id, error);
    return { dir: dir2, loaded: false, id, error };
  };
  if (found.error) {
    const id = dirName;
    if (hadPrevious) {
      skillManager.errors.set(id, `${found.error}\uFF08\u5DF2\u6CBF\u7528\u65E7\u7248\u672C\u7EE7\u7EED\u8FD0\u884C\uFF09`);
      return { dir: dir2, loaded: false, id, error: `${found.error}\uFF08\u4FDD\u7559\u65E7\u7248\u672C\uFF09` };
    }
    const r2 = failRegister(id, found.error);
    log6(`[skill] \u274C ${id}\uFF1A${found.error}`);
    return r2;
  }
  const { manifest, problems } = normalizeManifest(found.raw, { fallbackId: dirName });
  for (const p of problems) log6(`[skill] \u26A0\uFE0F ${dirName}\uFF1A${p}`);
  if (!isManifestUsable(manifest, problems)) {
    const error = `\u6E05\u5355\u4E0D\u53EF\u7528\uFF1A${problems.join("\uFF1B")}`;
    if (hadPrevious) {
      skillManager.errors.set(manifest.id, `${error}\uFF08\u5DF2\u6CBF\u7528\u65E7\u7248\u672C\u7EE7\u7EED\u8FD0\u884C\uFF09`);
      return { dir: dir2, loaded: false, id: manifest.id, error: `${error}\uFF08\u4FDD\u7559\u65E7\u7248\u672C\uFF09` };
    }
    const r2 = failRegister(manifest.id, error);
    log6(`[skill] \u274C ${manifest.id}\uFF1A${error}`);
    return r2;
  }
  adaptLegacyPrompt(found.raw, manifest);
  const declaredType = manifest.type || null;
  if (declaredType && declaredType !== "plugin") {
    const mv = validateManifest(declaredType, found.raw);
    if (!mv.ok) {
      const error = `\u7C7B\u578B ${declaredType} \u6E05\u5355\u4E0D\u5408\u89C4\uFF1A${mv.violations.join("\uFF1B")}`;
      const r2 = failRegister(manifest.id, error);
      log6(`[skill] \u274C ${manifest.id}\uFF1A${error}`);
      return r2;
    }
    log6(`[skill] \u23ED ${manifest.id}\uFF1A\u7C7B\u578B ${declaredType} \u7684\u8FD0\u884C\u65F6\u5C1A\u672A\u63A5\u5165\uFF0C\u5DF2\u8DF3\u8FC7\u5165\u53E3\u52A0\u8F7D`);
    return { dir: dir2, loaded: false, id: manifest.id, staged: true, type: declaredType };
  }
  if (declaredType === "plugin") {
    const mv = validateManifest("plugin", found.raw);
    if (!mv.ok) {
      const error = `\u7C7B\u578B plugin \u6E05\u5355\u4E0D\u5408\u89C4\uFF1A${mv.violations.join("\uFF1B")}`;
      const r2 = failRegister(manifest.id, error);
      log6(`[skill] \u274C ${manifest.id}\uFF1A${error}`);
      return r2;
    }
  }
  const entryRel = String(found.raw.entry || "index.js");
  const entryPath = import_node_path9.default.resolve(dir2, entryRel);
  const relToDir = import_node_path9.default.relative(dir2, entryPath);
  if (!relToDir || relToDir.startsWith("..") || import_node_path9.default.isAbsolute(relToDir)) {
    const r2 = failRegister(manifest.id, `entry \u5FC5\u987B\u662F Skill \u76EE\u5F55\u5185\u7684\u76F8\u5BF9\u8DEF\u5F84\uFF1A${entryRel}`);
    log6(`[skill] \u274C ${manifest.id}\uFF1Aentry \u8D8A\u754C\u5DF2\u88AB\u62D2\u7EDD`);
    return r2;
  }
  try {
    const realDir = import_node_fs9.default.realpathSync(dir2);
    const realEntry = import_node_fs9.default.realpathSync(entryPath);
    const relReal = import_node_path9.default.relative(realDir, realEntry);
    if (relReal.startsWith("..") || import_node_path9.default.isAbsolute(relReal)) {
      const r2 = failRegister(manifest.id, `entry \u6307\u5411\u4E86 Skill \u76EE\u5F55\u5916\uFF08\u7B26\u53F7\u94FE\u63A5\uFF09\uFF1A${entryRel}`);
      log6(`[skill] \u274C ${manifest.id}\uFF1Aentry \u7ECF\u7B26\u53F7\u94FE\u63A5\u8D8A\u754C\u5DF2\u88AB\u62D2\u7EDD`);
      return r2;
    }
  } catch {
  }
  if (!import_node_fs9.default.existsSync(entryPath)) {
    const error = `\u5165\u53E3\u6587\u4EF6\u4E0D\u5B58\u5728\uFF1A${entryRel}`;
    if (hadPrevious) {
      skillManager.errors.set(manifest.id, `${error}\uFF08\u5DF2\u6CBF\u7528\u65E7\u7248\u672C\u7EE7\u7EED\u8FD0\u884C\uFF09`);
      return { dir: dir2, loaded: false, id: manifest.id, error: `${error}\uFF08\u4FDD\u7559\u65E7\u7248\u672C\uFF09` };
    }
    const r2 = failRegister(manifest.id, error);
    log6(`[skill] \u274C ${manifest.id}\uFF1A${error}`);
    return r2;
  }
  let mod;
  try {
    const entryUrl = (0, import_node_url2.pathToFileURL)(entryPath).href;
    mod = await __extensionHost.importModule(entryPath);
  } catch (error) {
    const msg = `\u52A0\u8F7D\u5931\u8D25\uFF1A${error.message}`;
    if (hadPrevious) {
      skillManager.errors.set(manifest.id, `${msg}\uFF08\u5DF2\u6CBF\u7528\u65E7\u7248\u672C\u7EE7\u7EED\u8FD0\u884C\uFF09`);
      return { dir: dir2, loaded: false, id: manifest.id, error: `${msg}\uFF08\u4FDD\u7559\u65E7\u7248\u672C\uFF09` };
    }
    const r2 = failRegister(manifest.id, msg);
    log6(`[skill] \u274C ${manifest.id}\uFF1A${msg}`);
    return r2;
  }
  if (declaredType) {
    if (String(manifest.scope) === "session" && mod.hooks && typeof mod.hooks === "object") {
      const bad = Object.keys(mod.hooks).filter((h) => !isHookAllowed("session", h));
      if (bad.length) {
        const error = `\u4F1A\u8BDD\u7EA7\u63D2\u4EF6\u4E0D\u5141\u8BB8\u8FD9\u4E9B hook\uFF1A${bad.join(", ")}`;
        const rr = failRegister(manifest.id, error);
        log6(`[skill] \u274C ${manifest.id}\uFF1A${error}`);
        return rr;
      }
    }
    const ev = validateExports(declaredType, mod);
    if (!ev.ok) {
      const error = `\u7C7B\u578B ${declaredType} \u5BFC\u51FA\u8D8A\u754C\uFF1A${ev.violations.join("\uFF1B")}`;
      if (hadPrevious) {
        skillManager.errors.set(manifest.id, `${error}\uFF08\u5DF2\u6CBF\u7528\u65E7\u7248\u672C\u7EE7\u7EED\u8FD0\u884C\uFF09`);
        return { dir: dir2, loaded: false, id: manifest.id, error: `${error}\uFF08\u4FDD\u7559\u65E7\u7248\u672C\uFF09` };
      }
      const r2 = failRegister(manifest.id, error);
      log6(`[skill] \u274C ${manifest.id}\uFF1A${error}`);
      return r2;
    }
  }
  const setupFn = typeof mod.setup === "function" ? mod.setup : typeof mod.register === "function" ? mod.register : null;
  if (!setupFn && !mod.hooks && !mod.providers && !mod.activate) {
    const error = "\u5165\u53E3\u9700\u5BFC\u51FA setup(api)/register(api) \u6216 hooks/providers";
    if (hadPrevious) {
      skillManager.errors.set(manifest.id, `${error}\uFF08\u5DF2\u6CBF\u7528\u65E7\u7248\u672C\u7EE7\u7EED\u8FD0\u884C\uFF09`);
      return { dir: dir2, loaded: false, id: manifest.id, error: `${error}\uFF08\u4FDD\u7559\u65E7\u7248\u672C\uFF09` };
    }
    const r2 = failRegister(manifest.id, error);
    log6(`[skill] \u274C ${manifest.id}\uFF1A${error}`);
    return r2;
  }
  const permissions = Array.isArray(found.raw.permissions) ? found.raw.permissions : [];
  const api6 = declaredType === "plugin" ? createExtensionApi("plugin", manifest.id, permissions, { scope: manifest.scope || "global", builtin: dir2.startsWith(__extensionHost.builtinRoot + import_node_path9.default.sep) }) : createSkillApi(manifest.id, permissions);
  const prevSkill = skillManager.registry.get(manifest.id);
  const prevWasLive = prevSkill && !prevSkill.loadError;
  if (prevWasLive) {
    try {
      if (typeof prevSkill.deactivate === "function") prevSkill.deactivate({ reason: "reload" });
    } catch (error) {
      log6(`[skill] \u26A0\uFE0F ${manifest.id} \u65E7\u5B9E\u4F8B deactivate \u5931\u8D25\uFF1A${error?.message ?? error}`);
    }
  }
  const toolIds = [];
  const collectingRegister = (def) => {
    const id = api6.registerTool(def);
    toolIds.push(id);
    return id;
  };
  const apiWithCollect = { ...api6, registerTool: collectingRegister };
  try {
    if (setupFn) await setupFn(apiWithCollect);
  } catch (error) {
    if (toolIds.length) unregisterToolsBySkill(manifest.id);
    const msg = `\u6CE8\u518C\u5931\u8D25\uFF1A${error.message}`;
    if (hadPrevious) {
      try {
        if (typeof prevSkill.activate === "function") prevSkill.activate({ reason: "reload-failed" });
      } catch (e2) {
        log6(`[skill] \u26A0\uFE0F ${manifest.id} \u65E7\u5B9E\u4F8B\u6FC0\u6D3B\u5931\u8D25\uFF1A${e2?.message ?? e2}`);
      }
      skillManager.errors.set(manifest.id, `${msg}\uFF08\u5DF2\u6CBF\u7528\u65E7\u7248\u672C\u7EE7\u7EED\u8FD0\u884C\uFF09`);
      log6(`[skill] \u274C ${manifest.id}\uFF1A${msg} \u2014\u2014 \u5DF2\u4FDD\u7559\u65E7\u7248\u672C\u7EE7\u7EED\u8FD0\u884C`);
      return { dir: dir2, loaded: false, id: manifest.id, error: `${msg}\uFF08\u4FDD\u7559\u65E7\u7248\u672C\uFF09` };
    }
    const r2 = failRegister(manifest.id, msg);
    log6(`[skill] \u274C ${manifest.id}\uFF1A${msg}`);
    return r2;
  }
  if (prevSkill) {
    skillManager.capabilities.removeOwner(manifest.id);
    skillManager.registry.unregister(manifest.id);
    skillManager.errors.delete(manifest.id);
  }
  const declaredTools = Array.isArray(found.raw.tools) ? found.raw.tools.map((t) => String(t?.id || t?.name || "")).filter(Boolean) : [];
  if (declaredTools.length) {
    const registeredShort = new Set(toolIds.map((id) => {
      const idx = id.indexOf("__");
      return idx >= 0 ? id.slice(idx + 2) : id.includes(":") ? id.split(":").pop() : id;
    }));
    const missingTools = declaredTools.filter((d) => !registeredShort.has(d));
    if (missingTools.length) {
      log6(`[skill] \u26A0\uFE0F ${manifest.id}\uFF1A\u6E05\u5355 tools[] \u58F0\u660E\u4E86 ${missingTools.join(", ")}\uFF0C\u4F46\u5165\u53E3\u6CA1\u6709 registerTool \u2014\u2014 \u6E05\u5355\u91CC\u7684 tools \u53EA\u662F\u5143\u6570\u636E\uFF0C\u4E0D\u4F1A\u88AB\u81EA\u52A8\u6CE8\u518C`);
    }
  }
  const skill = {
    manifest,
    source: found.source,
    dir: dir2,
    // 仓库相对目录 + 目录语义类型，供状态视图/UI/审计使用
    relDir: import_node_path9.default.relative(APP_ROOT2, dir2).replace(/\\/g, "/"),
    // 目录语义类型：'plugin'（确定性型）/ 'skill'（LLM 型）/ null（自定义根，不判定）
    kind,
    api: apiWithCollect,
    toolIds,
    // 生命周期与扩展点（可选）
    available: typeof mod.available === "function" ? mod.available : null,
    availableReason: "",
    activate: typeof mod.activate === "function" ? mod.activate : null,
    deactivate: typeof mod.deactivate === "function" ? mod.deactivate : null,
    dispose: typeof mod.dispose === "function" ? () => {
      try {
        mod.dispose();
      } finally {
        unregisterToolsBySkill(manifest.id);
      }
    } : () => {
      unregisterToolsBySkill(manifest.id);
    },
    hooks: mod.hooks && typeof mod.hooks === "object" ? mod.hooks : {},
    providers: mod.providers && typeof mod.providers === "object" ? mod.providers : {},
    promptSections: typeof mod.promptSections === "function" ? mod.promptSections : null
  };
  skill.loadError = null;
  const r = skillManager.register(skill);
  if (!r.ok) {
    if (toolIds.length) unregisterToolsBySkill(manifest.id);
    const r2 = failRegister(manifest.id, r.error);
    return r2;
  }
  lintKindPlacement(kind, skill, log6);
  log6(`[skill] \u2705 \u52A0\u8F7D\u6210\u529F\uFF1A${manifest.name}\uFF08${manifest.id} v${manifest.version}\uFF0Capi v${manifest.apiVersion || SKILL_API_VERSION}\uFF09`);
  return { dir: dir2, loaded: true, id: manifest.id, skill };
}
async function loadSkillRoot(rootDir, { log: log6 = console.log, label = "skill", scope = "" } = {}) {
  if (!import_node_fs9.default.existsSync(rootDir)) {
    log6(`[${label}] \u26A0\uFE0F \u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u5DF2\u8DF3\u8FC7\uFF1A${rootDir}`);
    return { loaded: [], failed: [], missing: true, rootDir };
  }
  const dirs = import_node_fs9.default.readdirSync(rootDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => import_node_path9.default.join(rootDir, e.name));
  if (!dirs.length) {
    log6(`[${label}] ${import_node_path9.default.basename(rootDir)}/ \u4E3A\u7A7A\uFF1A${rootDir}`);
    return { loaded: [], failed: [], empty: true, rootDir };
  }
  const results = [];
  const kind = kindOfDir(rootDir);
  for (const dir2 of dirs) {
    const one = await loadSkillDir(dir2, { log: log6, kind });
    if (scope && one?.skill?.manifest) one.skill.manifest.scope = scope;
    results.push(one);
  }
  const staged = results.filter((r) => r.staged);
  const loaded4 = results.filter((r) => r.loaded);
  const failed = results.filter((r) => !r.loaded && !r.staged);
  log6(`[${label}] ${import_node_path9.default.basename(rootDir)}/\uFF08${rootDir}\uFF09\uFF1A${loaded4.length} \u6210\u529F\uFF0C${failed.length} \u5931\u8D25${staged.length ? `\uFF0C${staged.length} \u5F85\u63A5\u5165\u8FD0\u884C\u65F6` : ""}`);
  return { loaded: loaded4, failed, staged, rootDir };
}
async function loadPlugins({ log: log6 = console.log, roots = null, runtime = null } = {}) {
  if (runtime) setSkillRuntime(runtime);
  const skillsRoot = roots?.skills ? import_node_path9.default.resolve(roots.skills) : SKILLS_DIR;
  const pluginsRoot = roots?.plugins ? import_node_path9.default.resolve(roots.plugins) : PLUGINS_DIR;
  const chatPluginsRoot = roots?.chatPlugins ? import_node_path9.default.resolve(roots.chatPlugins) : roots?.plugins ? import_node_path9.default.resolve(import_node_path9.default.dirname(import_node_path9.default.resolve(roots.plugins)), "chat-plugins") : CHAT_PLUGINS_DIR;
  skillManager.setLog(log6);
  const skillRes = await loadSkillRoot(skillsRoot, { log: log6, label: "skill" });
  const pluginRes = await loadSkillRoot(pluginsRoot, { log: log6, label: "plugin" });
  const chatRes = await loadSkillRoot(chatPluginsRoot, { log: log6, label: "chat-plugin", scope: "session" });
  const aliveIds = [
    ...skillRes.loaded.map((r) => r.id),
    ...skillRes.failed.map((r) => r.id),
    ...(skillRes.staged || []).map((r) => r.id),
    ...pluginRes.loaded.map((r) => r.id),
    ...pluginRes.failed.map((r) => r.id),
    ...chatRes.loaded.map((r) => r.id),
    ...chatRes.failed.map((r) => r.id),
    ...(pluginRes.staged || []).map((r) => r.id)
  ].filter(Boolean);
  const pruned = skillManager.pruneMissing([...aliveIds, ...__extensionHost.retainedIds()], {});
  if (pruned.length) log6(`[skill] \u5DF2\u5378\u8F7D\u78C1\u76D8\u4E0A\u4E0D\u5B58\u5728\u7684 Skill\uFF1A${pruned.join(", ")}`);
  const allLoaded = skillManager.registry.list();
  const depErrors = validateDependencies(allLoaded);
  for (const s of allLoaded) {
    const err = depErrors.get(String(s.manifest?.id || ""));
    if (err) {
      s.dependencyError = err.reason;
      log6(`[skill] \u26A0\uFE0F ${s.manifest.id} \u4F9D\u8D56\u672A\u5C31\u7EEA\uFF1A${err.reason}`);
    }
  }
  const typed = allLoaded.filter((s) => s?.manifest?.type && typeof s.activate === "function" && !__extensionHost.isManaged(s.manifest.id));
  const { order } = topoOrder(typed);
  for (const s of order) {
    const id = String(s.manifest.id);
    if (depErrors.has(id)) {
      log6(`[skill] \u23ED ${id} \u672A\u6FC0\u6D3B\uFF08\u4F9D\u8D56\u672A\u5C31\u7EEA\uFF09`);
      continue;
    }
    try {
      if (__extensionHost.shouldActivate(id)) await s.activate({ reason: "load" });
    } catch (error) {
      log6(`[skill] \u26A0\uFE0F ${id} activate \u5931\u8D25\uFF08\u5DF2\u52A0\u8F7D\u4F46\u672A\u751F\u6548\uFF09\uFF1A${error?.message ?? error}`);
    }
  }
  const declaredToolIds = /* @__PURE__ */ new Set();
  for (const s of skillManager.registry.list()) {
    for (const tid of s.toolIds || []) declaredToolIds.add(tid);
  }
  const orphanTools = listTools().filter((t) => t.skillId && !declaredToolIds.has(t.id) && !extensionRegistry.get(t.skillId));
  for (const t of orphanTools) unregisterTool(t.id);
  if (orphanTools.length) {
    log6(`[skill] \u5DF2\u6E05\u7406\u65E7\u7248\u672C\u9057\u7559\u7684\u5DE5\u5177\uFF1A${orphanTools.map((t) => t.id).join(", ")}`);
  }
  return {
    loaded: [...skillRes.loaded, ...pluginRes.loaded, ...chatRes.loaded],
    failed: [...skillRes.failed, ...pluginRes.failed, ...chatRes.failed],
    pruned,
    dirs: { skills: skillsRoot, plugins: pluginsRoot, chatPlugins: chatPluginsRoot }
  };
}
function watchPlugins({ log: log6 = console.log, onReload, roots: rootsOpt = null } = {}) {
  const skillsRoot = rootsOpt?.skills ? import_node_path9.default.resolve(rootsOpt.skills) : SKILLS_DIR;
  const pluginsRoot = rootsOpt?.plugins ? import_node_path9.default.resolve(rootsOpt.plugins) : PLUGINS_DIR;
  const chatRoot = rootsOpt?.chatPlugins ? import_node_path9.default.resolve(rootsOpt.chatPlugins) : rootsOpt?.plugins ? import_node_path9.default.resolve(import_node_path9.default.dirname(import_node_path9.default.resolve(rootsOpt.plugins)), "chat-plugins") : CHAT_PLUGINS_DIR;
  const roots = [skillsRoot, pluginsRoot, chatRoot].filter((d) => import_node_fs9.default.existsSync(d));
  if (!roots.length) return null;
  let reloadTimer = null;
  let reloading = false;
  let pendingAgain = false;
  const watchers = [];
  const runReload = async (filename) => {
    if (reloading) {
      pendingAgain = true;
      return;
    }
    reloading = true;
    try {
      log6(`[skill] \u68C0\u6D4B\u5230\u53D8\u5316\uFF1A${filename || ""}\uFF0C\u91CD\u65B0\u626B\u63CF\u2026`);
      const result = await loadPlugins({ log: log6, roots: { skills: skillsRoot, plugins: pluginsRoot } });
      if (typeof onReload === "function") onReload(result);
    } catch (error) {
      log6(`[skill] \u70ED\u91CD\u8F7D\u5931\u8D25\uFF1A${error?.message ?? error}`);
    } finally {
      reloading = false;
      if (pendingAgain) {
        pendingAgain = false;
        scheduleReload("(\u8865\u4E00\u8F6E)");
      }
    }
  };
  const scheduleReload = (filename) => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      runReload(filename).catch(() => {
      });
    }, 500);
  };
  for (const root of roots) {
    try {
      watchers.push(import_node_fs9.default.watch(root, { recursive: true }, (_e, filename) => scheduleReload(filename)));
    } catch (error) {
      log6(`[skill] \u65E0\u6CD5\u76D1\u542C ${root}\uFF1A${error?.message ?? error}`);
    }
  }
  log6(`[skill] \u70ED\u91CD\u8F7D\u5DF2\u542F\u7528\uFF08\u76D1\u542C ${roots.map((r) => import_node_path9.default.basename(r)).join(" + ")}\uFF09`);
  return { close: () => {
    for (const w of watchers) {
      try {
        w.close();
      } catch {
      }
    }
  } };
}
function unloadSkill(id, context = {}) {
  return skillManager.unregister(id, context);
}

// packages/extension-compat/vendor/plugins/ext-tool/index.js
var ext_tool_exports = {};
__export(ext_tool_exports, {
  activate: () => activate,
  available: () => available,
  deactivate: () => deactivate,
  dispose: () => dispose,
  setup: () => setup,
  status: () => status
});
var import_node_fs10 = __toESM(require("node:fs"), 1);
var import_node_path10 = __toESM(require("node:path"), 1);
var import_node_url3 = require("node:url");
var HERE = import_node_path10.default.dirname((0, import_node_url3.fileURLToPath)(__extensionHost.url("plugins/ext-tool/index.js")));
var APP_ROOT3 = import_node_path10.default.resolve(HERE, "..", "..");
var DOC_EXT4 = /* @__PURE__ */ new Set([".md", ".txt"]);
var api = null;
var log = () => {
};
var cfg = () => ({});
var loaded = [];
function readManifest2(dir2) {
  const file = import_node_path10.default.join(dir2, "tool.json");
  if (!import_node_fs10.default.existsSync(file)) return { error: "\u7F3A\u5C11 tool.json" };
  try {
    let text = import_node_fs10.default.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 65279) text = text.slice(1);
    return { raw: JSON.parse(text) };
  } catch (error) {
    return { error: `tool.json \u89E3\u6790\u5931\u8D25\uFF1A${error?.message ?? error}` };
  }
}
function indexDocs(pkgDir, pkgId) {
  const dir2 = import_node_path10.default.join(pkgDir, "docs");
  if (!import_node_fs10.default.existsSync(dir2)) return [];
  const ids = [];
  for (const ent of import_node_fs10.default.readdirSync(dir2, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (!DOC_EXT4.has(import_node_path10.default.extname(ent.name).toLowerCase())) continue;
    const abs = import_node_path10.default.join(dir2, ent.name);
    let content = "";
    try {
      content = import_node_fs10.default.readFileSync(abs, "utf8").replace(/^\uFEFF/, "");
    } catch {
      continue;
    }
    const base = import_node_path10.default.basename(ent.name, import_node_path10.default.extname(ent.name));
    const docId = `${pkgId}.${base}`;
    const r = api.docRegistry?.register?.({
      id: docId,
      title: `${pkgId} \xB7 ${base}`,
      layer: "tool",
      ownerId: pkgId,
      path: `docs/${ent.name}`,
      content
    });
    if (r && r.ok === false && !String(r.error || "").includes("\u5DF2\u5B58\u5728")) log(`${docId}\uFF1A${r.error}`);
    else ids.push(docId);
  }
  return ids;
}
function childApi(pkgId, descriptor, permissions = []) {
  const hasWeb = Array.isArray(permissions) && permissions.includes("web_fetch");
  return {
    log: (...a) => log(`[${pkgId}]`, ...a),
    warn: (...a) => log(`[${pkgId}] \u26A0`, ...a),
    error: (...a) => log(`[${pkgId}] \u2717`, ...a),
    config: () => renderConfigDeep(__extensionHost.childSettings(pkgId, descriptor.settings || {}), { ownerId: pkgId }),
    registerTool: (def) => api.registerToolAs(pkgId, def),
    fetch: hasWeb ? (url, opts) => safeFetch(url, opts) : () => Promise.reject(new Error("\u6269\u5C55 " + pkgId + " \u672A\u58F0\u660E web_fetch \u6743\u9650")),
    unregisterTools: () => api.unregisterToolsByOwner(pkgId)
  };
}
async function scanAndRegister() {
  const dirName = String(cfg().docsDir || "tools");
  const root = import_node_path10.default.isAbsolute(dirName) ? dirName : import_node_path10.default.join(APP_ROOT3, dirName);
  if (!import_node_fs10.default.existsSync(root)) {
    log(`\u5DE5\u5177\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7\uFF1A${root}`);
    return { loaded: 0, failed: 0 };
  }
  const max = Math.max(1, Number(cfg().maxPackages) || 50);
  let okCount = 0;
  let failCount = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const ent of import_node_fs10.default.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    if (okCount >= max) {
      log(`\u5DF2\u8FBE\u4E0A\u9650 ${max}`);
      break;
    }
    const dir2 = import_node_path10.default.join(root, ent.name);
    const { raw, error } = readManifest2(dir2);
    if (error) {
      failCount++;
      log(`${ent.name}\uFF1A${error}`);
      continue;
    }
    const pkgId = String(raw.id || ent.name);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pkgId)) {
      failCount++;
      log(`id \u975E\u6CD5\uFF1A${pkgId}`);
      continue;
    }
    if (seen.has(pkgId)) {
      failCount++;
      log(`\u91CD\u590D id\uFF1A${pkgId}`);
      continue;
    }
    seen.add(pkgId);
    const manifest = { ...raw, type: raw.type || "tool" };
    if (manifest.type !== "tool") {
      failCount++;
      log(`${pkgId}\uFF1Atool.json \u7684 type \u5FC5\u987B\u662F tool\uFF08\u5F53\u524D ${manifest.type}\uFF09`);
      continue;
    }
    const mv = validateManifest("tool", manifest);
    if (!mv.ok) {
      failCount++;
      log(`${pkgId} \u6E05\u5355\u4E0D\u5408\u89C4\uFF1A${mv.violations.join("\uFF1B")}`);
      continue;
    }
    const entryRel = String(raw.entry || "index.js");
    const entryAbs = import_node_path10.default.resolve(dir2, entryRel);
    const rel = import_node_path10.default.relative(dir2, entryAbs);
    if (!rel || rel.startsWith("..") || import_node_path10.default.isAbsolute(rel)) {
      failCount++;
      log(`${pkgId}\uFF1Aentry \u8D8A\u754C`);
      continue;
    }
    if (!import_node_fs10.default.existsSync(entryAbs)) {
      failCount++;
      log(`${pkgId}\uFF1A\u5165\u53E3\u4E0D\u5B58\u5728\uFF08${entryRel}\uFF09`);
      continue;
    }
    let mod;
    try {
      mod = await __extensionHost.importModule(entryAbs);
    } catch (err) {
      failCount++;
      log(`${pkgId}\uFF1A\u52A0\u8F7D\u5931\u8D25\uFF08${err?.message ?? err}\uFF09`);
      continue;
    }
    const ev = validateExports("tool", mod);
    if (!ev.ok) {
      failCount++;
      log(`${pkgId} \u5BFC\u51FA\u8D8A\u754C\uFF1A${ev.violations.join("\uFF1B")}`);
      continue;
    }
    const descriptor = {
      type: "tool",
      id: pkgId,
      description: String(raw.description || ""),
      name: String(raw.name || pkgId),
      version: String(raw.version || "1.0.0"),
      status: "active",
      settingsSchema: raw.configSchema || {},
      settings: raw.settings || {},
      details: { entry: entryRel, dir: dir2 }
    };
    const reg = api.registerSubExtension(descriptor);
    if (reg && reg.ok === false) {
      failCount++;
      log(`${pkgId} \u767B\u8BB0\u5931\u8D25\uFF1A${reg.error}`);
      continue;
    }
    const before = api.listSubExtensions?.("tool")?.length || 0;
    try {
      const setupFn = typeof mod.setup === "function" ? mod.setup : typeof mod.register === "function" ? mod.register : null;
      if (setupFn) await setupFn(childApi(pkgId, descriptor, Array.isArray(raw.permissions) ? raw.permissions : []));
    } catch (err) {
      failCount++;
      api.unregisterSubExtension(pkgId);
      api.unregisterToolsByOwner?.(pkgId);
      log(`${pkgId}\uFF1Asetup \u5931\u8D25\uFF08${err?.message ?? err}\uFF09`);
      continue;
    }
    const docIds = indexDocs(dir2, pkgId);
    loaded.push({ id: pkgId, dir: dir2, docIds, tools: [] });
    okCount++;
    void before;
  }
  if (okCount) api.notifyToolsChanged?.();
  log(`\u5DE5\u5177\u5305\uFF1A\u626B\u63CF ${root}\uFF0C\u52A0\u8F7D ${okCount} \u4E2A\uFF0C\u5931\u8D25 ${failCount} \u4E2A`);
  return { loaded: okCount, failed: failCount };
}
function clearAll() {
  for (const item of loaded) {
    try {
      api.unregisterToolsByOwner?.(item.id);
    } catch {
    }
    try {
      api.docRegistry?.unregisterByOwner?.(item.id);
    } catch {
    }
    try {
      api.unregisterSubExtension(item.id);
    } catch {
    }
  }
  loaded = [];
}
function setup(hostApi) {
  api = hostApi;
  log = hostApi.log || (() => {
  });
  cfg = hostApi.config;
}
async function activate() {
  api.registerExtensionTab?.({
    id: "tool",
    label: "\u5DE5\u5177",
    icon: "\u{1F527}",
    order: 20,
    surface: "both",
    mode: "template",
    dataUrl: "/api/extensions?type=tool",
    hint: "\u6CE8\u518C\u5DE5\u5177\uFF0C\u7531\u6A21\u578B\u51B3\u5B9A\u4F55\u65F6\u8C03\u7528"
  });
  if (cfg().enabled === false) {
    log("\u5DE5\u5177\u7BA1\u7406\u5668\u5DF2\u5173\u95ED");
    return;
  }
  try {
    clearAll();
    await scanAndRegister();
  } catch (error) {
    log(`\u626B\u63CF\u5DE5\u5177\u5305\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function deactivate() {
  try {
    api.unregisterExtensionTab?.();
  } catch {
  }
  try {
    clearAll();
    api?.notifyToolsChanged?.();
  } catch (error) {
    log(`\u505C\u7528\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function dispose() {
  deactivate();
}
function available() {
  return true;
}
function status() {
  return { packages: loaded.map((l) => l.id), docs: loaded.reduce((n, l) => n + l.docIds.length, 0) };
}

// packages/extension-compat/vendor/plugins/ext-mcp/index.js
var ext_mcp_exports = {};
__export(ext_mcp_exports, {
  activate: () => activate2,
  available: () => available2,
  deactivate: () => deactivate2,
  dispose: () => dispose2,
  internals: () => internals,
  isToolAllowed: () => isToolAllowed,
  mapToolResult: () => mapToolResult,
  sanitizeToolId: () => sanitizeToolId,
  setup: () => setup2
});
var import_node_fs11 = __toESM(require("node:fs"), 1);
var import_node_path11 = __toESM(require("node:path"), 1);
var import_node_crypto3 = __toESM(require("node:crypto"), 1);
var import_node_url4 = require("node:url");

// packages/extension-compat/vendor/src/mcp/client.js
var import_node_child_process = require("node:child_process");
var PROTOCOL_VERSION = "2024-11-05";
var CLIENT_INFO = { name: "qq-agent-mcp-bridge", version: "1.0.0" };
var WIN = process.platform === "win32";
function resolveCommand(command) {
  if (!WIN || !command) return command;
  if (/[\\/]/.test(command) || /\.(exe|cmd|bat|com)$/i.test(command)) return command;
  const launchers = /* @__PURE__ */ new Set(["npx", "npm", "pnpm", "yarn", "bunx", "uvx", "uv", "deno"]);
  return launchers.has(command.toLowerCase()) ? `${command}.cmd` : command;
}
function killTree(child) {
  if (!child || child.exitCode != null) return;
  try {
    if (WIN) {
      (0, import_node_child_process.execFileSync)("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    try {
      child.kill();
    } catch {
    }
  }
}
var JsonRpcConnection = class {
  constructor({ timeoutMs = 3e4, onLog = () => {
  } } = {}) {
    this.timeoutMs = timeoutMs;
    this.onLog = onLog;
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.serverInfo = null;
    this.protocolVersion = PROTOCOL_VERSION;
    this.capabilities = {};
  }
  _onMessage(parsed) {
    if (parsed?.id != null && (parsed.result !== void 0 || parsed.error !== void 0)) {
      const entry = this.pending.get(parsed.id);
      if (!entry) return;
      this.pending.delete(parsed.id);
      clearTimeout(entry.timer);
      if (parsed.error) {
        entry.reject(new Error(parsed.error.message || `MCP \u9519\u8BEF ${parsed.error.code}`));
      } else {
        entry.resolve(parsed.result);
      }
      return;
    }
    if (parsed?.method) {
      if (parsed.method === "ping" && parsed.id != null) {
        this._send({ jsonrpc: "2.0", id: parsed.id, result: {} });
        return;
      }
      if (parsed.id != null) {
        this._send({
          jsonrpc: "2.0",
          id: parsed.id,
          error: { code: -32601, message: `\u5BA2\u6237\u7AEF\u4E0D\u652F\u6301 ${parsed.method}` }
        });
      }
    }
  }
  _onParseError(raw) {
    this.onLog(`\u5FFD\u7565\u975E\u534F\u8BAE\u8F93\u51FA\uFF1A${String(raw).slice(0, 120)}`);
  }
  _send(message) {
    throw new Error("\u672A\u5B9E\u73B0 _send");
  }
  request(method, params = {}, timeoutMs = this.timeoutMs) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} \u8D85\u65F6\uFF08${Math.round(timeoutMs / 1e3)} \u79D2\uFF09`));
      }, Math.max(1e3, timeoutMs));
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  notify(method, params = {}) {
    this._send({ jsonrpc: "2.0", method, params });
  }
  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO
    }, Math.max(this.timeoutMs, 2e4));
    this.serverInfo = result?.serverInfo || null;
    this.capabilities = result?.capabilities || {};
    if (result?.protocolVersion) this.protocolVersion = result.protocolVersion;
    this.notify("notifications/initialized", {});
    return result;
  }
  async listTools() {
    const tools = [];
    let cursor;
    for (let page = 0; page < 20; page += 1) {
      const result = await this.request("tools/list", cursor ? { cursor } : {});
      if (Array.isArray(result?.tools)) tools.push(...result.tools);
      if (!result?.nextCursor) break;
      cursor = result.nextCursor;
    }
    return tools;
  }
  async callTool(name, args = {}, timeoutMs) {
    return this.request("tools/call", { name, arguments: args || {} }, timeoutMs);
  }
  async close() {
  }
};
var StdioConnection = class extends JsonRpcConnection {
  constructor(options) {
    super(options);
    const { command, args = [], env = {}, cwd } = options;
    const resolved = resolveCommand(command);
    const needsCmd = WIN && /\.(cmd|bat)$/i.test(String(resolved));
    let spawnCommand = resolved;
    let spawnArgs = args;
    if (needsCmd) {
      const quote = (value) => {
        const text = String(value);
        return /[\s"&|<>^]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      spawnCommand = process.env.ComSpec || "cmd.exe";
      spawnArgs = ["/d", "/s", "/c", `"${[quote(resolved), ...args.map(quote)].join(" ")}"`];
    }
    try {
      this.child = (0, import_node_child_process.spawn)(spawnCommand, spawnArgs, {
        cwd: cwd || __extensionHost.root,
        windowsHide: true,
        // 走 cmd 时必须原样传命令行，否则 Node 会把整串再包一层引号，
        // cmd 会把带引号的整串当成命令名（报"不是内部或外部命令"）。
        windowsVerbatimArguments: needsCmd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env }
      });
    } catch (error) {
      throw new Error(
        `\u542F\u52A8 ${spawnCommand} \u5931\u8D25\uFF1A${error?.message ?? error}\uFF08path=${error?.path || "-"}\uFF0Csyscall=${error?.syscall || "-"}\uFF09`
      );
    }
    this.exitInfo = null;
    this.buffer = "";
    this.child.stdin.on("error", (e) => {
      this.stdinError = String(e?.message ?? e);
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this._read(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      const line = String(chunk).trim();
      if (line) this.onLog(line.slice(0, 400));
    });
    this.child.on("error", (error) => {
      this.exitInfo = `\u542F\u52A8\u5931\u8D25\uFF1A${error?.message ?? error}`;
      this._failAll(new Error(this.exitInfo));
    });
    this.child.on("exit", (code, signal) => {
      this.exitInfo = `\u8FDB\u7A0B\u9000\u51FA\uFF08code=${code}${signal ? `\uFF0Csignal=${signal}` : ""}\uFF09`;
      this._failAll(new Error(this.exitInfo));
    });
  }
  _read(chunk) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) {
        try {
          this._onMessage(JSON.parse(line));
        } catch {
          this._onParseError(line);
        }
      }
      index = this.buffer.indexOf("\n");
    }
    if (this.buffer.length > 8 * 1024 * 1024) this.buffer = "";
  }
  _send(message) {
    if (!this.child?.stdin?.writable) throw new Error("MCP \u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF0C\u65E0\u6CD5\u53D1\u9001");
    this.child.stdin.write(`${JSON.stringify(message)}
`);
  }
  _failAll(error) {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }
  async close() {
    killTree(this.child);
  }
};
var HttpConnection = class extends JsonRpcConnection {
  constructor(options) {
    super(options);
    this.url = String(options.url || "").trim();
    this.headers = { ...options.headers || {} };
    this.sessionId = "";
    this.buffer = "";
  }
  _send(message) {
    this._post(message).catch((error) => this.onLog(`\u53D1\u9001\u5931\u8D25\uFF1A${error?.message ?? error}`));
  }
  async _post(message) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.protocolVersion) headers["mcp-protocol-version"] = this.protocolVersion;
    const response = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const sid = response.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    if (message.id == null) return null;
    if (!response.ok && response.status !== 202) {
      throw new Error(`HTTP ${response.status}`);
    }
    const type = response.headers.get("content-type") || "";
    if (type.includes("text/event-stream")) {
      return this._readStream(response, message.id);
    }
    const text = await response.text();
    if (!text.trim()) return null;
    try {
      const parsed = JSON.parse(text);
      this._onMessage(parsed);
      return parsed;
    } catch {
      this._onParseError(text);
      return null;
    }
  }
  /** 从 SSE 里挑出 id 匹配的那条响应。 */
  async _readStream(response, id) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = buffer.indexOf("\n\n");
      while (split >= 0) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data);
            this._onMessage(parsed);
            if (parsed?.id === id) return parsed;
          } catch {
            this._onParseError(data);
          }
        }
        split = buffer.indexOf("\n\n");
      }
    }
    return null;
  }
  async close() {
    if (!this.sessionId) return;
    try {
      await fetch(this.url, {
        method: "DELETE",
        headers: { "mcp-session-id": this.sessionId, ...this.headers },
        signal: AbortSignal.timeout(3e3)
      });
    } catch {
    }
  }
};
var McpServerConnection = class {
  /**
   * @param {object} server { name, type:'stdio'|'http', command, args, env, cwd, url, headers, timeoutMs }
   */
  constructor(server, { onLog = () => {
  } } = {}) {
    this.server = server;
    this.name = server.name;
    this.onLog = onLog;
    this.tools = [];
    this.status = "idle";
    this.error = "";
    this.connectedAt = 0;
    this.conn = null;
  }
  async connect() {
    if (this.conn) {
      const old = this.conn;
      this.conn = null;
      await old.close().catch(() => {
      });
    }
    this.status = "connecting";
    const options = { timeoutMs: this.server.timeoutMs || 3e4, onLog: this.onLog };
    try {
      const conn = this.server.type === "http" ? new HttpConnection({ ...options, url: this.server.url, headers: this.server.headers }) : new StdioConnection({
        ...options,
        command: this.server.command,
        args: this.server.args,
        env: this.server.env,
        cwd: this.server.cwd
      });
      this.conn = conn;
      await conn.initialize();
      const tools = await conn.listTools();
      if (this.conn !== conn) throw new Error("\u8FDE\u63A5\u5DF2\u88AB\u5173\u95ED");
      this.tools = tools;
      this.status = "ready";
      this.error = "";
      this.connectedAt = Date.now();
      return true;
    } catch (error) {
      this.status = "error";
      this.error = error?.message ?? String(error);
      await this.close();
      return false;
    }
  }
  async callTool(name, args, timeoutMs) {
    if (this.status !== "ready" || !this.conn) {
      throw new Error(`MCP \u670D\u52A1 ${this.name} \u672A\u8FDE\u63A5\uFF08${this.error || this.status}\uFF09`);
    }
    return this.conn.callTool(name, args, timeoutMs);
  }
  async close() {
    const conn = this.conn;
    this.conn = null;
    if (conn) await conn.close().catch(() => {
    });
    if (this.status !== "error") this.status = "closed";
  }
  describe() {
    return {
      name: this.name,
      type: this.server.type,
      status: this.status,
      error: this.error,
      tools: this.tools.map((tool) => ({
        name: tool.name,
        description: String(tool.description || "").replace(/\s+/g, " ").slice(0, 200),
        inputSchema: tool.inputSchema || null
      }))
    };
  }
};

// packages/extension-compat/vendor/plugins/ext-mcp/index.js
var HERE2 = import_node_path11.default.dirname((0, import_node_url4.fileURLToPath)(__extensionHost.url("plugins/ext-mcp/index.js")));
var APP_ROOT4 = import_node_path11.default.resolve(HERE2, "..", "..");
var SHELL_NAME_RE = /shell|bash|pwsh|powershell|exec|spawn|cmd|terminal|process_start/i;
var api2 = null;
var log2 = () => {
};
var cfg2 = () => ({});
var connections = /* @__PURE__ */ new Map();
function sanitizeToolId(name) {
  const raw = String(name || "").trim();
  let s = raw.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = "tool";
  if (s.length <= 38) return s;
  const hash = import_node_crypto3.default.createHash("sha1").update(raw).digest("hex").slice(0, 6);
  return `${s.slice(0, 30)}_${hash}`;
}
function isToolAllowed(toolName, policy = {}, { blockShellTools = true } = {}) {
  const name = String(toolName || "");
  if (blockShellTools && SHELL_NAME_RE.test(name)) return { ok: false, reason: "shell \u7C7B\u5DE5\u5177\u540D\u5DF2\u62E6\u622A" };
  const mode = String(policy.mode || "deny");
  const names = Array.isArray(policy.names) ? policy.names.map(String) : [];
  if (mode === "allow") {
    return names.includes(name) ? { ok: true } : { ok: false, reason: "\u4E0D\u5728 allow \u540D\u5355\u5185" };
  }
  return names.includes(name) ? { ok: false, reason: "\u5728 deny \u540D\u5355\u5185" } : { ok: true };
}
function mapToolResult(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const texts = [];
  const media = [];
  for (const item of parts) {
    const type = String(item?.type || "");
    if (type === "text" && item.text) {
      texts.push(String(item.text));
    } else if (type === "image" && item.data) {
      const mime = String(item.mimeType || "image/png");
      media.push({ type: "image_url", image_url: { url: `data:${mime};base64,${item.data}` } });
      texts.push("[\u56FE\u7247]");
    } else if (type === "audio" && item.data) {
      texts.push("[\u97F3\u9891\u5185\u5BB9\u5DF2\u7701\u7565]");
    } else if (type === "resource" && item.resource) {
      texts.push(`[\u8D44\u6E90 ${item.resource.uri || ""}]${item.resource.text ? `
${String(item.resource.text).slice(0, 4e3)}` : ""}`);
    } else if (type === "resource_link") {
      texts.push(`[\u8D44\u6E90\u94FE\u63A5 ${item.uri || ""}${item.name ? `\uFF08${item.name}\uFF09` : ""}]`);
    }
  }
  const text = texts.join("\n").trim() || "\uFF08\u8BE5\u5DE5\u5177\u6CA1\u6709\u8FD4\u56DE\u6587\u672C\u5185\u5BB9\uFF09";
  const isError = result?.isError === true;
  return media.length ? { content: [{ type: "text", text }, ...media], isError } : { content: text, isError };
}
function readServerConfig(dir2) {
  const file = import_node_path11.default.join(dir2, "mcp.json");
  if (!import_node_fs11.default.existsSync(file)) return { error: "\u7F3A\u5C11 mcp.json" };
  try {
    let text = import_node_fs11.default.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 65279) text = text.slice(1);
    const raw = JSON.parse(text);
    const transport = (raw.transport || raw.type) === "http" || raw.url ? "http" : "stdio";
    if (transport === "stdio" && !raw.command) return { error: "stdio \u4F20\u8F93\u7F3A\u5C11 command" };
    if (transport === "http" && !raw.url) return { error: "http \u4F20\u8F93\u7F3A\u5C11 url" };
    return {
      raw: {
        ...raw,
        transport,
        name: String(raw.name || raw.id || import_node_path11.default.basename(dir2)),
        timeoutMs: Number(raw.timeoutMs) || 3e4
      }
    };
  } catch (error) {
    return { error: `mcp.json \u89E3\u6790\u5931\u8D25\uFF1A${error?.message ?? error}` };
  }
}
async function connectServer(serverId, serverCfg) {
  const conn = new McpServerConnection({
    name: serverId,
    // McpServerConnection 用 type 区分传输（stdio / http）
    type: serverCfg.transport === "http" ? "http" : "stdio",
    command: serverCfg.command,
    args: serverCfg.args,
    env: serverCfg.env,
    url: serverCfg.url,
    headers: serverCfg.headers,
    timeoutMs: serverCfg.timeoutMs
  }, { onLog: (line) => log2(`[${serverId}] ${line}`) });
  const state = { conn, tools: [], registered: [] };
  connections.set(serverId, state);
  const ok = await conn.connect();
  if (!ok) {
    log2(`${serverId} \u8FDE\u63A5\u5931\u8D25\uFF1A${conn.error || "\u672A\u77E5\u539F\u56E0"}`);
    return { ok: false, error: conn.error || "\u8FDE\u63A5\u5931\u8D25" };
  }
  const tools = Array.isArray(conn.tools) ? conn.tools : [];
  const maxTools = Math.max(1, Number(cfg2().maxToolsPerServer) || 60);
  const policy = serverCfg.toolPolicy || {};
  let registeredCount = 0;
  for (const tool of tools.slice(0, maxTools)) {
    const original = String(tool?.name || "");
    if (!original) continue;
    const verdict = isToolAllowed(original, policy, { blockShellTools: cfg2().blockShellTools !== false });
    if (!verdict.ok) {
      log2(`${serverId}/${original} \u672A\u6CE8\u518C\uFF1A${verdict.reason}`);
      continue;
    }
    const toolId = sanitizeToolId(original);
    const params = tool?.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} };
    try {
      const fullId = api2.registerToolAs(serverId, {
        id: toolId,
        name: `[MCP] ${String(tool?.title || original).slice(0, 40)}`,
        description: String(tool?.description || `MCP \u5DE5\u5177 ${original}`).slice(0, 900),
        category: "query",
        icon: "\u{1F9E9}",
        parameters: params,
        async execute(_ctx, args) {
          const timeout = Math.max(1e3, Number(cfg2().callTimeoutMs) || 3e4);
          const result = await conn.callTool(original, args || {}, timeout);
          return mapToolResult(result);
        }
      });
      state.registered.push({ id: fullId, original, toolId });
      registeredCount++;
    } catch (error) {
      log2(`${serverId}/${original} \u6CE8\u518C\u5931\u8D25\uFF1A${error?.message ?? error}`);
    }
  }
  state.tools = tools;
  log2(`${serverId} \u5DF2\u8FDE\u63A5\uFF1A${tools.length} \u4E2A\u5DE5\u5177\uFF0C\u6CE8\u518C ${registeredCount} \u4E2A`);
  return { ok: true, registered: registeredCount, total: tools.length };
}
function disconnectServer(serverId) {
  const state = connections.get(serverId);
  if (!state) return;
  try {
    api2.unregisterToolsByOwner(serverId);
  } catch {
  }
  try {
    state.conn.close?.();
  } catch {
  }
  connections.delete(serverId);
}
async function scanAndConnect() {
  const dirName = String(cfg2().docsDir || "mcp");
  const root = import_node_path11.default.isAbsolute(dirName) ? dirName : import_node_path11.default.join(APP_ROOT4, dirName);
  if (!import_node_fs11.default.existsSync(root)) {
    log2(`MCP \u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7\uFF1A${root}`);
    return { connected: 0, failed: 0 };
  }
  let connected = 0;
  let failed = 0;
  for (const ent of import_node_fs11.default.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const dir2 = import_node_path11.default.join(root, ent.name);
    const { raw, error } = readServerConfig(dir2);
    if (error) {
      failed++;
      log2(`${ent.name}\uFF1A${error}`);
      continue;
    }
    const serverId = String(raw.id || ent.name);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(serverId)) {
      failed++;
      log2(`${ent.name}\uFF1Aid \u975E\u6CD5`);
      continue;
    }
    const reg = api2.registerSubExtension({
      type: "mcp",
      id: serverId,
      name: raw.name,
      description: String(raw.description || ""),
      version: String(raw.version || "1.0.0"),
      status: "active",
      details: { transport: raw.transport, toolPolicy: raw.toolPolicy || null, dir: dir2 }
    });
    if (reg && reg.ok === false) {
      failed++;
      log2(`${serverId} \u767B\u8BB0\u5931\u8D25\uFF1A${reg.error}`);
      continue;
    }
    try {
      const r = await connectServer(serverId, raw);
      if (r.ok) connected++;
      else {
        failed++;
        api2.unregisterSubExtension(serverId);
      }
    } catch (error2) {
      failed++;
      log2(`${serverId} \u8FDE\u63A5\u5F02\u5E38\uFF1A${error2?.message ?? error2}`);
      api2.unregisterSubExtension(serverId);
    }
  }
  if (connected) api2.notifyToolsChanged?.();
  log2(`MCP\uFF1A\u626B\u63CF ${root}\uFF0C\u8FDE\u63A5 ${connected} \u4E2A\uFF0C\u5931\u8D25 ${failed} \u4E2A`);
  return { connected, failed };
}
function clearAll2() {
  for (const id of [...connections.keys()]) disconnectServer(id);
  try {
    for (const d of api2.listSubExtensions("mcp") || []) api2.unregisterToolsByOwner(d.id);
  } catch {
  }
}
function setup2(hostApi) {
  api2 = hostApi;
  log2 = hostApi.log || (() => {
  });
  cfg2 = hostApi.config;
}
async function activate2() {
  api2.registerExtensionTab?.({
    id: "mcp",
    label: "MCP",
    icon: "\u{1F9E9}",
    order: 30,
    surface: "both",
    mode: "template",
    dataUrl: "/api/extensions?type=mcp",
    hint: "\u5916\u90E8 MCP \u670D\u52A1\uFF0C\u5DE5\u5177\u4EE5\u539F\u751F function \u66B4\u9732"
  });
  if (cfg2().enabled === false) {
    log2("MCP \u7BA1\u7406\u5668\u5DF2\u5173\u95ED");
    return;
  }
  if (cfg2().autoStart === false) {
    log2("MCP \u81EA\u52A8\u8FDE\u63A5\u5DF2\u5173\u95ED\uFF0C\u7B49\u9996\u6B21\u8C03\u7528\u65F6\u518D\u8FDE");
    return;
  }
  try {
    clearAll2();
    await scanAndConnect();
  } catch (error) {
    log2(`\u626B\u63CF MCP \u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function deactivate2() {
  try {
    api2.unregisterExtensionTab?.();
  } catch {
  }
  try {
    clearAll2();
    api2?.notifyToolsChanged?.();
  } catch (error) {
    log2(`\u505C\u7528 MCP \u7BA1\u7406\u5668\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function dispose2() {
  deactivate2();
}
function available2() {
  return true;
}
var internals = { sanitizeToolId, isToolAllowed, mapToolResult, connections };

// packages/extension-compat/vendor/plugins/ext-skill/index.js
var ext_skill_exports = {};
__export(ext_skill_exports, {
  activate: () => activate3,
  available: () => available3,
  deactivate: () => deactivate3,
  dispose: () => dispose3,
  setup: () => setup3,
  status: () => status2
});
var import_node_fs12 = __toESM(require("node:fs"), 1);
var import_node_path12 = __toESM(require("node:path"), 1);
var import_node_url5 = require("node:url");
var HERE3 = import_node_path12.default.dirname((0, import_node_url5.fileURLToPath)(__extensionHost.url("plugins/ext-skill/index.js")));
var APP_ROOT5 = import_node_path12.default.resolve(HERE3, "..", "..");
var DOC_EXT5 = /* @__PURE__ */ new Set([".md", ".txt"]);
var api3 = null;
var log3 = () => {
};
var cfg3 = () => ({});
var loaded2 = [];
function readManifest3(dir2) {
  const file = import_node_path12.default.join(dir2, "skill.json");
  if (!import_node_fs12.default.existsSync(file)) return { error: "\u7F3A\u5C11 skill.json" };
  try {
    let text = import_node_fs12.default.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 65279) text = text.slice(1);
    return { raw: JSON.parse(text) };
  } catch (error) {
    return { error: `skill.json \u89E3\u6790\u5931\u8D25\uFF1A${error?.message ?? error}` };
  }
}
function normalizeScripts(dir2, rawIds) {
  const out = [];
  const violations = [];
  for (const entry of Array.isArray(rawIds) ? rawIds : []) {
    const rel = String(typeof entry === "string" ? entry : entry?.path || "").replace(/\\/g, "/");
    if (!rel) {
      violations.push("scripts[] \u6709\u7A7A\u8DEF\u5F84");
      continue;
    }
    const abs = import_node_path12.default.resolve(dir2, rel);
    const relToDir = import_node_path12.default.relative(dir2, abs);
    if (!relToDir || relToDir.startsWith("..") || import_node_path12.default.isAbsolute(relToDir)) {
      violations.push(`\u811A\u672C\u8D8A\u754C\uFF1A${rel}`);
      continue;
    }
    const lang = String(typeof entry === "object" && entry?.lang || "js").toLowerCase();
    if (lang !== "js" && !cfg3().allowNonJs) {
      violations.push(`${rel}\uFF1A\u8BED\u8A00 ${lang} \u9700\u8981\u5BB9\u5668\u540E\u7AEF\uFF08\u5F53\u524D\u964D\u7EA7\u6C99\u7BB1\u53EA\u652F\u6301 js\uFF09`);
      continue;
    }
    if (!import_node_fs12.default.existsSync(abs)) {
      violations.push(`\u811A\u672C\u4E0D\u5B58\u5728\uFF1A${rel}`);
      continue;
    }
    out.push({
      path: rel,
      lang,
      description: String(typeof entry === "object" && entry?.description || ""),
      docId: String(typeof entry === "object" && entry?.docId || "")
    });
  }
  return { scripts: out, violations };
}
function indexDocs2(pkgDir, pkgId) {
  const dir2 = import_node_path12.default.join(pkgDir, "docs");
  if (!import_node_fs12.default.existsSync(dir2)) return [];
  const ids = [];
  for (const ent of import_node_fs12.default.readdirSync(dir2, { withFileTypes: true })) {
    if (!ent.isFile() || !DOC_EXT5.has(import_node_path12.default.extname(ent.name).toLowerCase())) continue;
    let content = "";
    try {
      content = import_node_fs12.default.readFileSync(import_node_path12.default.join(dir2, ent.name), "utf8").replace(/^\uFEFF/, "");
    } catch {
      continue;
    }
    const base = import_node_path12.default.basename(ent.name, import_node_path12.default.extname(ent.name));
    const docId = `${pkgId}.${base}`;
    const r = api3.docRegistry?.register?.({
      id: docId,
      title: `${pkgId} \xB7 ${base}`,
      layer: "skill",
      ownerId: pkgId,
      path: `docs/${ent.name}`,
      content
    });
    if (r && r.ok === false && !String(r.error || "").includes("\u5DF2\u5B58\u5728")) log3(`${docId}\uFF1A${r.error}`);
    else ids.push(docId);
  }
  return ids;
}
async function scanAndRegister2() {
  const dirName = String(cfg3().docsDir || "skills");
  const root = import_node_path12.default.isAbsolute(dirName) ? dirName : import_node_path12.default.join(APP_ROOT5, dirName);
  if (!import_node_fs12.default.existsSync(root)) {
    log3(`\u6280\u80FD\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7\uFF1A${root}`);
    return { loaded: 0, failed: 0 };
  }
  const max = Math.max(1, Number(cfg3().maxPackages) || 50);
  let okCount = 0;
  let failCount = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const ent of import_node_fs12.default.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    if (okCount >= max) {
      log3(`\u5DF2\u8FBE\u4E0A\u9650 ${max}`);
      break;
    }
    const dir2 = import_node_path12.default.join(root, ent.name);
    const { raw, error } = readManifest3(dir2);
    if (error) {
      failCount++;
      log3(`${ent.name}\uFF1A${error}`);
      continue;
    }
    if (String(raw.type || "") !== "skill") continue;
    const pkgId = String(raw.id || ent.name);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pkgId)) {
      failCount++;
      log3(`id \u975E\u6CD5\uFF1A${pkgId}`);
      continue;
    }
    if (seen.has(pkgId)) {
      failCount++;
      log3(`\u91CD\u590D id\uFF1A${pkgId}`);
      continue;
    }
    seen.add(pkgId);
    const mv = validateManifest("skill", raw);
    if (!mv.ok) {
      failCount++;
      log3(`${pkgId} \u6E05\u5355\u4E0D\u5408\u89C4\uFF1A${mv.violations.join("\uFF1B")}`);
      continue;
    }
    const { scripts: scripts2, violations } = normalizeScripts(dir2, raw.scripts);
    if (violations.length) {
      failCount++;
      log3(`${pkgId} \u811A\u672C\u58F0\u660E\u4E0D\u5408\u89C4\uFF1A${violations.slice(0, 5).join("\uFF1B")}`);
      continue;
    }
    if (!scripts2.length) {
      failCount++;
      log3(`${pkgId}\uFF1Ascripts[] \u4E3A\u7A7A\uFF0C\u6CA1\u6709\u53EF\u6267\u884C\u811A\u672C`);
      continue;
    }
    const entryRel = String(raw.entry || "");
    if (entryRel) {
      const entryAbs = import_node_path12.default.resolve(dir2, entryRel);
      const relToDir = import_node_path12.default.relative(dir2, entryAbs);
      if (relToDir.startsWith("..") || import_node_path12.default.isAbsolute(relToDir)) {
        failCount++;
        log3(`${pkgId}\uFF1Aentry \u8D8A\u754C`);
        continue;
      }
      if (import_node_fs12.default.existsSync(entryAbs)) {
        try {
          const mod = await __extensionHost.importModule(entryAbs);
          const ev = validateExports("skill", mod);
          if (!ev.ok) {
            failCount++;
            log3(`${pkgId} \u5BFC\u51FA\u8D8A\u754C\uFF1A${ev.violations.join("\uFF1B")}`);
            continue;
          }
        } catch (err) {
          failCount++;
          log3(`${pkgId}\uFF1A\u5165\u53E3\u52A0\u8F7D\u5931\u8D25\uFF08${err?.message ?? err}\uFF09`);
          continue;
        }
      }
    }
    const reg = api3.registerSubExtension({
      type: "skill",
      id: pkgId,
      description: String(raw.description || ""),
      name: String(raw.name || pkgId),
      version: String(raw.version || "1.0.0"),
      status: "active",
      settingsSchema: raw.configSchema || {},
      settings: raw.settings || {},
      details: {
        params: renderConfigDeep(Array.isArray(raw.params) ? raw.params : [], { ownerId: pkgId }),
        scripts: scripts2.map((s) => ({ path: s.path, lang: s.lang, description: s.description })),
        backend: isContainerAvailable() ? "container" : "sandbox",
        dir: dir2
      }
    });
    if (reg && reg.ok === false) {
      failCount++;
      log3(`${pkgId} \u767B\u8BB0\u5931\u8D25\uFF1A${reg.error}`);
      continue;
    }
    registerSkillScripts(pkgId, { dir: dir2, scripts: scripts2 });
    const docIds = indexDocs2(dir2, pkgId);
    loaded2.push({ id: pkgId, dir: dir2, scripts: scripts2, docIds });
    okCount++;
  }
  log3(`\u6280\u80FD\u5305\uFF1A\u626B\u63CF ${root}\uFF0C\u52A0\u8F7D ${okCount} \u4E2A\uFF0C\u5931\u8D25 ${failCount} \u4E2A\uFF08\u540E\u7AEF\uFF1A${isContainerAvailable() ? "\u5BB9\u5668" : "\u964D\u7EA7\u6C99\u7BB1(js)"}\uFF09`);
  return { loaded: okCount, failed: failCount };
}
function clearAll3() {
  for (const item of loaded2) {
    unregisterSkillScripts(item.id);
    try {
      api3.docRegistry?.unregisterByOwner?.(item.id);
    } catch {
    }
    try {
      api3.unregisterSubExtension(item.id);
    } catch {
    }
  }
  loaded2 = [];
}
function setup3(hostApi) {
  api3 = hostApi;
  log3 = hostApi.log || (() => {
  });
  cfg3 = hostApi.config;
}
async function activate3() {
  api3.registerExtensionTab?.({
    id: "skill",
    label: "\u6280\u80FD",
    icon: "\u{1F4DA}",
    order: 40,
    surface: "both",
    mode: "template",
    dataUrl: "/api/extensions?type=skill",
    hint: "LLM \u578B\u6269\u5C55\uFF1A\u6CE8\u518C\u5DE5\u5177\uFF0C\u7528\u4E0D\u7528\u7531\u6A21\u578B\u5224\u65AD"
  });
  if (cfg3().enabled === false) {
    log3("\u6280\u80FD\u7BA1\u7406\u5668\u5DF2\u5173\u95ED");
    return;
  }
  try {
    clearAll3();
    await scanAndRegister2();
  } catch (error) {
    log3(`\u626B\u63CF\u6280\u80FD\u5305\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
  try {
    api3.registerPromptContribution({
      at: "after-skill-sections",
      order: 210,
      priority: 35,
      text: () => {
        const all = loaded2.filter((l) => l.scripts.length);
        if (!all.length) return "";
        const lines = ["\u3010\u53EF\u7528\u811A\u672C\u3011\u7528 skill_script_run(skillId, script, args) \u8C03\u7528\uFF1A"];
        for (const pkg of all.slice(0, 12)) {
          for (const s of pkg.scripts.slice(0, 8)) {
            const desc = s.description ? ` \u2014 ${s.description}` : "";
            const docs2 = s.docId ? `\uFF08\u6587\u6863 ${s.docId}\uFF09` : "";
            lines.push(`- ${pkg.id}/${s.path}${desc}${docs2}`);
          }
        }
        return lines.join("\n").slice(0, 2e3);
      }
    });
  } catch (error) {
    log3(`\u6CE8\u518C\u811A\u672C\u76EE\u5F55\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function deactivate3() {
  try {
    api3.unregisterExtensionTab?.();
  } catch {
  }
  try {
    clearAll3();
    api3.unregisterPromptContribution?.();
  } catch (error) {
    log3(`\u505C\u7528\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function dispose3() {
  deactivate3();
}
function available3() {
  return true;
}
function status2() {
  return {
    backend: isContainerAvailable() ? "container" : "sandbox",
    dir,
    packages: loaded2.map((l) => ({ id: l.id, scripts: l.scripts.map((s) => s.path), docs: l.docIds }))
  };
}

// packages/extension-compat/vendor/plugins/ext-knowledge/index.js
var ext_knowledge_exports = {};
__export(ext_knowledge_exports, {
  __setChatForTest: () => __setChatForTest,
  activate: () => activate4,
  available: () => available4,
  deactivate: () => deactivate4,
  dispose: () => dispose4,
  setup: () => setup4,
  summaryAbsFor: () => summaryAbsFor,
  summaryStatus: () => summaryStatus
});
var import_node_fs13 = __toESM(require("node:fs"), 1);
var import_node_path13 = __toESM(require("node:path"), 1);
var import_node_url6 = require("node:url");

// packages/extension-compat/bridge/llm.js
var chatCompletion = (messages, options) => __extensionHost.complete(messages, options);

// packages/extension-compat/vendor/plugins/ext-knowledge/index.js
var HERE4 = import_node_path13.default.dirname((0, import_node_url6.fileURLToPath)(__extensionHost.url("plugins/ext-knowledge/index.js")));
var APP_ROOT6 = import_node_path13.default.resolve(HERE4, "..", "..");
var api4 = null;
var log4 = () => {
};
var cfg4 = () => ({});
var docs = null;
var chatFn = chatCompletion;
var registered = [];
var summaryCache = null;
var summaryTask = { running: false, done: 0, total: 0, error: "", stats: null };
var summaryAbort = false;
var summaryScheduled = false;
function knowledgeRoot() {
  const dir2 = String(cfg4().docsDir || "knowledge");
  return import_node_path13.default.isAbsolute(dir2) ? dir2 : dir2 === "knowledge" ? import_node_path13.default.join(APP_ROOT6, "knowledge") : import_node_path13.default.join(APP_ROOT6, dir2);
}
function ensureCache() {
  if (summaryCache) return summaryCache;
  const base = __extensionHost.dataDir ? import_node_path13.default.join(__extensionHost.dataDir, "knowledge-summaries") : import_node_path13.default.join(APP_ROOT6, "data", "knowledge-summaries");
  summaryCache = new SummaryCache({ file: import_node_path13.default.join(base, "index.json"), log: log4 });
  return summaryCache;
}
function scanAndRegister3() {
  const root = knowledgeRoot();
  if (!import_node_fs13.default.existsSync(root)) {
    log4(`\u77E5\u8BC6\u5E93\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7\uFF1A${root}`);
    return { loaded: 0 };
  }
  let loaded4 = 0;
  for (const ent of import_node_fs13.default.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    const libDir = import_node_path13.default.join(root, ent.name);
    const libId = ent.name;
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(libId)) {
      log4(`\u5E93\u540D\u975E\u6CD5\uFF0C\u8DF3\u8FC7\uFF1A${libId}`);
      continue;
    }
    const tree = scanKnowledgeTree(libDir);
    const st = treeStats(tree);
    if (!st.docs) {
      log4(`${libId}\uFF1A\u6CA1\u6709\u53EF\u7528\u6587\u6863\uFF08\u53EA\u6536 md/txt\uFF09\uFF0C\u8DF3\u8FC7`);
      continue;
    }
    const reg = api4.registerSubExtension({
      type: "knowledge",
      id: libId,
      name: libId,
      version: "1.0.0",
      status: "active",
      description: libId + "\uFF08\u77E5\u8BC6\u5E93\u76EE\u5F55\uFF1A\u76EE\u5F55\u5373\u6A21\u5757\uFF0C\u6458\u8981\u5199\u5728 .summery/\uFF09",
      details: {
        moduleCount: Math.max(0, st.dirs - 1),
        dir: libDir,
        docCount: st.docs,
        summaryDir: SUMMARY_DIR,
        summaryRoot: `${SUMMARY_DIR}/${SUMMARY_DIR}`
      }
    });
    if (reg && reg.ok === false) {
      log4(`${libId} \u767B\u8BB0\u5931\u8D25\uFF1A${reg.error}`);
      continue;
    }
    walkNodes(tree, (node) => {
      if (node.kind !== "doc") return;
      const docId = `${libId}/${node.relPath}`;
      let content = "";
      try {
        content = import_node_fs13.default.readFileSync(node.abs, "utf8").replace(/^\uFEFF/, "");
      } catch {
      }
      const sum = readSummary(libDir, node);
      docs?.register?.({
        id: docId,
        title: node.name,
        layer: "L3",
        ownerId: libId,
        path: node.relPath,
        content,
        summary: sum,
        summarySource: sum ? "user" : "missing"
      });
    });
    const modules = (tree.children || []).filter((c) => c.kind === "dir").map((c) => ({
      id: c.relPath,
      title: c.name,
      intro: "",
      docIds: []
    }));
    docs?.registerKb?.({
      id: libId,
      title: libId,
      summary: "",
      summarySource: "missing",
      scope: "global",
      ownerId: libId,
      modules
    });
    registered.push({ id: libId, root: libDir, tree });
    loaded4 += 1;
  }
  log4(`\u77E5\u8BC6\u5E93\uFF1A\u626B\u63CF ${root}\uFF0C\u767B\u8BB0 ${loaded4} \u672C`);
  return { loaded: loaded4 };
}
async function runSummaryTask() {
  if (summaryTask.running) return;
  const targets = registered.slice();
  if (!targets.length) {
    summaryScheduled = false;
    return;
  }
  summaryAbort = false;
  summaryTask = { running: true, done: 0, total: targets.length, error: "", stats: null };
  const cache = ensureCache();
  try {
    for (const item of targets) {
      if (summaryAbort) break;
      const { stats, entries } = await ensureSummaries(item.root, item.tree, {
        chatCompletion: chatFn,
        model: String(cfg4().summaryModel || ""),
        useLlm: cfg4().summaryUseLlm !== false && String(cfg4().summaryMode || "auto") !== "off",
        writeFiles: cfg4().summaryWriteBack !== false,
        cache,
        log: log4,
        budgetTokens: Math.max(1e3, Number(cfg4().summaryBudgetTokens) || 2e4)
      });
      for (const [rel, entry] of entries) {
        if (!rel) continue;
        const node = findNode(item.tree, rel);
        if (node?.kind === "doc") {
          docs?.setDocSummary?.(`${item.id}/${rel}`, { summary: entry.text, source: entry.source });
        } else {
          docs?.setModuleIntro?.(item.id, rel, { intro: entry.text, source: entry.source });
        }
      }
      const rootEntry = entries.get("");
      if (rootEntry) docs?.setKbSummary?.(item.id, { summary: rootEntry.text, source: rootEntry.source });
      summaryTask.done += 1;
      summaryTask.stats = { ...summaryTask.stats || {}, ...stats };
    }
  } catch (error) {
    summaryTask.error = String(error?.message ?? error);
    log4(`\u6458\u8981\u4EFB\u52A1\u5931\u8D25\uFF1A${summaryTask.error}`);
  } finally {
    summaryTask.running = false;
    summaryScheduled = false;
    cache.save();
    log4(`\u6458\u8981\u4EFB\u52A1\u7ED3\u675F\uFF1A${summaryTask.done}/${summaryTask.total}` + (summaryTask.error ? `\uFF08${summaryTask.error}\uFF09` : ""));
  }
}
function findNode(tree, rel) {
  if (!rel) return tree;
  const parts = rel.split("/");
  let cur = tree;
  for (const p of parts) {
    const next = (cur.children || []).find((c) => c.name === p);
    if (!next) return null;
    cur = next;
  }
  return cur;
}
function setup4(hostApi) {
  api4 = hostApi;
  log4 = hostApi.log || (() => {
  });
  cfg4 = hostApi.config;
  docs = hostApi.docRegistry || null;
  if (!docs) log4("\u6838\u5FC3\u672A\u63D0\u4F9B docRegistry\uFF0C\u77E5\u8BC6\u5E93\u5C06\u65E0\u6CD5\u767B\u8BB0\u6587\u6863");
}
function activate4() {
  api4.registerExtensionTab?.({
    id: "knowledge",
    label: "\u77E5\u8BC6",
    icon: "\u{1F5C2}\uFE0F",
    order: 50,
    surface: "both",
    mode: "template",
    dataUrl: "/api/extensions?type=knowledge",
    hint: "\u76EE\u5F55\u5373\u6A21\u5757\uFF0C\u6458\u8981\u5199\u5165 .summery"
  });
  if (cfg4().enabled === false) {
    log4("\u77E5\u8BC6\u5E93\u7BA1\u7406\u5668\u5DF2\u5173\u95ED");
    return;
  }
  try {
    clearRegistered();
    scanAndRegister3();
    summaryScheduled = true;
    __extensionHost.schedule(() => runSummaryTask());
    try {
      api4.registerUIAction({
        actionId: "set-summary-model",
        handler: (args) => {
          const model = String(args?.model || "").trim();
          setSummaryModel(model);
          return { ok: true, model };
        }
      });
      api4.registerUIContribution({
        id: "summary-model",
        point: "page.settings.model.extra",
        kind: "declarative",
        order: 50,
        title: "\u77E5\u8BC6\u5E93\u6458\u8981\u6A21\u578B",
        payload: {
          type: "form",
          submitLabel: "\u4FDD\u5B58\u6458\u8981\u6A21\u578B",
          actionId: "set-summary-model",
          fields: [
            {
              name: "model",
              label: "\u6458\u8981\u4F7F\u7528\u7684\u6A21\u578B\uFF08\u7559\u7A7A = \u9ED8\u8BA4\u6A21\u578B\uFF09",
              value: String(cfg4().summaryModel || "")
            }
          ]
        }
      });
    } catch (error) {
      log4(`\u6CE8\u518C\u6A21\u578B\u914D\u7F6E UI \u5931\u8D25\uFF1A${error?.message ?? error}`);
    }
    api4.registerPromptContribution({
      at: "after-skill-sections",
      order: 200,
      priority: 40,
      text: () => {
        const kbs = (docs?.listKbs?.() || []).filter((kb) => isKbEnabled(kb.id));
        if (!kbs.length) return "";
        const lines = [];
        for (const kb of kbs.slice(0, Number(cfg4().maxKbs) || 6)) {
          lines.push(`\xB7 ${kb.title}`);
          const rootMd = String(kb.summary || "").trim();
          if (rootMd) for (const ln of rootMd.split(/\r?\n/).slice(0, 12)) lines.push(`  ${ln}`);
          for (const m of (kb.modules || []).slice(0, Number(cfg4().maxModulesPerKb) || 12)) {
            const intro = String(m.intro || "").replace(/\s+/g, " ").slice(0, 120);
            lines.push(`  - ${m.title}${intro ? `\uFF1A${intro}` : ""}`);
          }
        }
        const budget = Math.max(500, Number(cfg4().maxInjectChars) || 3e3);
        return `\u3010\u77E5\u8BC6\u5E93\u3011\u4EE5\u4E0B\u4E3A\u76EE\u5F55\u5BFC\u822A\uFF1B\u9700\u8981\u6B63\u6587\u65F6\u8C03\u7528 load_doc(docId)\uFF1A
${lines.join("\n").slice(0, budget)}`;
      }
    });
  } catch (error) {
    log4(`\u6FC0\u6D3B\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function setSummaryModel(model) {
  try {
    updateConfig({ skills: { "ext-knowledge": { summaryModel: String(model || "") } } });
    return true;
  } catch (error) {
    log4(`\u4FDD\u5B58\u6458\u8981\u6A21\u578B\u5931\u8D25\uFF1A${error?.message ?? error}`);
    return false;
  }
}
function isKbEnabled(kbId) {
  try {
    const d = api4.getSubExtension(kbId);
    if (!d) return false;
    const explicit = api4.isExtensionEnabled?.(kbId);
    if (explicit !== null && explicit !== void 0) return explicit !== false;
    return true;
  } catch {
    return false;
  }
}
function clearRegistered() {
  for (const r of registered) {
    docs?.unregisterByOwner?.(r.id);
    api4.unregisterSubExtension(r.id);
  }
  registered = [];
}
function deactivate4() {
  try {
    api4.unregisterExtensionTab?.();
  } catch {
  }
  summaryAbort = true;
  summaryScheduled = false;
  try {
    clearRegistered();
    api4.unregisterPromptContribution?.();
  } catch (error) {
    log4(`\u505C\u7528\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function dispose4() {
  deactivate4();
}
function available4() {
  return true;
}
function summaryStatus() {
  return {
    task: { ...summaryTask },
    scheduled: summaryScheduled,
    libs: registered.map((r) => r.id),
    stats: docs?.summaryStats?.() || null
  };
}
function __setChatForTest(fn) {
  chatFn = typeof fn === "function" ? fn : chatCompletion;
}

// packages/extension-compat/vendor/plugins/ext-promptinject/index.js
var ext_promptinject_exports = {};
__export(ext_promptinject_exports, {
  activate: () => activate5,
  available: () => available5,
  deactivate: () => deactivate5,
  dispose: () => dispose5,
  setup: () => setup5,
  status: () => status3
});
var import_node_fs14 = __toESM(require("node:fs"), 1);
var import_node_path14 = __toESM(require("node:path"), 1);
var import_node_url7 = require("node:url");
var HERE5 = import_node_path14.default.dirname((0, import_node_url7.fileURLToPath)(__extensionHost.url("plugins/ext-promptinject/index.js")));
var APP_ROOT7 = import_node_path14.default.resolve(HERE5, "..", "..");
var api5 = null;
var log5 = () => {
};
var cfg5 = () => ({});
var loaded3 = [];
function readManifest4(dir2) {
  const file = import_node_path14.default.join(dir2, "promptinject.json");
  if (!import_node_fs14.default.existsSync(file)) return { error: "\u7F3A\u5C11 promptinject.json" };
  try {
    let text = import_node_fs14.default.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 65279) text = text.slice(1);
    return { raw: JSON.parse(text), file };
  } catch (error) {
    return { error: `promptinject.json \u89E3\u6790\u5931\u8D25\uFF1A${error?.message ?? error}` };
  }
}
async function scanAndRegister4() {
  const dirName = String(cfg5().docsDir || "promptinjects");
  const root = import_node_path14.default.isAbsolute(dirName) ? dirName : import_node_path14.default.join(APP_ROOT7, dirName);
  if (!import_node_fs14.default.existsSync(root)) {
    log5(`\u6CE8\u5165\u5305\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7\uFF1A${root}`);
    return { loaded: 0, failed: 0 };
  }
  const max = Math.max(1, Number(cfg5().maxPackages) || 20);
  let okCount = 0;
  let failCount = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const ent of import_node_fs14.default.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
    if (okCount >= max) {
      log5(`\u5DF2\u8FBE\u4E0A\u9650 ${max}\uFF0C\u5269\u4F59\u5305\u8DF3\u8FC7`);
      break;
    }
    const dir2 = import_node_path14.default.join(root, ent.name);
    const { raw, error } = readManifest4(dir2);
    if (error) {
      failCount++;
      log5(`${ent.name}\uFF1A${error}`);
      continue;
    }
    const pkgId = String(raw.id || ent.name);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(pkgId)) {
      failCount++;
      log5(`${ent.name}\uFF1Aid \u975E\u6CD5\uFF08${pkgId}\uFF09`);
      continue;
    }
    if (seen.has(pkgId)) {
      failCount++;
      log5(`\u91CD\u590D id\uFF1A${pkgId}`);
      continue;
    }
    seen.add(pkgId);
    const entryRel = String(raw.entry || "inject.js");
    const entryAbs = import_node_path14.default.resolve(dir2, entryRel);
    const rel = import_node_path14.default.relative(dir2, entryAbs);
    if (!rel || rel.startsWith("..") || import_node_path14.default.isAbsolute(rel)) {
      failCount++;
      log5(`${pkgId}\uFF1Aentry \u5FC5\u987B\u662F\u5305\u5185\u76F8\u5BF9\u8DEF\u5F84\uFF08${entryRel}\uFF09`);
      continue;
    }
    if (!import_node_fs14.default.existsSync(entryAbs)) {
      failCount++;
      log5(`${pkgId}\uFF1A\u5165\u53E3\u6587\u4EF6\u4E0D\u5B58\u5728\uFF08${entryRel}\uFF09`);
      continue;
    }
    let mod;
    try {
      mod = await __extensionHost.importModule(entryAbs);
    } catch (err) {
      failCount++;
      log5(`${pkgId}\uFF1A\u52A0\u8F7D inject.js \u5931\u8D25\uFF08${err?.message ?? err}\uFF09`);
      continue;
    }
    const v = validatePromptInjectExports(mod);
    if (!v.ok) {
      failCount++;
      log5(`${pkgId}\uFF1A\u6CE8\u5165\u58F0\u660E\u975E\u6CD5 \u2192 ${v.violations.slice(0, 5).join("\uFF1B")}`);
      continue;
    }
    const injects = Array.isArray(mod.meta?.injects) ? mod.meta.injects : [];
    const reg = api5.registerSubExtension({
      type: "promptinject",
      id: pkgId,
      name: String(raw.name || pkgId),
      description: String(raw.description || ""),
      version: String(raw.version || "1.0.0"),
      status: "active",
      settingsSchema: raw.configSchema || {},
      settings: raw.settings || {},
      details: {
        order: Number(raw.order) || 100,
        dir: dir2,
        injects: injects.map((i) => ({
          id: String(i.id),
          kind: String(i.kind),
          at: i.at ? String(i.at) : "",
          target: i.target ? String(i.target) : "",
          priority: Number(i.priority) || 50,
          title: String(i.title || "")
        })),
        anchors: [...new Set(injects.filter((i) => i.kind === "append").map((i) => String(i.at)))],
        targets: [...new Set(injects.filter((i) => i.kind === "rewrite").map((i) => String(i.target)))]
      }
    });
    if (reg && reg.ok === false) {
      failCount++;
      log5(`${pkgId} \u767B\u8BB0\u5931\u8D25\uFF1A${reg.error}`);
      continue;
    }
    registerPromptInjectSource(pkgId, {
      order: Number(raw.order) || 100,
      dir: dir2,
      injects,
      append: typeof mod.append === "function" ? mod.append : null,
      rewrite: typeof mod.rewrite === "function" ? mod.rewrite : null,
      enabled: (ctx) => {
        try {
          const explicit = api5.isExtensionEnabled?.(pkgId, ctx?.chatKey || "");
          return explicit === null || explicit === void 0 ? true : explicit !== false;
        } catch {
          return true;
        }
      }
    });
    loaded3.push({ id: pkgId, file: entryAbs });
    okCount++;
  }
  log5(`\u63D0\u793A\u8BCD\u6CE8\u5165\uFF1A\u626B\u63CF ${root}\uFF0C\u52A0\u8F7D ${okCount} \u4E2A\uFF0C\u5931\u8D25 ${failCount} \u4E2A`);
  return { loaded: okCount, failed: failCount };
}
function clearAll4() {
  for (const item of loaded3) {
    unregisterPromptInjectSource(item.id);
    api5.unregisterSubExtension(item.id);
  }
  loaded3 = [];
}
function setup5(hostApi) {
  api5 = hostApi;
  log5 = hostApi.log || (() => {
  });
  cfg5 = hostApi.config;
}
async function activate5() {
  api5.registerExtensionTab?.({
    id: "context",
    label: "\u4E0A\u4E0B\u6587",
    icon: "\u270F\uFE0F",
    order: 60,
    surface: "both",
    mode: "template",
    dataUrl: "/api/extensions?type=promptinject",
    hint: "\u6309\u951A\u70B9\u8FFD\u52A0\u6216\u6539\u5199\u7CFB\u7EDF\u63D0\u793A"
  });
  if (cfg5().enabled === false) {
    log5("\u63D0\u793A\u8BCD\u6CE8\u5165\u7BA1\u7406\u5668\u5DF2\u5173\u95ED");
    return;
  }
  try {
    clearAll4();
    await scanAndRegister4();
  } catch (error) {
    log5(`\u626B\u63CF\u6CE8\u5165\u5305\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function deactivate5() {
  try {
    api5.unregisterExtensionTab?.();
  } catch {
  }
  try {
    clearAll4();
  } catch (error) {
    log5(`\u505C\u7528\u5931\u8D25\uFF1A${error?.message ?? error}`);
  }
}
function dispose5() {
  deactivate5();
}
function available5() {
  return true;
}
function status3() {
  const rows = [];
  for (const item of loaded3) {
    const d = api5.getSubExtension?.(item.id);
    for (const inj of d?.details?.injects || []) rows.push({ pkg: item.id, ...inj });
  }
  const conflicts = {};
  for (const r of rows) {
    if (r.kind !== "rewrite" || !r.target) continue;
    conflicts[r.target] = (conflicts[r.target] || 0) + 1;
  }
  return {
    packages: loaded3.map((l) => l.id),
    injects: rows,
    conflictingTargets: Object.entries(conflicts).filter(([, n]) => n > 1).map(([t, n]) => ({ target: t, count: n })),
    anchors: Object.keys(PROMPT_ANCHORS).length,
    targets: Object.keys(REWRITE_TARGETS).length
  };
}

// packages/extension-compat/bridge/entry.js
var builtinModules = {
  "ext-tool": ext_tool_exports,
  "ext-mcp": ext_mcp_exports,
  "ext-skill": ext_skill_exports,
  "ext-knowledge": ext_knowledge_exports,
  "ext-promptinject": ext_promptinject_exports
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MULTI_PROVIDER_CAPABILITIES,
  UI_SLOTS,
  builtinModules,
  catalog,
  createExtensionApi,
  dependencies,
  docRegistry,
  extensionCore,
  extensionHookBus,
  extensionRegistry,
  fetch,
  importer,
  injection,
  knowledge,
  loadPlugins,
  manifests,
  onToolsChanged,
  prompt,
  sandbox,
  settings,
  skillManager,
  stale,
  summaries,
  tabs,
  tools,
  types,
  ui,
  uiExtensionRegistry,
  unloadSkill,
  validation,
  variables,
  watchPlugins,
  zip
});

return module.exports;
}
