import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost } from '@qq-harness/client-sdk';
import type { PluginDto } from '@qq-harness/contracts';

function Plugins() {
  const host = useHost();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');
  const { data } = useQuery({
    queryKey: ['console-plugins', 'list'],
    queryFn: ({ signal }) => host.api.request<{ plugins: PluginDto[] }>('/api/plugins', { signal }),
  });
  const locked = [
    'config-file',
    'storage-file',
    'storage-sqlite',
    'transport-http',
    'console-api',
    'external-plugins',
  ];
  const toggle = (id: string, enabled: boolean) => {
    setPending((current) => ({ ...current, [id]: enabled }));
    setError('');
    void host.api
      .request(`/api/plugins/${id}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) })
      .then(() => host.queries.invalidateQueries())
      .catch((error) => setError(error.message))
      .finally(() =>
        setPending((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        }),
      );
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">EXTENSIONS</span>
          <h1>插件</h1>
          <p>从接入到界面，按需要组合你的 Agent。</p>
        </div>
        <span className="pill">{data?.plugins.length ?? 0} 个插件</span>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="plugin-grid">
        {data?.plugins.map((plugin) => (
          <article className="panel plugin-card" key={plugin.id} data-plugin={plugin.id}>
            <div className="plugin-top">
              <div className="plugin-symbol">{plugin.client ? '▦' : '◇'}</div>
              <label className="switch">
                <input
                  type="checkbox"
                  aria-label={`启用 ${plugin.id}`}
                  checked={pending[plugin.id] ?? plugin.enabled}
                  disabled={plugin.id in pending || locked.includes(plugin.id)}
                  onChange={(event) => toggle(plugin.id, event.target.checked)}
                />
                <span />
              </label>
            </div>
            <h2>{plugin.name}</h2>
            <code>{plugin.id}</code>
            <p>
              {plugin.client
                ? '提供界面页面或扩展贡献'
                : plugin.requires.length
                  ? `依赖 ${plugin.requires.length} 个服务`
                  : '独立基础能力'}
            </p>
            <div className="plugin-bottom">
              <span className={`pill ${plugin.status === 'active' ? 'positive' : ''}`}>{plugin.status}</span>
              <small>
                v{plugin.version} · 第 {plugin.generation} 次激活
              </small>
            </div>
            {plugin.error && <div className="error">{plugin.error}</div>}
          </article>
        ))}
      </div>
    </>
  );
}
export default defineClientPlugin({
  id: 'console-plugins',
  setup(ctx) {
    ctx.page({ id: 'plugins', path: '/plugins', title: '插件', icon: '▦', order: 20, component: Plugins });
  },
});
