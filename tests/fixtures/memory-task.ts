import { vi } from 'vitest';
import { memoryAgentService } from '@qq-harness/domain';
import type { createApplication } from '../../apps/server/src/app.js';
export async function waitMemoryRequest(
  app: Awaited<ReturnType<typeof createApplication>>,
  id: string,
  chatKey = 'group:1',
) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const task = app.runtime
      .use(memoryAgentService)
      .requests(chatKey)
      .find((t) => t.id === id);
    if (task && !['queued', 'running'].includes(task.status)) return task;
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error('记忆申请未完成：' + id);
}
