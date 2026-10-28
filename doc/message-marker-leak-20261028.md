# 引用控制标记漏出排查与修复（2026-10-28）

## 定位

运行 `9a985d6e-3b56-497b-9551-f662c8acfc0f` 共发送两条消息，第一条带有字面量 `〖reply:<消息ID>〗`，第二条没有控制标记。模型收到的 send_message 工具描述提供了标准 `⟦reply:<消息ID>⟧`，实际输出时使用了另一组相似括号。引用目标确实属于当前会话。
原解析器仅识别 U+27E6/U+27E7（⟦⟧），未识别 U+3016/U+3017（〖〗），因此该消息按普通文本进入发送队列。问题发生在发送标记解析阶段。

## 修复与验证

- 兼容 〖reply:…〗、〖replay:…〗、〖at:…〗 和 〖@…〗；统一生成原生引用／提及分段，控制标记不进入正文。
- 两组括号混用时仍然每条消息只取首个引用；保留引用归属、私聊提及、无效 QQ、空消息校验。
- 未闭合控制标记被清除；普通 `〖说明〗` 和 Markdown 标题保持原样。
- 对本次运行的原始工具参数只读重放：首条产生一个原生 reply 分段，正文长度 12 且无控制标记；第二条保持原样。验证没有触发实际发送。
- 新增回归覆盖相似括号、混合引用与提及、错误目标、未闭合标记，以及 send_message 到 outbound 的实际分段和留档。
- 完整验收通过：312 项单元测试、39 项浏览器测试、103 项兼容断言、类型／架构／依赖检查和构建。

## 正式发布

- 发布版本：`D:\QQAgent\qq-harness\var\releases\2026-10-28T05-50-12.273Z-7d3e60f7`。
- 发布前完整快照：`D:\QQAgent\qq-harness\var\backups\capabilities-2026-10-28T05-50-07.946Z`。
- 回滚指针备份：`D:\QQAgent\qq-harness\var\production\backups\release-8496840b-aadc-4e65-8e72-7ee877e5a349`。
- 备份 1166 个文件哈希校验通过；SQLite integrity_check 为 ok。
- 原配置完全一致，私聊运维保持开启；原有记忆与草稿全部保留。原运行和两条消息记录逐字节核对未变，修复作用于后续发送。
- 发布后系统在线、OneBot 连接、原生插件无失败，QQ 与 SnowLuma 正常运行。
- 只读排查证据：`var/message-marker-leak-evidence.json`；发布证据：`var/deploy-message-markers-state.json`；测试日志：`D:/QQAgent/qq-harness/var/verification/acceptance-1793166439328`。
