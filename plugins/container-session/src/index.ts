import path from 'node:path';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { CONTAINER_WORKSPACE, containerExecSchema, type ContainerExecResult } from '@qq-harness/contracts';
import {
  configService,
  accessService,
  toolService,
  containerRuntimeService,
  containerSessionService,
  containerJobsService,
  type ToolContext,
} from '@qq-harness/domain';

const filePath = z
  .string()
  .min(1)
  .max(1000)
  .refine((v) => !/[\0\r\n]/.test(v));
const properties = (values: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties: values,
  required,
  additionalProperties: false,
});
const output = (result: ContainerExecResult) => ({ ...result, isError: result.exitCode !== 0 });
export const containerSession = definePlugin({
  id: 'container-session',
  name: '会话容器与 Agent 工具',
  requires: [containerRuntimeService.id, configService.id, accessService.id, toolService.id],
  setup(ctx) {
    const runtime = ctx.use(containerRuntimeService),
      config = ctx.use(configService),
      tools = ctx.use(toolService);
    const available = (chatKey: string) =>
      runtime.canOperate() &&
      runtime.has(chatKey) &&
      ctx.use(accessService).allowed(chatKey) &&
      config.effective(chatKey).plugins[ctx.id] !== false &&
      config.effective(chatKey).plugins['container-runtime'] !== false;
    const assert = (chatKey: string) => {
      ctx.assertActive();
      if (!available(chatKey)) throw new Error('当前会话未启用或未绑定容器');
    };
    ctx.provide(containerSessionService, {
      available,
      execute: (chatKey, input, signal, onOutput) => {
        assert(chatKey);
        return runtime.execute(
          chatKey,
          input,
          AbortSignal.any([ctx.signal, signal ?? new AbortController().signal]),
          onOutput,
        );
      },
    });
    const register = <T>(
      name: string,
      description: string,
      parameters: Record<string, unknown>,
      schema: z.ZodType<T>,
      execute: (tool: ToolContext, value: T) => Promise<unknown>,
    ) =>
      tools.register(ctx, {
        name,
        description,
        parameters,
        available,
        parse: (args) => schema.parse(args),
        execute: (tool, args) => {
          assert(tool.chatKey);
          return execute(tool, args as T);
        },
      });
    const target = (value: string) => path.posix.resolve(CONTAINER_WORKSPACE, filePath.parse(value));
    const command = (tool: ToolContext, argv: string[], stdin?: string) =>
      runtime.command(tool.chatKey, argv, AbortSignal.any([ctx.signal, tool.run.signal]), stdin);
    register('container_status', '查看当前会话绑定容器的状态。', properties({}), z.object({}), (tool) =>
      runtime.inspect(tool.chatKey, tool.run.signal),
    );
    register('container_start', '启动当前会话已经绑定的容器。', properties({}), z.object({}), (tool) =>
      runtime.start(tool.chatKey, tool.run.signal),
    );
    register(
      'container_stop',
      '停止当前会话容器及其中的任务，保留容器文件。',
      properties({}),
      z.object({}),
      async (tool) => {
        await runtime.stop(tool.chatKey);
        return { stopped: true };
      },
    );
    register(
      'container_bash',
      '在当前会话容器内执行 shell 命令。超时或取消会停止该容器。可选择后台运行并用任务工具查询。',
      properties(
        {
          command: { type: 'string' },
          workdir: { type: 'string' },
          timeoutMs: { type: 'integer' },
          run_in_background: { type: 'boolean' },
        },
        ['command'],
      ),
      containerExecSchema.extend({ run_in_background: z.boolean().default(false) }),
      async (tool, args) => {
        if (args.run_in_background) return ctx.use(containerJobsService).start(tool.chatKey, args);
        return output(await ctx.use(containerSessionService).execute(tool.chatKey, args, tool.run.signal));
      },
    );
    register(
      'container_read',
      '读取容器内 UTF-8 文本文件；相对路径以 /tmp/qq-harness-workspace 为起点，输出有上限。',
      properties({ path: { type: 'string' } }, ['path']),
      z.object({ path: filePath }),
      async (tool, args) => output(await command(tool, ['cat', '--', target(args.path)])),
    );
    register(
      'container_write',
      '将 UTF-8 文本写入容器文件，可创建父目录。仅操作当前会话容器。',
      properties({ path: { type: 'string' }, content: { type: 'string' } }, ['path', 'content']),
      z.object({ path: filePath, content: z.string().max(100000) }),
      async (tool, args) =>
        output(
          await command(
            tool,
            ['sh', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', 'sh', target(args.path)],
            args.content,
          ),
        ),
    );
    register(
      'container_glob',
      '查找容器目录下匹配文件名模式的文件，pattern 是 find -name 模式。',
      properties({ path: { type: 'string' }, pattern: { type: 'string' } }),
      z.object({
        path: filePath.default('/tmp/qq-harness-workspace'),
        pattern: z.string().min(1).max(500).default('*'),
      }),
      async (tool, args) =>
        output(await command(tool, ['find', target(args.path), '-type', 'f', '-name', args.pattern])),
    );
    register(
      'container_grep',
      '在容器目录内搜索文本，返回文件与行号；输出有上限。',
      properties({ path: { type: 'string' }, pattern: { type: 'string' } }, ['pattern']),
      z.object({ path: filePath.default('/tmp/qq-harness-workspace'), pattern: z.string().min(1).max(1000) }),
      async (tool, args) =>
        output(
          await command(tool, ['grep', '-R', '-n', '-m', '100', '-e', args.pattern, '--', target(args.path)]),
        ),
    );
  },
});
