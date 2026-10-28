import { Action } from '@qq-harness/client-sdk';
import { Toggle } from '@qq-harness/client-sdk';
import { dialogs, Drawer, confirmDiscardChanges, Markdown } from '@qq-harness/client-sdk';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHost, useUnsavedChanges } from '@qq-harness/client-sdk';
import type { CatalogText, PublicProvider } from '@qq-harness/contracts';
type Catalogs = {
  personas: CatalogText[];
  prompts: CatalogText[];
  providers: PublicProvider[];
  defaultPersona?: string;
};
export function CatalogManager({ mode = 'texts' }: { mode?: 'texts' | 'providers' }) {
  const host = useHost(),
    [kind, setKind] = useState<'personas' | 'prompts' | 'providers'>(
      mode === 'providers' ? 'providers' : 'personas',
    ),
    [preview, setPreview] = useState<CatalogText>(),
    [editing, setEditing] = useState<Record<string, string>>(),
    [existing, setExisting] = useState(''),
    [notice, setNotice] = useState(''),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [clearKey, setClearKey] = useState(false);
  useUnsavedChanges(dirty);
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['catalog-manager'],
    queryFn: ({ signal }) => host.api.request<Catalogs>('/api/catalogs', { signal }),
  });
  const rows = (data?.[kind] ?? []).filter((row) =>
    `${row.id} ${row.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const edit = (row?: CatalogText | PublicProvider) => {
    setExisting(row?.id ?? '');
    setEditing(
      row
        ? {
            id: row.id,
            name: row.name,
            ...('text' in row
              ? { text: row.text }
              : {
                  baseUrl: row.baseUrl,
                  currency: row.currency,
                  models: row.models.join('\n'),
                  priceInputPerM: String(row.priceInputPerM ?? ''),
                  priceOutputPerM: String(row.priceOutputPerM ?? ''),
                }),
          }
        : {
            id: '',
            name: '',
            text: '',
            baseUrl: 'https://api.openai.com/v1',
            models: '',
          },
    );
    setDirty(false);
    setClearKey(false);
  };
  const write = async (items: unknown[]) => {
    try {
      await host.api.request(`/api/catalogs/${kind}`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      });
      setDirty(false);
      setEditing(undefined);
      setNotice('目录已保存');
      void host.queries.invalidateQueries();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    }
  };
  const change = (key: string, value: string) => {
    setEditing({ ...editing, [key]: value });
    setDirty(true);
  };
  return (
    <section className="panel form-stack">
      <div className="section-heading">
        <h2>{mode === 'providers' ? '模型渠道目录' : '人设与提示词目录'}</h2>
        <Action type="button" onClick={() => edit()}>
          新增目录项
        </Action>
      </div>
      <div className="tabs">
        {Object.entries(
          mode === 'providers' ? { providers: '渠道管理' } : { personas: '人设管理', prompts: '提示词管理' },
        ).map(([id, title]) => (
          <Action
            type="button"
            key={id}
            aria-selected={kind === id}
            onClick={() => {
              setKind(id as typeof kind);
              setPage(1);
            }}
          >
            {title}
          </Action>
        ))}
      </div>
      <div className="toolbar">
        {kind === 'personas' && (
          <details className="readonly-persona">
            <summary>默认人设 · 只读</summary>
            <Markdown>{data?.defaultPersona ?? ''}</Markdown>
          </details>
        )}
        {preview && (
          <Drawer title={'预览：' + preview.name} onClose={() => setPreview(undefined)}>
            <Markdown>{preview.text}</Markdown>
          </Drawer>
        )}
        <input
          aria-label="搜索目录"
          value={search}
          placeholder="搜索名称或 ID"
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>ID</th>
              <th>内容／接入</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice((page - 1) * 20, page * 20).map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.id}</td>
                <td>
                  {'text' in row
                    ? row.text.slice(0, 100)
                    : `${row.baseUrl} · ${row.hasApiKey ? '已配置密钥' : '未配置密钥'} · ${row.models.length} 个模型`}
                </td>
                <td className="catalog-actions">
                  {'text' in row && (
                    <Action type="button" onClick={() => setPreview(row)}>
                      预览
                    </Action>
                  )}
                  <Action type="button" disabled={'text' in row && row.readOnly} onClick={() => edit(row)}>
                    编辑
                  </Action>
                  {'text' in row && (
                    <Action
                      type="button"
                      onClick={() => {
                        edit({ ...row, id: '', name: row.name + '（副本）', readOnly: false });
                        setExisting('');
                      }}
                    >
                      复制为自定义
                    </Action>
                  )}
                  <Action
                    type="button"
                    disabled={'text' in row && row.readOnly}
                    onClick={async () => {
                      if (
                        await dialogs.confirm({
                          title: '删除目录项？',
                          description: `即将删除「${row.name}」。正在被会话引用的目录项无法删除。`,
                          confirmLabel: '删除目录项',
                          danger: true,
                        })
                      )
                        void write((data?.[kind] ?? []).filter((v) => v.id !== row.id));
                    }}
                  >
                    删除
                  </Action>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isPending && <p role="status">正在加载目录…</p>}
      {error && <Action onClick={() => void refetch()}>重试加载目录</Action>}
      {!isPending && !error && !rows.length && <p className="empty">目录为空，可新增或导入迁移目录。</p>}
      <div className="pagination">
        <span>共 {rows.length} 项</span>
        <Action type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>
          上一页
        </Action>
        <span>{page}</span>
        <Action type="button" disabled={page * 20 >= rows.length} onClick={() => setPage(page + 1)}>
          下一页
        </Action>
      </div>
      {editing && (
        <Drawer
          title="目录编辑"
          onClose={() => {
            void confirmDiscardChanges().then((discard) => {
              if (discard) {
                setEditing(undefined);
                setDirty(false);
              }
            });
          }}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const item =
                kind === 'providers'
                  ? {
                      id: editing.id,
                      name: editing.name,
                      baseUrl: editing.baseUrl,
                      models: (editing.models ?? '')
                        .split('\n')
                        .map((v) => v.trim())
                        .filter(Boolean),
                      currency: editing.currency || 'USD',
                      ...(editing.apiKey ? { apiKey: editing.apiKey } : clearKey ? { apiKey: '' } : {}),
                      priceInputPerM: editing.priceInputPerM ? Number(editing.priceInputPerM) : null,
                      priceOutputPerM: editing.priceOutputPerM ? Number(editing.priceOutputPerM) : null,
                    }
                  : {
                      id: editing.id,
                      name: editing.name,
                      text: editing.text ?? '',
                    };
              void write([...(data?.[kind] ?? []).filter((v) => v.id !== existing), item]);
            }}
          >
            <h2>{existing ? '编辑目录项' : '新增目录项'}</h2>
            <label>
              ID
              <input
                aria-label="目录 ID"
                required
                value={editing.id}
                disabled={!!existing}
                onChange={(e) => change('id', e.target.value)}
              />
            </label>
            <label>
              名称
              <input
                aria-label="目录名称"
                required
                value={editing.name}
                onChange={(e) => change('name', e.target.value)}
              />
            </label>
            {kind === 'providers' ? (
              <>
                <label>
                  API Base URL
                  <input
                    required
                    type="url"
                    value={editing.baseUrl}
                    onChange={(e) => change('baseUrl', e.target.value)}
                  />
                </label>
                <label>
                  API Key
                  <input
                    aria-label="渠道 API Key"
                    type="password"
                    autoComplete="off"
                    placeholder="留空保持现有密钥"
                    value={editing.apiKey ?? ''}
                    onChange={(e) => change('apiKey', e.target.value)}
                  />
                </label>
                <label className="toggle-row">
                  清空已保存密钥
                  <Toggle
                    checked={clearKey}
                    onChange={(e) => {
                      setClearKey(e.target.checked);
                      setDirty(true);
                    }}
                  />
                </label>
                <label>
                  模型 ID（每行一个）
                  <textarea
                    rows={5}
                    value={editing.models ?? ''}
                    onChange={(e) => change('models', e.target.value)}
                  />
                </label>
                <label>
                  价格币种
                  <input
                    value={editing.currency ?? 'USD'}
                    onChange={(e) => change('currency', e.target.value)}
                  />
                </label>
                {(['priceInputPerM', 'priceOutputPerM'] as const).map((key) => (
                  <label key={key}>
                    {key === 'priceInputPerM' ? '输入' : '输出'}每百万 Token 价格（可留空）
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editing[key] ?? ''}
                      onChange={(e) => change(key, e.target.value)}
                    />
                  </label>
                ))}
              </>
            ) : (
              <label>
                内容
                <textarea
                  aria-label="目录内容"
                  rows={16}
                  value={editing.text ?? ''}
                  onChange={(e) => change('text', e.target.value)}
                />
              </label>
            )}
            <div className="row">
              <Action className="primary">保存目录项</Action>
              <Action
                type="button"
                onClick={async () => {
                  if (!dirty || (await confirmDiscardChanges())) {
                    setEditing(undefined);
                    setDirty(false);
                  }
                }}
              >
                取消
              </Action>
            </div>
            {notice && <p role="status">{notice}</p>}
          </form>
        </Drawer>
      )}
      {notice && !editing && <p role="status">{notice}</p>}
    </section>
  );
}
