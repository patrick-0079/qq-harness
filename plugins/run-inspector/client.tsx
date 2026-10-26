import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost, type SlotProps } from '@qq-harness/client-sdk';
import type { Archive } from '@qq-harness/contracts';

function Trace({ context }: SlotProps) {
  const host = useHost();
  const key = String(context.chatKey);
  const { data = [] } = useQuery({
    queryKey: ['run-inspector', 'trace', key],
    queryFn: ({ signal }) =>
      host.api.request<Archive[]>(`/api/archives?chat=${encodeURIComponent(key)}`, { signal }),
  });
  return (
    <div className="trace-list">
      {data.length ? (
        data.map((archive) => (
          <details key={archive.id} open>
            <summary>
              {new Date(archive.startedAt).toLocaleTimeString()} · {archive.status} · {archive.sent} 条发送
            </summary>
            <small>{archive.reason}</small>
            {archive.trace.map((event, index) => (
              <div className="trace-event" key={index}>
                <span className="pill">{event.type}</span>
                <pre>{event.text}</pre>
              </div>
            ))}
          </details>
        ))
      ) : (
        <div className="empty">尚无执行轨迹</div>
      )}
    </div>
  );
}
function Cancel({ context }: SlotProps) {
  const host = useHost();
  const [pending, setPending] = useState(false);
  if (!context.runId) return null;
  return (
    <button
      className="danger"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void host.api
          .request(`/api/runs/${String(context.runId)}/cancel`, { method: 'POST' })
          .catch((error) => (context.onError as (message: string) => void)?.(error.message))
          .finally(() => setPending(false));
      }}
    >
      终止运行
    </button>
  );
}
export default defineClientPlugin({
  id: 'run-inspector',
  requires: ['console-chats'],
  setup(ctx) {
    ctx.slot('conversation.detail.tabs', { id: 'trace', title: '执行轨迹', order: 50, component: Trace });
    ctx.slot('conversation.detail.header-actions', { id: 'cancel', component: Cancel });
  },
});
