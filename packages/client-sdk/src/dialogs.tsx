import { Action } from './ui.js';
import * as React from 'react';
import { createPortal } from 'react-dom';

interface DialogOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface PromptOptions extends DialogOptions {
  label: string;
  initialValue?: string;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  maxLength?: number;
  allowEmpty?: boolean;
  onSubmit?: (value: string) => Promise<unknown>;
}
let requestId = 0;
type Request = {
  id: number;
  returnFocus: HTMLElement | null;
  options: DialogOptions | PromptOptions;
  resolve: (value: string | boolean | null) => void;
};
let current: Request | undefined;
const queue: Request[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
function request(options: DialogOptions | PromptOptions) {
  return new Promise<string | boolean | null>((resolve) => {
    queue.push({
      id: ++requestId,
      returnFocus: document.activeElement as HTMLElement | null,
      options,
      resolve,
    });
    if (!current) current = queue.shift();
    changed();
  });
}
function finish(value: string | boolean | null) {
  const resolved = current;
  current = queue.shift();
  changed();
  resolved?.resolve(value);
}
/** All official clients share the shell's React dialog queue; no native browser popups. */
export const dialogs = {
  confirm: async (options: DialogOptions) => (await request(options)) === true,
  prompt: async (options: PromptOptions) => {
    const value = await request(options);
    return typeof value === 'string' ? value : null;
  },
};

function Dialog({ item }: { item: Request }) {
  const options = item.options;
  const prompt = 'label' in options ? options : undefined;
  const [value, setValue] = React.useState(prompt?.initialValue ?? '');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const root = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId(),
    descriptionId = React.useId(),
    inputId = React.useId();
  const dismiss = () => {
    if (!pending) finish(null);
  };
  React.useEffect(() => {
    // Disabling the submit button during a request can move focus to body.
    // Restore it after failures so Escape and the focus trap keep working.
    if (!pending && !root.current?.contains(document.activeElement))
      root.current
        ?.querySelector<HTMLElement>(prompt ? 'input,textarea' : '[data-cancel]')
        ?.focus();
  }, [pending]);
  React.useEffect(() => {
    const previous = item.returnFocus;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = document.getElementById('root');
    const wasInert = background?.inert ?? false;
    if (background) background.inert = true;
    root.current?.querySelector<HTMLElement>(prompt ? 'input,textarea' : '[data-cancel]')?.focus();
    return () => {
      document.body.style.overflow = bodyOverflow;
      if (background) background.inert = wasInert;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={root}
        className={`admin-dialog ${prompt?.multiline ? 'dialog-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={options.description ? descriptionId : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dismiss();
          }
          if (event.key !== 'Tab') return;
          const controls = [
            ...root.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input,textarea,[tabindex="0"]',
            ),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending || (prompt && !prompt.allowEmpty && !value.trim())) return;
            setPending(true);
            setError('');
            try {
              await prompt?.onSubmit?.(value.trim());
              finish(prompt ? value.trim() : true);
            } catch (error) {
              setError(error instanceof Error ? error.message : String(error));
              setPending(false);
            }
          }}
        >
          <div className="dialog-heading">
            <span className={`dialog-symbol ${options.danger ? 'danger' : ''}`} aria-hidden="true">
              {options.danger ? '!' : prompt ? '✎' : '?'}
            </span>
            <h2 id={titleId}>{options.title}</h2>
            <Action
              type="button"
              className="icon-button"
              aria-label="关闭弹窗"
              disabled={pending}
              onClick={dismiss}
            >
              ×
            </Action>
          </div>
          <div className="dialog-body">
            {options.description && (
              <div className="dialog-description" id={descriptionId}>
                {options.description}
              </div>
            )}
            {prompt && (
              <label className="dialog-field" htmlFor={inputId}>
                <span>{prompt.label}</span>
                {prompt.multiline ? (
                  <textarea
                    id={inputId}
                    rows={6}
                    value={value}
                    required={!prompt.allowEmpty}
                    disabled={pending}
                    placeholder={prompt.placeholder}
                    maxLength={prompt.maxLength ?? 100000}
                    onChange={(event) => setValue(event.target.value)}
                  />
                ) : (
                  <input
                    id={inputId}
                    value={value}
                    required={!prompt.allowEmpty}
                    disabled={pending}
                    placeholder={prompt.placeholder}
                    maxLength={prompt.maxLength ?? 160}
                    onChange={(event) => setValue(event.target.value)}
                  />
                )}
                {prompt.hint && <small>{prompt.hint}</small>}
              </label>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
          </div>
          <div className="dialog-footer">
            <Action type="button" data-cancel disabled={pending} onClick={dismiss}>
              {options.cancelLabel ?? '取消'}
            </Action>
            <Action
              type="submit"
              className={options.danger ? 'danger-button' : 'primary'}
              disabled={pending || !!(prompt && !prompt.allowEmpty && !value.trim())}
            >
              {pending ? '正在保存…' : (options.confirmLabel ?? (prompt ? '保存修改' : '确认'))}
            </Action>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
export function DialogHost() {
  const item = React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
  return item ? <Dialog key={item.id} item={item} /> : null;
}

export function Drawer({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  className?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const root = React.useRef<HTMLElement>(null);
  const id = React.useId();
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const background = document.getElementById('root');
    const wasInert = background?.inert ?? false;
    if (background) background.inert = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.focus();
    return () => {
      if (background) background.inert = wasInert;
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <section
        ref={root}
        className={`drawer ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
          if (event.key !== 'Tab') return;
          const controls = [
            ...root.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary',
            ),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first || document.activeElement === root.current)
          ) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="section-heading">
          <h2 id={id}>{title}</h2>
          <Action type="button" onClick={onClose}>
            关闭编辑
          </Action>
        </div>
        {children}
      </section>
    </>,
    document.body,
  );
}
