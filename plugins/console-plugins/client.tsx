import { Action } from '@qq-harness/client-sdk';
import { Selection, Toggle } from '@qq-harness/client-sdk';
import { dialogs, confirmDiscardChanges } from '@qq-harness/client-sdk';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defineClientPlugin, useHost } from '@qq-harness/client-sdk';
import { pluginStatusLabel, type PluginDto } from '@qq-harness/contracts';
function Plugins() {
  const host = useHost(),
    [pending, setPending] = useState<Record<string, boolean>>({}),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [page, setPage] = useState(1),
    [chosen, setChosen] = useState<string[]>([]);
  const { data, error: loadError } = useQuery({
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
  const toggle = async (id: string, enabled: boolean) => {
    setPending((v) => ({ ...v, [id]: enabled }));
    setError('');
    try {
      await host.api.request(`/api/plugins/${id}/enabled`, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      await host.queries.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending((v) => {
        const n = { ...v };
        delete n[id];
        return n;
      });
    }
  };
  const rows =
    data?.plugins.filter(
      (p) =>
        `${p.name} ${p.id} ${p.requires.join(' ')}`.toLowerCase().includes(search.toLowerCase()) &&
        (filter === 'all' ||
          (filter === 'enabled' ? p.enabled : filter === 'disabled' ? !p.enabled : p.status === filter)),
    ) ?? [];
  return (
    <>
      {(error || loadError) && (
        <div className="error" role="alert">
          {error || loadError?.message}
        </div>
      )}
      <div className="toolbar">
        <input
          aria-label="搜索插件"
          value={search}
          placeholder="搜索名称、ID 或依赖服务"
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="插件状态筛选"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          {[
            ['all', '全部'],
            ['enabled', '已启用'],
            ['disabled', '已停用'],
            ['active', '运行中'],
            ['failed', '失败'],
            ['waiting', '等待依赖'],
          ].map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        <Action
          disabled={!chosen.length}
          onClick={() =>
            void (async () => {
              for (const id of chosen) await toggle(id, true);
            })()
          }
        >
          批量启用
        </Action>
        <Action
          disabled={!chosen.length}
          onClick={async () => {
            if (
              await dialogs.confirm({
                title: '批量停用插件？',
                description: `将停用选中的 ${chosen.length} 个插件及依赖它们的功能。`,
                confirmLabel: '停用插件',
                danger: true,
              })
            )
              void (async () => {
                for (const id of chosen) await toggle(id, false);
              })();
          }}
        >
          批量停用
        </Action>
      </div>
      <div className="panel table-wrap data-table-scroll">
        <table className="plugin-table">
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 64 }} />
            <col style={{ width: 250 }} />
            <col style={{ width: 90 }} />
            <col />
            <col style={{ width: 108 }} />
          </colgroup>
          <thead>
            <tr>
              <th>选择</th>
              <th>启用</th>
              <th>名称／ID</th>
              <th>状态</th>
              <th>依赖服务</th>
              <th>版本</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice((page - 1) * 50, page * 50).map((p) => (
              <tr key={p.id} data-plugin={p.id}>
                <td>
                  <Selection
                    aria-label={`选择插件 ${p.id}`}
                    disabled={locked.includes(p.id) || p.id === 'console-plugins'}
                    checked={chosen.includes(p.id)}
                    onChange={(e) =>
                      setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((id) => id !== p.id))
                    }
                  />
                </td>
                <td>
                  <Toggle
                    aria-label={`启用 ${p.id}`}
                    checked={pending[p.id] ?? p.enabled}
                    disabled={p.id in pending || locked.includes(p.id)}
                    onChange={(e) => void toggle(p.id, e.target.checked)}
                  />
                </td>
                <td>
                  <strong className="plugin-name" title={p.name}>
                    {p.name}
                  </strong>
                  <br />
                  <small>
                    {p.id}
                    {p.client ? ' · 界面插件' : ''}
                  </small>
                  {p.error && <div className="error">{p.error}</div>}
                </td>
                <td>
                  <span className={`pill ${p.status === 'active' ? 'positive' : ''}`}>
                    {pluginStatusLabel(p.status)}
                  </span>
                </td>
                <td>
                  <div className="dependency-tags">
                    {p.requires.length ? (
                      p.requires.map((id) => <code key={id}>{id}</code>)
                    ) : (
                      <span className="muted">独立基础能力</span>
                    )}
                  </div>
                </td>
                <td>
                  v{p.version}
                  <br />
                  <small>激活 {p.generation} 次</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">没有匹配的插件</p>}
      </div>
      <div className="pagination">
        <span>共 {rows.length} 项</span>
        <Action disabled={page === 1} onClick={() => setPage(page - 1)}>
          上一页
        </Action>
        <span>{page}</span>
        <Action disabled={page * 50 >= rows.length} onClick={() => setPage(page + 1)}>
          下一页
        </Action>
      </div>
    </>
  );
}
export default defineClientPlugin({
  id: 'console-plugins',
  setup(ctx) {
    ctx.page({
      id: 'plugins',
      path: '/plugins',
      title: '插件',
      icon: 'plugins',
      order: 20,
      component: Plugins,
    });
  },
});
