# 会话、调度与管理界面更新（2026-10-27）

本批只修改 `qq-harness`。旧工程仅作为读取和迁移来源。完整旧功能对齐的剩余项仍以 [状态](status.md) 和 [逐项矩阵](parity-matrix.md) 为准；98 个包加载成功不等于其全部业务分支已经验收。

## 本批交付与入口

| 需求 | 实现与入口 | 验证 |
| --- | --- | --- |
| 模型识别本轮触发消息 | conversation 保存真正命中触发条件的消息 ID，Agent 标注源 ID 与正文；上下文扩展重建消息后再次注入定位 | @、拍一拍、关键词、上下文替换回归 |
| 会话容器只能选择 | 会话→设置→容器：选择、解绑已有容器；没有创建按钮 | 浏览器断言没有创建请求；Podman 解绑／重新分配保留文件 |
| 按会话类型显示概率 | 私聊仅显示私聊概率；群聊显示 @／拍一拍、关键词、普通消息、活跃期和峰谷 | 控件可见性、保存、主策略启用回归 |
| 主动话题插件 | 会话→设置→主动话题：冷场 x 秒、每 y 秒、成功概率%；可独立停用 | 可控时钟、失败重试、新消息重置、重启补一次、停用取消 |
| 手动触发插件 | 会话标题“手动触发”，设置中可填写本轮说明；可独立停用 | 忽略概率，保留准入／暂停／下线，停用取消并撤销路由 |
| 数组发送后立即结束 | send_message 增加可选布尔 stop | 逐项发送后停止，同响应后续工具与 finish 不执行 |
| QQ 工具和插件工具分开 | “内置工具”仅列 QQ 核心；扩展仓库→工具列出网页、工坊、节日、容器等 | 统一目录的分类、参数、开关、原因与执行 |
| QQ 图标统一 | 用户提供的企鹅轮廓，颜色继承 currentColor | 亮暗主题截图 |
| 设置分组和容器子菜单 | 设置→运行与调度／模型接入／会话准入／联网搜索／容器；容器由插件注册 | 导航回归，旧 /containers 重定向 |
| 自动识别导入类型 | ZIP 清单 type 决定目录，预览名称、类型、目标、冲突，原始清单可展开 | 七种合法声明、缺失拒绝、导入界面 |
| 集中人设和提示词维护 | 一级“提示词管理”；默认人设只读；会话仅选择和 Markdown 预览 | 目录新增、会话预览、API 拒绝修改默认 |
| 统一控件与主题 | client-sdk 提供 Ant Design 按钮、Switch、Checkbox、主题容器；页面采用紧凑样式 | 三主题、刷新、未保存保护，无原生业务弹窗 |
| 运行记录左右分栏 | 左侧运行列表，右侧时间线／模型上下文／工具调用／原始数据，展示并复制 ID | mock 运行详情和复制 ID |
| 一级菜单折叠 | 收起为图标，保存在浏览器 qqh-nav-collapsed | 收起／展开／刷新和文字溢出检查 |
| 最新未读 | 存档最新在前，“仅未读”“回到最新”，第一页自动刷新 | 未读筛选、最新消息浏览器验证 |
| 记忆可观测 | 有效条目、草稿、整理状态、增删改查，最近六次 diff | 按同记录修订或明确派生边对比，跨记录 r1 不倒序 |
| 并发和超时 | 设置→运行与调度：并发池、队列容量、默认排队／执行超时、模型超时、轮数 | 实际调整容量，降低时不强杀在途任务 |

使用 [Ant Design](https://ant.design/docs/react/introduce/) 组件及 [ConfigProvider](https://ant.design/components/config-provider/) 主题算法。页面仍由插件贡献，shell 只处理通用父子导航。

## 10003 普通消息未回复

只读核对入站触发原因，未输出正文或密钥。普通消息概率为 30%，但 `behavior.enabled=false`，旧触发档为 `mention`，因此仍走“仅 @”，概率没有参与判定。

已备份 `var/production/backups/trigger-policy-10003-1793102053419/config.json`，仅启用此会话完整策略，保留普通消息 30% 和其他设置。30% 不保证每条普通消息回复。新表单编辑概率、关键词、峰谷或活跃期时同步启用策略；主开关仍可明确关闭。活跃期独立概率为 0–100%，默认 100%；@／拍一拍和命中关键词先走各自规则。本次没有向该群发送测试消息。

后续上线前的正式值已为普通消息10%，本次部署保留该现值，未重置为诊断时的30%。上线后核对最近150条入站：普通消息112条中10条命中，活跃期13条均命中，@4条命中，其余21条为早期legacy策略。这里只代表入站判定，不把命中数误称为成功发送数。

## 运行语义与公共契约

### 主动话题和手动触发

`idleSeconds`、`checkEverySeconds` 以秒保存，界面为百分数，契约 probability 为 0–1。旧 idleThresholdMs／checkIntervalMinMs 仅在新字段缺少时转换；旧随机上限字段保留供兼容读取，新插件采用固定 y 秒。计时基准为最近入站或出站消息；无任何消息时不凭空触发。到 x 秒首次判断，失败后等 y 秒，新消息重置。持久化 nextAt，重启不连续补跑多次。繁忙或未就绪时记录原因，下个间隔再判断。主动运行读取最近未读作为参考，不把积压消息标已读或作为本轮触发消息。

`POST /api/conversation/manual` 接收 `{chatKey,text?}`，返回 202 与 `{id}`。不检查触发条件、概率、指令禁言，仍保留启动边界、准入、黑名单、暂停、下线和会话互斥；说明最长 20000 字。两插件发起的任务均绑定各自 AbortSignal，停用后取消等待中的模型请求。

finish.activeTopic 的硬截止与不自动续期规则保持。主动话题负责冷场唤醒，活跃期控制后续普通消息的概率。

### send_message

```json
{"messages":["第一条","第二条"],"stop":true}
```

messages 仍只接受非空字符串数组。stop 仅接受布尔值，默认 false；true 在完成本次数组的逐项发送后结束循环，包括同响应剩余工具和 finish。逐项成功／失败照常留档；仅真实成功出站计为 spoken，失败或去重不伪造成功，不按换行拆正文。

### 并发和超时

`config.execution.concurrency` 1–64、queueLimit 1–10000，默认 2／200。旧文件缺少 execution 时保留启动并发值。保存后调用内核通用配置接口，提高容量可启动排队项，降低不强杀在途任务；同一会话仍串行。

全局超时是新会话默认，已有会话保持独立快照，可在会话设置调整。排队等待与开始执行后截止分别计时，0 表示不限，模型单请求超时另行限制。

### 容器库存

| API | 作用 |
| --- | --- |
| POST /api/containers/inventory，{chatKey} | 全局配置创建本工程容器 |
| POST /api/containers/bindings，{chatKey,containerId} | 选择已有且未被其他会话占用的容器 |
| DELETE /api/containers/bindings/:chatKey | 解绑并保留内部文件 |
| DELETE /api/containers/inventory/:containerId | 全局删除容器及文件 |

绑定／解绑串行，繁忙和等待中的容器不能重新分配；其他会话占用项禁用。原始 owner/chat 标签继续校验，不接管任意宿主容器。重新分配会保留文件，界面提醒对新会话可见，管理员决定是否清空重建。

### 类型和 API 版本

导入清单必须声明 plugin、chat-plugin、skill、tool、mcp、knowledge 或 promptinject。chat-plugin 归一为 plugin + scope:session。按声明自动选择目录，非法输入返回可读错误。

旧包迁移增加 `harnessMigration.runtimeApi=legacy-v1`：type 用于分类，API 标记保留编译后原入口的宿主契约。旧插件不会因多了 type 就换 API，旧技能工具入口不会被跳过。新脚本技能仍走脚本声明和容器／Worker。vendor 原文未改，转换在构建适配层完成。

## 验证证据

最终构建 `var/builds/acceptance-1793106791820`：256 项单元／集成（53 文件）、22 项浏览器、103 项旧兼容层断言通过，类型／构建／架构／48 项原生及示例依赖检查通过。日志在同名 `var/verification` 目录。

关键回归：tests/management-console.test.ts、tests/capsule-migration.test.ts、tests/containers.test.ts、tests/e2e/upgrade-admin.spec.ts。原 management-upgrade 五项迁移测试已保留，适配当前必填确认时间及明确修订历史查询。自动化全部使用隔离数据，mock QQ、SnowLuma、模型和网络。

98 包组合演练 `var/extension-rehearsal-1793106758294/runtime-rehearsal.json`：98／98 加载、0 加载失败、0 原生失败、0 被阻止操作；合成大配置下列表与详情接口均返回 200。保留 7 会话 50 处开启值，101 项中另 3 项由原生实现替代。这些不代表所有旧包的业务分支已完成验证。

真实 Podman 证据 `var/skill-acceptance-1793105002451/acceptance.json`，镜像 localhost/qq-harness-skills:26.10：无容器 JS 降级、解绑重分配、中文文件、容器 JS／Python／Shell、取消、重启和归属检查通过，独立容器已清理。Docker 为 mock。

上线工具和回滚见 [release-operations](release-operations.md)。正式版本、备份和服务状态在发布完成后记于本文末尾。

## 界面截图（合成数据）

运行详情（人工截图仅保存在本机）

人设预览（人工截图仅保存在本机）

主动话题（人工截图仅保存在本机）

记忆变化（人工截图仅保存在本机）

暗色主题（人工截图仅保存在本机）

## 正式发布与回滚

21:18完成切换，21:22确认服务就绪。固定版本 `var/releases/2026-10-27T13-18-32.276Z-b04bfa0f`，扩展根 `var/extension-releases/legacy-1793106758294`。PM2 PID18488、online、重启0并已save；43项原生运行时插件0失败；OneBot connected，QQ PID24452、内部托管SnowLuma PID18724均running。管理令牌仍关闭。

四个正式页面只读浏览器检查无pageerror，群策略控件显示启用、普通消息10%；运行池2、队列容量200。工具目录90项：QQ核心17、插件工具73。扩展106项：插件74、技能32。Podman和技能镜像可用。原7会话50处扩展开启设置与停机前SQLite快照完全相同；本次没有重复导入或覆盖私有文件（新增0）。

发布记录 `var/admin-deployment-1793106791820.json`，正式检查 `var/admin-production-check.json`。独立回滚验证 `var/admin-rollback-verification.json`：预览无写入、重复应用无变化、恢复原设置并移除15个副本导入文件；未操作生产数据。

- 完整停机快照：`var/backups/capabilities-2026-10-27T13-18-29.215Z`，619文件。
- 后端／扩展指针备份：`var/production/backups/release-ddc7a927-e721-47db-9f51-68e0409f874d`。
- 扩展设置备份：`var/production/backups/extensions-344e4a44-6d60-48b8-bc73-0a77fd7cd777`。

需要回退本批时，在项目根目录执行：

```powershell
node manage.mjs stop
node --import tsx tools/promote-release.ts --restore="D:\QQAgent\qq-harness\var\production\backups\release-ddc7a927-e721-47db-9f51-68e0409f874d" --apply --offline
node --import tsx tools/install-extension-migration.ts --data-dir="D:\QQAgent\qq-harness\var\production" --restore="D:\QQAgent\qq-harness\var\production\backups\extensions-344e4a44-6d60-48b8-bc73-0a77fd7cd777" --offline
node manage.mjs start --all
node manage.mjs status
node manage.mjs save
```

先恢复代码指针，再恢复扩展设置，保持后端停机直至两步完成。工具会拒绝覆盖上线后变化的设置或文件，应按差异处理，不能强行丢弃新数据。一般操作流程见[发布工具](release-operations.md)。
