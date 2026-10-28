import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Popover, Tooltip } from 'antd';
import { Action, Icon, Slot, type PageContribution } from '@qq-harness/client-sdk';
type Page = { owner: string; value: PageContribution };
function NavigationItem({
  page,
  children,
  collapsed,
}: {
  page: Page;
  children: Page[];
  collapsed: boolean;
}) {
  const { pathname } = useLocation(),
    [open, setOpen] = useState(false);
  const flyout = useRef<HTMLDivElement>(null),
    anchor = useRef<HTMLAnchorElement>(null),
    keyboard = useRef(false);
  useEffect(() => setOpen(false), [pathname, collapsed]);
  useEffect(() => {
    if (!open || !keyboard.current) return;
    keyboard.current = false;
    const frame = requestAnimationFrame(() => flyout.current?.querySelector('a')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const link = (
    <NavLink
      ref={anchor}
      className="sidebar-link"
      aria-label={page.value.title}
      to={page.value.path}
      end={!children.length}
      onKeyDown={(e) => {
        if (collapsed && children.length && e.key === 'ArrowRight') {
          e.preventDefault();
          keyboard.current = true;
          setOpen(true);
          if (open) flyout.current?.querySelector('a')?.focus();
        }
      }}
    >
      <span className="sidebar-icon">
        <Icon name={page.value.icon ?? 'extensions'} />
      </span>
      <span className="nav-label sidebar-text">{page.value.title}</span>
      {!!children.length && (
        <span className="sidebar-chevron" aria-hidden="true">
          ⌄
        </span>
      )}
    </NavLink>
  );
  return (
    <div className="sidebar-group">
      {collapsed && children.length ? (
        <Popover
          placement="rightTop"
          trigger={['hover', 'click']}
          open={open}
          onOpenChange={setOpen}
          content={
            <div
              ref={flyout}
              className="sidebar-flyout"
              aria-label={page.value.title + '子菜单'}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setOpen(false);
                  anchor.current?.focus();
                }
              }}
            >
              <strong>{page.value.title}</strong>
              {children.map((p) => (
                <NavLink key={p.value.id} to={p.value.path} onClick={() => setOpen(false)}>
                  {p.value.title}
                </NavLink>
              ))}
            </div>
          }
        >
          {link}
        </Popover>
      ) : (
        <Tooltip title={collapsed ? page.value.title : undefined} placement="right">
          {link}
        </Tooltip>
      )}
      {!collapsed && children.length > 0 && pathname.startsWith(page.value.path + '/') && (
        <div className="sidebar-children">
          {children.map((p) => (
            <NavLink key={p.value.id} to={p.value.path} end>
              {p.value.title}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
export function Sidebar({
  pages,
  collapsed,
  onCollapse,
  connection,
}: {
  pages: Page[];
  collapsed: boolean;
  onCollapse: () => void;
  connection: string;
}) {
  const visible = pages.filter((p) => !p.value.hidden);
  return (
    <aside className="app-sidebar" aria-label="工作台导航">
      <NavLink to="/" className="app-brand" aria-label="QQ Harness 首页">
        <b>Q</b>
        <span>
          QQ Harness<small>管理控制台</small>
        </span>
      </NavLink>
      <div className="sidebar-caption">工作台</div>
      <nav className="sidebar-navigation" aria-label="主菜单">
        {visible
          .filter(
            (p) =>
              !p.value.parentId || !visible.some((parent) => parent.value.id === p.value.parentId),
          )
          .map((p) => (
            <NavigationItem
              key={p.owner + '/' + p.value.id}
              page={p}
              collapsed={collapsed}
              children={visible.filter((child) => child.value.parentId === p.value.id)}
            />
          ))}
        <Slot point="shell.nav.extra" />
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-connection" title={connection}>
          <i data-connected={connection === '已连接'} />
          <span>{connection}</span>
        </div>
        <Action
          className="nav-collapse sidebar-collapse"
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          onClick={onCollapse}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
            <path d={collapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} />
          </svg>
          <span>收起导航</span>
        </Action>
      </div>
    </aside>
  );
}
