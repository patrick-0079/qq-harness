import { defineClientPlugin } from '@qq-harness/client-sdk';
import { ExtensionRepository } from './client.js';

export function managerClient(id: string, type: string, title: string) {
  return defineClientPlugin({
    id,
    requires: ['extension-system'],
    setup(ctx) {
      ctx.slot('extensions.manager-panels', {
        id: type,
        title,
        component: ({ context }) => <ExtensionRepository managerType={type} context={context} />,
      });
    },
  });
}
