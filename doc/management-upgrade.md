# 管理系统升级、迁移与回滚

> 2026-10-28 的记忆升级不再把中长期降为短期，请按 [独立记忆 Agent 说明](memory-agent-20261028.md)备份和部署；下述旧迁移命令不适用于本次记忆升级。

仅操作 qq-harness 的目标实例；旧 backup/source 不执行、不修改。自动化使用临时数据、mock QQ／SnowLuma／网络／模型。正式迁移在验收通过后离线执行。

## 升级内容

保留已生效的人设、聊天策略、会话完整快照、凭据及运行路径；将迁移档案中的人设／提示词／模型渠道接入可管理目录。原有中长期有效事实转为短期，原文、来源和历史修订保留，设置新的短期保留期。旧版印象、memory-plus、长期 SQLite 中的有效记录导入短期，记录来源文件 SHA-256，不加载原代码。已归档内容不重新激活。

导入使用确定性 ID，重复运行不会产生重复记忆。现有会话元数据优先。`--session-admission` 移除生产 launch.json 的旧 allowedChats，准入统一由会话目录与独立配置决定；显式联调进程仍可设置额外边界。

工具在写入前取得与服务器共用的数据目录锁：拒绝活进程，确认不存在的旧 PID 锁才会清理。备份包含配置、启动设置、SQLite 一致性快照、文件记忆、迁移标记和来源档案；清单逐文件 SHA 校验。迁移失败自动恢复备份。

## 上线顺序

在 `D:\QQAgent\qq-harness` 执行：

```powershell
npm run typecheck
npm test
npm run build
npm run check:architecture
npm run check:dependencies
npm run test:e2e

# 预览只输出统计，不输出记忆正文或凭据
node --import tsx tools/upgrade-management.ts --data-dir=D:\QQAgent\qq-harness\var\production --reference-root=D:\QQAgent\backup\source --session-admission

# 仅停止本工程实例；正常关闭会回收其自有子进程
node manage.mjs stop

# 离线应用，输出本次备份目录
node --import tsx tools/upgrade-management.ts --data-dir=D:\QQAgent\qq-harness\var\production --reference-root=D:\QQAgent\backup\source --session-admission --apply --offline

# SnowLuma 就绪后启动 QQ；沿用已保存路径和协议同意
node manage.mjs up
node manage.mjs status
node manage.mjs save
```

打开本机 3310，检查会话名称／人设／渠道、短期迁移记录及整理设置，确认 OneBot 连接与容器镜像就绪。容器实际验收使用 Podman 的 `docker.io/library/ubuntu:26.10`，通过后在页面保存该镜像。当前本机控制台按用户要求不启用管理令牌；QQ／OneBot／模型凭据仍保留。

真实收发及付费模型效果由操作者选择会话验收；本轮自动化不发送真实聊天消息。可先下线会话核对设置，再人工上线。新复制 QQ 副本的启动异常仍单列记录，当前使用旧版可用安装路径。

## 回滚

先 `node manage.mjs stop`，使用本次输出的备份绝对路径：

```powershell
node --import tsx tools/upgrade-management.ts --data-dir=D:\QQAgent\qq-harness\var\production --restore=<本次备份绝对路径>
node --import tsx tools/upgrade-management.ts --data-dir=D:\QQAgent\qq-harness\var\production --restore=<本次备份绝对路径> --apply --offline
```

第一条验证备份及展示恢复项，第二条离线恢复。数据库、配置和迁移标记必须一起恢复。若回退到旧版本程序，还需部署与备份匹配的旧构建；不能仅把旧程序放在新版数据库上运行。本轮 SQLite／文件仓储测试验证了迁移幂等、旧来源不变和数据配置回滚；它不代替旧版本构建制品的归档。

本次正式执行统计与验证结果记录在 [验收报告](management-verification-20261027.md)。
