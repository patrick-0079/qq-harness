import { Hono } from 'hono';
import { z } from 'zod';
import {
  chatKeySchema,
  memoryTierSchema,
  memoryScheduleOverrideSchema,
  memoryRequestInputSchema,
  memoryRecordSchema,
  type MemoryAgentService,
} from '@qq-harness/contracts';
import type { MemoryService, ConfigService, MemoryRepository } from '@qq-harness/domain';
import { memoryError } from './agent.js';

export function memoryRoutes(
  memory: MemoryService,
  config: ConfigService,
  agent: MemoryAgentService,
  repo: MemoryRepository,
) {
  const api = new Hono();
  const key = (value: unknown) => chatKeySchema.parse(value);
  const tier = (value?: string) => (value ? memoryTierSchema.parse(value) : undefined);
  const current = (id: string) => {
    const record = repo.record(id);
    if (!record) throw Error('记忆不存在');
    const chatKey = record.chatKey ?? record.sources[0]?.chatKey;
    if (!chatKey || !agent.read(chatKey, id)) throw Error('记忆已失效或不属于获准范围');
    return { record, chatKey };
  };
  api.onError((error, c) =>
    c.json(
      {
        error: {
          code: error instanceof z.ZodError ? 'INVALID_INPUT' : 'MEMORY_ERROR',
          message: memoryError(error),
        },
      },
      error instanceof z.ZodError ? 400 : 409,
    ),
  );
  api.get('/api/memory/status', (c) => c.json(memory.indexStatus()));
  api.get('/api/memory/requests', (c) => c.json(agent.requests(key(c.req.query('chatKey')))));
  api.get('/api/memory/requests/:id', (c) => {
    const task = agent.requests(key(c.req.query('chatKey'))).find((t) => t.id === c.req.param('id'));
    return task ? c.json(task) : c.json({ error: { message: '申请不存在' } }, 404);
  });
  api.post('/api/memory/requests', async (c) => {
    const input = memoryRequestInputSchema.parse(await c.req.json());
    return c.json(agent.request({ ...input, origin: 'user' }), 202);
  });
  api.post('/api/memory/requests/:id/clarify', async (c) => {
    const input = z
      .object({ chatKey: chatKeySchema, instruction: z.string().min(1).max(10000) })
      .parse(await c.req.json());
    return c.json(agent.clarify(input.chatKey, c.req.param('id'), input.instruction), 202);
  });
  api.get('/api/memory/documents', (c) =>
    c.json(agent.list(key(c.req.query('chatKey')), tier(c.req.query('tier'))).filter((r) => r.document)),
  );
  api.get('/api/memory/documents/:id', (c) => {
    const item = agent.read(key(c.req.query('chatKey')), c.req.param('id'));
    return item && 'document' in item && item.document
      ? c.json(item)
      : c.json({ error: { message: '文档不存在' } }, 404);
  });
  api.get('/api/memory/documents/:id/history', (c) =>
    c.json(memory.history(c.req.param('id'), key(c.req.query('chatKey')))),
  );
  api.get('/api/memory/records', (c) => {
    const chatKey = key(c.req.query('chatKey'));
    return c.json(
      (c.req.query('history') === '1'
        ? memory.listHistory(chatKey)
        : agent.list(chatKey, tier(c.req.query('tier')))
      ).filter((r) => !c.req.query('personId') || r.personId === c.req.query('personId')),
    );
  });
  api.get('/api/memory/records/:id/history', (c) =>
    c.json(memory.history(c.req.param('id'), key(c.req.query('chatKey')))),
  );
  api.get('/api/memory/search', async (c) =>
    c.json(
      await memory.search(
        key(c.req.query('chatKey')),
        z.string().min(1).max(1000).parse(c.req.query('query')),
        c.req.query('personId') || undefined,
      ),
    ),
  );
  api.get('/api/memory/notes', (c) => {
    const chatKey = key(c.req.query('chatKey'));
    agent.list(chatKey);
    return c.json(repo.notes(chatKey, c.req.query('history') === '1'));
  });
  api.get('/api/memory/notes/:id/history', (c) =>
    c.json(memory.noteHistory(key(c.req.query('chatKey')), c.req.param('id'))),
  );
  // Compatibility write endpoints submit requests too; no UI/API can publish around the maintainer.
  api.post('/api/memory/records', async (c) => {
    const body = memoryRecordSchema
      .omit({
        id: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
        lastConfirmedAt: true,
        status: true,
      })
      .parse(await c.req.json());
    return c.json(
      agent.request({
        chatKey: key(body.chatKey ?? body.sources[0]?.chatKey),
        tier: body.tier,
        instruction: '新增记忆，按主题与已有记忆融合：' + JSON.stringify(body),
        sourceIds: body.sources.flatMap((s) => (s.localId ? [s.localId] : [])),
      }),
      202,
    );
  });
  api.patch('/api/memory/records/:id', async (c) => {
    const body = z
      .object({ expectedRevision: z.number().int().positive(), patch: z.record(z.string(), z.unknown()) })
      .parse(await c.req.json());
    const { record, chatKey } = current(c.req.param('id'));
    if (record.revision !== body.expectedRevision) throw Error('记忆版本冲突');
    return c.json(
      agent.request({
        chatKey,
        tier: record.tier,
        targetIds: [record.id],
        instruction: '更正记忆并语义融合：' + JSON.stringify(body),
      }),
      202,
    );
  });
  api.delete('/api/memory/records/:id', (c) => {
    const { record, chatKey } = current(c.req.param('id'));
    if (record.revision !== z.coerce.number().int().positive().parse(c.req.query('revision')))
      throw Error('记忆版本冲突');
    return c.json(
      agent.request({
        chatKey,
        tier: record.tier,
        targetIds: [record.id],
        instruction: '遗忘这条记忆：' + record.text,
      }),
      202,
    );
  });
  api.post('/api/memory/records/:id/promote', async (c) => {
    const body = z
      .object({
        chatKey: chatKeySchema,
        expectedRevision: z.number().int().positive(),
        target: z.enum(['long', 'person']),
      })
      .parse(await c.req.json());
    const { record } = current(c.req.param('id'));
    if (record.revision !== body.expectedRevision) throw Error('记忆版本冲突');
    return c.json(
      agent.request({
        chatKey: body.chatKey,
        targetIds: [record.id],
        instruction: '将这条记忆整理提升到' + (body.target === 'long' ? '长期主题文档' : '可共享个人记忆'),
      }),
      202,
    );
  });
  api.post('/api/memory/notes', async (c) => {
    const body = z
      .object({
        chatKey: chatKeySchema,
        text: z.string().min(1).max(10000),
        sourceIds: z.array(z.number().int().positive()).optional(),
      })
      .parse(await c.req.json());
    return c.json(
      agent.request({
        chatKey: body.chatKey,
        tier: 'scratchpad',
        sourceIds: body.sourceIds,
        instruction: '草稿本记录：' + body.text,
      }),
      202,
    );
  });
  api.patch('/api/memory/notes/:id', async (c) => {
    const body = z
      .object({ chatKey: chatKeySchema, patch: z.record(z.string(), z.unknown()) })
      .parse(await c.req.json());
    return c.json(
      agent.request({
        chatKey: body.chatKey,
        tier: 'scratchpad',
        targetIds: [c.req.param('id')],
        instruction: '修改草稿本：' + JSON.stringify(body.patch),
      }),
      202,
    );
  });
  api.delete('/api/memory/notes/:id', (c) =>
    c.json(
      agent.request({
        chatKey: key(c.req.query('chatKey')),
        tier: 'scratchpad',
        targetIds: [c.req.param('id')],
        instruction: '遗忘这条草稿本内容',
      }),
      202,
    ),
  );
  api.get('/api/memory/drafts', (c) => c.json(memory.drafts(key(c.req.query('chatKey')))));
  api.delete('/api/memory/drafts/:id', (c) => {
    const chatKey = key(c.req.query('chatKey'));
    memory.cancelDraft(chatKey, c.req.param('id'));
    return c.json({ ok: true });
  });
  api.get('/api/memory/consolidation', (c) => c.json(agent.status(key(c.req.query('chatKey')))));
  api.post('/api/memory/consolidate', async (c) => {
    const body = z
      .object({ chatKey: chatKeySchema, tier: memoryTierSchema.optional() })
      .parse(await c.req.json());
    const tasks = (body.tier ? [body.tier] : (['short', 'medium', 'long'] as const)).map((tier) =>
      agent.request({
        chatKey: body.chatKey,
        tier,
        instruction: '立即整理相关记忆：读取条目和文档，语义融合并处理待生效更正',
        origin: 'schedule',
      }),
    );
    return c.json({ id: tasks[0]!.id, ids: tasks.map((t) => t.id) }, 202);
  });
  api.get('/api/memory/settings', (c) => {
    const chatKey = c.req.query('chatKey');
    if (chatKey) key(chatKey);
    return c.json({
      defaults: config.get().defaults.memory,
      overrides: chatKey ? (config.get().memoryOverrides[chatKey] ?? {}) : {},
      effective: chatKey ? config.effective(chatKey).memory : config.get().defaults.memory,
    });
  });
  api.patch('/api/memory/settings', async (c) => {
    const body = z
      .object({ chatKey: chatKeySchema.optional(), patch: memoryScheduleOverrideSchema.nullable() })
      .parse(await c.req.json());
    config.saveMemorySchedule(body.chatKey, body.patch);
    return c.json({ ok: true });
  });
  return api;
}
