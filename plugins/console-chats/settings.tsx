import { Action } from '@qq-harness/client-sdk';
import { Markdown } from '@qq-harness/client-sdk';
import { Toggle } from '@qq-harness/client-sdk';
import { MediaOptions, StickerOptions, ImageStudioOptions } from './features.js';
import { BehaviorForm } from './behavior.js';
import { ToolManager } from './tools.js';
import { dialogs, confirmDiscardChanges, PluginBoundary } from '@qq-harness/client-sdk';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHost, useUnsavedChanges, type SlotProps } from '@qq-harness/client-sdk';
import type { ChatSettings, PublicConfig, MemorySchedule } from '@qq-harness/contracts';
const enc = encodeURIComponent;
export function MemoryScheduleForm({ chatKey }: { chatKey?: string }) {
  const host = useHost(),
    [dirty, setDirty] = useState(false),
    [draft, setDraft] = useState<MemorySchedule>(),
    [inherit, setInherit] = useState(false),
    [notice, setNotice] = useState('');
  useUnsavedChanges(dirty);
  const query = useQuery({
    queryKey: ['memory-settings', chatKey],
    queryFn: ({ signal }) =>
      host.api.request<{
        defaults: MemorySchedule;
        overrides: Partial<MemorySchedule>;
        effective: MemorySchedule;
      }>(`/api/memory/settings${chatKey ? `?chatKey=${enc(chatKey)}` : ''}`, {
        signal,
      }),
  });
  useEffect(() => {
    if (query.data && !dirty) {
      setDraft(query.data.effective);
      setInherit(!!chatKey && !Object.keys(query.data.overrides).length);
    }
  }, [query.data, dirty, chatKey]);
  if (!draft) return <p>{query.error?.message ?? '加载整理设置…'}</p>;
  const change = (key: keyof MemorySchedule, value: number | boolean) => {
    setDraft({ ...draft, [key]: value });
    setDirty(true);
  };
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void host.api
          .request('/api/memory/settings', {
            method: 'PATCH',
            body: JSON.stringify({ chatKey, patch: inherit ? null : draft }),
          })
          .then(() => {
            setDirty(false);
            setNotice('整理设置已保存');
            void host.queries.invalidateQueries();
          })
          .catch((e) => setNotice(e.message));
      }}
    >
      {chatKey && (
        <label className="toggle-row">
          跟随全局记忆整理设置
          <Toggle
            checked={inherit}
            onChange={(e) => {
              setInherit(e.target.checked);
              setDirty(true);
            }}
          />
        </label>
      )}
      <label className="toggle-row">
        自动整理
        <Toggle
          disabled={inherit}
          checked={draft.enabled}
          onChange={(e) => change('enabled', e.target.checked)}
        />
      </label>
      <div className="form-grid">
        {(['short', 'medium', 'long'] as const).map((tier, i) => (
          <label key={tier}>
            {['短期', '中期', '长期'][i]}整理间隔（分钟）
            <input
              type="number"
              aria-label={`${['短期', '中期', '长期'][i]}整理间隔（分钟）`}
              min="1"
              disabled={inherit}
              value={draft[`${tier}IntervalMs`] / 60000}
              onChange={(e) => change(`${tier}IntervalMs`, Number(e.target.value) * 60000)}
            />
          </label>
        ))}
        {(['short', 'medium'] as const).map((tier, i) => (
          <label key={tier}>
            {['短期', '中期'][i]}保留天数
            <input
              type="number"
              min="1"
              disabled={inherit}
              value={draft[`${tier}RetentionMs`] / 86400000}
              onChange={(e) => change(`${tier}RetentionMs`, Number(e.target.value) * 86400000)}
            />
          </label>
        ))}
      </div>
      <small>
        长期不过期。新增、更正、融合与遗忘由独立记忆 Agent 异步处理，提交后在“记忆管理”查看实际结果。
      </small>
      <div className="row">
        <Action className="primary">保存整理设置</Action>
        <span role="status">{notice}</span>
      </div>
    </form>
  );
}
export function ChatSettingsPanel({
  context,
  initialSection = 'persona',
  memoryOnly = false,
}: SlotProps & { initialSection?: string; memoryOnly?: boolean }) {
  const host = useHost(),
    chatKey = String(context.chatKey),
    global = chatKey === 'default';
  const [draft, setDraft] = useState<ChatSettings>(),
    [dirty, setDirty] = useState(false),
    [notice, setNotice] = useState(''),
    [section, setSection] = useState(initialSection);
  useUnsavedChanges(dirty);
  const query = useQuery({
    queryKey: ['console-chats', 'settings', chatKey],
    queryFn: ({ signal }) =>
      host.api.request<ChatSettings>(`/api/chats/${enc(chatKey)}/settings`, {
        signal,
      }),
  });
  const { data: cfg } = useQuery({
    queryKey: ['console-chats', 'catalog-config'],
    queryFn: ({ signal }) => host.api.request<PublicConfig>('/api/config', { signal }),
  });
  const { data: status } = useQuery({
    queryKey: ['console-chats', 'plugin-options'],
    queryFn: ({ signal }) =>
      host.api.request<{ plugins: { id: string; name: string }[] }>('/api/plugins', { signal }),
  });
  useEffect(() => {
    if (!dirty) setDraft(query.data);
  }, [query.data, dirty]);
  const extensionSections = host.listSlot('conversation.detail.settings');
  const extensionSection = extensionSections.find((s) => s.value.id === section);
  if (!draft) return <p>{query.error?.message ?? '加载设置…'}</p>;
  const change = (patch: Partial<ChatSettings>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const model = (patch: Partial<ChatSettings['modelSelection']>) =>
    change({ modelSelection: { ...draft.modelSelection, ...patch } });
  const persona = (patch: Partial<ChatSettings['personaSelection']>) =>
    change({ personaSelection: { ...draft.personaSelection, ...patch } });
  const save = () => {
    void host.api
      .request(global ? '/api/config' : `/api/profiles/${enc(chatKey)}`, {
        method: 'PATCH',
        body: JSON.stringify(global ? { defaults: draft } : draft),
      })
      .then(async (saved) => {
        await host.queries.cancelQueries({
          queryKey: ['console-chats', 'settings', chatKey],
          exact: true,
        });
        const settings = (global ? (saved as PublicConfig).defaults : saved) as ChatSettings;
        host.queries.setQueryData(['console-chats', 'settings', chatKey], settings);
        setDraft(settings);
        setDirty(false);
        setNotice(global ? '默认设置已保存' : '会话独立快照已保存');
        void host.queries.invalidateQueries();
      })
      .catch((e) => setNotice(e.message));
  };
  return (
    <div className="chat-settings">
      <div className="settings-index" aria-label="会话设置分区" hidden={memoryOnly}>
        {Object.entries({
          persona: '人设与提示词',
          model: '模型',
          memory: '记忆',
          chat: '聊天策略',
          tools: '工具与技能',
          sticker: '表情',
          images: '图片工坊',
        }).map(([id, title]) => (
          <Action
            type="button"
            key={id}
            aria-selected={section === id}
            onClick={() => {
              if (id === 'memory' && !memoryOnly)
                window.location.assign('/chats?chat=' + enc(chatKey) + '&tab=memory&memoryPage=settings');
              else setSection(id);
            }}
          >
            {title}
          </Action>
        ))}
        {extensionSections.map(({ owner, value }) => (
          <Action
            type="button"
            key={owner + '/' + value.id}
            aria-selected={section === value.id}
            onClick={() => setSection(value.id)}
          >
            {value.title}
          </Action>
        ))}
      </div>
      <div className="settings-content form-stack">
        {extensionSection ? (
          <PluginBoundary
            key={extensionSection.owner + '/' + section + '/' + chatKey}
            name={extensionSection.owner}
          >
            <extensionSection.value.component context={context} />
          </PluginBoundary>
        ) : null}
        <small>
          {global
            ? '默认配置作用于尚未自定义的会话。'
            : '本会话保存完整配置快照，后续修改默认值不会影响它；记忆整理设置可单独跟随全局。'}
        </small>
        {section === 'memory' ? (
          <>
            <MemoryScheduleForm chatKey={global ? undefined : chatKey} />
            <h3 className="settings-divider">整理模型</h3>
            <label className="toggle-row">
              跟随会话聊天模型
              <Toggle
                checked={draft.memoryModel.useChatModel}
                onChange={(e) =>
                  change({
                    memoryModel: {
                      ...draft.memoryModel,
                      useChatModel: e.target.checked,
                    },
                  })
                }
              />
            </label>
            {!draft.memoryModel.useChatModel ? (
              <div className="form-grid">
                <label>
                  记忆整理渠道
                  <select
                    value={draft.memoryModel.providerId}
                    onChange={(e) =>
                      change({
                        memoryModel: {
                          ...draft.memoryModel,
                          providerId: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="">全局默认渠道</option>
                    {cfg?.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  记忆整理模型
                  <input
                    value={draft.memoryModel.model}
                    onChange={(e) =>
                      change({
                        memoryModel: {
                          ...draft.memoryModel,
                          model: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              </div>
            ) : null}
            <label>
              笔记最长保留天数
              <input
                type="number"
                min="1"
                max="90"
                value={draft.scratchpadMaxDays}
                onChange={(e) => change({ scratchpadMaxDays: Number(e.target.value) })}
              />
            </label>
          </>
        ) : null}
        {section === 'persona' && (
          <div className="form-stack">
            <div className="form-grid">
              <label>
                人设目录
                <select
                  value={draft.personaSelection.personaId}
                  onChange={(e) => persona({ personaId: e.target.value })}
                >
                  <option value="">使用原有／默认人设快照</option>
                  {cfg?.personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                提示词模板
                <select
                  value={draft.personaSelection.promptId}
                  onChange={(e) => persona({ promptId: e.target.value })}
                >
                  <option value="">无附加模板</option>
                  {cfg?.prompts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted">
              在此选择已有内容并预览。增删改请前往 <a href="/prompts">提示词管理</a>；默认人设只读。
            </p>
            <h3>人设预览</h3>
            <Markdown>
              {cfg?.personas.find((p) => p.id === draft.personaSelection.personaId)?.text ?? draft.persona}
            </Markdown>
            <h3>提示词预览</h3>
            <Markdown>
              {cfg?.prompts.find((p) => p.id === draft.personaSelection.promptId)?.text ?? '未选择附加提示词'}
            </Markdown>
            {draft.personaSelection.rules && (
              <>
                <h3>已有附加规则（只读）</h3>
                <Markdown>{draft.personaSelection.rules}</Markdown>
              </>
            )}
          </div>
        )}
        {section === 'model' && (
          <div className="form-stack">
            <div className="form-grid">
              <label>
                模型渠道
                <select
                  value={draft.modelSelection.providerId}
                  onChange={(e) => model({ providerId: e.target.value })}
                >
                  <option value="">默认渠道</option>
                  {cfg?.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                主模型
                <input
                  aria-label="会话主模型"
                  value={draft.modelSelection.model}
                  placeholder="留空使用默认模型"
                  onChange={(e) => model({ model: e.target.value })}
                />
              </label>
              <label>
                单次请求超时（毫秒）
                <input
                  type="number"
                  min="100"
                  value={draft.modelSelection.timeoutMs}
                  onChange={(e) => model({ timeoutMs: Number(e.target.value) })}
                />
              </label>
              <label>
                温度（留空使用模型默认）
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={draft.modelSelection.temperature ?? ''}
                  onChange={(e) =>
                    model({
                      temperature: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                思考模式
                <select
                  value={draft.modelSelection.thinkingMode}
                  onChange={(e) =>
                    model({
                      thinkingMode: e.target.value as 'auto' | 'on' | 'off',
                    })
                  }
                >
                  <option value="auto">模型默认</option>
                  <option value="off">关闭</option>
                  <option value="on">开启</option>
                </select>
              </label>
              <label>
                思考强度
                <select
                  value={draft.modelSelection.thinkingEffort}
                  onChange={(e) =>
                    model({
                      thinkingEffort: e.target.value as typeof draft.modelSelection.thinkingEffort,
                    })
                  }
                >
                  {['', 'low', 'medium', 'high', 'xhigh', 'max'].map((v) => (
                    <option key={v} value={v}>
                      {v || '默认'}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              备选模型（按顺序，每行 渠道ID|模型ID；渠道留空使用默认）
              <textarea
                value={draft.modelSelection.fallbacks.map((f) => `${f.providerId}|${f.model}`).join('\n')}
                onChange={(e) =>
                  model({
                    fallbacks: e.target.value
                      .split('\n')
                      .filter(Boolean)
                      .map((line) => {
                        const p = line.indexOf('|');
                        return p < 0
                          ? { providerId: '', model: line }
                          : {
                              providerId: line.slice(0, p),
                              model: line.slice(p + 1),
                            };
                      }),
                  })
                }
              />
            </label>
            <MediaOptions draft={draft} change={change} />
          </div>
        )}
        {section === 'chat' && (
          <div className="form-stack">
            <label className="reply-limit-field">
              每轮回复消息上限（0 不限）
              <input
                aria-label="每轮回复消息上限"
                type="number"
                min="0"
                max="100"
                step="1"
                value={draft.maxReplyMessages}
                onChange={(e) => change({ maxReplyMessages: Number(e.target.value) })}
              />
              <small>同一轮的多次发送共用上限，图片等消息也计数；设置了上限会提醒模型剩余条数。</small>
            </label>
            <BehaviorForm
              chatKind={global ? 'default' : chatKey.startsWith('private:') ? 'private' : 'group'}
              value={draft.behavior}
              onChange={(behavior) => change({ behavior })}
            />
            <h3 className="settings-divider">运行与发送时机</h3>
            <div className="form-grid">
              <label className="toggle-row">
                会话在线
                <Toggle checked={draft.online} onChange={(e) => change({ online: e.target.checked })} />
              </label>
              <label>
                处理超时（毫秒，0 不限）
                <input
                  type="number"
                  min="0"
                  value={draft.runTimeoutMs}
                  onChange={(e) => change({ runTimeoutMs: Number(e.target.value) })}
                />
              </label>
              <label>
                排队超时（毫秒，0 不限）
                <input
                  type="number"
                  min="0"
                  value={draft.queueTimeoutMs}
                  onChange={(e) => change({ queueTimeoutMs: Number(e.target.value) })}
                />
                <small>从提交开始计时；开始执行后改用处理超时。重启恢复保留已等待时间。</small>
              </label>
              <label>
                最大工具轮数
                <input
                  type="number"
                  min="1"
                  max="40"
                  value={draft.maxRounds}
                  onChange={(e) => change({ maxRounds: Number(e.target.value) })}
                />
              </label>
              <label>
                未发言处置
                <select
                  value={draft.silencePolicy}
                  onChange={(e) =>
                    change({
                      silencePolicy: e.target.value as ChatSettings['silencePolicy'],
                    })
                  }
                >
                  <option value="enforce">追问后记录原因</option>
                  <option value="record">直接记录原因</option>
                  <option value="off">不强制处置</option>
                </select>
              </label>
              {(['wakeDelayMs', 'drainDelayMs'] as const).map((k) => (
                <label key={k}>
                  {k === 'wakeDelayMs' ? '唤醒聚批' : '运行后续批'}延迟（毫秒）
                  <input
                    type="number"
                    min="0"
                    max="60000"
                    value={draft[k]}
                    onChange={(e) => change({ [k]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
            <h3 className="settings-divider">指令禁言</h3>
            <p className="muted">
              禁言期间仍响应 @ 与拍一拍，其他群消息不触发。下线则只保存消息，上线后不会补发。
            </p>
            <div className="form-grid">
              <label className="toggle-row">
                启用指令禁言
                <Toggle
                  checked={draft.commandMute.enabled}
                  onChange={(e) =>
                    change({
                      commandMute: {
                        ...draft.commandMute,
                        enabled: e.target.checked,
                      },
                    })
                  }
                />
              </label>
              <label>
                禁言指令（需 @）
                <input
                  value={draft.commandMute.command}
                  onChange={(e) =>
                    change({
                      commandMute: {
                        ...draft.commandMute,
                        command: e.target.value,
                      },
                    })
                  }
                />
              </label>
              <label>
                禁言时长（分钟，0 无限）
                <input
                  type="number"
                  min="0"
                  value={draft.commandMute.durationMin}
                  onChange={(e) =>
                    change({
                      commandMute: {
                        ...draft.commandMute,
                        durationMin: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
            {!global ? (
              <Action
                type="button"
                onClick={() =>
                  void host.api
                    .request(`/api/chats/${enc(chatKey)}/unmute`, {
                      method: 'POST',
                    })
                    .then(() => setNotice('已解除指令禁言'))
                    .catch((e) => setNotice(e.message))
                }
              >
                解除当前指令禁言
              </Action>
            ) : null}
          </div>
        )}
        {section === 'sticker' ? <StickerOptions draft={draft} config={cfg} change={change} /> : null}
        {section === 'images' ? <ImageStudioOptions draft={draft} config={cfg} change={change} /> : null}
        {section === 'tools' && (
          <>
            <ToolManager chatKey={chatKey} />
            <details>
              <summary>系统插件可用性（高级）</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>插件／工具来源</th>
                      <th>本会话可用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status?.plugins.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {p.name}
                          <small> {p.id}</small>
                        </td>
                        <td>
                          <Toggle
                            aria-label={`会话启用 ${p.id}`}

                            checked={draft.plugins[p.id] !== false}
                            onChange={(e) =>
                              change({
                                plugins: {
                                  ...draft.plugins,
                                  [p.id]: e.target.checked,
                                },
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        <div className="row settings-save-bar">
          <Action type="button" className="primary" onClick={save}>
            保存会话设置
          </Action>
          {!global && (
            <>
              <Action
                type="button"
                onClick={() =>
                  void host.api
                    .request(`/api/profiles/${enc(chatKey)}/restore`, {
                      method: 'POST',
                      body: JSON.stringify({ section }),
                    })
                    .then(() => {
                      setDirty(false);
                      void host.queries.invalidateQueries();
                    })
                    .catch((e) => setNotice(e.message))
                }
              >
                恢复本分区默认
              </Action>
              <Action
                type="button"
                onClick={async () => {
                  if (
                    !(await dialogs.confirm({
                      title: '恢复默认设置？',
                      description: '清除本会话的独立快照，重新采用全局默认设置。聊天与记忆仍会保留。',
                      confirmLabel: '恢复默认',
                      danger: true,
                    }))
                  )
                    return;
                  void host.api
                    .request(`/api/profiles/${enc(chatKey)}`, {
                      method: 'DELETE',
                    })
                    .then(() => {
                      setDirty(false);
                      void host.queries.invalidateQueries();
                    })
                    .catch((e) => setNotice(e.message));
                }}
              >
                恢复全部默认
              </Action>
            </>
          )}
          <span role="status">{notice}</span>
          {dirty && <small>未保存</small>}
        </div>
      </div>
    </div>
  );
}
