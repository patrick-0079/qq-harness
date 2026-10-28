import { Action } from '@qq-harness/client-sdk';
import { Toggle } from '@qq-harness/client-sdk';
import type { ConversationBehavior, KeywordRule } from '@qq-harness/contracts';
export function BehaviorForm({
  value: v,
  onChange,
  chatKind = 'default',
}: {
  value: ConversationBehavior;
  onChange: (v: ConversationBehavior) => void;
  chatKind?: 'default' | 'private' | 'group';
}) {
  const patch = (p: Partial<ConversationBehavior>) => onChange({ ...v, enabled: true, ...p });
  const channels = (
    reply: ConversationBehavior['reply'],
    change: (r: ConversationBehavior['reply']) => void,
    prefix = '',
  ) => (
    <table className="policy-table">
      <thead>
        <tr>
          <th>触发渠道</th>
          <th>启用</th>
          <th>回复概率</th>
        </tr>
      </thead>
      <tbody>
        {(['private', 'mention', 'keyword', 'other'] as const)
          .filter(
            (k) =>
              (!prefix || k !== 'private') &&
              (chatKind === 'default' || (chatKind === 'private' ? k === 'private' : k !== 'private')),
          )
          .map((key, i) => (
            <tr key={key}>
              <td>
                {prefix}
                {
                  {
                    private: '私聊',
                    mention: '@ 与拍一拍',
                    keyword: '命中关键词',
                    other: '任意消息',
                  }[key]
                }
              </td>
              <td>
                {key === 'private' ? (
                  <span className="muted">始终参与概率判断</span>
                ) : (
                  <Toggle
                    aria-label={`${prefix}${key}启用`}
                    checked={reply[key].enabled}
                    onChange={(e) =>
                      change({
                        ...reply,
                        [key]: { ...reply[key], enabled: e.target.checked },
                      })
                    }
                  />
                )}
              </td>
              <td>
                <label className="inline-field">
                  <input
                    aria-label={`${prefix}${{ private: '私聊', mention: '@与拍一拍', keyword: '关键词', other: '任意消息' }[key]}概率`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    disabled={key !== 'private' && !reply[key].enabled}
                    value={reply[key].probability}
                    onChange={(e) =>
                      change({
                        ...reply,
                        [key]: {
                          ...reply[key],
                          probability: Number(e.target.value),
                        },
                      })
                    }
                  />
                  <span>%</span>
                </label>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
  const rule = (id: string, p: Partial<KeywordRule>) =>
    patch({
      keywordRules: v.keywordRules.map((r) => (r.id === id ? { ...r, ...p } : r)),
    });
  return (
    <div className="behavior-form form-stack">
      <div className="settings-section-heading">
        <div>
          <h3>触发与回复概率</h3>
          <p>四类渠道独立设置，精度 0.01%。概率未命中时保留未读，不调用模型。</p>
        </div>
      </div>
      <p className="muted">
        活跃期必触发；群聊依次判断
        @/拍一拍、关键词、任意消息。渠道关闭继续，概率未命中结束。私聊使用独立概率。
      </p>
      {channels(v.reply, (reply) => patch({ reply }))}
      {chatKind !== 'private' && (
        <>
          {' '}
          <div className="settings-section-heading">
            <div>
              <h3>关键词规则</h3>
              <p>规则概率留空表示跟随渠道；多条命中取最高概率，排除规则优先。</p>
            </div>
            <Action
              type="button"
              onClick={() =>
                patch({
                  keywordRules: [
                    ...v.keywordRules,
                    {
                      id: crypto.randomUUID(),
                      pattern: '',
                      mode: 'plain',
                      flags: 'i',
                      enabled: true,
                      exclude: false,
                      probability: null,
                    },
                  ],
                })
              }
            >
              ＋ 添加规则
            </Action>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>启用</th>
                  <th>模式</th>
                  <th>关键词／正则</th>
                  <th>标志位</th>
                  <th>概率 %</th>
                  <th>排除</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {v.keywordRules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Toggle
                        aria-label="规则启用"
                        checked={r.enabled}
                        onChange={(e) => rule(r.id, { enabled: e.target.checked })}
                      />
                    </td>
                    <td>
                      <select
                        aria-label="关键词模式"
                        value={r.mode}
                        onChange={(e) =>
                          rule(r.id, {
                            mode: e.target.value as 'plain' | 'regex',
                          })
                        }
                      >
                        <option value="plain">普通</option>
                        <option value="regex">正则</option>
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label="关键词规则"
                        value={r.pattern}
                        placeholder="输入词语或表达式"
                        onChange={(e) => rule(r.id, { pattern: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="short-input"
                        aria-label="正则标志位"
                        disabled={r.mode !== 'regex'}
                        value={r.flags}
                        onChange={(e) => rule(r.id, { flags: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="short-input"
                        aria-label="规则概率"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        placeholder="继承"
                        value={r.probability ?? ''}
                        onChange={(e) =>
                          rule(r.id, {
                            probability: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <Toggle
                        aria-label="排除规则"
                        checked={r.exclude}
                        onChange={(e) => rule(r.id, { exclude: e.target.checked })}
                      />
                    </td>
                    <td>
                      <Action
                        type="button"
                        className="text-button"
                        onClick={() =>
                          patch({
                            keywordRules: v.keywordRules.filter((x) => x.id !== r.id),
                          })
                        }
                      >
                        移除
                      </Action>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!v.keywordRules.length ? <p className="empty compact">暂无关键词规则</p> : null}
          </div>
          <div className="settings-section-heading">
            <div>
              <h3>峰谷时段</h3>
              <p>高峰仅覆盖群聊渠道；高峰外使用上方主配置，私聊概率始终保持不变。</p>
            </div>
            <label className="toggle-row">
              <Toggle
                checked={v.peakSchedule.enabled}
                onChange={(e) =>
                  patch({
                    peakSchedule: {
                      ...v.peakSchedule,
                      enabled: e.target.checked,
                    },
                  })
                }
              />
              启用峰谷
            </label>
          </div>
          <div className="weekday-picker">
            {['一', '二', '三', '四', '五', '六', '日'].map((day, i) => (
              <label key={day}>
                <Toggle
                  checked={v.peakSchedule.weekdays.includes(i + 1)}
                  onChange={(e) =>
                    patch({
                      peakSchedule: {
                        ...v.peakSchedule,
                        weekdays: e.target.checked
                          ? [...v.peakSchedule.weekdays, i + 1]
                          : v.peakSchedule.weekdays.filter((d) => d !== i + 1),
                      },
                    })
                  }
                />
                周{day}
              </label>
            ))}
            <small>全部不选表示每天</small>
          </div>
          <div className="form-grid">
            {(['start', 'end'] as const).map((k) => (
              <label key={k}>
                高峰{k === 'start' ? '开始' : '结束'}时间
                <input
                  type="time"
                  value={v.peakSchedule.peak[k]}
                  onChange={(e) =>
                    patch({
                      peakSchedule: {
                        ...v.peakSchedule,
                        peak: { ...v.peakSchedule.peak, [k]: e.target.value },
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <small>支持跨午夜，如 22:00–06:00，按开始当天的星期计算。</small>
          {channels(
            v.peakSchedule.peak.reply,
            (reply) =>
              patch({
                peakSchedule: {
                  ...v.peakSchedule,
                  peak: { ...v.peakSchedule.peak, reply },
                },
              }),
            '高峰',
          )}
        </>
      )}
      <h3 className="settings-divider">上下文、未读与活跃期</h3>
      <div className="form-grid">
        <label>
          历史消息条数
          <input
            type="number"
            min="0"
            max="2000"
            value={v.historyCount}
            onChange={(e) => patch({ historyCount: Number(e.target.value) })}
          />
        </label>
        <label>
          未读上限（0 不限）
          <input
            type="number"
            min="0"
            max="10000"
            value={v.maxPendingUnread}
            onChange={(e) => patch({ maxPendingUnread: Number(e.target.value) })}
          />
        </label>
        <label className="toggle-row">
          条件未命中标已读
          <Toggle
            checked={v.markConditionMissRead}
            onChange={(e) => patch({ markConditionMissRead: e.target.checked })}
          />
        </label>
        <label className="toggle-row">
          复用上下文前缀
          <Toggle
            checked={v.promptAnchor.enabled}
            onChange={(e) =>
              patch({
                promptAnchor: { ...v.promptAnchor, enabled: e.target.checked },
              })
            }
          />
        </label>
        <label>
          前缀额外历史条数
          <input
            type="number"
            min="0"
            max="200"
            value={v.promptAnchor.maxExtraRead}
            onChange={(e) =>
              patch({
                promptAnchor: {
                  ...v.promptAnchor,
                  maxExtraRead: Number(e.target.value),
                },
              })
            }
          />
        </label>
        {chatKind !== 'private' && (
          <>
            <label className="toggle-row">
              允许活跃期
              <Toggle
                checked={v.chatActive.enabled}
                onChange={(e) =>
                  patch({
                    chatActive: { ...v.chatActive, enabled: e.target.checked },
                  })
                }
              />
            </label>
            <label>
              活跃期硬上限（分钟）
              <input
                type="number"
                min="0"
                max="1440"
                value={v.chatActive.maxMinutes}
                onChange={(e) =>
                  patch({
                    chatActive: {
                      ...v.chatActive,
                      maxMinutes: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          </>
        )}
        <label>
          未发言最多追问次数
          <input
            type="number"
            min="0"
            max="3"
            value={v.run.maxNudges}
            onChange={(e) => patch({ run: { ...v.run, maxNudges: Number(e.target.value) } })}
          />
        </label>
        <label>
          未发送时失败自动重试次数
          <input
            type="number"
            min="0"
            max="10"
            value={v.run.retryAttempts}
            onChange={(e) =>
              patch({
                run: { ...v.run, retryAttempts: Number(e.target.value) },
              })
            }
          />
        </label>
      </div>
      <small>活跃期由 finish 的 activeTopic 控制，重复开启不延长截止时间。</small>
      {chatKind !== 'private' && (
        <label>
          当前会话屏蔽成员（QQ 号，逗号分隔）
          <input
            value={v.blockedUsers.join(',')}
            onChange={(e) =>
              patch({
                blockedUsers: e.target.value.split(/[,，\s]+/).filter(Boolean),
              })
            }
          />
        </label>
      )}
    </div>
  );
}
