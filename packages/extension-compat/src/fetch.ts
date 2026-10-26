import http from 'node:http';
import https from 'node:https';

// v1 扩展需要标准 Response；仍复用旧版 URL 校验并固定已校验 IP，避免 DNS 重绑定。
export async function extensionFetch(
  raw: string,
  options: RequestInit,
  validate: (raw: string) => Promise<{ url: URL; ip: string }>,
): Promise<Response> {
  let method = String(options.method ?? 'GET').toUpperCase();
  let body =
    options.body == null
      ? undefined
      : typeof options.body === 'string'
        ? Buffer.from(options.body)
        : options.body instanceof URLSearchParams
          ? Buffer.from(options.body.toString())
          : options.body instanceof Uint8Array
            ? Buffer.from(options.body)
            : undefined;
  if (options.body != null && !body)
    throw new Error('扩展 fetch 请求体须为文本、URLSearchParams 或二进制数组');
  if (body && body.length > 2 * 1024 * 1024) throw new Error('扩展请求体超过 2MB');
  const headers = new Headers(options.headers);
  let urlString = raw;
  const signal = AbortSignal.any([
    options.signal ?? new AbortController().signal,
    AbortSignal.timeout(20000),
  ]);
  for (let hop = 0; hop <= 5; hop++) {
    signal.throwIfAborted();
    const { url, ip } = await validate(urlString);
    const result = await new Promise<{ status: number; headers: Headers; body: Buffer }>(
      (resolve, reject) => {
        const client = url.protocol === 'https:' ? https : http;
        const req = client.request(
          {
            hostname: ip,
            port: url.port || undefined,
            path: url.pathname + url.search,
            method,
            servername: url.hostname,
            headers: { ...Object.fromEntries(headers), host: url.host },
            signal,
          },
          (res) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            res.on('data', (data: Buffer) => {
              bytes += data.length;
              if (bytes > 2 * 1024 * 1024) res.destroy(new Error('扩展响应超过 2MB'));
              else chunks.push(data);
            });
            res.on('error', reject);
            res.on('end', () => {
              const responseHeaders = new Headers();
              for (const [name, value] of Object.entries(res.headers))
                if (value !== undefined)
                  responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
              resolve({
                status: res.statusCode ?? 502,
                headers: responseHeaders,
                body: Buffer.concat(chunks),
              });
            });
          },
        );
        req.on('error', reject);
        req.end(body);
      },
    );
    if (![301, 302, 303, 307, 308].includes(result.status) || options.redirect === 'manual')
      return new Response(
        [204, 205, 304].includes(result.status) || method === 'HEAD' ? null : new Uint8Array(result.body),
        { status: result.status, headers: result.headers },
      );
    if (options.redirect === 'error') throw new Error('扩展请求遇到重定向');
    const location = result.headers.get('location');
    if (!location) throw new Error('重定向缺少 Location');
    const next = new URL(location, url);
    if (next.origin !== url.origin) {
      headers.delete('authorization');
      headers.delete('cookie');
    }
    if (result.status === 303 || ([301, 302].includes(result.status) && method === 'POST')) {
      method = 'GET';
      body = undefined;
      headers.delete('content-type');
    }
    urlString = next.href;
  }
  throw new Error('扩展请求重定向次数过多');
}
