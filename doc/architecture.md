# 实际架构

完整系统图和消息时序见 [系统结构图](system-map.md)；所有官方插件及后装示例的服务、可选调用和客户端依赖见 [生成的插件依赖图表](plugin-dependencies.md)。

## 后端

`Runtime` 持有一个 Cordis Context，每个插件只有一套 Cordis 激活生命周期。`requires` 是服务名，Cordis 在服务出现时激活消费者，在服务撤销时清理消费者并等待重新就绪。插件状态表用于诊断与 UI，不替代依赖解析。

插件上下文提供 `use/provide`、`effect`、`mode`、`definePoint/on`。每次激活产生独立 generation 与 AbortController。模式、hook、计时器、路由与工具的清理都与该次激活绑定，旧清理闭包不会移除新代注册。

内核只依赖 Cordis 和 plugin-sdk。Node 路径、SQLite、消息类型、Hono 与 React 不进入内核。

```text
adapter → access → storage → conversation
                               ↓
                     kernel runs（通用调度）
                               ↓
                           agent.basic
                               ↓
                     model ↔ tools → outbound
                                        ↓
                                  access → adapter
```

`storage`、`model`、`adapter` 等均为可替换服务。生产入口的实例锁与临时目录清理属于 host，不是聊天业务。

## 扩展点

- observe：独立副本、异步通知、错误隔离。监听器必须尊重 signal，自定义副作用仍需自行清理。
- transform：顺序执行，每次返回值通过该点 schema 验证。超时后不提交迟到结果。
- guard：任何拒绝、异常、超时都会阻止动作；必需 guard 缺少监听时拒绝。

总预算使用 performance.now 的真实耗时；每个监听的上限取单监听时限与剩余总预算的较小值。Promise.race 只能停止等待，无法中断同进程死循环；平台没有把类型/导出检查当作执行沙箱。

当前真实接线点为 `message.received`、`trigger.evaluate`、`context.build`、`prompt.segments`、`messages.before`、`model.after`、`tool.before/after`、`outbound.before/after`、`run.ended`。

## 运行与取消

运行请求包含 mode、partitionKey、input 及运行/排队超时。partitionKey 只是通用互斥键；聊天插件使用 chatKey。并发槽位在启动 executor 前同步占用，排队时间不计入运行 timeout。

取消会中断等待并撤销提交资格。模型迟到响应不能继续调工具；发送队列在出队时再次校验运行、插件 signal 和准入。已经实际发送的消息仍然留档。

会话下线后，新消息记录为已读且不调模型；已有运行不会仅因 online 配置变化而被打断。黑名单与准入变更会在出站处重新检查。失败/取消且尚未发送的触发消息恢复未读，取消本身不会自动重试。

## 前端

React shell 只消费注册表，没有按业务页面 ID 的分支。官方页面通过 Vite glob 生成内置懒加载入口；后装插件通过后端公布的受控 ESM URL 加载。后者不依赖 glob。

客户端宿主提供 page、defineSlot、slot、effect。一次 registry 快照作为批次提交，避免加载第一个页面时过早导航。依赖消失或后端 generation 变化时撤销旧贡献并重新装载。SSE 断线后重新拉完整 registry，而不是假设所有事件均可回放。

运行时客户端模块可以通过 `ctx.react` 使用唯一宿主 React；标准编译插件也可导入 `/runtime.js` 的 React/ClientSDK 导出。Vite 为 shell/runtime 两个入口提取共享 chunk，避免两份 React。内置插件使用同一 workspace SDK。

组件用 ErrorBoundary 隔离渲染失败，请求支持取消。React、同源 ESM 和 Node 插件都属于受信任代码；当前版本不提供第三方恶意代码沙箱。

## HTTP

外层 Hono 固定处理 Host、Origin、鉴权、体积限制和 SSE；业务 API 由插件注册。路由匹配表每次请求读取当前 handler，撤销闭包只删除自身注册。已开始的请求可能完成；新请求无法继续命中已卸载路由。

配置 GET/PATCH 返回 PublicConfig，密钥写入与存在标记分开；全局插件开关只能通过插件启停接口修改。SSE 使用 fetch 流以携带 Authorization，管理 token 不进入 URL。令牌登录后交换 HttpOnly/SameSite=Strict 的短期会话 cookie，以便浏览器原生 ESM/CSS 请求也能通过插件资源鉴权。

## 与旧代码的关系

运行代码不导入旧检出。旧数据导入器只读取文件并回放事件，不加载旧模块，不触发配置迁移、进程管理或旧扩展。旧第三方扩展需要 SDK 适配；不通过包一层旧 app 的方式把单体永久保留在新内核里。

## 2026-10-27 管理与记忆补充

agent-memory 的整理使用独立 `memory.consolidate` Runs 模式，与回复共用会话分区、并发、取消和用量记录。配置仍为会话完整快照；整理计划从全局 memory 默认值叠加独立 memoryOverrides。记忆事实版本决定有效值，短期优先，索引故障可回退仓储。过期且成功整理过的条目才自动归档。

console-api 汇总配置、准入、历史和名称缓存。QQ 群名/好友备注最多每分钟合并刷新一次，断线使用缓存；管理别名优先，不写回 QQ。正式启动不额外配置会话白名单，显式测试 allowedChats 仍是不可由配置突破的边界。

client-sdk 提供统一 React DialogHost/Drawer，处理队列、焦点、Esc、保存中及失败反馈；所有官方客户端不调用浏览器 alert/confirm/prompt。主题在 CSP 允许的同源阻塞脚本中先于首屏应用，再由 React 监听系统变化。
