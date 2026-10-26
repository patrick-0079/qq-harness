# v2 扩展体系迁移

扩展框架已迁入本工程，通过 `extension-system` Cordis 插件接入。核心内核不认识七个目录，也不依赖兼容层。所有运行时配置、扩展状态和会话覆盖写入当前实例的 SQLite，不读取旧部署配置或聊天数据。

## 结构与兼容策略

| 位置                                 | 职责                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `packages/extension-compat/vendor/`  | 原框架算法、五个项目内置管理器、四组原契约测试及 LICENSE；SHA-256 记录在 provenance.json |
| `packages/extension-compat/bridge/`  | 配置、会话作用域、模型服务适配                                                           |
| `packages/extension-compat/src/`     | TypeScript 宿主、SQLite 配置、生命周期、旧工具到新工具服务的桥                           |
| `scripts/build-extension-compat.mjs` | 构建独立运行时工厂，替换环境入口；原 JS 快照保持原文便于核对                             |
| `plugins/extension-system/`          | Hono 路由、旧五钩子及模型能力接线、React 管理页面和声明式 UI 渲染                        |
| `extensions-v2/`                     | 默认用户扩展落点，与原生双端扩展的 `extensions/` 分开                                    |

新宿主、服务与 React 页面使用 TypeScript strict。原算法保留 JS，避免同时更换框架、重写算法造成行为漂移。构建把原模块状态放进工厂函数，每个宿主独立创建管理器、能力表、工具表、文档表和 UI 注册表。它不是运行时导入旧检出，也不启动旧应用。

## 七目录与行为

| 目录             | 清单 / 入口                       | 保留行为                                                                     |
| ---------------- | --------------------------------- | ---------------------------------------------------------------------------- |
| `plugins/`       | `plugin.json` / `index.js`        | 全局插件、生命周期、能力、依赖、UI 贡献；会话不能停用全局插件                |
| `chat-plugins/`  | `plugin.json` / `index.js`        | 会话插件、五个旧钩子、独立设置；不能登记管理面钩子或全局 UI                  |
| `tools/`         | `tool.json` / `index.js`          | 类型闸门、owner 归属、工具注册、设置、文档索引                               |
| `mcp/`           | `mcp.json`                        | stdio / HTTP、initialize、tools/list、tools/call、shell 工具策略和富媒体结果 |
| `skills/`        | `skill.json` / scripts            | v1 工具型技能兼容；声明型技能脚本白名单、worker+vm 降级与容器后端注册接口    |
| `knowledge/`     | md/txt，可有 `knowledge.json`     | 目录树、L0–L3、load_doc、`.summery` 镜像、抽取式摘要、过期检查和原文编辑     |
| `promptinjects/` | `promptinject.json` / `inject.js` | append/rewrite、锚点排序、改写冲突、security 非空底线、同步函数限制          |

五个基础管理器是 `ext-tool`、`ext-mcp`、`ext-skill`、`ext-knowledge`、`ext-promptinject`，分别由 `plugins/v2-tools`、`v2-mcp`、`v2-skills`、`v2-knowledge`、`v2-promptinject` 五个独立 Cordis 插件装配，客户端也各自通过插槽登记管理面板。默认 profile 显式安装它们，宿主不会自动启动内置管理器；`createApplication({ v2Managers: false })` 只有空宿主和用户插件加载器，不提供工具包、MCP、技能脚本、知识或上下文注入能力。

管理器开关统一由原生插件生命周期控制，兼容配置中的 enabled 只是投影。关闭或卸载管理器会撤销所属页签、子扩展工具、文档和连接；重新安装恢复。子扩展由所属管理器插件加载、持有并回收，保留原有清单、API 和工具前缀规则，不伪装为核心内置功能。

旧五钩子 `before-context`、`before-llm-messages`、`after-response`、`before-tool`、`after-tool` 已接入实际 Agent 循环，按原先每扩展 5 秒的超时隔离错误。旧的 24 项 HookBus 目录仍可查询、注册和显式派发；与原工程一致，不把原先没有消费的 HookBus 注册自动当成正在执行的业务行为。

`llm.endpoint-pick`、`llm.endpoint-feedback`、`llm.request-params`、`llm.response`、`llm.usage`、`llm.retry-advisor` 接入 OpenAI 模型插件；参数降级建议最多重试一次。`tool.guard` 与 `chat.skip-run` 接入工具和触发流程。其他能力仍可经扩展服务查询和调用；旧单体专有的媒体预处理、裁判和主动话题流程不是此次迁入的运行模式。

旧工具发言通过当前运行绑定的 sender，支持批量文本、引用/@、图片、表情、消息段、文件，统一经过新 outbound 的准入、队列、限频、去重和留档。跨会话目标被拒绝；取消或宿主卸载后的迟到发送被拒绝。旧 v1 fetch 保留 Response 形状及常用请求方法，但增加 URL 校验、固定 IP、逐跳重定向检查与响应上限；v2 fetch 继续返回旧 safeFetch 结果。

## 配置、安装与前端

默认扩展根为本工程 `extensions-v2/`，可通过绝对路径环境变量 `HARNESS_V2_EXTENSION_ROOT` 修改；库调用使用 `createApplication({ v2ExtensionDir })`。测试不指定时使用独立数据目录中的 `extensions/`。请不要把扩展根指向生产检出。

浏览器进入「扩展仓库」可导入 ZIP 或文件夹：预览不写盘、冲突默认拒绝、允许显式覆盖、安装成功默认关闭。也可直接放入对应目录后点「重载扩展」；直接落盘包延续原清单的默认开关语义。热重载延续三个监听根：plugins、chat-plugins、skills；另外四类目录修改后点重载。

全局默认写 SQLite `plugin_state` 的 `extension-system/config`，会话完整快照写 `extension-system/profiles`；修改全局设置不影响已有会话快照。API 对密钥名和 schema.secret 字段脱敏，保存六个星号时保留原值。

React 页面按管理器目录加载七分类，支持设置、开关、恢复默认、删除、知识编辑及摘要操作；会话「会话扩展」页使用同一管理组件。声明式贡献渲染到导航、顶栏、会话列表/标题/扩展面板、模型设置、人设附加动作、总览附加卡片和扩展卡片；动作按 owner 调用，文本经 React 转义。iframe 使用无 same-origin 的 sandbox；第三方不能使用可信脚本页签。原工程只声明而未实际挂载的模块贡献仍不开放第三方执行。

## 边界

- 迁移的是扩展框架与基础管理器。没有复制社区包、旧 Key、会话设置或聊天数据。
- 遵守公开扩展 API 的包可以沿用格式；直接 import 旧 `src/orchestrator.js`、`OneBotClient`、表情管理器，或修改旧类原型的包依赖旧单体内部实现，需要另外改成宿主服务。此类包不能视作零修改兼容，加载错误会显示在管理界面。
- 容器后端注册协议已保留。另有新原生 Cordis 容器插件提供命令、文件与后台任务操作，见 [容器说明](containers.md)；尚未将 v2 技能执行器接到此运行时。旧终端、市场、第三方依赖安装和旧业务流程不在本次框架迁移里。worker+vm 沿用原定位，是能力降级执行器，不是对抗恶意代码的安全边界。进程内插件按本机可信代码处理。
- 当前运行模式提供人设、安全、工具协议、技能与管理员段落。旧完整提示词库中的其他业务段落没有自动复制；注入目标在当前模式不存在时，沿用管线跳过行为。
- 原 API 的主要 URL 与数据语义被保留，错误体统一使用 Hono 管理 API 格式；新 React 客户端不加载原 UI 脚本。

## 验证与更新

```powershell
npm run typecheck
npm test
npm run test:v2-reference
npm run build
npm run check:architecture
npm run test:e2e
```

原契约套件共 103 项断言：类型/描述符/工具 owner/HookBus 57，UI 26，知识树 9，降级沙箱 11；只替换测试 import 和环境，断言保持原文。新集成测试覆盖 SQLite 快照、实际五钩子、工具执行、MCP HTTP/stdio、模型增强、批量/媒体发送、热重载、安装与卸载、多实例隔离。浏览器覆盖导入与七页签、默认关闭、设置保存、管理器开关及原生双端插件。

`check:architecture` 同时核对 vendor SHA 和实际生成代码，阻止改写原文快照、运行代码引用旧检出或依赖 cwd。`build/typecheck/test` 自动构建兼容工厂，无需访问旧工程。后续需要有意更新快照时，使用 `node scripts/migrate-v2-sources.mjs <旧检出的绝对路径>`，审阅 provenance 变化并重跑全部验证。
