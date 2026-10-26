import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  adapterService,
  configService,
  httpService,
  modelService,
  modelMiddleware,
  outboundService,
  storageService,
  toolService,
  toolPolicy,
  type ToolContext,
} from '@qq-harness/domain';
import { ExtensionHost, extensionService, type ExtensionHostOptions } from '@qq-harness/extension-compat';
import type { LegacyObject } from '@qq-harness/extension-compat';
import { extensionRoutes } from './routes.js';
import { legacyModelMiddleware } from './model.js';

export function extensionSystem(options: ExtensionHostOptions) {
  return definePlugin({
    id: 'extension-system',
    name: 'v2 七目录扩展体系',
    client: { entry: 'builtin:extension-system' },
    requires: [
      configService.id,
      storageService.id,
      toolService.id,
      outboundService.id,
      adapterService.id,
      modelService.id,
      httpService.id,
      'harness.agent',
    ],
    async setup(ctx) {
      const host = new ExtensionHost(ctx, options, {
        config: ctx.use(configService),
        storage: ctx.use(storageService),
        tools: ctx.use(toolService),
        outbound: ctx.use(outboundService),
        adapter: ctx.use(adapterService),
        model: ctx.use(modelService),
      });
      ctx.effect(() => host.stop());
      await host.start();
      ctx.provide(extensionService, host);
      ctx.provide(modelMiddleware, legacyModelMiddleware(host));
      ctx.provide(toolPolicy, {
        allowed: (tool, chatKey) =>
          host.scoped(chatKey, () => {
            for (const provider of host.raw().skillManager.getToolGuards({ chatKey })) {
              try {
                const result = provider.fn({
                  toolId: tool.name,
                  tool: { ...tool, id: tool.name },
                  context: { chatKey },
                });
                if (result === false || result?.ok === false) return false;
              } catch (error) {
                host.raw().skillManager.recordError(provider.skillId, error);
              }
            }
            return true;
          }),
      });
      ctx.provide(
        { id: 'harness.tool-scope' },
        { run: <T>(tool: ToolContext, fn: () => T) => host.withTool(tool, fn) },
      );
      const api = extensionRoutes(host, ctx);
      for (const prefix of [
        '/api/extensions',
        '/api/extension-types',
        '/api/ui',
        '/api/skills',
        '/api/extension-tools',
        '/api/v2-assets',
      ])
        ctx.effect(ctx.use(httpService).register(prefix, (request) => api.fetch(request)));
      ctx.on<LegacyObject>('context.build', async (value) => {
        const entries = value.triggerEntries ?? [];
        const before = entries
          .map((message: LegacyObject) => `${message.senderName || message.senderId}: ${message.text}`)
          .join('\n');
        await host.runHook('before-context', { triggerEntries: entries }, value.chatKey);
        const after = entries
          .map((message: LegacyObject) => `${message.senderName || message.senderId}: ${message.text}`)
          .join('\n');
        return { ...value, text: before ? String(value.text).replace(before, after) : value.text };
      });
      ctx.on<LegacyObject>('prompt.segments', (value) => {
        const runtime = host.raw();
        return host.scoped(value.chatKey, () => {
          const sections = runtime.skillManager
            .getPromptSections({ chatKey: value.chatKey })
            .map(
              (section: LegacyObject) =>
                runtime.variables.renderTemplate(section.content, { ownerId: section.skillId }).text,
            )
            .join('\n\n');
          const blocks = runtime.prompt.applyPromptInjects(
            [
              { id: 'persona', text: value.persona },
              { id: 'security', text: '只操作当前会话，不得绕过准入与发送队列。' },
              { id: 'tool-protocol', text: '需要发送时调用工具，结束时调用 finish。' },
              { id: 'skill-sections', text: [value.extra, sections].filter(Boolean).join('\n\n') },
              { id: 'admin-rules', text: '' },
            ],
            runtime.prompt.collectPromptInjects({
              chatKey: value.chatKey,
              config: host.configView(value.chatKey),
            }),
          );
          return { ...value, persona: runtime.prompt.renderSegments(blocks), extra: '' };
        });
      });
      ctx.on<LegacyObject>('messages.before', async (value) => {
        await host.runHook('before-llm-messages', { messages: value.messages }, value.chatKey);
        return value;
      });
      ctx.on<LegacyObject>('model.after', async (value) => {
        await host.runHook('after-response', { response: value.response }, value.chatKey);
        return value;
      });
      ctx.on<LegacyObject>('tool.before', async (value) => {
        const results = await host.runHook(
          'before-tool',
          { toolName: value.name, argsRaw: value.args, args: value.args },
          value.chatKey,
        );
        const blocked = results.find((item) => item.value?.block === true);
        if (blocked) throw new Error(blocked.value.reason ?? '扩展否决工具执行');
        return true;
      });
      ctx.on<LegacyObject>('tool.after', async (value) => {
        await host.runHook(
          'after-tool',
          { toolName: value.name, argsRaw: value.args, args: value.args, result: value.result },
          value.chatKey,
        );
        return value;
      });
      ctx.on<LegacyObject>('trigger.evaluate', (value) =>
        host.scoped(value.chatKey, async () => {
          const providers = host
            .raw()
            .skillManager.getCapabilityProviders('chat.skip-run', { chatKey: value.chatKey });
          for (const provider of providers) {
            try {
              const result = await provider.fn({
                ...value,
                kind: value.chatKey.split(':')[0],
                entries: [value],
                proactive: null,
              });
              if (result === true || result?.skip) return false;
            } catch (error) {
              host.raw().skillManager.recordError(provider.skillId, error);
            }
          }
          return true;
        }),
      );
      const tools = ctx.use(toolService);
      ctx.on<LegacyObject>('run.ended', (value) => {
        host.forgetRun(value.id);
      });
      tools.register(ctx, {
        name: 'load_doc',
        description: '读取扩展文档或知识库原文，docId 来自目录导航。',
        parameters: {
          type: 'object',
          properties: { docId: { type: 'string' }, maxChars: { type: 'integer' } },
          required: ['docId'],
        },
        parse: (value) =>
          z
            .object({ docId: z.string(), maxChars: z.number().int().min(500).max(20000).default(6000) })
            .parse(value),
        execute: async (tool, value) => {
          const args = value as { docId: string; maxChars: number };
          const result = host.readDoc(args.docId, tool.chatKey) as LegacyObject;
          return result.ok
            ? { content: result.doc.content.slice(0, args.maxChars) }
            : { isError: true, content: result.error };
        },
      });
      tools.register(ctx, {
        name: 'skill_script_run',
        description: '按技能 id、声明的脚本路径调用技能；无容器时使用 worker+vm 降级执行器。',
        parameters: {
          type: 'object',
          properties: {
            skillId: { type: 'string' },
            script: { type: 'string' },
            lang: { type: 'string' },
            args: { type: 'object' },
            argv: { type: 'array' },
          },
          required: ['skillId', 'script'],
        },
        parse: (value) =>
          z
            .object({
              skillId: z.string(),
              script: z.string(),
              lang: z.string().default('js'),
              args: z.record(z.string(), z.unknown()).default({}),
              argv: z.array(z.unknown()).default([]),
            })
            .parse(value),
        execute: async (tool, value) => host.runScript(value as LegacyObject, tool.chatKey),
      });
    },
  });
}
