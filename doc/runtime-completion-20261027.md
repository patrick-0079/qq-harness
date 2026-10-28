# 技能执行、队列与扩展迁移补齐记录

本记录接续 [17:18运行审计](runtime-audit-20261027.md)。原审计发现的问题及当时离线快照保留，以下描述后续实现，不能把目录迁移等同于全部旧包业务验收。

## 技能后端

`skill_script_run` 已连接公开的 `container-session` 服务。会话有可用绑定时使用容器；功能关闭、未绑定或服务停用时，JS 使用独立 Worker+VM，并返回 `backend: sandbox` 和降级原因。Python／Shell 在无容器时明确报错。容器已经开始执行后失败，不回退宿主重跑。

Node 和 Python 的源码、参数通过 stdin JSON 传入，不挂载宿主目录。Shell 使用 argv 和 `HARNESS_SKILL_ARGS`，参数不拼接到脚本。容器里仍需对应解释器；解释器缺失会报告错误。JS 约定 `module.exports = ({args,argv,api}) => ({content})`；Python 可设置 `result` 或定义 `main(args, argv)`；Shell 的 stdout 为结果。

脚本接收当前运行、扩展宿主和自身实例的取消信号。取消运行、停用技能／管理器、重载、卸载和准入撤销都会终止受控执行。容器取消使用既有所有权检查并停止会话容器，防止 CLI 退出后远端计算仍在继续。工具结果同时包含 backend、ok、isError、content、logs 和耗时。

旧 vendor 文件保持 SHA 原文，AbortSignal 与语言分派适配在 `scripts/adapt-skill-sandbox.mjs`；公开容器适配在 `packages/extension-compat/src/skill-container.ts`。

### 本机真实验收

本机原 `ubuntu:26.10` 不含 Node/Python。使用它构建 `localhost/qq-harness-skills:26.10`，源码见 `containers/skills/Containerfile`：

```powershell
podman build --pull=never --network=host -t localhost/qq-harness-skills:26.10 -f containers/skills/Containerfile containers/skills
node --import tsx tools/accept-skill-container.ts --real
```

独立数据 `var/skill-acceptance-1793094395737/acceptance.json` 记录通过：JS无容器降级、容器内JS／Python／Shell、中文及字面参数、取消后远端停止、再次执行自动启动。测试容器使用独立数据所有权及测试会话，完成后已删除；QQ、网络和模型均为mock。Docker仅完成mock回归，不标记真实验收。

## 会话队列

新增 `queueTimeoutMs`（默认120000，0不限），位于会话设置的“聊天策略”；进入执行后使用独立 `runTimeoutMs`。配置具有完整会话快照语义，并纳入聊天分区恢复默认。正式已有10分钟执行超时与3分钟模型请求超时分别保留。

会话主运行的意图与状态保存在 SQLite `plugin_state` 的 `conversation-queue/jobs`。正常停机保留尚未执行的任务；重启恢复时保留原排队截止时间，只处理原消息ID，重新检查暂停、上下线和准入。已经开始执行的任务标记 interrupted，不自动重放；这能避免发送成功但进程尚未来得及收尾时重复发送。主动唤醒和容器后台任务仍使用各自的生命周期，不冒充可重放会话任务。

`GET /api/conversation/queue` 返回准入范围内的队列记录；运行记录页显示最近取消与中断原因，完成记录限制保留100条。内核调度仍为同会话串行、不同会话受全局并发控制，队列上限200。持久化属于业务插件，内核没有数据库依赖。

## 扩展安装与状态迁移

新增 `tools/install-extension-migration.ts`，读取预览生成的代码、完整清单与期望状态。迁移保留已有新版设置和同名数据，不覆盖QQ路径、渠道、主题、人设或三层记忆。旧扩展配置与原生会话配置分开保存。

最新独立副本演练 `var/extension-rehearsal-1793098754486`：101包清单，98包生成实际入口；image-studio、cross-memory、cross-group-memory由原生图片工坊与三层记忆替代。保留7个会话的50处开启设置，迁移15个私有数据文件。组合启动98包无加载失败，mock守卫无越界操作。重复执行无变化，回滚恢复旧状态且删除本次新增数据；已有资源修改后回滚会拒绝覆盖。

安装器现在将可执行包放进各自的扫描目录，使用 `installed` 状态，不再只导入目录名称。关闭的包延迟执行 setup，避免停用包在启动时创建进程或定时器；重新启用后加载真实入口。管理器的“工具”页同时列出插件／技能注册的工具，提供用途、来源、有效状态、参数说明和 React 调用详情抽屉。原生内置工具仍有独立设置入口。

旧发送队列包装适配为公开 `tool.prepare` 转换，表情上限接同步策略；两者仍由 outbound 实际发送。self-surf 接公开网页、当前会话存储及目标运行，后台操作必须有明确目标。net-proxy 改用每次请求所属应用的 HTTP／HTTPS Agent，不修改全局代理；支持目标固定IP、Host／SNI、跳转校验、取消和连接前回退。代理要求支持 `proxyEnv` 的Node版本，见 [Node 24 HTTP文档](https://nodejs.org/docs/latest-v24.x/api/http.html)。

long-memory 的6个旧工具接入统一记忆服务：新增写入短期，更新生成更正草稿，删除立即停止检索，保持会话隔离与修订冲突检查；不再创建第二个记忆SQLite。旧跨会话记忆包由原生可见性及三阶段整理替代，防止绕过新规则。

**尚未完成全部旧包行为对齐。** 全部包有加载／生命周期证据，21包另有局部业务工作流；这不能替代全部定时、协议、跨会话与UI分支验收。具体缺口保留在[逐项矩阵](parity-matrix.md)，正式代码与状态切换结果见[当前状态](status.md)。

```powershell
# 默认预览；应用需先停止对应实例并备份。
node --import tsx tools/install-extension-migration.ts --preview=<预览目录> --data-dir=<数据目录> --extensions=<扩展根>
node --import tsx tools/install-extension-migration.ts --preview=<预览目录> --data-dir=<数据目录> --extensions=<扩展根> --apply --offline
node --import tsx tools/install-extension-migration.ts --data-dir=<数据目录> --restore=<返回的备份目录> --offline
```

代码根放在 `var/extension-releases`，`launch.json` 的 `extensionDirectory` 与后端 `releaseDirectory` 一次原子切换；应用前校验目录所有权、符号链接和代码SHA。扩展迁移状态按预览指纹保存在正式数据库，支持预备代码后离线应用数据；已有新版设置和私有数据优先。

回滚必须先停止实例，同时恢复代码／扩展目录指针与扩展数据。仅删除清单不能停用扫描目录里的代码。若迁移后扩展设置或导入文件已发生变化，工具拒绝覆盖。代码副本保留供诊断，已回滚目录重新应用使用新的独立扩展根。命令见[上线和回滚](release-operations.md)，数据库及其他文件职责见[存储说明](storage.md)。

## 验证

专项覆盖技能后端与取消、队列恢复、迁移／幂等／回滚、懒加载、发送与表情转换、网页代理、原生记忆桥接以及代码和扩展目录同时回滚。自动化mock QQ、SnowLuma、网络与模型；本轮容器真实测试使用独立数据，不发送聊天消息。

首次上线曾因README及子目录隐藏.gitkeep保护检查被拦截，均回退并恢复服务；目标目录检查已前移到只读预览，允许并保留说明／占位文件并补回归。管理器的托管启动请求等待45秒，修正QQ实际上已启动却被4秒请求超时报失败的问题。最终整体验收、正式版本及运行状态见 `status.md`。

### 组合上线发现的性能问题

19:10尝试切换98包时，已打开的页面持续轮询 UI 贡献，触发完整扩展目录及设置反复生成，管理HTTP超时。切换工具已恢复旧版本和扩展状态；旧占位清单也暂存为 `extensions-v2/installed-catalog.before-runtime-fix.json`，恢复PM2和协议连接。故障版本不标记上线成功。

CPU采样确认耗时集中在配置克隆／合并。修复后 UI 贡献只检查该页面实际贡献者；目录状态复用同步操作内的配置快照，同一次操作只合并每个会话一次，不跨await缓存，并在写入时失效。避免对已枚举包再执行一次完整状态计算。工具目录也使用同一批次读取。

增加100项目录与合成大配置的回归，验证配置读取次数有界、会话隔离、修改立即生效、无UI贡献时不生成全部目录。98包组合演练再次通过：UI贡献1–6ms、目录11ms、工具目录13ms、健康检查0ms，全部HTTP200（仅为本机该次测量，不是性能保证）。演练使用mock与合成配置，没有读取正式聊天或凭据。
