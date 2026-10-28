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
      command: (chatKey, argv, signal, stdin, containerId) => {
        assert(chatKey);
        return runtime.command(
          chatKey,
          argv,
          AbortSignal.any([ctx.signal, signal ?? ctx.signal]),
          stdin,
          containerId,
        );
      },
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
    const selector = {
      containerId: { type: 'string', description: '可选，当前会话已绑定的容器ID；省略使用默认容器' },
    };
    const selection = {
      containerId: z
        .string()
        .regex(/^[a-zA-Z0-9_.-]{1,160}$/)
        .optional(),
    };
    const target = (tool: ToolContext, value: string, id?: string) => {
      const parsed = filePath.parse(value);
      const relative =
        parsed === CONTAINER_WORKSPACE
          ? '.'
          : parsed.startsWith(CONTAINER_WORKSPACE + '/')
            ? parsed.slice(CONTAINER_WORKSPACE.length + 1)
            : parsed;
      return path.posix.resolve(runtime.workspace(tool.chatKey, id), relative);
    };
    const command = (tool: ToolContext, argv: string[], stdin?: string, id?: string) =>
      runtime.command(tool.chatKey, argv, AbortSignal.any([ctx.signal, tool.run.signal]), stdin, id);
    register(
      'container_list',
      '列出当前会话已绑定的容器及默认项，不包含其他会话的绑定。',
      properties({}),
      z.object({}),
      async (tool) =>
        runtime
          .bindings()
          .filter((row) => row.chatKey === tool.chatKey)
          .map(({ cleanupPending: _internal, ...row }) => row),
    );
    register(
      'container_status',
      '查看当前会话绑定容器的状态。',
      properties(selector),
      z.object(selection),
      (tool, args) => runtime.inspect(tool.chatKey, tool.run.signal, args.containerId),
    );
    register(
      'container_start',
      '启动当前会话已经绑定且管理员允许启用的容器。',
      properties(selector),
      z.object(selection),
      (tool, args) => runtime.start(tool.chatKey, tool.run.signal, args.containerId),
    );
    register(
      'container_stop',
      '取消当前会话在所选容器中的任务，省略ID取消本会话全部容器任务；保留共享容器和文件。',
      properties(selector),
      z.object(selection),
      async (tool, args) => {
        await runtime.stop(tool.chatKey, tool.run.signal, args.containerId);
        return { tasksCancelled: true };
      },
    );
    register(
      'container_bash',
      '以本会话独立用户在所选容器执行命令。超时或取消仅清理本任务进程树。可后台运行并用任务工具查询。',
      properties(
        {
          command: { type: 'string' },
          workdir: { type: 'string' },
          timeoutMs: { type: 'integer' },
          run_in_background: { type: 'boolean' },
          ...selector,
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
      '以当前会话用户读取 UTF-8 文件；相对路径以该用户的私有 workspace 为起点，输出有上限。',
      properties({ path: { type: 'string' }, ...selector }, ['path']),
      z.object({ path: filePath, ...selection }),
      async (tool, args) =>
        output(
          await command(
            tool,
            ['cat', '--', target(tool, args.path, args.containerId)],
            undefined,
            args.containerId,
          ),
        ),
    );
    register(
      'container_write',
      '将 UTF-8 文本写入容器文件，可创建父目录。仅操作当前会话容器。',
      properties({ path: { type: 'string' }, content: { type: 'string' }, ...selector }, ['path', 'content']),
      z.object({ path: filePath, content: z.string().max(100000), ...selection }),
      async (tool, args) =>
        output(
          await command(
            tool,
            [
              'sh',
              '-c',
              'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"',
              'sh',
              target(tool, args.path, args.containerId),
            ],
            args.content,
            args.containerId,
          ),
        ),
    );
    register(
      'container_glob',
      '查找容器目录下匹配文件名模式的文件，pattern 是 find -name 模式。',
      properties({ path: { type: 'string' }, pattern: { type: 'string' }, ...selector }),
      z.object({
        path: filePath.default('.'),
        pattern: z.string().min(1).max(500).default('*'),
        ...selection,
      }),
      async (tool, args) =>
        output(
          await command(
            tool,
            ['find', target(tool, args.path, args.containerId), '-type', 'f', '-name', args.pattern],
            undefined,
            args.containerId,
          ),
        ),
    );
    register(
      'container_grep',
      '在容器目录内搜索文本，返回文件与行号；输出有上限。',
      properties({ path: { type: 'string' }, pattern: { type: 'string' }, ...selector }, ['pattern']),
      z.object({ path: filePath.default('.'), pattern: z.string().min(1).max(1000), ...selection }),
      async (tool, args) =>
        output(
          await command(
            tool,
            [
              'grep',
              '-R',
              '-n',
              '-m',
              '100',
              '-e',
              args.pattern,
              '--',
              target(tool, args.path, args.containerId),
            ],
            undefined,
            args.containerId,
          ),
        ),
    );
  },
});
