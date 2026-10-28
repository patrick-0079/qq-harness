// Keep the vendored reference immutable. Only the environment boundary adds
// AbortSignal ownership and container language dispatch.
export function adaptSkillSandbox(source) {
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error('技能执行器适配锚点变化：' + before.slice(0, 60));
    source = source.replace(before, after);
  };
  replace("if (wantLang !== 'js')", "if (wantLang !== 'js' && !containerBackend)");
  replace("if (entry.lang !== 'js')", "if (entry.lang !== 'js' && !containerBackend)");
  replace("if (!DOC_EXT.has(path.extname(rel).toLowerCase()))", "if (!containerBackend && !DOC_EXT.has(path.extname(rel).toLowerCase()))");
  replace('// 路径必须落在技能目录内（含符号链接解析）', `if (wantLang !== entry.lang) return { ok: false, error: '脚本语言与清单不匹配' };
  if (!['js','python','py','sh','bash'].includes(entry.lang)) return { ok: false, error: '不支持的脚本语言' };
  // 路径必须落在技能目录内（含符号链接解析）`);
  replace('if (timer) clearTimeout(timer);', "if (timer) clearTimeout(timer);\n      job.signal?.removeEventListener('abort', abort);");
  replace('    try {\n      worker = new Worker', `    const abort = () => finish({ ok: false, cancelled: true, error: '技能执行已取消' });
    if (job.signal?.aborted) { abort(); return; }
    job.signal?.addEventListener('abort', abort, { once: true });
    try {
      worker = new Worker`);
  replace('export async function runSkillScript(job) {', `export async function runSkillScript(job) {
  job.signal?.throwIfAborted();`);
  replace('  const hardLimitMs =', `  if ((job.entry?.lang ?? job.lang ?? 'js') !== 'js') return { ok: false, backend: 'sandbox', error: '当前会话没有可用容器，降级后端只支持 js', logs: [], durationMs: 0 };
  const hardLimitMs =`);
  // The worker already has a hard termination timer. Clear this outer guard too,
  // otherwise every successful call leaves a dormant timeout behind.
  replace('  const hard = new Promise', '  let hardTimer;\n  const hard = new Promise');
  replace('    const t = setTimeout', '    const t = hardTimer = setTimeout');
  replace('  const out = await Promise.race([runInSandbox(job), hard]);', '  let out;\n  try { out = await Promise.race([runInSandbox(job), hard]); } finally { clearTimeout(hardTimer); }');
  return source;
}
