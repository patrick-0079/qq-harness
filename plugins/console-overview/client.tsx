import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost, Slot } from '@qq-harness/client-sdk';
import { runStatusLabel, type Archive, type StatusDto, type ChatDirectoryEntry } from '@qq-harness/contracts';

function Overview() {
  const host = useHost();
  const { data } = useQuery({
    queryKey: ['console-overview', 'status'],
    queryFn: ({ signal }) => host.api.request<StatusDto>('/api/status', { signal }),
  });
  const { data: archives = [] } = useQuery({
    queryKey: ['console-overview', 'archives'],
    queryFn: ({ signal }) => host.api.request<Archive[]>('/api/archives', { signal }),
  });
  const { data: chats = [] } = useQuery({
    queryKey: ['console-chats', 'chats'],
    queryFn: ({ signal }) => host.api.request<ChatDirectoryEntry[]>('/api/chats', { signal }),
  });
  return (
    <>
      <div className="metrics">
        <article>
          <span>可用插件</span>
          <strong>{data?.plugins.filter((plugin) => plugin.status === 'active').length ?? '—'}</strong>
          <small>独立装配与生命周期</small>
        </article>
        <article>
          <span>正在处理</span>
          <strong>{data?.runs.filter((run) => run.status === 'running').length ?? 0}</strong>
          <small>同会话串行，跨会话并发</small>
        </article>
        <article>
          <span>已归档运行</span>
          <strong>{archives.length}</strong>
          <small>可追踪的执行记录</small>
        </article>
        <article>
          <span>消息适配器</span>
          <strong className="metric-word">{data?.adapter.connected ? '已连接' : '未连接'}</strong>
          <small>{data?.adapter.kind ?? '等待就绪'}</small>
        </article>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>最近运行</h2>
          <span className="muted">实时更新</span>
        </div>
        {!archives.length ? (
          <div className="empty">还没有运行记录。在「会话」中发送一条演示消息。</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>会话</th>
                  <th>结果</th>
                  <th>实际发送</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {archives.slice(0, 8).map((archive) => (
                  <tr key={archive.id}>
                    <td>
                      <strong>
                        {chats.find((chat) => chat.chatKey === archive.chatKey)?.displayName ??
                          archive.chatKey}
                      </strong>
                      <br />
                      <small className="muted">{archive.chatKey}</small>
                    </td>
                    <td>
                      <span className={`pill ${archive.status === 'completed' ? 'positive' : ''}`}>
                        {runStatusLabel(archive.status)}
                      </span>
                    </td>
                    <td>{archive.sent} 条</td>
                    <td>{new Date(archive.startedAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Slot point="overview.summary.extra" />
    </>
  );
}
export default defineClientPlugin({
  id: 'console-overview',
  setup(ctx) {
    ctx.defineSlot('overview.summary.extra');
    ctx.page({
      id: 'overview',
      path: '/',
      title: '运行总览',
      icon: 'dashboard',
      order: 0,
      component: Overview,
    });
  },
});
