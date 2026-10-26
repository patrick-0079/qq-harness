// UI 扩展点契约测试：插槽目录、贡献校验、排序、净化、会话过滤、UI 动作。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

process.env.QQ_AGENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-ui-'));

let pass = 0, fail = 0;
const failures = [];
function ok(name, extra = '') { pass++; console.log(`  ✓ ${name}${extra ? ` —— ${extra}` : ''}`); }
function bad(name, detail) { fail++; failures.push(name); console.log(`  ✗ ${name}`); if (detail) console.log(`      ${detail}`); }
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e.message); } }

async function main() {
  const {
    UI_SLOTS, UI_SLOT_API_VERSION, DECLARATIVE_TYPES,
    sanitizePayload, validateContribution,
    UIExtensionRegistry
  } = await import('../src/extensions/ui-registry.js');

  // ═══════════════════════════════════════════════════════════════
  console.log('\n══ 1. 插槽目录 ═══════════════════════════════════════════════');

  await check('插槽目录有唯一 id、页面、允许类型', () => {
    const ids = Object.keys(UI_SLOTS);
    assert.ok(ids.length >= 6, `至少 6 个插槽（实际 ${ids.length}）`);
    for (const [id, slot] of Object.entries(UI_SLOTS)) {
      assert.ok(slot.page, `${id} 缺 page`);
      assert.ok(Array.isArray(slot.allowedKinds) && slot.allowedKinds.length > 0, `${id} 缺 allowedKinds`);
      assert.equal(typeof slot.allowReplace, 'boolean', `${id} 缺 allowReplace`);
      assert.ok(Number(slot.maxItems) > 0, `${id} 缺 maxItems`);
      for (const k of slot.allowedKinds) {
        assert.ok(['declarative', 'module'].includes(k), `${id} 的 kind 非法：${k}`);
      }
    }
    assert.equal(UI_SLOT_API_VERSION, 1);
  });

  await check('默认不允许整页替换（allowReplace=false）', () => {
    for (const [id, slot] of Object.entries(UI_SLOTS)) {
      assert.equal(slot.allowReplace, false, `${id} 初版不应允许替换`);
    }
  });

  await check('扩展仓库卡片插槽只接受声明式（不含 module）', () => {
    const slot = UI_SLOTS['page.extensions.repository.card-actions'];
    assert.deepEqual(slot.allowedKinds, ['declarative']);
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n══ 2. 声明式 payload 净化 ════════════════════════════════════');

  await check('白名单组件类型齐备', () => {
    for (const t of ['text', 'badge', 'card', 'metric', 'list', 'table', 'form', 'button', 'menuItem', 'link', 'divider']) {
      assert.ok(DECLARATIVE_TYPES.has(t), `缺组件 ${t}`);
    }
  });

  await check('超长字符串被截断（4000 上限）', () => {
    const r = sanitizePayload('x'.repeat(10000));
    assert.equal(r.ok, true);
    assert.equal(r.payload.length, 4000);
  });

  await check('数组超限被截断（100 上限）', () => {
    const r = sanitizePayload(new Array(500).fill('a'));
    assert.equal(r.ok, true);
    assert.equal(r.payload.length, 100);
  });

  await check('原型污染键被剔除', () => {
    const evil = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
    const r = sanitizePayload(evil);
    assert.equal(r.ok, true);
    assert.equal(r.payload.safe, 1);
    assert.equal(Object.prototype.polluted, undefined, '不应污染原型');
  });

  await check('嵌套过深被拒绝', () => {
    let deep = { v: 1 };
    for (let i = 0; i < 10; i++) deep = { child: deep };
    const r = sanitizePayload(deep);
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('嵌套'));
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n══ 3. 贡献校验 ═══════════════════════════════════════════════');

  const good = {
    ownerId: 'my-ext', id: 'card1', point: 'page.usage.summary.cards',
    kind: 'declarative',
    payload: { type: 'metric', title: '测试指标', value: '42' }
  };

  await check('合法声明式贡献通过', () => {
    const r = validateContribution(good);
    assert.equal(r.ok, true, r.violations.join('；'));
  });

  await check('未知插槽被拒绝', () => {
    const r = validateContribution({ ...good, point: 'page.nowhere.foo' });
    assert.equal(r.ok, false);
    assert.ok(r.violations.some((v) => v.includes('未知插槽')));
  });

  await check('组件类型不在白名单被拒绝（不允许任意 HTML）', () => {
    const r = validateContribution({ ...good, payload: { type: 'rawHtml', html: '<script>alert(1)</script>' } });
    assert.equal(r.ok, false);
    assert.ok(r.violations.some((v) => v.includes('白名单')));
  });

  await check('第三方 module 贡献被拒绝（只有内置可信可挂脚本）', () => {
    const r = validateContribution({
      ownerId: 'third-party', id: 'm1', point: 'shell.nav.primary',
      kind: 'module', entry: 'ui/index.js'
    }, { isTrustedPlugin: false });
    assert.equal(r.ok, false);
    assert.ok(r.violations.some((v) => v.includes('内置可信')));
  });

  await check('内置可信插件的 module 贡献通过', () => {
    const r = validateContribution({
      ownerId: 'ext-mcp', id: 'm1', point: 'shell.nav.primary',
      kind: 'module', entry: 'ui/index.js'
    }, { isTrustedPlugin: true });
    assert.equal(r.ok, true, r.violations.join('；'));
  });

  await check('插槽不允许的 kind 被拒绝（card-actions 不接受 module）', () => {
    const r = validateContribution({
      ownerId: 'ext-a', id: 'x', point: 'page.extensions.repository.card-actions',
      kind: 'module', entry: 'ui/x.js'
    }, { isTrustedPlugin: true });
    assert.equal(r.ok, false);
  });

  await check('插槽 API 版本不匹配被拒绝', () => {
    const r = validateContribution({ ...good, apiVersion: 99 });
    assert.equal(r.ok, false);
    assert.ok(r.violations.some((v) => v.includes('版本不匹配')));
  });

  await check('缺 id / payload 被拒绝', () => {
    assert.equal(validateContribution({ ...good, id: '' }).ok, false);
    assert.equal(validateContribution({ ...good, payload: null }).ok, false);
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n══ 4. 注册表：排序 / 上限 / 注销 ══════════════════════════════');

  const reg = new UIExtensionRegistry();

  await check('按 order → priority → id 稳定排序', () => {
    reg.register({ ownerId: 'a', id: 'c', point: 'page.usage.summary.cards', order: 200, priority: 50, payload: { type: 'text', text: 'A' } });
    reg.register({ ownerId: 'a', id: 'a', point: 'page.usage.summary.cards', order: 100, priority: 50, payload: { type: 'text', text: 'B' } });
    reg.register({ ownerId: 'b', id: 'b', point: 'page.usage.summary.cards', order: 100, priority: 90, payload: { type: 'text', text: 'C' } });
    const list = reg.listBySlot('page.usage.summary.cards');
    assert.equal(list.length, 3);
    // order 100 的在前；同 order 下 priority 大的在前
    assert.equal(list[0].ownerId, 'b', '同 order 时高 priority 优先');
    assert.equal(list[1].id, 'a');
    assert.equal(list[2].id, 'c', 'order 200 排最后');
  });

  await check('超过 maxItems 的贡献被截断', () => {
    const r2 = new UIExtensionRegistry();
    for (let i = 0; i < 12; i++) {
      r2.register({ ownerId: 'x', id: `c${i}`, point: 'page.usage.summary.cards', order: i, payload: { type: 'text', text: String(i) } });
    }
    const list = r2.listBySlot('page.usage.summary.cards');
    assert.equal(list.length, UI_SLOTS['page.usage.summary.cards'].maxItems);
  });

  await check('unregisterByOwner 清掉该扩展的贡献与动作', () => {
    reg.registerAction({ ownerId: 'a', actionId: 'do', handler: async () => ({ ok: 1 }) });
    assert.equal(reg.hasAction('a', 'do'), true);
    reg.unregisterByOwner('a');
    assert.equal(reg.hasAction('a', 'do'), false);
    assert.equal(reg.listBySlot('page.usage.summary.cards').filter((c) => c.ownerId === 'a').length, 0);
  });

  await check('enabledOwners 过滤（会话级可见性）', () => {
    const r3 = new UIExtensionRegistry();
    r3.register({ ownerId: 'on', id: '1', point: 'shell.status.right', payload: { type: 'badge', text: 'ON' } });
    r3.register({ ownerId: 'off', id: '2', point: 'shell.status.right', payload: { type: 'badge', text: 'OFF' } });
    const visible = r3.listBySlot('shell.status.right', { enabledOwners: (id) => id === 'on' });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].ownerId, 'on');
  });

  await check('非法贡献注册返回错误而不抛异常', () => {
    const r4 = new UIExtensionRegistry();
    const r = r4.register({ ownerId: 'x', id: 'bad', point: 'nope', payload: { type: 'text' } });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('未知插槽'));
  });

  // ═══════════════════════════════════════════════════════════════
  console.log('\n══ 5. UI 动作 ════════════════════════════════════════════════');

  const reg2 = new UIExtensionRegistry();

  await check('登记并调用动作', async () => {
    reg2.registerAction({
      ownerId: 'ext-demo', actionId: 'ping',
      handler: async (args) => ({ pong: args?.x || 1 })
    });
    const r = await reg2.invokeAction('ext-demo', 'ping', { x: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.pong, 7);
  });

  await check('未知动作返回错误', async () => {
    const r = await reg2.invokeAction('ext-demo', 'nope', {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('未知 UI 动作'));
  });

  await check('动作抛错被隔离（不向外抛）', async () => {
    reg2.registerAction({ ownerId: 'ext-demo', actionId: 'boom', handler: async () => { throw new Error('炸了'); } });
    const r = await reg2.invokeAction('ext-demo', 'boom', {});
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('炸了'));
  });

  await check('动作返回值经净化（超长截断）', async () => {
    reg2.registerAction({ ownerId: 'ext-demo', actionId: 'long', handler: async () => ({ text: 'y'.repeat(9000) }) });
    const r = await reg2.invokeAction('ext-demo', 'long', {});
    assert.equal(r.ok, true);
    assert.equal(r.result.text.length, 4000);
  });

  await check('登记动作缺参时抛错（开发期错误）', () => {
    assert.throws(() => reg2.registerAction({ ownerId: '', actionId: 'x', handler: async () => ({}) }));
    assert.throws(() => reg2.registerAction({ ownerId: 'a', actionId: 'x' }));
  });

  // ═══════════════════════════════════════════════════════════════
  console.log(`\n══ 总结：通过 ${pass} / 失败 ${fail} ══════════════════════════════════════════`);
  if (fail > 0) {
    console.log('\n失败项：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\n全部通过 ✅');
  }
}

main().catch((e) => { console.error('测试运行失败：', e); process.exitCode = 1; });
