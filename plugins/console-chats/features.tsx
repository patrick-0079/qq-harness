import { Toggle } from "@qq-harness/client-sdk";
import type { ChatSettings, PublicConfig } from "@qq-harness/contracts";
const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
export function MediaOptions({
  draft,
  change,
}: {
  draft: ChatSettings;
  change: (v: Partial<ChatSettings>) => void;
}) {
  const api = object(draft.legacySession.api),
    patch = (v: Record<string, unknown>) =>
      change({
        legacySession: { ...draft.legacySession, api: { ...api, ...v } },
      });
  return (
    <>
      <h3 className="settings-divider">图片与视频理解</h3>
      <div className="form-grid">
        <label className="toggle-row">
          启用图片识别
          <Toggle
            checked={api.vision !== false}
            onChange={(e) => patch({ vision: e.target.checked })}
          />
        </label>
        <label className="toggle-row">
          启用视频识别
          <Toggle
            checked={api.video === true}
            onChange={(e) => patch({ video: e.target.checked })}
          />
        </label>
        <label>
          图片模型（留空用主模型）
          <input
            value={api.visionModel ?? ""}
            onChange={(e) => patch({ visionModel: e.target.value })}
          />
        </label>
        <label>
          视频模型（留空用主模型）
          <input
            value={api.videoModel ?? ""}
            onChange={(e) => patch({ videoModel: e.target.value })}
          />
        </label>
        <label>
          视频输入方式
          <select
            value={api.videoMode ?? "auto"}
            onChange={(e) => patch({ videoMode: e.target.value })}
          >
            <option value="auto">自动抽帧</option>
            <option value="frames">抽帧图片</option>
            <option value="native">原生视频</option>
            <option value="off">关闭</option>
          </select>
        </label>
        <label>
          思考预算（0 使用渠道默认）
          <input
            type="number"
            min="0"
            max="200000"
            value={draft.modelSelection.thinkingBudget}
            onChange={(e) =>
              change({
                modelSelection: {
                  ...draft.modelSelection,
                  thinkingBudget: Number(e.target.value),
                },
              })
            }
          />
        </label>
      </div>
      <small>
        媒体读取工具返回真正的多模态输入。抽帧方式需要在全局媒体设置中指定
        FFmpeg 与 FFprobe。
      </small>
    </>
  );
}
export function StickerOptions({
  draft,
  config,
  change,
}: {
  draft: ChatSettings;
  config?: PublicConfig;
  change: (v: Partial<ChatSettings>) => void;
}) {
  const v = {
    enabled: true,
    collectEnabled: true,
    promptMaxStickers: 10,
    maxCollectPerHour: 10,
    encourage: 1,
    ...object(config?.legacyGlobal.sticker),
    ...object(draft.legacySession.sticker),
  };
  const patch = (p: Record<string, unknown>) =>
    change({
      legacySession: { ...draft.legacySession, sticker: { ...v, ...p } },
    });
  return (
    <div className="form-stack">
      <h3>QQ 收藏表情</h3>
      <p className="muted">
        同步 QQ
        收藏与本地备注。收藏图片会保存在本工程的数据目录，发送、备注与使用次数会持续保存。
      </p>
      <div className="form-grid">
        {(
          [
            ["enabled", "启用表情库"],
            ["collectEnabled", "允许从会话图片收藏"],
          ] as const
        ).map(([k, label]) => (
          <label className="toggle-row" key={k}>
            {label}
            <Toggle
              checked={v[k]}
              onChange={(e) => patch({ [k]: e.target.checked })}
            />
          </label>
        ))}
        <label>
          提示词最多展示几张表情
          <input
            type="number"
            min="0"
            max="50"
            value={v.promptMaxStickers}
            onChange={(e) =>
              patch({ promptMaxStickers: Number(e.target.value) })
            }
          />
        </label>
        <label>
          每小时最多收藏
          <input
            type="number"
            min="1"
            max="100"
            value={v.maxCollectPerHour}
            onChange={(e) =>
              patch({ maxCollectPerHour: Number(e.target.value) })
            }
          />
        </label>
        <label>
          使用表情的积极程度
          <select
            value={v.encourage}
            onChange={(e) => patch({ encourage: Number(e.target.value) })}
          >
            <option value="0">不鼓励</option>
            <option value="1">偶尔</option>
            <option value="2">较积极</option>
            <option value="3">很积极</option>
          </select>
        </label>
      </div>
      <small>
        在“工具与技能”中搜索 sticker，可查看全部表情工具的参数和有效状态。
      </small>
    </div>
  );
}
export function ImageStudioOptions({
  draft,
  config,
  change,
}: {
  draft: ChatSettings;
  config?: PublicConfig;
  change: (v: Partial<ChatSettings>) => void;
}) {
  const skills = object(draft.legacySession.skills),
    v = {
      enabled: true,
      requirePreview: true,
      maxSendsPerRun: 3,
      maxBytesMB: 6,
      pixivMaxBytesMB: 20,
      allowAvatar: true,
      pixivEnabled: true,
      pixivApiUrl: "https://api.lolicon.app/setu/v2",
      avoidRepeat: true,
      repeatWindowDays: 30,
      popularFirst: true,
      ...object(object(config?.legacyGlobal.skills)["image-studio"]),
      ...object(skills["image-studio"]),
    };
  const patch = (p: Record<string, unknown>) =>
    change({
      legacySession: {
        ...draft.legacySession,
        skills: { ...skills, "image-studio": { ...v, ...p } },
      },
    });
  return (
    <div className="form-stack">
      <h3>图片工坊</h3>
      <p className="muted">
        找图、预览确认、旋转翻转、黑白与缩放，保留未编辑图片的原始内容。预览与发送绑定当前运行，失败时保留预览。
      </p>
      <div className="form-grid">
        {(
          [
            ["enabled", "启用图片工坊"],
            ["requirePreview", "发送前必须预览"],
            ["allowAvatar", "允许修改自己的 QQ 头像"],
            ["pixivEnabled", "启用 Pixiv 插画检索"],
            ["avoidRepeat", "避免重复发送"],
            ["popularFirst", "Pixiv 优先热门"],
          ] as const
        ).map(([k, label]) => (
          <label className="toggle-row" key={k}>
            {label}
            <Toggle
              checked={v[k]}
              onChange={(e) => patch({ [k]: e.target.checked })}
            />
          </label>
        ))}
        {(
          [
            ["maxSendsPerRun", "每轮最多发送几张"],
            ["maxBytesMB", "普通图片上限（MB）"],
            ["pixivMaxBytesMB", "Pixiv 图片上限（MB）"],
            ["repeatWindowDays", "图片去重窗口（天）"],
          ] as const
        ).map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              type="number"
              min="1"
              value={v[k]}
              onChange={(e) => patch({ [k]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <label>
        Pixiv 检索接口
        <input
          value={v.pixivApiUrl}
          onChange={(e) => patch({ pixivApiUrl: e.target.value })}
        />
      </label>
      <small>
        原生工具名称沿用 image-studio__find_images、image-studio__edit_image 与
        image-studio__set_qq_avatar；不再要求管理后端运行于 Electron。
      </small>
    </div>
  );
}
