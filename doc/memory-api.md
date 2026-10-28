# 记忆 API

> 2026-10-28 已切换为独立记忆 Agent，写接口改为异步申请。当前契约见 [独立记忆 Agent 与分层文档](memory-agent-20261028.md)；下文保留为旧版本参考。

所有接口归 `agent-memory` 插件所有，沿用控制台的访问策略和会话准入。参数格式错误返回400，版本冲突或操作不满足条件返回409。

| 接口                                          | 用途                                                          |
| --------------------------------------------- | ------------------------------------------------------------- |
| GET /api/memory/records?chatKey=…&personId=…  | 当前有效记录，含 short/medium/long                            |
| GET /api/memory/records?chatKey=…&history=1   | 本会话当前及历史记录                                          |
| GET /api/memory/search?chatKey=…&query=…      | 权限过滤、层级优先、事实去重的检索                            |
| POST /api/memory/records                      | 人工新增事实，返回已保存记录                                  |
| PATCH /api/memory/records/:id                 | `{expectedRevision,patch}`；返回更正草稿，非即时修改后的记录  |
| DELETE /api/memory/records/:id?revision=…     | 逻辑删除并屏蔽同事实各层                                      |
| GET /api/memory/records/:id/history?chatKey=… | 同一事实各阶段及修订历史                                      |
| GET /api/memory/drafts?chatKey=…              | 草稿状态及原记录、预期修订、变更                              |
| DELETE /api/memory/drafts/:id?chatKey=…       | 撤销未发布草稿                                                |
| GET /api/memory/consolidation?chatKey=…       | 各层下次到期、成功/失败时间及运行ID                           |
| POST /api/memory/consolidate                  | `{chatKey,tier?}`；不传tier整理全部；202返回运行ID            |
| GET /api/memory/settings?chatKey=…            | defaults、overrides、effective                                |
| PATCH /api/memory/settings                    | `{chatKey?,patch}`；无chatKey更新默认，patch=null恢复会话继承 |
| GET /api/memory/notes?chatKey=…               | 有效笔记                                                      |
| POST /api/memory/notes                        | `{chatKey,text,sourceIds?,ttlMs?}`；允许无消息来源            |
| PATCH /api/memory/notes/:id                   | `{chatKey,patch:{text?,important?,sourceIds?,ttlMs?}}`        |
| DELETE /api/memory/notes/:id?chatKey=…        | 保留修订的逻辑删除                                            |
| GET /api/memory/notes/:id/history?chatKey=…   | 笔记修订，包含删除或过期状态                                  |
| GET /api/memory/status                        | 索引提供器、健康状态与积压                                    |

整理配置字段为 `enabled`、`shortIntervalMs`、`mediumIntervalMs`、`longIntervalMs`、`shortRetentionMs`、`mediumRetentionMs`；间隔至少1000毫秒。默认分别为30分钟、2小时、6小时、24小时、30天。

记忆来源二选一：消息 `{chatKey,localId,senderId}`，笔记 `{chatKey,noteId,noteRevision}`。保留现有维度和隐私校验。草稿包含 id、recordId、expectedRevision、patch、status、revision、createdAt，以及可选 publishedAt/error。重复提交旧修订、已有待整理草稿或目标事实已被替代时返回冲突。

Agent 的 memory_update 和重复属性的 memory_remember 同样返回草稿；新事实先进入短期。memory_search 仅使用已发布有效记忆。旧文本追加工具也走草稿；大段文本使用分层记忆按事实编辑。

`consolidatedAt` 表示该层记录已成功传递至下一层，笔记则表示已被短期整理吸收；自动到期归档同时要求该标记存在。`migratedFrom` 记录旧层级、修订及迁移时间，`legacyOrigins` 保存旧文件、来源 ID 与 SHA-256。GET 笔记列表支持 `history=1` 包含归档项。
