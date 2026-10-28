import { Action } from '@qq-harness/client-sdk';
import { Toggle } from '@qq-harness/client-sdk';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHost, useUnsavedChanges, Drawer, dialogs } from '@qq-harness/client-sdk';
import type { WebSettings, SearchProvider } from '@qq-harness/contracts';
const labels: Record<string, string> = {
  bing: 'Bing 网页搜索',
  deepseek: 'DeepSeek 搜索',
  zhipu: '智谱搜索',
  bocha: '博查搜索',
  baidu: '百度搜索',
  metaso: '秘塔搜索',
  custom: '旧版自定义接口',
};
const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' ? (v as Record<string, any>) : {};
export function SearchSettings() {
  const host = useHost(),
    [draft, setDraft] = useState<WebSettings>(),
    [dirty, setDirty] = useState(false),
    [notice, setNotice] = useState(''),
    [saving, setSaving] = useState(false),
    [editing, setEditing] = useState<SearchProvider>(),
    [original, setOriginal] = useState(''),
    [key, setKey] = useState(''),
    [clearKey, setClearKey] = useState(false),
    [query, setQuery] = useState('QQ 官方网站'),
    [testResult, setTestResult] = useState<Record<string, any>>(),
    [testing, setTesting] = useState(false);
  useUnsavedChanges(dirty || Boolean(editing));
  const { data, error } = useQuery({
    queryKey: ['search-settings'],
    queryFn: ({ signal }) => host.api.request<WebSettings>('/api/web/settings', { signal }),
  });
  useEffect(() => {
    if (!dirty && !editing) setDraft(data);
  }, [data, dirty, editing]);
  if (!draft)
    return (
      <section className="panel">
        <h2>搜索提供方</h2>
        <p>{error?.message ?? '加载搜索设置…'}</p>
      </section>
    );
  const update = (patch: Partial<WebSettings>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const provider = draft.provider,
    remote = obj(draft[provider]);
  const field = (name: string, value: unknown) => update({ [provider]: { ...remote, [name]: value } });
  const edit = (row?: SearchProvider) => {
    setOriginal(row?.id ?? '');
    setEditing(
      row ?? {
        id: crypto.randomUUID(),
        name: '',
        type: 'openai',
        baseUrl: '',
        apiKey: '',
        model: '',
        count: 6,
        timeoutMs: 20000,
      },
    );
    setKey('');
    setClearKey(false);
  };
  const patchEdit = (key: string, value: unknown) => setEditing({ ...editing!, [key]: value });
  return (
    <div className="form-stack settings-page">
      <section className="panel form-stack">
        <div className="section-heading">
          <div>
            <h2>搜索提供方</h2>
            <p className="muted">全局搜索渠道与凭据；会话内可在“工具与技能”启停搜索工具。</p>
          </div>
        </div>
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            setNotice('');
            void host.api
              .request<WebSettings>('/api/web/settings', {
                method: 'PATCH',
                body: JSON.stringify(draft),
              })
              .then((value) => {
                setDraft(value);
                setDirty(false);
                host.queries.setQueryData(['search-settings'], value);
                setNotice('搜索设置已保存');
              })
              .catch((e) => setNotice(e.message))
              .finally(() => setSaving(false));
          }}
        >
          <div className="row">
            <label className="toggle-row">
              <Toggle checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
              启用联网搜索工具
            </label>
          </div>
          <label>
            搜索提供方
            <select
              aria-label="搜索提供方"
              value={provider}
              onChange={(e) => update({ provider: e.target.value })}
            >
              {Object.entries(labels).map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
              {draft.providers.map((p) => (
                <option key={p.id} value={'custom:' + p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            最多结果数
            <input
              type="number"
              min={1}
              max={10}
              value={draft.maxResults}
              onChange={(e) => update({ maxResults: Number(e.target.value) })}
            />
          </label>
          {provider === 'bing' ? (
            <label>
              搜索地址
              <input
                type="url"
                value={draft.searchUrl}
                onChange={(e) => update({ searchUrl: e.target.value })}
              />
            </label>
          ) : !provider.startsWith('custom:') ? (
            <>
              <label>
                接口地址
                <input
                  value={remote.baseUrl ?? ''}
                  placeholder="留空使用旧版默认地址"
                  onChange={(e) => field('baseUrl', e.target.value)}
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  autoComplete="new-password"
                  value={remote.apiKey ?? ''}
                  placeholder="已配置时显示掩码，保持掩码可保留原密钥"
                  onChange={(e) => field('apiKey', e.target.value)}
                />
              </label>
              {['deepseek', 'custom'].includes(provider) ? (
                <label>
                  搜索模型
                  <input value={remote.model ?? ''} onChange={(e) => field('model', e.target.value)} />
                </label>
              ) : null}
              {provider === 'zhipu' ? (
                <label>
                  搜索引擎
                  <input
                    value={remote.engine ?? 'search_std'}
                    onChange={(e) => field('engine', e.target.value)}
                  />
                </label>
              ) : null}
              {provider === 'custom' ? (
                <label>
                  接口类型
                  <select value={remote.type ?? 'openai'} onChange={(e) => field('type', e.target.value)}>
                    <option value="openai">JSON 搜索接口</option>
                    <option value="bing">Bing 兼容页面</option>
                  </select>
                </label>
              ) : null}
              <label>
                请求结果数
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={remote.count ?? 6}
                  onChange={(e) => field('count', Number(e.target.value))}
                />
              </label>
              <label>
                请求超时（毫秒）
                <input
                  type="number"
                  min={1000}
                  max={180000}
                  value={remote.timeoutMs ?? 20000}
                  onChange={(e) => field('timeoutMs', Number(e.target.value))}
                />
              </label>
            </>
          ) : (
            <p className="muted">在下方自定义提供方列表中编辑当前渠道。</p>
          )}
          <div className="row">
            <Action className="primary" disabled={saving || !dirty}>
              {saving ? '保存中…' : '保存搜索设置'}
            </Action>
            <span role="status">{notice}</span>
          </div>
        </form>
        <div className="section-heading">
          <h3>自定义提供方</h3>
          <Action type="button" onClick={() => edit()}>
            添加搜索提供方
          </Action>
        </div>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>类型</th>
              <th>接口</th>
              <th>凭据</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {draft.providers.map((p) => (
              <tr key={p.id}>
                <td>{p.name || p.id}</td>
                <td>{p.type}</td>
                <td className="break">{p.baseUrl}</td>
                <td>{p.apiKey ? '已配置' : '未配置'}</td>
                <td>
                  <div className="row">
                    <Action type="button" onClick={() => edit(p)}>
                      编辑
                    </Action>
                    <Action
                      type="button"
                      onClick={() => {
                        void dialogs
                          .confirm({
                            title: '删除搜索提供方',
                            description: `删除“${p.name || p.id}”？保存搜索设置后生效。`,
                            danger: true,
                          })
                          .then((ok) => {
                            if (ok)
                              update({
                                providers: draft.providers.filter((v) => v.id !== p.id),
                                ...(provider === 'custom:' + p.id ? { provider: 'bing' } : {}),
                              });
                          });
                      }}
                    >
                      删除
                    </Action>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!draft.providers.length ? <p className="empty compact">暂无自定义提供方</p> : null}
        <div className="section-heading">
          <h3>搜索测试</h3>
        </div>
        <p className="muted">保存设置后发送一次请求到当前搜索接口，结果不发送到QQ。</p>
        <div className="row">
          <input aria-label="搜索测试词" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Action
            type="button"
            disabled={testing || dirty || !query.trim()}
            onClick={() => {
              setTesting(true);
              setTestResult(undefined);
              void host.api
                .request<Record<string, any>>('/api/web/test', {
                  method: 'POST',
                  body: JSON.stringify({ query }),
                })
                .then(setTestResult)
                .catch((e) => setTestResult({ error: e.message }))
                .finally(() => setTesting(false));
            }}
          >
            {testing ? '请求中…' : '发送搜索测试请求'}
          </Action>
        </div>
        {testResult?.error ? (
          <p className="error">{testResult.error}</p>
        ) : testResult?.result ? (
          <ul>
            {(testResult.result.results ?? []).map((r: any, i: number) => (
              <li key={i}>
                {/^https?:\/\//i.test(String(r.url)) ? (
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.title}
                  </a>
                ) : (
                  <span>{r.title}</span>
                )}
                <p>{r.snippet}</p>
              </li>
            ))}
          </ul>
        ) : null}
        {editing ? (
          <Drawer
            title={original ? '编辑搜索提供方' : '添加搜索提供方'}
            onClose={() => setEditing(undefined)}
          >
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                const row = {
                  ...editing,
                  apiKey: clearKey ? '' : key || editing.apiKey,
                };
                update({
                  providers: [...draft.providers.filter((p) => p.id !== original), row],
                });
                setEditing(undefined);
              }}
            >
              <label>
                名称
                <input required value={editing.name} onChange={(e) => patchEdit('name', e.target.value)} />
              </label>
              <label>
                类型
                <select value={editing.type} onChange={(e) => patchEdit('type', e.target.value)}>
                  <option value="openai">JSON 搜索接口</option>
                  <option value="bing">Bing 兼容页面</option>
                </select>
              </label>
              <label>
                接口地址
                <input
                  required
                  type="url"
                  value={editing.baseUrl}
                  onChange={(e) => patchEdit('baseUrl', e.target.value)}
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  placeholder={editing.apiKey ? '已配置，留空保持' : '未配置'}
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <label className="toggle-row">
                <Toggle checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} />
                清除已保存密钥
              </label>
              <label>
                搜索模型
                <input value={editing.model} onChange={(e) => patchEdit('model', e.target.value)} />
              </label>
              <label>
                请求结果数
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={editing.count}
                  onChange={(e) => patchEdit('count', Number(e.target.value))}
                />
              </label>
              <label>
                超时（毫秒）
                <input
                  type="number"
                  min={1000}
                  max={180000}
                  value={editing.timeoutMs}
                  onChange={(e) => patchEdit('timeoutMs', Number(e.target.value))}
                />
              </label>
              <Action className="primary">应用到待保存配置</Action>
            </form>
          </Drawer>
        ) : null}
      </section>
    </div>
  );
}
