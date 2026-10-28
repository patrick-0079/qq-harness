import { Action } from '@qq-harness/client-sdk';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { defineClientPlugin, useHost, Slot, useUnsavedChanges, Toggle } from '@qq-harness/client-sdk';
import type { PublicConfig } from '@qq-harness/contracts';
import { InputNumber, Alert } from 'antd';
import { CatalogManager } from './catalogs.js';
import { SearchSettings } from './search.js';
function GlobalForm({ section }: { section: 'runtime' | 'model' | 'access' }) {
  const host = useHost(),
    [draft, setDraft] = useState<PublicConfig>(),
    [dirty, setDirty] = useState(false),
    [key, setKey] = useState(''),
    [notice, setNotice] = useState('');
  useUnsavedChanges(dirty);
  const { data } = useQuery({
    queryKey: ['console-settings', 'config'],
    queryFn: ({ signal }) => host.api.request<PublicConfig>('/api/config', { signal }),
  });
  useEffect(() => {
    if (!dirty) setDraft(data);
  }, [data, dirty]);
  if (!draft) return <p>加载设置…</p>;
  const patch = (p: Partial<PublicConfig>) => {
    setDraft({ ...draft, ...p });
    setDirty(true);
  };
  return (
    <div className="form-stack settings-page">
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const body =
            section === 'runtime'
              ? {
                  execution: draft.execution,
                  defaults: {
                    runTimeoutMs: draft.defaults.runTimeoutMs,
                    queueTimeoutMs: draft.defaults.queueTimeoutMs,
                    maxRounds: draft.defaults.maxRounds,
                  },
                  model: { timeoutMs: draft.model.timeoutMs },
                }
              : section === 'model'
                ? { model: { ...draft.model, ...(key ? { apiKey: key } : {}) } }
                : {
                    acceptAllSessions: draft.acceptAllSessions,
                    deniedChats: draft.deniedChats,
                    deniedUsers: draft.deniedUsers,
                  };
          void host.api
            .request('/api/config', {
              method: 'PATCH',
              body: JSON.stringify(body),
            })
            .then(() => {
              setDirty(false);
              setKey('');
              setNotice('设置已保存');
              void host.queries.invalidateQueries();
            })
            .catch((e) => setNotice(e.message));
        }}
      >
        {section === 'runtime' && (
          <>
            <Alert
              type="info"
              showIcon
              title="并发池控制不同会话同时运行的数量；同一会话始终串行。超时为0表示不限。"
            />
            <div className="form-grid">
              <label>
                对话并发池
                <InputNumber
                  aria-label="对话并发池"
                  min={1}
                  max={64}
                  value={draft.execution.concurrency}
                  onChange={(v) =>
                    patch({
                      execution: { ...draft.execution, concurrency: Number(v) },
                    })
                  }
                />
              </label>
              <label>
                队列容量
                <InputNumber
                  aria-label="队列容量"
                  min={1}
                  max={10000}
                  value={draft.execution.queueLimit}
                  onChange={(v) =>
                    patch({
                      execution: { ...draft.execution, queueLimit: Number(v) },
                    })
                  }
                />
              </label>
              {(['runTimeoutMs', 'queueTimeoutMs'] as const).map((k, i) => (
                <label key={k}>
                  {['默认会话执行超时', '默认排队等待超时'][i]}（秒）
                  <InputNumber
                    min={0}
                    value={draft.defaults[k] / 1000}
                    onChange={(v) =>
                      patch({
                        defaults: { ...draft.defaults, [k]: Number(v) * 1000 },
                      })
                    }
                  />
                </label>
              ))}
              <label>
                模型请求超时（秒）
                <InputNumber
                  min={0.1}
                  max={3600}
                  value={draft.model.timeoutMs / 1000}
                  onChange={(v) =>
                    patch({
                      model: { ...draft.model, timeoutMs: Number(v) * 1000 },
                    })
                  }
                />
              </label>
              <label>
                默认最大工具轮数
                <InputNumber
                  min={1}
                  max={40}
                  value={draft.defaults.maxRounds}
                  onChange={(v) =>
                    patch({
                      defaults: { ...draft.defaults, maxRounds: Number(v) },
                    })
                  }
                />
              </label>
            </div>
          </>
        )}
        {section === 'model' && (
          <div className="form-grid">
            <label>
              API Base URL
              <input
                value={draft.model.baseUrl}
                onChange={(e) => patch({ model: { ...draft.model, baseUrl: e.target.value } })}
              />
            </label>
            <label>
              默认模型
              <input
                value={draft.model.model}
                onChange={(e) => patch({ model: { ...draft.model, model: e.target.value } })}
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={key}
                placeholder={draft.model.hasApiKey ? '已配置，留空保留' : '尚未配置'}
                onChange={(e) => {
                  setKey(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
          </div>
        )}
        {section === 'access' && (
          <>
            <label className="toggle-row">
              接收所有会话
              <Toggle
                checked={draft.acceptAllSessions}
                onChange={(e) => patch({ acceptAllSessions: e.target.checked })}
              />
            </label>
            <p className="muted">关闭后通过添加会话准入，无需单独白名单。黑名单优先，不能突破启动边界。</p>
            {(['deniedChats', 'deniedUsers'] as const).map((k, i) => (
              <label key={k}>
                {['屏蔽会话（每行 group:号码 或 private:号码）', '屏蔽用户（每行QQ号）'][i]}
                <textarea
                  value={draft[k].join('\n')}
                  onChange={(e) => patch({ [k]: e.target.value.split(/\s+/).filter(Boolean) })}
                />
              </label>
            ))}
          </>
        )}
        <div className="row">
          <Action className="primary">保存设置</Action>
          <span role="status">{notice}</span>
        </div>
      </form>
      {section === 'model' && (
        <>
          <CatalogManager mode="providers" />
          <Slot point="settings.model.extra" />
        </>
      )}
    </div>
  );
}
function Prompts() {
  return (
    <div className="form-stack">
      <CatalogManager mode="texts" />
      <Slot point="settings.persona.actions" />
    </div>
  );
}
export default defineClientPlugin({
  id: 'console-settings',
  setup(ctx) {
    ctx.defineSlot('settings.model.extra');
    ctx.defineSlot('settings.persona.actions');
    ctx.page({
      id: 'prompts',
      path: '/prompts',
      title: '提示词管理',
      icon: 'document',
      order: 25,
      component: Prompts,
    });
    ctx.page({
      id: 'settings',
      path: '/settings',
      title: '设置',
      icon: 'settings',
      order: 30,
      component: () => <Navigate to="/settings/runtime" replace />,
    });
    for (const [id, title, component] of [
      ['runtime', '运行与调度', () => <GlobalForm section="runtime" />],
      ['model', '模型接入', () => <GlobalForm section="model" />],
      ['access', '会话准入', () => <GlobalForm section="access" />],
      ['search', '联网搜索', SearchSettings],
    ] as const)
      ctx.page({
        id: 'settings-' + id,
        parentId: 'settings',
        path: '/settings/' + id,
        title,
        order: 30,
        component,
      });
  },
});
