import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost, type SlotProps } from '@qq-harness/client-sdk';
import type {
  ContainerSettings,
  ContainerEngineStatus,
  ContainerInfo,
  ContainerJob,
} from '@qq-harness/contracts';
import './client.css';

type Snapshot = { settings: ContainerSettings; engine: ContainerEngineStatus; containers: ContainerInfo[] };
function Containers({ context = {} }: Partial<SlotProps>) {
  const host = useHost();
  const { data } = useQuery({
    queryKey: ['container-console', 'status'],
    queryFn: ({ signal }) => host.api.request<Snapshot>('/api/containers/status', { signal }),
  });
  const [draft, setDraft] = useState<ContainerSettings>();
  const [dirty, setDirty] = useState(false);
  const [chat, setChat] = useState(String(context.chatKey ?? ''));
  const chatKey = context.chatKey ? String(context.chatKey) : chat;
  const [command, setCommand] = useState('pwd');
  const [background, setBackground] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [output, setOutput] = useState('');
  const [deleting, setDeleting] = useState('');
  useEffect(() => {
    if (!dirty && data) setDraft(data.settings);
  }, [data, dirty]);
  const validChat = /^(group|private):[0-9]+$/.test(chatKey);
  const { data: jobs = [] } = useQuery({
    queryKey: ['container-console', 'jobs', chatKey],
    enabled: validChat,
    queryFn: ({ signal }) =>
      host.api.request<ContainerJob[]>(`/api/containers/sessions/${encodeURIComponent(chatKey)}/jobs`, {
        signal,
      }),
    refetchInterval: 2000,
  });
  const perform = async (fn: () => Promise<unknown>, message: string) => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await fn();
      setNotice(message);
      await host.queries.invalidateQueries();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  if (!data || !draft) return <div className="empty">加载容器配置…</div>;
  const enabled = data.engine.allowOperations && data.settings.enabled;
  const change = <K extends keyof ContainerSettings>(name: K, value: ContainerSettings[K]) => {
    setDirty(true);
    setDraft({ ...draft, [name]: value });
  };
  return (
    <div className="container-console">
      <div className="page-heading">
        <div>
          <h1>容器</h1>
          <p>为会话创建独立容器，供 Agent 执行命令和操作文件。</p>
        </div>
        <span className="pill">{data.engine.engine ?? '未连接'}</span>
      </div>
      <div role="status">{notice || data.engine.message}</div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      {!context.chatKey && (
        <form
          className="container-fields"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              const saved = await host.api.request<ContainerSettings>('/api/containers/settings', {
                method: 'PATCH',
                body: JSON.stringify(draft),
              });
              setDraft(saved);
              setDirty(false);
            }, '容器设置已保存');
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => change('enabled', e.target.checked)}
            />
            启用容器功能
          </label>
          <label>
            容器引擎
            <select
              aria-label="容器引擎"
              value={draft.engine}
              onChange={(e) => change('engine', e.target.value as ContainerSettings['engine'])}
            >
              <option value="auto">自动检测</option>
              <option value="podman">Podman</option>
              <option value="docker">Docker</option>
            </select>
          </label>
          <label>
            容器 CLI 绝对路径
            <input
              aria-label="容器 CLI 绝对路径"
              value={draft.binaryPath}
              onChange={(e) => change('binaryPath', e.target.value)}
              placeholder="留空使用 PATH"
            />
          </label>
          <label>
            容器镜像
            <input
              aria-label="容器镜像"
              value={draft.image}
              onChange={(e) => change('image', e.target.value)}
            />
          </label>
          <label>
            内存上限 MB
            <input
              type="number"
              min="64"
              max="32768"
              value={draft.memoryMb}
              onChange={(e) => change('memoryMb', Number(e.target.value))}
            />
          </label>
          <label>
            CPU 上限
            <input
              type="number"
              min="0.1"
              max="32"
              step="0.1"
              value={draft.cpus}
              onChange={(e) => change('cpus', Number(e.target.value))}
            />
          </label>
          <label>
            进程数上限
            <input
              type="number"
              min="16"
              max="4096"
              value={draft.pids}
              onChange={(e) => change('pids', Number(e.target.value))}
            />
          </label>
          <label>
            容器网络
            <select
              value={draft.network}
              onChange={(e) => change('network', e.target.value as ContainerSettings['network'])}
            >
              <option value="none">关闭网络</option>
              <option value="bridge">桥接网络</option>
            </select>
          </label>
          <label>
            命令超时 ms
            <input
              type="number"
              min="1000"
              max="600000"
              value={draft.timeoutMs}
              onChange={(e) => change('timeoutMs', Number(e.target.value))}
            />
          </label>
          <button disabled={pending}>保存容器设置</button>
        </form>
      )}
      <div className="container-actions">
        <label>
          会话标识
          <input
            aria-label="容器会话标识"
            value={chatKey}
            readOnly={Boolean(context.chatKey)}
            onChange={(e) => setChat(e.target.value)}
            placeholder="group:123 或 private:456"
          />
        </label>
        <button
          disabled={pending || !enabled || !validChat}
          onClick={() =>
            void perform(
              () =>
                host.api.request('/api/containers/bindings', {
                  method: 'POST',
                  body: JSON.stringify({ chatKey }),
                }),
              '会话容器已创建并启动',
            )
          }
        >
          创建会话容器
        </button>
      </div>
      <div className="container-list">
        {data.containers.map((row) => (
          <div className="container-row" key={row.chatKey}>
            <div>
              <strong>{row.chatKey}</strong>
              <small>
                {row.name} · {row.engine} · {row.status}
              </small>
              <small>{row.image}</small>
            </div>
            <div className="container-actions">
              <button
                disabled={pending || !enabled || row.running}
                onClick={() =>
                  void perform(
                    () =>
                      host.api.request(`/api/containers/sessions/${encodeURIComponent(row.chatKey)}/start`, {
                        method: 'POST',
                      }),
                    '容器已启动',
                  )
                }
              >
                启动
              </button>
              <button
                disabled={pending || !data.engine.allowOperations || !row.running}
                onClick={() =>
                  void perform(
                    () =>
                      host.api.request(`/api/containers/sessions/${encodeURIComponent(row.chatKey)}/stop`, {
                        method: 'POST',
                      }),
                    '容器已停止',
                  )
                }
              >
                停止
              </button>
              {deleting !== row.chatKey ? (
                <button
                  disabled={pending || !data.engine.allowOperations}
                  onClick={() => setDeleting(row.chatKey)}
                >
                  删除容器
                </button>
              ) : (
                <>
                  <span>将删除容器及内部文件</span>
                  <button
                    className="danger"
                    disabled={pending}
                    onClick={() =>
                      void perform(async () => {
                        await host.api.request(
                          `/api/containers/sessions/${encodeURIComponent(row.chatKey)}`,
                          { method: 'DELETE' },
                        );
                        setDeleting('');
                      }, '容器已删除')
                    }
                  >
                    确认删除
                  </button>
                  <button onClick={() => setDeleting('')}>取消</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void perform(
            async () => {
              const result = await host.api.request(
                `/api/containers/sessions/${encodeURIComponent(chatKey)}/exec`,
                { method: 'POST', body: JSON.stringify({ command, run_in_background: background }) },
              );
              setOutput(JSON.stringify(result, null, 2));
            },
            background ? '后台任务已提交' : '命令已执行',
          );
        }}
      >
        <label>
          容器命令
          <textarea aria-label="容器命令" value={command} onChange={(e) => setCommand(e.target.value)} />
        </label>
        <div className="container-actions">
          <label>
            <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
            后台运行
          </label>
          <button
            disabled={
              pending || !enabled || !validChat || !data.containers.some((row) => row.chatKey === chatKey)
            }
          >
            执行容器命令
          </button>
        </div>
      </form>
      {output && <pre className="container-output">{output}</pre>}
      <h2>当前会话任务</h2>
      {jobs.length === 0 && <div className="empty">尚无后台任务</div>}
      {jobs.map((job) => (
        <details key={job.id} open={job.status === 'running'}>
          <summary>
            {job.status} · {job.command.slice(0, 120)}
          </summary>
          <small>{job.id}</small>
          <pre className="container-output">
            {job.stdout}
            {job.stderr}
            {job.error}
          </pre>
          {job.truncated && <small>输出已截断</small>}
          {job.status === 'running' && (
            <button
              disabled={pending}
              onClick={() =>
                void perform(
                  () =>
                    host.api.request(
                      `/api/containers/sessions/${encodeURIComponent(chatKey)}/jobs/${job.id}/cancel`,
                      { method: 'POST' },
                    ),
                  '任务已取消，容器已停止',
                )
              }
            >
              取消容器任务
            </button>
          )}
        </details>
      ))}
    </div>
  );
}
export default defineClientPlugin({
  id: 'container-console',
  requires: ['console-chats'],
  setup(ctx) {
    ctx.page({
      id: 'containers',
      path: '/containers',
      title: '容器',
      icon: '▣',
      order: 45,
      component: Containers,
    });
    ctx.slot('conversation.detail.tabs', {
      id: 'containers',
      title: '容器',
      order: 60,
      component: Containers,
    });
  },
});
