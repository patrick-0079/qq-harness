import {
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { ConfigProvider, Switch, Checkbox, Button, theme } from 'antd';
import zhCN from 'antd/es/locale/zh_CN.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function DesignProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.dataset.theme === 'dark'),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      componentSize="middle"
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#4f7cff',
          borderRadius: 6,
          fontFamily: "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif",
          fontSize: 13,
          controlHeight: 32,
          colorBgContainer: dark ? '#111c2f' : '#ffffff',
          colorBgElevated: dark ? '#18263b' : '#ffffff',
          colorBorder: dark ? '#2b3a50' : '#dce3ec',
          colorText: dark ? '#e2e8f0' : '#1e293b',
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
type Control = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'>;
export function Action({
  type = 'submit',
  className,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'>) {
  return (
    <Button
      {...props}
      autoInsertSpace={false}
      htmlType={type}
      type={className?.split(' ').includes('primary') ? 'primary' : 'default'}
      danger={className?.split(' ').includes('danger')}
      className={className}
    >
      {children}
    </Button>
  );
}
export function Toggle({
  checked,
  defaultChecked,
  disabled,
  onChange,
  id,
  className,
  ...props
}: Control) {
  return (
    <Switch
      size="small"
      id={id}
      className={className}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      title={props.title}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      onChange={(value) =>
        onChange?.({
          target: { checked: value },
          currentTarget: { checked: value },
        } as ChangeEvent<HTMLInputElement>)
      }
    />
  );
}
export function Selection({ checked, defaultChecked, disabled, onChange, ...props }: Control) {
  return (
    <Checkbox
      {...props}
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      onChange={(event) => onChange?.(event as unknown as ChangeEvent<HTMLInputElement>)}
    />
  );
}
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
