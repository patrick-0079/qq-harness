import { Action } from '@qq-harness/client-sdk';
import { ContactPicker } from './contacts.js';
import { DirectoryList } from './directory.js';
import { ToolManager } from './tools.js';
import { ImagePreview, hasImages, imageCount } from './media.js';
import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  defineClientPlugin,
  Drawer,
  dialogs,
  confirmDiscardChanges,
  PluginBoundary,
  Slot,
  useHost,
  useHostVersion,
  Toggle,
  type SlotProps,
} from '@qq-harness/client-sdk';
import type { ChatDirectoryEntry, StatusDto, StoredMessage, PageResult } from '@qq-harness/contracts';
import { chatInitial } from '@qq-harness/contracts';
import { ChatSettingsPanel } from './settings.js';
const enc = encodeURIComponent;
function Messages({ context }: SlotProps) {
  const [preview, setPreview] = useState<StoredMessage>();
  const host = useHost(),
    key = String(context.chatKey),
    [query, setQuery] = useState(''),
    [sender, setSender] = useState(''),
    [page, setPage] = useState(1),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [unreadOnly, setUnreadOnly] = useState(false);
  const search = new URLSearchParams({
    page: String(page),
    pageSize: '50',
    unread: unreadOnly ? '1' : '0',
    query,
    ...(sender ? { senderId: sender } : {}),
    ...(from ? { from: String(new Date(from).getTime()) } : {}),
    ...(to ? { to: String(new Date(to).getTime() + 86400000 - 1) } : {}),
  });
  const { data, error, isFetching } = useQuery({
    queryKey: ['console-chats', 'messages', key, search.toString()],
    refetchInterval: page === 1 ? 2500 : false,
    queryFn: ({ signal }) =>
      host.api.request<PageResult<StoredMessage>>(`/api/chats/${enc(key)}/messages?${search}`, {
        signal,
      }),
  });
  return (
    <>
      <div className="toolbar">
        <label className="toggle-row">
          只看未读
          <Toggle
            aria-label="只看未读消息"
            checked={unreadOnly}
            onChange={(e) => {
              setUnreadOnly(e.target.checked);
              setPage(1);
            }}
          />
        </label>
        <Action
          onClick={() => {
            setPage(1);
            setQuery('');
            setSender('');
            setFrom('');
            setTo('');
            setUnreadOnly(false);
            void host.queries.invalidateQueries({
              queryKey: ['console-chats', 'messages'],
            });
          }}
        >
          最新消息
        </Action>
        <input
          aria-label="搜索消息"
          placeholder="搜索消息内容"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <input
          aria-label="消息发送人"
          placeholder="发送人 QQ"
          value={sender}
          onChange={(e) => {
            setSender(e.target.value);
            setPage(1);
          }}
        />
        <input
          type="date"
          aria-label="消息开始日期"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(1);
          }}
        />
        <input
          type="date"
          aria-label="消息结束日期"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>发送人</th>
              <th>消息</th>
            </tr>
          </thead>
          <tbody>
            {[...(data?.items ?? [])].reverse().map((m) => (
              <tr key={`${m.chatKey}/${m.localId}`} className={m.self ? 'outgoing' : ''}>
                <td>
                  {new Date(m.timestamp).toLocaleString()}
                  {key === 'default' && <small>{m.chatKey}</small>}
                </td>
                <td>
                  {m.senderName || m.senderId}
                  <small> {m.senderId}</small>
                </td>
                <td>
                  <div className="bubble">
                    {!m.self && !m.read && <span className="unread-badge">未读</span>}
                    {m.text}
                  </div>
                  {hasImages(m) && (
                    <Action className="media-preview-button" onClick={() => setPreview(m)}>
                      查看图片（{imageCount(m)}）
                    </Action>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data?.items.length && <div className="empty">{isFetching ? '加载消息…' : '当前条件暂无消息'}</div>}
      {preview && <ImagePreview message={preview} close={() => setPreview(undefined)} />}
      <div className="pagination">
        <span>
          共 {data?.total ?? 0} 条 · 第 {page} 页
        </span>
        <Action disabled={page === 1} onClick={() => setPage(page - 1)}>
          较新
        </Action>
        <Action disabled={page * 50 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>
          较早
        </Action>
      </div>
    </>
  );
}
function Statistics({ context }: SlotProps) {
  const host = useHost(),
    key = String(context.chatKey);
  const { data, error } = useQuery({
    queryKey: ['console-chats', 'stats', key],
    queryFn: ({ signal }) =>
      host.api.request<{
        chats: number;
        messages: {
          received: number;
          sent: number;
          triggered: number | null;
          daily: { day: string; received: number; sent: number }[];
        };
        runs: number;
        durationMs: number;
        usage: { input: number; output: number };
        cost: number | null;
        costReason: string;
        currency: string | null;
        periods: { today: number; week: number; month: number };
        models: {
          providerId: string;
          model: string;
          input: number;
          output: number;
          cost: number | null;
          currency: string;
        }[];
        tools: Record<string, number>;
        reasons: Record<string, number>;
        triggerProbability: number | null;
      }>(`/api/chats/${enc(key)}/stats`, { signal }),
  });
  if (!data) return <p>{error?.message ?? '加载统计…'}</p>;
  return (
    <div className="form-stack">
      <div className="metric-strip">
        {[
          ['收到消息', data.messages.received],
          ['发送消息', data.messages.sent],
          ['运行次数', data.runs],
          ['模型 Token', data.usage.input + data.usage.output],
        ].map(([label, value]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{Number(value).toLocaleString()}</strong>
          </div>
        ))}
      </div>
      <div className="settings-section-heading">
        <h3>消息趋势 · 最近30天</h3>
        <div className="chart-legend">
          <span>
            <i />
            收到
          </span>
          <span>
            <i className="sent" />
            发送
          </span>
        </div>
      </div>
      {data.messages.daily.length ? (
        <div className="trend-chart" role="img" aria-label="最近30天收发消息趋势">
          {data.messages.daily.map((day, i) => {
            const max = Math.max(1, ...data.messages.daily.map((d) => Math.max(d.received, d.sent)));
            return (
              <div
                className="trend-column"
                key={day.day}
                title={`${day.day}：收到 ${day.received}，发送 ${day.sent}`}
              >
                <i style={{ height: `${(day.received / max) * 100}%` }} />
                <i className="sent" style={{ height: `${(day.sent / max) * 100}%` }} />
                {i % 5 === 0 ? <small>{day.day.slice(5)}</small> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="empty compact">历史消息没有可用的按日趋势数据</p>
      )}
      <details>
        <summary>全部统计指标</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>指标</th>
                <th>数值</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries({
                统计会话: data.chats,
                收到消息: data.messages.received,
                发送消息: data.messages.sent,
                运行次数: data.runs,
                今日运行: data.periods.today,
                最近七天运行: data.periods.week,
                最近三十天运行: data.periods.month,
                '累计运行时长（秒）': Math.round(data.durationMs / 1000),
                '输入 Token': data.usage.input,
                '输出 Token': data.usage.output,
                触发概率:
                  data.triggerProbability === null
                    ? '历史数据不可用'
                    : `${(data.triggerProbability * 100).toFixed(1)}%`,
                费用: data.cost === null ? data.costReason : `${data.cost.toFixed(6)} ${data.currency}`,
              }).map(([label, value]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>按模型的调用用量</summary>
        <table>
          <thead>
            <tr>
              <th>渠道</th>
              <th>模型</th>
              <th>输入／输出 Token</th>
              <th>费用</th>
            </tr>
          </thead>
          <tbody>
            {data.models.map((m, i) => (
              <tr key={i}>
                <td>{m.providerId || '默认'}</td>
                <td>{m.model}</td>
                <td>
                  {m.input} / {m.output}
                </td>
                <td>{m.cost === null ? '未配置计价' : `${m.cost.toFixed(6)} ${m.currency}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.models.length && <p className="muted">历史运行未记录模型明细。</p>}
      </details>
      <table>
        <thead>
          <tr>
            <th>日期</th>
            <th>收到</th>
            <th>发送</th>
          </tr>
        </thead>
        <tbody>
          {data.messages.daily.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.received}</td>
              <td>{d.sent}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-grid">
        {[
          ['工具调用', data.tools],
          ['未回复原因', data.reasons],
        ].map(([title, values]) => (
          <section key={String(title)}>
            <h3>{String(title)}</h3>
            <table>
              <tbody>
                {Object.entries(values as Record<string, number>)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 20)
                  .map(([name, count]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!Object.keys(values as Record<string, number>).length && <p className="muted">暂无记录</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
function ChatPage() {
  const host = useHost();
  useHostVersion();
  const [params, setParams] = useSearchParams();
  const { data: status } = useQuery({
    queryKey: ['console-chats', 'status'],
    queryFn: ({ signal }) => host.api.request<StatusDto>('/api/status', { signal }),
  });
  const routeChatKey = params.get('chat') ?? (status?.demo ? 'group:10001' : 'default');
  const [pendingChatKey, setPendingChatKey] = useState<string>();
  const chatKey = pendingChatKey ?? routeChatKey;
  useEffect(() => {
    if (pendingChatKey === routeChatKey) setPendingChatKey(undefined);
  }, [pendingChatKey, routeChatKey]);
  const selectChat = (key: string) => {
    // Router navigation may commit later than closing the picker. Move actions
    // to the selected chat in the same render so they cannot rename the old one.
    setPendingChatKey(key);
    setParams({ chat: key });
  };
  const [listCollapsed, setListCollapsed] = useState(
    () => localStorage.getItem('qqh-chat-list-collapsed') === '1',
  );
  const [tab, setTab] = useState(() => params.get('tab') ?? 'runs'),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false),
    [sendResults, setSendResults] = useState<{ chatKey: string; id?: string; error?: string }[]>([]),
    [search, setSearch] = useState(''),
    [kind, setKind] = useState('all'),
    [filter, setFilter] = useState('all'),
    [drag, setDrag] = useState<{ x: number; width: number }>(),
    [adding, setAdding] = useState(false),
    [chosen, setChosen] = useState<string[]>([]),
    [width, setWidth] = useState(() => {
      try {
        return Math.max(200, Math.min(520, Number(localStorage.getItem('qqh-chat-width')) || 280));
      } catch {
        return 280;
      }
    });
  useEffect(() => {
    if (!drag) return;
    let latest = drag.width;
    const move = (event: PointerEvent) => {
      latest = Math.max(200, Math.min(520, drag.width + event.clientX - drag.x));
      setWidth(latest);
    };
    const up = () => {
      setDrag(undefined);
      try {
        localStorage.setItem('qqh-chat-width', String(latest));
      } catch {}
    };
    const oldCursor = document.body.style.cursor,
      oldSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.cursor = oldCursor;
      document.body.style.userSelect = oldSelect;
    };
  }, [drag]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const { data: chats = [], error: loadError } = useQuery({
    queryKey: ['console-chats', 'chats'],
    queryFn: ({ signal }) => host.api.request<ChatDirectoryEntry[]>('/api/chats', { signal }),
  });
  const tabs = host.listSlot('conversation.detail.tabs'),
    selected = tabs.find((item) => item.value.id === tab) ?? tabs[0];
  const currentRun = status?.runs.find(
    (run) => run.partitionKey === chatKey && ['running', 'queued'].includes(run.status),
  );
  const context = {
    chatKey,
    aggregate: chatKey === 'default',
    scopeKeys: chatKey === 'default' ? chats.filter((c) => !c.configured).map((c) => c.chatKey) : [chatKey],
    runId: currentRun?.id,
    onError: setError,
  };
  const current = chats.find((c) => c.chatKey === chatKey);
  const refresh = () => void host.queries.invalidateQueries();
  const act = async (fn: () => Promise<unknown>, message = '已保存') => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const patch = (key: string, value: unknown) =>
    act(() =>
      host.api.request(`/api/chats/${enc(key)}`, {
        method: 'PATCH',
        body: JSON.stringify(value),
      }),
    );
  const filtered = chats.filter(
    (c) =>
      (kind === 'all' || c.chatKey.startsWith(kind + ':')) &&
      (filter === 'all' ||
        (filter === 'online'
          ? c.online
          : filter === 'denied'
            ? c.denied
            : filter === 'configured'
              ? c.configured
              : !c.configured)) &&
      `${c.displayName} ${c.name} ${c.chatKey}`.toLowerCase().includes(search.toLowerCase()),
  );
  const batch = async (online: boolean) =>
    act(
      async () => {
        for (const key of chosen)
          await host.api.request(`/api/chats/${enc(key)}`, {
            method: 'PATCH',
            body: JSON.stringify({ online }),
          });
      },
      `已${online ? '上线' : '下线'} ${chosen.length} 个会话`,
    );
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    if (chatKey === 'default') {
      setError('请先选择具体会话');
      return;
    }
    await act(
      async () => {
        const response = await host.api.request<{
          results?: { chatKey: string; id?: string; error?: string }[];
        }>(status?.demo ? '/api/demo/messages' : '/api/chats/send', {
          method: 'POST',
          body: JSON.stringify(status?.demo ? { chatKey, text, atMe: true } : { targets: [chatKey], text }),
        });
        if (response.results) setSendResults(response.results);
        setText('');
      },
      status?.demo ? '演示消息已提交' : '发送任务已提交，可在运行记录查询结果',
    );
  };
  const exportData = () =>
    void act(async () => {
      const data = await host.api.request(`/api/chats/${enc(chatKey)}/export`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `${chatKey.replace(':', '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }, '已导出');
  return (
    <>
      {(error || loadError) && (
        <div className="error" role="alert">
          {error || loadError?.message}
        </div>
      )}
      {notice && (
        <p className="chat-toast" role="status">
          {notice}
        </p>
      )}
      {sendResults.length > 0 && (
        <Drawer title="人工发送结果" onClose={() => setSendResults([])}>
          <div className="section-heading">
            <h3>人工发送结果</h3>
            <Action onClick={() => setSendResults([])}>收起</Action>
          </div>
          <table>
            <thead>
              <tr>
                <th>目标</th>
                <th>结果</th>
              </tr>
            </thead>
            <tbody>
              {sendResults.map((r) => (
                <tr key={r.chatKey}>
                  <td>{r.chatKey}</td>
                  <td>
                    {r.error ||
                      status?.runs.find((run) => run.id === r.id)?.error ||
                      status?.runs.find((run) => run.id === r.id)?.status ||
                      '待处理'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Drawer>
      )}
      <div
        className={`chat-layout ${listCollapsed ? 'chat-list-collapsed' : ''}`}
        style={{ '--chat-width': `${width}px` } as CSSProperties}
      >
        <section className="panel chat-list">
          <Action
            className="sidebar-resizer"
            aria-label="调整会话列表宽度"
            onPointerDown={(e) => {
              e.preventDefault();
              setDrag({ x: e.clientX, width });
            }}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
              e.preventDefault();
              const next = Math.max(200, Math.min(520, width + (e.key === 'ArrowRight' ? 10 : -10)));
              setWidth(next);
              try {
                localStorage.setItem('qqh-chat-width', String(next));
              } catch {}
            }}
          />
          <div className="toolbar">
            <input
              aria-label="搜索会话"
              placeholder="搜索名称或标识"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>
          <div className="toolbar">
            <select
              aria-label="会话类型"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
              }}
            >
              <option value="all">全部类型</option>
              <option value="group">群聊</option>
              <option value="private">私聊</option>
            </select>
            <select
              aria-label="会话状态筛选"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
              }}
            >
              <option value="all">全部状态</option>
              <option value="online">在线</option>
              <option value="denied">黑名单</option>
              <option value="configured">独立配置</option>
              <option value="default">跟随默认</option>
            </select>
          </div>
          <DirectoryList
            chats={filtered}
            current={chatKey}
            chosen={chosen}
            choose={setChosen}
            select={selectChat}
          />
          <div className="new-chat">
            <Action className="primary" onClick={() => setAdding(true)}>
              ＋ 添加会话
            </Action>
            <small>{filtered.length} 个匹配结果</small>
          </div>
          {adding ? <ContactPicker close={() => setAdding(false)} selected={selectChat} /> : null}
          {chosen.length > 0 && (
            <div className="form-stack">
              <small>已选 {chosen.length} 个</small>
              <div className="row">
                <Action disabled={pending} onClick={() => void batch(true)}>
                  批量上线
                </Action>
                <Action disabled={pending} onClick={() => void batch(false)}>
                  批量下线
                </Action>
                <Action
                  disabled={pending}
                  onClick={async () => {
                    const content = await dialogs.prompt({
                      title: '群发消息',
                      label: '消息内容',
                      multiline: true,
                      description: `发送到 ${chosen.length} 个会话：${chosen.map((key) => chats.find((chat) => chat.chatKey === key)?.displayName || key).join('、')}`,
                      confirmLabel: '确认并发送',
                    });
                    if (!content?.trim()) return;
                    void act(
                      () =>
                        host.api
                          .request<{
                            results: {
                              chatKey: string;
                              id?: string;
                              error?: string;
                            }[];
                          }>('/api/chats/send', {
                            method: 'POST',
                            body: JSON.stringify({
                              targets: chosen,
                              text: content,
                            }),
                          })
                          .then((response) => setSendResults(response.results)),
                      '批量发送任务已提交',
                    );
                  }}
                >
                  群发消息
                </Action>
                <Action
                  onClick={async () => {
                    if (
                      !(await dialogs.confirm({
                        title: '移除选中会话？',
                        description: '会话准入与独立配置将被移除，聊天、记忆和运行记录仍会保留。',
                        confirmLabel: '移除会话',
                        danger: true,
                      }))
                    )
                      return;
                    void act(async () => {
                      for (const key of chosen)
                        await host.api.request(`/api/chats/${enc(key)}`, {
                          method: 'DELETE',
                        });
                      setChosen([]);
                    });
                  }}
                >
                  批量移除
                </Action>
              </div>
            </div>
          )}
        </section>
        <section className="panel chat-detail">
          <div className="section-heading">
            <div className="chat-title">
              <h2 title={current?.displayName}>
                {chatKey === 'default'
                  ? '默认会话'
                  : current?.displayName || (chatKey.startsWith('group:') ? '未命名群聊' : '未命名私聊')}
              </h2>
              <span className="muted">
                {chatKey === 'default'
                  ? '统计范围排除独立配置的会话'
                  : `${chatKey} · ${currentRun ? currentRun.status : current?.online === false ? '已下线' : '空闲'}`}
              </span>
            </div>
            <div className="row">
              <Action
                aria-expanded={!listCollapsed}
                onClick={() => {
                  setListCollapsed(!listCollapsed);
                  localStorage.setItem('qqh-chat-list-collapsed', listCollapsed ? '0' : '1');
                }}
              >
                {listCollapsed ? '展开会话列表' : '收起会话列表'}
              </Action>
              {chatKey !== 'default' && (
                <>
                  <Action onClick={() => void patch(chatKey, { pinned: !current?.pinnedAt })}>
                    {current?.pinnedAt ? '取消置顶' : '置顶'}
                  </Action>
                  <Action
                    onClick={async () => {
                      await dialogs.prompt({
                        title: '重命名会话',
                        label: '会话名称',
                        initialValue: current?.alias || '',
                        placeholder: current?.name || '输入便于辨认的名称',
                        allowEmpty: true,
                        maxLength: 160,
                        description: `为「${current?.displayName || '当前会话'}」设置管理名称。`,
                        hint: '留空可恢复 QQ 群名称或好友备注，不会修改 QQ 中的名称。',
                        onSubmit: async (alias) => {
                          await host.api.request(`/api/chats/${enc(chatKey)}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ alias }),
                          });
                          refresh();
                          setNotice('会话名称已更新');
                        },
                      });
                    }}
                  >
                    重命名
                  </Action>
                  <Action onClick={() => void patch(chatKey, { online: !current?.online })}>
                    {current?.online ? '下线' : '上线'}
                  </Action>
                  <details
                    className="action-menu"
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') e.currentTarget.open = false;
                    }}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('button')) e.currentTarget.open = false;
                    }}
                  >
                    <summary>更多 ▾</summary>
                    <div className="menu-items">
                      <Action onClick={() => void patch(chatKey, { denied: !current?.denied })}>
                        {current?.denied ? '解除屏蔽' : '屏蔽'}
                      </Action>
                      <Action
                        onClick={async () => {
                          if (
                            await dialogs.confirm({
                              title: '移除此会话？',
                              description: '移除准入与独立配置，保留聊天、记忆和运行记录。',
                              confirmLabel: '移除会话',
                              danger: true,
                            })
                          )
                            void act(() =>
                              host.api.request(`/api/chats/${enc(chatKey)}`, {
                                method: 'DELETE',
                              }),
                            );
                        }}
                      >
                        移除
                      </Action>
                      <Action
                        onClick={() =>
                          void act(
                            () =>
                              host.api.request(`/api/chats/${enc(chatKey)}/retry`, {
                                method: 'POST',
                              }),
                            '运行已提交',
                          )
                        }
                      >
                        重试处理
                      </Action>
                    </div>
                  </details>
                </>
              )}
              <Action onClick={exportData}>导出记录</Action>
              <Slot point="conversation.detail.header-actions" context={context} />
            </div>
          </div>
          <div className="tabs" role="tablist">
            {tabs.map(({ owner, value }) => (
              <Action
                role="tab"
                aria-selected={selected?.value.id === value.id}
                key={`${owner}/${value.id}`}
                onClick={async () => {
                  if (await confirmDiscardChanges()) {
                    setTab(value.id);
                    const next = new URLSearchParams(params);
                    next.set('tab', value.id);
                    setParams(next, { replace: true });
                  }
                }}
              >
                {value.title}
              </Action>
            ))}
          </div>
          <div className="tab-content">
            {selected && (
              <PluginBoundary key={`${selected.owner}/${selected.value.id}/${chatKey}`} name={selected.owner}>
                <selected.value.component context={context} />
              </PluginBoundary>
            )}
          </div>
          {chatKey !== 'default' && (
            <form className="composer" onSubmit={send}>
              <textarea
                rows={1}
                aria-label={status?.demo ? '演示消息' : '人工消息'}
                placeholder={status?.demo ? '发送演示消息' : '向当前会话发送人工消息'}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="row">
                <small>{status?.demo ? '开发适配器' : '人工发送经过准入检查及发送队列'}</small>
                <Action className="primary" disabled={pending || !text.trim()}>
                  {status?.demo ? '发送消息 ↗' : '发送人工消息'}
                </Action>
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
    ctx.defineSlot('conversation.detail.settings');
    ctx.defineSlot('conversation.detail.header-actions');
    ctx.defineSlot('conversation.list.row-actions');
    ctx.slot('conversation.detail.tabs', {
      id: 'messages',
      title: '消息存档',
      order: 10,
      component: Messages,
    });
    ctx.slot('conversation.detail.tabs', {
      id: 'stats',
      title: '统计',
      order: 80,
      component: Statistics,
    });
    ctx.slot('conversation.detail.tabs', {
      id: 'settings',
      title: '设置',
      order: 100,
      component: ChatSettingsPanel,
    });
    ctx.page({
      id: 'tools',
      path: '/tools',
      title: '内置工具',
      icon: 'tools',
      order: 25,
      component: () => <ToolManager standalone />,
    });
    ctx.page({
      id: 'chats',
      path: '/chats',
      title: '会话',
      icon: 'chats',
      order: 10,
      component: ChatPage,
    });
  },
});
