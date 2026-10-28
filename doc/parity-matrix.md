# 全量功能对齐验收矩阵

上轮独立业务排除项已经失效。全部旧功能都在本轮范围内，当前尚未完成全量对齐。注册、编译、加载、行为验证和正式数据迁移分别记录。

## 基准与当前状态

66 个核心源码模块、105 条静态路由、29 个核心工具、101 个扩展包（69 插件、32 技能目录项，包含停用包）。部分旧源码为检查脚本，仍保留以核实入口可达性。

来源 SHA、参数声明、模块导入、hooks、providers、UI 函数见 [机器清单](parity-inventory.json)。逐项状态见 [JSON 矩阵](parity-evidence.json)。

本轮已部署原生工具、媒体、轨迹与界面修复；搜索、网页、真实入站图片、嵌套转发及引用追踪已完成授权联调。**这不代表 101 个旧包已经全部迁移。** 见 [能力修复与实测](capability-recovery-20261027.md)。

## 核心工具

| 工具 | 旧入口 | 状态／差异 | 测试 | 真实联调 |
|---|---|---|---|---|
| send_message | src/tools.js:336 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts)、[messaging-parity.test.ts](../tests/messaging-parity.test.ts) | mock 验证 |
| send_to | src/tools.js:371 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| send_sticker | src/tools.js:430 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| list_stickers | src/tools.js:487 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| get_sticker_image | src/tools.js:510 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| sticker_note | src/tools.js:539 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| collect_sticker | src/tools.js:566 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| send_poke | src/tools.js:610 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| get_recent_messages | src/tools.js:651 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| read_forward | src/tools.js:683 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts)、[capability-recovery.test.ts](../tests/capability-recovery.test.ts) | 已通过 |
| get_active_members | src/tools.js:798 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| get_chats | src/tools.js:821 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| get_message_detail | src/tools.js:848 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| get_message_images | src/tools.js:874 | 静态图片及转发图片已实测；GIF 转视频策略待对齐 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts)、[capability-recovery.test.ts](../tests/capability-recovery.test.ts) | 已通过 |
| fetch_avatar | src/tools.js:942 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| memory_append | src/tools.js:984 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| memory_query | src/tools.js:1013 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| memory_remove | src/tools.js:1035 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| report_feedback | src/tools.js:1061 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| web_search | src/tools.js:1083 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts)、[capability-recovery.test.ts](../tests/capability-recovery.test.ts) | 已通过 |
| web_fetch | src/tools.js:1108 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts)、[capability-recovery.test.ts](../tests/capability-recovery.test.ts) | 已通过 |
| finish | src/tools.js:1144 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts)、[messaging-parity.test.ts](../tests/messaging-parity.test.ts) | mock 验证 |
| set_reminder | src/tools.js:1208 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| list_reminders | src/tools.js:1244 | 结构化新返回值已测，旧文本显示字段继续核对 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| cancel_reminder | src/tools.js:1264 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| check_holiday | src/tools.js:1285 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| send_image | src/tools.js:1325 | 静态预览与限额已测；GIF、旧压缩及备用发送策略待对齐 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| search_images | src/tools.js:1448 | 核心实现已测；全部扩展联动待完成 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts) | mock 验证 |
| read_video | src/tools.js:1497 | 四模式选路与元信息回退已对照旧纯函数；转码与 FFmpeg 实机仍待验收 | [core-tools-parity.test.ts](../tests/core-tools-parity.test.ts)、[video-route-parity.test.ts](../tests/video-route-parity.test.ts) | mock 验证 |

## 会话配置

四渠道概率、关键词、峰谷、未读、历史、锚点、模型／备选、超时0、追问与重试、活跃期不续期、上下线及软禁言已有实现和测试。全部字段的正式迁移仍需继续完成；本次能力修复没有覆盖用户现有会话策略。人设动态分段、辅助模型配额、旧会话管理剩余操作及表情库数据尚需逐项核实。三层记忆规则是已确认的新实现。

## 全部旧扩展

19:22正式安装：98个代码入口和3个原生替代，7会话50处开启设置与预览逐字段一致。15个私有数据文件已迁入，已有新版数据优先。共有21包的局部工作流测试与全部98包生命周期检查；完整业务分支仍待补齐。见[部署与回滚](deploy-20261027-final.md)。

独立编译预览：98 个包可生成入口，0 个包仍需宿主适配；image-studio、cross-memory、cross-group-memory 使用原生能力替代。编译数不计作功能完成数。安装器保留原有启停与设置，未启用包延迟加载；实际正式安装、数据迁移与版本快照见 [当前状态](status.md)。

CCB、auto-finish、at-mention、member-aliases、ai-status、usage-report 已有旧原包的局部工作流测试；这不包含它们的全部定时、跨会话推送和数据迁移。状态卡通过独立渲染服务发图，历史未知计费明确显示不可用。

新增 self-avatar、quote-target、quote-reply、detailed-thinking、owner-identity 和 scheduled-task 局部工作流。全量加载检查见 [101包审计](package-loading-audit-20261027.md)；98个可加载包仍需补齐全部业务分支验收。定时任务接公开唤醒服务，每个运行独立保留任务说明，不修改旧宿主。

typing-indicator 与 msg-reaction 已增加旧原包协议工作流，辅助模型进入独立操作并记录用量。hell-joke、stamina、qianyeyue-affinity、sticker-cap、self-surf、net-proxy 和 long-memory 增加原包工作流测试；long-memory 工具直接使用原生三层记忆，跨会话旧记忆能力由统一可见性与整理服务替代。

| 包 | 名称 | 状态 | 编译预览 | 设置字段数 |
|---|---|---|---|---|
| addressee-guard | 点名判定（别抢不属于自己的话） | pending | compiled-not-behavior-verified | 10 |
| agent-task | AI 任务 | pending | compiled-not-behavior-verified | 22 |
| ai-status | AI状态查询 | partial-flow-tested | compiled-not-behavior-verified | 3 |
| anti-recon | 反侦察（身份防套话） | pending | compiled-not-behavior-verified | 2 |
| at-identity | @ 身份锚点（分清 @ 的是谁） | pending | compiled-not-behavior-verified | 3 |
| at-mention | @群友（按名字） | partial-flow-tested | compiled-not-behavior-verified | 4 |
| auto-finish | 省token·投递即收尾 | partial-flow-tested | compiled-not-behavior-verified | 5 |
| cache-suite | Token的最终解 | pending | compiled-not-behavior-verified | 51 |
| ccb-command | CCB 指令 | partial-flow-tested | compiled-not-behavior-verified | 6 |
| chatter-guard | 水聊免回 | pending | compiled-not-behavior-verified | 7 |
| chuanzi | 串子模式 | pending | compiled-not-behavior-verified | 6 |
| command-digest | 群总结指令 | pending | compiled-not-behavior-verified | 2 |
| content-guard | 擦边内容拦截 | pending | compiled-not-behavior-verified | 8 |
| context-chime | 上下文插话判定 | pending | compiled-not-behavior-verified | 15 |
| context-reuse | 上下文延续 | pending | compiled-not-behavior-verified | 2 |
| continuous-life | 持续的生活 | pending | compiled-not-behavior-verified | 6 |
| cross-chat-link | 跨会话认人 | pending | compiled-not-behavior-verified | 5 |
| cross-memory | 仿生记忆（所有会话互通） | native-port-tested | native-port | 17 |
| daily-checkin | 每日签到 | pending | compiled-not-behavior-verified | 7 |
| deepseek-search-fix | DeepSeek 搜索修补 | pending | compiled-not-behavior-verified | 8 |
| deepseek-status | DeepSeek 峰谷状态牌 | pending | compiled-not-behavior-verified | 9 |
| detailed-thinking | 更详细的会话思考 | partial-flow-tested | compiled-not-behavior-verified | 1 |
| face-decode | QQ自带表情转译 | pending | compiled-not-behavior-verified | 0 |
| friend-gate | 好友申请管家 | pending | compiled-not-behavior-verified | 18 |
| group-manner | 群聊分寸（别句句都接） | pending | compiled-not-behavior-verified | 12 |
| guardian | 防崩溃和记忆断层 | pending | compiled-not-behavior-verified | 11 |
| hell-joke | 地狱笑话 | partial-flow-tested | compiled-not-behavior-verified | 14 |
| image-compat | 图片格式兼容 | pending | compiled-not-behavior-verified | 2 |
| kaomoji | 颜文字点缀 | pending | compiled-not-behavior-verified | 6 |
| kb-hub | 多知识库中心 | pending | compiled-not-behavior-verified | 10 |
| mc-status | 服务器状态查询 | pending | compiled-not-behavior-verified | 42 |
| mcp-bridge | MCP 桥 | pending | compiled-not-behavior-verified | 5 |
| member-aliases | 群友外号对照 | partial-flow-tested | compiled-not-behavior-verified | 4 |
| msg-reaction | 消息表情回应 | partial-flow-tested | compiled-not-behavior-verified | 16 |
| net-proxy | 网络代理 | partial-flow-tested | compiled-not-behavior-verified | 9 |
| ops-ctrl | 运维控制台 | pending | compiled-not-behavior-verified | 7 |
| owner-identity | 主人识别 | partial-flow-tested | compiled-not-behavior-verified | 5 |
| persona-picker | 自动切换人设（选人设） | pending | compiled-not-behavior-verified | 11 |
| poke-counter | 戳一戳统计 | pending | compiled-not-behavior-verified | 8 |
| punch-card | 群打卡 | pending | compiled-not-behavior-verified | 15 |
| qianyeyue-affinity | 好感度系统 | partial-flow-tested | compiled-not-behavior-verified | 32 |
| question-relay | 问号接龙 | pending | compiled-not-behavior-verified | 5 |
| quota-guard | Token 配额守卫 | pending | compiled-not-behavior-verified | 6 |
| quote-reply | 引用与 @ 规范 | partial-flow-tested | compiled-not-behavior-verified | 7 |
| quote-target | 回复引用保护 | partial-flow-tested | compiled-not-behavior-verified | 5 |
| reminder | 定时提醒 | pending | compiled-not-behavior-verified | 4 |
| repeat-echo | 群聊复读机 | pending | compiled-not-behavior-verified | 9 |
| reply-pacing | 回应节奏（等他说完） | pending | compiled-not-behavior-verified | 9 |
| reply-safety | 回复安全网（正文抢救 + 外发独白闸） | pending | compiled-not-behavior-verified | 0 |
| reply-tool-guard | 发言工具督促 | pending | compiled-not-behavior-verified | 0 |
| revenge-ledger | 复仇账本 | pending | compiled-not-behavior-verified | 9 |
| rollpig | 今日小猪（RollPig） | pending | compiled-not-behavior-verified | 6 |
| safety-guard | 保护词守护 | pending | compiled-not-behavior-verified | 9 |
| search-guard | 搜索次数护栏 | pending | compiled-not-behavior-verified | 2 |
| share-card | 分享卡片解读 | pending | compiled-not-behavior-verified | 20 |
| silent-voice-check | 发言自检 | pending | compiled-not-behavior-verified | 5 |
| sleep-schedule | 睡觉时间 | pending | compiled-not-behavior-verified | 13 |
| speech-to-text-qq | 语音转文字（QQ 原生） | pending | compiled-not-behavior-verified | 3 |
| steam-query | Steam 查价 | pending | compiled-not-behavior-verified | 17 |
| sticker-cap | 表情包库上限（防撑爆） | partial-flow-tested | compiled-not-behavior-verified | 4 |
| sticker-memory | 表情包记忆库 | pending | compiled-not-behavior-verified | 7 |
| sticker-send-as-emoji | 表情按「表情」发（不再发成大图） | pending | compiled-not-behavior-verified | 3 |
| sticker-sense | 表情包只读情绪 | pending | compiled-not-behavior-verified | 5 |
| sticker-steal | 更好的表情包收集和发送 | pending | compiled-not-behavior-verified | 32 |
| token-ledger | Token 账本（谁在烧钱） | pending | compiled-not-behavior-verified | 9 |
| tool-boost | 工具使用强化 | pending | compiled-not-behavior-verified | 1 |
| topic-guard | 敏感话题护栏 | pending | compiled-not-behavior-verified | 11 |
| typing-indicator | 正在输入提示（私聊） | partial-flow-tested | compiled-not-behavior-verified | 8 |
| video-frames | 视频抽帧 | pending | compiled-not-behavior-verified | 3 |
| ark-db | 明日方舟数据库（PRTS 实时） | pending | compiled-not-behavior-verified | 6 |
| bili-card | B站视频卡片 | pending | compiled-not-behavior-verified | 2 |
| bilibili-peek | 看B站视频 | pending | compiled-not-behavior-verified | 6 |
| cross-group-memory | 跨群记忆 | native-port-tested | native-port | 19 |
| daily-fortune | 每日运势 | pending | compiled-not-behavior-verified | 4 |
| deai-flavor | 去除 AI 味 | pending | compiled-not-behavior-verified | 4 |
| friend-approval | 好友申请审批 | pending | compiled-not-behavior-verified | 2 |
| group-image-repost | 群图转发 | pending | compiled-not-behavior-verified | 6 |
| health-report | 体检报告 | pending | compiled-not-behavior-verified | 5 |
| image-studio | 图片工坊 | native-port-tested | native-port | 10 |
| long-memory | 长期记忆 | partial-flow-tested | compiled-not-behavior-verified | 4 |
| meme-mood | 心情表情 | pending | compiled-not-behavior-verified | 8 |
| mimo-tts | MiMo 语音说话 | pending | compiled-not-behavior-verified | 10 |
| minecraft-master | 我的世界大师 | pending | compiled-not-behavior-verified | 8 |
| my-weather | 天气查询 | pending | compiled-not-behavior-verified | 2 |
| office-export | 文件导出（Excel / Word / PPT / TXT / CSV） | pending | compiled-not-behavior-verified | 4 |
| owner-console | 主人控制台 | pending | compiled-not-behavior-verified | 1 |
| pcstatus | 电脑状态 | pending | compiled-not-behavior-verified | 26 |
| pig-hub | 猪猪图片 | pending | compiled-not-behavior-verified | 8 |
| recall | 撤回消息 | pending | compiled-not-behavior-verified | 0 |
| reply-meme | 回复配图·梗鲸表情包 | pending | compiled-not-behavior-verified | 13 |
| scheduled-task | 定时任务 | partial-flow-tested | compiled-not-behavior-verified | 7 |
| self-avatar | 自己的头像 | partial-flow-tested | compiled-not-behavior-verified | 3 |
| self-surf | 自己上网 | partial-flow-tested | compiled-not-behavior-verified | 10 |
| sing-aloud | 唱歌（念唱·翻唱） | pending | compiled-not-behavior-verified | 28 |
| skill-summary | 功能介绍 | pending | compiled-not-behavior-verified | 6 |
| smart-image | 智能配图 | pending | compiled-not-behavior-verified | 8 |
| stamina | 体力值 | partial-flow-tested | compiled-not-behavior-verified | 26 |
| steam-deals | Steam 史低好价 | pending | compiled-not-behavior-verified | 13 |
| trendy-memes | 网络流行梗 | pending | compiled-not-behavior-verified | 3 |
| usage-report | 用量与花费 | partial-flow-tested | compiled-not-behavior-verified | 2 |
| verify-first | 先查证再回答 | pending | compiled-not-behavior-verified | 3 |

## 核心模块逐项追踪

这些模块还必须核实可达入口、实际调用和替代方案，不能以工具测试覆盖它们。

| 旧模块 | 状态 |
|---|---|
| src/.scheduled-task-check-6292.js | 待逐项对照 |
| src/active-mode.js | 待逐项对照 |
| src/app.js | 待逐项对照 |
| src/chat-profiles.js | 待逐项对照 |
| src/chat-stats.js | 待逐项对照 |
| src/community.js | 待逐项对照 |
| src/config-scope.js | 待逐项对照 |
| src/config.js | 待逐项对照 |
| src/dispatcher.js | 待逐项对照 |
| src/gif-to-video.js | 待逐项对照 |
| src/holidays.js | 待逐项对照 |
| src/image-compress.js | 待逐项对照 |
| src/image-type.js | 待逐项对照 |
| src/instance-lock.js | 待逐项对照 |
| src/llm-messages.js | 待逐项对照 |
| src/llm.js | 待逐项对照 |
| src/logger.js | 待逐项对照 |
| src/market.js | 待逐项对照 |
| src/md-to-plain.js | 待逐项对照 |
| src/media-links.js | 待逐项对照 |
| src/memory.js | 待逐项对照 |
| src/model-prices.js | 待逐项对照 |
| src/model-vision-docs.js | 待逐项对照 |
| src/onebot.js | 待逐项对照 |
| src/orchestrator.js | 待逐项对照 |
| src/personas.js | 待逐项对照 |
| src/plugin-loader.js | 待逐项对照 |
| src/price-feed.js | 待逐项对照 |
| src/profile.js | 待逐项对照 |
| src/prompt.js | 待逐项对照 |
| src/providers.js | 待逐项对照 |
| src/reminders.js | 待逐项对照 |
| src/reply-rescue.js | 待逐项对照 |
| src/routes.js | 待逐项对照 |
| src/safe-fetch.js | 待逐项对照 |
| src/sender.js | 待逐项对照 |
| src/server.js | 待逐项对照 |
| src/session-config.js | 待逐项对照 |
| src/session-export.js | 待逐项对照 |
| src/session-metrics.js | 待逐项对照 |
| src/sessions.js | 待逐项对照 |
| src/silence-policy.js | 待逐项对照 |
| src/skills/capabilities.js | 待逐项对照 |
| src/skills/config.js | 待逐项对照 |
| src/skills/errors.js | 待逐项对照 |
| src/skills/manager.js | 待逐项对照 |
| src/skills/manifest.js | 待逐项对照 |
| src/skills/registry.js | 待逐项对照 |
| src/sticker-manager.js | 待逐项对照 |
| src/stickers.js | 待逐项对照 |
| src/storage/atomic.js | 待逐项对照 |
| src/storage/chatlog.js | 待逐项对照 |
| src/storage/profile-files.js | 待逐项对照 |
| src/storage/session-files.js | 待逐项对照 |
| src/store.js | 待逐项对照 |
| src/telemetry.js | 待逐项对照 |
| src/thinking.js | 待逐项对照 |
| src/tier-slider.js | 待逐项对照 |
| src/tool-registry.js | 待逐项对照 |
| src/tools.js | 待逐项对照 |
| src/trigger.js | 待逐项对照 |
| src/util.js | 待逐项对照 |
| src/video-reader.js | 待逐项对照 |
| src/vision-scan.js | 待逐项对照 |
| src/web-search.js | 待逐项对照 |
| src/zip-install.js | 待逐项对照 |

## 全部旧路由与管理操作

允许采用统一的新 API，但必须记录替代位置并验证操作。明文密钥读取由集中凭据管理与脱敏替代，不恢复密钥泄露接口。

| 方法 | 旧路由 | 来源 | 状态 |
|---|---|---|---|
| GET | '/api/status' | src/routes.js:203 | 待行为映射／验收 |
| POST | '/api/open-data-dir' | src/routes.js:253 | 待行为映射／验收 |
| POST | '/api/reset-data' | src/routes.js:264 | 待行为映射／验收 |
| GET | '/api/usage/stats' | src/routes.js:306 | 待行为映射／验收 |
| GET | '/api/usage/breakdown' | src/routes.js:319 | 待行为映射／验收 |
| GET | '/api/chat-stats' | src/routes.js:339 | 待行为映射／验收 |
| GET | '/api/model-prices' | src/routes.js:374 | 待行为映射／验收 |
| POST | '/api/model-prices/refresh' | src/routes.js:382 | 待行为映射／验收 |
| POST | '/api/snowluma/launch' | src/routes.js:395 | 待行为映射／验收 |
| GET | '/api/snowluma/logs' | src/routes.js:406 | 待行为映射／验收 |
| POST | '/api/snowluma/stop' | src/routes.js:410 | 待行为映射／验收 |
| POST | '/api/snowluma/open-folder' | src/routes.js:421 | 待行为映射／验收 |
| POST | '/api/snowluma/open-webui' | src/routes.js:430 | 待行为映射／验收 |
| POST | '/api/qq-portable/launch' | src/routes.js:441 | 待行为映射／验收 |
| POST | '/api/qq-portable/stop' | src/routes.js:452 | 待行为映射／验收 |
| GET | '/api/qq-portable/logs' | src/routes.js:463 | 待行为映射／验收 |
| GET | '/api/qq-portable/status' | src/routes.js:467 | 待行为映射／验收 |
| GET | '/api/onebot/groups' | src/routes.js:473 | 待行为映射／验收 |
| GET | '/api/onebot/friends' | src/routes.js:486 | 待行为映射／验收 |
| GET | '/api/persona-templates' | src/routes.js:506 | 待行为映射／验收 |
| POST | '/api/persona-templates' | src/routes.js:510 | 待行为映射／验收 |
| PATCH | /^\/api\/persona-templates\/([^/]+)$/ | src/routes.js:522 | 待行为映射／验收 |
| DELETE | /^\/api\/persona-templates\/([^/]+)$/ | src/routes.js:535 | 待行为映射／验收 |
| GET | '/api/providers' | src/routes.js:561 | 待行为映射／验收 |
| GET | '/api/providers/key' | src/routes.js:573 | 待行为映射／验收 |
| GET | '/api/api-key' | src/routes.js:582 | 待行为映射／验收 |
| GET | '/api/search-key' | src/routes.js:589 | 待行为映射／验收 |
| GET | '/api/onebot-token' | src/routes.js:619 | 待行为映射／验收 |
| POST | '/api/providers/fetch-models' | src/routes.js:633 | 待行为映射／验收 |
| POST | '/api/providers/test-one' | src/routes.js:661 | 待行为映射／验收 |
| POST | '/api/providers/test-chat' | src/routes.js:677 | 待行为映射／验收 |
| POST | '/api/providers' | src/routes.js:700 | 待行为映射／验收 |
| POST | '/api/providers/models' | src/routes.js:714 | 待行为映射／验收 |
| DELETE | '/api/providers/models' | src/routes.js:727 | 待行为映射／验收 |
| POST | '/api/providers/set-key' | src/routes.js:760 | 待行为映射／验收 |
| DELETE | '/api/providers' | src/routes.js:769 | 待行为映射／验收 |
| POST | '/api/providers/test-all' | src/routes.js:799 | 待行为映射／验收 |
| GET | '/api/vision/results' | src/routes.js:809 | 待行为映射／验收 |
| POST | '/api/vision/scan' | src/routes.js:816 | 待行为映射／验收 |
| GET | '/api/search-providers' | src/routes.js:833 | 待行为映射／验收 |
| POST | '/api/search-providers' | src/routes.js:843 | 待行为映射／验收 |
| DELETE | '/api/search-providers' | src/routes.js:892 | 待行为映射／验收 |
| POST | '/api/search-providers/test' | src/routes.js:909 | 待行为映射／验收 |
| POST | '/api/test/api' | src/routes.js:925 | 待行为映射／验收 |
| GET | '/api/config' | src/routes.js:940 | 待行为映射／验收 |
| * | '/api/prompt-preview' | src/routes.js:955 | 待行为映射／验收 |
| GET | '/api/community/blocklist' | src/routes.js:1006 | 待行为映射／验收 |
| POST | '/api/community/blocklist' | src/routes.js:1010 | 待行为映射／验收 |
| GET | '/api/market/accounts' | src/routes.js:1028 | 待行为映射／验收 |
| POST | '/api/market/login' | src/routes.js:1035 | 待行为映射／验收 |
| POST | '/api/market/logout' | src/routes.js:1054 | 待行为映射／验收 |
| POST | '/api/market/publish' | src/routes.js:1065 | 待行为映射／验收 |
| POST | '/api/market/verify' | src/routes.js:1097 | 待行为映射／验收 |
| POST | '/api/market/install' | src/routes.js:1115 | 待行为映射／验收 |
| GET | '/api/skills' | src/routes.js:1143 | 待行为映射／验收 |
| POST | '/api/skills/reload' | src/routes.js:1180 | 待行为映射／验收 |
| POST | '/api/skills/cleanup' | src/routes.js:1206 | 待行为映射／验收 |
| DELETE | /^\/api\/skills\/([^/]+)$/ | src/routes.js:1238 | 待行为映射／验收 |
| POST | /^\/api\/skills\/([^/]+)$/ | src/routes.js:1288 | 待行为映射／验收 |
| GET | '/api/skills/capabilities' | src/routes.js:1382 | 待行为映射／验收 |
| GET | '/api/tools/availability' | src/routes.js:1396 | 待行为映射／验收 |
| POST | '/api/config' | src/routes.js:1426 | 待行为映射／验收 |
| GET | '/api/prompt-builtin' | src/routes.js:1459 | 待行为映射／验收 |
| PUT | '/api/prompts' | src/routes.js:1481 | 待行为映射／验收 |
| GET | '/api/chat-profiles' | src/routes.js:1558 | 待行为映射／验收 |
| POST | '/api/chat-profiles' | src/routes.js:1579 | 待行为映射／验收 |
| GET | /^\/api\/chat-profiles\/(group\|private):([A-Za-z0-9_-]+)$/ | src/routes.js:1590 | 待行为映射／验收 |
| PATCH | /^\/api\/chat-profiles\/(group\|private):([A-Za-z0-9_-]+)$/ | src/routes.js:1607 | 待行为映射／验收 |
| DELETE | /^\/api\/chat-profiles\/(group\|private):([A-Za-z0-9_-]+)$/ | src/routes.js:1621 | 待行为映射／验收 |
| PUT | /^\/api\/chat-profiles\/(group\|private):([A-Za-z0-9_-]+)\/overrides$/ | src/routes.js:1630 | 待行为映射／验收 |
| DELETE | /^\/api\/chat-profiles\/(group\|private):([A-Za-z0-9_-]+)\/overrides$/ | src/routes.js:1667 | 待行为映射／验收 |
| DELETE | /^\/api\/chat-profiles\/(group\|private):([A-Za-z0-9_-]+)\/overrides\/([A-Za-z0-9_-]+)$/ | src/routes.js:1685 | 待行为映射／验收 |
| GET | '/api/tools' | src/routes.js:1703 | 待行为映射／验收 |
| GET | '/api/version' | src/routes.js:1739 | 待行为映射／验收 |
| GET | '/api/update-check' | src/routes.js:1743 | 待行为映射／验收 |
| GET | '/api/models' | src/routes.js:1766 | 待行为映射／验收 |
| GET | '/api/sessions' | src/routes.js:1777 | 待行为映射／验收 |
| GET | /^\/api\/sessions\/([\w-]+)$/ | src/routes.js:1796 | 待行为映射／验收 |
| GET | /^\/api\/sessions\/([\w-]+)\/export$/ | src/routes.js:1804 | 待行为映射／验收 |
| GET | /^\/api\/sessions\/([\w-]+)\/analysis$/ | src/routes.js:1824 | 待行为映射／验收 |
| DELETE | /^\/api\/sessions\/([\w-]+)$/ | src/routes.js:1835 | 待行为映射／验收 |
| POST | '/api/sessions/clear-finished' | src/routes.js:1845 | 待行为映射／验收 |
| POST | /^\/api\/sessions\/([\w-]+)\/retry$/ | src/routes.js:1854 | 待行为映射／验收 |
| POST | /^\/api\/sessions\/([\w-]+)\/abort$/ | src/routes.js:1864 | 待行为映射／验收 |
| GET | '/api/chats' | src/routes.js:1875 | 待行为映射／验收 |
| GET | '/api/memory-files' | src/routes.js:1897 | 待行为映射／验收 |
| GET | /^\/api\/memory-files\/(group\|private)_(\d+)$/ | src/routes.js:1923 | 待行为映射／验收 |
| PUT | /^\/api\/memory-files\/(group\|private)_(\d+)\/members\/(\d+)$/ | src/routes.js:1930 | 待行为映射／验收 |
| DELETE | /^\/api\/memory-files\/(group\|private)_(\d+)\/members\/(\d+)$/ | src/routes.js:1949 | 待行为映射／验收 |
| DELETE | /^\/api\/memory-files\/(group\|private)_(\d+)$/ | src/routes.js:1958 | 待行为映射／验收 |
| POST | '/api/memory-files/consolidate' | src/routes.js:1968 | 待行为映射／验收 |
| GET | /^\/api\/chats\/(group\|private)_(\d+)\/messages$/ | src/routes.js:1997 | 待行为映射／验收 |
| POST | '/api/media-data' | src/routes.js:2009 | 待行为映射／验收 |
| GET | /^\/api\/groups\/(\d+)\/members$/ | src/routes.js:2051 | 待行为映射／验收 |
| POST | /^\/api\/chats\/(group\|private)_(\d+)\/wake$/ | src/routes.js:2065 | 待行为映射／验收 |
| POST | /^\/api\/chats\/(group\|private)_(\d+)\/test-send$/ | src/routes.js:2069 | 待行为映射／验收 |
| POST | /^\/api\/chats\/(group\|private)_(\d+)\/mark-read$/ | src/routes.js:2096 | 待行为映射／验收 |
| POST | /^\/api\/chats\/(group\|private)_(\d+)\/clear$/ | src/routes.js:2100 | 待行为映射／验收 |
| POST | /^\/api\/chats\/(group\|private)_(\d+)\/mute$/ | src/routes.js:2110 | 待行为映射／验收 |
| POST | /^\/api\/chats\/(group\|private)_(\d+)\/delete-messages$/ | src/routes.js:2120 | 待行为映射／验收 |
| POST | '/api/pause' | src/routes.js:2133 | 待行为映射／验收 |
| DELETE | '/api/pause' | src/routes.js:2143 | 待行为映射／验收 |
| GET | '/api/logs' | src/routes.js:2158 | 待行为映射／验收 |
| POST | '/api/logs/level' | src/routes.js:2166 | 待行为映射／验收 |
| * | /^\/api\/captcha-forward\/?$/ | src/routes.js:2183 | 待行为映射／验收 |

## 未通过的交付关卡

- 101 包的逐项行为、启停、配置、必要数据和生命周期迁移。
- 66 核心源模块、105 路由、旧 UI 操作及全部会话字段逐项对照。
- 独立数据副本的完整迁移和回滚，之后再升级其余正式业务配置。
- 后续改动须重跑相应测试，当前记录不能替代后续验收。
