import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost, Action, Toggle } from '@qq-harness/client-sdk';
import type { OperationsSettings, OperationLog } from '@qq-harness/contracts';
function Operations() {
  const host = useHost(),
    [tab, setTab] = useState('status'),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false);
  const endpoint =
    tab === 'status'
      ? 'status'
      : tab === 'resources'
        ? 'resources'
        : tab === 'usage'
          ? 'usage'
          : tab === 'logs'
            ? 'logs'
            : 'settings';
  const query = useQuery({
    queryKey: ['operations', endpoint],
    queryFn: ({ signal }) => host.api.request<any>(`/api/operations/${endpoint}`, { signal }),
  });
  const [draft, setDraft] = useState<OperationsSettings>(),
    [ids, setIds] = useState(''),
    [balances, setBalances] = useState<any[]>();
  useEffect(() => {
    if (tab === 'settings' && query.data) {
      setDraft(query.data);
      setIds(query.data.allowedIds.join(', '));
    }
  }, [tab, query.data]);
  const save = async () => {
    if (!draft) return;
    setPending(true);
    setNotice('');
    try {
      await host.api.request('/api/operations/settings', {
        method: 'PATCH',
        body: JSON.stringify({ ...draft, allowedIds: ids.split(/[,，;；\s]+/).filter(Boolean) }),
      });
      setNotice('设置已保存');
      await query.refetch();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const balance = async () => {
    setPending(true);
    setNotice('');
    try {
      setBalances(
        (
          await host.api.request<{ items: any[] }>('/api/operations/balances', {
            method: 'POST',
            body: JSON.stringify({ channel: 'all' }),
          })
        ).items,
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const data = query.data;
  return (
    <section className="panel operations-page">
      <nav className="tabs" aria-label="运维功能">
        {[
          ['status', '状态与诊断'],
          ['resources', '资源占用'],
          ['usage', '用量与余额'],
          ['logs', '操作记录'],
          ['settings', '设置'],
        ].map(([key, title]) => (
          <Action
            key={key}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key!);
              setNotice('');
            }}
          >
            {title}
          </Action>
        ))}
      </nav>
      <div className="form-stack" style={{ padding: 16 }}>
        {notice ? <p role="status">{notice}</p> : null}
        {query.isPending ? (
          <p role="status">正在加载运维数据…</p>
        ) : query.isError ? (
          <div role="alert">
            运维数据加载失败：{query.error.message}
            <Action onClick={() => void query.refetch()}>重试</Action>
          </div>
        ) : null}
        {data && tab === 'status' ? (
          <>
            <div className="metrics">
              <article>
                <span>系统</span>
                <strong className="metric-word">{data.presence.state === 'online' ? '在线' : '下线'}</strong>
                <small>下线时记忆维护继续</small>
              </article>
              <article>
                <span>OneBot</span>
                <strong className="metric-word">{data.adapter.connected ? '已连接' : '未连接'}</strong>
              </article>
              <article>
                <span>插件</span>
                <strong>{data.plugins.active}</strong>
                <small>{data.plugins.failed.length} 项失败</small>
              </article>
              <article>
                <span>任务</span>
                <strong>{data.tasks.running}</strong>
                <small>{data.tasks.queued} 项排队</small>
              </article>
            </div>
            <p>
              QQ：{data.qq.state} · SnowLuma：{data.snowluma.state} · 记忆 Agent：
              {data.memory.active ? '可用' : '不可用'}（{data.memory.running} 项执行）
            </p>
            <p>
              最近切换：{data.presence.changedAt ? new Date(data.presence.changedAt).toLocaleString() : '无'}{' '}
              · 来源：{data.presence.source} · 操作者：{data.presence.actor}
            </p>
            {data.presence.reason ? <p>原因：{data.presence.reason}</p> : null}
            <h3>异常摘要</h3>
            {data.plugins.failed.map((p: any) => (
              <p key={p.id}>插件 {p.id} 加载失败</p>
            ))}
            {data.recentFailures.length ? (
              <ul>
                {data.recentFailures.map((r: any) => (
                  <li key={r.id}>
                    {r.mode ?? '运行'} · 失败 · {new Date(r.at).toLocaleString()}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">暂无失败运行</p>
            )}
            <Action onClick={() => void query.refetch()}>刷新状态</Action>
          </>
        ) : null}
        {data && tab === 'resources' ? (
          <>
            <div className="metrics">
              {[
                ['CPU', `${data.cpuPercent.toFixed(1)}%`],
                [
                  '主机内存',
                  `${(data.memoryUsed / 2 ** 30).toFixed(2)} / ${(data.memoryTotal / 2 ** 30).toFixed(2)} GB`,
                ],
                ['后端内存', `${(data.processMemory / 2 ** 20).toFixed(0)} MB`],
                ['运行时长', `${Math.floor(data.uptimeSeconds / 60)} 分钟`],
              ].map(([k, v]) => (
                <article key={k}>
                  <span>{k}</span>
                  <strong style={{ fontSize: 20 }}>{v}</strong>
                </article>
              ))}
            </div>
            <small>采样：{new Date(data.at).toLocaleString()}</small>
            <Action onClick={() => void query.refetch()}>重新采样</Action>
          </>
        ) : null}
        {data && tab === 'usage' ? (
          <>
            <p>{data.source}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间范围</th>
                    <th>运行次数</th>
                    <th>输入 Token</th>
                    <th>输出 Token</th>
                    <th>费用</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.periods).map(([k, v]: [string, any]) => (
                    <tr key={k}>
                      <td>{k === 'today' ? '今日' : k === 'week' ? '近七天' : '近三十天'}</td>
                      <td>{v.runs}</td>
                      <td>{v.input}</td>
                      <td>{v.output}</td>
                      <td>{v.cost === null ? '未知' : `${v.cost} ${v.currency}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <h3>渠道余额与配额</h3>
              <Action disabled={pending} onClick={() => void balance()}>
                {pending ? '查询中…' : '查询已配置渠道'}
              </Action>
            </div>
            <p className="muted">按需查询，成功结果缓存 60 秒；临时失败可立即重试。凭据在设置中填写。</p>
            {balances?.map((r) => (
              <article key={r.channel}>
                <strong>{r.channel}</strong>
                <p>
                  {
                    (
                      {
                        ok: '查询成功',
                        unconfigured: '未配置',
                        timeout: '查询超时',
                        unauthorized: '认证失败',
                        failed: '查询失败',
                      } as any
                    )[r.status]
                  }
                </p>
                {r.lines.map((line: string, i: number) => (
                  <p key={i}>{line}</p>
                ))}
                <small>{new Date(r.at).toLocaleString()}</small>
              </article>
            ))}
          </>
        ) : null}
        {data && tab === 'logs' ? (
          <>
            <Action onClick={() => void query.refetch()}>刷新记录</Action>
            {data.items.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>来源／操作者</th>
                      <th>操作</th>
                      <th>结果</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((r: OperationLog) => (
                      <tr key={r.id}>
                        <td>{new Date(r.at).toLocaleString()}</td>
                        <td>
                          {r.source}／{r.actor}
                        </td>
                        <td>{r.action}</td>
                        <td>{r.status}</td>
                        <td>{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>暂无操作记录</p>
            )}
          </>
        ) : null}
        {tab === 'settings' && draft ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="form-stack"
          >
            <label>
              启用白名单私聊指令{' '}
              <Toggle
                checked={draft.privateEnabled}
                onChange={(e) => setDraft({ ...draft, privateEnabled: e.target.checked })}
              />
            </label>
            <label>
              允许的 QQ 号
              <input aria-label="运维 QQ 白名单" value={ids} onChange={(e) => setIds(e.target.value)} />
            </label>
            <small>仅这些 QQ 的私聊可用，空名单关闭私聊入口。不会自动建立普通会话准入。</small>
            {(['opencodeGoKey', 'deepseekKey', 'glmKey', 'mimoCookie'] as const).map((key) => (
              <label key={key}>
                {
                  {
                    opencodeGoKey: 'OpenCode Go 密钥',
                    deepseekKey: 'DeepSeek 密钥',
                    glmKey: 'GLM 密钥',
                    mimoCookie: 'MiMo Cookie',
                  }[key]
                }
                <input
                  type="password"
                  autoComplete="off"
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                />
              </label>
            ))}
            <label>
              GLM 区域
              <select
                value={draft.glmRegion}
                onChange={(e) => setDraft({ ...draft, glmRegion: e.target.value as 'cn' | 'global' })}
              >
                <option value="cn">国内</option>
                <option value="global">海外</option>
              </select>
            </label>
            <label>
              渠道超时（毫秒）
              <input
                type="number"
                min={5000}
                max={60000}
                value={draft.timeoutMs}
                onChange={(e) => setDraft({ ...draft, timeoutMs: Number(e.target.value) })}
              />
            </label>
            <Action type="submit" disabled={pending}>
              {pending ? '保存中…' : '保存运维设置'}
            </Action>
          </form>
        ) : null}
      </div>
    </section>
  );
}
export default defineClientPlugin({
  id: 'ops-control',
  setup(ctx) {
    ctx.page({
      id: 'operations',
      path: '/operations',
      title: '运维控制台',
      icon: 'tools',
      order: 70,
      component: Operations,
    });
  },
});
