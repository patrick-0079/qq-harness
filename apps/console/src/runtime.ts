// 后装插件从此入口共享宿主 React，Vite 会为两个入口提取同一个运行时 chunk。
import * as React from 'react';
import * as ClientSDK from '@qq-harness/client-sdk';
export { React, ClientSDK };
