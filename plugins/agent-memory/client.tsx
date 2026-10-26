import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost, type SlotProps } from '@qq-harness/client-sdk';
import type { MemoryRecord, ScratchpadNote } from '@qq-harness/contracts';

const DAY = 86_400_000;
const enc = encodeURIComponent;

function RecordCard({
  record,
  refresh,
  fail,
  chatKey,
}: {
  record: MemoryRecord;
  refresh: () => void;
  fail: (error: unknown) => void;
  chatKey: string;
}) {
  const host = useHost();
  const [text, setText] = useState(record.text);
  const [importance, setImportance] = useState(record.importance);
  const [sensitive, setSensitive] = useState(record.sensitive);
  useEffect(() => {
    setText(record.text);
    setImportance(record.importance);
    setSensitive(record.sensitive);
  }, [record.id, record.revision]);
  const old = record.key === 'legacy-text';
  const update = (patch: Record<string, unknown>) =>
    void (
      old
        ? host.api.request(`/api/chats/${enc(chatKey)}/memory`, {
            method: 'PATCH',
            body: JSON.stringify({ text: patch.text }),
          })
        : host.api.request(`/api/memory/records/${enc(record.id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ expectedRevision: record.revision, patch }),
          })
    )
      .then(refresh)
      .catch(fail);
  return (
    <article className="panel form-stack">
      <div className="row">
        <strong>
          {record.scope === 'chat_person'
            ? `会话成员 ${record.personId}`
            : record.scope === 'person'
              ? `通用个人 ${record.personId}`
              : '会话'}
        </strong>
        <span className="pill">{record.tier === 'medium' ? '中期' : '长期'}</span>
        <span className="muted">可信度 {Math.round(record.confidence * 100)}%</span>
      </div>
      <small>
        {record.key} · {record.sources.length} 条来源 · 最后确认{' '}
        {new Date(record.lastConfirmedAt).toLocaleString()}
      </small>
      <textarea
        aria-label="记忆内容"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {!old && (
        <label>
          重要性 {Math.round(importance * 100)}%
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={importance}
            onChange={(event) => setImportance(Number(event.target.value))}
          />
        </label>
      )}
      {!old && record.scope !== 'person' && (
        <label className="toggle-row">
          仅当前会话可见的敏感信息
          <input
            type="checkbox"
            checked={sensitive}
            onChange={(event) => setSensitive(event.target.checked)}
          />
        </label>
      )}
      <div className="row">
        <button type="button" onClick={() => update({ text, importance, ...(old ? {} : { sensitive }) })}>
          保存
        </button>
        {!old && (
          <button type="button" onClick={() => update({ pinned: !record.pinned })}>
            {record.pinned ? '取消固定' : '固定'}
          </button>
        )}
        {record.tier === 'medium' && record.key !== 'legacy-text' && (
          <button
            type="button"
            onClick={() =>
              void host.api
                .request(`/api/memory/records/${enc(record.id)}/promote`, {
                  method: 'POST',
                  body: JSON.stringify({ chatKey, target: 'long', expectedRevision: record.revision }),
                })
                .then(refresh)
                .catch(fail)
            }
          >
            升为长期
          </button>
        )}
        {record.scope === 'chat_person' && !record.sensitive && (
          <button
            type="button"
            onClick={() =>
              void host.api
                .request(`/api/memory/records/${enc(record.id)}/promote`, {
                  method: 'POST',
                  body: JSON.stringify({ chatKey, target: 'person', expectedRevision: record.revision }),
                })
                .then(refresh)
                .catch(fail)
            }
          >
            升为通用
          </button>
        )}
        {record.key !== 'legacy-text' && (
          <button
            type="button"
            onClick={() =>
              void host.api
                .request(`/api/memory/records/${enc(record.id)}?revision=${record.revision}`, {
                  method: 'DELETE',
                })
                .then(refresh)
                .catch(fail)
            }
          >
            删除
          </button>
        )}
      </div>
      <details>
        <summary>来源和修订</summary>
        <small>
          {record.sources.map((source) => `${source.chatKey} #${source.localId}`).join('、') ||
            '人工或旧版记录'}
        </small>
        {record.key !== 'legacy-text' && <History id={record.id} chatKey={chatKey} />}
      </details>
    </article>
  );
}

function History({ id, chatKey }: { id: string; chatKey: string }) {
  const host = useHost();
  const { data = [] } = useQuery({
    queryKey: ['agent-memory', 'history', id, chatKey],
    queryFn: ({ signal }) =>
      host.api.request<{ record: MemoryRecord; changedAt: number }[]>(
        `/api/memory/records/${enc(id)}/history?chatKey=${enc(chatKey)}`,
        { signal },
      ),
  });
  return (
    <ol>
      {data.map((item) => (
        <li key={item.record.revision}>
          {new Date(item.changedAt).toLocaleString()}：{item.record.status} · {item.record.text}
        </li>
      ))}
    </ol>
  );
}

function MemoryPanel({ context }: SlotProps) {
  const host = useHost();
  const chatKey = String(context.chatKey);
  const [personId, setPersonId] = useState('');
  const [scope, setScope] = useState<'chat' | 'chat_person' | 'person'>('chat');
  const [tier, setTier] = useState<'medium' | 'long'>('medium');
  const [key, setKey] = useState('');
  const [text, setText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [sourceIds, setSourceIds] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = () => {
    setNotice('');
    void host.queries.invalidateQueries({ queryKey: ['agent-memory'] });
  };
  const fail = (error: unknown) => setNotice(error instanceof Error ? error.message : String(error));
  const records = useQuery({
    queryKey: ['agent-memory', 'records', chatKey, personId],
    queryFn: ({ signal }) =>
      host.api.request<MemoryRecord[]>(
        `/api/memory/records?chatKey=${enc(chatKey)}${personId ? `&personId=${enc(personId)}` : ''}`,
        { signal },
      ),
    refetchInterval: 5000,
  });
  const notes = useQuery({
    queryKey: ['agent-memory', 'notes', chatKey],
    queryFn: ({ signal }) =>
      host.api.request<ScratchpadNote[]>(`/api/memory/notes?chatKey=${enc(chatKey)}`, { signal }),
    refetchInterval: 5000,
  });
  const status = useQuery({
    queryKey: ['agent-memory', 'status'],
    queryFn: ({ signal }) =>
      host.api.request<{ provider: string; ready: boolean; pending: number; error?: string }>(
        '/api/memory/status',
        { signal },
      ),
    refetchInterval: 5000,
  });
  const create = (event: FormEvent) => {
    event.preventDefault();
    const now = Date.now();
    void host.api
      .request('/api/memory/records', {
        method: 'POST',
        body: JSON.stringify({
          scope,
          tier,
          chatKey: scope === 'person' ? null : chatKey,
          personId: scope === 'chat' ? null : personId,
          key,
          text,
          visibility: scope === 'person' ? 'cross_chat' : 'chat_only',
          sensitive: false,
          confidence: 1,
          importance: 0.5,
          pinned: false,
          sources: [],
          origin: 'admin',
          expiresAt: tier === 'medium' ? now + 30 * DAY : null,
        }),
      })
      .then(() => {
        setText('');
        setKey('');
        refresh();
      })
      .catch(fail);
  };
  const createNote = (event: FormEvent) => {
    event.preventDefault();
    const ids = sourceIds
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
    void host.api
      .request('/api/memory/notes', {
        method: 'POST',
        body: JSON.stringify({ chatKey, text: noteText, sourceIds: ids }),
      })
      .then(() => {
        setNoteText('');
        setSourceIds('');
        refresh();
      })
      .catch(fail);
  };
  return (
    <div className="form-stack">
      <div className="row">
        <h3>分层记忆</h3>
        <small>
          索引 {status.data?.provider ?? '…'} · {status.data?.ready ? '可用' : '待就绪'} · 待同步{' '}
          {status.data?.pending ?? '…'}
        </small>
      </div>
      <label>
        查看成员 QQ 号（留空显示当前会话）
        <input
          value={personId}
          onChange={(event) => setPersonId(event.target.value.trim())}
          placeholder="QQ 号"
        />
      </label>
      {records.data?.length ? (
        records.data.map((record) => (
          <RecordCard key={record.id} record={record} refresh={refresh} fail={fail} chatKey={chatKey} />
        ))
      ) : (
        <div className="empty">当前范围暂无记忆。</div>
      )}
      <form className="form-stack" onSubmit={create}>
        <h3>人工添加记忆</h3>
        <div className="row">
          <select
            aria-label="记忆维度"
            value={scope}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            <option value="chat">会话</option>
            <option value="chat_person">会话成员</option>
            <option value="person">个人通用</option>
          </select>
          <select
            aria-label="记忆期限"
            value={tier}
            onChange={(event) => setTier(event.target.value as typeof tier)}
          >
            <option value="medium">中期</option>
            <option value="long">长期</option>
          </select>
        </div>
        {scope !== 'chat' && (
          <input
            aria-label="成员 QQ 号"
            value={personId}
            onChange={(event) => setPersonId(event.target.value.trim())}
            placeholder="成员 QQ 号"
            required
          />
        )}
        <input
          aria-label="事实键"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="事实键（如：称呼偏好）"
          required
        />
        <textarea
          aria-label="新记忆内容"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="简短、可核对的事实或摘要"
          required
        />
        <button className="primary" type="submit">
          添加记忆
        </button>
      </form>
      <section className="form-stack">
        <h3>会话暂存记事本</h3>
        {notes.data?.map((note) => (
          <article className="panel form-stack" key={note.id}>
            <p>{note.text}</p>
            <small>
              到期 {new Date(note.expiresAt).toLocaleString()} · 整理 {note.promotion} · 来源{' '}
              {note.sourceIds.join(', ') || '无'}
            </small>
            <div className="row">
              <button
                type="button"
                onClick={() => {
                  const changed = window.prompt('修改暂存内容', note.text);
                  if (changed === null) return;
                  void host.api
                    .request(`/api/memory/notes/${enc(note.id)}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ chatKey, patch: { text: changed } }),
                    })
                    .then(refresh)
                    .catch(fail);
                }}
              >
                编辑
              </button>
              {!note.important && (
                <button
                  type="button"
                  onClick={() =>
                    void host.api
                      .request(`/api/memory/notes/${enc(note.id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ chatKey, patch: { important: true } }),
                      })
                      .then(refresh)
                      .catch(fail)
                  }
                >
                  标记重要并整理
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  void host.api
                    .request(`/api/memory/notes/${enc(note.id)}?chatKey=${enc(chatKey)}`, {
                      method: 'DELETE',
                    })
                    .then(refresh)
                    .catch(fail)
                }
              >
                删除
              </button>
            </div>
          </article>
        ))}
        <form className="form-stack" onSubmit={createNote}>
          <textarea
            aria-label="暂存内容"
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="需暂存的想法或待办"
            required
          />
          <input
            aria-label="来源消息 ID"
            value={sourceIds}
            onChange={(event) => setSourceIds(event.target.value)}
            placeholder="来源消息本地 ID，逗号分隔（重要项整理需要）"
          />
          <button type="submit">添加暂存</button>
        </form>
      </section>
      {notice && <div role="alert">{notice}</div>}
    </div>
  );
}

export default defineClientPlugin({
  id: 'agent-memory',
  setup(ctx) {
    ctx.slot('conversation.detail.tabs', {
      id: 'memory',
      title: '记忆与暂存',
      order: 40,
      component: MemoryPanel,
    });
  },
});
