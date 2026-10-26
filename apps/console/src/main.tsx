import { StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  ClientHost,
  ClientHostProvider,
  PluginBoundary,
  Slot,
  useHostVersion,
  type ClientPlugin,
} from '@qq-harness/client-sdk';
import type { PluginDto } from '@qq-harness/contracts';
import './style.css';

const modules = import.meta.glob<{ default: ClientPlugin }>('../../../plugins/*/client.tsx');
const host = new ClientHost(async (plugin) => {
  const entry = plugin.client!.entry;
  if (entry.startsWith('builtin:')) {
    const load = modules[`../../../plugins/${entry.slice(8)}/client.tsx`];
    if (!load) throw new Error('内置客户端入口不存在');
    return (await load()).default;
  }
  if (!entry.startsWith('/api/plugin-assets/')) throw new Error('客户端插件入口不受信任');
  return ((await import(/* @vite-ignore */ entry)) as { default: ClientPlugin }).default;
});
function Shell() {
  useHostVersion();
  const [connection, setConnection] = useState('连接中');
  const [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    let refresh: ReturnType<typeof setTimeout> | undefined;
    const sync = async () => {
      try {
        const snapshot = await host.api.request<{ plugins: PluginDto[] }>('/api/plugins', {
          signal: abort.signal,
        });
        await host.sync(snapshot.plugins);
        setConnection('已连接');
        setError('');
      } catch (error) {
        if (!abort.signal.aborted) {
          setError(error instanceof Error ? error.message : String(error));
          setConnection('连接中断');
        }
      }
    };
    void sync();
    void host.api.events((type) => {
      if (type === 'plugins.changed' || type === 'hello') {
        clearTimeout(refresh);
        refresh = setTimeout(() => {
          void sync();
        }, 50);
      }
      if (type !== 'heartbeat') void host.queries.invalidateQueries();
    }, abort.signal);
    return () => {
      abort.abort();
      clearTimeout(refresh);
    };
  }, []);
  const pages = host.listPages();
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          Q<span>QQ Harness</span>
        </a>
        <div className="eyebrow">工作台</div>
        <nav>
          {pages.map(({ owner, value }) => (
            <NavLink key={`${owner}/${value.id}`} aria-label={value.title} to={value.path} end>
              <span aria-hidden="true">{value.icon ?? '◇'}</span>
              {value.title}
            </NavLink>
          ))}
        </nav>
        <Slot point="shell.nav.extra" />
        <div className="sidebar-footer">
          <span className="status-dot" />
          {connection}
          <small>插件驱动的 Agent 工作台</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">QQ HARNESS</span>
            <strong>让每一种能力独立生长</strong>
          </div>
          <div className="header-actions">
            <Slot point="shell.header.actions" />
            <span className="pill">插件平台 v0.1</span>
          </div>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <button
              onClick={() => {
                const token = document.querySelector<HTMLInputElement>('#token');
                if (token) sessionStorage.setItem('harness-token', token.value);
              }}
            >
              保存令牌
            </button>
            <input id="token" type="password" placeholder="管理令牌（若已配置）" aria-label="管理令牌" />
          </div>
        )}
        {[...host.errors].map(([id, message]) => (
          <div className="error" key={id}>
            {id}：{message}
          </div>
        ))}
        <div className="page">
          <Routes>
            {pages.map(({ owner, value }) => (
              <Route
                key={`${owner}/${value.id}`}
                path={value.path}
                element={
                  <PluginBoundary name={owner}>
                    <Suspense fallback={<div>加载页面…</div>}>
                      <value.component />
                    </Suspense>
                  </PluginBoundary>
                }
              />
            ))}
            <Route
              path="*"
              element={
                pages[0] ? (
                  <Navigate to={pages[0].value.path} replace />
                ) : (
                  <div className="empty">等待页面插件就绪…</div>
                )
              }
            />
          </Routes>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={host.queries}>
      <ClientHostProvider value={host}>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </ClientHostProvider>
    </QueryClientProvider>
  </StrictMode>,
);
