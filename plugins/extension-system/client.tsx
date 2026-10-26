import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  defineClientPlugin,
  useHost,
  useHostVersion,
  PluginBoundary,
  type SlotProps,
} from '@qq-harness/client-sdk';
import type {
  ExtensionDto,
  ExtensionField,
  ExtensionTabDto,
  ExtensionContributionDto,
  ExtensionPayload,
} from '@qq-harness/contracts';

const encode = encodeURIComponent;
const display = (value: unknown): string =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
const safeLink = (url: string) => /^(?:https?:\/\/|\/(?!\/)|#)/i.test(url);
export function Declarative({
  payload,
  invoke,
}: {
  payload: ExtensionPayload;
  invoke: (id: string, args?: Record<string, unknown>) => Promise<void>;
}): ReactNode {
  if (!payload) return null;
  const children = payload.children?.map((child, index) => (
    <Declarative key={index} payload={child} invoke={invoke} />
  ));
  const text = payload.text ?? payload.label ?? display(payload.value);
  switch (payload.type) {
    case 'divider':
      return <hr />;
    case 'badge':
      return <span className="pill">{text}</span>;
    case 'text':
      return <p>{text}</p>;
    case 'card':
      return (
        <section className="panel">
          <h3>{payload.title}</h3>
          {text}
          {children}
        </section>
      );
    case 'metric':
      return (
        <article className="panel">
          <small>{payload.title ?? payload.label}</small>
          <strong>{display(payload.value)}</strong>
        </article>
      );
    case 'list':
      return (
        <ul>
          {payload.items?.map((item, i) => (
            <li key={i}>
              {typeof item === 'object' && item && 'type' in item ? (
                <Declarative payload={item as ExtensionPayload} invoke={invoke} />
              ) : item && typeof item === 'object' && 'text' in item ? (
                display(item.text)
              ) : (
                display(item)
              )}
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <table>
          <thead>
            <tr>
              {payload.columns?.map((column, i) => (
                <th key={i}>{typeof column === 'string' ? column : (column.label ?? column.key)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payload.rows?.map((row, i) => (
              <tr key={i}>
                {Array.isArray(row)
                  ? row
                      .slice(0, payload.columns?.length || 8)
                      .map((cell, j) => <td key={j}>{display(cell)}</td>)
                  : payload.columns?.map((column, j) => (
                      <td key={j}>{display(row[typeof column === 'string' ? column : column.key])}</td>
                    ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'button':
    case 'menuItem':
      return payload.actionId ? (
        <button type="button" onClick={() => void invoke(payload.actionId!)}>
          {text}
        </button>
      ) : null;
    case 'link':
      return safeLink(payload.href ?? '') ? (
        <a href={payload.href} target="_blank" rel="noreferrer">
          {text}
        </a>
      ) : null;
    case 'form':
      return (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void invoke(payload.actionId ?? '', Object.fromEntries(new FormData(event.currentTarget)));
          }}
        >
          {payload.fields?.map((field) => (
            <label key={field.name}>
              {field.label ?? field.name}
              <input
                name={field.name}
                type={field.type === 'password' ? 'password' : 'text'}
                defaultValue={field.value ?? ''}
              />
            </label>
          ))}
          <button>{payload.submitLabel ?? '保存'}</button>
        </form>
      );
    default:
      return null;
  }
}

function Contributions({ point, context = {} }: { point: string; context?: Record<string, unknown> }) {
  const host = useHost();
  const [notice, setNotice] = useState('');
  const page = point.startsWith('shell.')
    ? 'shell'
    : point.startsWith('page.extensions.repository.')
      ? 'plugins'
      : point.split('.')[1]!;
  const chatKey = String(context.chatKey ?? '');
  const query = useQuery({
    queryKey: ['extension-system', 'contributions', page, chatKey],
    queryFn: ({ signal }) =>
      host.api.request<{ points: Record<string, ExtensionContributionDto[]> }>(
        `/api/ui/contributions?page=${encode(page)}&chat=${encode(chatKey)}`,
        { signal },
      ),
  });
  return (
    <>
      {query.data?.points[point]?.map((item) => {
        const invoke = async (actionId: string, args: Record<string, unknown> = {}) => {
          try {
            const result = await host.api.request<{ ok: boolean; result?: unknown; error?: string }>(
              `/api/extensions/${encode(item.ownerId)}/ui-actions/${encode(actionId)}`,
              { method: 'POST', body: JSON.stringify({ ...context, ...args, chat: chatKey, chatKey }) },
            );
            setNotice(result.ok ? display(result.result ?? '已完成') : String(result.error));
            await host.queries.invalidateQueries();
          } catch (error) {
            setNotice(String(error));
          }
        };
        return (
          <div key={`${item.ownerId}/${item.id}`}>
            <Declarative payload={item.payload} invoke={invoke} />
            {item.actions?.map((action) => (
              <button type="button" key={action.id} onClick={() => void invoke(action.actionId || action.id)}>
                {action.label || action.id}
              </button>
            ))}
          </div>
        );
      })}
      {notice && <span role="status">{notice}</span>}
    </>
  );
}
function Field({
  name,
  field,
  value,
  update,
}: {
  name: string;
  field: ExtensionField;
  value: unknown;
  update: (value: unknown) => void;
}) {
  const label = field.label ?? name;
  if (field.type === 'internal') return null;
  if (field.type === 'boolean' || typeof value === 'boolean')
    return (
      <label className="toggle-row">
        {label}
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => update(e.target.checked)} />
      </label>
    );
  if (field.values)
    return (
      <label>
        {label}
        <select value={String(value ?? '')} onChange={(e) => update(e.target.value)}>
          {field.values.map((option) => (
            <option key={option} value={option}>
              {field.labels?.[option] ?? option}
            </option>
          ))}
        </select>
      </label>
    );
  const structured = typeof value === 'object' && value !== null;
  return (
    <label>
      {label}
      {structured || field.type === 'text' || field.type === 'textarea' ? (
        <textarea
          aria-label={label}
          rows={4}
          defaultValue={structured ? JSON.stringify(value, null, 2) : String(value ?? '')}
          onChange={(e) => {
            if (structured) {
              try {
                update(JSON.parse(e.target.value));
              } catch {
                e.target.setCustomValidity('请输入合法 JSON');
                return;
              }
            } else update(e.target.value);
            e.target.setCustomValidity('');
          }}
        />
      ) : (
        <input
          aria-label={label}
          type={
            field.secret || /key|token|password|secret|cookie/i.test(name)
              ? 'password'
              : field.type === 'number' || typeof value === 'number'
                ? 'number'
                : 'text'
          }
          min={field.min}
          max={field.max}
          value={String(value ?? '')}
          onChange={(e) =>
            update(
              field.type === 'number' || typeof value === 'number' ? Number(e.target.value) : e.target.value,
            )
          }
        />
      )}
      {field.description && <small>{field.description}</small>}
    </label>
  );
}
function Settings({ row, chatKey, close }: { row: ExtensionDto; chatKey: string; close: () => void }) {
  const host = useHost();
  const [draft, setDraft] = useState(row.settings);
  const [error, setError] = useState('');
  return (
    <section
      className="panel"
      role="dialog"
      aria-modal="true"
      aria-label={`${row.name}设置`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <h2>
        {row.name} · {chatKey || '全局默认设置'}
      </h2>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void host.api
            .request(`/api/extensions/${encode(row.id)}/settings?chat=${encode(chatKey)}`, {
              method: 'PATCH',
              body: JSON.stringify({ settings: draft }),
            })
            .then(async () => {
              await host.queries.invalidateQueries();
              close();
            })
            .catch((error) => setError(String(error)));
        }}
      >
        {Object.entries({
          ...Object.fromEntries(Object.keys(draft).map((key) => [key, {}])),
          ...row.settingsSchema,
        })
          .filter(([key]) => key !== 'enabled')
          .map(([key, field]) => (
            <Field
              key={key}
              name={key}
              field={field}
              value={draft[key]}
              update={(value) => setDraft({ ...draft, [key]: value })}
            />
          ))}
        <div className="row">
          <button className="primary">保存扩展设置</button>
          <button type="button" onClick={close}>
            关闭
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
    </section>
  );
}
function KnowledgeEditor({ row, close }: { row: ExtensionDto; close: () => void }) {
  const host = useHost();
  const [file, setFile] = useState('');
  const [content, setContent] = useState('');
  const [notice, setNotice] = useState('');
  const docs = useQuery({
    queryKey: ['extension-system', 'docs', row.id],
    queryFn: () =>
      host.api.request<{ docs: { id: string; ownerId: string; path: string }[] }>('/api/extensions/docs'),
  });
  const base = `/api/extensions/knowledge/${encode(row.id)}`;
  return (
    <section className="panel" role="dialog" aria-label="知识库编辑">
      <h2>{row.name}</h2>
      <select
        aria-label="知识文件"
        value={file}
        onChange={(e) => {
          const next = e.target.value;
          setFile(next);
          if (next)
            void host.api
              .request<{ content: string }>(`${base}/file?relPath=${encode(next)}`)
              .then((result) => setContent(result.content))
              .catch((error) => setNotice(String(error)));
        }}
      >
        <option value="">选择文档</option>
        {docs.data?.docs
          .filter((doc) => doc.ownerId === row.id)
          .map((doc) => (
            <option key={doc.id} value={doc.path}>
              {doc.path}
            </option>
          ))}
      </select>
      <textarea
        aria-label="知识正文"
        rows={14}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="row">
        <button
          disabled={!file}
          onClick={() =>
            void host.api
              .request(`${base}/file`, { method: 'PUT', body: JSON.stringify({ relPath: file, content }) })
              .then(() => setNotice('已保存'))
              .catch((error) => setNotice(String(error)))
          }
        >
          保存正文
        </button>
        <button
          onClick={() =>
            void host.api
              .request(`${base}/summaries`, { method: 'POST', body: '{}' })
              .then(() => {
                setNotice('已补全摘要');
                void host.queries.invalidateQueries();
              })
              .catch((error) => setNotice(String(error)))
          }
        >
          补全摘要
        </button>
        <button
          onClick={() =>
            void host.api
              .request(`${base}/changes`)
              .then((result) => setNotice(display(result)))
              .catch((error) => setNotice(String(error)))
          }
        >
          检查变化
        </button>
        <button onClick={close}>关闭</button>
      </div>
      <p role="status">{notice}</p>
    </section>
  );
}
function Importer({ done }: { done: () => void }) {
  const host = useHost();
  const [files, setFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<unknown>();
  const [error, setError] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [root, setRoot] = useState('');
  const body = async () => {
    const base64 = async (file: File) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let value = '';
      for (const byte of bytes) value += String.fromCharCode(byte);
      return btoa(value);
    };
    if (files.length === 1 && /\.zip$/i.test(files[0]!.name)) return { data: await base64(files[0]!) };
    return {
      files: await Promise.all(
        files.map(async (file) => ({ rel: file.webkitRelativePath || file.name, data: await base64(file) })),
      ),
    };
  };
  const submit = async (dry: boolean) => {
    try {
      const result = await host.api.request(
        `/api/extensions/import?dry=${dry ? 1 : 0}&overwrite=${overwrite ? 1 : 0}&root=${encode(root)}`,
        { method: 'POST', body: JSON.stringify(await body()) },
      );
      setAnalysis(result);
      if (!dry) {
        await host.queries.invalidateQueries();
        done();
      }
    } catch (error) {
      setError(String(error));
    }
  };
  return (
    <section className="panel">
      <h2>导入扩展包</h2>
      <p>先预览目录与冲突，再确认安装；安装后默认关闭。</p>
      <div className="row">
        <input
          aria-label="扩展 ZIP 或文件"
          type="file"
          multiple
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
            setAnalysis(undefined);
          }}
        />
        <input
          aria-label="扩展文件夹"
          type="file"
          multiple
          {...{ webkitdirectory: '' }}
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
            setAnalysis(undefined);
          }}
        />
        <select
          aria-label="安装位置"
          value={root}
          onChange={(e) => {
            setRoot(e.target.value);
            setAnalysis(undefined);
          }}
        >
          <option value="">按清单自动识别</option>
          <option value="chat-plugins">会话插件</option>
        </select>
        <label>
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          允许覆盖同名包
        </label>
        <button disabled={!files.length} onClick={() => void submit(true)}>
          预览导入
        </button>
        <button disabled={!analysis} onClick={() => void submit(false)}>
          确认安装
        </button>
        <button onClick={done}>关闭导入</button>
      </div>
      {analysis !== undefined && <pre>{JSON.stringify(analysis, null, 2)}</pre>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function ExtensionRepository({
  context = {},
  managerType,
}: Partial<SlotProps> & { managerType?: string }) {
  const host = useHost();
  useHostVersion();
  const chatKey = String(context.chatKey ?? '');
  const [selected, setSelected] = useState('plugin');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ExtensionDto>();
  const [knowledge, setKnowledge] = useState<ExtensionDto>();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<ExtensionDto>();
  const [pendingEnabled, setPendingEnabled] = useState<Record<string, boolean>>({});
  const rows = useQuery({
    queryKey: ['extension-system', 'list', chatKey],
    queryFn: ({ signal }) =>
      host.api.request<{ extensions: ExtensionDto[] }>(`/api/extensions?chat=${encode(chatKey)}`, { signal }),
  });
  const tabs = useQuery({
    queryKey: ['extension-system', 'tabs'],
    queryFn: ({ signal }) =>
      host.api.request<{ types: ExtensionTabDto[] }>('/api/extension-types', { signal }),
  });
  const allTabs = (tabs.data?.types ?? []).filter((tab) => !chatKey || tab.scope !== 'global');
  const tab = allTabs.find((tab) => tab.id === (managerType ?? selected)) ?? allTabs[0];
  const ownedPanel = !managerType
    ? host.listSlot('extensions.manager-panels').find((item) => item.value.id === tab?.id)
    : undefined;
  const visible = (rows.data?.extensions ?? []).filter(
    (row) =>
      (tab?.id === 'plugin'
        ? row.type === 'plugin' && row.scope === 'global'
        : tab?.id === 'chat-plugin'
          ? row.type === 'plugin' && row.scope === 'session'
          : row.type === (tab?.type ?? tab?.id) || (tab?.id === 'context' && row.type === 'promptinject')) &&
      (!chatKey || row.scope !== 'global') &&
      `${row.id} ${row.name} ${row.description ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await host.queries.invalidateQueries();
      setError('');
    } catch (error) {
      setError(String(error));
    }
  };
  const toggle = async (id: string, enabled: boolean) => {
    setPendingEnabled((previous) => ({ ...previous, [id]: enabled }));
    try {
      await host.api.request(`/api/extensions/${encode(id)}/settings?chat=${encode(chatKey)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      await host.queries.invalidateQueries();
      setError('');
    } catch (error) {
      setError(String(error));
    } finally {
      setPendingEnabled((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    }
  };
  return (
    <>
      {!chatKey && !managerType && (
        <div className="page-heading">
          <div>
            <span className="eyebrow">EXTENSIONS</span>
            <h1>扩展仓库</h1>
            <p>全局插件、会话插件、工具、MCP、技能、知识库与上下文注入。</p>
          </div>
          <div className="row">
            <button onClick={() => setImporting(true)}>导入扩展</button>
            <button
              onClick={() =>
                void run(() => host.api.request('/api/skills/reload', { method: 'POST', body: '{}' }))
              }
            >
              重载扩展
            </button>
          </div>
        </div>
      )}
      {chatKey && !managerType && <p>{chatKey} 的扩展设置会保存为独立快照。全局插件由仓库统一管理。</p>}
      {importing && <Importer done={() => setImporting(false)} />}
      {!managerType && (
        <div className="tabs" role="tablist">
          {allTabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={item.id === tab?.id}
              onClick={() => setSelected(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {!ownedPanel && (
        <div className="row">
          <input
            aria-label="搜索扩展"
            placeholder="搜索名称或 id"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="muted">{tab?.hint}</span>
        </div>
      )}
      {ownedPanel ? (
        <PluginBoundary name={ownedPanel.owner}>
          <ownedPanel.value.component context={context} />
        </PluginBoundary>
      ) : tab?.template === 'iframe' ? (
        <iframe
          title={tab.label}
          sandbox="allow-scripts"
          src={`/api/extensions/${encode(tab.ownerId ?? '')}/page?file=${encode(tab.page ?? 'ui/tab.html')}`}
        />
      ) : (
        <div className="plugin-grid">
          {visible.map((row) => (
            <article className="panel plugin-card" key={row.id}>
              <div className="section-heading">
                <h3>{row.name}</h3>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`启用扩展 ${row.id}`}
                    checked={pendingEnabled[row.id] ?? row.enabled}
                    disabled={row.id in pendingEnabled}
                    onChange={(e) => void toggle(row.id, e.target.checked)}
                  />
                  启用
                </label>
              </div>
              <code>{row.id}</code>
              <p>{row.description}</p>
              <p className="muted">
                {row.active ? '运行中' : row.reason || '已关闭'} · {row.version}
              </p>
              <div className="row">
                <button onClick={() => setEditing(row)}>设置</button>
                {row.type === 'knowledge' && <button onClick={() => setKnowledge(row)}>编辑知识库</button>}
                {chatKey ? (
                  <button
                    onClick={() =>
                      void run(() =>
                        host.api.request(
                          `/api/extensions/${encode(row.id)}/settings?chat=${encode(chatKey)}`,
                          { method: 'DELETE' },
                        ),
                      )
                    }
                  >
                    恢复默认
                  </button>
                ) : (
                  !row.id.startsWith('ext-') && <button onClick={() => setDeleting(row)}>删除扩展</button>
                )}
              </div>
              <Contributions
                point="page.extensions.repository.card-actions"
                context={{ ...context, extensionId: row.id }}
              />
            </article>
          ))}
          {!visible.length && <p className="empty">此类型还没有安装的扩展。</p>}
        </div>
      )}
      <Contributions point="page.extensions.repository.detail-tabs" context={context} />
      {editing && (
        <Settings
          key={`${editing.id}/${chatKey}`}
          row={editing}
          chatKey={chatKey}
          close={() => setEditing(undefined)}
        />
      )}
      {knowledge && <KnowledgeEditor row={knowledge} close={() => setKnowledge(undefined)} />}
      {deleting && (
        <section className="panel" role="dialog" aria-label="删除扩展">
          <p>确认删除 {deleting.name} 的包文件？</p>
          <button
            onClick={() =>
              void run(async () => {
                await host.api.request(
                  `/api/extensions/${deleting.type === 'plugin' && deleting.scope === 'session' ? 'chat-plugin' : deleting.type}/${encode(deleting.id)}`,
                  { method: 'DELETE' },
                );
                setDeleting(undefined);
              })
            }
          >
            确认删除扩展
          </button>
          <button onClick={() => setDeleting(undefined)}>取消</button>
        </section>
      )}
      {(error || rows.error || tabs.error) && (
        <p className="error" role="alert">
          {error || String(rows.error ?? tabs.error)}
        </p>
      )}
    </>
  );
}
export default defineClientPlugin({
  id: 'extension-system',
  requires: ['console-chats', 'console-settings', 'console-overview'],
  setup(ctx) {
    ctx.defineSlot('extensions.manager-panels');
    ctx.page({
      id: 'extensions',
      path: '/extensions',
      title: '扩展仓库',
      icon: '◇',
      order: 25,
      component: ExtensionRepository,
    });
    ctx.slot('conversation.detail.tabs', {
      id: 'v2-extensions',
      title: '会话扩展',
      order: 80,
      component: ExtensionRepository,
    });
    ctx.slot('conversation.detail.header-actions', {
      id: 'v2-actions',
      order: 80,
      component: ({ context }) => (
        <Contributions point="page.chatmanage.session-detail.header-actions" context={context} />
      ),
    });
    ctx.slot('conversation.list.row-actions', {
      id: 'v2-row-actions',
      component: ({ context }) => (
        <Contributions point="page.chatmanage.session-list.row-actions" context={context} />
      ),
    });
    ctx.slot('conversation.detail.tabs', {
      id: 'v2-contributions',
      title: '扩展面板',
      order: 85,
      component: ({ context }) => (
        <>
          <Contributions point="page.chatmanage.session-detail.tabs" context={context} />
          <Contributions point="page.chatmanage.session-settings.sections" context={context} />
        </>
      ),
    });
    ctx.slot('shell.header.actions', {
      id: 'v2-status',
      component: () => <Contributions point="shell.status.right" />,
    });
    ctx.slot('shell.nav.extra', {
      id: 'v2-nav',
      component: () => <Contributions point="shell.nav.primary" />,
    });
    ctx.slot('settings.model.extra', {
      id: 'v2-model',
      component: ({ context }) => <Contributions point="page.settings.model.extra" context={context} />,
    });
    ctx.slot('settings.persona.actions', {
      id: 'v2-prompts',
      component: ({ context }) => <Contributions point="page.prompts.editor.actions" context={context} />,
    });
    ctx.slot('overview.summary.extra', {
      id: 'v2-usage',
      component: ({ context }) => <Contributions point="page.usage.summary.cards" context={context} />,
    });
  },
});
