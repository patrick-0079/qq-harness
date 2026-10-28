import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost, Action } from '@qq-harness/client-sdk';
import type { SystemPresence } from '@qq-harness/contracts';
function Presence() {
  const host = useHost(),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState('');
  const query = useQuery({
    queryKey: ['system', 'presence'],
    queryFn: ({ signal }) => host.api.request<SystemPresence>('/api/system/presence', { signal }),
  });
  const change = async () => {
    if (!query.data || pending) return;
    setPending(true);
    setNotice('');
    try {
      await host.api.request('/api/system/presence', {
        method: 'PUT',
        body: JSON.stringify({
          state: query.data.state === 'online' ? 'offline' : 'online',
          expectedRevision: query.data.revision,
          requestId: crypto.randomUUID(),
        }),
      });
      setNotice(query.data.state === 'online' ? '系统已下线，记忆维护继续' : '系统已上线，历史积压已跳过');
      await host.queries.invalidateQueries();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      await query.refetch();
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="row system-presence" style={{ gap: 6, fontSize: 12, flexWrap: 'nowrap' }}>
      <span
        title="下线后记忆维护仍继续"
        className={`pill ${query.data?.state === 'online' ? 'positive' : ''}`}
      >
        {query.isError
          ? '状态获取失败'
          : query.data?.state === 'online'
            ? '系统在线'
            : query.data
              ? '系统下线'
              : '加载中'}
      </span>
      <Action disabled={pending || !query.data} onClick={() => void change()}>
        {pending ? '处理中…' : query.data?.state === 'offline' ? '系统上线' : '系统下线'}
      </Action>
      {query.isError ? <Action onClick={() => void query.refetch()}>重试</Action> : null}
      {notice ? (
        <span
          role="status"
          className="system-presence-notice"
          style={{
            position: 'fixed',
            right: 16,
            top: 70,
            maxWidth: 'calc(100vw - 32px)',
            padding: 10,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, #ddd)',
            borderRadius: 8,
            zIndex: 1000,
          }}
        >
          {notice}
        </span>
      ) : null}
    </div>
  );
}
export default defineClientPlugin({
  id: 'system-control',
  setup(ctx) {
    ctx.slot('shell.header.actions', { id: 'presence', order: 0, component: Presence });
  },
});
