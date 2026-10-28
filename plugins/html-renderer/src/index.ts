import fs from 'node:fs';
import { chromium, type Browser, type BrowserContext, type BrowserServer } from 'playwright-core';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { htmlRendererService, type RenderSurface } from '@qq-harness/domain';
import { publicFetch } from '@qq-harness/files';
const closingServers = new WeakMap<object, Promise<void>>();
/** BrowserServer owns the spawned process; forced cleanup never targets a PID
 * discovered from another application or the user's normal browser. */
type OwnedBrowser = Pick<BrowserServer, 'close' | 'kill'> & Partial<Pick<BrowserServer, 'process'>>;
export function closeOwnedBrowser(server: OwnedBrowser, graceMs = 5000) {
  const pending = closingServers.get(server);
  if (pending) return pending;
  const task = stopOwnedBrowser(server, graceMs);
  closingServers.set(server, task);
  return task;
}
async function stopOwnedBrowser(server: OwnedBrowser, graceMs: number) {
  const child = server.process?.(),
    timers = new Set<ReturnType<typeof setTimeout>>();
  let exited = Boolean(child && (child.exitCode !== null || child.signalCode !== null)),
    onExit: () => void = () => {};
  const processExit = new Promise<true>((resolve) => {
    if (exited) resolve(true);
    else if (child) {
      onExit = () => {
        exited = true;
        resolve(true);
      };
      child.once('exit', onExit);
    }
  });
  const wait = (ms: number) =>
    new Promise<false>((resolve) => {
      timers.add(setTimeout(() => resolve(false), ms));
    });
  try {
    const closed = await Promise.race([
      server.close().then(
        () => true,
        () => false,
      ),
      processExit,
      wait(graceMs),
    ]);
    if (!closed) {
      const killed = server.kill().then(
        () => true,
        () => false,
      );
      const done = await Promise.race([killed, processExit, wait(1500)]);
      if (!done && child && !exited) {
        child.kill('SIGKILL');
        if (!(await Promise.race([processExit, wait(1500)]))) throw new Error('自有渲染进程未能在期限内退出');
      } else if (!done && !child) throw new Error('自有浏览器关闭超时');
    }
  } finally {
    for (const timer of timers) clearTimeout(timer);
    child?.off('exit', onExit);
  }
}
/** A renderer can stall closing its DevTools context after capture. Escalate to
 * its owned browser before an extension unload can block the entire host. */
export async function closeRenderContext(
  context: Pick<BrowserContext, 'close'>,
  fallback: () => Promise<void>,
  graceMs = 1500,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const done = await Promise.race([
      context.close().then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
    if (!done) await fallback();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export function htmlRenderer(
  options: { channel?: string; executablePath?: string; fetch?: typeof publicFetch } = {},
) {
  return definePlugin({
    id: 'html-renderer',
    name: '状态卡与图片面板渲染',
    setup(ctx) {
      let browser: Promise<Browser> | undefined, server: Promise<BrowserServer> | undefined;
      const contexts = new Set<BrowserContext>();
      const closing = new Set<Promise<void>>();
      const stopBrowser = async () => {
        const owned = server,
          client = browser;
        server = undefined;
        browser = undefined;
        const task = (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              client?.then((value) => value.close()).catch(() => {}),
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, 1000);
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
          const value = await owned?.catch(() => undefined);
          if (value) await closeOwnedBrowser(value, 2000);
        })();
        closing.add(task);
        try {
          await task;
        } finally {
          closing.delete(task);
        }
      };
      const closePageContext = async (context: BrowserContext) => closeRenderContext(context, stopBrowser);
      let allocated = 0;
      const waiting: {
        resolve: (release: () => void) => void;
        reject: (error: unknown) => void;
        signal: AbortSignal;
        abort: () => void;
      }[] = [];
      const releaseSlot = () => {
        for (;;) {
          const next = waiting.shift();
          if (!next) {
            allocated--;
            return;
          }
          next.signal.removeEventListener('abort', next.abort);
          if (next.signal.aborted) {
            next.reject(next.signal.reason);
            continue;
          }
          next.resolve(once(releaseSlot));
          return;
        }
      };
      const once = (fn: () => void) => {
        let called = false;
        return () => {
          if (!called) {
            called = true;
            fn();
          }
        };
      };
      const acquire = async (signal: AbortSignal) => {
        signal.throwIfAborted();
        if (allocated < 2) {
          allocated++;
          return once(releaseSlot);
        }
        return new Promise<() => void>((resolve, reject) => {
          const row = {
            resolve,
            reject,
            signal,
            abort: () => {
              const index = waiting.indexOf(row);
              if (index >= 0) waiting.splice(index, 1);
              reject(signal.reason ?? new Error('渲染已取消'));
            },
          };
          waiting.push(row);
          signal.addEventListener('abort', row.abort, { once: true });
        });
      };
      const getBrowser = async () => {
        ctx.assertActive();
        if (!browser) {
          const channel =
              options.channel ??
              (fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                ? 'msedge'
                : undefined),
            owned = chromium.launchServer({
              headless: true,
              host: '127.0.0.1',
              chromiumSandbox: true,
              ...(options.executablePath
                ? { executablePath: options.executablePath }
                : channel
                  ? { channel }
                  : {}),
              timeout: 20000,
            });
          server = owned;
          const current = owned.then(async (value) => {
            ctx.assertActive();
            return chromium.connect(value.wsEndpoint(), { timeout: 10000 });
          });
          browser = current;
          void current.then(
            (value) =>
              value.once('disconnected', () => {
                if (browser === current && !ctx.signal.aborted) {
                  browser = undefined;
                  if (server === owned) server = undefined;
                  void owned.then((s) => closeOwnedBrowser(s, 2000)).catch(() => {});
                }
              }),
            () => {
              if (browser === current) browser = undefined;
              if (server === owned) server = undefined;
              void owned.then((s) => closeOwnedBrowser(s, 2000)).catch(() => {});
            },
          );
        }
        const value = await browser;
        ctx.assertActive();
        return value;
      };
      const size = (n: number, max: number) => {
        if (!Number.isFinite(n) || n < 1 || n > max) throw new Error('面板尺寸超出允许范围');
        return Math.ceil(n);
      };
      ctx.provide(htmlRendererService, {
        status: () => ({ pages: contexts.size, browser: Boolean(browser) }),
        async create(options, outerSignal) {
          const signal = AbortSignal.any([ctx.signal, outerSignal ?? ctx.signal, AbortSignal.timeout(60000)]),
            release = await acquire(signal);
          let context: BrowserContext | undefined;
          try {
            const value = await getBrowser();
            signal.throwIfAborted();
            context = await value.newContext({
              viewport: { width: size(options.width, 2400), height: size(options.height, 10000) },
              deviceScaleFactor: 1,
              javaScriptEnabled: false,
              acceptDownloads: false,
              serviceWorkers: 'block',
            });
            contexts.add(context);
            const closeContext = context;
            await context.route('**/*', async (route) => {
              const request = route.request();
              if (
                !['image', 'font', 'stylesheet'].includes(request.resourceType()) ||
                !/^https?:\/\//i.test(request.url())
              ) {
                await route.abort();
                return;
              }
              try {
                const response = await optionsFetch(request.url(), { signal, maxBytes: 8 * 1024 * 1024 });
                await route.fulfill({
                  status: response.status,
                  body: Buffer.from(await response.arrayBuffer()),
                  contentType: response.headers.get('content-type') ?? 'application/octet-stream',
                });
              } catch {
                await route.abort().catch(() => {});
              }
            });
            const page = await context.newPage();
            let closed = false;
            const surface: RenderSurface = {
              async load(html) {
                signal.throwIfAborted();
                if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Error('面板 HTML 超过2MB');
                await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
                if (options.background)
                  await page.evaluate((color) => {
                    document.documentElement.style.backgroundColor = color;
                  }, options.background);
              },
              async evaluate(script) {
                signal.throwIfAborted();
                return page.evaluate(script);
              },
              async resize(width, height) {
                signal.throwIfAborted();
                await page.setViewportSize({ width: size(width, 2400), height: size(height, 10000) });
              },
              async screenshot() {
                signal.throwIfAborted();
                return page.screenshot({ type: 'png', animations: 'disabled', timeout: 15000 });
              },
              async close() {
                if (closed) return;
                closed = true;
                signal.removeEventListener('abort', abort);
                contexts.delete(closeContext);
                try {
                  await closePageContext(closeContext);
                } finally {
                  release();
                }
              },
            };
            const abort = () => {
              void surface.close().catch(() => {});
            };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) {
              await surface.close();
              signal.throwIfAborted();
            }
            return surface;
          } catch (error) {
            if (context) {
              contexts.delete(context);
              await closePageContext(context).catch(() => {});
            }
            release();
            throw error;
          }
        },
      });
      const optionsFetch = options.fetch ?? publicFetch;
      ctx.effect(async () => {
        await stopBrowser();
        await Promise.allSettled([...closing]);
        await Promise.allSettled([...contexts].map(closePageContext));
        contexts.clear();
      });
    },
  });
}
