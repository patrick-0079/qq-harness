import { Action } from '@qq-harness/client-sdk';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Drawer, useHost } from '@qq-harness/client-sdk';
export function ContactPicker({
  close,
  selected,
}: {
  close: () => void;
  selected: (key: string) => void;
}) {
  const host = useHost(),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState('all'),
    [manual, setManual] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const query = useQuery({
    queryKey: ['console-chats', 'contacts'],
    queryFn: ({ signal }) =>
      host.api.request<{
        connected: boolean;
        items: { chatKey: string; name: string }[];
      }>('/api/chats/contacts', { signal }),
  });
  const add = async (chatKey: string) => {
    setError('');
    if (!/^(group|private):[0-9]+$/.test(chatKey)) {
      setError('请输入 group:群号 或 private:QQ号');
      return;
    }
    setPending(true);
    try {
      await host.api.request('/api/chats', {
        method: 'POST',
        body: JSON.stringify({ chatKey }),
      });
      await host.queries.invalidateQueries();
      selected(chatKey);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const rows =
    query.data?.items.filter(
      (row) =>
        (kind === 'all' || row.chatKey.startsWith(kind + ':')) &&
        `${row.name} ${row.chatKey}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <Drawer title="添加会话" className="contact-drawer" onClose={close}>
      <p className="muted">从 QQ 群与好友中选择，添加后采用当前默认配置。</p>
      <div className="toolbar">
        <input
          aria-label="搜索群或好友"
          placeholder="搜索名称或 QQ 号码"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="联系人类型" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">群与好友</option>
          <option value="group">群聊</option>
          <option value="private">好友</option>
        </select>
      </div>
      {error || query.error ? (
        <p className="error" role="alert">
          {error || query.error?.message}
        </p>
      ) : null}
      <div className="contact-list">
        {rows.map((row) => (
          <Action
            key={row.chatKey}
            className="contact-row"
            disabled={pending}
            onClick={() => void add(row.chatKey)}
          >
            <span
              className={`directory-avatar ${row.chatKey.startsWith('group:') ? 'group' : 'private'}`}
            >
              {row.name.slice(0, 1)}
            </span>
            <span>
              <strong>{row.name}</strong>
              <small>
                {row.chatKey.startsWith('group:') ? '群聊' : '好友'} · {row.chatKey.split(':')[1]}
              </small>
            </span>
            <span className="text-button">添加</span>
          </Action>
        ))}
        {!rows.length ? (
          <div className="empty">
            {query.isFetching
              ? '正在读取 QQ 联系人…'
              : query.data?.connected
                ? '没有匹配的群或好友'
                : 'QQ 尚未连接，可在下方手工添加'}
          </div>
        ) : null}
      </div>
      <h3 className="settings-divider">手工添加</h3>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void add(manual.trim());
        }}
      >
        <input
          aria-label="新会话标识"
          placeholder="group:群号 或 private:QQ号"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <Action className="primary" disabled={pending || !manual.trim()}>
          打开会话
        </Action>
      </form>
    </Drawer>
  );
}
