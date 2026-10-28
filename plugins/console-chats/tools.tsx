import { Action } from '@qq-harness/client-sdk';
import { Toggle } from '@qq-harness/client-sdk';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHost, Drawer } from '@qq-harness/client-sdk';
import type { ToolDescriptor, ChatSettings } from '@qq-harness/contracts';
export function ToolManager({
  chatKey = 'default',
  standalone = false,
}: {
  chatKey?: string;
  standalone?: boolean;
}) {
  const host = useHost(),
    [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [editing, setEditing] = useState<ToolDescriptor>(),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['tool-manager', chatKey],
    queryFn: ({ signal }) =>
      host.api.request<{
        tools: ToolDescriptor[];
        settings: ChatSettings['tools'];
      }>(`/api/tools?scope=${encodeURIComponent(chatKey)}`, { signal }),
  });
  const update = async (patch: Partial<ChatSettings['tools']>) => {
    setPending(true);
    setNotice('');
    try {
      await host.api.request('/api/tools/settings', {
        method: 'PATCH',
        body: JSON.stringify({ scope: chatKey, patch }),
      });
      await host.queries.invalidateQueries();
      setNotice('工具设置已保存');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const qqTools = data?.tools.filter((t) => t.builtinQQ || t.owner === 'agent-memory') ?? [];
  const categories = [...new Set(qqTools.map((t) => t.category))];
  const rows =
    qqTools.filter(
      (t) =>
        (!category || t.category === category) &&
        `${t.id} ${t.name} ${t.description}`.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  const names: Record<string, string> = {
    messaging: '消息发送',
    query: '会话查询',
    media: '图片与视频',
    web: '联网搜索',
    sticker: '表情库',
    reminders: '提醒',
    memory: '记忆',
    system: '系统与提醒',
    other: '其他工具',
  };
  return (
    <section className="tool-manager form-stack">
      {!standalone && (
        <div className="section-heading">
          <div>
            <h2>内置工具</h2>
            <p className="muted">查看模型实际可用的工具、参数与停用原因。</p>
          </div>
        </div>
      )}
      {isPending && <p role="status">正在加载工具…</p>}
      {error && <Action onClick={() => void refetch()}>重试加载工具</Action>}
      {data ? (
        <div className="settings-switches">
          <label className="toggle-row">
            <Toggle
              checked={data.settings.enabled}
              disabled={pending}
              onChange={(e) => void update({ enabled: e.target.checked })}
            />
            工具总开关
          </label>
          <label className="toggle-row">
            <Toggle
              checked={data.settings.crossChatSend}
              disabled={pending}
              onChange={(e) => void update({ crossChatSend: e.target.checked })}
            />
            允许跨会话发送
          </label>
          <small>核心工具不受分类和单项开关影响，仍受总开关、所属插件、准入与运行条件约束。</small>
        </div>
      ) : null}
      <div className="toolbar">
        <span className="pill">
          {isPending ? '加载中…' : `${qqTools.filter((t) => t.enabled).length} / ${qqTools.length} 可用`}
        </span>
        <input
          placeholder="搜索工具名称、用途"
          aria-label="搜索内置工具"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="工具分类" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">全部分类</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {names[c] ?? c}
            </option>
          ))}
        </select>
        {category && data ? (
          <label className="toggle-row">
            <Toggle
              checked={data.settings.categories[category] !== false}
              onChange={(e) =>
                void update({
                  categories: {
                    ...data.settings.categories,
                    [category]: e.target.checked,
                  },
                })
              }
            />
            启用分类
          </label>
        ) : null}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error.message}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="table-wrap">
        <table className="qq-tools-table">
          <colgroup>
            <col style={{ width: 200 }} />
            <col />
            <col style={{ width: 150 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 94 }} />
          </colgroup>
          <thead>
            <tr>
              <th>工具</th>
              <th>用途</th>
              <th>状态</th>
              <th>启用</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((tool) => (
              <tr key={tool.id}>
                <td>
                  <strong>{tool.name}</strong>
                  <small>
                    <code>{tool.id}</code> · {names[tool.category] ?? tool.category}
                  </small>
                </td>
                <td>{tool.description.slice(0, 140)}</td>
                <td>
                  <span className={`pill ${tool.enabled ? 'positive' : ''}`}>
                    {tool.enabled ? '可用' : '不可用'}
                  </span>
                  {tool.reason ? <small>{tool.reason}</small> : null}
                </td>
                <td>
                  {tool.core ? (
                    <span className="pill">核心</span>
                  ) : (
                    <Toggle
                      disabled={pending}
                      aria-label={`启用工具 ${tool.id}`}
                      checked={data?.settings.overrides[tool.id] !== false}
                      onChange={(e) =>
                        void update({
                          overrides: {
                            ...data?.settings.overrides,
                            [tool.id]: e.target.checked,
                          },
                        })
                      }
                    />
                  )}
                </td>
                <td>
                  <Action onClick={() => setEditing(tool)}>调用说明</Action>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? (
        <Drawer title={editing.name + ' · 调用说明'} onClose={() => setEditing(undefined)}>
          <p>{editing.description}</p>
          <dl className="detail-fields">
            <div>
              <dt>所属插件</dt>
              <dd>{editing.owner}</dd>
            </div>
            <div>
              <dt>当前状态</dt>
              <dd>{editing.enabled ? '可用' : editing.reason}</dd>
            </div>
          </dl>
          <h3>参数</h3>
          <table>
            <thead>
              <tr>
                <th>字段</th>
                <th>类型</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(
                (editing.parameters.properties ?? {}) as Record<
                  string,
                  { type?: string; description?: string }
                >,
              ).map(([key, p]) => (
                <tr key={key}>
                  <td>
                    <code>{key}</code>
                    {Array.isArray(editing.parameters.required) && editing.parameters.required.includes(key)
                      ? ' *'
                      : ''}
                  </td>
                  <td>{p.type}</td>
                  <td>{p.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>完整参数 Schema</summary>
            <pre>{JSON.stringify(editing.parameters, null, 2)}</pre>
          </details>
        </Drawer>
      ) : null}
    </section>
  );
}
