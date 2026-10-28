import { Action } from '@qq-harness/client-sdk';
import { Alert, Button, Descriptions, Tag } from 'antd';
import { Toggle, Selection } from '@qq-harness/client-sdk';
import { useState, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  defineClientPlugin,
  useHost,
  useHostVersion,
  PluginBoundary,
  Drawer,
  dialogs,
  useUnsavedChanges,
  type SlotProps,
} from '@qq-harness/client-sdk';
import type {
  ExtensionDto,
  ExtensionField,
  ExtensionTabDto,
  ExtensionContributionDto,
  ExtensionPayload,
  ToolDescriptor,
} from '@qq-harness/contracts';
import './client.css';

const encode = encodeURIComponent;
function ProvidedTools({ chatKey }: { chatKey: string }) {
  const host = useHost(),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<ToolDescriptor>();
  const { data, error } = useQuery({
    queryKey: ['extension-system', 'provided-tools', chatKey],
    queryFn: ({ signal }) =>
      host.api.request<{
        tools: (ToolDescriptor & { extensionId: string | null })[];
      }>(`/api/extension-tools?chat=${encode(chatKey)}`, { signal }),
  });
  const supplied = (data?.tools ?? []).filter((tool) => tool.extensionId);
  const [pendingTool, setPendingTool] = useState(''),
    [toolNotice, setToolNotice] = useState('');
  const enableTool = async (id: string, enabled: boolean) => {
    setPendingTool(id);
    try {
      await host.api.request('/api/tools/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          scope: chatKey || 'default',
          patch: { overrides: { [id]: enabled } },
        }),
      });
      setToolNotice('工具设置已保存');
      await host.queries.invalidateQueries();
    } catch (e) {
      setToolNotice(String(e));
    } finally {
      setPendingTool('');
    }
  };
  const visible = supplied.filter((tool) =>
      `${tool.id} ${tool.name} ${tool.extensionId} ${tool.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ),
    count = Math.max(1, Math.ceil(visible.length / 20)),
    current = Math.min(page, count);
  return (
    <section className="form-stack">
      <h3>插件与技能提供的工具（{supplied.length}）</h3>
      <p className="muted">
        旧技能中的工具随所属扩展加载，启停和配置在所属扩展中管理。框架内置工具在左侧“内置工具”页面管理。
      </p>
      <input
        aria-label="筛选插件工具"
        placeholder="工具、用途或所属扩展"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {error && <p role="alert">{error.message}</p>}
      {toolNotice && <p role="status">{toolNotice}</p>}
      <div className="table-wrap">
        <table className="provided-tools-table">
          <colgroup>
            <col className="provided-tool-name" />
            <col className="provided-tool-owner" />
            <col />
            <col className="provided-tool-state" />
            <col className="provided-tool-action" />
          </colgroup>
          <thead>
            <tr>
              <th>工具</th>
              <th>所属扩展</th>
              <th>用途</th>
              <th>当前状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.slice((current - 1) * 20, current * 20).map((tool) => (
              <tr key={tool.id}>
                <td>
                  <strong>{tool.name}</strong>
                  <small className="muted">{tool.id}</small>
                </td>
                <td>{tool.extensionId}</td>
                <td>
                  <p className="provided-tool-summary" title={tool.description}>
                    {tool.description}
                  </p>
                </td>
                <td>
                  <div className="row">
                    <Toggle
                      aria-label={'启用插件工具 ' + tool.id}
                      checked={tool.configuredEnabled !== false}
                      disabled={tool.core || pendingTool === tool.id}
                      onChange={(e) => void enableTool(tool.id, e.target.checked)}
                    />
                    <span className="badge">
                      {!chatKey || chatKey === 'default' ? '配置预览' : tool.enabled ? '可用' : '不可用'}
                    </span>
                  </div>
                  {chatKey && chatKey !== 'default' && !tool.enabled && (
                    <small className="muted provided-tool-summary" title={tool.reason}>
                      {tool.reason}
                    </small>
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
      {!supplied.length && !error && (
        <p className="empty">当前没有已加载的扩展工具；启用所属技能后会自动列出。</p>
      )}
      {count > 1 && (
        <div className="row">
          <Action aria-label="工具上一页" disabled={current <= 1} onClick={() => setPage(current - 1)}>
            上一页
          </Action>
          <span>
            {current}/{count}
          </span>
          <Action aria-label="工具下一页" disabled={current >= count} onClick={() => setPage(current + 1)}>
            下一页
          </Action>
        </div>
      )}
      {editing && (
        <Drawer title={editing.name + ' · 调用说明'} onClose={() => setEditing(undefined)}>
          <p>{editing.description}</p>
          <table>
            <thead>
              <tr>
                <th>参数</th>
                <th>类型</th>
                <th>必填</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(
                (editing.parameters.properties ?? {}) as Record<
                  string,
                  { type?: string; description?: string }
                >,
              ).map(([name, field]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{field?.type ?? '复合类型'}</td>
                  <td>
                    {Array.isArray(editing.parameters.required) && editing.parameters.required.includes(name)
                      ? '是'
                      : '否'}
                  </td>
                  <td>{field?.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>完整 JSON Schema</summary>
            <pre className="code-block">{JSON.stringify(editing.parameters, null, 2)}</pre>
          </details>
          <Action onClick={() => setEditing(undefined)}>关闭</Action>
        </Drawer>
      )}
    </section>
  );
}
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
        <Action type="button" onClick={() => void invoke(payload.actionId!)}>
          {text}
        </Action>
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
          <Action>{payload.submitLabel ?? '保存'}</Action>
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
            const result = await host.api.request<{
              ok: boolean;
              result?: unknown;
              error?: string;
            }>(`/api/extensions/${encode(item.ownerId)}/ui-actions/${encode(actionId)}`, {
              method: 'POST',
              body: JSON.stringify({
                ...context,
                ...args,
                chat: chatKey,
                chatKey,
              }),
            });
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
              <Action type="button" key={action.id} onClick={() => void invoke(action.actionId || action.id)}>
                {action.label || action.id}
              </Action>
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
        <Toggle checked={Boolean(value)} onChange={(e) => update(e.target.checked)} />
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
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false);
  useUnsavedChanges(dirty || saving);
  const requestClose = async () => {
    if (saving) return;
    if (
      dirty &&
      !(await dialogs.confirm({
        title: '放弃扩展设置修改',
        description: '未保存的修改会丢失。是否关闭？',
        danger: true,
      }))
    )
      return;
    close();
  };
  if (row.details.nativePort)
    return (
      <Drawer title={`${row.name}设置`} onClose={close}>
        <p>{row.reason}</p>
        <p className="muted">旧设置已保留供追溯；请在对应的原生功能页面管理当前配置。</p>
        <Action onClick={close}>关闭</Action>
      </Drawer>
    );
  return (
    <Drawer
      title={`${row.name}设置`}
      onClose={() => {
        void requestClose();
      }}
    >
      <p className="muted">{chatKey || '全局默认设置'}</p>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (saving) return;
          setSaving(true);
          setError('');
          void host.api
            .request(`/api/extensions/${encode(row.id)}/settings?chat=${encode(chatKey)}`, {
              method: 'PATCH',
              body: JSON.stringify({ settings: draft }),
            })
            .then(async () => {
              await host.queries.invalidateQueries();
              setDirty(false);
              close();
            })
            .catch((error) => setError(String(error)))
            .finally(() => setSaving(false));
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
              update={(value) => {
                setDraft({ ...draft, [key]: value });
                setDirty(true);
              }}
            />
          ))}
        <div className="row">
          <Action className="primary" disabled={saving}>
            {saving ? '保存中…' : '保存扩展设置'}
          </Action>
          <Action
            type="button"
            disabled={saving}
            onClick={() => {
              void requestClose();
            }}
          >
            关闭
          </Action>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
    </Drawer>
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
      host.api.request<{
        docs: { id: string; ownerId: string; path: string }[];
      }>('/api/extensions/docs'),
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
        <Action
          disabled={!file}
          onClick={() =>
            void host.api
              .request(`${base}/file`, {
                method: 'PUT',
                body: JSON.stringify({ relPath: file, content }),
              })
              .then(() => setNotice('已保存'))
              .catch((error) => setNotice(String(error)))
          }
        >
          保存正文
        </Action>
        <Action
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
        </Action>
        <Action
          onClick={() =>
            void host.api
              .request(`${base}/changes`)
              .then((result) => setNotice(display(result)))
              .catch((error) => setNotice(String(error)))
          }
        >
          检查变化
        </Action>
        <Action onClick={close}>关闭</Action>
      </div>
      <p role="status">{notice}</p>
    </section>
  );
}
function Importer({ done }: { done: () => void }) {
  const host = useHost();
  const [files, setFiles] = useState<File[]>([]);
  const filePicker = useRef<HTMLInputElement>(null),
    folderPicker = useRef<HTMLInputElement>(null);
  const [analysis, setAnalysis] = useState<unknown>();
  const [error, setError] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const root = '';
  const [pending, setPending] = useState(false);
  const details = (analysis as { analysis?: Record<string, any> } | undefined)?.analysis;
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
        files.map(async (file) => ({
          rel: file.webkitRelativePath || file.name,
          data: await base64(file),
        })),
      ),
    };
  };
  const submit = async (dry: boolean) => {
    setPending(true);
    setError('');
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
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="extension-importer form-stack">
      <h2>导入扩展包</h2>
      <Alert
        type="info"
        showIcon
        title="按清单 type 自动识别类型与安装位置。先预览、再安装；安装后默认关闭。所有包必须提供类型声明。"
      />
      <div className="row">
        <Action type="button" onClick={() => filePicker.current?.click()}>
          选择 ZIP 或文件
        </Action>
        <Action type="button" onClick={() => folderPicker.current?.click()}>
          选择文件夹
        </Action>
        <input
          ref={filePicker}
          hidden
          aria-label="扩展 ZIP 或文件"
          type="file"
          multiple
          className="import-file-picker"
          onChange={(e) => {
            setError('');
            setFiles(Array.from(e.target.files ?? []));
            setAnalysis(undefined);
          }}
        />
        <input
          ref={folderPicker}
          hidden
          aria-label="扩展文件夹"
          type="file"
          multiple
          {...{ webkitdirectory: '' }}
          onChange={(e) => {
            setFiles(Array.from(e.target.files ?? []));
            setAnalysis(undefined);
          }}
        />
        <label>
          <Toggle checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          允许覆盖同名包
        </label>
        <Action className="primary" disabled={!files.length || pending} onClick={() => void submit(true)}>
          预览导入
        </Action>
        <Action className="primary" disabled={!analysis || pending} onClick={() => void submit(false)}>
          确认安装
        </Action>
        <Action onClick={done}>关闭导入</Action>
      </div>
      <div className="import-files">
        {files.length ? (
          <>
            <strong>已选择 {files.length} 个文件</strong>
            <p>
              {files
                .slice(0, 8)
                .map((f) => f.name)
                .join(' · ')}
              {files.length > 8 ? ' …' : ''}
            </p>
          </>
        ) : (
          <p>选择 ZIP、扩展文件夹，或同时选择清单与脚本文件。无需手动选择类型。</p>
        )}
      </div>
      {details && (
        <Descriptions
          bordered
          column={2}
          items={[
            { key: 'name', label: '扩展名称', children: details.name },
            {
              key: 'type',
              label: '识别类型',
              children: <Tag color="blue">{details.typeLabel ?? details.type}</Tag>,
            },
            { key: 'id', label: '标识', children: details.id },
            { key: 'target', label: '安装位置', children: details.relTarget },
            {
              key: 'conflict',
              label: '同名冲突',
              children: details.conflict ? '已存在，需明确允许覆盖' : '无冲突',
            },
            {
              key: 'size',
              label: '文件大小',
              children: Math.ceil(Number(details.totalSize ?? 0) / 1024) + ' KB',
            },
          ]}
        />
      )}
      {analysis !== undefined && (
        <details>
          <summary>完整安装清单</summary>
          <pre>{JSON.stringify(analysis, null, 2)}</pre>
        </details>
      )}
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
  const [statusFilter, setStatusFilter] = useState('all'),
    [page, setPage] = useState(1),
    [chosen, setChosen] = useState<string[]>([]),
    [bulkBusy, setBulkBusy] = useState(false);
  const rows = useQuery({
    queryKey: ['extension-system', 'list', chatKey],
    queryFn: ({ signal }) =>
      host.api.request<{ extensions: ExtensionDto[] }>(`/api/extensions?chat=${encode(chatKey)}`, {
        signal,
      }),
  });
  const tabs = useQuery({
    queryKey: ['extension-system', 'tabs'],
    queryFn: ({ signal }) =>
      host.api.request<{ types: ExtensionTabDto[] }>('/api/extension-types', {
        signal,
      }),
  });
  const allTabs = (tabs.data?.types ?? []).filter((tab) => !chatKey || tab.scope !== 'global');
  const tab = allTabs.find((tab) => tab.id === (managerType ?? selected)) ?? allTabs[0];
  const ownedPanel = !managerType
    ? host.listSlot('extensions.manager-panels').find((item) => item.value.id === tab?.id)
    : undefined;
  const visible = (rows.data?.extensions ?? [])
    .filter(
      (row) =>
        (tab?.id === 'plugin'
          ? row.type === 'plugin' && row.scope === 'global'
          : tab?.id === 'chat-plugin'
            ? row.type === 'plugin' && row.scope === 'session'
            : row.type === (tab?.type ?? tab?.id) ||
              (tab?.id === 'context' && row.type === 'promptinject')) &&
        (!chatKey || row.scope !== 'global') &&
        (statusFilter === 'all' ||
          (statusFilter === 'active' && row.active) ||
          (statusFilter === 'disabled' && !row.enabled) ||
          (statusFilter === 'unavailable' && row.enabled && !row.active)) &&
        `${row.id} ${row.name} ${row.description ?? ''}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN-u-co-pinyin'));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(visible.length / 20))),
    pageRows = visible.slice((currentPage - 1) * 20, currentPage * 20),
    selection = visible.filter((row) => chosen.includes(row.id));
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
  const bulk = async (enabled: boolean) => {
    if (!selection.length || bulkBusy) return;
    if (
      !(await dialogs.confirm({
        title: enabled ? '批量启用扩展' : '批量停用扩展',
        description: selection.map((row) => row.name).join('、'),
        confirmLabel: enabled ? '启用所选扩展' : '停用所选扩展',
        danger: !enabled,
      }))
    )
      return;
    setBulkBusy(true);
    const failures: string[] = [];
    for (const row of selection)
      try {
        await host.api.request(`/api/extensions/${encode(row.id)}/settings?chat=${encode(chatKey)}`, {
          method: 'PATCH',
          body: JSON.stringify({ enabled }),
        });
      } catch (error) {
        failures.push(row.name + '：' + String(error));
      }
    await host.queries.invalidateQueries();
    setError(failures.join('；'));
    setChosen([]);
    setBulkBusy(false);
  };
  return (
    <>
      {chatKey && !managerType && <p>{chatKey} 的扩展设置会保存为独立快照。全局插件由仓库统一管理。</p>}
      {importing && <Importer done={() => setImporting(false)} />}
      {!managerType && (
        <div className="extension-navigation">
          <div className="tabs" role="tablist">
            {allTabs.map((item) => (
              <Action
                key={item.id}
                role="tab"
                aria-selected={item.id === tab?.id}
                onClick={() => {
                  setSelected(item.id);
                  setPage(1);
                  setChosen([]);
                }}
              >
                {item.label}
              </Action>
            ))}
          </div>
          {!chatKey && (
            <div className="row">
              <Action onClick={() => setImporting(true)}>导入扩展</Action>
              <Action
                onClick={() =>
                  void run(() => host.api.request('/api/skills/reload', { method: 'POST', body: '{}' }))
                }
              >
                重载扩展
              </Action>
            </div>
          )}
        </div>
      )}
      {!ownedPanel && (
        <div className="toolbar extension-toolbar">
          <input
            aria-label="搜索扩展"
            placeholder="搜索名称或 id"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
              setChosen([]);
            }}
          />
          <select
            aria-label="扩展状态筛选"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
              setChosen([]);
            }}
          >
            <option value="all">全部状态</option>
            <option value="active">已生效</option>
            <option value="disabled">已停用</option>
            <option value="unavailable">等待条件</option>
          </select>
          <span className="muted">{tab?.hint}</span>
          {selection.length > 0 ? (
            <div className="row extension-bulk">
              <span>已选 {selection.length} 项</span>
              <Action
                disabled={bulkBusy}
                onClick={() => {
                  void bulk(true);
                }}
              >
                批量启用
              </Action>
              <Action
                disabled={bulkBusy}
                onClick={() => {
                  void bulk(false);
                }}
              >
                批量停用
              </Action>
              <Action disabled={bulkBusy} onClick={() => setChosen([])}>
                取消选择
              </Action>
            </div>
          ) : null}
        </div>
      )}
      {!ownedPanel && (tab?.type ?? tab?.id) === 'tool' && <ProvidedTools chatKey={chatKey} />}
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
        <div className="extension-list">
          <div className="table-wrap">
            <table className="extension-table">
              <colgroup>
                <col style={{ width: 40 }} />
                <col style={{ width: 220 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 150 }} />
                <col />
                <col style={{ width: 172 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="check-cell">
                    <Selection
                      aria-label="选择本页扩展"
                      checked={pageRows.length > 0 && pageRows.every((row) => chosen.includes(row.id))}
                      onChange={(e) =>
                        setChosen(
                          e.target.checked
                            ? [...new Set([...chosen, ...pageRows.map((row) => row.id)])]
                            : chosen.filter((id) => !pageRows.some((row) => row.id === id)),
                        )
                      }
                    />
                  </th>
                  <th>名称 / 标识</th>
                  <th>启用</th>
                  <th>状态</th>
                  <th>说明</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} data-extension={row.id}>
                    <td className="check-cell">
                      <Selection
                        aria-label={`选择扩展 ${row.id}`}
                        checked={chosen.includes(row.id)}
                        onChange={(e) =>
                          setChosen(
                            e.target.checked ? [...chosen, row.id] : chosen.filter((id) => id !== row.id),
                          )
                        }
                      />
                    </td>
                    <td className="extension-name">
                      <h3>{row.name}</h3>
                      <code>{row.id}</code>
                      <small>v{row.version}</small>
                    </td>
                    <td>
                      <Toggle
                        aria-label={`启用扩展 ${row.id}`}
                        checked={pendingEnabled[row.id] ?? row.enabled}
                        disabled={row.id in pendingEnabled || bulkBusy}
                        onChange={(e) => void toggle(row.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      <span className={`pill ${row.active ? 'positive' : ''}`}>
                        {row.active ? '已生效' : row.enabled ? '等待条件' : '已停用'}
                      </span>
                      {row.enabled && !row.active && row.reason ? (
                        <small className="extension-reason">{row.reason}</small>
                      ) : null}
                    </td>
                    <td className="extension-description">{row.description || '暂无说明'}</td>
                    <td>
                      <div className="row extension-actions">
                        <Action onClick={() => setEditing(row)}>设置</Action>
                        {row.type === 'knowledge' && (
                          <Action onClick={() => setKnowledge(row)}>编辑知识库</Action>
                        )}
                        {chatKey ? (
                          <Action
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
                          </Action>
                        ) : (
                          !row.id.startsWith('ext-') && (
                            <Action onClick={() => setDeleting(row)}>删除扩展</Action>
                          )
                        )}
                      </div>
                      <Contributions
                        point="page.extensions.repository.card-actions"
                        context={{ ...context, extensionId: row.id }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visible.length && (
            <p className="empty">
              {rows.isPending
                ? '正在加载扩展…'
                : search || statusFilter !== 'all'
                  ? '没有匹配的扩展。'
                  : '此类型还没有安装的扩展。'}
            </p>
          )}
          <div className="pagination">
            <span>共 {visible.length} 项</span>
            <Action disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              上一页
            </Action>
            <span>
              {currentPage} / {Math.max(1, Math.ceil(visible.length / 20))}
            </span>
            <Action disabled={currentPage * 20 >= visible.length} onClick={() => setPage(currentPage + 1)}>
              下一页
            </Action>
          </div>
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
        <Drawer title="删除扩展" onClose={() => setDeleting(undefined)}>
          <p>确认删除 {deleting.name} 的包文件？</p>
          <Action
            onClick={() =>
              void run(async () => {
                await host.api.request(`/api/extensions/${deleting.type}/${encode(deleting.id)}`, {
                  method: 'DELETE',
                });
                setDeleting(undefined);
              })
            }
          >
            确认删除扩展
          </Action>
          <Action onClick={() => setDeleting(undefined)}>取消</Action>
        </Drawer>
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
      icon: 'extensions',
      order: 25,
      component: ExtensionRepository,
    });
    ctx.slot('conversation.detail.settings', {
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
    ctx.slot('conversation.detail.settings', {
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
