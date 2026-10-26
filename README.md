# QQ Harness

独立的 TypeScript 插件平台重构工程：**Cordis + Hono + React/Vite + SQLite**。

消息接入、模型、工具、发送、记忆、提醒、运行模式和控制台页面都由插件提供。新工程不导入旧 `createApp`/`Orchestrator`，不修改 SnowLuma，不接管现有部署。

## 启动

要求 **Node.js 24+**。当前验证环境为 Node 24.22.0；SQLite 使用 Node 自带的 `node:sqlite`，无需安装原生编译工具。

```powershell
cd D:\QQAgent\qq-harness
npm install --proxy=http://127.0.0.1:7897 --https-proxy=http://127.0.0.1:7897
npm run build
npm start
```

打开 [控制台](http://127.0.0.1:3310)。默认使用 mock 消息适配器与 mock 模型，**不会发送真实 QQ 消息，也不会产生模型费用**。会话页可以发送演示消息，执行真实的插件、模式、工具、队列与 SQLite 留档流程。

开发时运行 `npm run dev`：后端 3310，Vite 前端 5310，前端通过 proxy 访问后端。生产前后端分别构建，headless 后端可单独运行；发行版可由 Hono 同源提供前端静态产物。

```powershell
npm run typecheck
npm test
npm run check:architecture
npm run build
npm run test:e2e
```

浏览器测试在 Windows 优先使用已安装的 Edge，否则使用 Playwright Chromium。无浏览器时，通过代理执行 `npx playwright install chromium`。`HARNESS_BROWSER` 可显式设置 channel。

## 目录

| 目录                  | 职责                                                        |
| --------------------- | ----------------------------------------------------------- |
| `apps/server`         | 配置插件组合、实例锁、headless 入口                         |
| `apps/console`        | React 布局、路由出口、插件加载与 SSE 同步                   |
| `apps/desktop`        | 可选 Electron 壳，单独启动后端进程并通过 IPC 等待就绪、退出 |
| `packages/kernel`     | Cordis 薄适配、通用运行模式与扩展点执行器                   |
| `packages/plugin-sdk` | 无业务依赖的插件、服务、模式与 hook 类型                    |
| `packages/contracts`  | 浏览器可用的协议类型与 Zod schema                           |
| `packages/domain`     | 聊天领域服务契约，不含业务实现                              |
| `packages/client-sdk` | 客户端插件、页面与插槽注册、请求客户端、错误边界            |
| `plugins/`            | 各基础插件及官方客户端插件                                  |
| `extensions/`         | 安装后插件；独立 ESM，无需重编控制台                        |
| `tools/`              | 离线导入、SQLite 完整性检查与一致性备份                     |
| `tests/`              | 内核、消息链路、OneBot/模型协议、SQLite、客户端与浏览器验证 |

## 运行模式与扩展

目前有三种模式：

- `agent.basic`：每次唤醒新建 system + user，后续只追加本轮工具结果；通过工具发言并 finish。
- `command.direct`：确定性调用某个工具，不依赖模型。
- `reminder.deliver`：计划到期后直接提交出站任务，不经过聊天触发判断。

模式由插件注册。内核只处理排队、分区互斥、并发、取消、截止时间和诊断记录，不认识 QQ 或模型协议。

前端总览、会话、插件管理、设置都是客户端插件；执行轨迹子页和终止按钮由 `run-inspector` 另行贡献。在插件页关闭 `run-inspector` 后，这两个贡献会一起撤销。

`example-notes` 是后装插件示例，默认关闭。在插件页启用后，其独立服务端模块提供 `/api/notes`，独立客户端模块贡献「插件便笺」子页；停用会同时撤销 API 与 UI。代码来自 `extensions/`，不在 Vite 的内置插件入口里。

开发契约见 [插件开发](docs/plugins.md)、[实际架构与行为](docs/architecture.md)。

分层记忆由 `agent-memory` 插件提供，内容按需查询；会话记事本支持 Agent 增删查改和到期整理。见 [完整使用指南](docs/memory-guide.md)、[API 与工具](docs/memory-api.md)、[运行手册](docs/memory-operations.md)、[评测与训练数据](docs/memory-evaluation.md)。

## SQLite 与数据

默认数据目录为本工程的 **`var/local/`**，绝不自动读取 `source/data` 或 `source-v3/data`。

- `harness.sqlite`：消息、运行档案、分层记忆、暂存记事本和插件状态。WAL、FULL 同步、预编译语句、消息唯一键、索引事件、schema version。
- `config.json`：全局配置、会话完整配置快照、接入与模型密钥；配置 API 仅回传密钥存在标记。
- `harness.lock`：运行入口的实例锁，阻止同一数据目录双写。

通过 `HARNESS_DATA_DIR` 可以指定另一个**绝对目录**；不要在生产服务运行时把此变量指向真实旧数据目录。SQLite 不是加密保险箱，数据库内的聊天与插件状态仍属于敏感数据。

详细表结构、备份与旧格式导入见 [SQLite 运维](docs/storage.md)。保留 `storage-file` 作为接口可替换的开发实现，默认 profile 使用 `storage-sqlite`。

## 连接真实 OneBot / 模型

先在演示实例「设置」中填写管理员的模型 Base URL、模型名、API Key 与准入名单，再退出实例。OneBot URL/令牌通过配置 API 或离线编辑**本工程** `var/local/config.json` 提供，随后运行：

```powershell
node dist/server/main.mjs --live
```

`--live` 才会选择 OneBot 和 OpenAI 兼容插件。它连接已经运行的 OneBot HTTP/WS，不启动或改写 SnowLuma。不要让旧机器人与新实例同时消费同一账号事件，否则可能重复回复。

可选环境变量：`HARNESS_PORT`（默认 3310）、`HARNESS_DATA_DIR`、`HARNESS_TOKEN`。设置管理令牌后，浏览器在连接提示处录入；令牌仅放在当前浏览器 sessionStorage，请求和 SSE fetch 都使用 Authorization 头。

人工联调可以设置 `HARNESS_ALLOWED_CHATS='group:10001,private:10002'`（示例 ID，请替换为获许可的会话），作为本次进程不可由配置 API 扩大的会话范围；配置中的准入、黑名单仍然生效。空字符串表示全部拒绝，不设置则不额外限定。OneBot HTTP 和 WebSocket 令牌可分别使用 `onebot.httpAccessToken` 与 `onebot.accessToken`。

## Electron

`npm run build` 也生成 `dist/desktop/main.mjs`，随后可用 `npm run desktop` 启动。Electron renderer 禁用 Node，桌面壳通过 IPC 管理独立后端进程，不导入业务实现。

当前机器的 Electron 二进制连 `--version` 都退出 1；因此桌面入口目前只通过 TypeScript 与打包验证，**未通过桌面运行验收**。浏览器版与 headless 版已通过实际运行测试。

## 重构边界

当前交付支持独立运行平台、SQLite、后装双端插件、记忆与提醒，并已迁入 v2 七目录扩展框架、五个基础管理器、MCP HTTP/stdio、技能降级沙箱、知识库与上下文注入。浏览器「扩展仓库」提供导入与管理，会话页提供独立扩展设置。默认安装根是 `extensions-v2/`。

迁移采用独立 TypeScript 宿主加原算法兼容层；不依赖旧检出。直接修改旧单体原型或导入旧内部模块的社区扩展仍需单独适配，旧市场、容器运维、完整媒体预处理及主动话题等业务流程尚未全部迁移。详见 [v2 扩展迁移](docs/extension-system-v2.md) 和 [实现状态](docs/status.md)。

SnowLuma 现在可以作为独立插件管理，在「SnowLuma」页面配置；默认只读、不自动启动真实程序。托管启动需 live 配置、独立安装目录及用户明确同意协议，第三方本体保持原样。见 [SnowLuma 插件](docs/snowluma-plugin.md)。对照旧工程仍缺哪些功能，见 [重构差异审计](docs/migration-gap-audit.md)。

## 容器操作

已提供四个独立 Cordis 插件，让 Agent 操作当前会话绑定的 Docker/Podman 容器，包括命令执行、文本文件读写与搜索、后台任务查询和取消，管理页面由前端插件提供。普通 demo 默认不操作容器；使用 `node dist/server/main.mjs --demo --containers` 可在 mock QQ/模型配置中启用，再在「容器」页面保存设置并创建会话绑定。Podman 已实测，Docker 尚只有 mock 验证。详见 [容器使用与验收](docs/containers.md)。
