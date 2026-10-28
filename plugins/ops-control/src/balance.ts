import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { OperationsSettings } from '@qq-harness/contracts';
export const channels = ['opencode-go', 'deepseek', 'glm', 'mimo'] as const;
export type BalanceChannel = (typeof channels)[number];
export interface BalanceResult {
  channel: BalanceChannel;
  status: 'ok' | 'unconfigured' | 'timeout' | 'unauthorized' | 'failed';
  at: number;
  lines: string[];
}
const credentials = {
  'opencode-go': 'opencodeGoKey',
  deepseek: 'deepseekKey',
  glm: 'glmKey',
  mimo: 'mimoCookie',
} as const;
class BalanceQueryError extends Error {
  constructor(
    message: string,
    readonly status: BalanceResult['status'] = 'failed',
    readonly retryable = false,
  ) {
    super(message);
  }
}
function requestError(error: unknown): BalanceQueryError {
  if (error instanceof BalanceQueryError) return error;
  // Never return upstream messages: they can include headers, URLs or credentials.
  let cause = error;
  for (let depth = 0; cause && typeof cause === 'object' && depth < 4; depth++) {
    const value = cause as { code?: string; name?: string; cause?: unknown };
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(value.code ?? ''))
      return new BalanceQueryError('渠道域名解析失败，请检查 DNS 或代理配置', 'failed', true);
    if (
      ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(
        value.code ?? '',
      )
    )
      return new BalanceQueryError('渠道连接或响应超时，请稍后重试', 'timeout', true);
    if (
      ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET'].includes(
        value.code ?? '',
      )
    )
      return new BalanceQueryError('渠道网络连接中断或不可达，请检查网络或代理配置', 'failed', true);
    if (/^(?:ERR_TLS_|CERT_|DEPTH_ZERO_|UNABLE_TO_)/.test(value.code ?? ''))
      return new BalanceQueryError('渠道 TLS 证书校验失败，请检查系统时间或代理证书');
    if (value.name === 'TimeoutError') return new BalanceQueryError('渠道查询超时', 'timeout', true);
    cause = value.cause;
  }
  return new BalanceQueryError('渠道请求失败，请重试；若持续失败请检查网络或代理配置');
}
export function normalizeChannel(value: string): BalanceChannel | 'all' {
  const aliases: Record<string, string> = {
    全部: 'all',
    智谱: 'glm',
    小米: 'mimo',
    opencode: 'opencode-go',
    go: 'opencode-go',
  };
  const normalized = value.trim().toLowerCase();
  const id = aliases[normalized] ?? normalized;
  if (id === 'all' || channels.includes(id as BalanceChannel)) return id as BalanceChannel | 'all';
  throw Error('未知渠道，可选 opencode-go、deepseek、glm、mimo');
}
export function createBalanceQuery(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, BalanceResult>(),
    pending = new Map<string, Promise<BalanceResult>>();
  return async (
    settings: OperationsSettings,
    selected: string,
    signal: AbortSignal,
  ): Promise<BalanceResult[]> => {
    const channel = normalizeChannel(selected);
    return Promise.all(
      (channel === 'all' ? [...channels] : [channel]).map(async (id) => {
        const token = settings[credentials[id]].trim(),
          key = createHash('sha256')
            .update(JSON.stringify([id, token, settings.glmRegion, settings.timeoutMs]))
            .digest('hex');
        const old = cache.get(key);
        if (old && Date.now() - old.at < 60000) return old;
        if (!token)
          return { channel: id, status: 'unconfigured' as const, at: Date.now(), lines: ['未配置凭据'] };
        const existing = pending.get(key);
        if (existing) return existing;
        const task = (async () => {
          const timeout = AbortSignal.timeout(settings.timeoutMs),
            combined = AbortSignal.any([signal, timeout]);
          const get = async (
            url: string,
            headers: Record<string, string> = { authorization: `Bearer ${token}` },
          ): Promise<any> => {
            for (let attempt = 0; ; attempt++) {
              combined.throwIfAborted();
              try {
                const res = await fetcher(url, {
                  headers: { accept: 'application/json', ...headers },
                  signal: combined,
                  redirect: 'error',
                });
                if (!res.ok) {
                  if (res.status === 401 || res.status === 403)
                    throw new BalanceQueryError('凭据无效、过期或区域不匹配', 'unauthorized');
                  throw new BalanceQueryError(
                    res.status === 429
                      ? '渠道请求过于频繁（HTTP 429），请稍后重试'
                      : `渠道接口返回 HTTP ${res.status}`,
                    'failed',
                    [502, 503, 504].includes(res.status),
                  );
                }
                try {
                  return await res.json();
                } catch (error) {
                  if (!(error instanceof SyntaxError)) throw error;
                  throw new BalanceQueryError('渠道返回非 JSON 数据，请检查接口或代理响应', 'failed', true);
                }
              } catch (error) {
                const failure = requestError(error);
                // These are read-only GETs. One bounded retry absorbs transient
                // disconnects; all attempts share the original channel deadline.
                if (attempt || !failure.retryable || combined.aborted) throw failure;
                await delay(250, undefined, { signal: combined });
              }
            }
          };
          const numeric = (v: unknown) =>
            (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) &&
            Number.isFinite(Number(v));
          let result: BalanceResult;
          try {
            let lines: string[] = [];
            if (id === 'deepseek') {
              const data = await get('https://api.deepseek.com/user/balance');
              if (!Array.isArray(data.balance_infos) || !data.balance_infos.length)
                throw new BalanceQueryError('DeepSeek 返回格式无法识别（缺少 balance_infos）');
              lines = data.balance_infos.map((v: any) => {
                if (!numeric(v.total_balance)) throw new BalanceQueryError('DeepSeek 余额字段无效');
                return `可用余额 ${v.total_balance} ${String(v.currency ?? 'CNY')}`;
              });
            } else if (id === 'mimo') {
              if (!token.includes('api-platform_serviceToken') || !token.includes('userId'))
                throw new BalanceQueryError('MiMo 需要包含 serviceToken 和 userId 的控制台 Cookie');
              const data = await get('https://platform.xiaomimimo.com/api/v1/balance', {
                cookie: token.replace(/^cookie\s*:\s*/i, ''),
                origin: 'https://platform.xiaomimimo.com',
                referer: 'https://platform.xiaomimimo.com/#/console/balance',
              });
              if (data.code !== undefined && Number(data.code) !== 0)
                throw new BalanceQueryError(
                  Number(data.code) === 401 ? '凭据无效、过期或区域不匹配' : 'MiMo 返回渠道业务错误',
                  Number(data.code) === 401 ? 'unauthorized' : 'failed',
                );
              const v = data.data ?? data;
              if (!numeric(v.balance)) throw new BalanceQueryError('MiMo 返回格式无法识别（缺少 balance）');
              lines = [`可用余额 ${v.balance} ${String(v.currency ?? 'CNY')}`];
            } else if (id === 'opencode-go') {
              const data = await get('https://opencode.ai/zen/go/v1/usage'),
                root = data.usage ?? data.data?.usage ?? data.data ?? data;
              for (const [label, names] of [
                ['5 小时滚动', ['rolling']],
                ['每周', ['weekly', 'week']],
                ['每月', ['monthly', 'month']],
              ] as const) {
                const w = names.map((n) => root[n]).find(Boolean);
                if (!w) continue;
                const raw = w.percent ?? w.usagePercent ?? w.percentage ?? w.percentUsed;
                const used = numeric(raw)
                  ? Number(raw)
                  : numeric(w.used ?? w.usage) && Number(w.limit ?? w.total) > 0
                    ? (Number(w.used ?? w.usage) / Number(w.limit ?? w.total)) * 100
                    : NaN;
                if (Number.isFinite(used))
                  lines.push(
                    `${label}：已用 ${used.toFixed(1)}%，剩余 ${Math.max(0, 100 - used).toFixed(1)}%${w.resetsAt ? `，重置时间 ${String(w.resetsAt)}` : ''}`,
                  );
              }
              if (!lines.length)
                throw new BalanceQueryError('OpenCode Go 返回格式无法识别（缺少有效配额窗口）');
            } else {
              const host = settings.glmRegion === 'global' ? 'https://api.z.ai' : 'https://open.bigmodel.cn';
              const glm = async (path: string) => {
                let data: any;
                for (const authorization of [`Bearer ${token}`, token]) {
                  try {
                    data = await get(host + path, { authorization });
                    if ([401, 1000].includes(Number(data.code)))
                      throw new BalanceQueryError('凭据无效、过期或区域不匹配', 'unauthorized');
                    return data;
                  } catch (e) {
                    if (!(e instanceof BalanceQueryError) || e.status !== 'unauthorized') throw e;
                  }
                }
                throw new BalanceQueryError('凭据无效、过期或区域不匹配', 'unauthorized');
              };
              let account: any;
              try {
                account = await glm('/api/biz/account/query-customer-account-report');
              } catch (e) {
                if (combined.aborted) throw e;
              }
              const v = account?.data ?? account,
                amount = v?.availableBalance ?? v?.balance;
              if (numeric(amount)) lines = [`可用余额 ${amount} CNY`];
              else {
                const quota = await glm('/api/monitor/usage/quota/limit'),
                  limits = quota.data?.limits ?? quota.limits;
                if (!Array.isArray(limits)) throw new BalanceQueryError('GLM 余额及配额格式无法识别');
                lines = limits.flatMap((w: any) => {
                  const p =
                    w.percentage ??
                    (numeric(w.currentValue) && Number(w.usage) > 0
                      ? (Number(w.currentValue) / Number(w.usage)) * 100
                      : undefined);
                  return numeric(p)
                    ? [
                        `${w.unit === 3 ? '5 小时滚动' : w.unit === 6 ? '每周' : String(w.type ?? '套餐额度')}：已用 ${Number(p).toFixed(1)}%${w.nextResetTime ? `，重置时间 ${String(w.nextResetTime)}` : ''}`,
                      ]
                    : [];
                });
                if (!lines.length) throw new BalanceQueryError('GLM 没有可识别的配额');
              }
            }
            result = { channel: id, status: 'ok', at: Date.now(), lines };
          } catch (e) {
            const failure = requestError(e);
            result = {
              channel: id,
              status: timeout.aborted ? 'timeout' : failure.status,
              at: Date.now(),
              lines: [timeout.aborted ? '渠道查询超时' : signal.aborted ? '渠道查询已取消' : failure.message],
            };
          }
          if (cache.size > 32) cache.clear();
          // Do not replay a transient failure for a minute after connectivity recovers.
          if (!combined.aborted && ['ok', 'unauthorized'].includes(result.status)) cache.set(key, result);
          return result;
        })().finally(() => pending.delete(key));
        pending.set(key, task);
        return task;
      }),
    );
  };
}
