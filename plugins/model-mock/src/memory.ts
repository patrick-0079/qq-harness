import type { ModelMessage, ModelResponse } from '@qq-harness/domain';
import { textContent } from '@qq-harness/contracts';
import { randomUUID } from 'node:crypto';
/** Deterministic development fixture; production semantic decisions use the configured model. */
export function mockMemory(messages: ModelMessage[]): ModelResponse {
  const raw = messages.find((m) => m.role === 'user');
  let context: any = {};
  try {
    context = JSON.parse(textContent(raw?.content));
  } catch {
    /* An empty maintenance fixture is a no-op. */
  }
  const request = context.request ?? {},
    memories: any[] = context.memories ?? [],
    calls: [string, unknown][] = [];
  const targets = [...memories, ...(context.notes ?? [])].filter((r) => request.targetIds?.includes(r.id));
  const write = (r: any, content: string, tier = r.tier) => ({
    id: r.id,
    expectedRevision: r.revision,
    tier,
    scope: r.scope,
    personId: r.personId ?? undefined,
    key: r.key,
    title: r.document?.title,
    content,
  });
  if (request.origin === 'schedule') {
    if (request.tier === 'short')
      for (const note of context.notes ?? []) {
        const prior = memories.find((r) => r.tier === 'short' && r.key === `scratchpad:${note.id}`);
        if (prior?.text === note.text) continue;
        calls.push([
          'memory_write',
          {
            ...(prior
              ? write(prior, note.text)
              : { tier: 'short', scope: 'chat', key: `scratchpad:${note.id}`, content: note.text }),
            noteIds: [note.id],
          },
        ]);
      }
    const from = request.tier === 'long' ? 'medium' : 'short';
    if (request.tier && request.tier !== 'short')
      for (const record of memories.filter((r) => r.tier === from && r.document?.role !== 'persona')) {
        const prior = memories.find((r) => r.tier === request.tier && r.key === record.key);
        if (prior && prior.text === record.text) continue;
        calls.push([
          'memory_write',
          prior
            ? { ...write(prior, record.text), sourceRecordIds: [record.id] }
            : {
                sourceRecordIds: [record.id],
                tier: request.tier,
                scope: record.scope,
                personId: record.personId ?? undefined,
                key: record.key,
                title: record.document?.title ?? record.key,
                content: record.text,
              },
        ]);
      }
  } else if (/遗忘|删除/.test(request.instruction ?? '')) {
    let selected = targets;
    if (!selected.length) {
      try {
        const args = JSON.parse(String(request.instruction).replace(/^.*?[：:]/, ''));
        selected = memories.filter(
          (r) =>
            r.personId &&
            (!args.userId || r.personId === String(args.userId)) &&
            (!args.content || r.text.includes(args.content)),
        );
      } catch {
        /* Explicit target IDs are preferred. */
      }
    }
    for (const record of selected)
      calls.push([
        'memory_forget',
        { id: record.id, expectedRevision: record.revision, reason: request.instruction },
      ]);
  } else if (request.tier === 'scratchpad') {
    const note = (context.notes ?? []).find((n: any) => request.targetIds?.includes(n.id));
    let text = String(request.instruction ?? '').replace(/^.*?[：:]/, '');
    try {
      text = JSON.parse(text).text ?? text;
    } catch {
      /* Free text is valid draft material. */
    }
    calls.push(['scratchpad_write', { id: note?.id, expectedRevision: note?.revision, text }]);
  } else {
    let value: any;
    const text = String(request.instruction ?? '').replace(/^.*?[：:]/, '');
    try {
      value = JSON.parse(text);
    } catch {
      value = { text };
    }
    if (Array.isArray(value.items) && value.items[0]) {
      const item = value.items[0];
      value = { text: item.content, key: 'legacy:' + item.category + ':' + item.key };
    }
    if (value.content && !value.text) value.text = value.content;
    if (value.content && value.userId) {
      value.scope = 'chat_person';
      value.personId = String(value.userId);
      value.key = 'memberImpression:' + value.userId;
    }
    if (targets.length) {
      const prior = targets[0];
      calls.push(['memory_write', write(prior, value.patch?.text ?? value.text ?? text)]);
    } else if (value.text)
      calls.push([
        'memory_write',
        {
          tier: request.tier ?? 'short',
          scope: value.scope ?? 'chat',
          personId: value.personId ?? undefined,
          key: value.key ?? 'development-note',
          title: value.key ?? '开发记忆',
          content: value.text,
          sourceIds: request.sourceIds ?? [],
        },
      ]);
  }
  calls.push([
    'memory_finish',
    { summary: calls.length ? '开发模型已处理维护申请；实际修改见结果。' : '本次没有需要新增或更正的内容。' },
  ]);
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: calls.map(([name, args]) => ({
        id: randomUUID(),
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      })),
    },
    usage: { input: 0, output: 0 },
  };
}
