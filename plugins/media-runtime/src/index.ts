import fs from 'node:fs';
import { videoParts } from './video.js';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  adapterService,
  storageService,
  httpService,
  mediaService,
  configService,
  videoFramesService,
  networkProxyService,
  type MessageSegment,
} from '@qq-harness/domain';
import {
  assertMessageScope,
  messageSegments,
  chatKeySchema,
  type StoredMessage,
  type MessageMediaRef,
} from '@qq-harness/contracts';
import { publicFetch, browseGuard } from '@qq-harness/files';

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export function mediaSegments(message: StoredMessage): MessageSegment[] {
  const metadata = message.metadata ?? {},
    outbound = obj(metadata.outbound);
  const raw = Array.isArray(metadata.segments)
    ? metadata.segments
    : Array.isArray(outbound.segments)
      ? outbound.segments
      : Array.isArray(metadata.media)
        ? metadata.media
        : messageSegments(metadata.raw_message ?? message.text);
  return raw.flatMap((item) => {
    const entry = obj(item),
      data = obj(entry.data);
    const type = String(entry.type ?? entry.kind ?? '');
    return ['image', 'video', 'record', 'audio', 'file'].includes(type)
      ? [{ type, data: Object.keys(data).length ? data : entry }]
      : [];
  });
}
function imageMime(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(b.subarray(0, 6).toString())) return 'image/gif';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  throw new Error('图片格式不支持或内容不是图片');
}
export function mediaRuntime(dataDir: string, options: { fetch?: typeof publicFetch } = {}) {
  return definePlugin({
    id: 'media-runtime',
    name: '消息媒体与同源图片预览',
    requires: [storageService.id, adapterService.id, httpService.id, configService.id],
    setup(ctx) {
      const storage = ctx.use(storageService),
        adapter = ctx.use(adapterService),
        root = path.join(dataDir, 'media-cache');
      fs.mkdirSync(root, { recursive: true });
      const message = (chatKey: string, localId: number) => {
        chatKeySchema.parse(chatKey);
        const found = storage.messages(chatKey).find((m) => m.localId === localId);
        if (!found) throw new Error('消息不存在或不属于当前会话');
        return found;
      };
      const segments = (chatKey: string, localId: number) => {
        const extra = storage.state('forward-media', `${chatKey}/${localId}`);
        return [
          ...mediaSegments(message(chatKey, localId)),
          ...(Array.isArray(extra) ? (extra as MessageSegment[]) : []),
        ];
      };
      const fetchImage = async (
        reference: string,
        signal?: AbortSignal,
        limits: { browseLocked?: boolean; maxBytes?: number } = {},
      ): Promise<{ bytes: Uint8Array; mime: string }> => {
        const combined = AbortSignal.any([ctx.signal, signal ?? ctx.signal, AbortSignal.timeout(30000)]);
        combined.throwIfAborted();
        const digest = createHash('sha256').update(reference).digest('hex'),
          file = path.join(root, digest);
        const maxBytes = Math.min(32 * 1024 * 1024, limits.maxBytes ?? 32 * 1024 * 1024);
        if (limits.browseLocked && /^https?:\/\//i.test(reference))
          browseGuard(ctx.use(configService).get().legacyGlobal.security)(new URL(reference));
        if (!limits.browseLocked && fs.existsSync(file)) {
          const bytes = fs.readFileSync(file);
          if (bytes.byteLength > maxBytes) throw new Error('图片超过当前设置的大小上限');
          return { bytes, mime: imageMime(bytes) };
        }
        let bytes: Uint8Array;
        if (
          reference.startsWith('base64://') ||
          /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(reference)
        ) {
          const value = reference.startsWith('base64://')
            ? reference.slice(9)
            : reference.slice(reference.indexOf(',') + 1);
          if (value.length > 45 * 1024 * 1024) throw new Error('图片超过32MB');
          bytes = Buffer.from(value, 'base64');
        } else {
          let url = reference;
          if (!/^https?:\/\//i.test(url)) {
            if (reference.length > 500 || /[\\/]/.test(reference)) throw new Error('不允许读取宿主文件路径');
            const info = obj(await adapter.query('get_image', { file: reference }, combined));
            url = String(info.url ?? '');
          }
          if (!/^https?:\/\//i.test(url)) throw new Error('QQ 图片地址不可用或已过期');
          let transport; try { transport = ctx.use(networkProxyService); } catch { /* Optional proxy provider. */ }
          const proxy = transport?.get();
          const result = await (options.fetch ?? publicFetch)(url, {
            signal: combined,
            maxBytes,
            proxy: proxy?.webFetch === false ? undefined : proxy,
            allowPrivate:
              obj(ctx.use(configService).get().legacyGlobal.security).allowPrivateImageHosts === true,
            ...(limits.browseLocked
              ? { allowUrl: browseGuard(ctx.use(configService).get().legacyGlobal.security) }
              : {}),
          });
          if (!result.ok) throw new Error(`图片下载失败 HTTP ${result.status}`);
          bytes = new Uint8Array(await result.arrayBuffer());
        }
        const mime = imageMime(bytes);
        combined.throwIfAborted();
        if (bytes.byteLength > maxBytes) throw new Error('图片超过当前设置的大小上限');
        const temporary = file + '.' + randomUUID() + '.tmp';
        try {
          fs.writeFileSync(temporary, bytes);
          fs.renameSync(temporary, file);
        } finally {
          fs.rmSync(temporary, { force: true });
        }
        return { bytes, mime };
      };
      const references = (chatKey: string, localId: number): MessageMediaRef[] =>
        segments(chatKey, localId).map((s, index) => ({
          id: `${localId}-${index}`,
          index,
          kind:
            s.type === 'image'
              ? 'image'
              : s.type === 'video'
                ? 'video'
                : ['audio', 'record'].includes(s.type)
                  ? 'audio'
                  : 'file',
          name: typeof s.data.name === 'string' ? s.data.name : undefined,
        }));
      const refresh = async (chatKey: string, localId: number, signal?: AbortSignal) => {
        const stored = message(chatKey, localId),
          response = obj(
            await adapter.query(
              'get_msg',
              { message_id: /^-?\d+$/.test(stored.id) ? Number(stored.id) : stored.id },
              signal,
            ),
          );
        assertMessageScope(chatKey, response, {
          self: stored.self,
          selfId: stored.metadata?.selfId ?? adapter.identity?.().id,
        });
        const parts = messageSegments(response.message ?? response.raw_message);
        if (parts.length) {
          const prior = mediaSegments(stored);
          let position = 0;
          for (const part of parts)
            if (['image', 'video', 'record', 'audio', 'file'].includes(part.type)) {
              const old = prior[position++];
              if (!part.data.url && !part.data.file && old?.type === part.type)
                part.data = {
                  ...old.data,
                  ...Object.fromEntries(
                    Object.entries(part.data).filter(([, value]) => value !== '' && value != null),
                  ),
                };
            }
          storage.updateMessage?.(chatKey, localId, { metadata: { ...stored.metadata, segments: parts } });
        }
        return references(chatKey, localId);
      };
      const image = async (chatKey: string, localId: number, index: number, signal?: AbortSignal) => {
        const segment = segments(chatKey, localId)[index];
        if (!segment || segment.type !== 'image') throw new Error('消息中没有该图片');
        const reference = String(segment.data.url || segment.data.file || '');
        try {
          if (!reference) throw new Error('QQ 消息记录未返回图片下载地址');
          return await fetchImage(reference, signal);
        } catch (error) {
          if (segment.data.file && !String(segment.data.file).includes('/')) {
            const info = obj(await adapter.query('get_image', { file: segment.data.file }, signal));
            if (info.url && info.url !== reference) return fetchImage(String(info.url), signal);
          }
          await refresh(chatKey, localId, signal).catch(() => {});
          const updated = segments(chatKey, localId)[index],
            next = String(updated?.data.url || updated?.data.file || '');
          if (next && next !== reference) return fetchImage(next, signal);
          throw error;
        }
      };
      ctx.provide(mediaService, {
        references,
        refresh,
        image,
        fetchImage,
        video: async (chatKey, localId, frames, signal) => {
          const api = obj(ctx.use(configService).effective(chatKey).legacySession.api),
            global = ctx.use(configService).get().legacyGlobal;
          const segment = segments(chatKey, localId).find((s) => s.type === 'video');
          if (!segment) throw new Error('该消息没有视频');
          let url = String(segment.data.url || '');
          const combined = AbortSignal.any([ctx.signal, signal ?? ctx.signal]);
          if (!/^https?:\/\//i.test(url) && segment.data.file) {
            const info = obj(await adapter.query('get_video', { file: segment.data.file }, combined));
            url = String(info.url || '');
          }
          if (!/^https?:\/\//i.test(url)) throw new Error('视频地址不可用或已过期');
          const video = obj(global.videoFrames);
          return videoParts(path.join(root, 'videos'), url, {
            mode: typeof api.videoMode === 'string' ? api.videoMode : 'auto',
            videoModel: typeof api.videoModel === 'string' ? api.videoModel : '',
            frames: frames ?? Math.min(12, Math.max(1, Number(video.frames) || 4)),
            ffmpeg: typeof video.ffmpegPath === 'string' ? video.ffmpegPath : undefined,
            ffprobe: typeof video.ffprobePath === 'string' ? video.ffprobePath : undefined,
            signal: combined,
            fetch: options.fetch,
            frameProvider: {
              available: async () => {
                try {
                  return await ctx.use(videoFramesService).available(chatKey, combined);
                } catch {
                  combined.throwIfAborted();
                  return false;
                }
              },
              extract: (input) => ctx.use(videoFramesService).extract(chatKey, input, combined),
            },
          });
        },
      });
      const api = new Hono();
      api.onError((error, c) =>
        c.json({ error: { message: error instanceof z.ZodError ? '媒体参数无效' : error.message } }, 400),
      );
      api.get('/api/message-media/:chatKey/:localId', async (c) => {
        const key = chatKeySchema.parse(c.req.param('chatKey')),
          id = z.coerce.number().int().positive().parse(c.req.param('localId'));
        let list = references(key, id);
        if (
          c.req.query('refresh') === '1' ||
          (!list.length && /\[图片|\[image\]|\[CQ:image/i.test(message(key, id).text))
        )
          list = await refresh(key, id, c.req.raw.signal);
        return c.json(list);
      });
      api.get('/api/message-media/:chatKey/:localId/:index', async (c) => {
        const value = await image(
          chatKeySchema.parse(c.req.param('chatKey')),
          z.coerce.number().int().positive().parse(c.req.param('localId')),
          z.coerce.number().int().nonnegative().parse(c.req.param('index')),
          c.req.raw.signal,
        );
        c.header('content-type', value.mime);
        c.header('cache-control', 'private, max-age=3600');
        c.header('x-content-type-options', 'nosniff');
        return c.body(new Uint8Array(value.bytes));
      });
      ctx.effect(ctx.use(httpService).register('/api/message-media', (request) => api.fetch(request)));
    },
  });
}
