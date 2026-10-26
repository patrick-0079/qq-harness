// 文档仓库：扩展文档与知识库原文的统一索引。
//
// 用途：
//   1. load_doc(docId) 工具从这里取正文（工具文档 / 知识 L3 原文 / 技能说明）
//   2. 工具目录与知识 L0/L1 注入从这里取简介
//
// 分层（知识库）：
//   L0 KB 摘要  → L1 模块简介 → L2 文档简介 → L3 原文
// 工具/技能文档只需一层：{ id, title, summary, content }
//
// 约束：
//   · 只读 md/txt；二进制不入库
//   · 单文档正文上限 200KB（超出截断并标记）
//   · docId 全局唯一，重复登记以先登记为准（避免扩展互相覆盖）

const MAX_DOC_BYTES = 200 * 1024;

export class DocRegistry {
  constructor() {
    this.docs = new Map();       // docId -> { id, title, summary, layer, ownerId, contentPath, content }
    this.kbs = new Map();        // kbId -> { id, title, summary, scope, modules: [{id,title,intro,docIds}] }
  }

  /**
   * 登记一篇文档。
   * @param {object} doc { id, title, summary, layer?: 'L2'|'L3'|'tool'|'skill', ownerId, content, path }
   */
  register(doc) {
    const id = String(doc?.id || '').trim();
    if (!id) return { ok: false, error: '文档缺少 id' };
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/.test(id)) {
      return { ok: false, error: `文档 id 非法：${id}` };
    }
    if (this.docs.has(id)) {
      return { ok: false, error: `文档 id 已存在：${id}（先登记者优先）` };
    }
    let content = typeof doc.content === 'string' ? doc.content : '';
    let truncated = false;
    if (content.length > MAX_DOC_BYTES) {
      content = content.slice(0, MAX_DOC_BYTES);
      truncated = true;
    }
    this.docs.set(id, {
      id,
      title: String(doc.title || id),
      summary: String(doc.summary || '').slice(0, 500),
      // 摘要来源：user（清单提供且合法）/ llm / extractive / invalid / missing
      summarySource: String(doc.summarySource || 'user'),
      layer: String(doc.layer || 'L3'),
      ownerId: String(doc.ownerId || ''),
      path: doc.path ? String(doc.path) : '',
      content,
      truncated
    });
    return { ok: true };
  }

  /** 登记一本知识库（L0 + L1）。 */
  registerKb(kb) {
    const id = String(kb?.id || '').trim();
    if (!id) return { ok: false, error: '知识库缺少 id' };
    this.kbs.set(id, {
      id,
      title: String(kb.title || id),
      summary: String(kb.summary || '').slice(0, 1000),
      summarySource: String(kb.summarySource || 'user'),
      scope: kb.scope === 'session' ? 'session' : 'global',
      ownerId: String(kb.ownerId || ''),
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
      if (d.ownerId === oid) { this.docs.delete(id); removed.docs.push(id); }
    }
    for (const [id, kb] of this.kbs) {
      if (kb.ownerId === oid) { this.kbs.delete(id); removed.kbs.push(id); }
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
    if (!doc) return { ok: false, error: `未找到文档：${id}` };
    return { ok: true, doc };
  }

  /** 批量取简介（供提示词注入，L0/L1 预算控制）。 */
  summaries({ maxKbs = 6, maxModulesPerKb = 12, maxChars = 3000 } = {}) {
    const lines = [];
    let used = 0;
    for (const kb of [...this.kbs.values()].slice(0, maxKbs)) {
      const head = `· ${kb.title}${kb.summary ? `：${kb.summary}` : ''}`;
      if (used + head.length > maxChars) break;
      lines.push(head);
      used += head.length;
      for (const m of kb.modules.slice(0, maxModulesPerKb)) {
        const line = `  - ${m.title}${m.intro ? `：${m.intro}` : ''}${m.docIds?.length ? `（文档：${m.docIds.join('、')}）` : ''}`;
        if (used + line.length > maxChars) break;
        lines.push(line);
        used += line.length;
      }
    }
    return lines.join('\n');
  }

  clear() {
    this.docs.clear();
    this.kbs.clear();
  }

  // ── 摘要写入（供管理器后台生成后回填）────────────────────────────────

  /** 更新某文档的 L2 摘要与来源。 */
  setDocSummary(docId, { summary, source = 'llm' } = {}) {
    const d = this.docs.get(String(docId));
    if (!d) return false;
    d.summary = String(summary || '').slice(0, 500);
    d.summarySource = String(source);
    return true;
  }

  /** 更新某知识库的 L0 摘要与来源。 */
  setKbSummary(kbId, { summary, source = 'llm' } = {}) {
    const kb = this.kbs.get(String(kbId));
    if (!kb) return false;
    kb.summary = String(summary || '').slice(0, 1000);
    kb.summarySource = String(source);
    return true;
  }

  /** 更新某模块的 L1 简介与来源。 */
  setModuleIntro(kbId, moduleId, { intro, source = 'llm' } = {}) {
    const kb = this.kbs.get(String(kbId));
    if (!kb) return false;
    const m = (kb.modules || []).find((x) => String(x.id) === String(moduleId));
    if (!m) return false;
    m.intro = String(intro || '').slice(0, 500);
    m.introSource = String(source);
    return true;
  }

  /** 摘要来源分布（UI 用）。 */
  summaryStats() {
    const out = { user: 0, llm: 0, extractive: 0, invalid: 0, missing: 0, total: 0 };
    const bump = (s) => { if (out[s] !== undefined) out[s] += 1; };
    for (const d of this.docs.values()) {
      if (d.layer !== 'L3') continue;
      out.total += 1;
      bump(d.summarySource || 'user');
    }
    for (const kb of this.kbs.values()) {
      out.total += 1;
      bump(kb.summarySource || 'user');
      for (const m of kb.modules || []) {
        out.total += 1;
        bump(m.introSource || 'user');
      }
    }
    return out;
  }
}

export const docRegistry = new DocRegistry();
