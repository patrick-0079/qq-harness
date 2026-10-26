# SnowLuma 运行时插件

`plugins/snowluma-runtime` 是独立 Cordis 插件，客户端页面也由插件注册。它通过子进程管理未修改的第三方 SnowLuma，消息收发仍由 `adapter-onebot` 插件完成；内核不依赖 SnowLuma、QQ 或 OneBot。

## 已实现

- 外部模式默认开启，只读检测安装目录、`config/runtime.json` 的 WebUI 地址与 hookAutoLoad；不修改第三方文件。
- 托管模式显式启动 `index.mjs`，优先包内 Node，也可配置 Node 的绝对路径；不调用 launcher.bat、不弹系统控制台。
- 启动互斥、安装目录进程锁、WebUI/OneBot 端口冲突检查，避免重复运行。
- 区分“自有进程”“外部端口”“WebUI 就绪”“OneBot 已连接”。端口探测不代表已验证服务身份或账号登录完成。
- 有界且脱敏的 stdout/stderr 日志，HTTP 状态/日志接口及 SSE 变更通知。
- 停止/卸载回收自己启动的进程树、路由和页面，不枚举或终止外部 SnowLuma/QQ 进程。
- 插件设置存入独立 SQLite 状态，不污染旧部署。手工设置 OneBot URL/令牌时使用原有配置服务，API 不回传明文令牌。

默认 `mode=external`、`autoStart=false`、两个协议同意开关均为 false、目录为空。demo 启动配置禁用真实进程启动；启用插件不会自动下载 SnowLuma 或启动 QQ。

## 使用

1. 自行准备独立的 SnowLuma 安装目录，避免与旧机器人共享运行实例。保持第三方程序原样。
2. 在「SnowLuma」页面填写包含 index.mjs 的绝对目录。在 SnowLuma 自己的配置界面设置 WebUI、OneBot 和自动注入，Harness 只读取这些状态。
3. 若使用已经运行的实例，保持外部模式，并通过配置 API 填写匹配的 OneBot HTTP/WS URL 与访问令牌。`onebot.accessToken` 用于 WebSocket；`onebot.httpAccessToken` 用于 HTTP，留空时回退到 accessToken。配置 API 不回传这两个明文值。
4. 若由插件托管，阅读安装版本的 EULA/隐私政策后由用户分别勾选同意并保存，选择托管模式，再用 `node dist/server/main.mjs --live` 启动 Harness。live 模式下也默认不自动拉起，只有显式启动或已保存 autoStart=true 才启动。
5. 在 QQ/SnowLuma 中完成登录。WebUI 端口就绪与账号登录、OneBot 连接是不同状态。

不要同时让新旧机器人消费同一账号事件。新插件拒绝在所探测的 WebUI 或 OneBot 端口已有服务时另起一个托管实例；外部实例停止由其原启动器负责。

设置字段：directory、nodePath、mode、autoStart、acceptEula、acceptPrivacy。EULA/隐私同意只通过明确保存的字段转换为子进程 `SNOWLUMA_ACCEPT_EULA=1` 和 `SNOWLUMA_ACCEPT_PRIVACY=1`；不能因父进程恰好带这些环境变量而绕过用户选择。

## 尚未包括

SnowLuma 安装/升级/哈希校验下载器、便携 QQ 安装与进程管理、账号登录代理、自动读取账号令牌/401 轮换、独立 HTTP 令牌的界面输入框、修改 hookAutoLoad、Electron 嵌入式窗口、第三方 WebUI 内嵌及远程实例托管。外部 WebUI 以浏览器链接打开。

自动化测试只运行临时目录中的仿真 Node 服务，覆盖 EULA 门禁、demo 限制、并发启动、日志脱敏、设置持久化、外部实例保护、中途停止、插件卸载及安装目录锁。用户授权后另行完成了本机真实 SnowLuma 托管启动、QQ 登录后的 OneBot 连接与指定会话文本收发，见 [联调记录](real-qq-test-20261026.md)；其他发行包与安装环境仍需单独验收。
