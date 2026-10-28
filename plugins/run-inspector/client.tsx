import { Action } from '@qq-harness/client-sdk';
import { RunDetails } from './details.js';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost, type SlotProps } from '@qq-harness/client-sdk';
import {
  runStatusLabel,
  type Archive,
  type PageResult,
  type RunDto,
  type ConversationQueueDto,
} from '@qq-harness/contracts';
function RecordBrowser({ context, traces = false }: SlotProps & { traces?: boolean }) {
  const host = useHost(),
    key = String(context.chatKey),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [selected, setSelected] = useState<Archive>(),
    [detailId, setDetailId] = useState(''),
    [error, setError] = useState(''),
    [listCollapsed, setListCollapsed] = useState(false),
    [expanded, setExpanded] = useState(false);
  const search = new URLSearchParams({
    chat: key,
    page: String(page),
    pageSize: '30',
    query,
    status,
    ...(from ? { from: String(new Date(from).getTime()) } : {}),
    ...(to ? { to: String(new Date(to).getTime() + 86400000 - 1) } : {}),
  });
  const { data, error: loadError } = useQuery({
    queryKey: ['run-inspector', 'archives', key, search.toString()],
    queryFn: ({ signal }) =>
      host.api.request<PageResult<Archive>>(`/api/archives?${search}`, {
        signal,
      }),
  });
  const { data: runs = [] } = useQuery({
    queryKey: ['run-inspector', 'active-runs', key],
    queryFn: ({ signal }) => host.api.request<RunDto[]>('/api/runs', { signal }),
  });
  const keys = new Set(Array.isArray(context.scopeKeys) ? context.scopeKeys.map(String) : [key]);
  const { data: queue } = useQuery({
    queryKey: ['run-inspector', 'queue', key],
    queryFn: ({ signal }) =>
      host.api.request<{ items: ConversationQueueDto[] }>('/api/conversation/queue', { signal }),
  });
  const interrupted = (queue?.items ?? [])
    .filter((e) => keys.has(e.chatKey) && ['interrupted', 'cancelled'].includes(e.status))
    .slice(-20)
    .reverse();
  const live = runs.filter((r) => keys.has(r.partitionKey) && ['queued', 'running'].includes(r.status));
  const cancel = (id: string) =>
    void host.api
      .request(`/api/runs/${id}/cancel`, { method: 'POST' })
      .then(() => host.queries.invalidateQueries())
      .catch((e) => setError(e.message));
  const retry = (archiveId: string) =>
    void host.api
      .request(`/api/archives/${encodeURIComponent(archiveId)}/retry`, {
        method: 'POST',
      })
      .then(() => host.queries.invalidateQueries())
      .catch((e) => setError(e.message));
  return (
    <div className={`form-stack records-workspace ${expanded ? 'records-expanded' : ''}`}>
      {(error || loadError) && (
        <p className="error" role="alert">
          {error || loadError?.message}
        </p>
      )}
      {live.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>当前任务</th>
              <th>会话</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {live.map((r) => (
              <tr key={r.id}>
                <td>{r.mode}</td>
                <td>{r.partitionKey}</td>
                <td>{runStatusLabel(r.status)}</td>
                <td>
                  <Action onClick={() => setDetailId(r.id)}>查看详情</Action>
                  <Action onClick={() => cancel(r.id)}>取消任务</Action>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {interrupted.length > 0 && (
        <details className="panel">
          <summary>队列与中断记录（{interrupted.length}）</summary>
          <p className="muted">
            已执行的任务在重启后不会自动重放。请先核对发送与运行记录，再使用会话的手动重试。
          </p>
          <table>
            <thead>
              <tr>
                <th>提交时间</th>
                <th>状态</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              {interrupted.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{e.status === 'interrupted' ? '已中断' : '已取消'}</td>
                  <td>{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <div className="toolbar">
        <Action onClick={() => setListCollapsed(!listCollapsed)}>
          {listCollapsed ? '展开运行列表' : '收起运行列表'}
        </Action>
        <Action onClick={() => setExpanded(!expanded)}>{expanded ? '退出展开' : '展开查看'}</Action>
        <input
          aria-label="搜索运行记录"
          value={query}
          placeholder="搜索运行内容或原因"
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="运行状态筛选"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">全部结果</option>
          {['completed', 'failed', 'cancelled', 'silent', 'unverified', 'exhausted'].map((s) => (
            <option key={s} value={s}>
              {runStatusLabel(s)}
            </option>
          ))}
        </select>
        <details className="run-date-filter">
          <summary>日期范围{from || to ? ' · 已筛选' : ''}</summary>
          <div className="run-date-popover">
            <label>
              开始日期
              <input
                aria-label="运行开始日期"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              结束日期
              <input
                aria-label="运行结束日期"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <Action
              type="button"
              onClick={() => {
                setFrom('');
                setTo('');
                setPage(1);
              }}
            >
              清除日期
            </Action>
          </div>
        </details>
      </div>
      <div
        className={`run-browser ${listCollapsed ? 'run-list-collapsed' : ''} ${!data?.items.length ? 'run-browser-empty' : ''}`}
      >
        <section className="run-list" aria-label="对话运行列表">
          {data?.items.map((a) => (
            <div
              className={'run-list-item ' + ((detailId || data.items[0]?.id) === a.id ? 'selected' : '')}
              key={a.id}
            >
              <Action
                className="run-select"
                aria-label={'查看记录 ' + a.id}
                onClick={() => {
                  setSelected(a);
                  setDetailId(a.id);
                }}
              >
                <strong>{new Date(a.startedAt).toLocaleString()}</strong>
                <span className="row">
                  <span className="pill">{runStatusLabel(a.status)}</span>
                  <small>
                    {Math.round((a.endedAt - a.startedAt) / 1000)} 秒 · 发送 {a.sent}
                  </small>
                </span>
                <code>{a.id}</code>
                <small>
                  Token {a.usage.input} / {a.usage.output}
                </small>
              </Action>
              {a.status === 'failed' && a.sent === 0 && (!a.mode || a.mode === 'agent.basic') && (
                <Action onClick={() => retry(a.id)}>重试</Action>
              )}
            </div>
          ))}
        </section>
        <section className="run-detail-pane">
          {detailId || data?.items[0]?.id ? (
            <RunDetails
              key={detailId || data?.items[0]?.id}
              embedded
              fallback={data?.items.find((a) => a.id === (detailId || data.items[0]?.id)) ?? selected}
              id={detailId || data!.items[0]!.id}
              close={() => setDetailId('')}
            />
          ) : (
            <p className="empty">尚无符合条件的运行记录</p>
          )}
        </section>
      </div>
      {!data?.items.length && <p className="empty">尚无符合条件的运行记录</p>}
      <div className="pagination">
        <span>共 {data?.total ?? 0} 条</span>
        <Action disabled={page === 1} onClick={() => setPage(page - 1)}>
          上一页
        </Action>
        <span>{page}</span>
        <Action disabled={page * 30 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>
          下一页
        </Action>
      </div>
    </div>
  );
}
function Trace(props: SlotProps) {
  return <RecordBrowser {...props} traces />;
}
function Records(props: SlotProps) {
  return <RecordBrowser {...props} />;
}
function Cancel({ context }: SlotProps) {
  const host = useHost(),
    [pending, setPending] = useState(false);
  if (!context.runId) return null;
  return (
    <Action
      className="danger"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void host.api
          .request(`/api/runs/${String(context.runId)}/cancel`, {
            method: 'POST',
          })
          .catch((e) => (context.onError as (message: string) => void)?.(e.message))
          .finally(() => setPending(false));
      }}
    >
      终止运行
    </Action>
  );
}
export default defineClientPlugin({
  id: 'run-inspector',
  requires: ['console-chats'],
  setup(ctx) {
    ctx.slot('conversation.detail.tabs', {
      id: 'runs',
      title: '运行记录',
      order: 0,
      component: Records,
    });
    ctx.slot('conversation.detail.header-actions', {
      id: 'cancel',
      component: Cancel,
    });
  },
});
