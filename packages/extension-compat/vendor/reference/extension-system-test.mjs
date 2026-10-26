// 扩展系统 v2 契约测试：六道闸门逐项验证。
//
// 与 skill-test.mjs 的分工：
//   skill-test.mjs        — 验证现有 v1 扩展架构（5 hook、能力、开关）
//   extension-system-test — 验证 v2 扩展系统（六类类型闸门、描述符表、
//                           Hook 总线预算、owner 归属、promptinject 契约）
//
// 每个测试对应一个「越界会导致静默失效或安全事故」的点。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// 数据目录隔离：必须在 import src/ 之前
process.env.QQ_AGENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-ext-'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
function ok(name, extra = '') {
  pass++;
  console.log(`  ✓ ${name}${extra ? ` —— ${extra}` : ''}`);
}
function bad(name, detail) {
  fail++;
  failures.push(name);
  console.log(`  ✗ ${name}`);
  if (detail) console.log(`      ${String(detail).split('\n').join('\n      ')}`);
}
function check(name, fn) {
  try { fn(); ok(name); } catch (e) { bad(name, e.message); }
}
async function checkAsync(name, fn) {
  try { await fn(); ok(name); } catch (e) { bad(name, e.message); }
}

async function main() {
  const {
    EXT_TYPES, VALID_TYPE_IDS, validateExports, validateManifest, typeOfDir,
    ExtensionDescriptorRegistry,
    ExtensionHookBus, HOOK_DEFINITIONS, VALID_HOOK_IDS,
    createExtensionApi, notifyToolsChanged, onToolsChanged,
    registerToolAs, unregisterToolsByOwner,
    PROMPT_ANCHORS, REWRITE_TARGETS, VALID_ANCHORS, VALID_TARGETS,
    validateInjectDeclaration, validatePromptInjectExports, resolveRewriteConflicts
  } = await import('../src/extensions/index.js');

  const { registerTool: registryRegister, getTool, listTools, clearRegistry } = await import('../src/tool-registry.js');

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ 1. 类型闸门（静态闸）════════════════════════════════════════');

  check('六类类型齐备', () => {
    const expected = ['tool', 'plugin', 'knowledge', 'mcp', 'skill', 'promptinject'];
    for (const t of expected) assert.ok(EXT_TYPES[t], `缺少类型 ${t}`);
    assert.equal(VALID_TYPE_IDS.length, 6);
  });

  check('tool 不允许导出 hooks/providers/activate', () => {
    const r = validateExports('tool', { setup: () => {}, hooks: {}, providers: {}, activate: () => {} });
    assert.equal(r.ok, false, '应当拒绝');
    assert.ok(r.violations.some(v => v.includes('hooks')), 'violations 应点名 hooks');
    assert.ok(r.violations.some(v => v.includes('providers')), 'violations 应点名 providers');
  });

  check('plugin 允许导出 hooks + providers + activate', () => {
    const r = validateExports('plugin', { setup: () => {}, hooks: {}, providers: {}, activate: () => {}, deactivate: () => {} });
    assert.equal(r.ok, true, `不应当拒绝：${r.violations}`);
  });

  check('knowledge 不允许任何 JS 入口（allowedExports 为空）', () => {
    const r = validateExports('knowledge', { setup: () => {} });
    assert.equal(r.ok, false, 'knowledge 有 JS 导出应被拒绝');
  });

  check('mcp 不允许任何 JS 导出', () => {
    const r = validateExports('mcp', { hooks: {} });
    assert.equal(r.ok, false);
  });

  check('promptinject 只允许 meta + append + rewrite', () => {
    const good = validateExports('promptinject', { meta: {}, append: () => '', rewrite: () => '' });
    assert.equal(good.ok, true, `合法导出不应被拒：${good.violations}`);
    const bad1 = validateExports('promptinject', { meta: {}, append: () => '', setup: () => {} });
    assert.equal(bad1.ok, false, 'promptinject 出 setup 应被拒绝');
  });

  check('skill（沙箱）不允许导出 setup/hooks/providers', () => {
    const r = validateExports('skill', { setup: () => {} });
    assert.equal(r.ok, false, 'skill 是沙箱脚本，不应有 ESM 导出');
  });

  check('未知类型直接拒绝', () => {
    const r = validateExports('nonexistent-type', {});
    assert.equal(r.ok, false);
    assert.ok(r.violations[0].includes('未知扩展类型'));
  });

  check('knowledge/mcp 清单不允许 entry 字段（无代码入口）', () => {
    assert.equal(validateManifest('knowledge', { id: 'kb', entry: 'index.js' }).ok, false);
    assert.equal(validateManifest('mcp', { id: 'srv', entry: 'index.js' }).ok, false);
    assert.equal(validateManifest('tool', { id: 't', entry: 'index.js' }).ok, true);
  });

  check('目录名 → 期望类型映射', () => {
    assert.equal(typeOfDir('tools'), 'tool');
    assert.equal(typeOfDir('plugins'), 'plugin');
    assert.equal(typeOfDir('knowledge'), 'knowledge');
    assert.equal(typeOfDir('mcp'), 'mcp');
    assert.equal(typeOfDir('skills'), 'skill');
    assert.equal(typeOfDir('promptinjects'), 'promptinject');
    assert.equal(typeOfDir('random-dir'), null);
    // Windows 反斜杠 + 尾部斜杠也认
    assert.equal(typeOfDir('tools\\'), 'tool');
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ 2. 描述符注册表═══════════════════════════════════════════════');

  const reg = new ExtensionDescriptorRegistry();

  check('登记 tool 描述符 + owner 可注册工具', () => {
    const r = reg.register({ type: 'tool', id: 'weather-query', managerId: 'ext-tool', name: '天气查询' });
    assert.equal(r.ok, true, r.error);
    const can = reg.canOwnerRegisterTool('weather-query');
    assert.equal(can.ok, true, can.reason);
  });

  check('登记 knowledge 描述符 + owner 不能注册工具', () => {
    reg.register({ type: 'knowledge', id: 'my-kb', managerId: 'ext-knowledge' });
    const can = reg.canOwnerRegisterTool('my-kb');
    assert.equal(can.ok, false, 'knowledge 不应能注册工具');
    assert.ok(can.reason.includes('不允许注册工具'));
  });

  check('登记 skill/mcp/promptinject → mcp 允许宿主代理，其余不可注册工具', () => {
    reg.register({ type: 'skill', id: 'my-script', managerId: 'ext-skill' });
    reg.register({ type: 'mcp', id: 'my-mcp', managerId: 'ext-mcp' });
    reg.register({ type: 'promptinject', id: 'my-inject', managerId: 'ext-promptinject' });
    // mcp 的工具由管理器以子扩展身份代理注册（hostProxyTools）
    assert.equal(reg.canOwnerRegisterTool('my-mcp').ok, true, 'mcp 应允许宿主代理注册');
    // skill 暂不代理；promptinject 纯文本
    for (const id of ['my-script', 'my-inject']) {
      const can = reg.canOwnerRegisterTool(id);
      assert.equal(can.ok, false, `${id} 不应能注册工具`);
    }
  });

  check('id 全局唯一：不同 manager 不能抢同名 id', () => {
    const r = reg.register({ type: 'tool', id: 'my-kb', managerId: 'ext-tool' });
    assert.equal(r.ok, false, 'my-kb 已被 ext-knowledge 登记为 knowledge');
    assert.ok(r.error.includes('已被'));
  });

  check('同 manager 重复登记 = 热重载覆盖（不报错）', () => {
    const r = reg.register({ type: 'tool', id: 'weather-query', managerId: 'ext-tool', name: '天气查询 v2' });
    assert.equal(r.ok, true);
    const d = reg.get('weather-query');
    assert.equal(d.name, '天气查询 v2');
  });

  check('未登记的 owner 不能注册工具', () => {
    const can = reg.canOwnerRegisterTool('ghost-owner');
    assert.equal(can.ok, false);
    assert.ok(can.reason.includes('未在描述符表登记'));
  });

  check('按 manager 注销全部子扩展', () => {
    reg.register({ type: 'tool', id: 'tool-a', managerId: 'ext-tool' });
    reg.register({ type: 'tool', id: 'tool-b', managerId: 'ext-tool' });
    reg.register({ type: 'knowledge', id: 'kb-x', managerId: 'ext-knowledge' });
    const removed = reg.unregisterByManager('ext-tool');
    assert.ok(removed.includes('weather-query') && removed.includes('tool-a') && removed.includes('tool-b'));
    assert.equal(reg.get('weather-query'), null);
    assert.equal(reg.get('kb-x') !== null, true, 'ext-knowledge 的子扩展不应被误删');
  });

  check('非法 id 拒绝（路径穿越防护）', () => {
    const r = reg.register({ type: 'tool', id: '../escape', managerId: 'ext-tool' });
    assert.equal(r.ok, false);
    const r2 = reg.register({ type: 'tool', id: 'a b', managerId: 'ext-tool' });
    assert.equal(r2.ok, false);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ 3. 工具归属桥（registerToolAs）══════════════════════════════');

  // 使用独立注册表测试（不污染全局）
  const reg2 = new ExtensionDescriptorRegistry();

  check('registerToolAs 前缀 = <ownerId>__<toolId>', () => {
    clearRegistry();
    registryRegister({ id: 'bridge__helper', name: '桥测试', execute: async () => ({}) });
    // 直接测 tool-bridge
    const id = registerToolAs('my-pkg', { id: 'do', name: '做', description: '做', execute: async () => ({ content: 'ok' }) });
    assert.equal(id, 'my-pkg__do', `前缀应为 my-pkg__do，实际 ${id}`);
    const tool = getTool('my-pkg__do');
    assert.equal(tool.skillId, 'my-pkg', '工具归属应为 my-pkg');
  });

  check('registerToolAs sanitize 非法字符 + 截断', () => {
    const id = registerToolAs('test:pck', { id: 'tool.with.dots', name: 'X', execute: async () => ({}) });
    assert.ok(!id.includes(':') && !id.includes('.'), `sanitize 后不应含 : 或 .（实际 ${id}）`);
  });

  check('unregisterToolsByOwner 按扩展批量注销', () => {
    registerToolAs('my-pkg', { id: 'second', name: 'X', execute: async () => ({}) });
    const removed = unregisterToolsByOwner('my-pkg');
    assert.ok(removed.includes('my-pkg__do') && removed.includes('my-pkg__second'));
    assert.equal(getTool('my-pkg__do'), null);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ 4. Hook 总线══════════════════════════════════════════════════');

  check('24 个 hook 定义齐备（含 budget/failPolicy/canVeto）', () => {
    const ids = Object.keys(HOOK_DEFINITIONS);
    assert.ok(ids.length >= 20, `至少 20 个 hook（实际 ${ids.length}）`);
    for (const [hid, def] of Object.entries(HOOK_DEFINITIONS)) {
      assert.ok(def.phase, `${hid} 缺 phase`);
      assert.ok(def.failPolicy === 'open' || def.failPolicy === 'close', `${hid} failPolicy 非法`);
      assert.ok(Number.isFinite(def.timeoutMs) && def.timeoutMs > 0, `${hid} timeoutMs 非法`);
      assert.ok(typeof def.canVeto === 'boolean', `${hid} 缺 canVeto`);
    }
  });

  await checkAsync('空监听零开销（不进入循环）', async () => {
    const bus = new ExtensionHookBus({ log: () => {} });
    assert.equal(bus.hasListeners('kernel.ready'), false);
    const r = await bus.dispatch('kernel.ready', {});
    assert.equal(r.results.length, 0);
    assert.equal(r.vetoed, false);
  });

  await checkAsync('派发 + 否决（第一个 block 生效）', async () => {
    const bus = new ExtensionHookBus({ log: () => {} });
    const order = [];
    bus.register({ ownerId: 'a', hookId: 'message.received', fn: () => { order.push('a'); return { block: true, reason: '拦截' }; }, priority: 10 });
    bus.register({ ownerId: 'b', hookId: 'message.received', fn: () => { order.push('b'); }, priority: 20 });
    const r = await bus.dispatch('message.received', {});
    assert.equal(r.vetoed, true, '应被否决');
    assert.ok(r.veto.reason === '拦截');
    assert.equal(order[0], 'a', 'priority 小的先执行');
  });

  await checkAsync('priority 排序：小的先执行', async () => {
    const bus = new ExtensionHookBus({ log: () => {} });
    const order = [];
    bus.register({ ownerId: 'x', hookId: 'session.wake', fn: () => { order.push('x'); }, priority: 100 });
    bus.register({ ownerId: 'y', hookId: 'session.wake', fn: () => { order.push('y'); }, priority: 1 });
    await bus.dispatch('session.wake', {});
    assert.deepEqual(order, ['y', 'x']);
  });

  await checkAsync('监听抛错被隔离（不影响其它监听与主流程）', async () => {
    const bus = new ExtensionHookBus({ log: () => {} });
    let called = false;
    bus.register({ ownerId: 'bad', hookId: 'context.build', fn: () => { throw new Error('炸了'); } });
    bus.register({ ownerId: 'good', hookId: 'context.build', fn: () => { called = true; } });
    const r = await bus.dispatch('context.build', {});
    assert.equal(r.errors, 1);
    assert.equal(called, true, 'good 监听应正常执行');
  });

  await checkAsync('fail-close：安全类 hook 出错 = 拒绝', async () => {
    const bus = new ExtensionHookBus({ log: () => {} });
    bus.register({ ownerId: 'guard', hookId: 'tool.before', fn: () => { throw new Error('守卫崩溃'); } });
    const r = await bus.dispatch('tool.before', { toolName: 'send_message' });
    assert.equal(r.vetoed, true, 'tool.before 是 fail-close，出错应视为否决');
  });

  await checkAsync('单监听超时被跳过', async () => {
    const bus = new ExtensionHookBus({ log: () => {} });
    bus.register({ ownerId: 'slow', hookId: 'message.received', fn: () => new Promise(r => setTimeout(r, 5000)) });
    const start = Date.now();
    const r = await bus.dispatch('message.received', {});
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `应在超时后返回而非等 5 秒（实际 ${elapsed}ms）`);
    assert.equal(r.results.length, 0);
  });

  await checkAsync('activeFilter 过滤非活跃扩展', async () => {
    const bus = new ExtensionHookBus({ log: () => {} });
    let calledBy = null;
    bus.register({ ownerId: 'on', hookId: 'trigger.evaluate', fn: () => { calledBy = 'on'; } });
    bus.register({ ownerId: 'off', hookId: 'trigger.evaluate', fn: () => { calledBy = 'off'; } });
    await bus.dispatch('trigger.evaluate', {}, { activeFilter: (id) => id === 'on' });
    assert.equal(calledBy, 'on');
  });

  check('未知 hook 名注册时抛错', () => {
    const bus = new ExtensionHookBus({ log: () => {} });
    assert.throws(() => bus.register({ ownerId: 'x', hookId: 'fake.hook', fn: () => {} }), /未知的扩展 hook/);
  });

  check('注销 owner 的全部监听', () => {
    const bus = new ExtensionHookBus({ log: () => {} });
    bus.register({ ownerId: 'x', hookId: 'session.wake', fn: () => {} });
    bus.register({ ownerId: 'x', hookId: 'config.changed', fn: () => {} });
    bus.register({ ownerId: 'y', hookId: 'session.wake', fn: () => {} });
    bus.unregister('x');
    assert.equal(bus.hasListeners('session.wake'), true, 'y 的监听应保留');
    assert.equal(bus.hasListeners('config.changed'), false);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ 5. 提示词注入契约════════════════════════════════════════════');

  check('10 个锚点 + 16 个改写目标', () => {
    assert.equal(Object.keys(PROMPT_ANCHORS).length, 10);
    assert.equal(Object.keys(REWRITE_TARGETS).length, 16);
  });

  check('at-tail 是唯一允许动态内容的锚点', () => {
    for (const [name, anchor] of Object.entries(PROMPT_ANCHORS)) {
      if (name === 'at-tail') assert.equal(anchor.allowsDynamic, true);
      else assert.equal(anchor.allowsDynamic, false, `${name} 不应允许动态内容`);
    }
  });

  check('security 是唯一 protected 改写目标', () => {
    for (const [name, t] of Object.entries(REWRITE_TARGETS)) {
      if (name === 'security') assert.equal(t.protected, true);
      else assert.equal(t.protected, false, `${name} 不应标记 protected`);
    }
  });

  check('validateInjectDeclaration：合法 append', () => {
    const r = validateInjectDeclaration({ id: 'x', kind: 'append', at: 'after-security', priority: 50 });
    assert.equal(r.ok, true, r.violations);
  });

  check('validateInjectDeclaration：非法锚点拒绝', () => {
    const r = validateInjectDeclaration({ id: 'x', kind: 'append', at: 'middle-of-nowhere', priority: 50 });
    assert.equal(r.ok, false);
  });

  check('validateInjectDeclaration：非法 priority 拒绝', () => {
    const r = validateInjectDeclaration({ id: 'x', kind: 'append', at: 'after-security', priority: 999 });
    assert.equal(r.ok, false);
  });

  check('validateInjectDeclaration：rewrite 必须有 target', () => {
    const r = validateInjectDeclaration({ id: 'x', kind: 'rewrite', target: 'anti-ai-flavor', priority: 50 });
    assert.equal(r.ok, true);
    const r2 = validateInjectDeclaration({ id: 'x', kind: 'rewrite', target: 'nonexistent', priority: 50 });
    assert.equal(r2.ok, false);
  });

  check('validatePromptInjectExports：完整合法', () => {
    const r = validatePromptInjectExports({
      meta: { injects: [
        { id: 'a', kind: 'append', at: 'after-security', priority: 50, title: 'T', summary: 'S' },
        { id: 'b', kind: 'rewrite', target: 'anti-ai-flavor', priority: 30, title: 'T2', summary: 'S2' }
      ] },
      append: () => '内容',
      rewrite: (orig) => orig
    });
    assert.equal(r.ok, true, r.violations);
  });

  check('validatePromptInjectExports：声明 append 但没导出函数', () => {
    const r = validatePromptInjectExports({
      meta: { injects: [{ id: 'a', kind: 'append', at: 'after-security', priority: 50 }] }
      // 缺 append 函数
    });
    assert.equal(r.ok, false);
    assert.ok(r.violations.some(v => v.includes('未导出 append')));
  });

  check('validatePromptInjectExports：多余导出拒绝（setup/hooks）', () => {
    const r = validatePromptInjectExports({
      meta: { injects: [] }, append: () => '', rewrite: () => '',
      setup: () => {}    // promptinject 不允许 setup
    });
    assert.equal(r.ok, false);
  });

  check('resolveRewriteConflicts：同 target 多 rewrite 取优先级最高', () => {
    const winners = resolveRewriteConflicts([
      { ownerId: 'a', target: 'security', priority: 30, order: 100 },
      { ownerId: 'b', target: 'security', priority: 80, order: 100 },
      { ownerId: 'c', target: 'tool-protocol', priority: 50, order: 100 }
    ]);
    assert.equal(winners.get('security'), 'b', 'priority 80 > 30');
    assert.equal(winners.get('tool-protocol'), 'c');
  });

  check('resolveRewriteConflicts：同优先级取 order 小的', () => {
    const winners = resolveRewriteConflicts([
      { ownerId: 'late', target: 'persona', priority: 50, order: 200 },
      { ownerId: 'early', target: 'persona', priority: 50, order: 10 }
    ]);
    assert.equal(winners.get('persona'), 'early', 'order 10 < 200');
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ 6. 按类型裁剪的 API ═════════════════════════════════════════');

  check('tool 类 API 有 registerToolAs + notifyToolsChanged', () => {
    const api = createExtensionApi('tool', 'test-tool', []);
    assert.equal(typeof api.registerToolAs, 'function');
    assert.equal(typeof api.notifyToolsChanged, 'function');
    assert.equal(typeof api.registerHook, 'undefined', 'tool 不应有 hook 注册');
    assert.equal(typeof api.registerSubExtension, 'undefined');
  });

  check('plugin 类 API 可代理子包注册工具，但不能给自己注册', () => {
    const api = createExtensionApi('plugin', 'test-plugin', []);
    assert.equal(typeof api.registerHook, 'function');
    assert.equal(typeof api.registerSubExtension, 'function');
    // 管理器通道：为子包代理注册（owner 校验在核心）；plugin 自身不是合法 owner
    assert.equal(typeof api.registerToolAs, 'function');
    assert.throws(
      () => api.registerToolAs('test-plugin', { id: 'x', name: 'X', execute: async () => ({}) }),
      /不允许注册工具|未在描述符表登记/
    );
  });

  check('knowledge 类 API 什么都没有（纯数据）', () => {
    const api = createExtensionApi('knowledge', 'test-kb', []);
    assert.equal(typeof api.registerToolAs, 'undefined');
    assert.equal(typeof api.registerHook, 'undefined');
    assert.equal(typeof api.registerSubExtension, 'undefined');
    assert.equal(typeof api.log, 'function', '基础日志应有');
  });

  check('skill 类 API 无 registerToolAs（模型只看 skill_script_run）', () => {
    const api = createExtensionApi('skill', 'test-skill', []);
    assert.equal(typeof api.registerToolAs, 'undefined');
  });

  check('promptinject 类 API 无任何注册能力', () => {
    const api = createExtensionApi('promptinject', 'test-inject', []);
    assert.equal(typeof api.registerHook, 'undefined');
    assert.equal(typeof api.registerToolAs, 'undefined');
  });

  check('未知类型创建 API 抛错', () => {
    assert.throws(() => createExtensionApi('bogus', 'x', []), /未知扩展类型/);
  });

  check('web_fetch 权限：未声明时 fetch 拒绝', async () => {
    const api = createExtensionApi('tool', 'no-net', []);
    await assert.rejects(() => api.fetch('https://example.com'), /未声明 web_fetch/);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ 7. notifyToolsChanged 通知链══════════════════════════════════');

  await checkAsync('onToolsChanged 监听 + notifyToolsChanged 通知', async () => {
    let notified = false;
    const off = onToolsChanged(() => { notified = true; });
    notifyToolsChanged('test');
    assert.equal(notified, true, '应收到通知');
    off();
    notified = false;
    notifyToolsChanged('test2');
    assert.equal(notified, false, '取消后不应再收到');
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n══ 8. 越界反例矩阵（每类一个必须被拒的包）══════════════════════');

  const adversarial = [
    { name: 'tool 包带 hooks',        type: 'tool',         exports: { setup: () => {}, hooks: { 'message.received': () => {} } } },
    { name: 'tool 包带 providers',    type: 'tool',         exports: { setup: () => {}, providers: { 'a.b': () => 1 } } },
    { name: 'knowledge 包有 entry',  type: 'knowledge',    exports: { setup: () => {} } },
    { name: 'mcp 包有 JS 导出',       type: 'mcp',          exports: { hooks: {} } },
    { name: 'skill 包有 ESM 导出',    type: 'skill',        exports: { setup: () => {} } },
    { name: 'promptinject 出 setup', type: 'promptinject',  exports: { meta: {}, append: () => '', setup: () => {} } }
  ];
  for (const adv of adversarial) {
    check(`反例：${adv.name} → 必须被拒`, () => {
      const r = validateExports(adv.type, adv.exports);
      assert.equal(r.ok, false, `应被拒绝但通过了：${r.violations}`);
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  console.log(`\n══ 总结：通过 ${pass} / 失败 ${fail} ══════════════════════════════════════════`);
  if (fail > 0) {
    console.log('\n失败项：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\n全部通过 ✅');
  }
}

main().catch((e) => {
  console.error('测试运行失败：', e);
  process.exitCode = 1;
});
