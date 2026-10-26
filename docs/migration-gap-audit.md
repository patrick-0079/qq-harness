# 重构差异审计（2026-10-26）

结论：目前完成的是插件平台、基础聊天闭环和 v2 扩展框架；还不能作为旧部署的完整功能替代。SnowLuma 已可以通过独立插件封装，但账号、模型、多模态、完整上下文和运维流程仍有明显缺口。

本次直接比对 `source-v2` 当前源码与 `qq-harness`，不采用根目录旧快照中的数量，不读取真实 data、SnowLuma 账号配置或明文 Key。机器清单见 [migration-inventory.json](migration-inventory.json)，可用 `node scripts/audit-migration.mjs D:\QQAgent\source-v2` 更新。

## 数量口径

| 检查项                      | 旧工程 |            新工程 | 含义                                                              |
| --------------------------- | -----: | ----------------: | ----------------------------------------------------------------- |
| 核心工具静态声明            |     31 | 10 个原生具名工具 | 其中 9 个同名；还需检查参数、返回值和实际流程，不能按名字认定等价 |
| API 静态声明                |    123 |                55 | 新工程含新 URL 和通配路由，数量不能换算迁移完成比例               |
| 旧扩展目录                  |     66 |      未复制社区包 | 包含当前磁盘目录及五个内置管理器，不是许可确认后的发行清单        |
| 直接引用旧 src 内部模块的包 |     29 |      需要逐包检查 | 包含五个已通过桥接迁入的管理器；其他包不能承诺零修改兼容          |

例如，旧 `send_message` 接受 messages 数组，新基础工具接受 text；旧 finish 使用 silentReason 和 activeTopic，新 finish 使用 reason 且没有活跃期协议。同名不代表工具协议一致。旧提醒的部分能力被新 reminder_add 替代，名称不同也不代表完全没有该能力。

## 优先补齐的功能

| 优先级 / 能力       | 当前已有                                                                                                                                        | 尚未重构或尚不等价                                                                                                                                          | 建议插件边界                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| P0：触发与活跃模式  | @、私聊、普通关键词、全响应、聚批、并发排队与取消                                                                                               | 私聊/@或拍一拍/关键词/其他四类概率、每条规则概率、正则/排除规则、活跃窗口及到期关闭、主动话题与主动机会；概率未中保持未读等旧语义                           | trigger-policy、active-mode、proactive                                  |
| P0：上下文组装      | 本轮未读触发消息与会话记忆字符串                                                                                                                | 已读滑窗、分级上下文、稳定锚点与前缀缓存、群成员与个人印象、引用/回复/@ 展开、媒体附件装配；当前非触发消息不会按旧方案进入已读上下文                        | context-builder、context-anchor、member-memory                          |
| P0：模型与协议      | 一个全局 OpenAI 兼容端点、重试、基础 usage、扩展参数/响应/用量转换与降级建议                                                                    | 多供应商管理、模型拉取与批测、会话模型覆盖、fallback 模型、图/视频专用模型、完整 thinking 方言与 reasoning 续轮策略、图片能力扫描、部分缓存/推理 token 统计 | model-catalog、model-router、thinking-adapters、vision-scan             |
| P0：收尾行为        | 发言必须经工具、spoken 检查实际发送、silent 理由、轮数上限                                                                                      | 旧 silence-policy、正文安全网/裁判/救援发送、无工具/空输出分类、限次打回、运行 disposition、主动场景收尾                                                    | run-disposition、reply-rescue                                           |
| P0：SnowLuma/OneBot | 新 SnowLuma 运行插件、只读检测、托管/外部模式、自有进程回收；OneBot HTTP/WS 分离令牌、文本事件与发送                                            | 自动账号令牌同步与 401 轮换、OneBot notice/request/撤回/编辑等完整事件处理、便携 QQ；完整 OneBot 业务事件未验收（基础文本联调已通过）                       | snowluma-runtime、snowluma-credentials、qq-portable、onebot-events      |
| P0：多模态闭环      | 兼容 sender 支持媒体发送，保留入站消息段元数据，MCP 可返回 image parts                                                                          | ModelMessage 目前仍为字符串/null，Agent 将工具结果 JSON 化；图片/视频 parts 未进入模型请求，缺少图片压缩、GIF 选路、视频读取/抽帧、语音转写和回退           | media-ingest、image-reader、video-reader、audio-transcribe              |
| P1：表情库          | 兼容层有 sendSticker 发送入口                                                                                                                   | 表情发现/收藏/下载/管理、本地图片库、备注/标签、上下文表情策略及对应模型工具和前端                                                                          | sticker-library、sticker-tools、sticker-console                         |
| P1：搜索和查询工具  | 通用安全抓取算法可供扩展调用                                                                                                                    | 核心 web_search/web_fetch、图片搜索、头像、活跃成员、会话列表、拍一拍、节假日、反馈；通用 adapter.query 不等于模型已有这些工具                              | web-search、web-fetch、qq-query-tools、calendar-tools                   |
| P1：记忆与提醒      | SQLite 记忆读取/追加；reminder_add 和到期直发模式                                                                                               | 逐成员记忆文件、删除/整理/模型归纳、记忆管理页；旧 set/list/cancel_reminder 工具协议、自然语言/相对时间语义、旧提醒触发模型流程                             | member-memory、memory-consolidate、reminders-console                    |
| P1：人设与提示词    | 单个默认人设、会话覆盖、段落注入与变量算法                                                                                                      | 人设库 CRUD/模板/引用统计、完整提示词库及切换、编辑预览、全部旧系统段落。当前缺少的段落无法成为有效 rewrite 目标                                            | persona-library、prompt-library、prompt-preview                         |
| P1：用量与成本      | 运行输入/输出 token、少量 extraUsage、轨迹                                                                                                      | 日/会话/供应商统计、费用/价格表更新、缓存命中成本、请求耗时分析、用量页与导出                                                                               | usage-ledger、price-feed、usage-console                                 |
| P1：会话管理        | 消息列表、简单档案/轨迹、重试/取消、SQLite 存储、离线导入和一致性备份                                                                           | 原运行档案详情、搜索/分页、运行分析、Markdown+原始 JSON 导出、清理/保留策略、消息撤回/编辑接线、成员列表、手动已读/测试发送/暂停控制                        | archive-console、session-export、data-maintenance                       |
| P1：扩展管理        | 五个独立 Cordis 管理器及客户端面板、七目录、类型/依赖/owner、旧五钩子、MCP、沙箱、文档、导入与设置                                              | 旧元信息编辑/清理接口、完整仓库诊断、配置变量提示、所有字段编辑器/详情视图；私有 src 引用和旧原型补丁包仍需适配。24 项 HookBus 在旧版原本就没有全面派发     | extension-editor、extension-diagnostics，逐包改造                       |
| P1：容器            | 四个独立 Cordis 插件；Docker/Podman 探测、归属容器创建/绑定、命令/文件读写/搜索、后台输出/取消、资源限制、React 页面与会话页签；Podman 实测通过 | 任意已有容器绑定、交互式 PTY/terminal、任务完成自动续跑、v2 技能容器执行后端、Docker 真实验收                                                               | container-runtime、container-session、container-jobs、container-console |
| P2：社区与市场      | 本地包导入、默认关闭、准入/黑名单                                                                                                               | 市场登录/账号/发布/校验/在线安装、社区屏蔽名单同步、社区反馈服务                                                                                            | extension-market、community-policy                                      |
| P2：桌面与安装运维  | Electron 代码已编译、独立后端启动入口；SnowLuma 插件外壳                                                                                        | Electron 真实运行验收、安装包、SnowLuma 下载/版本/哈希核验、便携 QQ 打包/隔离登录、升级、开机自启、旧维护脚本能力                                           | desktop-shell、runtime-installer、deployment-tools                      |

## 原核心工具清单中的缺口

以下 22 个旧工具没有原生同名实现：

- 跨会话 / QQ：send_to、send_poke、get_active_members、get_chats。
- 表情：send_sticker、list_stickers、get_sticker_image、sticker_note、collect_sticker。
- 图片 / 视频：get_message_images、fetch_avatar、send_image、search_images、read_video。
- 搜索：web_search、web_fetch。
- 记忆 / 反馈 / 日历：memory_remove、report_feedback、check_holiday。
- 提醒：set_reminder、list_reminders、cancel_reminder；当前只有新 reminder_add 工具和宿主 ReminderService 的列表/删除方法。

兼容 sender 或某个社区包能实现其中部分动作，不代表这些原核心工具及其默认提示词已迁入。get_message_detail、read_forward 等同名工具目前也只是基础实现，旧嵌套转发、媒体提取与额外 OneBot 回退路径仍需逐项验证。

## 扩展兼容性需要特别区分

103 项旧契约断言证明的是类型闸门、描述符、owner、HookBus、UI 净化、知识树和降级沙箱等算法，不能证明 66 个旧包的实际业务都可运行。当前包目录扫描发现 29 个直接依赖旧 src 的目录，其中包含已桥接的五个管理器；剩余目录常引用 Orchestrator、OneBotClient、config、StickerManager、container-* 等。完整名单和 import 路径在机器清单里，不复制第三方代码或用户配置。

后续应将这些依赖改成公开服务与扩展点；能力仍以插件实现，管理页面也由客户端插件贡献。不要为了兼容原型补丁把旧 app 整体搬回新内核。

## 建议迁移顺序与验收

1. 先锁定旧行为样例：触发概率/未读、完整上下文、finish/静默、单会话模型。逐条迁为插件并做同输入的差异测试。
2. 补齐 OneBot 事件与账号令牌、多模态工具链；单独验收 SnowLuma + 独立便携 QQ，不让新旧机器人同时消费同一账号。
3. 补人设/提示词、表情、记忆、提醒与用量页面，再迁容器/市场/安装运维。
4. 生产切换前使用离线数据副本完整回放；现有 39 项新测试、103 项原契约测试、浏览器测试只覆盖已实现范围，不等价于旧系统全量验收。
