import { useState } from 'react';
import { Button, Input } from 'antd';
import { defineClientPlugin, useHost, type SlotProps } from '@qq-harness/client-sdk';
function Trigger({ context, compact = false }: SlotProps & { compact?: boolean }) {
  const host = useHost(),
    [text, setText] = useState(''),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState(''),
    chat = String(context.chatKey ?? 'default');
  const fire = async () => {
    setPending(true);
    try {
      const result = await host.api.request<{ id: string }>('/api/conversation/manual', {
        method: 'POST',
        body: JSON.stringify({ chatKey: chat, text }),
      });
      setNotice('已提交：' + result.id);
      void host.queries.invalidateQueries();
    } catch (e) {
      setNotice(String(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className={compact ? 'row' : 'form-stack'}>
      {!compact && (
        <>
          <h3>手动触发</h3>
          <p>忽略触发条件和回复概率，直接提交一轮对话。仍遵守准入、暂停和上下线。</p>
          <Input.TextArea
            aria-label="手动触发说明"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="可选：本轮想聊的话题或任务"
          />
        </>
      )}
      <Button loading={pending} disabled={chat === 'default'} onClick={() => void fire()}>
        手动触发
      </Button>
      {notice && (
        <span role="status" title={notice} aria-label={notice}>
          {compact ? (notice.startsWith('已提交') ? '已提交' : '提交失败') : notice}
        </span>
      )}
    </div>
  );
}
export default defineClientPlugin({
  id: 'conversation-manual',
  requires: ['console-chats'],
  setup(ctx) {
    ctx.slot('conversation.detail.header-actions', {
      id: 'manual-trigger',
      order: 5,
      component: (props) => <Trigger {...props} compact />,
    });
    ctx.slot('conversation.detail.settings', {
      id: 'manual-trigger',
      title: '手动触发',
      order: 66,
      component: Trigger,
    });
  },
});
