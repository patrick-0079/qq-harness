# SQLite 存储与导入

## 数据位置

`var/local/harness.sqlite` 为默认业务库，采用 Node 24 自带的 SQLite。schema version 记录在 user_version，发现更高版本时拒绝降级写入。

| 表                                             | 内容                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| messages                                       | chat_key、source_id、自增本地 ID、self/read、timestamp、完整规范化消息 JSON |
| runs                                           | 运行 ID、会话、时间、状态与完整轨迹 JSON                                    |
| memory                                         | 每个会话独立的文本记忆                                                      |
| memory_records / memory_revisions              | 中长期结构化记忆及修订记录                                                  |
| memory_notes / memory_cursors                  | 会话暂存记事本及后台提炼进度                                                |
| memory_index_events / memory_index_checkpoints | 可重建检索索引的事件和提供器检查点                                          |
| plugin_state                                   | namespace + key 的插件持久化文档，提醒也保存在这里                          |

唯一键 `(chat_key, source_id, self)` 避免重复 OneBot 事件重复入库。消息、未读和运行时间均有索引；批量已读在事务内提交。运行时使用 WAL、synchronous=FULL、busy_timeout。当前是本机单写者模型，不是多进程分布式数据库。

schema version 2 增加分层记忆表，旧 `memory` 表仍是兼容文本记忆的权威位置。词面检索索引是运行时衍生状态，不需要单独备份；新的向量检索提供器也应能从权威表重建。文件存储模式的分层记忆另存于 `memory-system/store.json`，使用原子替换。详细设计见 [分层记忆系统](memory-system.md)。

配置、密钥与会话完整配置快照仍由 config-file 插件写到 config.json。管理 API 仅回传密钥存在标记，派生 hasXxx 字段不写回配置。

## 备份与体检

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

请在离线副本上验证数量、抽样和完整性，再决定切换生产入口。当前工作没有对真实旧数据执行导入。
