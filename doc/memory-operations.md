# 记忆运行维护

- 先查看 GET /api/memory/consolidation?chatKey=…，区分等待时点、运行中、失败重试。关闭自动整理后可手动整理；关闭插件或撤销准入后任务不应提交结果。
- 模型提炼失败不推进消息游标。任务错误和用量保存在运行记录；修复渠道、模型或超时设置后可重试。没有新增消息时不会为了整理调用模型。
- 索引失败只影响检索速度，不改变记忆事实。状态接口显示提供器和积压；恢复后按索引事件续传，重启可重建。历史版本不能因索引迟到而重新成为事实。
- 到期且已成功传递一次的记忆才转入历史；到期但未整理的内容仍保留。笔记成功进入短期后才允许自然过期。笔记删除、过期均保留修订。记录与笔记都不能靠删除索引清空，必须使用管理接口。
- 生产升级前使用 upgrade-management 工具做预览与备份。SQLite 新版为 user_version=3；回到旧后端时同时恢复升级前数据库和配置，禁止直接用旧程序打开新版库。
- 自动化测试只使用临时数据和 mock 模型、网络、QQ、SnowLuma。三层行为使用可控时钟，无需真实等待小时级间隔。

代码入口：plugins/agent-memory/src/consolidation.ts、service.ts，以及 storage-sqlite/storage-file 的记忆仓储。验收用例：tests/memory-consolidation.test.ts、tests/memory.test.ts、tests/e2e/memory.spec.ts。
