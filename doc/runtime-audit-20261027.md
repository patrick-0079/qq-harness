# 技能、调度、存储与扩展仓库复核（2026-10-27）

本次核对源码、正式数据目录的结构与配置，并运行独立临时数据测试。没有读取聊天正文、调用真实模型或向 QQ 发送消息。此前“容器已实测”仅指原生容器工具，不代表技能脚本已接入容器。

以下为17:18审计时的历史状态。后续技能容器／取消链路、会话队列和安装工具已实现，当前进展见 [补齐记录](runtime-completion-20261027.md)，不能继续将本表的“未实现”作为最新结论。

## 1. skill 类型扩展

| 场景 | 当前结果 | 证据与限制 |
| --- | --- | --- |
| 加载 `type: skill`、脚本注册及参数 | 已测试 | `tests/extensions.test.ts` 的 calculator 临时包与七目录加载用例 |
| 没有容器执行 JS | 已测试 | 独立 Worker + VM，计算脚本实际返回结果；默认5秒、64MB，受 ext-skill 设置控制 |
| 不同应用实例隔离 | 已测试 | 两个注册表与脚本目录不串扰 |
| 容器后端失败 | mock 已测试 | 注入失败后端后返回 `backend: container` 错误，不在宿主偷偷重跑 |
| 本机 Podman 自动执行技能 | **未实现** | `registerContainerBackend` 有定义，但生产装配没有注册原生容器服务 |
| Python／Shell 等非 JS 技能 | **未实现** | `resolveScript` 在后端选择前拒绝非 JS，不能把有容器理解为支持其他语言 |
| 随运行取消立即终止 Worker | **未接通** | `host.runScript` 未传入当前 RunContext 的 AbortSignal；目前依靠脚本自身超时 |

调用链为 `extension-system.skill_script_run` → `ExtensionHost.runScript` → vendored `sandbox.runSkillScript`。默认调用链使用 Worker + VM；不能因为当前会话已经绑定容器就宣称脚本在容器里运行。`container_bash`、容器文件工具和后台任务使用另一条原生 container-session 链路。

Worker 只暴露脚本约定的 module/exports、args、argv、api，不提供 require、process 和 fetch。旧版 `skill.json` 技能与新 `type: skill` 脚本扩展也不能仅按目录名称视为同一执行协议。

后续需补齐公开容器后端适配、受控脚本与参数传递、运行取消和卸载清理，再分别进行无容器、有容器、容器失败、超时和权限边界的验收。当前不能标记技能容器能力完成。

## 2. 会话超时与调度队列

- 内核有全局并发限制、同 partition 串行、等待队列上限200、排队取消、执行超时及父子运行取消传播。不同会话可并行，同一会话的主运行串行。
- 正式 `launch.json` 并发为2；正式默认与7个会话快照的 `runTimeoutMs` 均为600000（10分钟），模型单请求配置为180000（3分钟）。这是正式配置快照，不是所有新建环境的 schema 默认值。
- 执行超时从获得执行槽位开始计时，0表示不限。内核支持独立 `maxWaitMs`，但 conversation 的提交尚未传入此参数，因此目前会话排队没有独立等待超时配置。
- 队列在内存中，重启不会恢复待执行任务。数据库运行档案用于查询，不能作为持久调度的证据。
- 容器后台任务有独立限额（全局16、单会话2）。重启后把未完成任务标成 interrupted，不续跑旧进程。
- 取消会使运行上下文失效并阻止后续受控副作用；不能据此声称全部外部代码立即退出，技能 Worker 的取消链路仍缺失。

主要实现：`packages/kernel/src/runs.ts`、`plugins/conversation/src/index.ts`、`plugins/container-jobs/src/index.ts`。当前主运行队列与容器后台任务是不同的调度层。

## 3. 数据库和文件各保存什么

正式 SQLite：`D:\QQAgent\qq-harness\var\production\harness.sqlite`，只读核对 schema version 3。当前只有本机 SQLite，没有外部数据库或独立向量数据库。

| 保存位置 | 业务数据 |
| --- | --- |
| SQLite `messages` | 规范化消息、已读状态、媒体引用及元数据 |
| SQLite `runs` | 运行档案、状态、用量和归档结果 |
| SQLite `memory*` | 兼容文本记忆、三层记录与修订、笔记与修订、整理游标、索引事件／检查点 |
| SQLite `plugin_state` | 扩展启停与配置状态、容器和后台任务元数据、发送尝试、记忆调度及草稿、托管状态等 |
| `config.json` / `launch.json` | 全局配置、渠道凭据、原生会话完整快照／正式启动及版本指针 |
| `run-details/*.json.gz` | 完整提示词、模型请求响应、工具等详细运行载荷，默认30天 |
| 其他文件 | 媒体、表情库、绘画历史与标签、扩展代码、QQ 用户目录等 |
| 内存 | 内核运行队列、可重建词面索引等 |

更完整的表和备份规则见 [存储说明](storage.md)。备份业务状态必须包含数据库一致备份、配置及关联文件，不能只复制 SQLite 主文件。

## 4. 扩展仓库为空的原因

此前在线 API 复核只有 `ext-tool`、`ext-mcp`、`ext-skill`、`ext-knowledge`、`ext-promptinject` 五个全局管理器。此次直接核对正式默认根 `D:\QQAgent\qq-harness\extensions-v2`，七个目录（plugins、chat-plugins、tools、mcp、skills、knowledge、promptinjects）中的包目录数量均为0。

因此这是**正式扩展安装／迁移尚未交付**，不是用户漏开工具或列表筛选错误。原生29个核心工具在“内置工具”入口，41个运行时插件也不是此仓库中的第三方扩展包。仓库空白不能用原生工具数量来解释为迁移完成。

此前93个旧包通过独立加载与基础启停检查，属于预览与兼容测试证据；它们没有安装到正式根，更不等于93个包已经完成业务行为、配置和数据迁移。101包还需按验收矩阵逐项完成适配、状态迁移和正式安装，停用包保留停用。禁止把预览目录直接指向正式实例或批量启用包来凑数量。

## 5. 本次验证与实例状态

2026-10-27 17:18 运行：

```powershell
npx vitest run tests/extensions.test.ts tests/operations-parity.test.ts tests/application.test.ts tests/containers.test.ts
```

结果：4个文件、27项测试通过。这是上述局部能力回归，不替代全量旧功能验收，也不包含真实 Podman 技能执行。

此次再次访问3310端口时连接被拒绝；PM2 查询时守护进程被重新拉起，应用列表为空，仅有 logrotate 模块。此前14:56在线记录是历史快照，不能作为当前在线证据。正式 release 指针仍为 `var/releases/2026-10-27T06-55-53.712Z-6b651f38`；本次审计没有切换版本或启动 QQ／SnowLuma。

后续用户明确要求用PM2恢复，已执行 `node manage.mjs start --all`，随后 `node manage.mjs save`。恢复验证：PID4108、online、重启计数0、首页HTTP200、41项插件无失败、OneBot已连接，QQ／SnowLuma均running。沿用原正式release。当前证据能确认恢复成功，不能据此判定此前PM2应用列表变空的原因。
