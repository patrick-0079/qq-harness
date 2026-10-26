export default {
  id: 'example-notes',
  requires: ['console-chats'],
  setup(ctx) {
    const { createElement: h, useEffect, useState } = ctx.react;
    function Notes() {
      const [text, setText] = useState('加载中…');
      useEffect(() => {
        ctx.api
          .request('/api/notes', { signal: ctx.signal })
          .then((value) => setText(value.text))
          .catch(() => setText('便笺插件已停用'));
      }, []);
      return h('div', { className: 'form-stack' }, h('h2', null, '插件便笺'), h('p', null, text));
    }
    ctx.slot('conversation.detail.tabs', { id: 'notes', title: '插件便笺', order: 60, component: Notes });
  },
};
