import { Action } from '@qq-harness/client-sdk';
import { StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  ClientHost,
  DialogHost,
  ClientHostProvider,
  PluginBoundary,
  Slot,
  DesignProvider,
  useHostVersion,
  type ClientPlugin,
} from '@qq-harness/client-sdk';
import type { PluginDto } from '@qq-harness/contracts';
import './style.css';
import './admin.css';
import './chat-admin.css';
import './polish.css';
import './layout.css';
import { ThemeSelector } from './theme.js';
import { Sidebar } from './sidebar.js';

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
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('qqh-nav-collapsed') === '1');
  useHostVersion();
  const [connection, setConnection] = useState('连接中');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [restart, setRestart] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let refresh: ReturnType<typeof setTimeout> | undefined;
    let invalidate: ReturnType<typeof setTimeout> | undefined;
    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const snapshot = await host.api.request<{ plugins: PluginDto[] }>('/api/plugins', {
          signal: abort.signal,
        });
        abort.signal.throwIfAborted();
        await host.sync(snapshot.plugins);
        if (abort.signal.aborted) return;
        setReady(true);
        setConnection('已连接');
        setError('');
      } catch (error) {
        if (!abort.signal.aborted) {
          setError(error instanceof Error ? error.message : String(error));
          setConnection('连接中断');
        }
      } finally {
        syncing = false;
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
      if (!['heartbeat', 'log', 'run.trace'].includes(type) && !invalidate)
        invalidate = setTimeout(() => {
          invalidate = undefined;
          void host.queries.invalidateQueries({}, { cancelRefetch: false });
        }, 250);
    }, abort.signal);
    return () => {
      abort.abort();
      clearTimeout(refresh);
      clearTimeout(invalidate);
    };
  }, [restart]);
  const pages = host.listPages();
  return (
    <div className={`shell console-shell ${collapsed ? 'nav-collapsed' : ''}`}>
      <Sidebar
        pages={pages}
        collapsed={collapsed}
        connection={connection}
        onCollapse={() => {
          setCollapsed(!collapsed);
          localStorage.setItem('qqh-nav-collapsed', collapsed ? '0' : '1');
        }}
      />
      <main className="console-main">
        <header className="console-header">
          <div className="console-breadcrumb">
            <span>工作台</span>
            <span aria-hidden="true">/</span>
            <h1>{pages.find((p) => p.value.path === location.pathname)?.value.title ?? '管理控制台'}</h1>
          </div>
          <div className="header-actions">
            <Slot point="shell.header.actions" />
            <ThemeSelector />
            <span className="pill">插件平台 v0.1</span>
          </div>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
            <Action
              onClick={() => {
                const token = document.querySelector<HTMLInputElement>('#token');
                if (token) sessionStorage.setItem('harness-token', token.value);
                setRestart((v) => v + 1);
              }}
            >
              保存令牌
            </Action>
            <input id="token" type="password" placeholder="管理令牌（若已配置）" aria-label="管理令牌" />
          </div>
        )}
        {[...host.errors].map(([id, message]) => (
          <div className="error" key={id}>
            {id}：{message}
          </div>
        ))}
        <div className="page">
          {!ready ? (
            <div role="status">
              {error ? '页面初始化失败，请重试连接' : '正在初始化页面插件…'}
              <Action onClick={() => setRestart((v) => v + 1)}>重试加载</Action>
            </div>
          ) : (
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
          )}
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
          <DesignProvider>
            <Shell />
            <DialogHost />
          </DesignProvider>
        </BrowserRouter>
      </ClientHostProvider>
    </QueryClientProvider>
  </StrictMode>,
);
