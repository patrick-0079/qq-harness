// 知识库目录树测试：扫描、.summery 镜像命名、比例限长、已有摘要复用、链接校验。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

process.env.QQ_AGENT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-tree-'));

let pass = 0, fail = 0;
const failures = [];
function ok(n, e = '') { pass++; console.log(`  ✓ ${n}${e ? ` —— ${e}` : ''}`); }
function bad(n, d) { fail++; failures.push(n); console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
async function check(n, fn) { try { await fn(); ok(n); } catch (e) { bad(n, e.message); } }

function buildLib() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-lib-'));
  const A = path.join(root, 'A');
  fs.mkdirSync(path.join(A, 'C', 'D'), { recursive: true });
  fs.writeFileSync(path.join(A, '1.md'), '# 一\n\n第一篇文档的正文，讲安装与初始化流程。'.repeat(20), 'utf8');
  fs.writeFileSync(path.join(A, 'b.md'), '# B\n\n第二篇文档，讲配置项与默认值。'.repeat(20), 'utf8');
  fs.writeFileSync(path.join(A, 'C', 'd.md'), '# D\n\n模块 C 里的文档，讲子模块用法。'.repeat(20), 'utf8');
  fs.writeFileSync(path.join(A, 'C', 'D', 'aaa.md'), '# AAA\n\n最深层文档，讲边界情况。'.repeat(20), 'utf8');
  return { root, A };
}

async function main() {
  const { scanKnowledgeTree, summaryAbsFor, treeStats, childLinksFor } = await import('../src/knowledge/tree.js');
  const { ensureSummaries } = await import('../src/knowledge/ensure.js');
  const { summaryCap, validateSummaryLinks, validateSummaryText } = await import('../src/knowledge/validate.js');

  const { root, A } = buildLib();
  const tree = scanKnowledgeTree(A);

  await check('扫描：文件夹=模块，文件=文档', () => {
    const st = treeStats(tree);
    assert.equal(st.docs, 4, `文档数应为 4，实际 ${st.docs}`);
    assert.equal(st.dirs, 3, `目录数应为 3（A/C/D），实际 ${st.dirs}`);
    const names = (tree.children || []).map((c) => `${c.kind}:${c.name}`);
    assert.deepEqual(names, ['dir:C', 'doc:1.md', 'doc:b.md']);
  });

  await check('.summery 镜像命名符合约定', () => {
    const c = tree.children.find((x) => x.name === 'C');
    const d = c.children.find((x) => x.name === 'd.md');
    const D = c.children.find((x) => x.name === 'D');
    assert.equal(summaryAbsFor(A, tree), path.join(A, '.summery', '.summery'));
    assert.equal(summaryAbsFor(A, c), path.join(A, '.summery', 'C.summery'));
    assert.equal(summaryAbsFor(A, d), path.join(A, '.summery', 'C', 'd.md.summery'));
    assert.equal(summaryAbsFor(A, D), path.join(A, '.summery', 'C', 'D.summery'));
  });

  await check('子级链接是相对路径且指向 .summery', () => {
    const links = childLinksFor(A, tree.children.find((x) => x.name === 'C'));
    assert.ok(links.length >= 2);
    for (const l of links) {
      assert.ok(!l.href.startsWith('/'), `不应是绝对路径：${l.href}`);
      assert.ok(l.href.endsWith('.summery'), `应指向摘要文件：${l.href}`);
    }
  });

  const first = await ensureSummaries(A, tree, { useLlm: false, writeFiles: true, log: () => {} });

  await check('生成完整镜像（含库根 .summery/.summery）', () => {
    const need = ['.summery', '1.md.summery', 'b.md.summery', 'C.summery',
      'C/d.md.summery', 'C/D.summery', 'C/D/aaa.md.summery'];
    for (const rel of need) {
      assert.ok(fs.existsSync(path.join(A, '.summery', rel)), `缺少 ${rel}`);
    }
    assert.equal(first.stats.extractive + first.stats.llm + first.stats.user, 7);
  });

  await check('摘要长度不超过源文 10%（含地板）', () => {
    const doc = tree.children.find((x) => x.name === '1.md');
    const text = fs.readFileSync(summaryAbsFor(A, doc), 'utf8');
    const srcLen = fs.readFileSync(doc.abs, 'utf8').length;
    assert.ok(Array.from(text).length <= summaryCap(srcLen, 'L2'), '文档摘要超限');
    assert.ok(validateSummaryText(text, 'L2', { title: doc.name, sourceLength: srcLen, requireLinks: 1 }).ok);
  });

  await check('摘要内链接都能解析到包内文件', () => {
    const c = tree.children.find((x) => x.name === 'C');
    const abs = summaryAbsFor(A, c);
    const md = fs.readFileSync(abs, 'utf8');
    const r = validateSummaryLinks(md, {
      dir: A, fsExists: (p) => fs.existsSync(p),
      baseDir: path.relative(A, path.dirname(abs)) || '.'
    });
    assert.equal(r.ok, true, r.violations.join('；'));
    assert.ok(r.resolved.length >= 1, '模块摘要应至少有一个子级链接');
  });

  await check('已有合法摘要 → 直接复用（source=user，不覆盖）', async () => {
    const target = summaryAbsFor(A, tree.children.find((x) => x.name === 'b.md'));
    const before = fs.readFileSync(target, 'utf8');
    const r2 = await ensureSummaries(A, tree, { useLlm: false, writeFiles: true, log: () => {} });
    assert.ok(r2.stats.user >= 1, '应识别出已有摘要');
    assert.equal(fs.readFileSync(target, 'utf8'), before, '合法摘要不应被覆盖');
  });

  await check('非法摘要（超长）→ 重新生成', async () => {
    const doc = tree.children.find((x) => x.name === 'b.md');
    const target = summaryAbsFor(A, doc);
    fs.writeFileSync(target, 'X'.repeat(99999), 'utf8');
    const r3 = await ensureSummaries(A, tree, { useLlm: false, writeFiles: true, log: () => {} });
    const after = fs.readFileSync(target, 'utf8');
    assert.ok(after.length < 99999, '超长摘要应被重写');
    assert.ok(after.includes('[') || after.includes('#'), '应重写为 Markdown 导航');
  });

  await check('writeFiles=false 时不落盘', async () => {
    const { A: A2 } = buildLib();
    const t2 = scanKnowledgeTree(A2);
    await ensureSummaries(A2, t2, { useLlm: false, writeFiles: false, log: () => {} });
    assert.equal(fs.existsSync(path.join(A2, '.summery')), false, '不应创建 .summery');
  });

  console.log(`\n══ 总结：通过 ${pass} / 失败 ${fail} ══════════════════════════════════════════`);
  if (fail) { for (const f of failures) console.log(`  - ${f}`); process.exitCode = 1; }
  else console.log('\n全部通过 ✅');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
