// 工具注册桥：扩展系统与现有 tool-registry 之间的适配层。
//
// registerToolAs(ownerId, def) 与现有 api.registerTool(def) 的区别：
//   1. 工具归属为 ownerId（子扩展），而不是注册者（管理器插件）
//   2. 前缀为 <ownerId>__<toolId>，不是 <managerId>__<toolId>
//   3. 启用/停用/卸载按 ownerId 联动
//
// 这层桥是为了不在 P1 阶段大改 tool-registry.js（保持向后兼容），
// P8 时统一收编进 tool-registry。

import { registerTool as registryRegister, unregisterTool, getTool, listTools } from '../tool-registry.js';

/**
 * 以指定 owner 身份注册工具。
 * 前缀规则与现有 registerTool 一致：`<ownerId>__<toolId>`，sanitize + 截断。
 *
 * @returns {string} 实际注册的完整工具 id
 * @throws 缺少 id / id 非法
 */
export function registerTool(ownerId, def) {
  if (!def?.id) throw new Error('工具必须提供 id');
  if (!ownerId) throw new Error('registerToolAs 需要 ownerId');

  const sanitize = (s) => String(s ?? '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const oid = sanitize(ownerId).slice(0, 24);
  const tid = sanitize(def.id).slice(0, 38);
  const prefixedId = tid.startsWith(`${oid}__`) ? tid : `${oid}__${tid}`;

  // 撞名告警（不同 owner 的同名工具会覆盖）
  const existing = getTool(prefixedId);
  if (existing && existing.skillId && existing.skillId !== ownerId) {
    console.warn(`[ext] ⚠️ 工具 id 冲突：${prefixedId} 已由 ${existing.skillId} 注册，${ownerId} 的同名工具会覆盖它`);
  }

  registryRegister({
    ...def,
    id: prefixedId,
    // skillId 是 tool-registry 的归属字段：这里绑定为 ownerId
    skillId: ownerId,
    _owner: ownerId
  });

  return prefixedId;
}

/** 按扩展 id 注销其全部工具（子扩展卸载/停用时调用）。 */
export function unregisterToolsByOwner(ownerId) {
  const ids = [];
  for (const tool of listTools()) {
    if (tool.skillId === ownerId || tool._owner === ownerId) {
      unregisterTool(tool.id);
      ids.push(tool.id);
    }
  }
  return ids;
}
