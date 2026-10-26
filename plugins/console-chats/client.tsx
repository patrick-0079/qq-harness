import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  defineClientPlugin,
  PluginBoundary,
  Slot,
  useHost,
  useHostVersion,
  type SlotProps,
} from '@qq-harness/client-sdk';
import type { ChatSettings, ChatSummary, StatusDto, StoredMessage } from '@qq-harness/contracts';

function Messages({ context }: SlotProps) {
  const host = useHost();
  const chatKey = String(context.chatKey);
  const { data = [] } = useQuery({
    queryKey: ['console-chats', 'messages', chatKey],
    queryFn: ({ signal }) =>
      host.api.request<StoredMessage[]>(`/api/chats/${encodeURIComponent(chatKey)}/messages`, { signal }),
  });
  return (
    <div className="messages">
      {data.length ? (
        data.map((message) => (
          <article
            key={`${message.self}/${message.id}`}
            className={`message ${message.self ? 'outgoing' : ''}`}
          >
            <div className="avatar">{message.self ? 'Q' : message.senderName.slice(0, 1) || '人'}</div>
            <div>
              <div className="message-meta">
                {message.senderName || message.senderId}
                <time>{new Date(message.timestamp).toLocaleTimeString()}</time>
              </div>
              <div className="bubble">{message.text}</div>
            </div>
          </article>
        ))
      ) : (
        <div className="empty">消息会显示在这里。发送一条消息开始体验。</div>
      )}
    </div>
  );
}
function ChatSettingsPanel({ context }: SlotProps) {
  const host = useHost();
  const chatKey = String(context.chatKey);
  const [draft, setDraft] = useState<ChatSettings>();
  const [notice, setNotice] = useState('');
  const query = useQuery({
    queryKey: ['console-chats', 'settings', chatKey],
    queryFn: ({ signal }) =>
      host.api.request<ChatSettings>(`/api/chats/${encodeURIComponent(chatKey)}/settings`, { signal }),
  });
  useEffect(() => {
    setDraft(query.data);
  }, [query.data, chatKey]);
  if (!draft) return <div className="empty">加载设置…</div>;
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        void host.api
          .request(`/api/profiles/${encodeURIComponent(chatKey)}`, {
            method: 'PATCH',
            body: JSON.stringify(draft),
          })
          .then(() => {
            setNotice('已保存会话完整配置快照');
            void host.queries.invalidateQueries();
          })
          .catch((error) => setNotice(String(error)));
      }}
    >
      <label className="toggle-row">
        <span>
          会话在线<small>下线后记录消息，不触发模型；重新上线不补发旧消息。</small>
        </span>
        <input
          type="checkbox"
          checked={draft.online}
          onChange={(event) => setDraft({ ...draft, online: event.target.checked })}
        />
      </label>
      <label>
        触发策略
        <select
          value={draft.trigger}
          onChange={(event) => setDraft({ ...draft, trigger: event.target.value as ChatSettings['trigger'] })}
        >
          <option value="mention">仅 @ 机器人</option>
          <option value="all">所有消息</option>
          <option value="keyword">关键词</option>
        </select>
      </label>
      <label>
        关键词（逗号分隔）
        <input
          value={draft.keywords.join(',')}
          onChange={(event) =>
            setDraft({ ...draft, keywords: event.target.value.split(',').filter(Boolean) })
          }
        />
      </label>
      <label>
        人设
        <textarea
          rows={5}
          value={draft.persona}
          onChange={(event) => setDraft({ ...draft, persona: event.target.value })}
        />
      </label>
      <label>
        暂存记事本最长保留天数（1–90）
        <input
          type="number"
          min="1"
          max="90"
          value={draft.scratchpadMaxDays}
          onChange={(event) => setDraft({ ...draft, scratchpadMaxDays: Number(event.target.value) })}
        />
      </label>
      <div className="row">
        <button className="primary" type="submit">
          保存会话设置
        </button>
        <button
          type="button"
          onClick={() => {
            void host.api
              .request(`/api/profiles/${encodeURIComponent(chatKey)}`, { method: 'DELETE' })
              .then(() => {
                setNotice('已恢复跟随默认设置');
                void host.queries.invalidateQueries();
              });
          }}
        >
          恢复默认
        </button>
        <span role="status">{notice}</span>
      </div>
    </form>
  );
}
function ChatPage() {
  const host = useHost();
  useHostVersion();
  const [params, setParams] = useSearchParams();
  const chatKey = params.get('chat') ?? 'group:10001';
  const [tab, setTab] = useState('messages');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const { data: chats = [] } = useQuery({
    queryKey: ['console-chats', 'chats'],
    queryFn: ({ signal }) => host.api.request<ChatSummary[]>('/api/chats', { signal }),
  });
  const { data: status } = useQuery({
    queryKey: ['console-chats', 'status'],
    queryFn: ({ signal }) => host.api.request<StatusDto>('/api/status', { signal }),
  });
  const tabs = host.listSlot('conversation.detail.tabs');
  const selected = tabs.find((item) => item.value.id === tab) ?? tabs[0];
  const currentRun = status?.runs.find(
    (run) => run.partitionKey === chatKey && ['running', 'queued'].includes(run.status),
  );
  const context = { chatKey, runId: currentRun?.id, onError: setError };
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setPending(true);
    setError('');
    void host.api
      .request('/api/demo/messages', { method: 'POST', body: JSON.stringify({ chatKey, text, atMe: true }) })
      .then(() => {
        setText('');
        void host.queries.invalidateQueries();
      })
      .catch((error) => setError(error.message))
      .finally(() => setPending(false));
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONVERSATIONS</span>
          <h1>会话</h1>
          <p>每一次唤醒都是独立运行，长期信息通过记忆提供。</p>
        </div>
      </div>
      <div className="chat-layout">
        <section className="panel chat-list">
          <div className="section-heading">
            <h2>会话列表</h2>
            <span className="pill">{chats.length}</span>
          </div>
          {[...new Set(['group:10001', ...chats.map((chat) => chat.chatKey)])].map((key) => (
            <div key={key}>
              <button
                className={`chat-item ${key === chatKey ? 'selected' : ''}`}
                key={key}
                onClick={() => setParams({ chat: key })}
              >
                <div className="avatar">{key.startsWith('group') ? '群' : '私'}</div>
                <div>
                  <strong>{key}</strong>
                  <small>
                    {chats.find((chat) => chat.chatKey === key)?.lastText.slice(0, 30) || '开始一段新对话'}
                  </small>
                </div>
              </button>
              <Slot point="conversation.list.row-actions" context={{ chatKey: key }} />
            </div>
          ))}
          <form
            className="new-chat"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get('chat');
              if (/^(group|private):[0-9]+$/.test(String(value))) setParams({ chat: String(value) });
              else setError('请输入 group:群号 或 private:用户号');
            }}
          >
            <input name="chat" placeholder="group:群号" aria-label="新会话标识" />
            <button aria-label="打开会话">＋</button>
          </form>
        </section>
        <section className="panel chat-detail">
          <div className="section-heading">
            <div>
              <h2>{chatKey}</h2>
              <span className="muted">
                {currentRun ? (currentRun.status === 'queued' ? '排队中' : '正在处理') : '等待消息'}
              </span>
            </div>
            <div className="row">
              <Slot point="conversation.detail.header-actions" context={context} />
            </div>
          </div>
          <div className="tabs" role="tablist">
            {tabs.map(({ owner, value }) => (
              <button
                role="tab"
                aria-selected={selected?.value.id === value.id}
                key={`${owner}/${value.id}`}
                onClick={() => setTab(value.id)}
              >
                {value.title}
              </button>
            ))}
          </div>
          <div className="tab-content">
            {selected && (
              <PluginBoundary key={`${selected.owner}/${selected.value.id}`} name={selected.owner}>
                <selected.value.component context={context} />
              </PluginBoundary>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {status?.demo && (
            <form className="composer" onSubmit={send}>
              <textarea
                rows={2}
                aria-label="演示消息"
                placeholder="发送演示消息，体验完整插件运行流程…"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <div className="row">
                <small>仅发送到开发适配器</small>
                <button className="primary" disabled={pending || !text.trim()}>
                  发送消息 ↗
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
export default defineClientPlugin({
  id: 'console-chats',
  setup(ctx) {
    ctx.defineSlot('conversation.detail.tabs');
    ctx.defineSlot('conversation.detail.header-actions');
    ctx.defineSlot('conversation.list.row-actions');
    ctx.slot('conversation.detail.tabs', {
      id: 'messages',
      title: '聊天记录',
      order: 0,
      component: Messages,
    });
    ctx.slot('conversation.detail.tabs', {
      id: 'settings',
      title: '会话设置',
      order: 100,
      component: ChatSettingsPanel,
    });
    ctx.page({ id: 'chats', path: '/chats', title: '会话', icon: '◌', order: 10, component: ChatPage });
  },
});
