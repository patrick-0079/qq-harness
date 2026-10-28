import { Action } from '@qq-harness/client-sdk';
import { Selection } from '@qq-harness/client-sdk';
import { useRef, useState } from 'react';
import type { ChatDirectoryEntry } from '@qq-harness/contracts';
import { chatInitial } from '@qq-harness/contracts';
import { confirmDiscardChanges, Slot } from '@qq-harness/client-sdk';

export function DirectoryList({
  chats,
  current,
  chosen,
  choose,
  select,
}: {
  chats: ChatDirectoryEntry[];
  current: string;
  chosen: string[];
  choose: (keys: string[]) => void;
  select: (key: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null),
    [active, setActive] = useState('');
  const groups = new Map<string, ChatDirectoryEntry[]>();
  for (const chat of chats) {
    const letter = chat.pinnedAt ? '★' : chatInitial(chat.displayName);
    groups.set(letter, [...(groups.get(letter) ?? []), chat]);
  }
  const jump = (letter: string) => {
    const header = scroll.current?.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
    if (header && scroll.current) {
      scroll.current.scrollTo({
        top:
          header.getBoundingClientRect().top -
          scroll.current.getBoundingClientRect().top +
          scroll.current.scrollTop,
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
      setActive(letter);
    }
  };
  return (
    <div className="directory-body">
      <div className="directory-scroll" ref={scroll}>
        <Action
          className={`chat-item default-chat ${current === 'default' ? 'selected' : ''}`}
          onClick={async () => {
            if (await confirmDiscardChanges()) select('default');
          }}
        >
          <span className="directory-avatar">★</span>
          <span>
            <strong>默认会话</strong>
            <small>未独立配置会话的汇总</small>
          </span>
        </Action>
        {[...groups].map(([letter, rows]) => (
          <section key={letter} className="directory-group">
            <div className="letter-heading" data-letter={letter}>
              {letter === '★' ? '置顶' : letter === '#' ? '其他' : letter}
              <small>{rows.length}</small>
            </div>
            {rows.map((chat) => (
              <div
                className={`directory-row ${current === chat.chatKey ? 'is-selected' : ''}`}
                key={chat.chatKey}
              >
                <Selection
                  aria-label={`选择 ${chat.chatKey}`}
                  checked={chosen.includes(chat.chatKey)}
                  onChange={(e) =>
                    choose(
                      e.target.checked
                        ? [...chosen, chat.chatKey]
                        : chosen.filter((k) => k !== chat.chatKey),
                    )
                  }
                />
                <Action
                  className="chat-item"
                  onClick={async () => {
                    if (await confirmDiscardChanges()) select(chat.chatKey);
                  }}
                >
                  <span
                    className={`directory-avatar ${chat.chatKey.startsWith('group:') ? 'group' : 'private'}`}
                  >
                    {chat.displayName.slice(0, 1)}
                  </span>
                  <span className="directory-name">
                    <strong>{chat.displayName}</strong>
                    <small>{chat.lastText || chat.chatKey}</small>
                  </span>
                  <span
                    className={`presence ${chat.denied ? 'blocked' : chat.allowed && chat.online ? 'online' : ''}`}
                    title={
                      chat.denied
                        ? '已屏蔽'
                        : chat.allowed
                          ? chat.online
                            ? '在线'
                            : '下线'
                          : '未准入'
                    }
                  />
                </Action>
                <Slot point="conversation.list.row-actions" context={{ chatKey: chat.chatKey }} />
              </div>
            ))}
          </section>
        ))}
        {!chats.length ? <div className="empty">没有匹配的会话</div> : null}
      </div>
      <nav className="alphabet-index" aria-label="按首字母快速定位会话">
        {['★', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => (
          <Action
            key={letter}
            title={`跳到 ${letter} 开头的会话`}
            aria-label={`跳到 ${letter} 开头的会话`}
            aria-pressed={active === letter}
            disabled={!groups.has(letter)}
            onClick={() => jump(letter)}
          >
            {letter}
          </Action>
        ))}
      </nav>
    </div>
  );
}
