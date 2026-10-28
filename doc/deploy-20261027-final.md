# 2026-10-27 技能、队列与扩展最终部署

此文为19:29历史版本。21:18已升级到新一批管理界面和触发修复，当前版本及备份以[管理升级发布记录](management-console-upgrade-20261027.md#正式发布与回滚)为准。

最终于19:29确认PM2在线、HTTP就绪、OneBot已连接、便携QQ及内部托管SnowLuma运行。管理令牌保持关闭。当前PID14392，运行时插件41项、失败0，重启计数0，PM2已save。此文档取代本日早期运行快照；原审计及失败尝试保留供追溯。

## 本次交付

- 技能脚本：无会话容器绑定时JS使用Worker降级；有可用绑定时JS／Python／Shell在容器执行。容器失败不偷偷改在宿主重跑，取消会终止受控执行。
- 使用真实Podman构建并验收镜像 localhost/qq-harness-skills:26.10，正式配置已采用该镜像。Docker只做mock。正式当前没有会话绑定，需要在容器页为目标会话绑定后才使用容器后端。
- 独立排队等待超时及执行超时、持久队列意图、重启恢复、取消和离线检查。只恢复尚未执行项，不自动重放已开始项。
- 实际安装98包入口，3个旧包由原生图片工坊／三层记忆替代。仓库32技能、74插件项（含5管理器），工具页显示39个扩展工具，配有参数表和React抽屉。关闭的包仍关闭，开启后按所属会话生效。
- 7会话50处开启设置与预览逐项一致，无差异；15个私有数据文件已迁移，原有新版文件优先。本次正式二次应用新增文件为0，避免重复覆盖。
- 旧long-memory工具接统一三层记忆，不另建SQLite；发送、表情策略、网页代理及self-surf使用公开服务和运行边界。

## 版本和证据

- 验收构建：D:\QQAgent\qq-harness\var\builds\acceptance-1793100394144
- 固定版本：D:\QQAgent\qq-harness\var\releases\2026-10-27T11-28-40.769Z-5988805b
- 扩展代码根：D:\QQAgent\qq-harness\var\extension-releases\legacy-1793100003853
- 完整日志：var/verification/acceptance-1793100394144
- 230项单元／集成、17项浏览器、103项兼容层断言、类型、构建、架构及46项依赖检查全部通过。
- 全包基础审计：var/package-audit-1793098791476；98加载／启停／卸载，3原生替代。
- 组合及接口演练：var/extension-rehearsal-1793098754486/runtime-rehearsal.json。
- 真实技能容器：var/skill-acceptance-1793094395737/acceptance.json；独立测试容器已清理。
- 正式接口检查：var/production-upgrade-http-1793099992974.json；目录106项，无加载错误，UI贡献及工具目录HTTP200。
- 浏览器检查无脚本错误：技能列表（人工截图仅保存在本机）、工具列表（人工截图仅保存在本机）、参数详情（人工截图仅保存在本机）。长说明截取三行，操作按钮固定横排，完整说明在详情中可读。

本轮自动化mock QQ、SnowLuma、网络和模型。正式浏览器只做查看，没有主动发送QQ测试消息。98包基础生命周期及21包局部业务测试不等于全部业务完全对齐；剩余功能逐项列在[验收矩阵](parity-matrix.md)。

## 快照与回滚

最终UI更新前快照：D:\QQAgent\qq-harness\var\backups\capabilities-2026-10-27T11-28-38.504Z（533文件）。扩展正式安装前快照：D:\QQAgent\qq-harness\var\backups\capabilities-2026-10-27T11-22-04.147Z。

当前版本指针备份：D:\QQAgent\qq-harness\var\production\backups\release-4734965b-b4b8-455a-8cd3-ee3287250b4e。它恢复到19:22已修复性能的版本及相同扩展根，保留后续聊天、记忆和运行数据。

```powershell
node manage.mjs stop
node --import tsx tools/promote-release.ts --restore="D:\QQAgent\qq-harness\var\production\backups\release-4734965b-b4b8-455a-8cd3-ee3287250b4e" --apply --offline
node manage.mjs start --all
node manage.mjs status
node manage.mjs save
```

需要回退本批扩展状态时，先按版本备份链回退到扩展安装前指针，再离线恢复扩展状态；不得在仍使用新扫描根时只移除清单。扩展数据备份：D:\QQAgent\qq-harness\var\production\backups\extensions-3cbd5b03-af82-463d-a29f-86f0b5e2fee2；安装前指针备份：D:\QQAgent\qq-harness\var\production\backups\release-6706b03f-6d1c-44f8-b804-795bafcdb7ab。此旧指针的原目录占位清单已暂存为 installed-catalog.before-runtime-fix.json；保留该暂存状态，避免重启未修复性能的旧版本时再次生成大目录。

```powershell
# 在先完成上一个版本指针回退后执行；全程保持后端停机。
node manage.mjs stop
node --import tsx tools/promote-release.ts --restore="D:\QQAgent\qq-harness\var\production\backups\release-6706b03f-6d1c-44f8-b804-795bafcdb7ab" --apply --offline
node --import tsx tools/install-extension-migration.ts --data-dir="D:\QQAgent\qq-harness\var\production" --restore="D:\QQAgent\qq-harness\var\production\backups\extensions-3cbd5b03-af82-463d-a29f-86f0b5e2fee2" --offline
node manage.mjs start --all
node manage.mjs save
```

两个恢复工具均检查当前指纹，若上线后设置／数据已修改会拒绝覆盖；按实际差异处理，不丢弃新数据。一般操作流程见[上线回滚工具](release-operations.md)，实现与故障修复见[本轮记录](runtime-completion-20261027.md)。
