import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Action,
  Drawer,
  Markdown,
  dialogs,
  confirmDiscardChanges,
  useHost,
  type SlotProps,
} from '@qq-harness/client-sdk';
import type {
  MemoryRecord,
  MemoryRequest,
  ScratchpadNote,
  MemoryConsolidationStatus,
} from '@qq-harness/contracts';
import { ChatSettingsPanel } from '../console-chats/settings.js';
const enc = encodeURIComponent;
const labels = { short: '短期', medium: '中期文档', long: '长期文档', scratchpad: '草稿本' };
const states: Record<MemoryRequest['status'], string> = {
  queued: '已受理，等待处理',
  running: '记忆 Agent 处理中',
  needs_clarification: '需要补充说明',
  completed: '已完成',
  failed: '处理失败',
  cancelled: '已取消',
};

function History({ item, chatKey }: { item: MemoryRecord; chatKey: string }) {
  const host = useHost();
  const query = useQuery({
    queryKey: ['agent-memory', 'history', item.id, item.revision],
    queryFn: ({ signal }) =>
      host.api.request<{ record: MemoryRecord; changedAt: number }[]>(
        `/api/memory/records/${enc(item.id)}/history?chatKey=${enc(chatKey)}`,
        { signal },
      ),
  });
  return (
    <details>
      <summary>来源与版本历史</summary>
      <p>
        {item.sources
          .map(
            (s) =>
              `${s.chatKey} / ${s.localId ? `消息 localId=${s.localId}` : `草稿 ${s.noteId} r${s.noteRevision}`}`,
          )
          .join('、') || '人设初始化或用户维护申请'}
      </p>
      {query.data?.slice(0, 8).map((entry, i, all) => (
        <article className="memory-diff" key={`${entry.record.id}/${entry.record.revision}`}>
          <strong>
            r{entry.record.revision} · {new Date(entry.changedAt).toLocaleString()}
          </strong>
          {all[i + 1] && all[i + 1]!.record.text !== entry.record.text ? (
            <>
              <del>{all[i + 1]!.record.text}</del>
              <ins>{entry.record.text}</ins>
            </>
          ) : (
            <p>{entry.record.text}</p>
          )}
        </article>
      ))}
    </details>
  );
}

export function MemoryWorkspace({ context }: SlotProps) {
  const host = useHost(),
    chatKey = String(context.chatKey);
  const [page, setPage] = useState(() =>
    new URLSearchParams(window.location.search).get('memoryPage') === 'settings' ? 'settings' : 'manage',
  );
  const [tier, setTier] = useState<keyof typeof labels>('short'),
    [filter, setFilter] = useState(''),
    [number, setNumber] = useState(1);
  const [instruction, setInstruction] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false),
    [viewing, setViewing] = useState<MemoryRecord | ScratchpadNote>();
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const concrete = chatKey !== 'default';
  const query = useQuery({
    queryKey: ['agent-memory', 'workspace', chatKey, tier],
    enabled: concrete && page === 'manage',
    queryFn: ({ signal }) =>
      host.api.request<(MemoryRecord | ScratchpadNote)[]>(
        tier === 'scratchpad'
          ? `/api/memory/notes?chatKey=${enc(chatKey)}`
          : `/api/memory/records?chatKey=${enc(chatKey)}&tier=${tier}`,
        { signal },
      ),
  });
  const tasks = useQuery({
    queryKey: ['agent-memory', 'requests', chatKey],
    enabled: concrete && page === 'manage',
    queryFn: ({ signal }) =>
      host.api.request<MemoryRequest[]>(`/api/memory/requests?chatKey=${enc(chatKey)}`, { signal }),
    refetchInterval: 1500,
  });
  const schedule = useQuery({
    queryKey: ['agent-memory', 'schedule', chatKey],
    enabled: concrete && page === 'manage',
    queryFn: ({ signal }) =>
      host.api.request<MemoryConsolidationStatus>(`/api/memory/consolidation?chatKey=${enc(chatKey)}`, {
        signal,
      }),
    refetchInterval: 5000,
  });
  useEffect(() => {
    void host.queries.invalidateQueries(
      { queryKey: ['agent-memory', 'workspace', chatKey] },
      { cancelRefetch: false },
    );
  }, [tasks.data, chatKey, host]);
  const submit = async (text: string, ids = targetIds) => {
    setPending(true);
    setNotice('');
    try {
      const explicit =
        !ids.length &&
        text
          .trim()
          .match(
            /^(?:请)?(?:遗忘|忘记|删除|新增|更新|更正|融合|记录|记住|整理)?\s*(短期|中期|长期|草稿本)/u,
          )?.[1];
      const requestTier = explicit
        ? ({ 短期: 'short', 中期: 'medium', 长期: 'long', 草稿本: 'scratchpad' } as const)[
            explicit as '短期' | '中期' | '长期' | '草稿本'
          ]
        : tier;
      const task = await host.api.request<MemoryRequest>('/api/memory/requests', {
        method: 'POST',
        body: JSON.stringify({
          chatKey,
          tier: requestTier,
          instruction: text,
          targetIds: ids,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setNotice(`申请已受理：${task.id}。完成后显示实际修改结果。`);
      setInstruction('');
      setTargetIds([]);
      setViewing(undefined);
      await host.queries.invalidateQueries({ queryKey: ['agent-memory'] }, { cancelRefetch: false });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  const rows = (query.data ?? []).filter((r) =>
    `${'key' in r ? r.key : ''} ${r.text}`.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div className="memory-workspace form-stack">
      <div className="tabs" role="tablist" aria-label="记忆子页面">
        {[
          ['manage', '记忆管理'],
          ['settings', '记忆设置'],
        ].map(([id, label]) => (
          <Action
            role="tab"
            key={id}
            aria-selected={page === id}
            onClick={async () => {
              if (!(await confirmDiscardChanges())) return;
              setPage(id!);
              const url = new URL(window.location.href);
              url.searchParams.set('memoryPage', id!);
              window.history.replaceState(null, '', url);
            }}
          >
            {label}
          </Action>
        ))}
      </div>
      {page === 'settings' ? (
        <ChatSettingsPanel context={context} initialSection="memory" memoryOnly />
      ) : !concrete ? (
        <p className="empty">请选择具体会话管理记忆，默认记忆设置可在“设置”子页面修改。</p>
      ) : (
        <>
          <form
            className="memory-request-form form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(instruction);
            }}
          >
            <label>
              向记忆 Agent 提交申请
              <textarea
                aria-label="记忆维护申请"
                rows={2}
                value={instruction}
                required
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="例如：遗忘中期记忆：火箭速度 2 km/s；将火箭最新速度更正为 10 km/s"
              />
            </label>
            <div className="row">
              <Action type="submit" disabled={pending || !instruction.trim()}>
                提交维护申请
              </Action>
              <small>新增、更正、融合和遗忘由独立 Agent 异步处理。</small>
            </div>
          </form>
          <div className="tabs" role="tablist" aria-label="记忆层级">
            {(Object.entries(labels) as [keyof typeof labels, string][]).map(([id, label]) => (
              <Action
                role="tab"
                key={id}
                aria-selected={tier === id}
                onClick={() => {
                  setTier(id);
                  setNumber(1);
                  setFilter('');
                  setTargetIds([]);
                }}
              >
                {label}
              </Action>
            ))}
          </div>
          <div className="toolbar">
            <input
              aria-label="搜索记忆"
              placeholder="搜索当前层级内容或主题"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setNumber(1);
              }}
            />
            {tier !== 'scratchpad' && (
              <Action
                onClick={async () => {
                  try {
                    const task = await host.api.request<{ id: string }>('/api/memory/consolidate', {
                      method: 'POST',
                      body: JSON.stringify({ chatKey, tier }),
                    });
                    setNotice('整理申请已受理：' + task.id);
                    await tasks.refetch();
                  } catch (e) {
                    setNotice(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                整理{labels[tier]}
              </Action>
            )}
          </div>
          {tier !== 'scratchpad' && schedule.data?.stages[tier].error && (
            <div className="error" role="alert">
              <strong>{labels[tier]}整理失败</strong>
              <p>{schedule.data.stages[tier].error}</p>
              <small>下方任务记录可查看依据、详情和重试。</small>
            </div>
          )}
          {query.isPending ? (
            <p role="status">正在加载{labels[tier]}…</p>
          ) : query.error ? (
            <div role="alert">
              {query.error.message}
              <Action onClick={() => void query.refetch()}>重试加载</Action>
            </div>
          ) : !rows.length ? (
            <p className="empty">当前范围暂无{labels[tier]}。</p>
          ) : (
            <div className="table-wrap memory-content">
              <table>
                <thead>
                  <tr>
                    <th>主题／事项</th>
                    <th>内容</th>
                    <th>版本</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice((number - 1) * 20, number * 20).map((r) => (
                    <tr key={r.id}>
                      <td>
                        {'key' in r ? (r.document?.title ?? r.key) : '草稿'}
                        {'document' in r && r.document?.role === 'persona' && (
                          <span className="pill">可演进人设</span>
                        )}
                      </td>
                      <td>{r.text.slice(0, 240)}</td>
                      <td>r{r.revision}</td>
                      <td>
                        <Action onClick={() => setViewing(r)}>查看／申请修改</Action>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination">
            <span>共 {rows.length} 项</span>
            <Action disabled={number === 1} onClick={() => setNumber(number - 1)}>
              上一页
            </Action>
            <span>{number}</span>
            <Action disabled={number * 20 >= rows.length} onClick={() => setNumber(number + 1)}>
              下一页
            </Action>
          </div>
          {notice && <p role="status">{notice}</p>}
          <section className="memory-tasks">
            <h3>维护申请与结果</h3>
            {tasks.error && <p role="alert">{tasks.error.message}</p>}
            {tasks.data?.slice(0, 30).map((task) => (
              <article className={`memory-task ${task.status === 'failed' ? 'error' : ''}`} key={task.id}>
                <div className="row">
                  <strong>{states[task.status]}</strong>
                  <small>{new Date(task.updatedAt).toLocaleString()}</small>
                </div>
                <p>{task.instruction}</p>
                {task.summary && <p>{task.summary}</p>}
                {task.error && (
                  <div role="alert">
                    <strong>记忆维护失败</strong>
                    <p>{task.error}</p>
                  </div>
                )}
                {task.changes.map((c, i) => (
                  <details key={c.id + i}>
                    <summary>
                      {{ create: '新增', update: '更正', forget: '遗忘', supersede: '融合替换' }[c.action] ??
                        c.action}{' '}
                      · {c.id}
                    </summary>
                    {c.before && <del>{c.before}</del>}
                    {c.after && <ins>{c.after}</ins>}
                  </details>
                ))}
                {['failed', 'cancelled', 'needs_clarification'].includes(task.status) && (
                  <Action
                    onClick={async () => {
                      const answer = await dialogs.prompt({
                        title: '补充记忆申请',
                        label:
                          task.status === 'needs_clarification'
                            ? (task.summary ?? '补充说明')
                            : '补充说明后重试',
                        initialValue: '请重新处理原申请',
                      });
                      if (!answer) return;
                      try {
                        await host.api.request(`/api/memory/requests/${enc(task.id)}/clarify`, {
                          method: 'POST',
                          body: JSON.stringify({ chatKey, instruction: answer }),
                        });
                        await tasks.refetch();
                      } catch (e) {
                        setNotice(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    补充说明／重试
                  </Action>
                )}
                <details>
                  <summary>任务技术详情</summary>
                  <pre>
                    {JSON.stringify({ id: task.id, status: task.status, error: task.error }, null, 2)}
                  </pre>
                </details>
              </article>
            ))}
          </section>
        </>
      )}
      {viewing && (
        <Drawer
          title={'key' in viewing ? (viewing.document?.title ?? viewing.key) : '草稿本内容'}
          onClose={() => setViewing(undefined)}
        >
          <div className="form-stack memory-editor">
            <Markdown>{viewing.text}</Markdown>
            {'key' in viewing && <History item={viewing} chatKey={chatKey} />}
            <label>
              修改说明
              <textarea
                aria-label="针对该记忆的修改说明"
                rows={4}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="描述希望更正、融合或遗忘的内容"
              />
            </label>
            <div className="row">
              <Action
                disabled={pending || !instruction.trim()}
                onClick={() => void submit(instruction, [viewing.id])}
              >
                提交修改申请
              </Action>
              <Action
                disabled={pending}
                onClick={() => void submit('遗忘这条记忆：' + viewing.text, [viewing.id])}
              >
                申请遗忘
              </Action>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
