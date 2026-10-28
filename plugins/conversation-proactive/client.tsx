import { Action } from '@qq-harness/client-sdk';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { InputNumber, Alert } from 'antd';
import {
  defineClientPlugin,
  useHost,
  useUnsavedChanges,
  Toggle,
  type SlotProps,
} from '@qq-harness/client-sdk';
import type { ChatSettings } from '@qq-harness/contracts';
function TopicSettings({ context }: SlotProps) {
  const host = useHost(),
    chat = String(context.chatKey ?? 'default'),
    [draft, setDraft] = useState<ChatSettings['behavior']['proactive']>(),
    [dirty, setDirty] = useState(false),
    [notice, setNotice] = useState('');
  useUnsavedChanges(dirty);
  const { data } = useQuery({
    queryKey: ['proactive', chat],
    queryFn: ({ signal }) =>
      host.api.request<ChatSettings>('/api/chats/' + encodeURIComponent(chat) + '/settings', {
        signal,
      }),
  });
  useEffect(() => {
    if (data && !dirty) setDraft(data.behavior.proactive);
  }, [data, dirty]);
  if (!draft) return <p>加载主动话题设置…</p>;
  const patch = (p: Partial<typeof draft>) => {
    setDraft({ ...draft, ...p });
    setDirty(true);
  };
  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void host.api
          .request(
            chat === 'default' ? '/api/config' : '/api/profiles/' + encodeURIComponent(chat),
            {
              method: 'PATCH',
              body: JSON.stringify(
                chat === 'default'
                  ? { defaults: { behavior: { proactive: draft } } }
                  : { behavior: { proactive: draft } },
              ),
            },
          )
          .then(() => {
            setDirty(false);
            setNotice('主动话题设置已保存');
            void host.queries.invalidateQueries();
          })
          .catch((e) => setNotice(e.message));
      }}
    >
      <h3>主动话题</h3>
      <Alert
        type="info"
        showIcon
        title="无人发消息达到冷场秒数后进行首次概率判定；失败则等待固定检查间隔再判定。成功后提交寻找话题的一轮对话。新消息会重新计时。"
      />
      <label className="toggle-row">
        启用主动话题
        <Toggle checked={draft.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
      </label>
      <div className="form-grid">
        <label>
          无人发消息达到 x 秒
          <InputNumber
            aria-label="冷场秒数"
            min={1}
            value={draft.idleSeconds}
            onChange={(v) => patch({ idleSeconds: Number(v) })}
          />
        </label>
        <label>
          每 y 秒检查一次
          <InputNumber
            aria-label="主动检查间隔秒数"
            min={1}
            value={draft.checkEverySeconds}
            onChange={(v) => patch({ checkEverySeconds: Number(v) })}
          />
        </label>
        <label>
          判定成功概率 %
          <InputNumber
            aria-label="主动话题概率"
            min={0}
            max={100}
            precision={2}
            value={draft.probability * 100}
            onChange={(v) => patch({ probability: Number(v) / 100 })}
          />
        </label>
      </div>
      <div className="row">
        <Action className="primary">保存主动话题</Action>
        <span role="status">{notice}</span>
      </div>
    </form>
  );
}
export default defineClientPlugin({
  id: 'conversation-proactive',
  requires: ['console-chats'],
  setup(ctx) {
    ctx.slot('conversation.detail.settings', {
      id: 'proactive',
      title: '主动话题',
      order: 65,
      component: TopicSettings,
    });
  },
});
