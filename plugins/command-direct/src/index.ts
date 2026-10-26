import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { chatKeySchema } from '@qq-harness/contracts';
import { configService, accessService, toolService, type ToolContext } from '@qq-harness/domain';

export const commandDirect = definePlugin({
  id: 'command-direct',
  name: '确定性工具运行模式',
  requires: [configService.id, accessService.id, toolService.id],
  setup(ctx) {
    const config = ctx.use(configService),
      access = ctx.use(accessService),
      tools = ctx.use(toolService);
    ctx.mode({
      id: 'command.direct',
      partitionKey: (input) => input.chatKey,
      input: z.object({ chatKey: chatKeySchema, tool: z.string(), args: z.unknown() }),
      execute: async (run, input) => {
        access.assert(input.chatKey);
        const context: ToolContext = {
          run,
          chatKey: input.chatKey,
          settings: config.effective(input.chatKey),
          sent: 0,
          trace: (type, text) => ctx.host.publish('run.trace', { id: run.id, type, text }),
        };
        return tools.execute(context, input.tool, JSON.stringify(input.args));
      },
    });
  },
});
