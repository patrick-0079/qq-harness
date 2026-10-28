# 搜索、网页、图片与转发能力恢复（2026-10-27）

范围：仅修改 qq-harness，backup/source 只读。正式实例已升级这批能力；全量旧业务仍以 [验收矩阵](parity-matrix.md) 跟踪，不能把本报告视为全部迁移完成。

## 已修复的实际原因

| 问题 | 原因与处理 |
|---|---|
| 搜索／网页不可用 | 正式进程缺少 web-tools，旧搜索配置没有迁入；补回服务并恢复全局配置。固定旧提供方算法，适配 Bing 附加属性／类名和单引号。 |
| 独立运行时报 require 未定义 | 工具算法是 CJS 产物，ESM 包装缺少 createRequire；修复生成器，并增加真实 Node 子进程回归，避免测试运行器掩盖问题。生成文件改为原子替换。 |
| 网页乱码／大网页失败 | 增加 gzip、br、deflate 解码、原始字符集处理、浏览器请求头、最终 URL 和限量截断；重定向每跳重新校验。 |
| 图片只变成 JSON | Agent 将真正的图片部件放入随后 user 多模态消息，全部 tool 回复先完成；按会话选择视觉模型。大静态图只在模型传输前压缩，保留原图。GIF 被接口拒绝时可换首帧重试。 |
| 历史图片、过期地址失败 | 保留入站 CQ／数组段；缺媒体时从同一已记录消息 get_msg 恢复，失效地址可 get_image 刷新。QQ 刚发送时可能返回空地址，不能覆盖已知的原始图片。全部加载失败明确标为工具错误。 |
| 转发读取失败 | 恢复 id／res_id／forward_id／data_id、CQ 节点、多层引用和资源过期刷新；负数消息哈希不作为转发资源 ID。最多沿引用追踪5次、嵌套8层，限制已发现记录并防循环，展开结果及关联图片持久化。 |

安全边界保持：只解析当前消息已记录的媒体；HTTP 接口不接收任意 URL／宿主路径。网页禁止内网，图片的旧私有图床例外仅由管理员全局配置开启。模型和 QQ 凭据不进入日志或公开配置。

## 验收结果

- 自动化：155 项单元／集成、14 项浏览器、103 项旧兼容层断言通过；typecheck、构建、架构与45项原生／示例插件依赖检查通过。自动化使用 mock QQ、SnowLuma、网络和模型。
- 人工实测：按用户授权，仅使用私聊10002及群10001，独立数据、启动级 allowedChats 边界；所有实际发送经过 outbound。
- 搜索返回6条结果；网页抓取 HTTP200，返回测试页正文。
- 私聊与群聊控制图片进入真实视觉模型，均正确识别两部分颜色；群聊使用 QQ 返回的真实媒体地址。
- 用户主动发送的图片读取成功；用户的合并转发读到4个节点，展开1条嵌套记录，图像进入视觉模型；引用该转发的消息亦完成同样读取。结果已通过 QQ 私聊反馈。
- 程序上传的一份测试转发，SnowLuma 返回图片段但地址和文件号均为空，这种协议数据无法凭空恢复。此情况明确返回不可用；用户实际发来的转发图片已通过。两者分别记录，不混为成功。

证据：`tests/capability-recovery.test.ts`、`tests/capsule-migration.test.ts`、`tests/capability-upgrade.test.ts`。人工结果保存在独立联调目录的 evidence.json / incoming-evidence.json；报告只保留计数，不复制用户图片、转发正文或模型描述。

## 正式升级与回滚

2026-10-27 11:09（北京时间）已完成能力配置升级，随后确认 PM2 online、HTTP3310就绪、40项运行时插件无失败、OneBot连接、便携QQ及内部托管SnowLuma运行。管理令牌保持关闭。六个关键工具在正式目录中均为启用状态。

升级逐字段预览708项，主要为此前未迁入的 legacyGlobal；三层记忆、记忆间隔覆盖、现有会话策略与模型选择、OneBot、QQ/SnowLuma路径、launch及扩展状态保留现值。第二次预览为0差异，幂等验证通过。

完整停机数据和本轮已验收构建快照：
`var/backups/capabilities-2026-10-27T03-08-45.857Z`，315文件，约16.6MB。

配置原始字节备份：
`var/production/backups/capabilities-2026-10-27T03-09-00.344Z-e76c9a38`。

```powershell
node manage.mjs stop
node --import tsx tools/upgrade-capabilities.ts --data-dir=D:/QQAgent/qq-harness/var/production --restore=D:/QQAgent/qq-harness/var/production/backups/capabilities-2026-10-27T03-09-00.344Z-e76c9a38 --apply --offline
node manage.mjs start --all
node manage.mjs save
```

回滚命令恢复本次配置修改，不恢复已发生的 QQ 发送。快照中的构建为本轮验收版本，不能宣称是上一进程加载的旧二进制。完整旧包迁移及其整体回滚仍待逐项完成。

## 接口与限制

- `GET /api/tools?scope=default`：工具 schema、归属、开关与不可用原因；会话 scope 为 group:N 或 private:N。
- `GET /api/message-media/:chatKey/:localId`：所属消息媒体列表；`?refresh=1` 刷新原消息；`/:index` 返回图片二进制。
- `GET /api/run-details/:id?after=N`：增量轨迹，含上下文、请求响应、工具参数／结果和发送；独立 gzip 载荷，默认30天。
- `web_search({query})`、`web_fetch({url})`；`get_message_images({messageId})`；`read_forward({messageId,refresh?})` 或已发现的 `{recordId}`。

尚待全量对齐：GIF转视频、video auto完整选路、FFmpeg实机、旧表情／绘画历史数据、其余扩展业务和旧管理路由。详见验收矩阵，不以“已注册”代替行为完成。
