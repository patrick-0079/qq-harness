# SQLite 存储与导入

## 数据位置

`var/local/harness.sqlite` 为默认开发业务库；当前正式实例使用 `var/production/harness.sqlite`。采用 Node 自带的 SQLite，schema version 记录在 user_version，发现更高版本时拒绝降级写入。2026-10-27 本地只读核对为 version 3。

| 表                                             | 内容                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| messages                                       | chat_key、source_id、自增本地 ID、self/read、timestamp、完整规范化消息 JSON |
| runs                                           | 运行 ID、会话、时间、状态、用量及归档 JSON；详细请求载荷另存压缩文件           |
| memory                                         | 每个会话独立的文本记忆                                                      |
| memory_records / memory_revisions              | 短期、中期、长期结构化记忆、来源及修订记录                                  |
| memory_notes / memory_note_revisions            | 笔记及历史修订，包含没有关联聊天消息的手工笔记                              |
| memory_cursors                                 | 会话消息整理游标                                                            |
| memory_index_events / memory_index_checkpoints | 可重建检索索引的事件和提供器检查点                                          |
| plugin_state                                   | namespace + key 的插件持久化文档，提醒也保存在这里                          |

唯一键 `(chat_key, source_id, self)` 避免重复 OneBot 事件重复入库。消息、未读和运行时间均有索引；批量已读在事务内提交。运行时使用 WAL、synchronous=FULL、busy_timeout。当前是本机单写者模型，不是多进程分布式数据库。

schema version 2 增加分层记忆表，version 3 增加笔记历史修订。旧 `memory` 表服务于兼容文本记忆接口，三层结构化记忆保存在 `memory_records` 等表。词面检索索引是运行时可重建状态，当前没有独立的向量数据库；新的检索提供器也应能从权威表重建。文件存储模式的分层记忆另存于 `memory-system/store.json`，使用原子替换。详细设计见 [分层记忆系统](memory-system.md)。

配置、密钥与会话完整配置快照仍由 config-file 插件写到 config.json。管理 API 仅回传密钥存在标记，派生 hasXxx 字段不写回配置。

详细运行载荷保存为数据目录下 `run-details/<run-id>.json.gz`，默认保留30天；数据库中的运行归档不等于完整模型请求载荷。媒体二进制、表情资源、图片工坊历史与标签、QQ 用户数据、扩展代码仍在文件系统。内核队列本身在内存中；后续新增 conversation 插件通过 `plugin_state` 保存会话任务意图，重启只恢复未执行任务，已执行任务标记中断，不从 `runs` 表重放。见 [队列与技能补齐](runtime-completion-20261027.md)。

`plugin_state` 当前包含扩展状态、发送尝试、容器元数据和后台任务、活跃期、记忆草稿与调度、QQ／SnowLuma 托管状态等命名空间。`conversation-queue/jobs` 保存队列意图，`extension-migration/<fingerprint>` 保存扩展数据迁移幂等标记。它保存状态文档，不保存可在重启后继续执行的进程。兼容 long-memory 的工具已桥接到上述原生三层记忆，不额外开一个记忆数据库。见[本轮补齐记录](runtime-completion-20261027.md)。

## 备份与体检

回复上限保存在config.json的会话快照maxReplyMessages，默认0；本轮已用额度是outbound内存状态，随Agent运行建立和释放。成功／失败／未知发送仍记在原outbound-attempts，未新增数据库表。见[回复上限](reply-limits-20261027.md)。

本批新增 `conversation-proactive/<chatKey>` 的冷场计时器（最近消息 ID、下次检查时间和 x/y 秒数），`<chatKey>:last` 保存最近判定及运行／失败原因。2026-10-28 容器改用 `container-runtime/pool-v2` 单条保存独立资源和多对多绑定，含默认容器、g/p 用户及 UID/GID、待确认清理的任务；旧 bindings/unbound 保留供回滚，仍以 ownerChatKey 校验旧标签。容器文件和 Linux 账号留在引擎容器内，不存入 SQLite。并发池保存在 config.json 的 execution；记忆 diff 使用原 memory_revisions 与 derivedFrom，不另建库。见[容器资源池](containers.md)及[管理升级](management-console-upgrade-20261027.md)。

```powershell
node dist/tools/sqlite-maintenance.mjs integrity D:\QQAgent\qq-harness\var\local\harness.sqlite
node dist/tools/sqlite-maintenance.mjs backup D:\QQAgent\qq-harness\var\local\harness.sqlite D:\QQAgent\qq-harness\var\backups\harness-20261026.sqlite
```

备份使用 SQLite backup API，支持一致地读取 WAL，拒绝覆盖已存在的目标。不要在服务运行时仅复制主 sqlite 文件并忽略 WAL。config.json 需要另外备份；备份含敏感聊天内容，不上传仓库。

## 离线导入旧数据

先停止旧实例并制作带日期的数据备份。导入器不连接旧 API、不 import 旧应用、不读取旧 config.json，也不会修改源文件。

```powershell
# 默认只读试运行，打印数量而不输出聊天正文。
node dist/tools/import-legacy.mjs --source=D:\QQAgent\qq-harness\var\legacy-copy

# 显式导入到新目录；旧数据路径下禁止创建目标数据库。
node dist/tools/import-legacy.mjs --source=D:\QQAgent\qq-harness\var\legacy-copy --database=D:\QQAgent\qq-harness\var\imported\harness.sqlite --apply
```

拒绝有旧实例锁的源目录，以及有 harness.lock/WAL 的目标。支持：

- messages 快照与 JSONL 按 seq 回放，包含 read/unread、edit、recall、del、trim、clear。
- sessions 的旧 JSON 与 gzip 档案，运行 ID 去重。
- memory 的旧单文件与成员目录。

旧消息原始结构保留在 metadata，旧运行完整结构保留在 legacy，旧记忆原始结构另存插件状态，避免转换成文本后丢失原始信息。媒体定位等元数据被保留，但并不意味着新版本已经具备所有旧媒体处理能力。

导入按记录幂等写入，可在失败后重新执行；不是整个数据集一次事务。中间坏行会报错而不是静默跳过，只有尾部半行被忽略。导入器未迁移旧配置、第三方扩展私有数据、表情二进制资源及文件本体。

请在离线副本上验证数量、抽样和完整性，再切换生产入口。以上是独立离线导入器的能力边界，不能代表全部迁移已经交付。当前正式实例已执行配置和记忆迁移，并安装98个旧包入口及3个原生替代，保留7会话50处启用设置、迁入15个私有数据文件，完成该安装流程的幂等及回滚验证。全部旧业务与剩余数据口径仍需逐项验收；以[当前状态](status.md)和逐项验收矩阵为准。
