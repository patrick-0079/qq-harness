// 技能降级执行测试（无容器后端）：白名单、语言、路径、逃逸、超时、注册表。
//
// 只测降级路径（worker + vm 沙箱）。容器后端由后续插件接入，这里明确断言
// isContainerAvailable() === false，确保测的是降级分支。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

process.env.QQ_AGENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-skill-'));

let pass = 0, fail = 0;
const failures = [];
function ok(n, e = '') { pass++; console.log(`  ✓ ${n}${e ? ` —— ${e}` : ''}`); }
function bad(n, d) { fail++; failures.push(n); console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
async function check(n, fn) { try { await fn(); ok(n); } catch (e) { bad(n, e.message); } }

function makeSkill() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-pkg-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'hi.js'),
    'module.exports = async ({ args }) => ({ content: "hi " + (args.name || "") });', 'utf8');
  fs.writeFileSync(path.join(dir, 'scripts', 'boom.js'),
    'module.exports = async () => { throw new Error("炸了"); };', 'utf8');
  fs.writeFileSync(path.join(dir, 'scripts', 'loop.js'), 'while (true) {}', 'utf8');
  fs.writeFileSync(path.join(dir, 'scripts', 'hang.js'), 'module.exports = () => new Promise(() => {});', 'utf8');
  fs.writeFileSync(path.join(dir, 'scripts', 'escape.js'),
    'module.exports = async () => ({ content: String(typeof require) + "/" + String(typeof process) + "/" + String(typeof fetch) });', 'utf8');
  return dir;
}

async function main() {
  const sb = await import('../src/sandbox/index.js');

  const dir = makeSkill();
  sb.clearSkillScripts();
  sb.registerSkillScripts('demo', {
    dir,
    scripts: [
      { path: 'scripts/hi.js' }, { path: 'scripts/boom.js' },
      { path: 'scripts/loop.js' }, { path: 'scripts/hang.js' },
      { path: 'scripts/escape.js' }
    ]
  });

  await check('容器后端未接入 → 走降级路径', () => {
    assert.equal(sb.isContainerAvailable(), false);
  });

  await check('正常执行：args 透传', async () => {
    const r = sb.resolveScript({ skillId: 'demo', script: 'scripts/hi.js' });
    assert.equal(r.ok, true, r.error);
    const out = await sb.runSkillScript({ source: r.source, abs: r.abs, args: { name: '小明' }, timeoutMs: 3000 });
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.content, 'hi 小明');
    assert.equal(out.backend, 'sandbox');
  });

  await check('未声明脚本被拒绝', () => {
    const r = sb.resolveScript({ skillId: 'demo', script: 'scripts/evil.js' });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('未在 skill.json'));
  });

  await check('路径穿越被拒绝', () => {
    assert.equal(sb.resolveScript({ skillId: 'demo', script: '../etc/passwd' }).ok, false);
    assert.equal(sb.resolveScript({ skillId: 'demo', script: '/etc/passwd' }).ok, false);
  });

  await check('非 js 语言在降级后端被拒绝', () => {
    const r = sb.resolveScript({ skillId: 'demo', script: 'scripts/hi.js', lang: 'python' });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes('只支持 js'));
  });

  await check('未知技能被拒绝', () => {
    assert.equal(sb.resolveScript({ skillId: 'nope', script: 'scripts/hi.js' }).ok, false);
  });

  await check('脚本抛错 → ok:false + 错误摘要', async () => {
    const r = sb.resolveScript({ skillId: 'demo', script: 'scripts/boom.js' });
    const out = await sb.runSkillScript({ source: r.source, abs: r.abs, timeoutMs: 3000 });
    assert.equal(out.ok, false);
    assert.ok(String(out.error).includes('炸了'));
  });

  await check('沙箱内没有 require/process/fetch', async () => {
    const r = sb.resolveScript({ skillId: 'demo', script: 'scripts/escape.js' });
    const out = await sb.runSkillScript({ source: r.source, abs: r.abs, timeoutMs: 3000 });
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.content, 'undefined/undefined/undefined');
  });

  await check('同步死循环 → 超时终止', async () => {
    const r = sb.resolveScript({ skillId: 'demo', script: 'scripts/loop.js' });
    const t0 = Date.now();
    const out = await sb.runSkillScript({ source: r.source, abs: r.abs, timeoutMs: 600 });
    const ms = Date.now() - t0;
    assert.equal(out.ok, false, '应超时失败');
    assert.ok(ms < 6000, `应在数秒内返回（实际 ${ms}ms）`);
  });

  await check('异步挂死 → 宿主 terminate', async () => {
    const r = sb.resolveScript({ skillId: 'demo', script: 'scripts/hang.js' });
    const t0 = Date.now();
    const out = await sb.runSkillScript({ source: r.source, abs: r.abs, timeoutMs: 600 });
    const ms = Date.now() - t0;
    assert.equal(out.ok, false);
    assert.ok(ms < 6000, `应在数秒内返回（实际 ${ms}ms）`);
  });

  await check('注册表：注销后不可用', () => {
    sb.unregisterSkillScripts('demo');
    assert.equal(sb.resolveScript({ skillId: 'demo', script: 'scripts/hi.js' }).ok, false);
  });

  console.log(`\n══ 总结：通过 ${pass} / 失败 ${fail} ══════════════════════════════════════════`);
  if (fail) { for (const f of failures) console.log(`  - ${f}`); process.exitCode = 1; }
  else console.log('\n全部通过 ✅');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
