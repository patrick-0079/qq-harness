import path from 'node:path';
import {
  memoryRecordSchema,
  scratchpadNoteSchema,
  type MemoryRecord,
  type MemoryRevision,
  type MemoryIndexEvent,
  type ScratchpadNote,
} from '@qq-harness/contracts';
import type { MemoryRepository } from '@qq-harness/domain';
import { readJson, writeJsonAtomic } from '@qq-harness/files';

interface State {
  agent?: unknown;
  records: Record<string, MemoryRecord>;
  revisions: Record<string, MemoryRevision[]>;
  notes: Record<string, ScratchpadNote>;
  noteRevisions: Record<string, ScratchpadNote[]>;
  cursors: Record<string, number>;
  events: MemoryIndexEvent[];
  checkpoints: Record<string, number>;
}
const empty = (): State => ({
  records: {},
  revisions: {},
  notes: {},
  noteRevisions: {},
  cursors: {},
  events: [],
  checkpoints: {},
});

export function fileMemoryRepository(dataDir: string): MemoryRepository {
  const file = path.join(dataDir, 'memory-system', 'store.json');
  let state = { ...empty(), ...(readJson(file, empty()) as State) };
  for (const note of Object.values(state.notes)) state.noteRevisions[note.id] ??= [structuredClone(note)];
  let transactionDepth = 0;
  const commit = (change: (draft: State) => void) => {
    const draft = structuredClone(state);
    change(draft);
    if (!transactionDepth) writeJsonAtomic(file, draft);
    state = draft;
  };
  return {
    transaction: (write) => {
      const prior = structuredClone(state);
      transactionDepth++;
      try {
        const result = write();
        if (transactionDepth === 1) writeJsonAtomic(file, state);
        return result;
      } catch (error) {
        state = prior;
        throw error;
      } finally {
        transactionDepth--;
      }
    },
    control: () => structuredClone(state.agent),
    saveControl: (value) =>
      commit((draft) => {
        draft.agent = structuredClone(value);
      }),
    records: () => Object.values(state.records).map((value) => structuredClone(value)),
    candidates: (chatKey, personIds) => {
      const people = new Set(personIds);
      return Object.values(state.records)
        .filter(
          (record) =>
            record.status === 'active' &&
            (record.scope === 'chat'
              ? record.chatKey === chatKey
              : record.scope === 'chat_person'
                ? record.chatKey === chatKey && !!record.personId && people.has(record.personId)
                : !!record.personId && people.has(record.personId)),
        )
        .map((record) => structuredClone(record));
    },
    record: (id) => (state.records[id] ? structuredClone(state.records[id]) : undefined),
    saveRecord: (input, expectedRevision) => {
      const record = memoryRecordSchema.parse(input);
      const actual = state.records[record.id]?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== actual) throw new Error('记忆版本冲突');
      if (record.revision !== actual + 1) throw new Error('记忆修订号无效');
      commit((draft) => {
        draft.records[record.id] = record;
        (draft.revisions[record.id] ??= []).push({ record, changedAt: record.updatedAt });
        draft.events.push({
          sequence: (draft.events.at(-1)?.sequence ?? 0) + 1,
          recordId: record.id,
          revision: record.revision,
          operation: record.status === 'active' ? 'upsert' : 'remove',
        });
      });
      return structuredClone(record);
    },
    history: (id) => structuredClone([...(state.revisions[id] ?? [])].reverse()),
    notes: (chatKey, includeArchived = false) =>
      Object.values(state.notes)
        .filter(
          (note) => note.chatKey === chatKey && (includeArchived || !note.status || note.status === 'active'),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((note) => structuredClone(note)),
    note: (id) => (state.notes[id] ? structuredClone(state.notes[id]) : undefined),
    noteHistory: (id) => structuredClone([...(state.noteRevisions[id] ?? [])].reverse()),
    saveNote: (input, expectedRevision) => {
      const note = scratchpadNoteSchema.parse(input);
      const actual = state.notes[note.id]?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== actual) throw new Error('记事本版本冲突');
      if (note.revision !== actual + 1) throw new Error('记事本修订号无效');
      commit((draft) => {
        draft.notes[note.id] = note;
        (draft.noteRevisions[note.id] ??= []).push(note);
      });
      return structuredClone(note);
    },
    deleteNote: (id) => {
      commit((draft) => {
        const prior = draft.notes[id];
        if (prior && (!prior.status || prior.status === 'active')) {
          const note = {
            ...prior,
            status: 'deleted' as const,
            revision: prior.revision + 1,
            updatedAt: Date.now(),
          };
          draft.notes[id] = note;
          (draft.noteRevisions[id] ??= []).push(note);
        }
      });
    },
    expireNotes: (now) => {
      const ids = Object.values(state.notes)
        .filter(
          (note) =>
            note.expiresAt <= now &&
            note.consolidatedAt !== undefined &&
            (!note.status || note.status === 'active'),
        )
        .map((note) => note.id);
      if (ids.length)
        commit((draft) => {
          for (const id of ids) {
            const note = {
              ...draft.notes[id]!,
              status: 'expired' as const,
              revision: draft.notes[id]!.revision + 1,
              updatedAt: now,
            };
            draft.notes[id] = note;
            (draft.noteRevisions[id] ??= []).push(note);
          }
        });
      return ids.length;
    },
    cursor: (chatKey) => state.cursors[chatKey] ?? 0,
    setCursor: (chatKey, localId) => {
      commit((draft) => {
        draft.cursors[chatKey] = Math.max(draft.cursors[chatKey] ?? 0, localId);
      });
    },
    indexEvents: (after, limit) => state.events.filter((event) => event.sequence > after).slice(0, limit),
    latestIndexSequence: () => state.events.at(-1)?.sequence ?? 0,
    indexCheckpoint: (providerId) => state.checkpoints[providerId] ?? 0,
    setIndexCheckpoint: (providerId, sequence) => {
      commit((draft) => {
        draft.checkpoints[providerId] = Math.max(draft.checkpoints[providerId] ?? 0, sequence);
      });
    },
  };
}
