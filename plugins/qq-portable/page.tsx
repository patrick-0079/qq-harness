import { Action } from '@qq-harness/client-sdk';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useHost } from '@qq-harness/client-sdk';
import type { QqPortableSettings, QqPortableStatus, StatusDto } from '@qq-harness/contracts';

const labels = {
  unconfigured: '等待配置',
  ready: '等待启动',
  starting: '正在启动',
  running: '运行中',
  external: '已在外部运行',
  stopping: '正在停止',
  failed: '启动失败',
};

export function QqPortablePage() {
  const host = useHost();
  const [draft, setDraft] = useState<QqPortableSettings>();
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const settings = useQuery({
    queryKey: ['qq-portable', 'settings'],
    queryFn: ({ signal }) =>
      host.api.request<QqPortableSettings>('/api/qq-portable/settings', {
        signal,
      }),
  });
  const status = useQuery({
    queryKey: ['qq-portable', 'status'],
    queryFn: ({ signal }) => host.api.request<QqPortableStatus>('/api/qq-portable/status', { signal }),
    refetchInterval: busy ? 1000 : 5000,
  });
  const connection = useQuery({
    queryKey: ['qq-portable', 'connection'],
    queryFn: ({ signal }) => host.api.request<StatusDto>('/api/status', { signal }),
    refetchInterval: 5000,
  });
  useEffect(() => {
    if (settings.data && !dirty) setDraft(settings.data);
  }, [settings.data, dirty]);
  const current = status.data;
  const running = current?.phase === 'running' || current?.phase === 'external';
  const connected = connection.data?.adapter.kind === 'onebot' && connection.data.adapter.connected;
  const change = (key: keyof QqPortableSettings, value: string) => {
    if (draft) {
      setDraft({ ...draft, [key]: value });
      setDirty(true);
    }
  };
  const save = async () => {
    const value = await host.api.request<QqPortableSettings>('/api/qq-portable/settings', {
      method: 'PATCH',
      body: JSON.stringify(draft),
    });
    setDraft(value);
    setDirty(false);
    await settings.refetch();
  };
  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await action();
      setNotice(success);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      await status.refetch();
      setBusy(false);
    }
  };
  const failure =
    error ||
    settings.error?.message ||
    status.error?.message ||
    (current?.phase === 'failed' ? current.message : '');
  return (
    <div className="qq-portable-page">
      <div className="qq-summary">
        <article>
          <span>程序文件</span>
          <strong>{current?.installed ? '已就绪' : '待配置'}</strong>
          <small>{current?.version ? `QQ ${current.version}` : '填写便携 QQ 安装目录'}</small>
        </article>
        <article>
          <span>QQ 进程</span>
          <strong>{running ? '正在运行' : busy ? '处理中' : '未运行'}</strong>
          <small>
            {current?.pid
              ? `PID ${current.pid} · ${current.owned ? '由工作台管理' : '外部实例'}`
              : '启动后在 QQ 窗口登录'}
          </small>
        </article>
        <article>
          <span>消息连接</span>
          <strong>{connected ? '已连接' : '等待连接'}</strong>
          <small>{connected ? 'OneBot 通道已就绪' : 'SnowLuma 就绪并登录后连接'}</small>
        </article>
      </div>
      {failure && (
        <div className="qq-feedback is-error" role="alert">
          <strong>QQ 尚未成功启动</strong>
          <span>{failure}</span>
        </div>
      )}
      {notice && !failure && (
        <div className="qq-feedback" role="status">
          {notice}
        </div>
      )}
      <div className="qq-main-grid">
        <section className="panel qq-launch-panel">
          <div className="qq-launch-intro">
            <div className="qq-app-icon" aria-hidden="true">
              Q
            </div>
            <div>
              <h2>运行便携 QQ</h2>
              <p>程序与登录数据各自保存在独立目录。</p>
            </div>
            <span
              className={`qq-state ${current?.phase === 'failed' ? 'is-error' : running ? 'is-running' : ''}`}
            >
              <i />
              {current ? labels[current.phase] : '检查中'}
            </span>
          </div>
          <div className="qq-runtime-info">
            <span>当前版本</span>
            <strong>{current?.version || '未检测到'}</strong>
            <span>管理状态</span>
            <strong>
              {current?.owned
                ? '工作台正在管理此实例'
                : current?.phase === 'external'
                  ? '由外部程序启动'
                  : '尚未启动实例'}
            </strong>
          </div>
          <div className="qq-actions">
            <Action
              className="primary"
              disabled={
                busy ||
                !current?.allowLaunch ||
                (!current.installed && !dirty) ||
                running ||
                current?.phase === 'stopping'
              }
              onClick={() =>
                void perform(async () => {
                  if (dirty) await save();
                  await host.api.request('/api/qq-portable/launch', {
                    method: 'POST',
                  });
                }, 'QQ 已启动，请在 QQ 窗口完成登录。')
              }
            >
              {busy ? '正在处理…' : '启动便携 QQ'}
            </Action>
            <Action
              disabled={busy || !current?.owned}
              onClick={() =>
                void perform(
                  () =>
                    host.api.request('/api/qq-portable/stop', {
                      method: 'POST',
                    }),
                  '便携 QQ 已停止。',
                )
              }
            >
              停止便携 QQ
            </Action>
          </div>
          <p className="qq-note">
            {!current?.allowLaunch
              ? '当前为演示模式；真实启动仅在 Windows live 实例开放。'
              : current.phase === 'external'
                ? '已检测到外部实例，请在其原窗口中操作。'
                : dirty
                  ? '启动时会先保存你修改的目录。'
                  : '启动成功后会出现 QQ 登录窗口；运行中不代表账号已经登录。'}
          </p>
        </section>
        <aside className="panel qq-steps">
          <h2>连接只需三步</h2>
          <ol>
            <li>
              <b>1</b>
              <div>
                <strong>准备 SnowLuma</strong>
                <p>选择内部托管模式并启动运行时。</p>
                <Link to="/snowluma">前往 SnowLuma →</Link>
              </div>
            </li>
            <li className={running ? 'done' : ''}>
              <b>2</b>
              <div>
                <strong>启动便携 QQ</strong>
                <p>点击启动，等待 QQ 窗口出现。</p>
              </div>
            </li>
            <li className={connected ? 'done' : ''}>
              <b>3</b>
              <div>
                <strong>登录你的账号</strong>
                <p>在 QQ 窗口完成登录，消息连接会自动更新。</p>
              </div>
            </li>
          </ol>
        </aside>
      </div>
      {draft && (
        <form
          className="panel qq-directory-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(save, '便携 QQ 设置已保存。');
          }}
        >
          <div className="section-heading">
            <div>
              <h2>运行目录</h2>
              <p>已有默认路径时，可以直接启动。</p>
            </div>
            {dirty && <span className="qq-draft">有未保存修改</span>}
          </div>
          <div className="qq-directory-fields">
            <label>
              便携 QQ 程序目录
              <input
                value={draft.directory}
                disabled={current?.owned}
                onChange={(event) => change('directory', event.target.value)}
              />
              <small>包含 QQ.exe 的目录</small>
            </label>
            <label>
              便携 QQ 数据目录
              <input
                value={draft.dataDirectory}
                disabled={current?.owned}
                onChange={(event) => change('dataDirectory', event.target.value)}
              />
              <small>单独保存登录和用户数据</small>
            </label>
          </div>
          <div className="qq-directory-footer">
            <p>使用不同的绝对目录，避免与日常 QQ 共用数据。</p>
            <Action disabled={busy || current?.owned || !dirty}>保存便携 QQ 设置</Action>
          </div>
        </form>
      )}
    </div>
  );
}
