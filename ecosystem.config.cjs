const path = require('node:path');
const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'qq-harness',
      cwd: root,
      script: path.join(root, 'scripts/start-live.mjs'),
      interpreter: process.execPath,
      exec_mode: 'fork',
      instances: 1,
      autostart: true,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '1G',
      wait_ready: true,
      listen_timeout: 30000,
      shutdown_with_message: true,
      kill_timeout: 30000,
      windowsHide: true,
      vizion: false,
      out_file: path.join(root, 'var/logs/pm2-out.log'),
      error_file: path.join(root, 'var/logs/pm2-error.log'),
      merge_logs: true,
      time: true,
      // 令牌仅在应用内部从 launch.json 加载，不写入 PM2 配置和 dump。
      env: { NODE_ENV: 'production', HARNESS_PM2: '1' },
    },
  ],
};
