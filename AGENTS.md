# qq-harness

用户授权的新 TypeScript 重构工程。所有新增源码、脚本、测试与文档放在本目录；不修改 source/source-v2/source-v3，不修改 SnowLuma，不连接生产数据。

- ESM、TypeScript strict；注释解释设计边界与原因。路径以 import.meta.url 或显式 host 配置为准。
- kernel 只依赖 plugin-sdk 与 Cordis，不能依赖业务插件、HTTP、React 或 QQ。
- 服务、模式、扩展点、工具、路由和 UI 贡献必须绑定插件实例；卸载必须清理资源。
- 默认使用独立 var/ 开发数据，mock 适配器和 mock 模型；真实 OneBot 连接必须显式配置，端口默认 3310/5310。
- 所有发送走 outbound 服务，工具只能使用当前运行绑定的 chatKey。准入判断只由 access 服务提供。
- JSON 写入原子替换；配置 API 脱敏，禁止回传明文密钥。用户输入外部 URL 不能直接 fetch。
- 客户端仅消费 contracts/client-sdk；业务按钮、页面与子页面由插件注册，禁止 shell 按业务 id 分支。
- 验证：npm run typecheck、npm test、npm run build、npm run check:architecture、npm run test:e2e。
- 修改 v2 兼容层时另外运行 npm run test:v2-reference；vendor 原文由 provenance SHA 校验，环境替换只放在构建适配层。社区扩展不作为框架源码复制或再分发。
- 测试使用临时目录和 mock 网络服务，不读取真实聊天记录，不调用收费模型，不启动或关闭用户 QQ。
- 用户明确授权的人工真实 QQ 联调是例外：使用独立 var/ 测试数据和启动级 allowedChats 边界，只能向用户指定会话收发；不得把真实密钥、聊天内容打印或提交。自动化测试继续只用 mock。
