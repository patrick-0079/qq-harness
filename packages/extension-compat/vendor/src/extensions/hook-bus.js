// 扩展 Hook 总线：六类扩展参与系统生命周期的统一入口。
//
// 与现有 skillManager.runHook 的区别：
//   1. 支持更多派发点（20 个，覆盖消息/触发/上下文/提示词/模型/工具/发送/会话/扩展/配置）
//   2. 每个 hook 有明确预算（默认单监听 5s + 每点总预算），超时不再无限制等待
//   3. fail-open / fail-close 策略显式声明（安全类 hook 超时=拒绝；增强类 hook 超时=跳过）
//   4. 只对 active 的扩展执行；空监听零开销（预缓存）
//   5. 确定性排序：priority ↑ → 注册序 ↑ → id 字典序
//
// 不可绕过的不变量（内核硬编码，任何 hook 不能改变）：
//   - 准入/黑名单先于 hook 执行，不能被 hook 推翻
//   - 所有发送经 SendQueue；hook 只能改内容或否决，不能绕过队列
//   - 安全底线提示词段不可被删除

import { skillManager } from '../skills/manager.js';

/**
 * Hook 派发点定义。
 *
 * @property {string} id          — hook 名
 * @property {string} phase       — 所属阶段
 * @property {string} description — 说明
 * @property {string} failPolicy — 'open'（出错/超时继续主流程）| 'close'（出错/超时拒绝动作）
 * @property {number} timeoutMs   — 单监听超时（毫秒）
 * @property {number} totalBudgetMs — 该派发点的总预算（毫秒；0 = 不限）
 * @property {boolean} canVeto   — 是否允许返回 veto/block
 */
export const HOOK_DEFINITIONS = {
  // ── 启动/关闭 ──
  'kernel.ready':               { phase: 'kernel',   description: '内核服务就绪（不含扩展）',               failPolicy: 'open',  timeoutMs: 5000, totalBudgetMs: 5000,  canVeto: false },
  'kernel.shutdown':            { phase: 'kernel',   description: '内核即将停止（清理资源）',               failPolicy: 'open',  timeoutMs: 5000, totalBudgetMs: 5000,  canVeto: false },

  // ── 扩展生命周期 ──
  'extension.load':             { phase: 'extension',description: '子扩展即将加载（可否决）',               failPolicy: 'close', timeoutMs: 2000, totalBudgetMs: 2000,  canVeto: true },
  'extension.unload':           { phase: 'extension',description: '子扩展即将卸载（可否决）',               failPolicy: 'open',  timeoutMs: 2000, totalBudgetMs: 2000,  canVeto: true },
  'extension.activate':         { phase: 'extension',description: '子扩展即将激活（可否决）',               failPolicy: 'open',  timeoutMs: 2000, totalBudgetMs: 2000,  canVeto: true },
  'extension.deactivate':       { phase: 'extension',description: '子扩展即将停用',                           failPolicy: 'open',  timeoutMs: 2000, totalBudgetMs: 2000,  canVeto: false },

  // ── 消息入站 ──
  'message.received':           { phase: 'message',  description: '消息入库后、触发判定前（可改写/可拦）',   failPolicy: 'open',  timeoutMs: 500,  totalBudgetMs: 2000,  canVeto: true },
  'trigger.evaluate':           { phase: 'trigger',  description: '触发判定（可否决唤醒）',                   failPolicy: 'open',  timeoutMs: 500,  totalBudgetMs: 1000,  canVeto: true },
  'session.wake':               { phase: 'session',  description: '会话唤醒开始（只读）',                     failPolicy: 'open',  timeoutMs: 500,  totalBudgetMs: 1000,  canVeto: false },

  // ── 上下文/提示词 ──
  'context.build':              { phase: 'context',  description: '组装上下文（triggerEntries/store/memory）', failPolicy: 'open',  timeoutMs: 2000, totalBudgetMs: 5000,  canVeto: false },
  'prompt.segments':            { phase: 'prompt',   description: '收集/改写提示词段落',                       failPolicy: 'open',  timeoutMs: 1000, totalBudgetMs: 3000,  canVeto: false },
  'prompt.render':              { phase: 'prompt',   description: '最终提示词字符串后处理',                     failPolicy: 'open',  timeoutMs: 1000, totalBudgetMs: 2000,  canVeto: false },
  'messages.before':            { phase: 'llm',      description: '消息即将发给模型（原地改 messages）',        failPolicy: 'open',  timeoutMs: 2000, totalBudgetMs: 3000,  canVeto: false },

  // ── 模型 ──
  'llm.before':                 { phase: 'llm',      description: 'LLM 请求体改写',                            failPolicy: 'open',  timeoutMs: 1000, totalBudgetMs: 2000,  canVeto: false },
  'llm.after':                  { phase: 'llm',      description: 'LLM 响应加工',                              failPolicy: 'open',  timeoutMs: 1000, totalBudgetMs: 2000,  canVeto: false },
  'llm.error':                  { phase: 'llm',      description: 'LLM 错误（可给重试建议）',                   failPolicy: 'open',  timeoutMs: 500,  totalBudgetMs: 1000,  canVeto: false },

  // ── 工具 ──
  'tools.resolve':              { phase: 'tool',     description: '本轮可见工具集（可收窄）',                   failPolicy: 'open',  timeoutMs: 500,  totalBudgetMs: 1000,  canVeto: false },
  'tool.before':                { phase: 'tool',     description: '工具执行前（可否决）',                       failPolicy: 'close', timeoutMs: 1000, totalBudgetMs: 2000,  canVeto: true },
  'tool.after':                 { phase: 'tool',     description: '工具执行后（观察/加工结果）',               failPolicy: 'open',  timeoutMs: 1000, totalBudgetMs: 2000,  canVeto: false },

  // ── 发送 ──
  'reply.before-send':          { phase: 'reply',    description: '出站前（可否决/改写文本与媒体）',             failPolicy: 'close', timeoutMs: 1000, totalBudgetMs: 2000,  canVeto: true },
  'reply.after-send':           { phase: 'reply',    description: '出站后（只读结果）',                          failPolicy: 'open',  timeoutMs: 500,  totalBudgetMs: 1000,  canVeto: false },
  'reply.failed':               { phase: 'reply',    description: '发送失败（只读错误）',                          failPolicy: 'open',  timeoutMs: 500,  totalBudgetMs: 1000,  canVeto: false },

  // ── 会话结束 ──
  'session.end':                { phase: 'session',  description: '会话结束（只读摘要）',                         failPolicy: 'open',  timeoutMs: 500,  totalBudgetMs: 1000,  canVeto: false },

  // ── 配置 ──
  'config.changed':             { phase: 'config',   description: '配置变更（只读变更键）',                       failPolicy: 'open',  timeoutMs: 500,  totalBudgetMs: 1000,  canVeto: false }
};

/** 合法 hook 名集合。 */
export const VALID_HOOK_IDS = new Set(Object.keys(HOOK_DEFINITIONS));

/**
 * Hook 总线。
 *
 * 与 SkillManager 的 runHook 共存（不是替代）：
 *   - 现有 5 个 skill hooks 继续走 skillManager.runHook（向后兼容）
 *   - 新增 20 个 hook 走 HookBus（类型化、带预算）
 *   - 两套最终合并为一套（P8 清理）
 */
export class ExtensionHookBus {
  // 缓存：每个 hook 的活跃监听排序（注册/注销时失效）
  #cache = new Map();

  constructor({ log = () => {} } = {}) {
    this.listeners = new Map();   // hookId -> [{ ownerId, fn, priority, seq }]
    this.log = log;
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
      throw new Error(`未知的扩展 hook：${hookId}（合法值见 HOOK_DEFINITIONS）`);
    }
    if (typeof fn !== 'function') throw new Error(`hook ${hookId} 的监听必须是函数`);
    const list = this.listeners.get(hookId) || [];
    const entry = { ownerId: String(ownerId || ''), fn, priority: Number(priority) || 50, seq: ++this.seq };
    list.push(entry);
    this.listeners.set(hookId, list);
    this.#cache.delete(hookId);   // 失效缓存
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
    const list = [...(this.listeners.get(hookId) || [])].sort((a, b) =>
      a.priority - b.priority || a.seq - b.seq
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
    if (!def) throw new Error(`未知的扩展 hook：${hookId}`);

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
      // 活跃过滤：只对当前会话生效的扩展执行
      if (activeFilter && !activeFilter(entry.ownerId)) {
        skipped++;
        continue;
      }

      // 总预算检查
      if (def.totalBudgetMs > 0 && totalMs >= def.totalBudgetMs) {
        skipped++;
        this.log(`[hook:${hookId}] 总预算 ${def.totalBudgetMs}ms 已用完，跳过剩余监听（含 ${entry.ownerId}）`);
        continue;
      }

      try {
        const out = await this.#withTimeout(
          entry.fn(context, { ownerId: entry.ownerId, hookId }),
          def.timeoutMs,
          `${entry.ownerId}#${hookId}`
        );
        totalMs += 1; // 实际计时应由调用方注入；此处近似（每次至少 1ms）
        if (out !== undefined && out !== null) {
          results.push({ ownerId: entry.ownerId, value: out });
          // veto 检查：第一个 block/veto 生效
          if (def.canVeto && !veto) {
            const isVeto = (out && typeof out === 'object' && (out.block === true || out.veto === true))
              || out === false;
            if (isVeto) veto = out;
          }
        }
      } catch (error) {
        errors++;
        this.log(`[hook:${hookId}] ${entry.ownerId} 失败：${error?.message ?? error}`);
        // fail-close：安全类 hook 出错 = 拒绝动作
        if (def.failPolicy === 'close' && def.canVeto && !veto) {
          veto = { block: true, reason: `hook ${hookId} 因 ${entry.ownerId} 出错被安全拒绝` };
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
        const t = setTimeout(() => reject(new Error(`hook 超时（${ms}ms）`)), ms);
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
}

// 模块级单例
export const extensionHookBus = new ExtensionHookBus({ log: (...a) => console.log('[ext-hook]', ...a) });
