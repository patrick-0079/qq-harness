import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  configService,
  mediaService,
  outboundService,
  storageService,
  toolService,
  imageContent,
  type ToolContext,
} from '@qq-harness/domain';
import { publicFetch, readJson, writeJsonAtomic } from '@qq-harness/files';
import { createCoreUtilities } from '../../../packages/legacy-core/generated/runtime.mjs';
const object = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
const defaults = {
  enabled: true,
  requirePreview: true,
  maxSendsPerRun: 3,
  maxBytesMB: 6,
  pixivMaxBytesMB: 20,
  allowAvatar: true,
  pixivEnabled: true,
  pixivApiUrl: 'https://api.lolicon.app/setu/v2',
  avoidRepeat: true,
  repeatWindowDays: 30,
  popularFirst: true,
};
const optionsInput = z
  .object({
    url: z.url().optional(),
    messageId: z.string().min(1).optional(),
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    flip: z.enum(['none', 'horizontal', 'vertical']).default('none'),
    grayscale: z.boolean().default(false),
    max_size: z.union([z.literal(0), z.number().int().min(64).max(4096)]).default(0),
    send: z.boolean().default(false),
    token: z.string().uuid().optional(),
    note: z.string().max(1000).optional(),
  })
  .strict();
type EditOptions = z.infer<typeof optionsInput>;
interface Preview {
  token: string;
  file: string;
  mime: string;
  url: string;
  key: string;
  width: number;
  height: number;
  bytes: number;
  edited: boolean;
  at: number;
}
interface State {
  entries: Map<string, Preview>;
  sends: number;
}
export function imageStudio(dataDir: string, network: typeof publicFetch = publicFetch) {
  return definePlugin({
    id: 'image-studio',
    name: '图片工坊',
    requires: [
      configService.id,
      mediaService.id,
      outboundService.id,
      storageService.id,
      toolService.id,
      'harness.agent',
    ],
    setup(ctx) {
      const config = ctx.use(configService),
        media = ctx.use(mediaService),
        outbound = ctx.use(outboundService),
        storage = ctx.use(storageService),
        tools = ctx.use(toolService);
      const root = path.join(dataDir, 'image-studio'),
        previews = path.join(root, 'previews');
      fs.mkdirSync(previews, { recursive: true });
      const utility = createCoreUtilities({
        config: () => ({}),
        fetch: () => {
          throw new Error('图片搜索必须使用绑定网络');
        },
        safeFetch: () => {
          throw new Error('此模块不读取网页');
        },
      });
      const settings = (chatKey: string) => ({
        ...defaults,
        ...object(object(config.get().legacyGlobal.skills)['image-studio']),
        ...object(object(config.effective(chatKey).legacySession.skills)['image-studio']),
      });
      const available = (chatKey: string) => settings(chatKey).enabled !== false;
      const states = new Map<string, State>();
      const stateOf = (c: ToolContext) => {
        const id = c.run.id + '/' + c.chatKey;
        let state = states.get(id);
        if (!state) {
          state = { entries: new Map(), sends: 0 };
          states.set(id, state);
        }
        return state;
      };
      const drop = (state: State, item: Preview) => {
        state.entries.delete(item.token);
        const rel = path.relative(path.resolve(previews), path.resolve(item.file));
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(item.file, { force: true });
      };
      const sweep = () => {
        for (const state of states.values())
          for (const item of state.entries.values()) if (Date.now() - item.at > 600000) drop(state, item);
      };
      const clearRun = (id: string) => {
        for (const [key, state] of states)
          if (key.startsWith(id + '/')) {
            for (const item of state.entries.values()) drop(state, item);
            states.delete(key);
          }
      };
      ctx.effect(
        ctx.host.subscribe((e) => {
          if (e.type === 'run.changed') {
            const run = e.payload as { id: string; status: string };
            if (['completed', 'failed', 'cancelled'].includes(run.status)) clearRun(run.id);
          }
        }),
      );
      const timer = setInterval(sweep, 60000);
      timer.unref?.();
      ctx.effect(() => {
        clearInterval(timer);
        for (const key of [...states.keys()]) clearRun(key.split('/')[0]!);
      });
      const history = () =>
        utility.imageHistory.loadHistory(path.join(root, 'history.json')) as { key: string; at: number }[];
      const markSent = (url: string) => {
        try {
          utility.imageHistory.saveHistory(path.join(root, 'history.json'), [
            ...history(),
            { key: utility.imageHistory.itemKey(url), at: Date.now() },
          ]);
        } catch (e) {
          ctx.log('图片已发出，但发送历史保存失败：' + String(e));
        }
      };
      const source = async (c: ToolContext, args: { url?: string; messageId?: string }) => {
        if (!!args.url === !!args.messageId)
          throw new Error('url 与 messageId 必须二选一，或使用已预览的 token');
        if (args.url) return { url: args.url, ...(await media.fetchImage(args.url, c.run.signal)) };
        const message = storage
          .messages(c.chatKey)
          .find((m) => m.id === args.messageId || String(m.localId) === args.messageId);
        if (!message) throw new Error('当前会话没有该消息');
        const image = media.references(c.chatKey, message.localId).find((r) => r.kind === 'image');
        if (!image) throw new Error('该消息没有图片');
        return {
          url: `message:${c.chatKey}:${message.id}:${image.index}`,
          ...(await media.image(c.chatKey, message.localId, image.index, c.run.signal)),
        };
      };
      const prepare = async (c: ToolContext, args: EditOptions, state: State) => {
        const cfg = settings(c.chatKey);
        const cached = [...state.entries.values()].find(
          (e) =>
            e.url === args.url &&
            e.key ===
              createHash('sha256')
                .update(JSON.stringify([args.url, args.rotate, args.flip, args.grayscale, args.max_size]))
                .digest('hex'),
        );
        if (cached) return cached;
        if (args.send && cfg.requirePreview)
          throw new Error('发图前必须先预览，请先不带 send 调用，再使用返回的 token');
        const from = await source(c, args),
          cap = (/pixiv\.re|pximg\.net/.test(from.url) ? cfg.pixivMaxBytesMB : cfg.maxBytesMB) * 1024 * 1024;
        if (from.bytes.byteLength > Math.min(32 * 1024 * 1024, Math.max(1024, cap)))
          throw new Error('图片超过当前设置的大小上限');
        const key = createHash('sha256')
          .update(JSON.stringify([from.url, args.rotate, args.flip, args.grayscale, args.max_size]))
          .digest('hex');
        const old = [...state.entries.values()].find((e) => e.key === key);
        if (old) return old;
        const edited = !!(args.rotate || args.flip !== 'none' || args.grayscale || args.max_size);
        let bytes = Buffer.from(from.bytes),
          mime = from.mime;
        let processor = sharp(bytes, { limitInputPixels: 60000000, failOn: 'error' }).timeout({
          seconds: 30,
        });
        const metadata = await processor.metadata();
        if (edited) {
          // sharp 的 flip/flop 在旋转前执行；分两步保持旧版“先旋转，再镜像”的像素顺序。
          if (args.rotate) {
            bytes = await processor.rotate(args.rotate).png().toBuffer();
            processor = sharp(bytes, { limitInputPixels: 60000000, failOn: 'error' }).timeout({
              seconds: 30,
            });
          }
          if (args.flip === 'horizontal') processor = processor.flop();
          if (args.flip === 'vertical') processor = processor.flip();
          if (args.grayscale) processor = processor.greyscale();
          if (args.max_size)
            processor = processor.resize({
              width: args.max_size,
              height: args.max_size,
              fit: 'inside',
              withoutEnlargement: true,
            });
          bytes = await processor.png().toBuffer();
          mime = 'image/png';
        }
        const final = edited ? await sharp(bytes, { limitInputPixels: 60000000 }).metadata() : metadata;
        c.run.assertActive();
        ctx.assertActive();
        if (state.entries.size >= 20) drop(state, state.entries.values().next().value!);
        const token = randomUUID(),
          file = path.join(previews, token + '.bin');
        fs.writeFileSync(file, bytes);
        const item: Preview = {
          token,
          file,
          mime,
          url: from.url,
          key,
          width: final.width ?? 0,
          height: final.height ?? 0,
          bytes: bytes.length,
          edited,
          at: Date.now(),
        };
        state.entries.set(token, item);
        return item;
      };
      const edit = async (c: ToolContext, args: EditOptions) => {
        sweep();
        const state = stateOf(c);
        let item = args.token ? state.entries.get(args.token) : undefined;
        if (args.token && !item) throw new Error('预览 token 不属于当前运行或已经失效，请重新预览');
        item ??= await prepare(c, args, state);
        const bytes = fs.readFileSync(item.file);
        if (!args.send) {
          const preview = await sharp(bytes, { limitInputPixels: 60000000 })
            .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          return {
            token: item.token,
            width: item.width,
            height: item.height,
            edited: item.edited,
            content: [
              {
                type: 'text',
                text: `预览 ${item.width}×${item.height}，${item.edited ? '已处理' : '原图直通（未重编码）'}。要发送请传 token=${item.token}、send=true。`,
              },
              imageContent(preview, 'image/jpeg'),
            ],
          };
        }
        const limit = Math.max(1, Math.min(50, Number(settings(c.chatKey).maxSendsPerRun) || 3));
        if (state.sends >= limit) throw new Error(`本轮已达到 ${limit} 张图片上限`);
        const note = args.note?.trim().slice(0, 40),
          result = await outbound.sendPayload(c.run, c.chatKey, note ? `[图片] ${note}` : '[图片]', {
            segments: [
              { type: 'image', data: { file: 'base64://' + bytes.toString('base64') } },
              ...(note ? [{ type: 'text', data: { text: note } }] : []),
            ],
          });
        if (!result.duplicate) {
          c.sent++;
          state.sends++;
          markSent(item.url);
        }
        drop(state, item);
        return {
          sent: true,
          messageId: result.id,
          width: item.width,
          height: item.height,
          edited: item.edited,
          duplicate: result.duplicate,
        };
      };
      tools.register(ctx, {
        name: 'image-studio__edit_image',
        displayName: '图片工坊 · 处理与预览',
        category: 'media',
        description:
          '旋转、翻转、黑白、缩放图片；默认仅预览。没有编辑参数时发送原始字节。先预览，再用同一 token 与 send=true 发送；url 和 messageId 二选一。',
        parameters: z.toJSONSchema(optionsInput),
        available,
        parse: (a) => optionsInput.parse(a),
        execute: (c, a) => edit(c, a as EditOptions),
      });
      const findInput = z
        .object({
          query: z.string().trim().min(1).max(200),
          limit: z.number().int().min(1).max(8).default(5),
          source: z.enum(['web', 'pixiv']).default('web'),
          tag: z.string().max(100).optional(),
        })
        .strict();
      tools.register(ctx, {
        name: 'image-studio__find_images',
        displayName: '图片工坊 · 搜图',
        category: 'media',
        description:
          '百度与 Bing 双源搜图，或按 Pixiv 中文／日文标签查找全年龄作品；保留热门优先、去重和标签学习。结果原样传给 edit_image 预览。',
        parameters: z.toJSONSchema(findInput),
        available,
        parse: (a) => findInput.parse(a),
        execute: async (c, raw) => {
          const args = raw as z.infer<typeof findInput>,
            cfg = settings(c.chatKey);
          const fetcher = (url: string, options: RequestInit = {}) =>
            network(url, {
              method: options.method,
              headers: Object.fromEntries(new Headers(options.headers).entries()),
              body: typeof options.body === 'string' ? options.body : undefined,
              signal: AbortSignal.any([ctx.signal, c.run.signal, options.signal ?? c.run.signal]),
              maxBytes: 4 * 1024 * 1024,
            });
          const seen = utility.imageHistory.seenSet(
            history(),
            Number(cfg.repeatWindowDays) || 30,
          ) as Set<string>;
          let results: Record<string, unknown>[];
          if (args.source === 'pixiv') {
            if (!cfg.pixivEnabled) throw new Error('Pixiv 搜图已关闭');
            const file = path.join(root, 'tag-dict.json'),
              learned = object(readJson(file, {}));
            if (
              args.tag &&
              args.query.length <= 20 &&
              args.tag.length <= 40 &&
              utility.imageSearch.hasCjk(args.query) &&
              !utility.imageSearch.hasKana(args.query) &&
              utility.imageSearch.hasKana(args.tag)
            ) {
              learned[args.query] = args.tag;
              writeJsonAtomic(file, learned);
            }
            results = await utility.imageSearch.searchPixiv(fetcher, args.tag || args.query, args.limit, {
              apiUrl: cfg.pixivApiUrl,
              dict: { ...utility.imageTags, ...learned },
              popular: cfg.popularFirst,
              isSeen: cfg.avoidRepeat
                ? (url: string) => seen.has(utility.imageHistory.itemKey(url))
                : undefined,
              windowDays: cfg.repeatWindowDays,
            });
          } else {
            results = (
              await utility.imageSearch.searchImages(fetcher, args.query, Math.min(8, args.limit * 2))
            )
              .filter(
                (item: Record<string, unknown>) =>
                  !cfg.avoidRepeat || !seen.has(utility.imageHistory.itemKey(item.url)),
              )
              .slice(0, args.limit);
          }
          return {
            results,
            content: `「${args.query}」${results.length} 条结果：\n${results.map((r, i) => `${i + 1}. ${r.title || ''} | ${r.url}`).join('\n')}\n先调用 image-studio__edit_image 预览，再用 token 发送。`,
          };
        },
      });
      const avatarInput = z
        .object({
          url: z.url().optional(),
          messageId: z.string().optional(),
          token: z.string().uuid().optional(),
        })
        .strict();
      tools.register(ctx, {
        name: 'image-studio__set_qq_avatar',
        displayName: '图片工坊 · 修改自己的头像',
        category: 'media',
        description: '将已预览图片设为机器人自己的 QQ 头像；受允许换头像开关控制，不接受他人 QQ 号。',
        parameters: z.toJSONSchema(avatarInput),
        available: (chatKey) => available(chatKey) && settings(chatKey).allowAvatar !== false,
        parse: (a) => avatarInput.parse(a),
        execute: async (c, raw) => {
          sweep();
          const args = raw as z.infer<typeof avatarInput>,
            state = stateOf(c);
          let item = args.token ? state.entries.get(args.token) : undefined;
          if (!item) {
            if (settings(c.chatKey).requirePreview)
              throw new Error('换头像前必须先预览并提供当前运行的 token');
            item = await prepare(c, optionsInput.parse(args), state);
          }
          let bytes = fs.readFileSync(item.file),
            mime = item.mime;
          if (bytes.length > 4 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
            bytes = await sharp(bytes, { limitInputPixels: 60000000 })
              .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 90 })
              .toBuffer();
            mime = 'image/jpeg';
          }
          if (bytes.length > 4 * 1024 * 1024) throw new Error('头像仍超过4MB');
          const result = await outbound.sendPayload(c.run, c.chatKey, '[换头像]', {
            profileImage: 'base64://' + bytes.toString('base64'),
          });
          drop(state, item);
          return { updated: true, message: 'QQ 已接受新头像，以客户端显示为准', operationId: result.id };
        },
      });
      ctx.on<{ chatKey: string; persona: string; extra: string }>('prompt.segments', (v) =>
        available(v.chatKey)
          ? {
              ...v,
              extra:
                v.extra +
                '\n图片工坊：用 image-studio__find_images 搜图，image-studio__edit_image 预览，再用相同 token、send=true 发送。未要求编辑时保留原图；需要改自己的头像时先预览，再调用 image-studio__set_qq_avatar。',
            }
          : v,
      );
    },
  });
}
