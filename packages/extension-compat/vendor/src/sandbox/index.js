// 技能脚本执行：降级后端（worker + vm 沙箱）+ 脚本注册表。
//
// 本文件只实现「没有容器时」的执行路径：
//   · 每次调用独立 worker（可硬超时终止、崩溃隔离）
//   · worker 内 vm 上下文，只注入 module/exports/args/argv/api
//   · 无 require / import / process / fetch；禁 eval 与 new Function
//
// 容器后端（后续由独立插件接入）走 registerContainerBackend()：
//   注册后 isContainerAvailable() 为真，runSkillScript 会优先用它；
//   没注册时一律降级到本文件的沙箱路径 —— 这正是「降级运行」的语义。
//
// 定位：能力沙箱（防误用/防卡死），不是对抗恶意代码的安全边界。

import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';

const DOC_EXT = new Set(['.js']);

// ── 容器后端接口（由容器插件注册）────────────────────────────────────────
// { run(job), available(job), probe(context) }：
//   available/ probe 表达“本会话/全局是否允许并具备容器条件”；
//   run 只在可用时调用，失败不回退（避免“以为在容器里跑”）。
let containerBackend = null;

/** 注册容器后端；没有 run 的后端视为无效。 */
export function registerContainerBackend(backend) {
  containerBackend = backend && typeof backend.run === 'function' ? backend : null;
}

/** 容器后端是否可用（未注册 = 不可用 → 降级）。 */
export function isContainerAvailable(context = {}) {
  if (!containerBackend) return false;
  try {
    if (typeof containerBackend.probe === 'function') {
      const r = containerBackend.probe(context);
      return r?.ok !== false;
    }
  } catch { return false; }
  return true;
}

// ── 脚本注册表（由 ext-skill 管理器填充）──────────────────────────────────
const scripts = new Map();   // skillId -> { dir, scripts: [{ path, lang, description, docId }] }

/**
 * 登记一个技能包的可执行脚本（白名单）。
 * @param {string} skillId
 * @param {{dir: string, scripts: Array<{path: string, lang?: string, description?: string}>}} pkg
 */
export function registerSkillScripts(skillId, pkg) {
  const list = (Array.isArray(pkg?.scripts) ? pkg.scripts : [])
    .map((s) => ({
      path: String(s?.path || '').replace(/\\/g, '/'),
      lang: String(s?.lang || 'js').toLowerCase(),
      description: String(s?.description || ''),
      docId: s?.docId ? String(s.docId) : ''
    }))
    .filter((s) => s.path);
  scripts.set(String(skillId), { dir: String(pkg?.dir || ''), scripts: list });
  return list.length;
}

export function unregisterSkillScripts(skillId) {
  return scripts.delete(String(skillId));
}

export function clearSkillScripts() {
  scripts.clear();
}

export function getSkillPackage(skillId) {
  return scripts.get(String(skillId)) || null;
}

export function listSkillPackages() {
  return [...scripts.entries()].map(([id, v]) => ({ id, dir: v.dir, scripts: v.scripts }));
}

/**
 * 解析并校验一次脚本调用。
 * @returns {{ ok: true, abs: string, source: string, entry: object } | { ok: false, error: string }}
 */
export function resolveScript({ skillId, script, lang = 'js' }) {
  const pkg = getSkillPackage(skillId);
  if (!pkg) return { ok: false, error: `未知技能：${skillId}（未加载或未启用）` };

  const wantLang = String(lang || 'js').toLowerCase();
  if (wantLang !== 'js') {
    return { ok: false, error: `降级后端只支持 js（当前 ${wantLang}）；需要其它语言请接入容器后端` };
  }

  const rel = String(script || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const entry = pkg.scripts.find((s) => s.path === rel);
  if (!entry) {
    const avail = pkg.scripts.map((s) => s.path).slice(0, 10);
    return { ok: false, error: `脚本未在 skill.json 的 scripts[] 中声明：${rel}${avail.length ? `（可用：${avail.join('、')}）` : ''}` };
  }
  if (entry.lang !== 'js') return { ok: false, error: `该脚本语言为 ${entry.lang}，降级后端只支持 js` };
  if (!DOC_EXT.has(path.extname(rel).toLowerCase())) return { ok: false, error: `只允许 .js 脚本：${rel}` };

  // 路径必须落在技能目录内（含符号链接解析）
  const abs = path.resolve(pkg.dir, rel);
  const relToDir = path.relative(pkg.dir, abs);
  if (!relToDir || relToDir.startsWith('..') || path.isAbsolute(relToDir)) {
    return { ok: false, error: `脚本路径越界：${rel}` };
  }
  try {
    const realDir = fs.realpathSync(pkg.dir);
    const realAbs = fs.realpathSync(abs);
    const relReal = path.relative(realDir, realAbs);
    if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
      return { ok: false, error: `脚本经符号链接越界：${rel}` };
    }
  } catch { /* 文件不存在在下面统一报 */ }

  if (!fs.existsSync(abs)) return { ok: false, error: `脚本不存在：${rel}` };
  let source = '';
  try { source = fs.readFileSync(abs, 'utf8'); } catch (e) { return { ok: false, error: `读取失败：${e?.message ?? e}` }; }
  if (source.length > 256 * 1024) return { ok: false, error: '脚本超过 256KB 上限' };

  return { ok: true, abs, source, entry, dir: pkg.dir };
}

// ── worker 内的运行器（内联源码，避免额外文件被当成扩展扫描）──────────────
const RUNNER_SOURCE = String.raw`
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

/**
 * 运行一次脚本（降级后端 = worker + vm）。
 *
 * @param {object} job { source, abs, args, argv, timeoutMs, memoryMb }
 * @returns {Promise<{ ok: boolean, result?: any, error?: string, logs: string[], backend: string, durationMs: number }>}
 */
export async function runInSandbox(job) {
  const startedAt = Date.now();
  const timeoutMs = Math.max(200, Number(job.timeoutMs) || 5000);
  const memoryMb = Math.min(256, Math.max(16, Number(job.memoryMb) || 64));

  return await new Promise((resolve) => {
    let settled = false;
    let worker = null;
    let timer = null;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { worker?.terminate(); } catch { /* ignore */ }
      resolve({
        ...payload,
        logs: Array.isArray(payload.logs) ? payload.logs : [],
        backend: 'sandbox',
        durationMs: Date.now() - startedAt
      });
    };

    try {
      worker = new Worker(RUNNER_SOURCE, {
        eval: true,
        workerData: {
          source: job.source,
          args: job.args || {},
          argv: Array.isArray(job.argv) ? job.argv : [],
          filename: job.abs || 'skill-script.js',
          timeoutMs
        },
        resourceLimits: { maxOldGenerationSizeMb: memoryMb }
      });
    } catch (error) {
      finish({ ok: false, error: `无法启动脚本沙箱：${error?.message ?? error}` });
      return;
    }

    // 宿主侧兜底：vm 的 timeout 只打断同步执行，异步挂死靠 terminate
    timer = setTimeout(() => finish({ ok: false, error: `脚本执行超时（${timeoutMs}ms）` }), timeoutMs + 1500);

    worker.once('message', (msg) => finish(msg));
    worker.once('error', (error) => finish({ ok: false, error: `脚本进程崩溃：${error?.message ?? error}` }));
    worker.once('exit', (code) => { if (code !== 0) finish({ ok: false, error: `脚本进程退出（code ${code}）` }); });
  });
}

/**
 * 统一入口：有容器用容器，否则降级到沙箱。
 *
 * @returns {Promise<object>} 与 runInSandbox 同形，额外带 backend 字段
 */
export async function runSkillScript(job) {
  let degrade = null;
  if (containerBackend) {
    let available = { ok: true };
    try {
      available = typeof containerBackend.available === 'function'
        ? await containerBackend.available(job)
        : { ok: true };
    } catch (error) {
      available = { ok: false, reason: String(error?.message ?? error) };
    }
    if (available?.ok === false) {
      degrade = { from: 'container', reason: String(available.reason || '容器不可用') };
    } else {
      try {
        const out = await containerBackend.run(job);
        return { ...out, backend: out?.backend || 'container' };
      } catch (error) {
        // 容器失败不静默降级到沙箱（避免“以为在容器里跑”），明确报错
        return { ok: false, error: `容器后端失败：${error?.message ?? error}`, logs: [], backend: 'container', durationMs: 0 };
      }
    }
  }
  const hardLimitMs = Math.max(1000, Number(job.timeoutMs) || 5000) + 3000;
  const hard = new Promise((resolve) => {
    const t = setTimeout(() => resolve({
      ok: false, error: `脚本执行超时（硬上限 ${hardLimitMs}ms）`,
      logs: [], backend: 'sandbox', durationMs: hardLimitMs
    }), hardLimitMs);
    t.unref?.();
  });
  const out = await Promise.race([runInSandbox(job), hard]);
  return degrade
    ? { ...out, degradedFrom: degrade.from, degradeReason: degrade.reason }
    : out;
}
