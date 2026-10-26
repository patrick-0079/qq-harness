# 记忆 API 与 Agent 工具

本页对应 `plugins/agent-memory` 当前实现。所有 Agent 工具以**当前运行绑定的 `chatKey`**为准，不接受模型自行指定其他会话。HTTP 管理接口受宿主的 Host/Origin 和可选 `HARNESS_TOKEN` 控制；设置令牌时使用 `Authorization: Bearer <token>`。`chatKey` 使用 `group:<群号>` 或 `private:<QQ号>`，`personId` 使用 QQ 号字符串。

## Agent 工具

| 工具                                 | 输入                                                                                                                   | 结果与边界                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `memory_search`                      | `query` 必填；`personId`、`limit` 可选                                                                                 | 返回相关中长期记录和最多 5 条近期匹配消息。`limit` 为 1–20，默认 8；指定人员必须属于当前会话。                                       |
| `memory_remember`                    | `scope`=`chat`/`chat_person`，`tier`=`medium`/`long`，`key`、`text`、`sourceIds` 必填；`personId` 与 `importance` 可选 | 来源 ID 必须是当前会话真实入站消息。相同事实键与文本返回 `duplicate`，冲突键先使旧事实失效。Agent 不能直接建立跨会话 `person` 记忆。 |
| `memory_update`                      | `id`、`text`                                                                                                           | 只能修正当前会话或会话成员记录。                                                                                                     |
| `memory_delete`                      | `id`                                                                                                                   | 软删除当前会话或会话成员记录，历史仍可核查。                                                                                         |
| `memory_query`                       | 无                                                                                                                     | 兼容读取当前会话旧文本记忆，返回 `{content}`。                                                                                       |
| `memory_append`                      | `text`                                                                                                                 | 兼容追加当前会话旧文本记忆，最多 10 万字。                                                                                           |
| `scratchpad_list` / `scratchpad_get` | `get` 需要 `id`                                                                                                        | 只读取当前会话未到期暂存。                                                                                                           |
| `scratchpad_upsert`                  | `text` 必填；`id`、`sourceIds`、`ttlDays` 可选                                                                         | 不给 `id` 则创建；给 `id` 则修改。`ttlDays` 为 1–90，实际期限不超过会话上限。                                                        |
| `scratchpad_delete`                  | `id`                                                                                                                   | 删除当前会话条目。                                                                                                                   |
| `scratchpad_mark_important`          | `id`                                                                                                                   | 触发有证据的会话中期整理；返回当前 `promotion` 状态。                                                                                |

工具的 `memory_search` 结果为了控制上下文长度，只给 ID、范围、层级、人员、正文（最多 4000 字）、置信度、排序分及近期消息摘要。要看完整来源和修订，使用管理页或 HTTP 管理接口。

## HTTP 路由

| 方法与路径                             | 参数或请求体                                                  | 响应                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/memory/status`               | 无                                                            | `{provider,ready,pending,error?}`。`pending` 是待索引事件数。                                        |
| `GET /api/memory/records`              | 查询 `chatKey` 必填、`personId` 可选                          | 当前会话可见的完整活动记录数组。人员筛选须属于当前会话。                                             |
| `GET /api/memory/search`               | 查询 `chatKey`、`query` 必填，`personId` 可选                 | `[{record,score}]`；只返回相关性大于 0 的记录。                                                      |
| `POST /api/memory/records`             | 结构化记录输入                                                | 创建人工事实，返回完整记录与 HTTP 201。服务将 `origin` 设为 `admin`。                                |
| `PATCH /api/memory/records/:id`        | `{expectedRevision,patch}`                                    | 乐观锁修订；`patch` 可改范围、层级、键、正文、可见性、敏感性、可信度、重要性、固定、来源和到期时间。 |
| `POST /api/memory/records/:id/promote` | `{chatKey,target,expectedRevision}`，`target`=`long`/`person` | 提升中期为长期，或把非敏感会话成员事实人工提升为通用个人事实。                                       |
| `DELETE /api/memory/records/:id`       | 查询 `revision` 必填                                          | 软删除并返回修订后的记录。                                                                           |
| `GET /api/memory/records/:id/history`  | 查询 `chatKey` 必填                                           | 当前会话可查看的修订数组，含旧正文与状态。                                                           |
| `GET /api/memory/notes`                | 查询 `chatKey` 必填                                           | 当前会话未到期暂存数组。                                                                             |
| `POST /api/memory/notes`               | `{chatKey,text,sourceIds?,ttlMs?}`                            | 创建暂存并返回 HTTP 201。                                                                            |
| `PATCH /api/memory/notes/:id`          | `{chatKey,patch:{text?,important?,sourceIds?,ttlMs?}}`        | 更新正文、证据、期限或重要标记。                                                                     |
| `DELETE /api/memory/notes/:id`         | 查询 `chatKey` 必填                                           | `{ok:true}`。                                                                                        |

旧 `GET /api/chats/:chatKey/memory` 返回 `{text}`，旧 `PATCH /api/chats/:chatKey/memory` 接受 `{text}`，仍修改原会话文本记忆。历史路由会返回旧修订正文，应按聊天数据对待；只将管理 API 暴露给可信管理员。

## 创建记录示例

下面的 JSON 可作为 `POST /api/memory/records` 请求体。示例由管理员明确录入，无来源消息，因此应根据实际证据调整 `confidence`，不能把它当作已由聊天证实的事实。

```json
{
  "scope": "chat",
  "tier": "long",
  "chatKey": "group:10001",
  "personId": null,
  "key": "weekly-topic",
  "text": "每周五讨论项目进度",
  "visibility": "chat_only",
  "sensitive": false,
  "confidence": 0.8,
  "importance": 0.6,
  "pinned": false,
  "sources": [],
  "origin": "admin",
  "expiresAt": null
}
```

`chat_person` 需要 `chatKey` 和 `personId`；`person` 需要 `personId`、`chatKey:null`、`visibility:"cross_chat"` 且 `sensitive:false`。会话范围只能用 `chat_only`。中期记录需填未来的 Unix 毫秒 `expiresAt`；长期必须填 `null`。新增 `sources` 的每条引用需是现存入站消息且发送者匹配。修改与删除前读取最新 `revision`，再传 `expectedRevision` 或 `revision`；陈旧版本会被拒绝，不能静默覆盖人工修正。

输入格式错误返回 HTTP 400（`INVALID_INPUT`）；其他记忆操作错误通常返回 HTTP 409（`MEMORY_ERROR`）。模型和工具调用仍受宿主原有运行取消与超时规则控制。
