import { expect, test } from 'vitest';
import { liveScope } from '../tools/live-scope.js';

test('manual verification fails closed without two explicit numeric targets', () => {
  for (const env of [
    {},
    { HARNESS_LIVE_PRIVATE_ID: '10002' },
    { HARNESS_LIVE_PRIVATE_ID: '10002', HARNESS_LIVE_GROUP_ID: 'group:10001' },
    { HARNESS_LIVE_PRIVATE_ID: '10002,10003', HARNESS_LIVE_GROUP_ID: '10001' },
  ]) expect(() => liveScope(env)).toThrow('人工联调需要显式配置');
  expect(liveScope({ HARNESS_LIVE_PRIVATE_ID: '10002', HARNESS_LIVE_GROUP_ID: '10001' })).toEqual({
    privateId: '10002',
    groupId: '10001',
    allowedChats: ['private:10002', 'group:10001'],
  });
});
