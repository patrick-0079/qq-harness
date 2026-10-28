import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  imageContent,
  replySegments,
  adapterService,
  configService,
  mediaService,
  outboundService,
  storageService,
  toolService,
  stickerService,
  type ToolContext,
} from '@qq-harness/domain';
import { createCoreUtilities } from '../../../packages/legacy-core/generated/runtime.mjs';
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const reference = z.string().trim().min(1).max(200);
export function stickerTools(dataDir: string) {
  return definePlugin({
    id: 'sticker-tools',
    name: 'QQ 收藏表情与本地认知库',
    requires: [
      adapterService.id,
      configService.id,
      mediaService.id,
      outboundService.id,
      storageService.id,
      toolService.id,
      'harness.agent',
    ],
    setup(ctx) {
      const adapter = ctx.use(adapterService),
        config = ctx.use(configService),
        media = ctx.use(mediaService),
        outbound = ctx.use(outboundService),
        storage = ctx.use(storageService),
        tools = ctx.use(toolService);
      const scope = new AsyncLocalStorage<{
        chatKey: string;
        signal: AbortSignal;
      }>();
      const settings = (chatKey?: string) => ({
        enabled: true,
        collectEnabled: true,
        promptMaxStickers: 10,
        maxCollectPerHour: 10,
        encourage: 1,
        ...obj(config.get().legacyGlobal.sticker),
        ...obj(
          chatKey
            ? config.effective(chatKey).legacySession.sticker
            : config.get().defaults.legacySession.sticker,
        ),
      });
      const utilities = createCoreUtilities({
        dataDir,
        config: () => ({
          ...config.get().legacyGlobal,
          sticker: settings(scope.getStore()?.chatKey),
        }),
        fetch: () => {
          throw new Error('表情模块仅允许受控图片下载');
        },
        safeFetch: () => {
          throw new Error('不支持网页读取');
        },
        safeFetchBinary: async (url, maxBytes = 15 * 1024 * 1024) => {
          const image = await media.fetchImage(url, scope.getStore()?.signal ?? ctx.signal);
          if (image.bytes.byteLength > maxBytes) throw new Error('收藏图片过大');
          return { buffer: Buffer.from(image.bytes), contentType: image.mime };
        },
      });
      const manager = new utilities.StickerManager({
        call: async (action: string, args: Record<string, unknown>) => {
          const result = await adapter.query(action, args, scope.getStore()?.signal ?? ctx.signal);
          // OneBot 可返回宿主缓存路径；旧管理器只接收网络引用，文件读取留在受控收藏目录。
          if (action === 'get_image') return { ...obj(result), file: undefined };
          return result;
        },
      });
      ctx.definePoint({
        id: 'stickers.synced',
        kind: 'transform',
        schema: z.object({
          chatKey: z.string(),
          entries: z.array(z.record(z.string(), z.unknown())),
        }),
      });
      const sync = manager.sync.bind(manager);
      manager.sync = async (...args: unknown[]) => {
        const result = await sync(...args),
          original = manager.entries;
        const filtered = await ctx.points.transform(
          'stickers.synced',
          { chatKey: scope.getStore()?.chatKey ?? '', entries: original },
          scope.getStore()?.signal ?? ctx.signal,
        );
        // A policy may remove entries, never introduce a host path or replace a
        // validated media reference. Persist the authoritative original objects.
        const keep = new Set(filtered.entries.map((entry: Record<string, unknown>) => entry.id));
        const entries = original.filter((entry: Record<string, unknown>) => keep.has(entry.id));
        if (entries.length !== original.length) {
          manager.entries = entries;
          utilities.stickers.saveStickerStore(entries);
        }
        return result && typeof result === 'object'
          ? { ...result, entries: manager.entries }
          : result;
      };
      const available = (chatKey: string) => settings(chatKey).enabled !== false;
      const get = async (id: string) => {
        const found = await manager.find(id);
        if (!found) throw new Error('找不到表情，请先 list_stickers 查询有效 ID');
        return found as Record<string, any>;
      };
      const bytes = async (sticker: Record<string, any>, signal: AbortSignal) => {
        if (String(sticker.url).startsWith('file:///')) {
          const file = utilities.localStickerPath(sticker.url);
          if (!file) throw new Error('收藏的本地图片已丢失');
          const root = fs.realpathSync(path.join(dataDir, 'sticker-images')),
            real = fs.realpathSync(file),
            relative = path.relative(root, real);
          if (relative.startsWith('..') || path.isAbsolute(relative))
            throw new Error('收藏图片超出受控目录');
          const stat = fs.statSync(real);
          if (stat.size > 15 * 1024 * 1024) throw new Error('收藏图片过大');
          return media.fetchImage(`base64://${fs.readFileSync(real).toString('base64')}`, signal);
        }
        try {
          return await media.fetchImage(String(sticker.url || sticker.qqFile || ''), signal);
        } catch (error) {
          signal.throwIfAborted();
          if (sticker.qqFile) return media.fetchImage(String(sticker.qqFile), signal);
          throw error;
        }
      };
      const register = (
        name: string,
        title: string,
        schema: z.ZodType,
        execute: (c: ToolContext, a: any) => Promise<unknown>,
        category = 'sticker',
      ) => {
        tools.register(ctx, {
          builtinQQ: true,
          name,
          displayName: title,
          category,
          description: title + '。操作当前会话可用的 QQ 收藏表情及本地备注；错误会保留原数据。',
          parameters: z.toJSONSchema(schema) as Record<string, unknown>,
          available: (key) =>
            available(key) &&
            (name !== 'get_sticker_image' ||
              obj(config.effective(key).legacySession.api).vision !== false),
          parse: (a) => schema.parse(a),
          execute: (c, a) =>
            scope.run({ chatKey: c.chatKey, signal: c.run.signal }, () => execute(c, a)),
        });
      };
      register(
        'list_stickers',
        '查看或搜索表情库',
        z
          .object({
            query: z.string().max(200).default(''),
            limit: z.number().int().min(1).max(100).default(24),
          })
          .strict(),
        async (_c, a) => manager.list(a.query, a.limit),
      );
      register(
        'sticker_note',
        '修改表情备注、标签与使用场景',
        z
          .object({
            stickerId: reference,
            note: z.string().max(2000).optional(),
            tags: z.array(z.string().max(50)).max(20).optional(),
            usage: z.string().max(2000).optional(),
          })
          .strict(),
        async (_c, a) => {
          await get(a.stickerId);
          const entry = manager.note(a.stickerId, {
            note: a.note,
            tags: a.tags,
            usage: a.usage,
          });
          if (!entry) throw new Error('表情已被移除');
          return {
            updated: true,
            id: entry.id,
            localNote: entry.localNote,
            tags: entry.tags,
            usage: entry.usage,
          };
        },
      );
      register(
        'get_sticker_image',
        '查看表情原图',
        z.object({ stickerId: reference }).strict(),
        async (c, a) => {
          if (obj(c.settings.legacySession.api).vision === false)
            throw new Error('当前会话已关闭图片识别');
          const sticker = await get(a.stickerId),
            image = await bytes(sticker, c.run.signal);
          return {
            content: [
              {
                type: 'text',
                text: `表情 ${sticker.id}：${sticker.localNote || sticker.desc || '暂无备注'}`,
              },
              imageContent(image.bytes, image.mime),
            ],
          };
        },
      );
      register(
        'send_sticker',
        '发送收藏表情',
        z
          .object({
            stickerId: reference,
            replyToMessageId: reference.optional(),
            atUserId: z.string().regex(/^\d+$/).optional(),
          })
          .strict(),
        async (c, a) => {
          const target = replySegments(storage, c.chatKey, a),
            sticker = await get(a.stickerId);
          await manager.ensureSendable(sticker);
          const image = await bytes(sticker, c.run.signal);
          const result = await outbound.sendPayload(
            c.run,
            c.chatKey,
            `[表情包:${sticker.localNote || sticker.desc || sticker.id}]`,
            {
              segments: [
                ...target,
                {
                  type: 'image',
                  data: {
                    file: `base64://${Buffer.from(image.bytes).toString('base64')}`,
                    sub_type: 1,
                  },
                },
              ],
            },
          );
          if (!result.duplicate) {
            c.sent++;
            manager.markUsed(sticker.id, c.chatKey);
          }
          return {
            sent: true,
            messageId: result.id,
            duplicate: result.duplicate,
          };
        },
        'messaging',
      );
      register(
        'collect_sticker',
        '将消息图片收藏至表情库',
        z
          .object({
            messageId: reference,
            note: z.string().max(2000).default(''),
          })
          .strict(),
        async (c, a) => {
          if (!settings(c.chatKey).collectEnabled) throw new Error('当前会话未开启表情收藏');
          const message = storage
            .messages(c.chatKey)
            .find((m) => m.id === a.messageId || String(m.localId) === a.messageId);
          if (!message) throw new Error('当前会话没有该消息');
          const ref = media.references(c.chatKey, message.localId).find((r) => r.kind === 'image');
          if (!ref) throw new Error('该消息没有可收藏图片');
          // 先解析所属消息媒体，再以已校验字节收藏；避免工具输入 URL 或文件路径。
          const image = await media.image(c.chatKey, message.localId, ref.index, c.run.signal);
          const entry = await manager.collect(
            `${c.chatKey.replace(':', '_')}_${message.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
            {
              url: `base64://${Buffer.from(image.bytes).toString('base64')}`,
              note: a.note,
            },
          );
          return {
            collected: true,
            id: entry.id,
            note: entry.localNote,
            qqSaved: !!entry.emojiId,
            localSaved: !!entry.localFile,
            ...(entry.qqCollectError ? { warning: entry.qqCollectError } : {}),
          };
        },
      );
      ctx.on<{ chatKey: string; persona: string; extra: string }>(
        'prompt.segments',
        async (v, meta) => {
          const cfg = settings(v.chatKey);
          if (!available(v.chatKey)) return v;
          const count = Math.min(30, Math.max(0, Number(cfg.promptMaxStickers) || 0));
          if (count)
            await scope.run(
              {
                chatKey: v.chatKey,
                signal: AbortSignal.any([ctx.signal, meta.signal, AbortSignal.timeout(500)]),
              },
              () => manager.sync(false),
            );
          return {
            ...v,
            extra: [
              v.extra,
              utilities.stickers.buildStickerStrategyHint(cfg.encourage),
              count ? utilities.stickers.buildStickerContext(manager.entries, count) : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          };
        },
      );
      ctx.provide(stickerService, {
        list: (query = '', limit = 24) => manager.list(query, limit),
        find: async (id: string) => manager.find(id),
        note: (id: string, patch: unknown) => manager.note(id, patch),
        refresh: async () => manager.sync(true),
        entries: () => manager.entries,
        localPath: (ref: string) => utilities.localStickerPath(ref),
      });
    },
  });
}
