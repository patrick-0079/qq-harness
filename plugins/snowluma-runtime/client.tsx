import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost } from '@qq-harness/client-sdk';
import type { PublicConfig, SnowlumaSettings, SnowlumaStatus, SnowlumaLog } from '@qq-harness/contracts';
import './style.css';

function SnowlumaPage() {
  const host = useHost();
  const [draft, setDraft] = useState<SnowlumaSettings>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
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
    queryFn: ({ signal }) => host.api.request<{ logs: SnowlumaLog[] }>('/api/snowluma/logs', { signal }),
    refetchInterval: 2000,
  });
  const config = useQuery({
    queryKey: ['snowluma-runtime', 'onebot'],
    queryFn: ({ signal }) => host.api.request<PublicConfig>('/api/config', { signal }),
  });
  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);
  useEffect(() => {
    if (config.data) setOnebot({ wsUrl: config.data.onebot.wsUrl, httpUrl: config.data.onebot.httpUrl });
  }, [config.data]);
  const run = async (task: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await task();
      setNotice(message);
      await host.queries.invalidateQueries({ queryKey: ['snowluma-runtime'] });
    } catch (error) {
      setNotice(String(error));
    } finally {
      setBusy(false);
    }
  };
  if (!draft)
    return <div className="empty">{settings.error ? String(settings.error) : '加载 SnowLuma 插件设置…'}</div>;
  const current = status.data;
  return (
    <div className="snowluma-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RUNTIME PLUGIN</span>
          <h1>SnowLuma</h1>
          <p>独立插件管理第三方运行时，聊天收发由 OneBot 适配器提供。</p>
        </div>
        <span className="pill">{current?.phase ?? '检查中'}</span>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>运行状态</h2>
          <span>{current?.owned ? `本插件管理 · PID ${current.pid}` : '外部服务 / 尚未启动'}</span>
        </div>
        <p>{current?.message}</p>
        <div className="row">
          <span>程序：{current?.installed ? '已安装' : '未配置'}</span>
          <span>WebUI：{current?.webuiReady ? '就绪' : '未监听'}</span>
          <span>OneBot：{current?.onebotConnected ? '已连接' : '未连接'}</span>
          <span>
            自动注入：{current?.hookAutoLoad === null ? '未知' : current?.hookAutoLoad ? '开启' : '关闭'}
          </span>
        </div>
        <p className="muted">WebUI 就绪表示进程正在监听；OneBot 通常在账号登录后就绪。</p>
        <div className="row">
          <button
            disabled={busy || !current?.allowLaunch || current.owned || draft.mode !== 'managed'}
            onClick={() =>
              void run(
                () => host.api.request('/api/snowluma/launch', { method: 'POST', body: '{}' }),
                '已请求启动 SnowLuma',
              )
            }
          >
            启动 SnowLuma
          </button>
          <button
            disabled={busy || !current?.owned}
            onClick={() =>
              void run(
                () => host.api.request('/api/snowluma/stop', { method: 'POST', body: '{}' }),
                '已停止本插件管理的进程',
              )
            }
          >
            停止 SnowLuma
          </button>
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
          void run(
            () =>
              host.api.request('/api/snowluma/settings', { method: 'PATCH', body: JSON.stringify(draft) }),
            'SnowLuma 插件设置已保存',
          );
        }}
      >
        <h2>插件设置</h2>
        <label>
          运行方式
          <select
            value={draft.mode}
            onChange={(event) => setDraft({ ...draft, mode: event.target.value as SnowlumaSettings['mode'] })}
          >
            <option value="external">外部模式：连接已运行的 SnowLuma</option>
            <option value="managed">托管模式：由本插件启动与回收</option>
          </select>
        </label>
        <label>
          SnowLuma 安装目录
          <input
            aria-label="SnowLuma 安装目录"
            value={draft.directory}
            onChange={(event) => setDraft({ ...draft, directory: event.target.value })}
            placeholder="独立安装目录的绝对路径，包含 index.mjs"
          />
        </label>
        <label>
          Node 可执行文件（可选）
          <input
            value={draft.nodePath}
            onChange={(event) => setDraft({ ...draft, nodePath: event.target.value })}
            placeholder="留空优先用包内 node.exe，否则使用服务端 Node"
          />
        </label>
        <label className="toggle-row">
          随插件启用自动启动
          <input
            type="checkbox"
            checked={draft.autoStart}
            onChange={(event) => setDraft({ ...draft, autoStart: event.target.checked })}
          />
        </label>
        <label className="toggle-row">
          我已阅读并同意所安装 SnowLuma 版本的 EULA
          <input
            type="checkbox"
            checked={draft.acceptEula}
            onChange={(event) => setDraft({ ...draft, acceptEula: event.target.checked })}
          />
        </label>
        <label className="toggle-row">
          我已阅读并同意所安装 SnowLuma 版本的隐私政策
          <input
            type="checkbox"
            checked={draft.acceptPrivacy}
            onChange={(event) => setDraft({ ...draft, acceptPrivacy: event.target.checked })}
          />
        </label>
        <p className="muted">
          协议在 SnowLuma 安装包或其 WebUI 中查看。包目录与 runtime.json
          仅作只读探测；该插件不安装、下载或改写 SnowLuma。
        </p>
        <button className="primary" disabled={busy || current?.owned}>
          保存 SnowLuma 设置
        </button>
      </form>
      <form
        className="panel form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await host.api.request('/api/config', {
              method: 'PATCH',
              body: JSON.stringify({ onebot: { ...onebot, ...(token ? { accessToken: token } : {}) } }),
            });
            setToken('');
          }, 'OneBot 接入设置已保存，连接地址改变后请重启 OneBot 适配器');
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
          访问令牌
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={config.data?.onebot.hasAccessToken ? '已配置，留空保留' : '尚未配置'}
          />
        </label>
        <button disabled={busy}>保存 OneBot 接入</button>
        <p className="muted">令牌手工配置，不扫描第三方账号配置。便携 QQ 启停与账号登录仍在外部完成。</p>
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
      icon: '❄',
      order: 28,
      component: SnowlumaPage,
    });
  },
});
