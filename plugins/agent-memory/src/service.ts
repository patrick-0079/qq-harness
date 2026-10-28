import { createHash, randomUUID } from 'node:crypto';
import {
  chatKeySchema,
  memoryRecordSchema,
  type MemoryRecord,
  type ScratchpadNote,
  type MemoryDraft,
} from '@qq-harness/contracts';
import type {
  AccessService,
  ConfigService,
  MemoryIndex,
  MemoryRepository,
  MemoryService,
  StorageService,
  IndexableMemory,
} from '@qq-harness/domain';

const DAY = 86_400_000;
export const factId = (record: Pick<MemoryRecord, 'scope' | 'chatKey' | 'personId' | 'key'>) =>
  createHash('sha256')
    .update(JSON.stringify([record.scope, record.chatKey, record.personId, record.key]))
    .digest('hex');
export const sourceId = (source: MemoryRecord['sources'][number]) =>
  `${source.chatKey}/${source.noteId ? `note:${source.noteId}:${source.noteRevision}` : source.localId}`;
const tierRank = { short: 3, medium: 2, long: 1 };
export const retained = (record: MemoryRecord, now = Date.now()) =>
  record.status === 'active' &&
  (record.expiresAt === null || record.expiresAt > now || record.consolidatedAt === undefined);
const sensitivePattern =
  /住址|地址|身份证|手机号|病|诊断|治疗|工资|收入|银行卡|债务|恋爱|婚姻|家属|家庭关系/u;
export const indexable = (record: MemoryRecord): IndexableMemory => ({
  id: record.id,
  revision: record.revision,
  text: record.text,
  scope: record.scope,
  tier: record.tier,
  chatKey: record.chatKey,
  personId: record.personId,
  visibility: record.visibility,
  sensitive: record.sensitive,
});
const legacyId = (chatKey: string) => {
  const hex = createHash('sha256').update(`legacy:${chatKey}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const lexical = (query: string, text: string) => {
  const q = query.toLowerCase().trim();
  const value = text.toLowerCase();
  if (!q) return 0;
  if (value.includes(q)) return 1;
  const words = [...q.matchAll(/[a-z0-9]+|[\p{Script=Han}]/gu)].map((match) => match[0]);
  return words.length ? words.filter((word) => value.includes(word)).length / words.length : 0;
};

export function createMemoryService(deps: {
  repo: MemoryRepository;
  index: MemoryIndex;
  storage: StorageService;
  access: AccessService;
  config: ConfigService;
  onImportant: (id: string) => void;
  onChanged: () => void;
  consolidation?: MemoryService['consolidation'];
  consolidate?: MemoryService['consolidate'];
}): MemoryService {
  const { repo, index, storage, access, config } = deps;
  const checkChat = (chatKey: string) => {
    chatKeySchema.parse(chatKey);
    access.assert(chatKey);
  };
  const hasPerson = (chatKey: string, personId: string) =>
    chatKey === `private:${personId}` ||
    storage.hasSender(chatKey, personId) ||
    repo.records().some((r) => r.chatKey === chatKey && r.scope === 'chat_person' && r.personId === personId);
  const recordedPeople = (chatKey: string) =>
    repo
      .records()
      .filter((r) => r.chatKey === chatKey && r.scope === 'chat_person' && r.personId)
      .map((r) => r.personId!);
  const validRecord = (record: MemoryRecord) => {
    memoryRecordSchema.parse(record);
    if (record.scope === 'chat' && (!record.chatKey || record.personId)) throw new Error('会话记忆维度无效');
    if (record.scope === 'chat_person' && (!record.chatKey || !record.personId))
      throw new Error('会话成员维度无效');
    if (record.scope === 'person' && (record.chatKey || !record.personId))
      throw new Error('通用个人维度无效');
    if (record.chatKey) chatKeySchema.parse(record.chatKey);
    if (record.personId && !/^[0-9]+$/.test(record.personId)) throw new Error('QQ 号无效');
    if (record.scope === 'person' && (record.sensitive || record.visibility !== 'cross_chat'))
      throw new Error('敏感或限定会话内容不得写入通用个人记忆');
    if (record.scope !== 'person' && record.visibility !== 'chat_only')
      throw new Error('会话记忆不得跨会话可见');
    if (record.scope !== 'person' && record.sources.some((source) => source.chatKey !== record.chatKey))
      throw new Error('会话记忆来源必须属于当前会话');
    if (record.tier !== 'long' && record.status === 'active' && record.expiresAt === null)
      throw new Error('短中期记忆必须设置到期时间');
    if (record.tier === 'long' && record.expiresAt !== null) throw new Error('长期记忆不得自动到期');
    if (
      record.origin === 'automatic' &&
      record.scope === 'person' &&
      (!record.sources.length || record.sources.some((source) => !source.chatKey.startsWith('group:')))
    )
      throw new Error('私聊来源不能自动写入通用个人记忆');
  };
  let headSequence = -1;
  const heads = new Map<string, { version: number; deleted: boolean }>();
  const currentFact = (record: MemoryRecord) => {
    const sequence = repo.latestIndexSequence();
    if (sequence !== headSequence) {
      heads.clear();
      for (const item of repo.records()) {
        const key = item.factId ?? factId(item),
          version = item.factVersion ?? 1,
          prior = heads.get(key);
        if (!prior || version > prior.version)
          heads.set(key, { version, deleted: item.status === 'deleted' });
        else if (version === prior.version && item.status === 'deleted') prior.deleted = true;
      }
      headSequence = sequence;
    }
    const head = heads.get(record.factId ?? factId(record));
    return !head || (head.version === (record.factVersion ?? 1) && !head.deleted);
  };
  const visible = (record: MemoryRecord, chatKey: string, people: Set<string>) => {
    if (!currentFact(record) || !retained(record)) return false;
    if (record.scope === 'chat') return record.chatKey === chatKey;
    if (!record.personId || !people.has(record.personId)) return false;
    if (record.scope === 'chat_person') return record.chatKey === chatKey;
    return (
      record.visibility === 'cross_chat' &&
      !record.sensitive &&
      record.sources.every((source) => access.allowed(source.chatKey, source.senderId))
    );
  };
  const legacy = (chatKey: string): void => {
    if (storage.state('memory-legacy', chatKey)) return;
    const text = storage.memory(chatKey);
    if (!text) return;
    if (
      repo
        .records()
        .some((r) => r.chatKey === chatKey && (r.key === 'legacy-text' || r.key.startsWith('legacy-text:')))
    ) {
      storage.setState('memory-legacy', chatKey, true);
      return;
    }
    for (let offset = 0; offset < text.length; offset += 4000) {
      const key =
        text.length <= 4000 ? 'legacy-text' : `legacy-text:${String(offset / 4000 + 1).padStart(4, '0')}`;
      const id = legacyId(offset === 0 ? chatKey : `${chatKey}/${offset}`);
      if (repo.record(id)) continue;
      repo.saveRecord(
        {
          id,
          scope: 'chat',
          tier: 'short',
          chatKey,
          personId: null,
          key,
          text: text.slice(offset, offset + 4000),
          visibility: 'chat_only',
          sensitive: false,
          confidence: 0.7,
          importance: 0.5,
          pinned: false,
          sources: [],
          origin: 'admin',
          status: 'active',
          revision: 1,
          createdAt: 0,
          updatedAt: 0,
          lastConfirmedAt: 0,
          expiresAt: Date.now() + config.effective(chatKey).memory.shortRetentionMs,
          factId: factId({ scope: 'chat', chatKey, personId: null, key }),
          factVersion: 1,
        },
        0,
      );
    }
    storage.setState('memory-legacy', chatKey, true);
    deps.onChanged();
  };
  const list = (chatKey: string, personId?: string) => {
    checkChat(chatKey);
    // Legacy import belongs to startup migration, never to GET/query paths.
    if (personId && !hasPerson(chatKey, personId)) throw new Error('此人不属于当前会话');
    const people = new Set(personId ? [personId] : storage.recent(chatKey, 100, 0).map((m) => m.senderId));
    if (!personId) for (const person of recordedPeople(chatKey)) people.add(person);
    if (chatKey.startsWith('private:')) people.add(chatKey.slice(8));
    const records = repo
      .candidates(chatKey, [...people])
      .filter((record) => visible(record, chatKey, people));
    return records.sort((a, b) => tierRank[b.tier] - tierRank[a.tier] || b.updatedAt - a.updatedAt);
  };
  const save = (input: MemoryRecord, expectedRevision?: number) => {
    const record = { ...input, sensitive: input.sensitive || sensitivePattern.test(input.text) };
    validRecord(record);
    if (record.chatKey && record.status === 'active') checkChat(record.chatKey);
    const prior = repo.record(record.id);
    const existing = new Set(prior?.sources.map(sourceId) ?? []);
    for (const source of record.sources)
      if (!existing.has(sourceId(source))) {
        access.assert(source.chatKey, source.senderId);
        if (source.noteId) {
          if (
            !repo
              .noteHistory(source.noteId)
              .some((note) => note.chatKey === source.chatKey && note.revision === source.noteRevision)
          )
            throw new Error('记忆来源笔记修订不存在');
          continue;
        }
        const message = storage
          .messages(source.chatKey)
          .find((item) => item.localId === source.localId && !item.self);
        if (!message || message.senderId !== source.senderId) throw new Error('记忆来源消息不存在');
      }
    const result = repo.saveRecord(record, expectedRevision);
    if (
      record.chatKey &&
      (record.key === 'legacy-text' || record.key.startsWith('legacy-text:')) &&
      storage.state('memory-legacy', record.chatKey)
    )
      syncLegacy(record.chatKey);
    deps.onChanged();
    return result;
  };
  const expire = () => repo.expireNotes(Date.now());
  const drafts = (chatKey: string) => {
    checkChat(chatKey);
    return structuredClone((storage.state('memory-drafts', chatKey) ?? []) as MemoryDraft[]);
  };
  const saveDrafts = (chatKey: string, value: MemoryDraft[]) => {
    storage.setState('memory-drafts', chatKey, value);
    deps.onChanged();
  };
  const syncLegacy = (chatKey: string) => {
    const selected = new Map<string, MemoryRecord>();
    for (const record of repo
      .records()
      .filter(
        (r) =>
          r.chatKey === chatKey &&
          (r.key === 'legacy-text' || r.key.startsWith('legacy-text:')) &&
          r.status === 'active' &&
          currentFact(r),
      )
      .sort((a, b) => tierRank[b.tier] - tierRank[a.tier]))
      if (!selected.has(record.key)) selected.set(record.key, record);
    storage.setMemory(
      chatKey,
      [...selected.values()]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((r) => r.text)
        .join(''),
    );
  };
  const publish: MemoryService['publish'] = (id, patch, expectedRevision) => {
    const prior = repo.record(id);
    if (!prior) throw new Error('记忆不存在');
    return save(
      {
        ...prior,
        ...patch,
        id: prior.id,
        revision: prior.revision + 1,
        createdAt: prior.createdAt,
        updatedAt: Date.now(),
        lastConfirmedAt: patch.text !== undefined ? Date.now() : prior.lastConfirmedAt,
      },
      expectedRevision ?? prior.revision,
    );
  };
  const remember: MemoryService['remember'] = (input) => {
    const now = Date.now();
    const key = input.factId ?? factId(input);
    const version =
      input.factVersion ??
      Math.max(
        0,
        ...repo
          .records()
          .filter((item) => (item.factId ?? factId(item)) === key)
          .map((item) => item.factVersion ?? 1),
      ) + 1;
    const saved = save(
      {
        ...input,
        factId: key,
        factVersion: version,
        consolidatedAt: undefined,
        id: randomUUID(),
        revision: 1,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        lastConfirmedAt: now,
      },
      0,
    );
    for (const prior of repo.records())
      if (
        prior.id !== saved.id &&
        (prior.factId ?? factId(prior)) === key &&
        (prior.factVersion ?? 1) < version &&
        prior.status === 'active'
      )
        publish(prior.id, { status: 'superseded' });
    return saved;
  };
  return {
    list,
    listHistory: (chatKey) => {
      checkChat(chatKey);
      return repo.records().filter((r) => r.chatKey === chatKey);
    },
    factCurrent: currentFact,
    publish,
    drafts,
    consolidation: (chatKey) => {
      checkChat(chatKey);
      if (!deps.consolidation) throw new Error('整理服务尚未就绪');
      return deps.consolidation(chatKey);
    },
    consolidate: (chatKey, tier) => {
      checkChat(chatKey);
      if (!deps.consolidate) throw new Error('整理服务尚未就绪');
      return deps.consolidate(chatKey, tier);
    },
    cancelDraft: (chatKey, id) => {
      const entries = drafts(chatKey);
      const entry = entries.find(
        (draft) => draft.id === id && (draft.status === 'pending' || draft.status === 'conflict'),
      );
      if (!entry) throw new Error('待整理草稿不存在');
      entry.status = 'cancelled';
      entry.revision++;
      saveDrafts(chatKey, entries);
    },
    publishDrafts: (chatKey) => {
      const entries = drafts(chatKey);
      for (const draft of entries.filter((entry) => entry.status === 'pending')) {
        const prior = repo.record(draft.recordId);
        const already =
          prior &&
          repo
            .records()
            .find(
              (entry) =>
                entry.derivedFrom?.some(
                  (source) => source.id === prior.id && source.revision === draft.expectedRevision,
                ) &&
                entry.origin === 'admin' &&
                (entry.factVersion ?? 1) > (prior.factVersion ?? 1),
            );
        if (already) {
          draft.status = 'published';
          draft.publishedAt = already.createdAt;
          continue;
        }
        if (!prior || prior.revision !== draft.expectedRevision || !currentFact(prior)) {
          draft.status = 'conflict';
          draft.error = '记忆版本冲突，请基于当前版本重新编辑';
          continue;
        }
        const key = prior.factId ?? factId(prior);
        const version =
          Math.max(
            ...repo
              .records()
              .filter((entry) => (entry.factId ?? factId(entry)) === key)
              .map((entry) => entry.factVersion ?? 1),
          ) + 1;
        // Replaying a crash after publication must not produce another revision of the fact.
        remember({
          ...prior,
          ...draft.patch,
          tier: 'short',
          factId: key,
          factVersion: version,
          derivedFrom: [{ id: prior.id, revision: prior.revision }],
          origin: 'admin',
          expiresAt: Date.now() + config.effective(chatKey).memory.shortRetentionMs,
        });
        draft.status = 'published';
        draft.publishedAt = Date.now();
        draft.revision++;
      }
      saveDrafts(chatKey, entries);
    },
    search: async (chatKey, query, personId, limit = 8) => {
      checkChat(chatKey);
      // Legacy import belongs to startup migration, never to GET/query paths.
      if (personId && !hasPerson(chatKey, personId)) throw new Error('此人不属于当前会话');
      const people = new Set(
        personId ? [personId] : storage.recent(chatKey, 30, Date.now() - 2 * DAY).map((m) => m.senderId),
      );
      if (!personId) for (const person of recordedPeople(chatKey)) people.add(person);
      if (chatKey.startsWith('private:')) people.add(chatKey.slice(8));
      // Legacy import belongs to startup migration, never to GET/query paths.
      const capped = Math.max(1, Math.min(20, limit));
      const eligible = repo
        .candidates(chatKey, [...people])
        .filter((record) => visible(record, chatKey, people));
      const allowed = new Map(eligible.map((record) => [record.id, record]));
      let ranked: { id: string; relevance: number }[];
      const checkpoint = repo.indexCheckpoint(index.id);
      const pending = repo.indexEvents(checkpoint, 1001);
      try {
        if (!index.health().ready) throw new Error('索引未就绪');
        ranked = await index.search(
          query,
          {
            chatKey,
            personIds: [...people],
            allowedIds: [...allowed.keys()],
          },
          Math.max(40, capped * 8),
        );
        ranked = ranked.filter((item) => allowed.has(item.id));
        if (pending.length > 1000) throw new Error('索引积压');
        for (const event of pending) {
          const record = allowed.get(event.recordId);
          ranked = ranked.filter((item) => item.id !== event.recordId);
          if (record) ranked.push({ id: record.id, relevance: lexical(query, record.text) });
        }
      } catch {
        ranked = eligible.map((record) => ({ id: record.id, relevance: lexical(query, record.text) }));
      }
      const unique = new Map<string, number>();
      for (const item of ranked) unique.set(item.id, Math.max(unique.get(item.id) ?? 0, item.relevance));
      return [...unique]
        .map(([id, relevance]) => ({
          record: repo.record(id),
          relevance: Math.max(0, Math.min(1, relevance)),
        }))
        .filter(
          (item): item is { record: MemoryRecord; relevance: number } =>
            !!item.record && item.relevance > 0 && visible(item.record, chatKey, people),
        )
        .map(({ record, relevance }) => {
          const age = Math.max(0, Date.now() - record.lastConfirmedAt);
          const freshness = record.pinned
            ? 1
            : record.tier === 'medium'
              ? 2 ** (-age / (14 * DAY))
              : Math.max(0.3, 2 ** (-age / (90 * DAY)));
          const scopeFit = record.scope === 'chat_person' ? 1 : record.scope === 'chat' ? 0.9 : 0.8;
          const score =
            0.4 * relevance +
            0.25 * record.confidence +
            0.15 * record.importance +
            0.15 * freshness +
            0.05 * scopeFit;
          return { record, score };
        })
        .sort((a, b) => tierRank[b.record.tier] - tierRank[a.record.tier] || b.score - a.score)
        .filter(
          (item, position, all) =>
            all.findIndex(
              (other) =>
                (other.record.factId ?? factId(other.record)) === (item.record.factId ?? factId(item.record)),
            ) === position,
        )
        .slice(0, capped);
    },
    remember,
    update: (id, patch, expectedRevision) => {
      const prior = repo.record(id);
      if (!prior) throw new Error('记忆不存在');
      if (
        (expectedRevision ?? prior.revision) !== prior.revision ||
        !currentFact(prior) ||
        prior.status !== 'active'
      )
        throw new Error('记忆版本冲突');
      validRecord({ ...prior, ...patch });
      const chatKey = prior.chatKey ?? prior.sources[0]?.chatKey;
      if (!chatKey) throw new Error('更正草稿需要来源会话');
      const entries = drafts(chatKey);
      if (entries.some((entry) => entry.status === 'pending' && entry.recordId === id))
        throw new Error('此记忆已有待整理草稿，请先整理或撤销');
      const draft: MemoryDraft = {
        id: randomUUID(),
        chatKey,
        recordId: id,
        expectedRevision: prior.revision,
        patch,
        status: 'pending',
        revision: 1,
        createdAt: Date.now(),
      };
      saveDrafts(chatKey, [...entries, draft]);
      return draft;
    },
    remove: (id, expectedRevision) => {
      const prior = repo.record(id);
      if (!prior) throw new Error('记忆不存在');
      if (!currentFact(prior) || prior.status !== 'active') throw new Error('记忆版本冲突');
      const deleted = save(
        {
          ...prior,
          status: 'deleted',
          factId: prior.factId ?? factId(prior),
          factVersion:
            Math.max(
              ...repo
                .records()
                .filter((item) => (item.factId ?? factId(item)) === (prior.factId ?? factId(prior)))
                .map((item) => item.factVersion ?? 1),
            ) + 1,
          revision: prior.revision + 1,
          updatedAt: Date.now(),
        },
        expectedRevision ?? prior.revision,
      );
      if (prior.tier !== 'short')
        repo.saveRecord(
          {
            ...deleted,
            id: randomUUID(),
            revision: 1,
            tier: 'short',
            expiresAt: Date.now() + DAY,
            derivedFrom: [{ id: deleted.id, revision: deleted.revision }],
          },
          0,
        );
      return deleted;
    },
    notes: (chatKey, includeArchived = false) => {
      checkChat(chatKey);
      // Expiration is maintenance work, not a read side effect.
      return repo.notes(chatKey, includeArchived);
    },
    noteHistory: (chatKey, id) => {
      checkChat(chatKey);
      if (repo.note(id)?.chatKey !== chatKey) throw new Error('笔记不存在');
      return repo.noteHistory(id);
    },
    note: (chatKey, text, sourceIds = [], ttlMs) => {
      checkChat(chatKey);
      const now = Date.now();
      const max = config.effective(chatKey).scratchpadMaxDays * DAY;
      const ttl = ttlMs === undefined ? max : Math.min(max, Math.max(60_000, ttlMs));
      const note = repo.saveNote(
        {
          id: randomUUID(),
          chatKey,
          text,
          important: false,
          promotion: 'pending',
          sourceIds,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + ttl,
          revision: 1,
        },
        0,
      );
      deps.onImportant(note.id);
      return note;
    },
    updateNote: (chatKey, id, patch) => {
      checkChat(chatKey);
      const prior = repo.note(id);
      if (!prior || (prior.status && prior.status !== 'active') || prior.chatKey !== chatKey)
        throw new Error('记事本条目不存在或已过期');
      const now = Date.now();
      const max = config.effective(chatKey).scratchpadMaxDays * DAY;
      const ttl =
        patch.ttlMs === undefined
          ? Math.min(max, prior.expiresAt - prior.updatedAt)
          : Math.min(max, Math.max(60_000, patch.ttlMs));
      const changedContent = patch.text !== undefined || patch.sourceIds !== undefined;
      const note: ScratchpadNote = {
        ...prior,
        ...(patch.text !== undefined ? { text: patch.text } : {}),
        ...(patch.sourceIds !== undefined ? { sourceIds: patch.sourceIds } : {}),
        ...(patch.important !== undefined ? { important: patch.important } : {}),
        updatedAt: now,
        expiresAt: now + ttl,
        revision: prior.revision + 1,
        promotion: changedContent || patch.important !== undefined ? 'pending' : prior.promotion,
        consolidatedAt: changedContent || patch.important !== undefined ? undefined : prior.consolidatedAt,
      };
      const saved = repo.saveNote(note, prior.revision);
      deps.onImportant(saved.id);
      return saved;
    },
    deleteNote: (chatKey, id) => {
      checkChat(chatKey);
      if (repo.note(id)?.chatKey !== chatKey) throw new Error('记事本条目不存在');
      repo.deleteNote(id);
    },
    history: (id, chatKey) => {
      checkChat(chatKey);
      const record = repo.record(id);
      if (!record) throw new Error('记忆不存在');
      const people = new Set(storage.recent(chatKey, 100, 0).map((message) => message.senderId));
      for (const person of recordedPeople(chatKey)) people.add(person);
      if (chatKey.startsWith('private:')) people.add(chatKey.slice(8));
      if (
        (record.scope === 'person' &&
          (!record.personId ||
            !people.has(record.personId) ||
            record.sensitive ||
            record.visibility !== 'cross_chat' ||
            !record.sources.every((source) => access.allowed(source.chatKey, source.senderId)))) ||
        (record.scope !== 'person' && record.chatKey !== chatKey)
      )
        throw new Error('记忆不属于当前会话');
      const key = record.factId ?? factId(record);
      return repo
        .records()
        .filter((r) => (r.factId ?? factId(r)) === key)
        .flatMap((r) => repo.history(r.id))
        .sort((a, b) => b.changedAt - a.changedAt);
    },
    indexStatus: () => ({
      provider: index.id,
      ...index.health(),
      pending: repo.latestIndexSequence() - repo.indexCheckpoint(index.id),
    }),
  };
}
