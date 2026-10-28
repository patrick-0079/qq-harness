import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import { EXTENSION_DIRS, redact, type ExtensionHost } from '@qq-harness/extension-compat';
import type { LegacyObject } from '@qq-harness/extension-compat';
import { toolService } from '@qq-harness/domain';
import { declaredManifest } from './import-manifest.js';

const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);
const chatSchema = z.string().regex(/^(?:(?:group|private):[0-9]+)?$/);
const rootByType: Record<string, string> = {
  plugin: 'plugins',
  'chat-plugin': 'chat-plugins',
  tool: 'tools',
  mcp: 'mcp',
  skill: 'skills',
  knowledge: 'knowledge',
  promptinject: 'promptinjects',
};

// 路径检查同时约束词法路径与每一级 realpath，避免包内软链接穿出安装根。
export function contained(root: string, relative: string): string {
  if (
    !relative ||
    /[\0:]/.test(relative) ||
    relative
      .replaceAll('\\', '/')
      .split('/')
      .some((part) => part === '..') ||
    path.isAbsolute(relative)
  )
    throw new Error('文件路径非法');
  const absolute = path.resolve(root, relative);
  const rel = path.relative(root, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('文件路径越界');
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error('扩展目录不允许软链接');
  }
  return absolute;
}

export function extensionRoutes(host: ExtensionHost, ctx: PluginContext) {
  const api = new Hono();
  const runtime = host.raw();
  // The console's default scope is the global extension default, never a QQ ID.
  const chat = (value?: string) => chatSchema.parse(value === 'default' ? '' : (value ?? ''));
  const library = (id: string) => contained(host.options.root, `knowledge/${idSchema.parse(id)}`);
  const stats = (rows: LegacyObject[]) => ({
    total: rows.length,
    byType: Object.fromEntries(
      [...new Set(rows.map((row) => row.type))].map((type) => [
        type,
        rows.filter((row) => row.type === type).length,
      ]),
    ),
    byStatus: {
      active: rows.filter((row) => row.active).length,
      disabled: rows.filter((row) => !row.enabled).length,
    },
  });
  api.get('/api/extensions', (c) => {
    const chatKey = chat(c.req.query('chat'));
    const rows = host.list(chatKey).filter((row) => !c.req.query('type') || row.type === c.req.query('type'));
    return c.json({
      ok: true,
      chat: chatKey || null,
      type: c.req.query('type') ?? null,
      extensions: rows,
      stats: stats(rows),
    });
  });
  api.get('/api/extension-tools', (c) => {
    const chatKey = chat(c.req.query('chat'));
    return c.json({
      tools: host.scoped(chatKey, () =>
        (ctx.use(toolService).catalog?.(chatKey || 'default') ?? []).map((tool) => ({
          ...tool,
          ...(!chatKey
            ? {
                enabled: false,
                reason: '默认配置预览，请在具体会话中确认运行可用状态',
              }
            : {}),
          extensionId: runtime.tools.getTool(tool.id)?.skillId ?? (tool.builtinQQ ? null : tool.owner),
        })),
      ),
    });
  });
  api.patch('/api/extensions/:id/settings', async (c) => {
    const patch = z
      .object({
        enabled: z.boolean().optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .parse(await c.req.json());
    await host.configure(idSchema.parse(c.req.param('id')), patch, chat(c.req.query('chat')));
    const chatKey = chat(c.req.query('chat'));
    const row = host.list(chatKey).find((row) => row.id === c.req.param('id'));
    return c.json({
      ok: true,
      id: c.req.param('id'),
      chat: chatKey || null,
      ...(chatKey
        ? { override: { enabled: row?.enabled, settings: row?.settings } }
        : { default: { enabled: row?.enabled, settings: row?.settings } }),
    });
  });
  api.delete('/api/extensions/:id/settings', async (c) => {
    await host.clearSettings(idSchema.parse(c.req.param('id')), chat(c.req.query('chat')));
    return c.json({ ok: true });
  });
  api.get('/api/extension-types', (c) => {
    const surface = c.req.query('surface') ?? '';
    const types = runtime.catalog.listExtensionTypes(surface);
    return c.json({
      ok: true,
      surface,
      types,
      counts: stats(host.list(chat(c.req.query('chat')))).byType,
    });
  });
  api.get('/api/skills', (c) =>
    c.json({
      ok: true,
      skills: host.list(chat(c.req.query('chat'))),
      tabs: host.tabs(),
    }),
  );
  api.post('/api/skills/reload', async (c) => {
    await host.reload();
    return c.json({ ok: true, extensions: host.list() });
  });
  api.get('/api/skills/capabilities', (c) =>
    c.json({
      ok: true,
      capabilities: runtime.skillManager.capabilities.list(),
    }),
  );
  api.get('/api/ui/extension-points', (c) =>
    c.json({
      ok: true,
      apiVersion: 1,
      points: Object.entries(runtime.UI_SLOTS).map(([id, value]) => ({
        id,
        ...(value as object),
        apiVersion: 1,
      })),
    }),
  );
  api.get('/api/ui/contributions', (c) => {
    const items = host.contributions(c.req.query('page') ?? 'shell', chat(c.req.query('chat')));
    return c.json({
      ok: true,
      apiVersion: 1,
      points: Object.fromEntries(
        [...new Set(items.map((item) => item.point))].map((point) => [
          point,
          runtime.uiExtensionRegistry
            .listBySlot(point)
            .filter((item: LegacyObject) =>
              items.some((row) => row.ownerId === item.ownerId && row.id === item.id),
            ),
        ]),
      ),
    });
  });
  api.post('/api/extensions/:owner/ui-actions/:action', async (c) => {
    const args = z.record(z.string(), z.unknown()).parse(await c.req.json());
    return c.json(
      (await host.action(
        c.req.param('owner'),
        c.req.param('action'),
        args,
        chat(String(args.chatKey ?? args.chat ?? '')),
      )) as object,
    );
  });
  api.post('/api/extensions/import', async (c) => {
    const body = z
      .object({
        data: z.string().optional(),
        files: z
          .array(
            z.object({
              rel: z.string().optional(),
              name: z.string().optional(),
              data: z.string(),
            }),
          )
          .max(100)
          .optional(),
      })
      .parse(await c.req.json());
    const root = c.req.query('root') ?? '';
    if (root && !EXTENSION_DIRS.includes(root as (typeof EXTENSION_DIRS)[number]))
      throw new Error('安装目录非法');
    const entries: { name: string; data: Buffer }[] = body.data
      ? runtime.zip.validateZipStructure(Buffer.from(body.data, 'base64'))
      : (body.files ?? []).map((file) => ({
          name: file.rel ?? file.name ?? '',
          data: Buffer.from(file.data, 'base64'),
        }));
    const maxBytes = (body.data ? 32 : 8) * 1024 * 1024;
    if (entries.reduce((sum, entry) => sum + entry.data.length, 0) > maxBytes)
      throw new Error(`安装包超过 ${body.data ? 32 : 8}MB`);
    for (const entry of entries) {
      entry.name = entry.name.replaceAll('\\', '/');
      contained(host.options.root, entry.name);
      if (/\.(exe|dll|bat|cmd|com|scr|msi|ps1|vbs|lnk)$/i.test(entry.name))
        throw new Error('安装包含可执行文件');
    }
    const declaration = declaredManifest(entries);
    const info: LegacyObject = runtime.importer.analyzeEntries(entries, {
      root,
    });
    if (
      info.root &&
      entries.some(
        (entry) =>
          /(?:^|\/)(?:plugin|skill|tool|mcp|knowledge|promptinject)\.json$/i.test(entry.name) &&
          !entry.name.startsWith(info.root + '/'),
      )
    )
      throw new Error('安装包包含多个独立扩展，请分别导入；本次未写入任何文件');
    const expectedRoot = rootByType[info.type];
    const selectedRoot =
      info.type === 'plugin' && declaration.scope === 'session' ? 'chat-plugins' : expectedRoot;
    if (root && root !== selectedRoot)
      throw Error('安装目录由清单 type/scope 自动确定，不能指定其他类型目录');
    info.relTarget = `${selectedRoot}/${info.id}`;
    info.targetDir = contained(host.options.root, info.relTarget);
    info.conflict = fs.existsSync(info.targetDir);
    if (root && root !== expectedRoot && !(info.type === 'plugin' && root === 'chat-plugins'))
      throw new Error('扩展类型与安装目录不匹配');
    contained(host.options.root, `${selectedRoot}/${idSchema.parse(info.id)}`);
    if (c.req.query('dry') === '1')
      return c.json({
        ok: true,
        analysis: runtime.importer.publicAnalysis(info),
      });
    const result = await runtime.importer.installEntries(info, {
      overwrite: c.req.query('overwrite') === '1',
      root: selectedRoot,
    });
    host.markImported(info.id);
    await host.reload();
    return c.json(result);
  });
  api.delete('/api/extensions/:type/:id', async (c) => {
    const root = rootByType[c.req.param('type')];
    if (!root) throw new Error('扩展类型非法');
    const id = idSchema.parse(c.req.param('id'));
    const descriptor = host.list().find((row) => row.id === id);
    if (descriptor?.details?.builtin || id.startsWith('ext-')) throw Error('内置管理器不能删除');
    // Scope describes configuration visibility, not where a package was installed.
    const candidates = [
      root,
      ...(root === 'plugins' || root === 'chat-plugins' ? ['plugins', 'chat-plugins'] : []),
    ];
    const installed = [...new Set(candidates)]
      .map((part) => contained(host.options.root, `${part}/${id}`))
      .filter((dir) => fs.existsSync(dir));
    const catalogFile = path.join(host.options.root, 'installed-catalog.json');
    const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : undefined;
    if (!installed.length && !catalog?.items?.some((item: { id: string }) => item.id === id))
      return c.json({ ok: false, error: { message: '扩展目录不存在' } }, 404);
    // Retire the live owner before removing its package, including Windows file handles.
    await host.configure(id, { enabled: false }, '');
    for (const dir of installed) fs.rmSync(dir, { recursive: true });
    if (catalog) {
      catalog.items = catalog.items.filter((item: { id: string }) => item.id !== id);
      fs.writeFileSync(catalogFile + '.tmp', JSON.stringify(catalog, null, 2));
      fs.renameSync(catalogFile + '.tmp', catalogFile);
    }
    await host.reload();
    return c.json({ ok: true });
  });
  api.get('/api/extensions/docs', (c) =>
    c.json({
      ok: true,
      docs: runtime.docRegistry.list().map(({ content, ...doc }: LegacyObject) => doc),
      kbs: runtime.docRegistry.listKbs(),
    }),
  );
  api.get('/api/extensions/:id/vars', (c) => {
    const id = idSchema.parse(c.req.param('id'));
    return c.json({
      ok: true,
      id,
      vars: runtime.variables.listVars(id).map((variable: LegacyObject) => ({
        ...variable,
        example: `{{${variable.name}}}`,
        preview: host.renderTemplate(`{{${variable.name}}}`, id).text,
      })),
    });
  });
  api.get('/api/extensions/:id/detail', (c) => {
    const row = host.list(chat(c.req.query('chat'))).find((row) => row.id === c.req.param('id'));
    if (!row) return c.json({ ok: false, error: { message: '扩展不存在' } }, 404);
    return c.json({
      ok: true,
      id: row.id,
      type: row.type,
      extension: row,
      sections: [
        {
          type: 'text',
          title: row.name,
          text: row.reason || row.description || '',
        },
        {
          type: 'code',
          title: '扩展描述',
          lang: 'json',
          text: JSON.stringify(redact(row.details), null, 2),
        },
      ],
    });
  });
  api.get('/api/extensions/:id/page', (c) => {
    const id = idSchema.parse(c.req.param('id'));
    const owner = runtime.skillManager.registry.get(id);
    const descriptor = runtime.extensionRegistry.get(id);
    const root = owner?.dir ?? descriptor?.details?.dir;
    if (!root || !host.list().some((row) => row.id === id && row.active))
      throw new Error('页面所属扩展未启用');
    const file = contained(root, c.req.query('file') ?? 'ui/tab.html');
    if (!/\.html?$/i.test(file)) throw new Error('只允许 HTML 页面');
    c.header('Content-Type', 'text/html; charset=utf-8');
    c.header(
      'Content-Security-Policy',
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'",
    );
    return c.body(fs.readFileSync(file));
  });
  api.get('/api/extensions/doc', (c) =>
    c.json(host.readDoc(c.req.query('id') ?? '', chat(c.req.query('chat'))) as object),
  );
  api.get('/api/extensions/knowledge/:id/tree', (c) =>
    c.json({
      ok: true,
      tree: runtime.knowledge.scanKnowledgeTree(library(c.req.param('id'))),
    }),
  );
  api.get('/api/extensions/knowledge/:id/changes', (c) =>
    c.json({
      ok: true,
      ...runtime.stale.detectStale(library(c.req.param('id'))),
    }),
  );
  api.get('/api/extensions/knowledge/:id/file', (c) => {
    const relPath = c.req.query('relPath') ?? '';
    const file = contained(library(c.req.param('id')), relPath);
    if (!/\.(md|txt|summery)$/i.test(file)) throw new Error('只允许读取文本知识文件');
    return c.json({
      ok: true,
      relPath,
      content: fs.readFileSync(file, 'utf8'),
    });
  });
  api.put('/api/extensions/knowledge/:id/file', async (c) => {
    const body = z.object({ relPath: z.string(), content: z.string().max(200000) }).parse(await c.req.json());
    const file = contained(library(c.req.param('id')), body.relPath);
    if (!/\.(md|txt|summery)$/i.test(file)) throw new Error('只允许修改文本知识文件');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', body.content, 'utf8');
    fs.renameSync(file + '.tmp', file);
    await host.reload();
    return c.json({ ok: true });
  });
  api.post('/api/extensions/knowledge/:id/summaries', async (c) => {
    const root = library(c.req.param('id'));
    const tree = runtime.knowledge.scanKnowledgeTree(root);
    const result = await runtime.summaries.ensureSummaries(root, tree, {
      useLlm: false,
      writeFiles: true,
    });
    await host.reload();
    return c.json({ ok: true, stats: result.stats });
  });
  api.post('/api/extensions/knowledge/:id/summarize', async (c) => {
    const body = z.object({ node: z.string().default('') }).parse(await c.req.json());
    const root = library(c.req.param('id'));
    const tree = runtime.knowledge.scanKnowledgeTree(root);
    let node = tree;
    const ancestors = [tree];
    for (const part of body.node.split('/').filter((part) => part && part !== '.')) {
      node = node.children?.find((child: LegacyObject) => child.name === part);
      if (!node) throw new Error('知识节点不存在');
      ancestors.push(node);
    }
    for (const ancestor of ancestors) {
      const target = runtime.knowledge.summaryAbsFor(root, ancestor);
      const rel = path.relative(root, target);
      contained(root, rel);
      if (fs.existsSync(target)) fs.rmSync(target);
    }
    const result = await runtime.summaries.ensureSummaries(root, tree, {
      useLlm: false,
      writeFiles: true,
    });
    await host.reload();
    return c.json({
      ok: true,
      libId: c.req.param('id'),
      node: body.node || '.',
      stats: result.stats,
    });
  });
  api.get('/api/extensions/summary-status', (c) =>
    c.json({
      ok: true,
      ...runtime.builtinModules['ext-knowledge'].summaryStatus(),
    }),
  );
  api.get('/api/v2-assets/:owner/*', (c) => {
    const owner = idSchema.parse(c.req.param('owner'));
    const descriptor = runtime.skillManager.registry.get(owner);
    if (!descriptor || !host.list().some((row) => row.id === owner && row.active))
      throw new Error('页面所属扩展未启用');
    const rel = c.req.path.split('/').slice(4).map(decodeURIComponent).join('/');
    const file = contained(descriptor.dir, rel);
    const suffix = path.extname(file);
    const mime: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    if (!mime[suffix]) throw new Error('不支持的页面资源类型');
    if (
      suffix === '.js' &&
      !runtime.tabs.listTabs().some((tab: LegacyObject) => tab.ownerId === owner && tab.builtin)
    )
      throw new Error('脚本资源仅限内置插件');
    c.header('Content-Type', mime[suffix]);
    c.header(
      'Content-Security-Policy',
      "sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'",
    );
    return c.body(fs.readFileSync(file));
  });
  api.onError((error, c) =>
    c.json(
      {
        ok: false,
        error: {
          code:
            error.name === 'ZodError' || error instanceof SyntaxError ? 'INVALID_INPUT' : 'EXTENSION_FAILED',
          message:
            error.name === 'ZodError'
              ? '扩展作用域或请求参数无效，请选择默认设置或具体群聊／私聊'
              : error.message,
        },
      },
      error.name === 'ZodError' || error instanceof SyntaxError ? 400 : 409,
    ),
  );
  return api;
}
