import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

export function privateAddress(raw: string): boolean {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, '');
  const embedded = address.match(/(?:^::ffff:|^::)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embedded) return privateAddress(embedded);
  if (net.isIP(address) === 4) {
    const a = address.split('.').map(Number);
    return (
      a[0] === 0 ||
      a[0] === 10 ||
      a[0] === 127 ||
      a[0]! >= 224 ||
      (a[0] === 169 && a[1] === 254) ||
      (a[0] === 172 && a[1]! >= 16 && a[1]! <= 31) ||
      (a[0] === 192 && [0, 168].includes(a[1]!)) ||
      (a[0] === 100 && a[1]! >= 64 && a[1]! <= 127) ||
      (a[0] === 198 && [18, 19].includes(a[1]!))
    );
  }
  if (net.isIP(address) === 6) {
    if (address.startsWith('::ffff:')) {
      const parts = address.slice(7).split(':');
      if (parts.length === 2) {
        const value = parseInt(parts[0]!, 16) * 65536 + parseInt(parts[1]!, 16);
        return privateAddress(
          `${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`,
        );
      }
    }
    return address === '::' || address === '::1' || /^(?:f[cd]|fe[89ab]|ff|2001:db8|64:ff9b)/.test(address);
  }
  return true;
}
/** Validate every DNS answer and pin the accepted address for every redirect hop. */
export async function publicAddress(raw: string, allowPrivate=false) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('仅允许无凭据的 HTTP(S) 地址');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate&&/(^|\.)(?:localhost|local|internal)$/i.test(host)) throw new Error('不允许访问本机或内网地址');
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || !allowPrivate&&addresses.some((row) => privateAddress(row.address)))
    throw new Error('不允许访问本机或内网地址');
  return { url, address: addresses[0]!.address };
}
export interface PublicFetchOptions {
  /** Server-owned validators only; applied again for every redirect hop. */
  validate?: (url: string) => Promise<{ url: URL; address: string }>;
  proxy?: { url: string; mode: 'always' | 'fallback'; username?: string; password?: string; bypass: string[]; directTimeoutMs: number; webFetch?: boolean };
  allowUrl?: (url: URL) => void;
  signal?: AbortSignal;
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string | Uint8Array;
  /** Only explicit administrator image-host configuration may enable this. */
  allowPrivate?: boolean;
  truncate?: boolean;
}
export async function publicFetch(raw: string, options: PublicFetchOptions = {}): Promise<Response> {
  const signal = AbortSignal.any([
    options.signal ?? new AbortController().signal,
    AbortSignal.timeout(30000),
  ]);
  let target = raw;
  let headers = options.headers ?? {};
  let method = options.method ?? 'GET';
  let body = options.body;
  for (let hop = 0; hop <= 5; hop++) {
    options.allowUrl?.(new URL(target));
    signal.throwIfAborted();
    const { url, address } = options.validate ? await options.validate(target) : await publicAddress(target,options.allowPrivate===true);
    const proxy = options.proxy;
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const bypassed = !proxy || hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.') || proxy.bypass.some(p => hostname === p || hostname.endsWith('.' + p) || p.endsWith('.') && hostname.startsWith(p));
    const perform = (proxied: boolean) => {
      if(proxied){const [major,minor]=process.versions.node.split('.').map(Number);if(major!<24||major===24&&minor!<5)throw Error('代理传输需要 Node.js 24.5 或更新版本');}
      let connected = false;
      const proxyUrl = proxy ? new URL(proxy.url) : undefined;
      if (proxyUrl && !['http:','https:'].includes(proxyUrl.protocol)) throw Error('代理仅支持 HTTP(S)');
      if (proxyUrl && proxy?.username) { proxyUrl.username = proxy.username; proxyUrl.password = proxy.password ?? ''; }
      const agent = proxied && proxyUrl ? new (url.protocol === 'https:' ? https.Agent : http.Agent)({ keepAlive: false, proxyEnv: { HTTP_PROXY: proxyUrl.href, HTTPS_PROXY: proxyUrl.href, NO_PROXY: '' } }) : undefined;
      return new Promise<Response>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? https : http).request(
        {
          hostname: address,
          port: url.port || undefined,
          path: url.pathname + url.search,
          servername: url.hostname,
          method,
          headers: { 'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) qq-harness/1.0','accept-language':'zh-CN,zh;q=0.9',...headers, ...(agent ? {} : { host: url.host }) },
          signal,
          ...(agent ? { agent } : {}),
        },
        (res) => {
          const chunks: Buffer[] = [];let size=0,settled=false;
          const encoding=String(res.headers['content-encoding']??'').toLowerCase();
          const decoder=encoding==='gzip'?createGunzip():encoding==='br'?createBrotliDecompress():encoding==='deflate'?createInflate():undefined;
          const stream=decoder?res.pipe(decoder):res;
          const finish=(truncated=false)=>{
            if(settled)return;settled=true;
            const responseHeaders=new Headers(Object.entries(res.headers).filter((v):v is [string,string|string[]]=>v[1]!==undefined).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]));
            if(decoder){responseHeaders.delete('content-encoding');responseHeaders.delete('content-length');}
            if(truncated)responseHeaders.set('x-harness-truncated','true');else responseHeaders.delete('x-harness-truncated');
            const response=new Response([204,205,304].includes(res.statusCode??200)||method==='HEAD'?null:new Uint8Array(Buffer.concat(chunks)),{status:res.statusCode??502,headers:responseHeaders});
            Object.defineProperty(response,'url',{value:url.href});resolve(response);
          };
          stream.on('data',(chunk:Buffer)=>{
            const max=options.maxBytes??32*1024*1024,remaining=max-size;
            if(chunk.length>remaining){
              if(options.truncate){chunks.push(chunk.subarray(0,Math.max(0,remaining)));size=max;finish(true);stream.destroy();res.destroy();}
              else{const error=new Error('下载内容超过大小限制');stream.destroy(error);res.destroy(error);}
            }else{chunks.push(chunk);size+=chunk.length;}
          });
          res.on('error',reject);stream.on('error',reject);stream.on('end',()=>finish());
        },
      );
      // Proxy routing uses the pinned address as authority. Set virtual-host
      // metadata only after that authority has been selected by the Agent.
      if (agent) request.setHeader('host', url.host);
      const connectTimer = !proxied && proxy && !bypassed ? setTimeout(() => request.destroy(Object.assign(new Error('直连连接超时'), { code: 'ETIMEDOUT' })), proxy.directTimeoutMs) : undefined;
      request.on('socket', socket => { const ready = () => { connected = true; clearTimeout(connectTimer); }; if (!socket.connecting) ready(); else socket.once('connect', ready); });
      request.on('error', error => { clearTimeout(connectTimer); Object.assign(error, { proxyRetryable: !connected && !signal.aborted && ['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH'].includes(String((error as NodeJS.ErrnoException).code)) }); reject(error); });
      request.once('close', () => clearTimeout(connectTimer));
      request.end(body);
      }).finally(() => agent?.destroy());
    };
    let response: Response;
    if (!bypassed && proxy?.mode === 'always') response = await perform(true);
    else try { response = await perform(false); } catch (error) {
      if (bypassed || proxy?.mode !== 'fallback' || !(error as { proxyRetryable?: boolean }).proxyRetryable) throw error;
      response = await perform(true);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('重定向缺少地址');
    const next = new URL(location, url);
    if (next.origin !== url.origin)
      headers = Object.fromEntries(
        Object.entries(headers).filter(([key]) => !/^authorization$|^cookie$/i.test(key)),
      );
    if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) {
      method = 'GET';
      body = undefined;
    }
    target = next.href;
  }
  throw new Error('重定向次数过多');
}

/** Trusted administrator model/search endpoints may be private. End-user page
 * fetches continue through publicFetch's public-address checks on every hop. */
export async function configuredFetch(raw: string | URL | Request, init: RequestInit = {}, proxy?: PublicFetchOptions['proxy']) {
  if (!proxy) return fetch(raw, init);
  const url = typeof raw === 'string' ? raw : raw instanceof URL ? raw.href : raw.url;
  if (init.body != null && typeof init.body !== 'string' && !(init.body instanceof Uint8Array)) throw Error('代理请求体只支持文本或字节数组');
  return publicFetch(url, { allowPrivate: true, proxy, method: init.method, headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal ?? undefined, body: init.body as string | Uint8Array | undefined });
}
