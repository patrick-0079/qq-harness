# 独立构建、上线及回滚

2026-10-27 21:18批次的实际版本、停机快照、扩展备份与完整回滚命令见[管理升级发布记录](management-console-upgrade-20261027.md#正式发布与回滚)。

22:38布局批次的当前版本、快照与回滚命令见[界面布局发布记录](ui-layout-redesign-20261027.md#正式发布)。

23:09回复上限、首条引用与正文空间批次的当前版本和回滚命令见[回复限制发布记录](reply-limits-20261027.md#正式发布与复核)。

所有命令在 `D:\QQAgent\qq-harness` 执行。测试构建使用 `var/builds`，正式固定版本使用 `var/releases`。`scripts/start-live.mjs` 是 PM2 的稳定入口，读取 `var/production/launch.json` 的 `releaseDirectory`；未指定时兼容原 `dist`。扩展可指定 `extensionDirectory`，只接受 `var/extension-releases` 内不含符号链接的目录；未指定时使用 `extensions-v2`。两个路径在一次启动指针切换中保存、备份和恢复。

## 验收与预览

```powershell
node --import tsx tools/verify-release.ts
node --import tsx tools/promote-release.ts --candidate="D:\QQAgent\qq-harness\var\builds\acceptance-具体编号"
# 本次同时升级扩展时，预览和正式应用都使用同一 --extensions 参数。
node --import tsx tools/promote-release.ts --candidate="D:\QQAgent\qq-harness\var\builds\acceptance-具体编号" --extensions="D:\QQAgent\qq-harness\var\extension-releases\具体目录"
node --import tsx tools/migrate-native-media.ts --source="D:\QQAgent\backup\source" --data-dir="D:\QQAgent\qq-harness\var\production"
```

验收顺序为类型、单元／集成、旧兼容层、架构、依赖、构建和浏览器。完整通过后写入构建内 `verification.json`，记录检查退出码、日志、源码指纹与逐文件 SHA。浏览器使用该构建的后端和页面，mock QQ、SnowLuma、网络及模型。源码或构建变化后须重新验收。

## 上线

```powershell
node manage.mjs stop
node --import tsx tools/snapshot-release.ts --offline
node --import tsx tools/promote-release.ts --candidate="D:\QQAgent\qq-harness\var\builds\acceptance-具体编号" --apply --offline
node --import tsx tools/migrate-native-media.ts --source="D:\QQAgent\backup\source" --data-dir="D:\QQAgent\qq-harness\var\production" --apply --offline
node manage.mjs start --all
node manage.mjs status
node manage.mjs save
```

保存每个工具返回的快照和备份目录。版本切换取得生产数据锁，拒绝在线覆盖；检查构建哈希后复制到新的固定目录，最后原子切换启动指针。启动端口、令牌设置、QQ／SnowLuma 路径及其他启动字段保留。媒体迁移单独备份；已有备注优先，旧图片只迁入本工程数据目录。

检查 HTTP 就绪、PM2 在线、插件无失败、OneBot 连接及 QQ／SnowLuma 状态。完成前不把预览扩展放入正式目录。

### 同时升级旧包

先在独立数据中生成扩展代码根并完成加载／生命周期与组合演练，再只读预览目标根、正式状态差异及代码SHA。保留旧扩展根供回滚；代码根不作为开发构建输出覆盖。

```powershell
node --import tsx tools/install-extension-migration.ts --preview="预览绝对目录" --data-dir="D:\QQAgent\qq-harness\var\production" --extensions="D:\QQAgent\qq-harness\var\extension-releases\具体目录"
node manage.mjs stop
node --import tsx tools/snapshot-release.ts --offline
node --import tsx tools/install-extension-migration.ts --preview="预览绝对目录" --data-dir="D:\QQAgent\qq-harness\var\production" --extensions="D:\QQAgent\qq-harness\var\extension-releases\具体目录" --apply --offline
node --import tsx tools/promote-release.ts --candidate="验收构建绝对目录" --extensions="D:\QQAgent\qq-harness\var\extension-releases\具体目录" --apply --offline
node manage.mjs start --all
node manage.mjs save
```

保存安装器和版本切换分别返回的备份目录。已存在的新版配置与私有文件优先；迁移标记按指纹保存在每个数据目录自己的SQLite中，预备代码不等于正式数据已迁移。停机后使用 try/finally 保证失败也恢复服务。

## 回滚

```powershell
node manage.mjs stop
node --import tsx tools/migrate-native-media.ts --data-dir="D:\QQAgent\qq-harness\var\production" --restore="媒体迁移返回的备份绝对目录" --apply --offline
node --import tsx tools/promote-release.ts --restore="版本切换返回的备份绝对目录" --apply --offline
node manage.mjs start --all
node manage.mjs status
node manage.mjs save
```

版本指针回滚恢复原始 launch.json 字节；若切换后启动配置已被修改则拒绝覆盖。媒体回滚也会拒绝删除迁入后已被修改的新文件，避免覆盖新数据。上线后继续产生的聊天、记忆和运行记录不因切换版本而回退。只有必须恢复整个停机快照时才另行离线恢复数据与对应构建，并明确期间新增数据的处理方式。

扩展一同升级时，在停机后先执行上述 `promote-release --restore` 恢复原后端及扩展目录指针，再执行 `install-extension-migration --data-dir=... --restore="扩展迁移返回的正式备份" --offline` 恢复扩展状态，最后启动并保存PM2。安装器会拒绝覆盖迁移后已变化的配置／文件；此时按差异处理，不能强行丢弃上线后数据。回滚保留新代码供诊断，单独移除清单不会停用扫描目录的实际代码。
