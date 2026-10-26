import { Hono } from 'hono';
import { z } from 'zod';
import { chatKeySchema, memoryRecordSchema } from '@qq-harness/contracts';
import type { MemoryService } from '@qq-harness/domain';

const recordInput = memoryRecordSchema.omit({
  id: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  lastConfirmedAt: true,
  status: true,
});
const noteInput = z.object({
  chatKey: chatKeySchema,
  text: z.string().min(1).max(10000),
  sourceIds: z.array(z.number().int().positive()).max(30).optional(),
  ttlMs: z.number().int().positive().optional(),
});

export function memoryRoutes(memory: MemoryService) {
  const api = new Hono();
  api.onError((error, c) =>
    c.json(
      {
        error: {
          code:
            error instanceof z.ZodError || error instanceof SyntaxError ? 'INVALID_INPUT' : 'MEMORY_ERROR',
          message: error instanceof z.ZodError ? '记忆请求参数无效' : error.message,
        },
      },
      error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 409,
    ),
  );
  api.get('/api/memory/status', (c) => c.json(memory.indexStatus()));
  api.get('/api/memory/records', (c) => {
    const chatKey = chatKeySchema.parse(c.req.query('chatKey'));
    const personId = c.req.query('personId') || undefined;
    return c.json(memory.list(chatKey, personId));
  });
  api.get('/api/memory/search', async (c) => {
    const chatKey = chatKeySchema.parse(c.req.query('chatKey'));
    const query = z.string().min(1).max(1000).parse(c.req.query('query'));
    return c.json(await memory.search(chatKey, query, c.req.query('personId') || undefined));
  });
  api.post('/api/memory/records', async (c) => {
    const input = recordInput.parse(await c.req.json());
    return c.json(memory.remember({ ...input, origin: 'admin' }), 201);
  });
  api.patch('/api/memory/records/:id', async (c) => {
    const body = z
      .object({
        expectedRevision: z.number().int().positive(),
        patch: memoryRecordSchema
          .pick({
            scope: true,
            tier: true,
            chatKey: true,
            personId: true,
            key: true,
            text: true,
            visibility: true,
            sensitive: true,
            confidence: true,
            importance: true,
            pinned: true,
            sources: true,
            expiresAt: true,
          })
          .partial(),
      })
      .parse(await c.req.json());
    return c.json(memory.update(c.req.param('id'), body.patch, body.expectedRevision));
  });
  api.post('/api/memory/records/:id/promote', async (c) => {
    const body = z
      .object({
        chatKey: chatKeySchema,
        target: z.enum(['long', 'person']),
        expectedRevision: z.number().int().positive(),
      })
      .parse(await c.req.json());
    const prior = memory.list(body.chatKey).find((record) => record.id === c.req.param('id'));
    if (!prior || prior.key === 'legacy-text') throw new Error('记忆不存在');
    if (body.target === 'long')
      return c.json(
        memory.update(
          prior.id,
          {
            tier: 'long',
            expiresAt: null,
            origin: 'admin',
          },
          body.expectedRevision,
        ),
      );
    if (prior.scope !== 'chat_person' || !prior.personId || prior.sensitive)
      throw new Error('只有非敏感的会话成员记忆可提升为通用个人记忆');
    return c.json(
      memory.update(
        prior.id,
        {
          scope: 'person',
          chatKey: null,
          visibility: 'cross_chat',
          origin: 'admin',
        },
        body.expectedRevision,
      ),
    );
  });
  api.delete('/api/memory/records/:id', async (c) => {
    const revision = z.coerce.number().int().positive().parse(c.req.query('revision'));
    return c.json(memory.remove(c.req.param('id'), revision));
  });
  api.get('/api/memory/records/:id/history', (c) =>
    c.json(memory.history(c.req.param('id'), chatKeySchema.parse(c.req.query('chatKey')))),
  );
  api.get('/api/memory/notes', (c) => c.json(memory.notes(chatKeySchema.parse(c.req.query('chatKey')))));
  api.post('/api/memory/notes', async (c) => {
    const body = noteInput.parse(await c.req.json());
    return c.json(memory.note(body.chatKey, body.text, body.sourceIds, body.ttlMs), 201);
  });
  api.patch('/api/memory/notes/:id', async (c) => {
    const body = z
      .object({
        chatKey: chatKeySchema,
        patch: z.object({
          text: z.string().min(1).max(10000).optional(),
          important: z.boolean().optional(),
          sourceIds: z.array(z.number().int().positive()).max(30).optional(),
          ttlMs: z.number().int().positive().optional(),
        }),
      })
      .parse(await c.req.json());
    return c.json(memory.updateNote(body.chatKey, c.req.param('id'), body.patch));
  });
  api.delete('/api/memory/notes/:id', (c) => {
    memory.deleteNote(chatKeySchema.parse(c.req.query('chatKey')), c.req.param('id'));
    return c.json({ ok: true });
  });
  return api;
}
