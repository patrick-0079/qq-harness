import { Action } from '@qq-harness/client-sdk';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Drawer, useHost } from '@qq-harness/client-sdk';
import {
  runStatusLabel,
  textContent,
  type RunDetail,
  type RunTraceEvent,
  type ContentPart,
  type Archive,
} from '@qq-harness/contracts';
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const labels: Record<string, string> = {
  arguments: '调用参数',
  args: '已解析参数',
  result: '执行结果',
  error: '错误',
  content: '内容',
  messages: '消息',
  body: '请求体',
  usage: '模型用量',
  input: '输入 Token',
  output: '输出 Token',
  model: '模型',
  round: '轮次',
  text: '正文',
  id: '标识',
  name: '名称',
  sent: '已发送',
  failed: '失败项',
  messageIds: '消息 ID',
  note: '说明',
};
function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value == null) return <span className="muted">无</span>;
  if (typeof value === 'string') {
    let parsed: unknown;
    if (/^[\[{]/.test(value.trim()))
      try {
        parsed = JSON.parse(value);
      } catch {}
    return parsed && depth < 4 ? (
      <Value value={parsed} depth={depth + 1} />
    ) : (
      <div className="detail-text">{value}</div>
    );
  }
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value))
    return (
      <div className="detail-array">
        {value.map((item, i) => (
          <div key={i}>
            <small>{value.length > 1 ? `#${i + 1}` : ''}</small>
            <Value value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  const item = object(value);
  if (item.type === 'image_url') {
    const url = String(object(item.image_url).url ?? '');
    return /^data:image\/(?:png|jpeg|gif|webp);base64,/.test(url) ? (
      <img className="detail-media" src={url} alt="本轮模型图片输入" />
    ) : (
      <div className="detail-text">图片引用：{url}</div>
    );
  }
  if (item.type === 'video_url')
    return <div className="notice">已记录原生视频输入，可导出原始记录查看。</div>;
  if (item.role && 'content' in item)
    return (
      <div className="model-message">
        <div className="message-role">
          {String(item.role)}
          {item.tool_call_id ? <small> · {String(item.tool_call_id)}</small> : null}
        </div>
        {Array.isArray(item.content) ? (
          <Value value={item.content} depth={depth + 1} />
        ) : (
          <div className="detail-text">
            {textContent(item.content as string | ContentPart[] | null)}
          </div>
        )}
        {item.tool_calls ? <Value value={item.tool_calls} depth={depth + 1} /> : null}
      </div>
    );
  if (depth > 6) return <pre>{JSON.stringify(value, null, 2)}</pre>;
  return (
    <dl className="detail-fields">
      {Object.entries(item).map(([key, val]) => (
        <div key={key}>
          <dt>{labels[key] ?? key}</dt>
          <dd>
            <Value value={val} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Event({ event, events }: { event: RunTraceEvent; events: RunTraceEvent[] }) {
  const data = object(event.data),
    { settings, ...triggerData } = data;
  const result =
    event.kind === 'tool.call'
      ? events.find((e) => e.parentId === event.id && e.kind === 'tool.result')
      : undefined;
  return (
    <details
      className={`timeline-step ${result?.status ?? event.status ?? ''}`}
      open={['trigger', 'error'].includes(event.kind)}
    >
      <summary>
        <span className="step-dot" />
        <time>{new Date(event.at).toLocaleTimeString()}</time>
        <strong>{event.title}</strong>
        <span className="pill">
          {event.kind.startsWith('model')
            ? '模型'
            : event.kind.startsWith('tool')
              ? '工具'
              : event.kind === 'context'
                ? '上下文'
                : event.kind === 'error'
                  ? '错误'
                  : '运行'}
        </span>
        {(result?.durationMs ?? event.durationMs) != null ? (
          <small>{((result?.durationMs ?? event.durationMs)! / 1000).toFixed(2)} 秒</small>
        ) : null}
      </summary>
      <div className="step-content">
        {event.kind === 'trigger' && settings !== undefined ? (
          <>
            <Value value={triggerData} />
            <details className="run-settings-snapshot">
              <summary>本轮配置快照</summary>
              <Value value={settings} />
            </details>
          </>
        ) : (
          <Value value={event.data} />
        )}
        {result ? (
          <>
            <h4>执行结果 · {result.status === 'failed' ? '失败' : '完成'}</h4>
            <Value value={result.data} />
          </>
        ) : null}
      </div>
    </details>
  );
}
export function RunDetails({
  id,
  close,
  fallback,
  embedded = false,
}: {
  id: string;
  close: () => void;
  fallback?: Archive;
  embedded?: boolean;
}) {
  const host = useHost(),
    [tab, setTab] = useState('timeline'),
    [notice, setNotice] = useState('');
  const { data, error } = useQuery({
    queryKey: ['run-inspector', 'detail', id],
    queryFn: ({ signal }) =>
      host.api.request<RunDetail>(`/api/run-details/${encodeURIComponent(id)}`, { signal }),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1000 : false),
  });
  const events = data?.events ?? [],
    selected =
      tab === 'context'
        ? events.filter((e) => e.kind === 'context' || e.kind === 'model.request')
        : tab === 'tools'
          ? events.filter((e) => e.kind === 'tool.call')
          : events.filter((e) => e.kind !== 'tool.result');
  const content = (
    <>
      <div className="run-detail-meta">
        <span className="run-detail-id">
          对话 ID：<code title={id}>{id}</code>
        </span>
        <Action
          onClick={() =>
            void navigator.clipboard
              .writeText(id)
              .then(() => setNotice('对话ID已复制'))
              .catch(() => setNotice('复制失败，请选中ID复制'))
          }
        >
          复制对话ID
        </Action>
      </div>
      <div className="run-detail-summary">
        <span className="pill">{data ? runStatusLabel(data.status) : '加载中'}</span>
        {data ? (
          <span>
            {new Date(data.startedAt).toLocaleString()} ·{' '}
            {((data.endedAt ?? Date.now()) - data.startedAt) / 1000} 秒
          </span>
        ) : null}
        {notice && <span role="status">{notice}</span>}
      </div>
      <div className="run-detail-toolbar">
        <div className="tabs" role="tablist">
          {Object.entries({
            timeline: '时间线',
            context: '模型上下文',
            tools: '工具调用',
            raw: '原始数据',
          }).map(([key, label]) => (
            <Action role="tab" aria-selected={tab === key} key={key} onClick={() => setTab(key)}>
              {label}
            </Action>
          ))}
        </div>
        <Action
          aria-label="导出完整记录"
          disabled={!data}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], {
                type: 'application/json',
              }),
            );
            const a = document.createElement('a');
            a.href = url;
            a.download = `run-${id}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          导出
        </Action>
      </div>
      {error ? (
        <>
          <div className="notice" role="alert">
            {error.message}。旧记录未保存的提示词和调用详情无法补齐。
          </div>
          {fallback ? (
            <>
              <h3>历史摘要 · {runStatusLabel(fallback.status)}</h3>
              <p>{fallback.reason}</p>
              {fallback.trace.map((event, i) => (
                <details className="timeline-step" key={i}>
                  <summary>{event.type}</summary>
                  <Value value={event.text} />
                </details>
              ))}
            </>
          ) : null}
        </>
      ) : !data ? (
        <div className="empty">正在读取完整运行详情…</div>
      ) : tab === 'raw' ? (
        <>
          <div className="toolbar">
            <Action
              onClick={() =>
                void navigator.clipboard
                  .writeText(JSON.stringify(data, null, 2))
                  .then(() => setNotice('已复制'))
                  .catch(() => setNotice('复制失败，可使用导出记录'))
              }
            >
              复制 JSON
            </Action>
          </div>
          <pre className="raw-detail">{JSON.stringify(data, null, 2)}</pre>
        </>
      ) : (
        <div className="timeline">
          {selected.map((event) => (
            <Event key={event.id} event={event} events={events} />
          ))}
          {!selected.length ? <div className="empty">当前没有该类调用</div> : null}
        </div>
      )}
    </>
  );
  return embedded ? (
    <section className="run-detail-inline" role="region" aria-label="运行详情">
      {content}
    </section>
  ) : (
    <Drawer title="运行详情" onClose={close} className="run-detail-drawer">
      {content}
    </Drawer>
  );
}
