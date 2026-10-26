// 安装后插件只消费公开的上下文与服务，不导入应用内部文件。
export default {
  id: 'example-notes',
  setup(ctx) {
    const http = ctx.use({ id: 'harness.http' });
    ctx.effect(
      http.register('/api/notes', () =>
        Response.json({ text: '这条便笺来自安装后的独立插件。停用插件会同时撤销 API 与子页面。' }),
      ),
    );
  },
};
