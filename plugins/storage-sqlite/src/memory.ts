import { DatabaseSync } from 'node:sqlite';
import {
  memoryRecordSchema,
  scratchpadNoteSchema,
  type MemoryRecord,
  type MemoryIndexEvent,
  type ScratchpadNote,
} from '@qq-harness/contracts';
import type { MemoryRepository } from '@qq-harness/domain';

export function sqliteMemoryRepository(db: DatabaseSync): MemoryRepository {
  const rowRecord = (row: unknown) =>
    row ? memoryRecordSchema.parse(JSON.parse(String((row as { payload: string }).payload))) : undefined;
  const rowNote = (row: unknown) =>
    row ? scratchpadNoteSchema.parse(JSON.parse(String((row as { payload: string }).payload))) : undefined;
  const getRecord = (id: string) =>
    rowRecord(db.prepare('SELECT payload FROM memory_records WHERE id=?').get(id));
  const getNote = (id: string) => rowNote(db.prepare('SELECT payload FROM memory_notes WHERE id=?').get(id));
  return {
    records: () =>
      db
        .prepare('SELECT payload FROM memory_records ORDER BY updated_at DESC')
        .all()
        .map(rowRecord) as MemoryRecord[],
    candidates: (chatKey, personIds) =>
      db
        .prepare(
          `SELECT payload FROM memory_records WHERE status='active' AND (
        (scope='chat' AND chat_key=?) OR
        (scope='chat_person' AND chat_key=? AND person_id IN (SELECT value FROM json_each(?))) OR
        (scope='person' AND person_id IN (SELECT value FROM json_each(?)))
      )`,
        )
        .all(chatKey, chatKey, JSON.stringify(personIds), JSON.stringify(personIds))
        .map(rowRecord) as MemoryRecord[],
    record: getRecord,
    saveRecord: (input, expectedRevision) => {
      const record = memoryRecordSchema.parse(input);
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = getRecord(record.id);
        const actual = prior?.revision ?? 0;
        if (expectedRevision !== undefined && expectedRevision !== actual) throw new Error('记忆版本冲突');
        if (record.revision !== actual + 1) throw new Error('记忆修订号无效');
        db.prepare(
          `INSERT INTO memory_records(id,scope,tier,chat_key,person_id,status,updated_at,payload)
           VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
           scope=excluded.scope,tier=excluded.tier,chat_key=excluded.chat_key,
           person_id=excluded.person_id,status=excluded.status,updated_at=excluded.updated_at,payload=excluded.payload`,
        ).run(
          record.id,
          record.scope,
          record.tier,
          record.chatKey,
          record.personId,
          record.status,
          record.updatedAt,
          JSON.stringify(record),
        );
        db.prepare('INSERT INTO memory_revisions(record_id,revision,changed_at,payload) VALUES(?,?,?,?)').run(
          record.id,
          record.revision,
          record.updatedAt,
          JSON.stringify(record),
        );
        db.prepare('INSERT INTO memory_index_events(record_id,revision,operation) VALUES(?,?,?)').run(
          record.id,
          record.revision,
          record.status === 'active' ? 'upsert' : 'remove',
        );
        db.exec('COMMIT');
        return record;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    history: (id) =>
      db
        .prepare('SELECT changed_at,payload FROM memory_revisions WHERE record_id=? ORDER BY revision DESC')
        .all(id)
        .map((row) => ({
          record: memoryRecordSchema.parse(JSON.parse(String(row.payload))),
          changedAt: Number(row.changed_at),
        })),
    notes: (chatKey) =>
      db
        .prepare('SELECT payload FROM memory_notes WHERE chat_key=? ORDER BY updated_at DESC')
        .all(chatKey)
        .map(rowNote) as ScratchpadNote[],
    note: getNote,
    saveNote: (input, expectedRevision) => {
      const note = scratchpadNoteSchema.parse(input);
      const prior = getNote(note.id);
      const actual = prior?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== actual) throw new Error('记事本版本冲突');
      if (note.revision !== actual + 1) throw new Error('记事本修订号无效');
      db.prepare(
        `INSERT INTO memory_notes(id,chat_key,updated_at,expires_at,payload) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET chat_key=excluded.chat_key,updated_at=excluded.updated_at,
         expires_at=excluded.expires_at,payload=excluded.payload`,
      ).run(note.id, note.chatKey, note.updatedAt, note.expiresAt, JSON.stringify(note));
      return note;
    },
    deleteNote: (id) => {
      db.prepare('DELETE FROM memory_notes WHERE id=?').run(id);
    },
    expireNotes: (now) => Number(db.prepare('DELETE FROM memory_notes WHERE expires_at<=?').run(now).changes),
    cursor: (chatKey) =>
      Number(db.prepare('SELECT local_id FROM memory_cursors WHERE chat_key=?').get(chatKey)?.local_id ?? 0),
    setCursor: (chatKey, localId) => {
      db.prepare(
        `INSERT INTO memory_cursors(chat_key,local_id) VALUES(?,?)
         ON CONFLICT(chat_key) DO UPDATE SET local_id=MAX(local_id,excluded.local_id)`,
      ).run(chatKey, localId);
    },
    indexEvents: (after, limit) =>
      db
        .prepare(
          'SELECT sequence,record_id,revision,operation FROM memory_index_events WHERE sequence>? ORDER BY sequence LIMIT ?',
        )
        .all(after, limit)
        .map((row) => ({
          sequence: Number(row.sequence),
          recordId: String(row.record_id),
          revision: Number(row.revision),
          operation: String(row.operation) as MemoryIndexEvent['operation'],
        })),
    latestIndexSequence: () =>
      Number(db.prepare('SELECT MAX(sequence) AS value FROM memory_index_events').get()?.value ?? 0),
    indexCheckpoint: (providerId) =>
      Number(
        db.prepare('SELECT sequence FROM memory_index_checkpoints WHERE provider_id=?').get(providerId)
          ?.sequence ?? 0,
      ),
    setIndexCheckpoint: (providerId, sequence) => {
      db.prepare(
        `INSERT INTO memory_index_checkpoints(provider_id,sequence) VALUES(?,?)
         ON CONFLICT(provider_id) DO UPDATE SET sequence=MAX(sequence,excluded.sequence)`,
      ).run(providerId, sequence);
    },
  };
}
