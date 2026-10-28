import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { configService, httpService, traceService } from '@qq-harness/domain';
import type { RunDetail } from '@qq-harness/contracts';
import {redactKnownSecrets} from '@qq-harness/files';

export function runInspector(dataDir: string) {
  return definePlugin({
    id: 'run-inspector',
    name: '运行详情与调试记录',
    client: { entry: 'builtin:run-inspector' },
    requires: [configService.id, httpService.id],
    setup(ctx) {
      const config = ctx.use(configService),
        root = path.join(dataDir, 'run-details');
      fs.mkdirSync(root, { recursive: true });
      const cache = new Map<string, RunDetail>();
      const file = (id: string) => {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('运行 ID 无效');
        return path.join(root, id + '.json.gz');
      };
      const sanitize=(value:unknown)=>redactKnownSecrets(value,config.get());
      const load = (id: string) => {
        if (cache.has(id)) return cache.get(id);
        if (!fs.existsSync(file(id))) return undefined;
        const record = JSON.parse(
          gunzipSync(fs.readFileSync(file(id)), { maxOutputLength: 256 * 1024 * 1024 }).toString('utf8'),
        ) as RunDetail;
        if (record.expiresAt <= Date.now()) return undefined;
        if(record.status==='running'){record.status='interrupted';record.endedAt=Date.now();save(record);}
        return record;
      };
      const save = (record: RunDetail) => {
        const target = file(record.id),
          temporary = target + '.' + randomUUID() + '.tmp';
        try {
          fs.writeFileSync(temporary, gzipSync(JSON.stringify(record)));
          fs.renameSync(temporary, target);
        } catch(error) {ctx.log('运行详情持久化失败：'+(error instanceof Error?error.message:String(error)));ctx.host.publish('run.detail-error',{id:record.id,message:'详情持久化失败，请检查磁盘状态'});
        } finally {
          fs.rmSync(temporary, { force: true });
        }
      };
      ctx.provide(traceService, {
        start: (id, chatKey) => {
          if (!config.get().debug.enabled) return;
          const record: RunDetail = {
            version: 1,
            id,
            chatKey,
            startedAt: Date.now(),
            status: 'running',
            expiresAt: Date.now() + config.get().debug.retentionDays * 86400000,
            events: [],
          };
          cache.set(id, record);
          save(record);
        },
        record: (id, kind, title, data, details = {}) => {
          const record = cache.get(id);
          if (!record) return '';
          const event = {
            ...details,
            id: randomUUID(),
            sequence: record.events.length + 1,
            kind,
            title,
            at: Date.now(),
            data: sanitize(data),
          };
          record.events.push(event);
          save(record);
          ctx.host.publish('run.detail', { id, sequence: event.sequence, kind });
          return event.id;
        },
        end: (id, status) => {
          const record = cache.get(id);
          if (record) {
            record.status = status;
            record.endedAt = Date.now();
            save(record);
            cache.delete(id);
          }
        },
        get: load,
      });
      const cleanup = () => {
        for (const entry of fs.readdirSync(root).filter((n) => n.endsWith('.json.gz'))) {
          const id = entry.slice(0, -8);
          try {
            if (!cache.has(id) && !load(id)) fs.rmSync(file(id));
          } catch {
            ctx.log('运行详情文件无法读取：' + id);
          }
        }
      };
      cleanup();
      const timer = setInterval(cleanup, 60000);
      timer.unref?.();
      ctx.effect(() => {
        clearInterval(timer);
        for (const record of cache.values()) {
          record.status = 'interrupted';
          record.endedAt = Date.now();
          save(record);
        }
        cache.clear();
      });
      const api = new Hono();
      api.get('/api/run-details/:id', (c) => {
        try {
          const record = load(c.req.param('id'));
          if (!record) return c.json({ error: { message: '该运行未记录完整详情，或详情已过保留期' } }, 404);
          const after = Number(c.req.query('after') ?? 0);
          return c.json({ ...record, events: record.events.filter((e) => e.sequence > after) });
        } catch {
          return c.json({ error: { message: '运行详情不可读取' } }, 400);
        }
      });
      ctx.effect(ctx.use(httpService).register('/api/run-details', (request) => api.fetch(request)));
    },
  });
}
