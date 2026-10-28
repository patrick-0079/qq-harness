# 服务管理与 PM2

统一入口是项目根目录的 `manage.mjs`。路径根据脚本位置解析，从其他目录也可使用绝对路径调用。要求 Node.js 24+ 和本机已安装的 PM2；默认读取 `var/production/launch.json`，管理令牌不出现在命令行或状态 JSON 中。

## 控制台管理令牌

2026-10-27 已按用户要求关闭当前本机控制台的管理令牌验证，访问 http://127.0.0.1:3310 无需填写令牌。

`var/production/launch.json` 中设置 `"token": ""`（或省略 token）表示关闭；非空令牌仍要求至少 32 个字符。执行 `node manage.mjs restart` 后生效，再用 `save` 保存 PM2 状态。关闭时会清空继承环境中的旧 HARNESS_TOKEN，管理脚本也不发送 Authorization 头。

这项设置只管理 Harness 控制台。OneBot HTTP/WS 的接入令牌和模型 API Key 仍按各服务要求使用；本地监听地址与 Host/Origin 检查保留。若浏览器仍显示旧提示，刷新页面即可。

## 常用操作

```powershell
cd D:\QQAgent\qq-harness
node manage.mjs status
node manage.mjs start
node manage.mjs restart
node manage.mjs stop
node manage.mjs logs -n 80
node manage.mjs logs -f
node manage.mjs status --json
```

也可以使用 `npm run manage -- status` 等形式。

| 命令                         | 行为                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| `setup`                      | 从正式配置注册并启动，HTTP 就绪后保存 PM2 清单；已有 online 实例不重复启动 |
| `setup --no-start`           | 仅登记停止的条目并保存；首次启动需用管理脚本清除注册阶段的 autostart=false |
| `start`                      | 启动后端并等待认证 HTTP 就绪；已经 online 时不重复启动                     |
| `start --all` / `up`         | 启动后端，等待 SnowLuma WebUI，再启动便携 QQ；已有外部运行时直接使用       |
| `restart [--all]`            | 正常停机后重新读取 ecosystem 和 launch.json；`--all` 恢复整套启动流程      |
| `stop`                       | 停止后端，插件回收自有 QQ/SnowLuma；外部实例保留                           |
| `status [--json]`            | PM2 状态、PID、重启次数、内存、HTTP、OneBot、插件/运行数量及运行时摘要     |
| `logs [-n N] [-f]`           | 查看/跟随两份 PM2 日志；隐藏已配置管理、模型和 OneBot 令牌                 |
| `qq start/stop/status`       | 通过认证 API 单独管理便携 QQ                                               |
| `snowluma start/stop/status` | 通过认证 API 单独管理 SnowLuma                                             |
| `doctor`                     | 上线前本地预检，要求目标实例尚未启动且端口空闲                             |
| `save`                       | 保存当前 PM2 清单及启停状态，用于之后 resurrect                            |
| `remove`                     | 从 PM2 移除本工程条目并保存，保留程序、配置和数据库                        |

`up` 不会替用户同意协议。首次使用前，在 SnowLuma 页面保存托管模式和协议同意，在 QQ 页面核对独立目录；QQ 登录在窗口内完成。组件启动失败时后端继续运行，可在页面修正后重试。程序就绪与真实收发验收分别完成。

## PM2 配置

`ecosystem.config.cjs` 定义一个 `qq-harness` 条目：单实例 fork、崩溃重启、3 秒重启间隔、10 次不稳定重启上限、1 GiB 内存重启阈值。bootstrap 在同一进程加载后端，PM2 直接监控实际内存和退出，避免监督脚本退出后遗留后端。

后端监听成功后发送 `ready`，PM2 最长等 30 秒。停止通过 IPC `shutdown`，插件清理、SQLite 关闭和实例锁释放完成后退出，停机等待为 30 秒。普通直接运行和 Electron 的原有就绪格式保留。

日志位于 `var/logs/pm2-out.log`、`var/logs/pm2-error.log`。密钥在应用内从本地文件加载，ecosystem 不存密钥。本机已有 pm2-logrotate 模块负责轮转。

PM2 不在常见安装目录时，可设置 `HARNESS_PM2_MODULE` 为绝对模块目录。管理脚本只操作名称、入口和 cwd 均匹配本工程的条目。启动会拒绝仍运行的旧 qq-agent/qq-agent-boot PM2 条目及外部目标端口占用；旧版若直接运行在其他端口，仍需按上线手册自行交接。

## 本机配置结果与上线

2026-10-27 已修复首次注册遗留的 autostart=false，正式后端为 **online**，HTTP 已就绪，并已验证原生 `pm2 restart qq-harness` 后仍正常在线，状态已保存。日志轮转正常。

首次部署可用 `node manage.mjs setup` 完成注册、启动和保存。仅准备时显式使用 `setup --no-start`，之后按以下步骤启动：

```powershell
node manage.mjs doctor
node manage.mjs start
# 核对 SnowLuma、登录 QQ，完成小范围验收
node manage.mjs status
node manage.mjs save
```

需要整套启动时使用 `node manage.mjs up`。停止后若希望重启电脑也保持停止，应执行 `stop` 后再 `save`。

`save` 不等于安装 Windows 开机任务。登录后恢复需要现有或另行设置的 `pm2 resurrect` 登录任务，并确保清单只包含期望恢复的状态；本轮未新建系统开机任务。真实上线按 [上线与回退手册](go-live.md) 完成。

## 验证

服务管理增加 9 项回归，覆盖幂等、归属判断、旧消费者/端口冲突、认证与脱敏、整套启动顺序、同进程启动及真实 demo 的 PM2 就绪与停机。完整测试为 91 项。

本机 PM2 集成验收另用假 HTTP 后端实际验证注册停止、保存、启动、重复启动、重启换 PID、正常停止和移除保存空清单；入口与正式 ESM bootstrap 相同。

2026-10-27 补充了原生按名称重启验收。PM2 的 autostart=false 会在 `pm2 restart 名称` 时继续保留；首次停止登记后需先执行 `node manage.mjs start`，或从 ecosystem 配置重新启动，以覆盖该值。管理脚本 status 会给出明确提示，普通 setup 现在默认正常注册启动，避免再次留下这个初始状态。

Windows PM2 的默认命名管道不随 PM2_HOME 改变。首次隔离验收因此短暂停止了原日志轮转，现已恢复；验收已改为进程内 daemon 和显式独立 RPC/PUB/交互管道，禁止调用 killDaemon。测试不能仅凭临时 PM2_HOME 宣称隔离。

2026-10-27：生产不再配置额外allowedChats。未设置时脚本清空PM2继承的旧HARNESS_ALLOWED_CHATS，准入由会话目录/配置管理。显式人工测试边界仍生效。Windows目录锁现在核对进程创建时间，防止旧PID被无关进程复用后错误阻止QQ启动。最新迁移和上线步骤见[升级说明](management-upgrade.md)。
