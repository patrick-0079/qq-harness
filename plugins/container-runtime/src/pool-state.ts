import type { ContainerPoolState, ContainerResource } from '@qq-harness/contracts';
import { sessionIdentity } from './accounts.js';

/** Old keys remain untouched so rollback can restore the original application. */
export function legacyContainerPool(bound: unknown, unbound: unknown): ContainerPoolState {
  const resources = new Map<string, ContainerResource>();
  const bindings: ContainerPoolState['bindings'] = [];
  for (const [rows, assigned] of [
    [bound, true],
    [unbound, false],
  ] as const) {
    if (rows != null && !Array.isArray(rows)) throw Error('旧容器数据格式无效');
    for (const row of rows ?? []) {
      const resource: ContainerResource = {
        id: row.id,
        name: row.name,
        engine: row.engine,
        binary: row.binary,
        image: row.image,
        managed: true,
        enabled: true,
        ownerChatKey: row.ownerChatKey ?? row.chatKey,
      };
      resources.set(resource.id, resource);
      if (assigned)
        bindings.push({
          ...resource,
          chatKey: row.chatKey,
          ...sessionIdentity(row.chatKey),
          primary: true,
          legacyWorkspace: true,
        });
    }
  }
  return { version: 2, resources: [...resources.values()], bindings };
}
