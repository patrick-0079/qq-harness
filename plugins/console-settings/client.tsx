import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost, Slot } from '@qq-harness/client-sdk';
import type { PublicConfig } from '@qq-harness/contracts';

function Settings() {
  const host = useHost();
  const [draft, setDraft] = useState<PublicConfig>();
  const [apiKey, setApiKey] = useState('');
  const [notice, setNotice] = useState('');
  const { data } = useQuery({
    queryKey: ['console-settings', 'config'],
    queryFn: ({ signal }) => host.api.request<PublicConfig>('/api/config', { signal }),
  });
  useEffect(() => {
    setDraft(data);
  }, [data]);
  if (!draft) return <div className="empty">加载配置…</div>;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SETTINGS</span>
          <h1>设置</h1>
          <p>全局默认设置与接入配置。会话自定义后保存为独立快照。</p>
        </div>
      </div>
      <form
        className="settings-layout"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice('保存中…');
          const patch = {
            acceptAllSessions: draft.acceptAllSessions,
            admissions: draft.admissions,
            defaults: draft.defaults,
            model: { ...draft.model, ...(apiKey ? { apiKey } : {}) },
          };
          void host.api
            .request('/api/config', { method: 'PATCH', body: JSON.stringify(patch) })
            .then(() => {
              setApiKey('');
              setNotice('设置已保存');
              void host.queries.invalidateQueries();
            })
            .catch((error) => setNotice(error.message));
        }}
      >
        <section className="panel form-stack">
          <h2>模型提供者</h2>
          <p className="muted">演示模式使用开发模型；真实模式连接管理员配置的 OpenAI 兼容端点。</p>
          <label>
            API Base URL
            <input
              value={draft.model.baseUrl}
              onChange={(event) =>
                setDraft({ ...draft, model: { ...draft.model, baseUrl: event.target.value } })
              }
            />
          </label>
          <label>
            模型名称
            <input
              value={draft.model.model}
              onChange={(event) =>
                setDraft({ ...draft, model: { ...draft.model, model: event.target.value } })
              }
              placeholder="模型 ID"
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={draft.model.hasApiKey ? '已配置 · 留空保持原值' : '尚未配置'}
            />
          </label>
        </section>
        <section className="panel form-stack">
          <h2>默认聊天行为</h2>
          <label className="toggle-row">
            <span>
              接收所有会话<small>关闭后仅接收明确添加的会话。</small>
            </span>
            <input
              type="checkbox"
              checked={draft.acceptAllSessions}
              onChange={(event) => setDraft({ ...draft, acceptAllSessions: event.target.checked })}
            />
          </label>
          <label>
            准入会话（每行一个）
            <textarea
              rows={3}
              value={draft.admissions.join('\n')}
              onChange={(event) =>
                setDraft({ ...draft, admissions: event.target.value.split('\n').filter(Boolean) })
              }
              placeholder="group:123456"
            />
          </label>
          <label>
            默认人设
            <textarea
              rows={5}
              value={draft.defaults.persona}
              onChange={(event) =>
                setDraft({ ...draft, defaults: { ...draft.defaults, persona: event.target.value } })
              }
            />
          </label>
        </section>
        <div className="row settings-footer">
          <button className="primary">保存设置</button>
          <span role="status">{notice}</span>
        </div>
      </form>
      <Slot point="settings.model.extra" />
      <Slot point="settings.persona.actions" />
    </>
  );
}
export default defineClientPlugin({
  id: 'console-settings',
  setup(ctx) {
    ctx.defineSlot('settings.model.extra');
    ctx.defineSlot('settings.persona.actions');
    ctx.page({ id: 'settings', path: '/settings', title: '设置', icon: '⚙', order: 30, component: Settings });
  },
});
