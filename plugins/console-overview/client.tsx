import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost, Slot } from '@qq-harness/client-sdk';
import type { Archive, StatusDto } from '@qq-harness/contracts';

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
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OVERVIEW</span>
          <h1>运行总览</h1>
          <p>查看运行状态，连接能力，观察每一次对话。</p>
        </div>
        <span className="pill positive">{data?.demo ? '演示模式 · 零模型费用' : 'OneBot 连接模式'}</span>
      </div>
      <div className="hero">
        <div>
          <span className="eyebrow">YOUR AGENT, YOUR WAY</span>
          <h2>
            一副骨架。
            <br />
            无限种可能。
          </h2>
          <p>
            模型、消息接入、工具和界面都由插件组成。
            <br />
            在插件页面自由组合你的运行环境。
          </p>
        </div>
        <div className="orb">
          <span>Q</span>
          <i />
          <b />
        </div>
      </div>
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
                    <td>{archive.chatKey}</td>
                    <td>
                      <span className={`pill ${archive.status === 'completed' ? 'positive' : ''}`}>
                        {archive.status}
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
    ctx.page({ id: 'overview', path: '/', title: '运行总览', icon: '◈', order: 0, component: Overview });
  },
});
