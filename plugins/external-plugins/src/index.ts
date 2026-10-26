import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { definePlugin, type PluginDefinition } from '@qq-harness/plugin-sdk';
import { configService, httpService } from '@qq-harness/domain';

const manifestSchema = z.object({
  apiVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().optional(),
  version: z.string().min(1),
  server: z.string().optional(),
  client: z.string().optional(),
  css: z.array(z.string()).default([]),
  assets: z.array(z.string()).default([]),
  requires: z.array(z.string()).default([]),
});
function inside(root: string, relative: string): string {
  const resolved = fs.realpathSync(path.resolve(root, relative));
  const rel = path.relative(fs.realpathSync(root), resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('插件入口或资源越界');
  return resolved;
}
export function externalPlugins(extensionDir: string) {
  return definePlugin({
    id: 'external-plugins',
    name: '后装插件加载器',
    requires: [configService.id, httpService.id],
    async setup(ctx) {
      fs.mkdirSync(extensionDir, { recursive: true });
      const http = ctx.use(httpService),
        config = ctx.use(configService);
      const roots = new Map<string, { root: string; hash: string; allowed: Set<string> }>();
      const api = new Hono();
      api.get('/api/plugin-assets/:id/:hash/*', (c) => {
        const info = roots.get(c.req.param('id'));
        const descriptor = ctx.host.listPlugins().find((plugin) => plugin.id === c.req.param('id'));
        if (!info || info.hash !== c.req.param('hash') || descriptor?.status !== 'active')
          return c.notFound();
        const relative = decodeURIComponent(c.req.path.split('/').slice(5).join('/'));
        try {
          if (!info.allowed.has(relative)) return c.notFound();
          const file = inside(info.root, relative);
          const ext = path.extname(file);
          const types: Record<string, string> = {
            '.js': 'text/javascript',
            '.mjs': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
          };
          if (!types[ext]) return c.notFound();
          c.header('Content-Type', types[ext]);
          return c.body(new Uint8Array(fs.readFileSync(file)));
        } catch {
          return c.notFound();
        }
      });
      ctx.effect(http.register('/api/plugin-assets', (request) => api.fetch(request)));
      ctx.provide({ id: 'harness.external-loader' }, { ready: true });
      for (const entry of fs.readdirSync(extensionDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        try {
          const root = path.join(extensionDir, entry.name);
          const manifest = manifestSchema.parse(
            JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8')),
          );
          const digest = createHash('sha256').update(JSON.stringify(manifest));
          for (const file of [
            ...(manifest.client ? [manifest.client] : []),
            ...manifest.assets,
            ...manifest.css,
          ])
            digest.update(fs.readFileSync(inside(root, file)));
          const hash = digest.digest('hex').slice(0, 16);
          if (manifest.server) inside(root, manifest.server);
          if (manifest.client) inside(root, manifest.client);
          const allowed = new Set([
            ...(manifest.client ? [manifest.client.replaceAll('\\', '/')] : []),
            ...manifest.assets,
            ...manifest.css,
          ]);
          for (const asset of allowed) inside(root, asset);
          roots.set(manifest.id, { root, hash, allowed });
          const plugin: PluginDefinition = {
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            requires: [...new Set([...manifest.requires, 'harness.external-loader'])],
            client: manifest.client
              ? {
                  entry: `/api/plugin-assets/${manifest.id}/${hash}/${manifest.client.replaceAll('\\', '/')}`,
                  css: manifest.css.map((file) => `/api/plugin-assets/${manifest.id}/${hash}/${file}`),
                }
              : undefined,
            setup: async (pluginContext) => {
              if (!manifest.server) return;
              // 仅在启用后 import，停用的插件不能通过模块顶层产生副作用。
              const module = (await import(
                pathToFileURL(inside(root, manifest.server)).href + `?v=${hash}`
              )) as { default: PluginDefinition };
              const implementation = module.default;
              if (
                typeof implementation?.setup !== 'function' ||
                implementation.id !== manifest.id ||
                implementation.requires?.some((name) => !manifest.requires.includes(name))
              )
                throw new Error('服务端导出或依赖与清单不一致');
              await implementation.setup(pluginContext);
            },
          };
          ctx.host.install(plugin, config.get().plugins[manifest.id] === true);
        } catch (error) {
          ctx.log(`无法加载 ${entry.name}：${error instanceof Error ? error.message : error}`);
        }
      }
    },
  });
}
