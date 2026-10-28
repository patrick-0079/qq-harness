import { afterEach, expect, test, vi } from 'vitest';
import { operationsSettingsSchema } from '@qq-harness/contracts';
import { createBalanceQuery, normalizeChannel } from '../plugins/ops-control/src/balance.js';

afterEach(() => vi.useRealTimers());
const settings = operationsSettingsSchema.parse({ opencodeGoKey: 'fixture-secret' });
const signal = () => new AbortController().signal;
const quota = () =>
  Response.json({ usage: { rolling: { percent: 0 }, weekly: { percent: 20 }, monthly: { percent: 50 } } });

test('连接中断后仅重试一次，成功后缓存；密钥及底层异常不泄露', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(
      new TypeError('fixture-secret', {
        cause: Object.assign(new Error('fixture-secret'), { code: 'ECONNRESET' }),
      }),
    )
    .mockImplementation(async () => quota());
  const query = createBalanceQuery(fetcher);
  const result = await query(settings, 'go', signal());
  expect(result[0]).toMatchObject({
    status: 'ok',
    lines: [
      expect.stringContaining('已用 0.0%'),
      expect.stringContaining('已用 20.0%'),
      expect.stringContaining('已用 50.0%'),
    ],
  });
  expect(JSON.stringify(result)).not.toContain('fixture-secret');
  expect(await query(settings, 'opencode-go', signal())).toEqual(result);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(fetcher.mock.calls[1]?.[1]?.signal);
});

test('连续网络失败不缓存，恢复后下一次查询立即成功', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(Object.assign(new Error('fixture-secret'), { code: 'EAI_AGAIN' }));
  const query = createBalanceQuery(fetcher);
  const result = await query(settings, 'go', signal());
  expect(result[0]).toMatchObject({ status: 'failed', lines: ['渠道域名解析失败，请检查 DNS 或代理配置'] });
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockImplementation(async () => quota());
  expect((await query(settings, 'go', signal()))[0]?.status).toBe('ok');
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test('临时网关错误和非 JSON 响应可重试，认证失败不重试', async () => {
  for (const response of [new Response('', { status: 502 }), new Response('<html>fixture-secret</html>')]) {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response)
      .mockImplementation(async () => quota());
    expect((await createBalanceQuery(fetcher)(settings, 'go', signal()))[0]?.status).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('fixture-secret', { status: 401 }));
  expect((await createBalanceQuery(fetcher)(settings, 'go', signal()))[0]).toMatchObject({
    status: 'unauthorized',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test('HTTP 限流、TLS 和未知错误使用安全的具体提示，不回显响应或异常', async () => {
  const cases: [() => Promise<Response>, string][] = [
    [async () => new Response('fixture-secret', { status: 429 }), 'HTTP 429'],
    [
      async () => {
        throw Object.assign(new Error('fixture-secret'), { code: 'CERT_HAS_EXPIRED' });
      },
      'TLS',
    ],
    [
      async () => {
        throw new Error('fixture-secret');
      },
      '渠道请求失败',
    ],
    [async () => Response.json({ usage: { rolling: { percent: false } } }), '缺少有效配额窗口'],
  ];
  for (const [fetcher, expected] of cases) {
    const result = await createBalanceQuery(vi.fn(fetcher))(settings, 'go', signal());
    expect(result[0]?.status).toBe('failed');
    expect(result[0]?.lines.join(' ')).toContain(expected);
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
  }
});

test('持续非 JSON 响应报告接口错误，修复后无需等缓存到期', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response('<html>fixture-secret</html>'));
  const query = createBalanceQuery(fetcher);
  expect((await query(settings, 'go', signal()))[0]?.lines).toEqual([
    '渠道返回非 JSON 数据，请检查接口或代理响应',
  ]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockImplementation(async () => quota());
  expect((await query(settings, 'go', signal()))[0]?.status).toBe('ok');
});

test('整个重试共享超时，取消不重试也不缓存', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>(
    async (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
  );
  const query = createBalanceQuery(fetcher);
  const first = query({ ...settings, timeoutMs: 5000 }, 'go', signal());
  await vi.advanceTimersByTimeAsync(5000);
  expect((await first)[0]?.status).toBe('timeout');
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async () => quota());
  expect((await query({ ...settings, timeoutMs: 5000 }, 'go', signal()))[0]?.status).toBe('ok');
  const controller = new AbortController();
  controller.abort();
  const cancelled = await createBalanceQuery(fetcher)(settings, 'go', controller.signal);
  expect(cancelled[0]?.lines).toEqual(['渠道查询已取消']);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('渠道别名、空白凭据和未配置渠道不触发请求', async () => {
  expect(normalizeChannel(' OPENCODE ')).toBe('opencode-go');
  expect(normalizeChannel('全部')).toBe('all');
  const fetcher = vi.fn<typeof fetch>();
  const result = await createBalanceQuery(fetcher)({ ...settings, opencodeGoKey: '  ' }, 'all', signal());
  expect(result).toHaveLength(4);
  expect(result.every((r) => r.status === 'unconfigured')).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});
