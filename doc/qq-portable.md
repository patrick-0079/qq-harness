# 便携 QQ 准备与管理

`qq-portable` 是独立 Cordis 插件，依赖 `harness.storage`、`harness.http`，提供 `harness.qq-portable` 服务和 `/qq-portable` 页面。消息接入仍由 adapter-onebot 处理，SnowLuma 托管仍由 snowluma-runtime 处理；三者独立启停。

## 本机准备结果

2026-10-27 实际启动验收更新：当前插件复用旧版可用安装 `D:\QQAgent\backup\source\runtime\qq-portable`，继续传入新项目独立数据目录。QQ、内部托管 SnowLuma 和 OneBot 连接均已恢复。下述新复制副本只有文件校验通过，真实启动仍出现原生退出，尚不能作为上线安装。详见 [启动恢复记录](runtime-recovery-20261027.md)。

已从本机已有安装只读复制 QQ **9.9.36-53644** 到 `runtime/qq-portable/`，共 **1,960 个文件、1,230,856,706 字节**。来源 QQ.exe 的 Authenticode 验证为 Valid，签名者为腾讯。逐文件 SHA-256 清单为 `runtime/qq-portable/portable-manifest.json`；目标副本与源程序字节一致。

以上数量为最初复制时的记录；后续已补齐 setting.json 和安装元数据。复制工具会保留这些程序文件，运行管理只执行 QQ.exe，不执行卸载器。

用户数据目录为 `var/qq-portable-data/`，初始为空。未复制旧账号登录状态、聊天记录、Tencent Files、旧版本、日志和更新包。`runtime/` 与 `var/` 均被 Git 忽略。第三方程序仅在本机使用，没有上传或再分发。

```powershell
npm run portable:check
# 另一台机器首次准备时显式指定已有 QQ 的绝对安装目录：
npm run portable:prepare -- --from D:\YourQQ
```

准备脚本拒绝覆盖已存在目录、拒绝目录重叠与符号链接，复制完成后验证所有文件再提交目标目录；失败的 `.preparing-*` 目录保留供排查。程序升级后需要重新准备清单，不能把旧哈希校验结果当成新版本验收。

## 管理边界

- 默认不自动启动。只有 Windows live 模式可以显式启动；demo/浏览器自动化测试不启动真实 QQ。
- 启动参数固定为 `QQ.exe --user-data-dir=独立绝对目录`，不经过 shell。QQ 登录需要用户在窗口交互。
- 同时锁定程序目录和数据目录，阻止多个 Harness 共用一个实例或 profile。进程查询失败时拒绝新启动。
- 外部进程按目录边界识别，类似 `qq-portable-other` 不会被误认；外部实例不会被停止或接管。
- 停止、卸载和宿主正常退出只回收当前持有的 ChildProcess 及其子树，不按 `QQ.exe` 进程名批量关闭。
- 不采集 QQ stdout/stderr，避免登录与账号信息进入日志 API。程序运行、账号登录、SnowLuma WebUI、OneBot 连接是不同状态。
- `--user-data-dir` 用于应用数据分离，不是 OS 安全沙箱；第三方 QQ 是否另外写入用户目录，仍需登录后实际验收。首次启动前应退出旧便携实例，避免第三方单实例机制接管。

API：`GET /api/qq-portable/status`、`GET/PATCH /api/qq-portable/settings`、`POST /api/qq-portable/launch`、`POST /api/qq-portable/stop`。设置只有 directory、dataDirectory，存于新实例 SQLite。

## 验证

测试使用临时假 QQ 文件及 Node 假进程，覆盖 demo 门禁、外部实例保护、并发启动、取消、卸载、双目录锁、启动失败恢复、数据目录重叠、程序完整性、复制筛选和哈希篡改。浏览器用例验证页面保存与插件装卸。真实 QQ 登录与实际注入留在 [上线步骤](go-live.md) 完成。
