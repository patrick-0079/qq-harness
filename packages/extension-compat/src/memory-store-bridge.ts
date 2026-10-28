import { z } from 'zod';
import type { AccessService, ConfigService, MemoryService, StorageService } from '@qq-harness/domain';
import type { MemoryRecord } from '@qq-harness/contracts';
import type { LegacyObject } from './types.js';
const category = z.enum(['profile', 'event', 'task', 'summary']);
const fields = z.object({
  content: z.string().trim().min(1).max(500),
  evidence: z.string().trim().min(1).max(500),
  certainty: z.enum(['stated', 'inferred']).default('stated'),
  tags: z.array(z.string().max(24)).max(6).default([]),
  ttl_days: z.number().int().min(0).max(3650).optional(),
  status: z.enum(['active', 'done']).default('active'),
  source_message_id: z.string().default(''),
});
const item = fields.extend({
  category,
  key: z.string().trim().min(1).max(100),
  subject_qq: z.string().default('shared'),
});
export function nativeMemoryStore(deps: {
  memory: () => MemoryService;
  agent?: () => import('@qq-harness/contracts').MemoryAgentService;
  storage: StorageService;
  config: ConfigService;
  access: AccessService;
  chatKey: () => string;
}) {
  const contextScope = (ctx: LegacyObject) => {
    const chatKey = deps.chatKey();
    if (!/^(group|private):\d+$/.test(chatKey) || ctx.chatKey !== chatKey)
      throw Error('记忆操作必须绑定当前会话');
    deps.access.assert(chatKey);
    return {
      scope: chatKey,
      kind: chatKey.split(':')[0],
      subject: chatKey.startsWith('private:') ? chatKey.split(':')[1]! : 'shared',
    };
  };
  const meta = (record: MemoryRecord): LegacyObject => {
    for (const source of record.sources)
      if (source.noteId) {
        const note = deps
          .memory()
          .noteHistory(source.chatKey, source.noteId)
          .find((note) => note.revision === source.noteRevision);
        if (note?.text.startsWith('[legacy-long-memory]'))
          try {
            return JSON.parse(note.text.slice('[legacy-long-memory]'.length));
          } catch {
            /* Old notes remain readable without fabricated metadata. */
          }
      }
    return {
      category: 'profile',
      key: record.key,
      evidence: '',
      tags: [],
      certainty: record.confidence < 1 ? 'inferred' : 'stated',
      status: 'active',
    };
  };
  const publicRow = (record: MemoryRecord) => ({
    ...meta(record),
    id: record.id,
    revision: record.revision,
    subject_qq: record.personId ?? 'shared',
    content: record.text,
    tier: record.tier,
    created_at: new Date(record.createdAt).toISOString(),
    updated_at: new Date(record.updatedAt).toISOString(),
    expires_at: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
  });
  class MemoryStore {
    private max: number;
    constructor(_file: string, options: LegacyObject = {}) {
      this.max = options.maxPerScope ?? 2000;
    }
    async run(action: string, ctx: LegacyObject, args: LegacyObject = {}) {
      const identity = contextScope(ctx),
        chatKey = identity.scope,
        memory = deps.memory();
      if ('scope' in args || 'path' in args) throw Error('不接受模型指定 scope/path');
      const active = () => {
        const rank = { short: 0, medium: 1, long: 2 },
          heads = new Map<string, MemoryRecord>();
        for (const record of memory
          .list(chatKey)
          .filter((record) => record.chatKey === chatKey && record.status === 'active')
          .sort((a, b) => rank[a.tier] - rank[b.tier] || b.revision - a.revision)) {
          const key = record.factId ?? `${record.personId ?? ''}/${record.key}`;
          if (!heads.has(key)) heads.set(key, record);
        }
        return [...heads.values()];
      };
      const byId = (id: string) => {
        const record = active().find((record) => record.id === id);
        if (!record) throw Error('当前会话中没有这条有效记忆');
        return record;
      };
      const subject = (value: string) => {
        if (identity.kind === 'private') {
          if (value !== 'shared' && value !== identity.subject) throw Error('私聊只能维护当前聊天对象');
          return identity.subject;
        }
        if (!value || value === 'shared') return null;
        if (!/^\d+$/.test(value) || !deps.storage.hasSender(chatKey, value))
          throw Error('群聊成员必须来自当前会话的真实记录');
        return value;
      };
      const sources = (value: LegacyObject) => {
        const original = value.source_message_id
          ? deps.storage.messages(chatKey).find((m) => m.id === value.source_message_id)
          : undefined;
        if (value.source_message_id && !original) throw Error('引用的来源消息不属于当前会话');
        const note = memory.note(
          chatKey,
          '[legacy-long-memory]' + JSON.stringify(value),
          original ? [original.localId] : [],
        );
        return [{ chatKey, noteId: note.id, noteRevision: note.revision }];
      };
      if (deps.agent && ['save', 'update', 'forget'].includes(action)) {
        if (action === 'save')
          for (const value of z.array(item).min(1).max(2).parse(args.items)) subject(value.subject_qq);
        if (action === 'update') {
          fields.parse(args);
          const record = byId(String(args.id));
          if (record.revision !== args.revision) throw Error('记忆已变化，请重新读取最新 revision');
        }
        const ids =
          action === 'forget'
            ? z.array(z.string().uuid()).min(1).max(20).parse(args.ids)
            : action === 'update'
              ? [String(args.id)]
              : [];
        const sourceIds = (
          action === 'save' ? (args.items as LegacyObject[]) : action === 'update' ? [args] : []
        ).flatMap((value) => {
          if (!value.source_message_id) return [];
          const source = deps.storage.messages(chatKey).find((m) => m.id === value.source_message_id);
          if (!source) throw Error('引用的来源消息不属于当前会话');
          return [source.localId];
        });
        const task = deps
          .agent()
          .request({
            chatKey,
            instruction:
              (action === 'forget' ? '遗忘兼容记忆：' : '兼容扩展记忆申请（' + action + '）：') +
              JSON.stringify(args),
            targetIds: ids,
            sourceIds,
            origin: 'compatibility',
          });
        return {
          accepted: true,
          requestId: task.id,
          status: task.status,
          backend: 'memory-agent',
          notice: '已受理，尚未修改；请查询任务结果。',
        };
      }
      if (action === 'save') {
        const values = z.array(item).min(1).max(2).parse(args.items);
        const planned = values.map((value) => {
          const person = subject(value.subject_qq),
            key = 'legacy:' + value.category + ':' + value.key,
            prior = active().find((r) => r.personId === person && r.key === key);
          if (prior && prior.text !== value.content)
            throw Error(`已有同主题记忆 ${prior.id}，revision=${prior.revision}，请用 update 更正`);
          return { value, person, key, prior };
        });
        if (active().length + planned.filter((p) => !p.prior).length > this.max)
          throw Error('当前会话记忆达到上限，请先整理');
        return {
          backend: 'three-tier-memory',
          items: planned.map(({ value, person, key, prior }) => {
            if (prior) return { outcome: 'duplicate', memory: publicRow(prior) };
            const ttl = deps.config.effective(chatKey).memory.shortRetentionMs,
              requested = value.ttl_days ? value.ttl_days * 86400000 : ttl;
            const record = memory.remember({
              scope: person ? 'chat_person' : 'chat',
              tier: 'short',
              chatKey,
              personId: person,
              key,
              text: value.content,
              visibility: 'chat_only',
              sensitive: false,
              confidence: value.certainty === 'stated' ? 1 : 0.55,
              importance: 0.65,
              pinned: false,
              sources: sources(value),
              origin: 'agent',
              expiresAt: Date.now() + Math.min(ttl, requested),
            });
            return { outcome: 'saved', memory: publicRow(record) };
          }),
        };
      }
      if (action === 'update') {
        const value = fields.parse(args),
          record = byId(String(args.id));
        if (args.revision !== record.revision) throw Error('记忆已变化，请重新读取最新 revision');
        if (
          memory.drafts(chatKey).some((draft) => draft.recordId === record.id && draft.status === 'pending')
        )
          throw Error('此记忆已有待整理草稿');
        const prior = meta(record),
          merged = {
            ...prior,
            ...Object.fromEntries(Object.entries(value).filter(([key]) => Object.hasOwn(args, key))),
          };
        const draft = memory.update(
          record.id,
          {
            text: value.content,
            sources: sources(merged),
            confidence: Object.hasOwn(args, 'certainty')
              ? value.certainty === 'stated'
                ? 1
                : 0.55
              : record.confidence,
            ...(value.status === 'done' ? { status: 'superseded' as const } : {}),
          },
          args.revision,
        );
        return {
          backend: 'three-tier-memory',
          draft,
          effective: publicRow(record),
          notice: '更正已保存为短期草稿，整理后生效并依次传播',
        };
      }
      if (action === 'forget') {
        const ids = [...new Set(z.array(z.string().uuid()).min(1).max(20).parse(args.ids))],
          records = ids.map(byId);
        for (const record of records) memory.remove(record.id, record.revision);
        return { deleted: records.length };
      }
      const selectedSubject = args.subject_qq ? subject(String(args.subject_qq)) : undefined;
      const filtered = (values: MemoryRecord[]) =>
        values.filter(
          (record) =>
            (selectedSubject === undefined || record.personId === selectedSubject) &&
            (!args.category || meta(record).category === args.category),
        );
      if (action === 'status')
        return { backend: 'three-tier-memory', scope: chatKey, count: active().length, sharedDatabase: true };
      if (action === 'review') {
        const completed = memory
          .listHistory(chatKey)
          .filter(
            (record) =>
              record.status === 'superseded' && memory.factCurrent(record) && meta(record).status === 'done',
          );
        const values = filtered([...active(), ...completed]),
          offset = z
            .number()
            .int()
            .min(0)
            .parse(args.offset ?? 0),
          limit = z
            .number()
            .int()
            .min(1)
            .max(20)
            .parse(args.limit ?? 20);
        return { total: values.length, items: values.slice(offset, offset + limit).map(publicRow) };
      }
      if (action === 'search') {
        const query = z.string().trim().min(1).parse(args.query),
          limit = z
            .number()
            .int()
            .min(1)
            .max(5)
            .parse(args.limit ?? 5),
          found = await memory.search(chatKey, query, selectedSubject ?? undefined, 50);
        return {
          items: filtered(
            found.map((r) => r.record).filter((r) => r.chatKey === chatKey && meta(r).status !== 'done'),
          )
            .slice(0, limit)
            .map(publicRow),
        };
      }
      throw Error('未知记忆操作');
    }
  }
  return { MemoryStore, contextScope };
}
