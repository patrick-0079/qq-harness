import { app, BrowserWindow, dialog } from 'electron';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
let backend: ChildProcess | undefined;
let quitting = false;
const port = Number(process.env.HARNESS_PORT ?? 3310);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  await app.whenReady();
  backend = fork(
    path.join(root, 'dist/server/main.mjs'),
    [`--port=${port}`, ...(process.argv.includes('--live') ? ['--live'] : [])],
    {
      execPath: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      windowsHide: true,
    },
  );
  backend.on('exit', () => {
    if (!quitting) {
      void dialog.showMessageBox({ type: 'error', message: '后台服务已退出，请检查终端日志。' });
      app.quit();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('后台服务启动超时')), 10000);
      backend!.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('后台服务启动失败'));
      });
      backend!.on('message', (message) => {
        if (message && typeof message === 'object' && 'type' in message && message.type === 'ready') {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const window = new BrowserWindow({
      show: !process.argv.includes('--smoke'),
      width: 1440,
      height: 980,
      minWidth: 800,
      minHeight: 600,
      backgroundColor: '#f5f6f8',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => {
      if (new URL(target).origin !== `http://127.0.0.1:${port}`) event.preventDefault();
    });
    await window.loadURL(`http://127.0.0.1:${port}`);
    if (process.argv.includes('--smoke')) {
      console.log('Electron smoke: renderer loaded');
      setTimeout(() => app.quit(), 100);
    }
  } catch (error) {
    console.error(error);
    app.quit();
  }
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitting || !backend || backend.exitCode !== null) return;
    event.preventDefault();
    quitting = true;
    backend.once('exit', () => app.quit());
    if (backend.connected) backend.send('shutdown');
    else backend.kill('SIGTERM');
    const timer = setTimeout(() => {
      backend?.kill();
      app.quit();
    }, 5000);
    timer.unref();
  });
}
