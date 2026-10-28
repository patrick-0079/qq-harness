import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { accessService, storageService, containerRuntimeService } from '@qq-harness/domain';
import { chatKeySchema } from '@qq-harness/contracts';
import { ContainerRuntime, type ContainerOptions } from './runtime.js';
export type { ContainerOptions } from './runtime.js';
export type { ContainerCli, CliOptions } from './cli.js';
export { runContainerCli } from './cli.js';
export function containerRuntime(options: ContainerOptions = {}) {
  return definePlugin({
    id: 'container-runtime',
    name: 'Docker / Podman 容器运行时',
    requires: [storageService.id, accessService.id],
    setup(ctx) {
      const schema = z.object({
        chatKey: chatKeySchema.optional(),
        operation: z.string(),
        exitCode: z.number().optional(),
      });
      ctx.definePoint({ id: 'container.before', kind: 'guard', schema, requiredGuard: true });
      ctx.definePoint({ id: 'container.after', kind: 'observe', schema });
      ctx.on<{ chatKey?: string }>('container.before', ({ chatKey }) => {
        if (chatKey) ctx.use(accessService).assert(chatKey);
        return true;
      });
      const runtime = new ContainerRuntime(ctx, ctx.use(storageService), ctx.use(accessService), options);
      ctx.effect(() => runtime.dispose());
      ctx.provide(containerRuntimeService, runtime);
    },
  });
}
