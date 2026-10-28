import { z } from 'zod';
import type { PluginContext } from '@qq-harness/plugin-sdk';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { browseGuard, modelImage } from '@qq-harness/files';
import {
  adapterService,
  accessService,
  replySegments,
  imageContent,
  configService,
  mediaService,
  outboundService,
  storageService,
  toolService,
} from '@qq-harness/domain';
import sharp from 'sharp';

export const imageParts = imageContent;
export function registerMedia(ctx: PluginContext) {
  const tools = ctx.use(toolService),
    media = ctx.use(mediaService),
    storage = ctx.use(storageService),
    config = ctx.use(configService);
  const states = new Map<string, { previewed: Set<string>; previews: number; sent: number }>();
  const state = (c: import('@qq-harness/domain').ToolContext) => {
    const key = c.run.id + '/' + c.chatKey;
    let value = states.get(key);
    if (!value) {
      value = { previewed: new Set(), previews: 0, sent: 0 };
      states.set(key, value);
    }
    return value;
  };
  ctx.effect(
    ctx.host.subscribe((e) => {
      if (e.type === 'run.changed') {
        const run = e.payload as { id: string; status: string };
        if (['completed', 'failed', 'cancelled'].includes(run.status))
          for (const key of states.keys()) if (key.startsWith(run.id + '/')) states.delete(key);
      }
    }),
  );
  ctx.effect(() => states.clear());
  const vision = (chatKey: string) => {
    const api = config.effective(chatKey).legacySession.api as Record<string, unknown> | undefined;
    return api?.vision !== false;
  };
  const message = (chatKey: string, id: string) => {
    const value = storage.messages(chatKey).find((m) => m.id === id || String(m.localId) === id);
    if (value && !value.self) ctx.use(accessService).assert(chatKey, value.senderId);
    if (!value) throw new Error('当前会话没有该消息，请先查询聊天记录');
    return value;
  };
  tools.register(ctx, {
    builtinQQ: true,
    name: 'get_message_images',
    displayName: '查看消息图片',
    category: 'query',
    available: vision,
    description:
      '查看当前会话已记录消息（含已展开转发）的图片。返回真正的多模态图片输入，不接受其他会话或任意路径。',
    parameters: {
      type: 'object',
      properties: { messageId: { type: 'string' } },
      required: ['messageId'],
      additionalProperties: false,
    },
    parse: (a) =>
      z
        .object({ messageId: z.string().min(1).max(160) })
        .strict()
        .parse(a),
    execute: async (c, a) => {
      const m = message(c.chatKey, (a as { messageId: string }).messageId);
      let refs = media.references(c.chatKey, m.localId).filter((r) => r.kind === 'image');
      if (!refs.length && /\[图片|\[image\]|\[CQ:image/i.test(m.text))
        refs = (await media.refresh(c.chatKey, m.localId, c.run.signal)).filter(
          (r) => r.kind === 'image',
        );
      if (!refs.length) throw new Error('该消息没有图片；转发图片请先 read_forward 展开');
      const content: unknown[] = [
        { type: 'text', text: `消息 #${m.id}，共 ${refs.length} 张图片：` },
      ];
      let loaded = 0;
      const errors: string[] = [];
      for (const ref of refs.slice(0, 12)) {
        c.run.assertActive();
        try {
          const raw = await media.image(c.chatKey, m.localId, ref.index, c.run.signal),
            image = await modelImage(raw.bytes, raw.mime);
          content.push(imageParts(image.bytes, image.mime));
          loaded++;
        } catch (e) {
          c.run.signal.throwIfAborted();
          const error = `图片 ${ref.index + 1} 加载失败：${e instanceof Error ? e.message : e}`;
          errors.push(error);
          content.push({ type: 'text', text: error });
        }
      }
      if (refs.length > 12)
        content.push({
          type: 'text',
          text: '本轮最多加载12张图片，其他图片未加载。',
        });
      return {
        content,
        ...(!loaded
          ? {
              isError: true,
              error: `消息图片全部加载失败：${errors.join('；')}`,
            }
          : {}),
      };
    },
  });
  const sendImage = z
    .object({
      url: z.url().regex(/^https?:\/\//i, '只支持 http(s) 图片直链'),
      preview: z.boolean().default(false),
      note: z.string().max(10000).optional(),
      replyToMessageId: z.string().min(1).optional(),
      atUserId: z.string().regex(/^\d+$/).optional(),
    })
    .strict();
  tools.register(ctx, {
    builtinQQ: true,
    name: 'send_image',
    displayName: '发送或预览图片',
    category: 'media',
    description:
      '发送一张网图；默认先 preview=true 给模型预览，再用同一 URL 发送。预览不计聊天发送。引用与 @ 二选一。按设置限制预览及发送张数、体积和浏览域名，逐跳检查重定向。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        preview: { type: 'boolean' },
        note: { type: 'string' },
        replyToMessageId: { type: 'string' },
        atUserId: { type: 'string' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    parse: (a) => sendImage.parse(a),
    execute: async (c, a) => {
      const v = a as z.infer<typeof sendImage>;
      const target = replySegments(storage, c.chatKey, v);
      if (v.preview && !vision(c.chatKey)) throw new Error('当前会话已关闭图片识别');
      const security = (config.get().legacyGlobal.security ?? {}) as Record<string, any>,
        opt = security.imageSend ?? {},
        lock = security.browseLock ?? {},
        st = state(c);
      browseGuard(security)(new URL(v.url));
      const trusted = lock.enabled === true && opt.skipPreviewForLockedHosts !== false;
      if (!v.preview && opt.requirePreview !== false && !trusted && !st.previewed.has(v.url))
        throw new Error('发图前请先用 preview=true 预览同一 URL');
      if (v.preview && st.previews >= Math.max(1, Number(opt.maxPreviewsPerRun) || 5))
        throw new Error('本轮图片预览次数已达上限');
      if (!v.preview && st.sent >= Math.max(1, Number(opt.maxPerRun) || 3))
        throw new Error('本轮发送图片张数已达上限');
      const image = await media.fetchImage(v.url, c.run.signal, {
        browseLocked: true,
        maxBytes: Math.max(1, Number(opt.maxBytesMB) || 5) * 1024 * 1024,
      });
      if (v.preview) {
        st.previews++;
        st.previewed.add(v.url);
        return {
          content: [
            { type: 'text', text: v.note || '图片预览（尚未发送）' },
            imageParts(image.bytes, image.mime),
          ],
        };
      }
      const note = v.note?.trim().slice(0, 40);
      const r = await ctx
        .use(outboundService)
        .sendPayload(c.run, c.chatKey, note ? `[图片] ${note}` : '[图片]', {
          segments: [
            ...target,
            {
              type: 'image',
              data: {
                file: `base64://${Buffer.from(image.bytes).toString('base64')}`,
              },
            },
            ...(note ? [{ type: 'text', data: { text: note } }] : []),
          ],
        });
      if (!r.duplicate) {
        c.sent++;
        st.sent++;
      }
      return { sent: true, messageId: r.id, duplicate: r.duplicate };
    },
  });
  tools.register(ctx, {
    builtinQQ: true,
    name: 'fetch_avatar',
    displayName: '查看头像',
    category: 'query',
    available: vision,
    description: '按数字 QQ 号查看公开头像，作为多模态图片输入返回。',
    parameters: {
      type: 'object',
      properties: { userId: { type: 'string' } },
      required: ['userId'],
      additionalProperties: false,
    },
    parse: (a) =>
      z
        .object({
          userId: z.string().regex(/^\d{5,12}$/, '请填写5至12位数字 QQ 号'),
        })
        .strict()
        .parse(a),
    execute: async (c, a) => {
      const userId = (a as { userId: string }).userId;
      let image: Awaited<ReturnType<typeof media.fetchImage>> | undefined;
      let avatarUrl = '',
        source = '';
      const failures: string[] = [];
      const download = async (url: string) => {
        const value = await media.fetchImage(url, c.run.signal);
        const size = await sharp(value.bytes, {
          limitInputPixels: 100_000_000,
        }).metadata();
        if (
          value.bytes.length < 2048 ||
          (size.width && size.height && size.width <= 48 && size.height <= 48)
        )
          throw new Error('返回默认占位头像，该号可能不存在或未设置头像');
        return value;
      };
      for (const action of ['get_avatar', 'get_user_avatar']) {
        try {
          const value = (await ctx
            .use(adapterService)
            .query(action, { user_id: Number(userId), size: 640 }, c.run.signal)) as Record<
            string,
            unknown
          >;
          const url = String(value?.url ?? value?.avatar ?? value?.file ?? '');
          if (/^https?:\/\//.test(url)) {
            image = await download(url);
            avatarUrl = url;
            source = '协议端 SnowLuma';
            break;
          }
        } catch (error) {
          c.run.signal.throwIfAborted();
          failures.push(String(error));
        }
      }
      if (!image)
        for (const url of [
          `https://q.qlogo.cn/headimg_dl?dst_uin=${Number(userId)}&spec=640&img_type=jpg`,
          `https://q1.qlogo.cn/g?b=qq&nk=${Number(userId)}&s=640`,
        ])
          try {
            image = await download(url);
            avatarUrl = url;
            source = '腾讯头像接口（qlogo）';
            break;
          } catch (error) {
            c.run.signal.throwIfAborted();
            failures.push(String(error));
          }
      if (!image) throw new Error('头像获取失败：' + failures.join('；'));
      image = await modelImage(image.bytes, image.mime);
      return {
        content: [
          { type: 'text', text: `QQ ${userId} 的头像（来源：${source}）` },
          imageParts(image.bytes, image.mime),
        ],
        avatarUrl,
      };
    },
  });
  tools.register(ctx, {
    builtinQQ: true,
    name: 'read_video',
    displayName: '查看消息视频',
    category: 'query',
    description:
      '读取当前会话消息中的视频元信息。按视频模式选择原生视频或启用的抽帧插件；画面关闭、抽帧不可用时只返回元信息并说明原因。frames 为可选的1至12字符串。',
    parameters: {
      type: 'object',
      properties: { messageId: { type: 'string' }, frames: { type: 'string' } },
      required: ['messageId'],
      additionalProperties: false,
    },
    parse: (a) =>
      z
        .object({
          messageId: z.string().min(1).max(160),
          frames: z
            .string()
            .regex(/^(?:[1-9]|1[0-2])$/)
            .optional(),
        })
        .strict()
        .parse(a),
    execute: async (c, a) => {
      const v = a as { messageId: string; frames?: string },
        m = message(c.chatKey, v.messageId);
      return {
        content: await media.video(
          c.chatKey,
          m.localId,
          v.frames ? Number(v.frames) : undefined,
          c.run.signal,
        ),
      };
    },
  });
}

export const mediaTools = definePlugin({
  id: 'media-tools',
  name: '图片、视频与头像工具',
  requires: [
    toolService.id,
    storageService.id,
    mediaService.id,
    configService.id,
    outboundService.id,
    accessService.id,
    adapterService.id,
  ],
  setup: registerMedia,
});
