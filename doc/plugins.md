# 插件开发

## 基础契约

插件 ID 全局唯一；服务名、模式名、工具名和页面路径重复注册均拒绝。使用 `requires` 声明必需服务，使用 `ctx.effect()` 撤销自己管理的资源。

```ts
import { definePlugin, service } from '@qq-harness/plugin-sdk';

const clock = service<{ now(): number }>('example.clock');
export default definePlugin({
  id: 'example-clock',
  setup(ctx) {
    ctx.provide(clock, { now: () => Date.now() });
    const timer = setInterval(() => ctx.log('心跳'), 60000);
    ctx.effect(() => clearInterval(timer));
  },
});
```

服务接口放公开 SDK/契约包，实现留在提供者内部。不要从另一个插件的内部源文件导入模块。

## 扩展运行流程

```ts
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';

export default definePlugin({
  id: 'example-mode',
  setup(ctx) {
    ctx.definePoint({ id: 'example.normalize', kind: 'transform', schema: z.string() });
    ctx.mode({
      id: 'example.echo',
      input: z.string(),
      async execute(run, input) {
        run.assertActive();
        return ctx.points.transform('example.normalize', input, run.signal);
      },
    });
  },
});
```

消费者监听另一个插件定义的 point 时，应声明该插件公开的 ready 服务依赖，保证它先定义扩展点。hook 不得捕获并长期保存其他会话的运行上下文。

例如 `message.received` / `trigger.evaluate` 消费者依赖 `harness.conversation`，`model.http.headers` 消费者依赖 `harness.model.http`；只有 `harness.model` 并不代表模型实现提供 HTTP 请求头扩展点。`tool.after` 是 transform，返回 `{ chatKey, name, args, result }` 后，最终 `result` 会返回工具调用方；监听失败时保留此前成功的结果。

工具由 `harness.tools` 服务注册，工具名须符合 `[a-zA-Z0-9_-]{1,64}`。execute 拿到绑定本次运行的 chatKey。发送只消费 `harness.outbound`；不要把目标会话 ID 暴露成模型工具参数，也不要直接调用 OneBot 发送。

## 客户端页面与插槽

```tsx
import { defineClientPlugin } from '@qq-harness/client-sdk';

export default defineClientPlugin({
  id: 'example-panel',
  requires: ['console-chats'],
  setup(ctx) {
    ctx.slot('conversation.detail.tabs', {
      id: 'panel',
      title: '插件页面',
      order: 60,
      component: ({ context }) => <p>当前会话：{String(context.chatKey)}</p>,
    });
  },
});
```

shell 插槽以 `shell.` 开头。业务插件自己定义子插槽，并为消费者提供稳定 context 字段。用 query key 的首项标注插件 ID，方便卸载时清理缓存；请求使用 `ctx.api` 和 ctx.signal。React 组件内部也可以通过 useHost 获取 API 与 query client，并使用 React Query 的 query signal。

使用业务插槽必须声明定义它的客户端插件 ID。提供者 generation、入口或样式变更时，宿主先撤销全部传递依赖，再按依赖重新装载；提供者加载失败时消费者保持等待，不能保留上一代按钮。

## 安装后的独立包

参考 `extensions/example-notes/`：

```json
{
  "apiVersion": 1,
  "id": "my-extension",
  "name": "我的扩展",
  "version": "1.0.0",
  "server": "server.mjs",
  "client": "client.mjs",
  "assets": [],
  "requires": ["harness.http"]
}
```

- 放入 extensions 的一级目录，重启后加载清单；新装默认关闭，在控制台显式启用。
- 入口是构建后的 ESM；TypeScript 源码应在发布前编译。内置 workspace 插件可由 esbuild/Vite 直接处理。
- server 默认导出 `{ id, setup(ctx) }`，依赖必须在 manifest.requires 中声明。未启用时不 import 服务端模块，避免顶层副作用。
- client 默认导出 `{ id, requires?, setup(ctx) }`；依赖是客户端插件 ID，与服务端服务依赖分别定义。
- 可以通过 ctx.react 使用宿主 React，也可以将 React/ClientSDK 的导入改为 `/runtime.js` 的命名导出；不要把另一份 React 打包进去。
- 只有 client 与 assets 列出的文件能经资源端点获取，server 入口不会自动暴露。相对路径和 symlink 逃逸均拒绝。
- 注册 HTTP handler 时必须把返回的 disposer 交给 ctx.effect。停用后路由、子页面、按钮及监听一起撤销。
- 当前安装流程是本机目录安装与重启发现，没有远程市场、在线下载、代码沙箱或旧七目录兼容承诺。

Node 代码插件是本机受信任代码，可访问系统资源。使用未来的隔离插件宿主才能执行不可信代码，不能以 SDK 接口约束代替权限隔离。
