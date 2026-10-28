import { defineClientPlugin } from '@qq-harness/client-sdk';
import { QqPortablePage } from './page.js';
import './style.css';

export default defineClientPlugin({
  id: 'qq-portable',
  setup(ctx) {
    ctx.page({
      id: 'qq-portable',
      path: '/qq-portable',
      title: '便携 QQ',
      icon: 'qq',
      order: 27,
      component: QqPortablePage,
    });
  },
});
