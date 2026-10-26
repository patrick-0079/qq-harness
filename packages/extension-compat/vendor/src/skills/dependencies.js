// 插件依赖校验与拓扑排序（纯函数）。
//
// 与 requires 的区别：
//   requires      依赖的是**能力**（provider），缺失时 isAvailable 返回 capability-missing；
//   dependsOn     依赖的是**插件本身**（id），缺失/作用域错误/成环时返回 dependency-*。
//
// 本模块只做静态校验，不读配置、不执行插件：
//   · 缺失依赖 → dependency-missing
//   · global 插件依赖 session 插件 → dependency-scope-invalid
//   · 依赖成环 → dependency-cycle
//   · 可选依赖不参与阻塞，只由调用方展示。

import { SKILL_ERROR } from './errors.js';

function manifestOf(skill) {
  return skill?.manifest || skill || {};
}

/** 取硬依赖 id 列表（去空、去重）。 */
export function hardDepsOf(skill) {
  const m = manifestOf(skill);
  return [...new Set(Array.isArray(m.dependsOn) ? m.dependsOn.map(String).filter(Boolean) : [])];
}

/** 取软依赖 id 列表。 */
export function optionalDepsOf(skill) {
  const m = manifestOf(skill);
  return [...new Set(Array.isArray(m.optionalDependsOn) ? m.optionalDependsOn.map(String).filter(Boolean) : [])];
}

/**
 * 校验一批已加载 Skill 的依赖关系。
 * @param {Array<object>} skills 形如 { manifest, ... } 或裸 manifest
 * @returns {Map<string, {code: string, reason: string}>}
 */
export function validateDependencies(skills) {
  const byId = new Map();
  for (const s of skills || []) {
    const m = manifestOf(s);
    if (m.id) byId.set(String(m.id), s);
  }
  const errors = new Map();
  const done = new Set();

  const visit = (id, stack) => {
    if (errors.has(id)) return errors.get(id);
    if (done.has(id)) return null;
    if (stack.has(id)) {
      const err = {
        code: SKILL_ERROR.DEPENDENCY_CYCLE,
        reason: `插件依赖成环：${[...stack, id].join(' → ')}`
      };
      errors.set(id, err);
      return err;
    }
    const skill = byId.get(id);
    if (!skill) return null;
    const m = manifestOf(skill);
    const scope = String(m.scope || 'global');
    for (const depId of hardDepsOf(skill)) {
      const dep = byId.get(depId);
      if (!dep) {
        const err = { code: SKILL_ERROR.DEPENDENCY_MISSING, reason: `缺少依赖插件：${depId}` };
        errors.set(id, err);
        return err;
      }
      const depScope = String(manifestOf(dep).scope || 'global');
      if (scope === 'global' && depScope === 'session') {
        const err = {
          code: SKILL_ERROR.DEPENDENCY_SCOPE_INVALID,
          reason: `全局插件不能依赖会话插件：${depId}`
        };
        errors.set(id, err);
        return err;
      }
      const sub = visit(depId, new Set(stack).add(id));
      if (sub) {
        // 依赖本身坏了：本插件也标成同一原因（保留依赖链可读性）
        const err = { code: sub.code, reason: `${depId}：${sub.reason}` };
        errors.set(id, err);
        return err;
      }
    }
    done.add(id);
    return null;
  };

  for (const id of byId.keys()) visit(id, new Set());
  return errors;
}

/**
 * 按硬依赖拓扑排序；缺失/坏依赖的条目仍会返回（由调用方决定是否激活）。
 * @returns {{order: object[], errors: Map}}
 */
export function topoOrder(skills) {
  const byId = new Map();
  for (const s of skills || []) {
    const m = manifestOf(s);
    if (m.id) byId.set(String(m.id), s);
  }
  const errors = validateDependencies(skills);
  const order = [];
  const seen = new Set();
  const stack = new Set();

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
