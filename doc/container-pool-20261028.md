# 容器资源池交付记录 · 2026-10-28

本批只修改 qq-harness；旧项目只读。规则、API、资源与用户关系、权限边界及回滚命令见 [容器文档](containers.md)。

已实现独立资源池、多对多绑定、会话默认容器、可选 containerId、已有 Podman / Docker 容器发现与登记。创建资源不再需要 QQ 会话号，QQ 号仅用于会话绑定和 g/p 用户映射。

账号首次任务时创建，私有 home/workspace/tmp 均0700。实际任务非root、CapEff=0、NoNewPrivs=1。取消通过容器内监控只清理本任务进程树；插件卸载和宿主停止保留共享容器。管理员整体停用明确影响全部绑定会话，工具不能绕过。取消清理失败会持久化隔离，重启后仍需先确认清理再启用。

页面改为资源池／引擎配置／执行与任务三个分区，提供外部发现抽屉、多会话绑定抽屉、会话多选及默认项；停止和删除均使用 React 确认。默认会话不能绑定；会话页没有创建入口。

## 独立实测

- `var/container-pool-acceptance-R4Z0qJ/acceptance.json`：实际 Podman 多对多、UID/GID、0700、中文文件隔离、不同容器选择、跨UID kill拒绝、double-fork/setsid取消、另一个会话任务继续、超时、整体停用、卸载、重启持久化。
- `var/skill-acceptance-1793116749527/acceptance.json`：JS降级Worker，绑定后JS／Python／Shell容器执行，Python身份非root，解绑换绑私有文件隔离，取消后容器继续运行。
- `var/container-verify-real.log`：Agent容器工具、中文文件、后台任务、取消、超时、卸载恢复、宿主重启、清理。
- 所有测试容器显式清理，mock QQ／模型，QQ发送数0。用户原 `QQ-agent-script-runtime` 未执行测试命令、未改标签或用户。

## 数据与部署

上线前预览 `var/container-pool-migration-preview.json`：旧资源0、绑定0，配置与owner保留。迁移工具默认只读，写入需停止实例并显式 `--apply --offline`；SQLite／文件后端都验证了幂等、备份及回滚。

最终验收批次、备份、版本和PM2状态见下方。本机已有容器只做了解释器路径检查，确认具备 python3、useradd、groupadd、node、sh；没有用真实容器执行权限或技能测试。

## 最终验收与部署

候选 `var/builds/acceptance-1793117461766` 全部通过：275项单元／集成（54文件）、32项浏览器、103项旧兼容层断言、typecheck、build、architecture、48插件依赖检查。容器测试17项，覆盖mock Docker／Podman和两种存储迁移回滚。验收日志 `var/verification/acceptance-1793117461766/`。

上线时间00:13（Asia/Shanghai）；版本目录日期使用UTC：`var/releases/2026-10-27T16-13-01.562Z-5f92a46d`。PM2 PID13396 online、重启0并save；3310就绪、OneBot connected、43原生插件失败0；QQ PID9668 / SnowLuma PID20864 running。扩展版本和令牌设置保持原样，config.json SHA与停机前相同。

备份与回滚凭据：

- 完整停机快照：`var/backups/capabilities-2026-10-27T16-12-58.522Z`（787文件）。
- 资源池键备份：`var/production/backups/container-pool-2026-10-27T16-13-01-459Z-6790186f`。
- 原版本指针：`var/production/backups/release-14105d61-8db1-4417-99ac-afabdba73d7d`。
- 部署报告：`var/container-pool-deployment.json`；正式检查：`var/container-pool-production-check.json`、`var/container-pool-pm2.json`。

上线后将 `QQ-agent-script-runtime` 登记为外部资源，绑定0、未创建会话账号。登记前后ID、名称、镜像、标签、主进程PID及运行状态完全相同。亮／暗页面无pageerror和横向溢出。再次迁移预览changed=false，资源1、绑定0。

如果立即回滚，先在资源池取消该外部容器登记（不删除容器），停止后端，再用对应资源池备份还原和版本指针备份执行回滚。若已新增绑定，先导出pool-v2并人工映射，禁止覆盖后来产生的绑定；完整数据快照只用于确认范围后的恢复，不盲目覆盖新的聊天记录。

```powershell
node manage.mjs stop
node --import tsx tools/upgrade-container-pool.ts --data-dir=D:\QQAgent\qq-harness\var\production --restore=D:\QQAgent\qq-harness\var\production\backups\container-pool-2026-10-27T16-13-01-459Z-6790186f --apply --offline
node --import tsx tools/promote-release.ts --restore=D:\QQAgent\qq-harness\var\production\backups\release-14105d61-8db1-4417-99ac-afabdba73d7d --apply --offline
node manage.mjs start --all
node manage.mjs save
```

## 页面截图

资源池（正式亮色）（人工截图仅保存在本机） · 资源池（正式暗色）（人工截图仅保存在本机） · 共享资源（合成数据）（人工截图仅保存在本机） · 会话选择（合成数据）（人工截图仅保存在本机）
