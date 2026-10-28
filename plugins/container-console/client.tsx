import {
  Action,
  Toggle,
  defineClientPlugin,
  useHost,
  useUnsavedChanges,
  type SlotProps,
} from '@qq-harness/client-sdk';
import { Select, Alert, Input, Drawer, Modal, Table, Tag, Tabs } from 'antd';
import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ContainerSettings,
  ContainerEngineStatus,
  ContainerInfo,
  ContainerJob,
  DiscoveredContainer,
  ChatDirectoryEntry,
} from '@qq-harness/contracts';
import './client.css';

type Snapshot = { settings: ContainerSettings; engine: ContainerEngineStatus; containers: ContainerInfo[] };
function Containers({ context = {} }: Partial<SlotProps>) {
  const host = useHost(),
    scopedChat = context.chatKey ? String(context.chatKey) : '';
  const { data, error: loadError } = useQuery({
    queryKey: ['container-console', 'status'],
    queryFn: ({ signal }) => host.api.request<Snapshot>('/api/containers/status', { signal }),
    refetchInterval: 10000,
  });
  const { data: chats = [] } = useQuery({
    queryKey: ['container-console', 'chats'],
    enabled: !scopedChat,
    queryFn: ({ signal }) => host.api.request<ChatDirectoryEntry[]>('/api/chats', { signal }),
  });
  const [draft, setDraft] = useState<ContainerSettings>(),
    [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const [name, setName] = useState(''),
    [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [editing, setEditing] = useState<ContainerInfo>(),
    [assigned, setAssigned] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]),
    [primary, setPrimary] = useState<string>(),
    [bindingDirty, setBindingDirty] = useState(false);
  const [removing, setRemoving] = useState<ContainerInfo>(),
    [stopping, setStopping] = useState<ContainerInfo>();
  const [chat, setChat] = useState(''),
    [execId, setExecId] = useState<string>(),
    [command, setCommand] = useState('pwd');
  const [background, setBackground] = useState(false),
    [output, setOutput] = useState('');
  useUnsavedChanges(
    dirty ||
      bindingDirty ||
      Boolean(editing && JSON.stringify(assigned) !== JSON.stringify(editing.chatKeys)),
  );
  const chatKey = scopedChat || chat,
    validChat = /^(group|private):[0-9]+$/.test(chatKey);
  useEffect(() => {
    if (!dirty && data) setDraft(data.settings);
  }, [data, dirty]);
  useEffect(() => {
    setBindingDirty(false);
  }, [scopedChat]);
  useEffect(() => {
    if (bindingDirty || !data) return;
    const rows = data.containers.flatMap((r) => r.bindings ?? []).filter((r) => r.chatKey === scopedChat);
    setSelected(rows.map((r) => r.id));
    setPrimary(rows.find((r) => r.primary)?.id ?? rows[0]?.id);
  }, [data, scopedChat, bindingDirty]);
  const {
    data: discovered = [],
    isFetching: discovering,
    refetch: discover,
  } = useQuery({
    queryKey: ['container-console', 'discovery'],
    enabled: discoveryOpen,
    queryFn: ({ signal }) => host.api.request<DiscoveredContainer[]>('/api/containers/discovery', { signal }),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ['container-console', 'jobs', chatKey],
    enabled: validChat,
    queryFn: ({ signal }) =>
      host.api.request<ContainerJob[]>(`/api/containers/sessions/${encodeURIComponent(chatKey)}/jobs`, {
        signal,
      }),
    refetchInterval: 2000,
  });
  const perform = async (fn: () => Promise<unknown>, message: string) => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await fn();
      setNotice(message);
      await host.queries.invalidateQueries();
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };
  const request = (url: string, method: string, body?: unknown) =>
    host.api.request('/api/containers' + url, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  if (loadError) return <Alert type="error" title={String(loadError)} />;
  if (!data || !draft) return <div className="empty">加载容器配置…</div>;
  const enabled = data.engine.allowOperations && data.settings.enabled;
  const feedback = (
    <>
      {notice && <Alert type="success" role="status" title={notice} />}
      {error && <Alert type="error" role="alert" title={error} />}
    </>
  );
  const poolOptions = data.containers.map((r) => ({
    value: r.id,
    label: `${r.name}${r.enabled === false ? '（已停用）' : ''} · ${r.chatKeys?.length ?? 0} 个会话`,
  }));
  if (scopedChat)
    return (
      <div className="container-session-settings form-stack">
        <Alert
          type="info"
          showIcon
          title="会话可选择多个容器，也可与其他会话共享容器。每个容器使用本会话的独立用户和私有目录，首次执行时自动准备。"
        />
        {scopedChat === 'default' ? (
          <p>默认会话不绑定容器，请选择具体会话。</p>
        ) : (
          <>
            <label>
              已绑定容器
              <Select
                mode="multiple"
                aria-label="选择已有容器"
                value={selected}
                options={poolOptions}
                disabled={pending || !enabled}
                placeholder="选择资源池容器；未绑定时 JS 技能使用降级沙箱"
                onChange={(ids) => {
                  setSelected(ids);
                  setBindingDirty(true);
                  if (!primary || !ids.includes(primary)) setPrimary(ids[0]);
                }}
              />
            </label>
            <label>
              默认执行容器
              <Select
                aria-label="默认执行容器"
                value={primary}
                options={poolOptions.filter((o) => selected.includes(o.value))}
                disabled={pending || !selected.length}
                onChange={(id) => {
                  setPrimary(id);
                  setBindingDirty(true);
                }}
                placeholder="工具省略容器 ID 时使用"
              />
            </label>
            <Action
              className="primary"
              disabled={pending || !bindingDirty}
              onClick={() =>
                void perform(async () => {
                  await request('/bindings/' + encodeURIComponent(scopedChat), 'PUT', {
                    containerIds: selected,
                    primaryContainerId: primary,
                  });
                  setBindingDirty(false);
                }, '会话容器绑定已更新')
              }
            >
              保存会话容器
            </Action>
            <div className="container-account-list">
              {data.containers
                .flatMap((r) => r.bindings ?? [])
                .filter((e) => e.chatKey === scopedChat)
                .map((e) => (
                  <div key={e.id}>
                    <strong>{e.name}</strong>
                    <Tag>{e.username}</Tag>
                    {e.primary && <Tag color="blue">默认</Tag>}
                    <code>{e.workspace}</code>
                    <small>
                      {e.uid ? `UID ${e.uid} · GID ${e.gid}` : '首次执行时创建用户'} · 私有目录权限 0700
                    </small>
                  </div>
                ))}
            </div>
          </>
        )}
        {feedback}
        <a href="/settings/containers">打开容器资源池</a>
      </div>
    );
  const change = <K extends keyof ContainerSettings>(key: K, value: ContainerSettings[K]) => {
    setDirty(true);
    setDraft({ ...draft, [key]: value });
  };
  const chatOptions = chats
    .filter((c) => c.chatKey !== 'default')
    .map((c) => ({ value: c.chatKey, label: `${c.alias || c.name || c.chatKey} · ${c.chatKey}` }));
  const execResources = data.containers.filter((r) => r.bindings?.some((b) => b.chatKey === chat));
  const settingsForm = (
    <form
      className="container-fields"
      onSubmit={(event) => {
        event.preventDefault();
        void perform(async () => {
          const saved = await host.api.request<ContainerSettings>('/api/containers/settings', {
            method: 'PATCH',
            body: JSON.stringify(draft),
          });
          setDraft(saved);
          setDirty(false);
        }, '容器设置已保存');
      }}
    >
      <label className="toggle-row container-enable">
        <Toggle checked={draft.enabled} onChange={(e) => change('enabled', e.target.checked)} />
        启用容器功能
      </label>
      <label>
        容器引擎
        <select
          aria-label="容器引擎"
          value={draft.engine}
          onChange={(e) => change('engine', e.target.value as ContainerSettings['engine'])}
        >
          <option value="auto">自动检测</option>
          <option value="podman">Podman</option>
          <option value="docker">Docker</option>
        </select>
      </label>
      <label>
        容器 CLI 绝对路径
        <Input
          aria-label="容器 CLI 绝对路径"
          value={draft.binaryPath}
          onChange={(e) => change('binaryPath', e.target.value)}
          placeholder="留空使用 PATH"
        />
      </label>
      <label>
        容器镜像
        <Input aria-label="容器镜像" value={draft.image} onChange={(e) => change('image', e.target.value)} />
      </label>
      {(
        [
          ['memoryMb', '内存上限 MB', 64, 32768, 1],
          ['cpus', 'CPU 上限', 0.1, 32, 0.1],
          ['pids', '进程数上限', 16, 4096, 1],
          ['timeoutMs', '命令超时 ms', 1000, 600000, 1000],
        ] as const
      ).map(([key, label, min, max, step]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            aria-label={label}
            min={min}
            max={max}
            step={step}
            value={draft[key]}
            onChange={(e) => change(key, Number(e.target.value))}
          />
        </label>
      ))}
      <label>
        容器网络
        <select
          value={draft.network}
          onChange={(e) => change('network', e.target.value as ContainerSettings['network'])}
        >
          <option value="none">关闭网络</option>
          <option value="bridge">桥接网络</option>
        </select>
      </label>
      <div className="container-save">
        <Action className="primary" disabled={pending}>
          保存容器设置
        </Action>
      </div>
      <p className="container-form-note">
        镜像需包含 python3、useradd、groupadd。资源限制仅应用于新建容器；登记外部容器不更改其配置。
      </p>
    </form>
  );
  return (
    <div className="container-console">
      <div
        aria-live="polite"
        className={data.engine.available ? 'container-engine-ready' : 'container-engine-unavailable'}
      >
        <Tag>{data.engine.engine ?? '未连接'}</Tag>
        {data.engine.message}
      </div>
      {feedback}
      <Tabs
        defaultActiveKey="pool"
        items={[
          {
            key: 'pool',
            label: `资源池 (${data.containers.length})`,
            children: (
              <>
                <div className="container-actions container-pool-toolbar">
                  <Input
                    aria-label="新容器名称"
                    placeholder="容器名称（可选）"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <Action
                    className="primary"
                    disabled={pending || !enabled || data.engine.imageAvailable === false}
                    onClick={() =>
                      void perform(async () => {
                        await request('/inventory', 'POST', { name: name || undefined });
                        setName('');
                      }, '容器已创建并加入资源池')
                    }
                  >
                    创建容器
                  </Action>
                  <Action
                    disabled={pending || !data.engine.allowOperations}
                    onClick={() => setDiscoveryOpen(true)}
                  >
                    登记已有容器
                  </Action>
                </div>
                <Table<ContainerInfo>
                  rowKey="id"
                  size="small"
                  dataSource={data.containers}
                  pagination={data.containers.length > 12 ? { pageSize: 12 } : false}
                  scroll={{ x: 740 }}
                  columns={[
                    {
                      title: '容器 / 镜像',
                      key: 'name',
                      width: 270,
                      render: (_, r) => (
                        <div>
                          <strong>{r.name}</strong>
                          <small>{r.image}</small>
                          <small title={r.id}>
                            {r.id.slice(0, 12)} · {r.managed ? '托管' : '外部登记'}
                          </small>
                        </div>
                      ),
                    },
                    {
                      title: '状态',
                      key: 'status',
                      width: 110,
                      render: (_, r) => (
                        <Tag color={r.enabled === false ? 'orange' : r.running ? 'green' : 'default'}>
                          {r.enabled === false ? '已停用' : r.running ? '运行中' : r.status}
                        </Tag>
                      ),
                    },
                    {
                      title: '会话绑定',
                      key: 'bindings',
                      width: 180,
                      render: (_, r) => (
                        <div>
                          <span>{r.chatKeys?.length ? `${r.chatKeys.length} 个会话` : '未绑定'}</span>
                          <small>
                            {r.bindings
                              ?.slice(0, 3)
                              .map((b) => b.username)
                              .join('、')}
                          </small>
                        </div>
                      ),
                    },
                    {
                      title: '操作',
                      key: 'actions',
                      width: 260,
                      render: (_, r) => (
                        <div className="container-actions">
                          <Action
                            disabled={pending}
                            onClick={() => {
                              setEditing(r);
                              setAssigned(r.chatKeys ?? []);
                            }}
                          >
                            管理绑定
                          </Action>
                          <Action
                            disabled={pending || !enabled || (r.running && r.enabled !== false)}
                            onClick={() =>
                              void perform(
                                () => request(`/inventory/${encodeURIComponent(r.id)}/start`, 'POST'),
                                '容器已启用',
                              )
                            }
                          >
                            启用
                          </Action>
                          <Action disabled={pending || !r.running} onClick={() => setStopping(r)}>
                            停用
                          </Action>
                          <Action
                            disabled={pending || Boolean(r.chatKeys?.length)}
                            onClick={() => setRemoving(r)}
                          >
                            {r.managed ? '删除' : '取消登记'}
                          </Action>
                        </div>
                      ),
                    },
                  ]}
                  locale={{ emptyText: '资源池为空。可创建容器，或登记 Podman / Docker 中的已有容器。' }}
                />
              </>
            ),
          },
          { key: 'settings', label: '引擎与默认配置', children: settingsForm },
          {
            key: 'tasks',
            label: '执行与任务',
            children: (
              <>
                <form
                  className="form-stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(
                      async () => {
                        const result = await request(
                          `/sessions/${encodeURIComponent(chatKey)}/exec`,
                          'POST',
                          { command, containerId: execId, run_in_background: background },
                        );
                        setOutput(JSON.stringify(result, null, 2));
                      },
                      background ? '后台任务已提交' : '命令已执行',
                    );
                  }}
                >
                  <div className="container-fields">
                    <label>
                      执行身份
                      <Select
                        aria-label="命令执行会话"
                        showSearch
                        optionFilterProp="label"
                        value={chat || undefined}
                        options={chatOptions}
                        onChange={(value) => {
                          setChat(value);
                          setExecId(undefined);
                        }}
                        placeholder="选择已绑定容器的会话"
                      />
                    </label>
                    <label>
                      执行容器
                      <Select
                        aria-label="命令执行容器"
                        value={execId}
                        allowClear
                        options={execResources.map((r) => ({ value: r.id, label: r.name }))}
                        onChange={setExecId}
                        placeholder="使用此会话默认容器"
                      />
                    </label>
                  </div>
                  <label>
                    容器命令
                    <Input.TextArea
                      aria-label="容器命令"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      autoSize={{ minRows: 2, maxRows: 6 }}
                    />
                  </label>
                  <div className="container-actions">
                    <label className="toggle-row">
                      <Toggle checked={background} onChange={(e) => setBackground(e.target.checked)} />
                      后台运行
                    </label>
                    <Action disabled={pending || !enabled || !validChat || !execResources.length}>
                      执行容器命令
                    </Action>
                  </div>
                </form>
                {output && <pre className="container-output">{output}</pre>}
                <h3>当前会话任务</h3>
                {jobs.length === 0 && <div className="empty">选择会话后查看任务</div>}
                {jobs.map((job) => (
                  <details key={job.id} open={job.status === 'running'}>
                    <summary>
                      {job.status} · {job.command.slice(0, 120)}
                    </summary>
                    <small>
                      {job.id} · {job.containerId?.slice(0, 12)}
                    </small>
                    <pre className="container-output">
                      {job.stdout}
                      {job.stderr}
                      {job.error}
                    </pre>
                    {job.truncated && <small>输出已截断</small>}
                    {job.status === 'running' && (
                      <Action
                        disabled={pending}
                        onClick={() =>
                          void perform(
                            () =>
                              request(
                                `/sessions/${encodeURIComponent(chatKey)}/jobs/${job.id}/cancel`,
                                'POST',
                              ),
                            '任务已取消，其他会话继续运行',
                          )
                        }
                      >
                        取消容器任务
                      </Action>
                    )}
                  </details>
                ))}
              </>
            ),
          },
        ]}
      />
      <Drawer
        title={`管理绑定 · ${editing?.name ?? ''}`}
        open={Boolean(editing)}
        width={560}
        onClose={() => {
          if (!pending) setEditing(undefined);
        }}
        extra={
          <Action
            className="primary"
            disabled={pending}
            onClick={() =>
              void perform(async () => {
                await request(`/inventory/${encodeURIComponent(editing!.id)}/chats`, 'PUT', {
                  chatKeys: assigned,
                });
                setEditing(undefined);
              }, '容器绑定已更新')
            }
          >
            保存绑定
          </Action>
        }
      >
        <div className="form-stack">
          <p>一个容器可绑定多个会话；每个会话也可使用多个容器。解绑保留该会话的用户和文件。</p>
          <label>
            绑定会话
            <Select
              mode="multiple"
              aria-label="容器绑定会话"
              showSearch
              optionFilterProp="label"
              value={assigned}
              options={[
                ...chatOptions,
                ...assigned
                  .filter((k) => !chatOptions.some((o) => o.value === k))
                  .map((k) => ({ value: k, label: k })),
              ]}
              onChange={setAssigned}
            />
          </label>
          {(editing?.bindings ?? []).map((b) => (
            <div className="container-account" key={b.chatKey}>
              <strong>{chatOptions.find((c) => c.value === b.chatKey)?.label ?? b.chatKey}</strong>
              <Tag>{b.username}</Tag>
              <code>{b.workspace}</code>
              <small>
                {b.uid ? `UID ${b.uid} · GID ${b.gid}` : '首次执行自动创建用户'} ·{' '}
                {b.primary ? '此会话的默认容器' : '可选容器'}
              </small>
            </div>
          ))}
        </div>
      </Drawer>
      <Drawer
        title="登记已有容器"
        open={discoveryOpen}
        width={740}
        onClose={() => setDiscoveryOpen(false)}
        extra={
          <Action disabled={discovering} onClick={() => void discover()}>
            刷新
          </Action>
        }
      >
        <Alert
          type="info"
          showIcon
          title="登记只保存容器 ID，不更改已有配置或文件。绑定会话后，首次任务会在容器内创建用户。外部容器取消登记不会被删除，插件停用也不会停止容器。"
        />
        <Table<DiscoveredContainer>
          rowKey="id"
          loading={discovering}
          size="small"
          dataSource={discovered}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: '容器',
              key: 'name',
              render: (_, r) => (
                <div>
                  <strong>{r.name}</strong>
                  <small>{r.image}</small>
                  <small>{r.id.slice(0, 12)}</small>
                </div>
              ),
            },
            { title: '状态', key: 'state', width: 90, render: (_, r) => (r.running ? '运行中' : '已停止') },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_, r) => (
                <Action
                  disabled={pending || r.registered || !enabled}
                  onClick={() =>
                    void perform(
                      () => request('/inventory/import', 'POST', { reference: r.id }),
                      '容器已登记，现可在会话中选择',
                    )
                  }
                >
                  {r.registered ? '已登记' : '登记'}
                </Action>
              ),
            },
          ]}
        />
      </Drawer>
      <Modal
        title={removing?.managed ? '删除容器' : '取消容器登记'}
        open={Boolean(removing)}
        confirmLoading={pending}
        onCancel={() => {
          if (!pending) setRemoving(undefined);
        }}
        onOk={() =>
          void perform(
            async () => {
              await request('/inventory/' + encodeURIComponent(removing!.id), 'DELETE');
              setRemoving(undefined);
            },
            removing?.managed ? '容器已删除' : '已取消登记，外部容器保留',
          )
        }
      >
        <p>{removing?.name}</p>
        <p>
          {removing?.managed
            ? '此操作删除容器及其内部文件，无法恢复。请先备份需要保留的文件。'
            : '仅从本工程资源池移除，容器和文件保留。'}
        </p>
      </Modal>
      <Modal
        title="停用共享容器"
        open={Boolean(stopping)}
        confirmLoading={pending}
        onCancel={() => {
          if (!pending) setStopping(undefined);
        }}
        onOk={() =>
          void perform(async () => {
            await request('/inventory/' + encodeURIComponent(stopping!.id) + '/stop', 'POST');
            setStopping(undefined);
          }, '容器已停用')
        }
      >
        <p>{stopping?.name}</p>
        <p>
          将取消此容器中所有会话的任务并停止容器。受影响的会话：{stopping?.chatKeys?.join('、') || '无'}
          。再次启用前，Agent 无法自动启动。
        </p>
      </Modal>
    </div>
  );
}
export default defineClientPlugin({
  id: 'container-console',
  requires: ['console-chats'],
  setup(ctx) {
    ctx.page({
      id: 'containers-redirect',
      path: '/containers',
      title: '容器旧地址',
      hidden: true,
      component: () => <Navigate to="/settings/containers" replace />,
    });
    ctx.page({
      id: 'containers',
      parentId: 'settings',
      path: '/settings/containers',
      title: '容器',
      icon: 'container',
      order: 45,
      component: Containers,
    });
    ctx.slot('conversation.detail.settings', {
      id: 'containers',
      title: '容器',
      order: 60,
      component: Containers,
    });
  },
});
