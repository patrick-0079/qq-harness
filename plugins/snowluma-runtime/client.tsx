import { Action } from '@qq-harness/client-sdk';
import { Toggle } from '@qq-harness/client-sdk';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost } from '@qq-harness/client-sdk';
import type { PublicConfig, SnowlumaSettings, SnowlumaStatus, SnowlumaLog } from '@qq-harness/contracts';
import './style.css';

function SnowlumaPage() {
  const host = useHost();
  const [draft, setDraft] = useState<SnowlumaSettings>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [httpToken, setHttpToken] = useState('');
  const [onebot, setOnebot] = useState({ wsUrl: '', httpUrl: '' });
  const settings = useQuery({
    queryKey: ['snowluma-runtime', 'settings'],
    queryFn: ({ signal }) => host.api.request<SnowlumaSettings>('/api/snowluma/settings', { signal }),
  });
  const status = useQuery({
    queryKey: ['snowluma-runtime', 'status'],
    queryFn: ({ signal }) => host.api.request<SnowlumaStatus>('/api/snowluma/status', { signal }),
    refetchInterval: 2000,
  });
  const logs = useQuery({
    queryKey: ['snowluma-runtime', 'logs'],
    queryFn: ({ signal }) =>
      host.api.request<{ logs: SnowlumaLog[] }>('/api/snowluma/logs', {
        signal,
      }),
    refetchInterval: 2000,
  });
  const config = useQuery({
    queryKey: ['snowluma-runtime', 'onebot'],
    queryFn: ({ signal }) => host.api.request<PublicConfig>('/api/config', { signal }),
  });
  useEffect(() => {
    if (settings.data && !dirty) setDraft(settings.data);
  }, [settings.data, dirty]);
  useEffect(() => {
    if (config.data)
      setOnebot({
        wsUrl: config.data.onebot.wsUrl,
        httpUrl: config.data.onebot.httpUrl,
      });
  }, [config.data]);
  const run = async (task: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
      setNotice(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      await host.queries.invalidateQueries({ queryKey: ['snowluma-runtime'] });
      setBusy(false);
    }
  };
  const change = (value: SnowlumaSettings) => {
    setDraft(value);
    setDirty(true);
  };
  const save = async () => {
    const value = await host.api.request<SnowlumaSettings>('/api/snowluma/settings', {
      method: 'PATCH',
      body: JSON.stringify(draft),
    });
    setDraft(value);
    setDirty(false);
  };
  if (!draft)
    return <div className="empty">{settings.error ? String(settings.error) : '加载 SnowLuma 插件设置…'}</div>;
  const current = status.data;
  const phaseLabels = {
    unconfigured: '等待配置',
    stopped: '等待启动',
    external: '外部服务运行中',
    starting: '正在启动',
    running: '运行中',
    stopping: '正在停止',
    failed: '启动失败',
  };
  const launchHint = !current?.allowLaunch
    ? '当前为演示模式，不能启动真实运行时。'
    : draft.mode !== 'managed'
      ? '当前为外部模式。若要在此启动，请在下方选择“内部托管”。'
      : !draft.acceptEula || !draft.acceptPrivacy
        ? '启动前请在下方阅读并勾选 EULA 与隐私政策；点击启动时会保存设置。'
        : !current.installed && !dirty
          ? '请先填写包含 index.mjs 的安装目录。'
          : dirty
            ? '有未保存的设置，点击启动时会先自动保存。'
            : '内部托管已就绪，启动后可打开 QQ 并登录。';
  return (
    <div className="snowluma-page">
      <section className="panel">
        <div className="section-heading">
          <h2>运行状态</h2>
          <div className="row">
            <span className="pill">{current ? phaseLabels[current.phase] : '检查中'}</span>
            <span>{current?.owned ? `本插件管理 · PID ${current.pid}` : '外部服务 / 尚未启动'}</span>
          </div>
        </div>
        <p>{current?.message}</p>
        <div className="snowluma-status-grid">
          <span>程序：{current?.installed ? '已安装' : '未配置'}</span>
          <span>WebUI：{current?.webuiReady ? '就绪' : '未监听'}</span>
          <span>OneBot：{current?.onebotConnected ? '已连接' : '未连接'}</span>
          <span>
            自动注入：
            {current?.hookAutoLoad === null ? '未知' : current?.hookAutoLoad ? '开启' : '关闭'}
          </span>
        </div>
        <p className="muted">WebUI 就绪表示进程正在监听；OneBot 通常在账号登录后就绪。</p>
        {!current?.owned && <p className="snowluma-launch-hint">{launchHint}</p>}
        <div className="row">
          <Action
            className="primary"
            disabled={
              busy ||
              !current?.allowLaunch ||
              current.owned ||
              draft.mode !== 'managed' ||
              !draft.acceptEula ||
              !draft.acceptPrivacy ||
              (!current.installed && !dirty)
            }
            onClick={() =>
              void run(async () => {
                if (dirty) await save();
                await host.api.request('/api/snowluma/launch', {
                  method: 'POST',
                  body: '{}',
                });
              }, '已请求启动 SnowLuma')
            }
          >
            启动 SnowLuma
          </Action>
          <Action
            disabled={busy || !current?.owned}
            onClick={() =>
              void run(
                () =>
                  host.api.request('/api/snowluma/stop', {
                    method: 'POST',
                    body: '{}',
                  }),
                '已停止本插件管理的进程',
              )
            }
          >
            停止 SnowLuma
          </Action>
          {current?.webuiReady && (
            <a href={current.webuiUrl} target="_blank" rel="noreferrer">
              打开 SnowLuma WebUI ↗
            </a>
          )}
        </div>
        {!current?.allowLaunch && (
          <p className="muted">演示模式只开放设置与状态。使用 live 启动配置后才能托管真实进程。</p>
        )}
      </section>
      <form
        className="panel form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void run(save, 'SnowLuma 插件设置已保存');
        }}
      >
        <h2>插件设置</h2>
        <label>
          运行方式
          <select
            value={draft.mode}
            onChange={(event) =>
              change({
                ...draft,
                mode: event.target.value as SnowlumaSettings['mode'],
              })
            }
          >
            <option value="external">外部模式：连接已运行的 SnowLuma</option>
            <option value="managed">内部托管：由工作台启动与管理</option>
          </select>
        </label>
        <label>
          SnowLuma 安装目录
          <input
            aria-label="SnowLuma 安装目录"
            value={draft.directory}
            onChange={(event) => change({ ...draft, directory: event.target.value })}
            placeholder="独立安装目录的绝对路径，包含 index.mjs"
          />
        </label>
        <label>
          Node 可执行文件（可选）
          <input
            value={draft.nodePath}
            onChange={(event) => change({ ...draft, nodePath: event.target.value })}
            placeholder="留空优先用包内 node.exe，否则使用服务端 Node"
          />
        </label>
        <label className="toggle-row">
          随插件启用自动启动
          <Toggle
            checked={draft.autoStart}
            onChange={(event) => change({ ...draft, autoStart: event.target.checked })}
          />
        </label>
        <label className="toggle-row">
          我已阅读并同意所安装 SnowLuma 版本的 EULA
          <Toggle
            checked={draft.acceptEula}
            onChange={(event) => change({ ...draft, acceptEula: event.target.checked })}
          />
        </label>
        <label className="toggle-row">
          我已阅读并同意所安装 SnowLuma 版本的隐私政策
          <Toggle
            checked={draft.acceptPrivacy}
            onChange={(event) => change({ ...draft, acceptPrivacy: event.target.checked })}
          />
        </label>
        <p className="muted">
          协议在 SnowLuma 安装包或其 WebUI 中查看。包目录与 runtime.json
          仅作只读探测；该插件不安装、下载或改写 SnowLuma。
        </p>
        <Action className="primary" disabled={busy || current?.owned}>
          保存 SnowLuma 设置
        </Action>
      </form>
      <form
        className="panel form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await host.api.request('/api/config', {
              method: 'PATCH',
              body: JSON.stringify({
                onebot: {
                  ...onebot,
                  ...(token ? { accessToken: token } : {}),
                  ...(httpToken ? { httpAccessToken: httpToken } : {}),
                },
              }),
            });
            setToken('');
            setHttpToken('');
          }, 'OneBot 接入设置已保存，适配器会自动应用连接配置');
        }}
      >
        <h2>OneBot 接入</h2>
        <label>
          WebSocket 地址
          <input
            aria-label="OneBot WebSocket 地址"
            value={onebot.wsUrl}
            onChange={(event) => setOnebot({ ...onebot, wsUrl: event.target.value })}
          />
        </label>
        <label>
          HTTP 地址
          <input
            value={onebot.httpUrl}
            onChange={(event) => setOnebot({ ...onebot, httpUrl: event.target.value })}
          />
        </label>
        <label>
          WebSocket 访问令牌
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={config.data?.onebot.hasAccessToken ? '已配置，留空保留' : '尚未配置'}
          />
        </label>
        <label>
          HTTP 访问令牌
          <input
            type="password"
            value={httpToken}
            onChange={(event) => setHttpToken(event.target.value)}
            placeholder={
              config.data?.onebot.hasHttpAccessToken ? '已配置，留空保留' : '未单独配置时使用 WebSocket 令牌'
            }
          />
        </label>
        <Action disabled={busy}>保存 OneBot 接入</Action>
        <p className="muted">
          令牌手工配置，不扫描第三方账号配置。便携 QQ 可在对应页面启停，登录在 QQ 窗口完成。
        </p>
      </form>
      <section className="panel">
        <h2>运行日志</h2>
        <pre>
          {logs.data?.logs
            .map((line) => `[${new Date(line.at).toLocaleTimeString()}] ${line.stream}: ${line.text}`)
            .join('\n') || '暂无本插件启动的进程日志。'}
        </pre>
      </section>
      {(notice || status.error || logs.error) && (
        <p role="status">{notice || String(status.error ?? logs.error)}</p>
      )}
      {error && (
        <div className="snowluma-feedback" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
export default defineClientPlugin({
  id: 'snowluma-runtime',
  setup(ctx) {
    ctx.page({
      id: 'snowluma',
      path: '/snowluma',
      title: 'SnowLuma',
      icon: 'snowflake',
      order: 28,
      component: SnowlumaPage,
    });
  },
});
