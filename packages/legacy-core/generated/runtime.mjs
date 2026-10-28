// Generated from pinned, isolated pure utility modules.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export function createCoreUtilities(__utilityHost){const fetch=(...args)=>__utilityHost.fetch(...args);const module={exports:{}};const exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/legacy-core/vendor/core-utilities.js
var core_utilities_exports = {};
__export(core_utilities_exports, {
  StickerManager: () => StickerManager,
  calendar: () => holidays_exports,
  imageHistory: () => image_history_exports,
  imagePixels: () => image_pixels_exports,
  imageSearch: () => image_search_exports,
  imageTags: () => image_tags_default,
  localStickerPath: () => localStickerPath,
  prices: () => model_prices_exports,
  session: () => session_config_exports,
  silence: () => silence_policy_exports,
  stickers: () => stickers_exports,
  trigger: () => trigger_exports,
  util: () => util_exports,
  web: () => web_search_exports
});
module.exports = __toCommonJS(core_utilities_exports);

// packages/legacy-core/vendor/model-prices.js
var model_prices_exports = {};
__export(model_prices_exports, {
  OFFICIAL_PRICES: () => OFFICIAL_PRICES,
  PEAK_WINDOWS: () => PEAK_WINDOWS,
  UNKNOWN_VENDOR: () => UNKNOWN_VENDOR,
  imageTokens: () => imageTokens,
  isPeakHour: () => isPeakHour,
  listOfficialPrices: () => listOfficialPrices,
  matchPriceTable: () => matchPriceTable,
  modelLabel: () => modelLabel,
  priceAt: () => priceAt,
  remoteOverrideCount: () => remoteOverrideCount,
  resolveModelPrice: () => resolveModelPrice,
  resolveOfficialPrice: () => resolveOfficialPrice,
  setRemotePrices: () => setRemotePrices,
  splitModelLabel: () => splitModelLabel,
  sumCostByTime: () => sumCostByTime,
  supportsImage: () => supportsImage,
  vendorOfConfig: () => vendorOfConfig
});
var OFFICIAL_PRICES = {
  // ══ DeepSeek ══
  // 来源：官方中文文档 https://api-docs.deepseek.com/zh-cn/quick_start/pricing
  //       + https://api-docs.deepseek.com/zh-cn/guides/vision
  //       + 2026-09-11 官方 API 全量实测（模型清单/文本/图片/工具/JSON/音频/图片token计量）
  // 官方直接以人民币标价，原样照录，未做汇率换算。
  //
  // ── 2026-09-11 实测结论（文档多处滞后，以下以实测为准）──
  // · 官方 /models 只返回两个：deepseek-flash、deepseek-v4-pro。
  //   旧名 deepseek-v4-flash / deepseek-v4-flash-vision-exp 仍可调用，但底座已下线，
  //   由 DeepSeek-V4.1-Flash 承接并按 Flash 价计费；deepseek-chat / deepseek-reasoner
  //   实测同样回落 Flash 档（响应体 model 字段均回显 deepseek-flash）。
  // · 图像理解仅 Flash 支持；v4-pro 实测带图返回"无法查看图片内容，请提供文字描述"。
  // · 无音频/视频输入：input_audio 内容块直接 400（unknown variant）。
  // · 上下文 1M；输出上限 384K；并发 flash 2500 / v4-pro 500。
  // · ⚠️ v4-pro 计划下线：北京时间 2026-09-14 12:00 后至 V4.1-Pro 上线前，
  //   deepseek-v4-pro 的请求全部路由到 V4.1-Flash，并按 Flash 价计费。
  //
  // ── 价格（元 / 百万 token；闲时 = 高峰的一半）──
  //   高峰时段：北京时间周一至周五 9:00-12:00、14:00-18:00，其余为闲时。
  //   下表 in/out/cached 取闲时价（日常多数时间的实际费率）。
  //
  // ── 图片计费口径（已按官方文档 + 实测校准，纠正旧表中的 384 封顶错误）──
  //   每张图自动缩放：<约 544×544 保持长宽比放大；更大则缩到约 1300×1300 等效总像素。
  //   单图 token 上限 **1024**（实测：420×160≈188、800×800≈432、2048²与4096²均≈1004）。
  //   多图各自独立计算，无额外合并成本。detail=low 时缩到 512×512，更快更省。
  //   格式 JPEG/PNG/GIF/WebP；单请求最多 600 张；图片只能出现在 user 消息中。
  "deepseek-flash": {
    in: 1,
    out: 4,
    cached: 0.02,
    peak: { in: 2, out: 8, cached: 0.04 },
    image: {
      mode: "capped",
      maxTokensPerImage: 1024,
      note: "\u81EA\u52A8\u7F29\u653E\u5230\u7EA6 1300\xD71300 \u7B49\u6548\u603B\u50CF\u7D20\u540E\u5C01\u9876 1024 token/\u5F20\uFF08\u5B9E\u6D4B 420\xD7160\u2248188\u3001800\xD7800\u2248432\u3001\u22652048\xB2\u22481004\uFF09\uFF1Bdetail=low \u7F29\u5230 512\xD7512 \u66F4\u7701"
    },
    note: "\u95F2\u65F6\u4EF7\uFF1B\u9AD8\u5CF0\u7FFB\u500D\uFF1BDeepSeek-V4.1-Flash\uFF1B\u652F\u6301\u601D\u8003/\u975E\u601D\u8003\u53CC\u6A21\u5F0F\u3001\u56FE\u7247\u7406\u89E3\u3001\u5DE5\u5177\u8C03\u7528\u3001JSON \u8F93\u51FA\uFF1B1M \u4E0A\u4E0B\u6587 / 384K \u8F93\u51FA",
    src: "official"
  },
  // 旧模型名：底座已下线，请求由 V4.1-Flash 承接，按 Flash 价计费
  "deepseek-v4-flash": {
    in: 1,
    out: 4,
    cached: 0.02,
    peak: { in: 2, out: 8, cached: 0.04 },
    image: {
      mode: "capped",
      maxTokensPerImage: 1024,
      note: "\u540C deepseek-flash\uFF1A\u7F29\u653E\u540E\u5C01\u9876 1024 token/\u5F20"
    },
    note: "\u65E7\u6A21\u578B\u540D\uFF08\u5E95\u5EA7\u5DF2\u4E0B\u7EBF\uFF0C\u7531 V4.1-Flash \u627F\u63A5\uFF09\uFF0C\u6309 Flash \u4EF7\u8BA1\u8D39\uFF1B\u56FE\u7247/\u5DE5\u5177/JSON \u5747\u53EF\u7528",
    src: "official"
  },
  "deepseek-v4-flash-vision-exp": {
    in: 1,
    out: 4,
    cached: 0.02,
    peak: { in: 2, out: 8, cached: 0.04 },
    image: {
      mode: "capped",
      maxTokensPerImage: 1024,
      note: "\u540C deepseek-flash\uFF1A\u7F29\u653E\u540E\u5C01\u9876 1024 token/\u5F20"
    },
    note: "\u65E7\u89C6\u89C9\u6A21\u578B\u540D\uFF08\u5DF2\u4E0B\u7EBF\uFF0C\u7531 V4.1-Flash \u627F\u63A5\uFF09\uFF0C\u6309 Flash \u4EF7\u8BA1\u8D39",
    src: "official"
  },
  // ⚠️ -0731 是日期快照，能力冻结在 07-31，不随主模型获得图片输入——勿加 image 计费
  "deepseek-v4-flash-0731": { in: 1, out: 4, cached: 0.02, peak: { in: 2, out: 8, cached: 0.04 }, note: "\u95F2\u65F6\u4EF7\uFF1B\u9AD8\u5CF0\u7FFB\u500D\uFF1B\u65E5\u671F\u5FEB\u7167\u7248\uFF0C\u65E0\u56FE\u7247\u8F93\u5165", src: "official" },
  // 旧别名实测均回落 Flash 档：deepseek-chat 走非思考模式，deepseek-reasoner 走思考模式
  "deepseek-chat": {
    in: 1,
    out: 4,
    cached: 0.02,
    peak: { in: 2, out: 8, cached: 0.04 },
    image: { mode: "capped", maxTokensPerImage: 1024, note: "\u540C deepseek-flash\uFF1A\u7F29\u653E\u540E\u5C01\u9876 1024 token/\u5F20" },
    note: "\u65E7\u522B\u540D\uFF0C\u5B9E\u6D4B\u56DE\u843D deepseek-flash\uFF08\u975E\u601D\u8003\u6A21\u5F0F\uFF09\uFF0C\u6309 Flash \u4EF7\u8BA1\u8D39\uFF1B\u652F\u6301\u56FE\u7247\u8F93\u5165",
    src: "official"
  },
  "deepseek-reasoner": {
    in: 1,
    out: 4,
    cached: 0.02,
    peak: { in: 2, out: 8, cached: 0.04 },
    image: { mode: "capped", maxTokensPerImage: 1024, note: "\u540C deepseek-flash\uFF1A\u7F29\u653E\u540E\u5C01\u9876 1024 token/\u5F20" },
    note: "\u65E7\u522B\u540D\uFF0C\u5B9E\u6D4B\u56DE\u843D deepseek-flash\uFF08\u601D\u8003\u6A21\u5F0F\uFF09\uFF0C\u6309 Flash \u4EF7\u8BA1\u8D39\uFF1B\u652F\u6301\u56FE\u7247\u8F93\u5165",
    src: "official"
  },
  "deepseek-v4-pro": {
    in: 4.5,
    out: 13.5,
    cached: 0.15,
    peak: { in: 9, out: 27, cached: 0.3 },
    note: '\u95F2\u65F6\u4EF7\uFF1B\u9AD8\u5CF0\u7FFB\u500D\uFF1B\u7EAF\u6587\u672C\uFF08\u5B9E\u6D4B\u5E26\u56FE\u56DE"\u65E0\u6CD5\u67E5\u770B\u56FE\u7247"\uFF09\uFF1B\u26A0\uFE0F 2026-09-14 12:00 \u540E\u8DEF\u7531\u5230 V4.1-Flash \u5E76\u6309 Flash \u4EF7\u8BA1\u8D39',
    src: "official"
  },
  "deepseek-v4-pro-0813": {
    in: 4.5,
    out: 13.5,
    cached: 0.15,
    peak: { in: 9, out: 27, cached: 0.3 },
    note: "\u95F2\u65F6\u4EF7\uFF1B\u9AD8\u5CF0\u7FFB\u500D\uFF1B\u7EAF\u6587\u672C\uFF1B\u65E5\u671F\u5FEB\u7167\u7248",
    src: "official"
  },
  "deepseek-v3.1-terminus": { in: 1, out: 4, cached: 0.02, peak: { in: 2, out: 8, cached: 0.04 }, note: "\u65E7\u4EE3\uFF0C\u53D6\u4E0B\u7EBF\u4EF7\u8FD1\u4F3C\uFF08\u539F\u4EF7 1.5/4.5\uFF09", src: "derived" },
  "deepseek-r1-0528": { in: 4.5, out: 13.5, cached: 0.15, note: "\u65E7\u4EE3\uFF0C\u6309 v4-pro \u73B0\u4EF7\u8FD1\u4F3C", src: "derived" },
  // ══ 智谱 Z.ai / GLM ══
  // 来源：智谱官方价格页 https://open.bigmodel.cn/pricing（2026-09-03 直取），人民币原价。
  // 缓存存储限时免费；带阶梯的取最低档（≤32K 输入）。
  "glm-5.3": { in: 8, out: 28, cached: 2, note: "1M \u4E0A\u4E0B\u6587\uFF1B\u7F13\u5B58\u5B58\u50A8\u9650\u65F6\u514D\u8D39", src: "official" },
  // 促销价（用户实测确认 2026-09-05）：输入 0.4 / 输出 1.4 / 缓存 0.115
  // 原价 0.8/1.4/0.23 —— 输入与缓存五折，输出不打折。
  "glm-5.3-flash": { in: 0.4, out: 1.4, cached: 0.115, note: "\u4FC3\u9500\u4EF7\uFF1B\u539F\u4EF7 0.8/1.4/0.23\uFF08\u8F93\u5165\u4E0E\u7F13\u5B58\u4E94\u6298\uFF0C\u8F93\u51FA\u4E0D\u6253\u6298\uFF09", src: "official" },
  "glm-5.2": { in: 8, out: 28, cached: 2, note: "1M \u4E0A\u4E0B\u6587", src: "official" },
  "glm-5.1": { in: 6, out: 24, cached: 1.3, note: "\u226432K \u6863\uFF1B>32K \u4E3A 8/28/2", src: "official" },
  "glm-5-turbo": { in: 5, out: 22, cached: 1.2, note: "\u226432K \u6863\uFF1B>32K \u4E3A 7/26/1.8", src: "official" },
  "glm-5": { in: 4, out: 18, cached: 1, note: "\u226432K \u6863\uFF1B>32K \u4E3A 6/22/1.5", src: "official" },
  "glm-5v-turbo": { in: 5, out: 22, cached: 1.2, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u591A\u6A21\u6001\uFF1B>32K \u4E3A 7/26/1.8", src: "official" },
  "glm-4.7": { in: 2, out: 8, cached: 0.4, note: "\u226432K \u4E14\u8F93\u51FA<0.2K\uFF1B\u5176\u4F59\u6863\u66F4\u9AD8", src: "official" },
  "glm-4.7-flash": { in: 0, out: 0, cached: 0, note: "\u5B98\u65B9\u514D\u8D39", src: "official" },
  "glm-4.7-flashx": { in: 0.5, out: 3, cached: 0.1, note: "200K \u4E0A\u4E0B\u6587", src: "official" },
  "glm-4.6": { in: 4, out: 16, cached: 0.8, note: "\u6309 4.7 \u540C\u6863\u8FD1\u4F3C", src: "official" },
  "glm-4.5": { in: 4, out: 16, cached: 0.8, note: "\u6309 4.7 \u540C\u6863\u8FD1\u4F3C", src: "official" },
  "glm-4.5-air": { in: 0.8, out: 2, cached: 0.16, note: "\u226432K \u4E14\u8F93\u51FA<0.2K", src: "official" },
  "glm-4.6v": { in: 1, out: 3, cached: 0.2, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u226432K\uFF1B32-128K \u4E3A 2/6/0.4", src: "official" },
  "glm-4.6v-flashx": { in: 0.15, out: 1.5, cached: 0.03, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u226432K", src: "official" },
  "glm-4.5v": { in: 2, out: 6, cached: 0.4, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u226432K\uFF1B32-64K \u4E3A 4/12/0.8", src: "official" },
  "glm-4-plus": { in: 5, out: 5, cached: null, note: "\u65E7\u4EE3 GLM-4 \u7CFB\u5217", src: "official" },
  "glm-4-long": { in: 1, out: 1, cached: null, note: "\u65E7\u4EE3\uFF0C1M \u4E0A\u4E0B\u6587", src: "official" },
  "glm-4-flash": { in: 0, out: 0, cached: 0, note: "\u5B98\u65B9\u514D\u8D39", src: "official" },
  // ══ 月之暗面 Kimi / Moonshot ══
  // 来源：月之暗面开放平台公示标准（多来源交叉验证：腾讯云开发者社区对照表、行业报道均一致）。
  // K3 定价偏高：缓存未命中 20 / 输出 100；但官方称编程场景缓存命中率>90%，命中价仅 2。
  "kimi-k3": { in: 20, out: 100, cached: 2, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u7F13\u5B58\u547D\u4E2D\u7387>90% \u65F6\u5B9E\u9645\u6210\u672C\u4F4E\u5F97\u591A", src: "derived" },
  "kimi-k2.7-code": { in: 20, out: 100, cached: 2, note: "\u7F16\u7A0B\u7248\uFF0C\u6309 K3 \u6863\u8FD1\u4F3C", src: "derived" },
  "kimi-k2.6": { in: 8, out: 32, cached: 1, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3\uFF0C\u6309\u7F8E\u5143\u4EF7\u6298\u7B97", src: "derived" },
  "kimi-k2": { in: 4.32, out: 14.4, cached: 0.5, note: "\u65E7\u4EE3", src: "derived" },
  // ══ MiniMax ══
  // 来源：MiniMax 官方文档 https://platform.minimaxi.com/docs/guides/pricing-paygo（2026-09-03 直取），人民币原价。
  // M3 标注"永久五折"，下表为折后价；>512K 输入翻倍。优先服务（service_tier=priority）按标准价 1.5 倍计。
  "minimax-m3": { in: 2.1, out: 8.4, cached: 0.42, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u2264512K \u4E94\u6298\u4EF7\uFF1B>512K \u4E3A 4.2/16.8/0.84", src: "official" },
  "minimax-m2.7": { in: 2.1, out: 8.4, cached: 0.42, note: "\u7F13\u5B58\u5199\u5165 2.625", src: "official" },
  "minimax-m2.7-highspeed": { in: 4.2, out: 16.8, cached: 0.42, note: "\u9AD8\u901F\u7248\uFF0C\u7F13\u5B58\u5199\u5165 2.625", src: "official" },
  "minimax-m2.5": { in: 2.1, out: 8.4, cached: 0.21, note: "\u7F13\u5B58\u5199\u5165 2.625", src: "official" },
  "minimax-m2.5-highspeed": { in: 4.2, out: 16.8, cached: 0.21, note: "\u9AD8\u901F\u7248", src: "official" },
  "minimax-m2.1": { in: 2.1, out: 8.4, cached: 0.21, note: "\u7F13\u5B58\u5199\u5165 2.625", src: "official" },
  "minimax-m2.1-highspeed": { in: 4.2, out: 16.8, cached: 0.21, note: "\u9AD8\u901F\u7248", src: "official" },
  "minimax-m2": { in: 2.1, out: 8.4, cached: 0.21, note: "\u7F13\u5B58\u5199\u5165 2.625", src: "official" },
  "minimax-m1": { in: 2.1, out: 8.4, cached: 0.21, note: "\u65E7\u4EE3\uFF0C\u6309\u73B0\u4EF7\u8FD1\u4F3C", src: "official" },
  // ══ 小米 MiMo ══
  // 来源：小米官方定价（对标高通 DeepSeek 同档）+ 带真实账单的公开对照表交叉验证。
  // 注意：缓存命中价极低（0.02~0.075），是编码场景省钱关键；UltraSpeed 为 Pro 版 3 倍价。
  "mimo-v2.5": { in: 1, out: 2, cached: 0.02, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u5BF9\u6807 DeepSeek V4-Flash \u540C\u6863", src: "derived" },
  "mimo-v2.5-pro": { in: 3, out: 6, cached: 0.025, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u5BF9\u6807 DeepSeek V4-Pro \u540C\u6863", src: "derived" },
  "mimo-v2.5-pro-ultraspeed": { in: 9, out: 18, cached: 0.075, note: "\u6781\u901F\u7248\uFF0C\u4E3A Pro \u7248 3 \u500D\u4EF7", src: "derived" },
  "mimo-v2.5-flash": { in: 0.72, out: 2.16, cached: null, note: "\u8F7B\u91CF\u6863\uFF0C\u6309\u7F8E\u5143\u4EF7\u6298\u7B97\uFF08$0.10/$0.30\uFF09", src: "derived" },
  // ══ 阿里通义千问 ══
  // ⚠️ 阿里云百炼的价格表在需登录的「模型广场」内，公开文档只有能力清单，
  //    故以下为美元公开报价按 7.2 折算，属 derived；人民币实际价以百炼控制台为准。
  //    当前推荐主力（官方能力清单 2026-09-03）：qwen3.8-max / qwen3.8-flash / qwen3.7-plus / qwen3.7-flash
  "qwen3.8-max": { in: 14.4, out: 43.2, cached: 3.6, image: { mode: "pixel", divisor: 1024, base: 2, maxPixels: 16e6, note: "h\xD7w/1024+2\uFF0C\u4E0A\u9650 1600 \u4E07\u50CF\u7D20/\u56FE" }, note: "1M \u4E0A\u4E0B\u6587\uFF1B\u65D7\u8230\u6863", src: "derived" },
  "qwen3.8-max-0902": { in: 14.4, out: 43.2, cached: 3.6, image: { mode: "pixel", divisor: 1024, base: 2, maxPixels: 16e6, note: "h\xD7w/1024+2\uFF0C\u4E0A\u9650 1600 \u4E07\u50CF\u7D20/\u56FE" }, note: "1M \u4E0A\u4E0B\u6587", src: "derived" },
  "qwen3.8-flash": { in: 0.94, out: 3.1, cached: 0.115, image: { mode: "pixel", divisor: 1024, base: 2, maxPixels: 16e6, note: "h\xD7w/1024+2\uFF0C\u4E0A\u9650 1600 \u4E07\u50CF\u7D20/\u56FE" }, note: "1M \u4E0A\u4E0B\u6587\uFF1B\u8F7B\u91CF\u4E3B\u529B\uFF08$0.13/$0.43\uFF09", src: "derived" },
  "qwen3.7-max": { in: 9, out: 27, cached: null, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u6309 $1.25/$3.75 \u6298\u7B97", src: "derived" },
  "qwen3.7-plus": { in: 2.3, out: 9, cached: 0.23, image: { mode: "pixel", divisor: 1024, base: 2, maxPixels: 16e6, note: "h\xD7w/1024+2\uFF0C\u4E0A\u9650 1600 \u4E07\u50CF\u7D20/\u56FE" }, note: "1M \u4E0A\u4E0B\u6587\uFF1B\u5747\u8861\u4E3B\u529B\uFF08$0.32/$1.25\uFF09", src: "derived" },
  "qwen3.7-plus-2026-05-26": { in: 2.3, out: 9, cached: 0.23, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u5FEB\u7167\u7248", src: "derived" },
  "qwen3.7-flash": { in: 0.29, out: 1.15, cached: null, image: { mode: "pixel", divisor: 1024, base: 2, maxPixels: 16e6, note: "h\xD7w/1024+2\uFF0C\u4E0A\u9650 1600 \u4E07\u50CF\u7D20/\u56FE" }, note: "1M \u4E0A\u4E0B\u6587\uFF08$0.04/$0.16\uFF09", src: "derived" },
  "qwen3.6-flash": { in: 1.37, out: 8.14, cached: 0.137, image: { mode: "pixel", divisor: 1024, base: 2, maxPixels: 16e6, note: "h\xD7w/1024+2\uFF0C\u4E0A\u9650 1600 \u4E07\u50CF\u7D20/\u56FE" }, note: "\u6309 $0.19/$1.13 \u6298\u7B97", src: "derived" },
  "qwen3.5-plus": { in: 2.88, out: 12.96, cached: null, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3", src: "derived" },
  "qwen3.5-397b-a17b": { in: 4.32, out: 25.92, cached: null, note: "\u5F00\u6E90\u5927\u5C3A\u5BF8", src: "derived" },
  "qwen3-235b-a22b": { in: 1.44, out: 5.76, cached: null, note: "\u5F00\u6E90", src: "derived" },
  "qwen3-235b-a22b-thinking-2507": { in: 2.16, out: 21.6, cached: null, note: "\u601D\u8003\u7248", src: "derived" },
  "qwen3-coder-plus": { in: 4, out: 20, cached: null, note: "\u7F16\u7A0B\u7248\uFF0C\u226432K \u6863", src: "derived" },
  "qwen-plus": { in: 5.76, out: 14.4, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  "qwen-max": { in: 14.4, out: 43.2, cached: null, note: "\u6620\u5C04\u5230 3.8-Max \u6863", src: "derived" },
  "qwen-flash": { in: 0.29, out: 1.15, cached: null, note: "\u6620\u5C04\u5230 3.7-Flash \u6863", src: "derived" },
  "qwen-turbo": { in: 2.16, out: 4.32, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  "qwen-long": { in: 3.6, out: 14.4, cached: null, note: "10M \u4E0A\u4E0B\u6587", src: "derived" },
  // ══ 腾讯混元 ══
  // 来源：腾讯云官方文档 https://cloud.tencent.com/document/product/1729/97731（2026-06-26 更新），人民币刊例价。
  "hunyuan-a13b": { in: 0.5, out: 2, cached: null, note: "\u817E\u8BAF\u4E91\u520A\u4F8B\u4EF7", src: "official" },
  "hunyuan-role-latest": { in: 2.4, out: 9.6, cached: null, note: "\u817E\u8BAF\u4E91\u520A\u4F8B\u4EF7", src: "official" },
  "hunyuan-translation": { in: 1.2, out: 3.6, cached: null, note: "\u7FFB\u8BD1\u6A21\u578B", src: "official" },
  "hunyuan-translation-lite": { in: 1, out: 3, cached: null, note: "\u7FFB\u8BD1\u8F7B\u91CF\u7248", src: "official" },
  "hunyuan-embedding": { in: 0.7, out: 0.7, cached: null, note: "\u5411\u91CF\u6A21\u578B", src: "official" },
  // Hy 系列：腾讯云开发者社区对照表（广州地域在线推理按量价，2026 年）
  "hy4-preview": { in: 6, out: 18, cached: 0.3, note: "960K \u8F93\u5165 / 64K \u8F93\u51FA", src: "derived" },
  "hy3": { in: 1.15, out: 4.6, cached: 0.29, note: "262K \u4E0A\u4E0B\u6587\uFF0C\u6309\u7F8E\u5143\u4EF7\u6298\u7B97\uFF08$0.16/$0.64\uFF09", src: "derived" },
  "hunyuan": { in: 0.5, out: 2, cached: null, note: "\u6620\u5C04\u5230 a13b \u6863\uFF08\u817E\u8BAF\u4E91\u5B98\u65B9\u520A\u4F8B\uFF09", src: "official" },
  // ══ 字节豆包 ══
  "doubao-pro": { in: 3.2, out: 7.2, cached: null, note: "\u65D7\u8230\u6863", src: "derived" },
  "doubao-lite": { in: 0.54, out: 1.44, cached: null, note: "\u8F7B\u91CF\u6863", src: "derived" },
  // ══ 百度文心 ══
  "ernie-5.0": { in: 8.64, out: 25.92, cached: null, note: "\u65D7\u8230\u6863", src: "derived" },
  "ernie-4.5": { in: 2.88, out: 8.64, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  // ══ OpenAI GPT-5.6 系列 ══
  // 促销价（至少持续到 2026-11-21）：短上下文 / 长上下文(>272K) 双档
  "gpt-5.6-sol": { in: 28.8, out: 144, cached: 2.88, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u4FC3\u9500\u4EF7\uFF1B\u957F\u4E0A\u4E0B\u6587 57.6/216", src: "derived" },
  "gpt-5.6-terra": { in: 14.4, out: 86.4, cached: 1.44, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u4FC3\u9500\u4EF7\uFF1B\u957F\u4E0A\u4E0B\u6587 28.8/129.6", src: "derived" },
  "gpt-5.6-luna": { in: 1.44, out: 8.64, cached: 0.14, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u4FC3\u9500\u4EF7\uFF1B\u957F\u4E0A\u4E0B\u6587 2.88/12.96", src: "derived" },
  "gpt-5.6-cyber": { in: 90, out: 540, cached: 9, note: "Daybreak \u8BA1\u5212", src: "derived" },
  "gpt-5.5": { in: 36, out: 216, cached: 3.6, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3\u65D7\u8230", src: "derived" },
  "gpt-5.5-pro": { in: 216, out: 1296, cached: null, note: "Pro \u6863", src: "derived" },
  "gpt-5.4": { in: 18, out: 108, cached: 1.8, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-5.4-mini": { in: 5.4, out: 32.4, cached: 0.54, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-5.4-nano": { in: 1.44, out: 9, cached: 0.14, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-5.2": { in: 12.6, out: 100.8, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-5.1": { in: 9, out: 72, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-5": { in: 9, out: 72, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-5-mini": { in: 1.8, out: 14.4, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-5-nano": { in: 0.36, out: 2.88, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-4.1": { in: 14.4, out: 57.6, cached: 2.88, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-4.1-mini": { in: 2.88, out: 11.52, cached: 0.58, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-4.1-nano": { in: 0.72, out: 2.88, cached: 0.14, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-4o": { in: 18, out: 72, cached: null, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-4o-mini": { in: 1.08, out: 4.32, cached: null, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3", src: "derived" },
  "gpt-oss-120b": { in: 0.22, out: 1.22, cached: null, note: "\u5F00\u6E90\u6743\u91CD", src: "derived" },
  "gpt-oss-20b": { in: 0.14, out: 0.72, cached: null, note: "\u5F00\u6E90\u6743\u91CD", src: "derived" },
  // ══ Anthropic Claude ══
  "claude-fable-5.1": { in: 72, out: 360, cached: 1.8, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u7F13\u5B58\u8BFB\u5DF2\u964D 75%", src: "derived" },
  "claude-mythos-5.1": { in: 72, out: 360, cached: 1.8, note: "\u53D7\u9650\u4F9B\u5E94", src: "derived" },
  "claude-fable-5": { in: 72, out: 360, cached: 7.2, note: "\u65E7\u7248\u7F13\u5B58\u8D35 4 \u500D", src: "derived" },
  "claude-mythos-5": { in: 72, out: 360, cached: 7.2, note: "\u53D7\u9650\u4F9B\u5E94", src: "derived" },
  "claude-opus-5": { in: 36, out: 180, cached: 3.6, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "1M \u4E0A\u4E0B\u6587\uFF0C\u65E0\u957F\u4E0A\u4E0B\u6587\u6863\u9644\u52A0\u8D39", src: "derived" },
  "claude-opus-4.8": { in: 36, out: 180, cached: 3.6, note: "\u65E7\u4EE3\u65D7\u8230", src: "derived" },
  "claude-opus-4.7": { in: 36, out: 180, cached: 3.6, note: "\u65E7\u4EE3", src: "derived" },
  "claude-opus-4.6": { in: 36, out: 180, cached: 3.6, note: "\u65E7\u4EE3", src: "derived" },
  "claude-opus-4.5": { in: 36, out: 180, cached: 3.6, note: "\u65E7\u4EE3", src: "derived" },
  "claude-opus-4.1": { in: 108, out: 540, cached: null, note: "\u5DF2\u9000\u5F79", src: "derived" },
  "claude-sonnet-5": { in: 14.4, out: 72, cached: 1.44, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u4FC3\u9500\u4EF7\u5DF2\u8F6C\u6B63", src: "derived" },
  "claude-sonnet-4.6": { in: 21.6, out: 108, cached: 2.16, note: "\u65E7\u4EE3", src: "derived" },
  "claude-haiku-4.5": { in: 7.2, out: 36, cached: 0.72, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u6700\u4FBF\u5B9C", src: "derived" },
  "claude-haiku-4.5-batch": { in: 3.6, out: 18, cached: 0.36, note: "Batch \u4E94\u6298", src: "derived" },
  // ══ Google Gemini ══
  // 3.6/3.7/3.8 Flash 三档同价，属促销价，2027-01-01 起翻倍
  "gemini-3.8-flash": { in: 5.4, out: 27, cached: 0.54, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u4FC3\u9500\u4EF7\u81F3 2026-12-31", src: "derived" },
  "gemini-3.7-flash": { in: 5.4, out: 27, cached: 0.54, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u4FC3\u9500\u4EF7\u81F3 2026-12-31", src: "derived" },
  "gemini-3.6-flash": { in: 5.4, out: 27, cached: 0.54, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u4FC3\u9500\u4EF7\u81F3 2026-12-31", src: "derived" },
  "gemini-3.5-flash": { in: 10.8, out: 64.8, cached: 1.08, note: "\u539F\u4EF7\u6863", src: "derived" },
  "gemini-3.5-flash-lite": { in: 2.16, out: 18, cached: 0.22, note: "\u8F7B\u91CF\u6863", src: "derived" },
  "gemini-3.1-pro": { in: 14.4, out: 86.4, cached: 1.44, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u2264200K\uFF1B>200K \u7FFB\u500D", src: "derived" },
  "gemini-3.1-flash-lite": { in: 1.8, out: 10.8, cached: 0.18, note: "\u9884\u89C8", src: "derived" },
  "gemini-3-flash": { in: 3.6, out: 21.6, cached: 0.36, note: "\u9884\u89C8", src: "derived" },
  "gemini-2.5-pro": { in: 9, out: 72, cached: 0.9, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3", src: "derived" },
  "gemini-2.5-flash": { in: 2.16, out: 18, cached: 0.22, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3", src: "derived" },
  "gemini-2.5-flash-lite": { in: 0.72, out: 2.88, cached: 0.07, note: "\u65E7\u4EE3", src: "derived" },
  // ══ xAI Grok ══
  "grok-4.6": { in: 14.4, out: 43.2, cached: 3.6, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u2265200K \u8F93\u5165\u7FFB\u500D", src: "derived" },
  "grok-4.5": { in: 21.6, out: 64.8, cached: null, image: { mode: "unknown", note: "\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF0C\u6362\u7B97\u89C4\u5219\u5F85\u8865" }, note: "\u65E7\u4EE3", src: "derived" },
  "grok-4": { in: 21.6, out: 64.8, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  // ══ Meta ══
  "muse-spark-1.3": { in: 9, out: 30.6, cached: null, note: "Contributor \u6863 0.72/1.44", src: "derived" },
  "muse-spark-1.2": { in: 9, out: 30.6, cached: null, note: "Contributor \u6863 0.72/1.44", src: "derived" },
  "muse-spark-1.1": { in: 9, out: 30.6, cached: null, note: "\u65E7\u4EE3", src: "derived" },
  "llama-4-maverick": { in: 1.44, out: 5.01, cached: null, note: "\u5F00\u6E90\u6743\u91CD", src: "derived" },
  "llama-3.3-70b": { in: 1.44, out: 1.44, cached: null, note: "\u5F00\u6E90\u6743\u91CD", src: "derived" },
  // ══ 其他海外 ══
  "mistral-large-3": { in: 3.6, out: 10.8, cached: null, note: "", src: "derived" },
  "mistral-medium-3.5": { in: 10.8, out: 54, cached: null, note: "", src: "derived" },
  "command-a": { in: 18, out: 72, cached: null, note: "Cohere", src: "derived" },
  "nemotron-3-ultra": { in: 4.32, out: 25.92, cached: null, note: "NVIDIA", src: "derived" },
  "nemotron-3.5-lightning": { in: 0, out: 0, cached: null, note: "\u514D\u8D39\u989D\u5EA6", src: "derived" },
  "solar-pro-4": { in: 0.22, out: 0.86, cached: 0.043, note: "Upstage", src: "derived" },
  "step-3.7-flash": { in: 1.15, out: 6.62, cached: null, note: "\u9636\u8DC3\u661F\u8FB0", src: "derived" },
  "longcat-2.0": { in: 2.16, out: 8.64, cached: null, note: "\u7F8E\u56E2\uFF1B\u4FC3\u9500 0.3/1.2", src: "derived" },
  "ling-3.0-flash": { in: 0.15, out: 0.45, cached: 0.029, note: "InclusionAI", src: "derived" },
  "granite-4.0-h-micro": { in: 0.12, out: 0.81, cached: null, note: "IBM\uFF1B\u6700\u4FBF\u5B9C\u4ED8\u8D39\u6863", src: "derived" }
};
function resolveOfficialPrice(modelId) {
  const raw = String(modelId ?? "").trim().toLowerCase();
  if (!raw) return null;
  const table = EFFECTIVE_PRICES;
  if (table[raw]) return { ...table[raw], matched: raw };
  const bare = raw.includes("/") ? raw.slice(raw.indexOf("/") + 1) : raw;
  if (bare !== raw && table[bare]) return { ...table[bare], matched: bare };
  let best = null;
  for (const key of Object.keys(table)) {
    if (bare === key || bare.startsWith(key + "/") || bare.startsWith(key + "-") || bare.startsWith(key + "@") || bare.startsWith(key + ":")) {
      if (!best || key.length > best.length) best = key;
    }
  }
  if (best) return { ...table[best], matched: best };
  return null;
}
var REMOTE_OVERRIDES = {};
var EFFECTIVE_PRICES = OFFICIAL_PRICES;
function setRemotePrices(map) {
  REMOTE_OVERRIDES = map && typeof map === "object" ? map : {};
  EFFECTIVE_PRICES = Object.keys(REMOTE_OVERRIDES).length ? { ...OFFICIAL_PRICES, ...REMOTE_OVERRIDES } : OFFICIAL_PRICES;
}
function remoteOverrideCount() {
  return Object.keys(REMOTE_OVERRIDES).length;
}
function listOfficialPrices() {
  return Object.entries(EFFECTIVE_PRICES).map(([id, p]) => Object.prototype.hasOwnProperty.call(REMOTE_OVERRIDES, id) ? { id, ...p, remote: true } : { id, ...p });
}
var PEAK_WINDOWS = [
  { from: 9, to: 12 },
  { from: 14, to: 18 }
];
var PEAK_TZ_OFFSET_HOURS = 8;
function isPeakHour(at = Date.now()) {
  const d = at instanceof Date ? at : new Date(Number(at) || Date.now());
  const localHour = (d.getUTCHours() + PEAK_TZ_OFFSET_HOURS) % 24;
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return PEAK_WINDOWS.some((w) => localHour >= w.from && localHour < w.to);
}
function priceAt(price, at = Date.now()) {
  const peak = isPeakHour(at);
  if (peak && price?.peak) {
    return {
      in: Number(price.peak.in) || Number(price.in) || 0,
      out: Number(price.peak.out) || Number(price.out) || 0,
      cached: price.peak.cached == null ? price.cached == null ? Number(price.peak.in) || 0 : Number(price.cached) || 0 : Number(price.peak.cached) || 0,
      peak: true
    };
  }
  return {
    in: Number(price?.in) || 0,
    out: Number(price?.out) || 0,
    cached: price?.cached == null ? Number(price?.in) || 0 : Number(price.cached) || 0,
    peak: false
  };
}
function sumCostByTime(rows, price) {
  let cost = 0, peakCost = 0, offPeakCost = 0, peakTokens = 0, offPeakTokens = 0;
  for (const r of rows || []) {
    const p = priceAt(price, r.at);
    const prompt = Number(r.promptTokens) || 0;
    const completion = Number(r.completionTokens) || 0;
    const cached = Math.min(Number(r.cachedTokens) || 0, prompt);
    const fresh = Math.max(0, prompt - cached);
    const c = fresh / 1e6 * p.in + cached / 1e6 * p.cached + completion / 1e6 * p.out;
    cost += c;
    if (isPeakHour(r.at)) {
      peakCost += c;
      peakTokens += prompt + completion;
    } else {
      offPeakCost += c;
      offPeakTokens += prompt + completion;
    }
  }
  return { cost, peakCost, offPeakCost, peakTokens, offPeakTokens };
}
function imageTokens(price, width, height) {
  const img = price?.image;
  if (!img) return null;
  if (img.mode === "capped") return Number(img.maxTokensPerImage) || 0;
  if (img.mode === "pixel") {
    const divisor = Number(img.divisor) || 1024;
    const base = Number(img.base) || 0;
    const maxPx = Number(img.maxPixels) || 0;
    if (!width || !height) return null;
    let px = Number(width) * Number(height);
    if (maxPx) px = Math.min(px, maxPx);
    return Math.floor(px / divisor) + base;
  }
  if (img.maxTokensPerImage) return Number(img.maxTokensPerImage) || 0;
  return null;
}
function supportsImage(price) {
  return Boolean(price?.image);
}
function resolveModelPrice(modelId, cfg, priceTable = null) {
  const id = String(modelId || "").trim();
  const api = cfg && cfg.api || {};
  const useOfficial = api.useOfficialPrice === true;
  const custom = (api.modelPrices || {})[id];
  const hasCustom = !!(custom && (Number(custom.in) || Number(custom.out)));
  if (hasCustom) {
    return {
      in: Number(custom.in) || 0,
      out: Number(custom.out) || 0,
      cached: custom.cached == null ? Number(custom.in) || 0 : Number(custom.cached) || 0,
      peak: custom.peak || null,
      image: null,
      source: "custom",
      matched: id,
      // 编辑性只跟官方开关绑定（官方表模式下输入框只读）
      locked: useOfficial
    };
  }
  if (useOfficial) {
    const p = id ? priceTable ? matchPriceTable(id, priceTable) : resolveOfficialPrice(id) : null;
    if (p) {
      return {
        in: Number(p.in) || 0,
        out: Number(p.out) || 0,
        cached: p.cached == null ? Number(p.in) || 0 : Number(p.cached) || 0,
        peak: p.peak || null,
        image: p.image || null,
        source: "official",
        matched: p.matched ?? id,
        locked: true
      };
    }
    return {
      in: 0,
      out: 0,
      cached: 0,
      peak: null,
      image: null,
      source: "unmatched",
      matched: null,
      locked: true
    };
  }
  const fi = Number(api.priceInputPerM) || 0;
  const fo = Number(api.priceOutputPerM) || 0;
  if (fi || fo) {
    return {
      in: fi,
      out: fo,
      cached: Number(api.priceCachedPerM) || fi,
      peak: null,
      image: null,
      source: "manual",
      matched: null,
      locked: false
    };
  }
  return {
    in: 0,
    out: 0,
    cached: 0,
    peak: null,
    image: null,
    source: "none",
    matched: null,
    locked: false
  };
}
function matchPriceTable(modelId, table) {
  const raw = String(modelId || "").trim();
  if (!raw) return null;
  const id = raw.toLowerCase();
  const list = table || [];
  const exact = list.find((x) => String(x.id).toLowerCase() === id);
  if (exact) return { ...exact, matched: exact.id };
  if (id.includes("/")) {
    const bare = id.split("/").pop();
    const hit = list.find((x) => String(x.id).toLowerCase() === bare);
    if (hit) return { ...hit, matched: hit.id };
  }
  let best = null;
  for (const x of list) {
    const xid = String(x.id).toLowerCase();
    if (id.startsWith(xid) && (!best || xid.length > String(best.id).length)) best = x;
  }
  if (best) return { ...best, matched: best.id };
  return null;
}
var UNKNOWN_VENDOR = "\u672A\u77E5\u6E20\u9053";
function vendorOfConfig(cfg) {
  const c = cfg || {};
  const api = c.api || {};
  const base = String(api.baseUrl || "").trim();
  const provs = Array.isArray(c.providers) ? c.providers : [];
  const norm = (u) => String(u || "").replace(/\/+$/, "");
  const byId = api.provider ? provs.find((p) => p && p.id === api.provider) : null;
  const byUrl = base ? provs.find((p) => p && p.baseURL && norm(p.baseURL) === norm(base)) : null;
  const hit = byId || byUrl;
  if (hit && hit.displayName) return String(hit.displayName);
  if (base) {
    try {
      return new URL(base).host;
    } catch {
    }
  }
  return null;
}
function modelLabel(vendor, model) {
  const v = String(vendor || "").trim() || UNKNOWN_VENDOR;
  const m = String(model || "").trim() || "(\u672A\u77E5\u6A21\u578B)";
  return `${v}\uFF1A${m}`;
}
function splitModelLabel(label) {
  const s = String(label || "");
  const i = s.indexOf("\uFF1A");
  return i > 0 ? { vendor: s.slice(0, i), model: s.slice(i + 1) } : { vendor: "", model: s };
}

// packages/legacy-core/vendor/util.js
var util_exports = {};
__export(util_exports, {
  createEventBus: () => createEventBus,
  createSendChain: () => createSendChain,
  escapeCqText: () => escapeCqText,
  formatClockTime: () => formatClockTime,
  formatFullTime: () => formatFullTime,
  formatShortTime: () => formatShortTime,
  hasResponded: () => hasResponded,
  normalizeMessageList: () => normalizeMessageList,
  nowMs: () => nowMs,
  randInt: () => randInt,
  randRange: () => randRange,
  sanitizeUserText: () => sanitizeUserText,
  sleep: () => sleep,
  stripEmoji: () => stripEmoji,
  stripLeadingReplyPrefix: () => stripLeadingReplyPrefix,
  tidyBrackets: () => tidyBrackets,
  todayKey: () => todayKey,
  truncate: () => truncate,
  unquoteJsonString: () => unquoteJsonString
});
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}
function randInt(min, max) {
  const lo = Math.ceil(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}
function randRange([min, max]) {
  return randInt(min, max);
}
function nowMs() {
  return Date.now();
}
var WEEKDAYS = ["\u5468\u65E5", "\u5468\u4E00", "\u5468\u4E8C", "\u5468\u4E09", "\u5468\u56DB", "\u5468\u4E94", "\u5468\u516D"];
function pad2(n) {
  return String(n).padStart(2, "0");
}
function formatFullTime(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}\uFF08${WEEKDAYS[d.getDay()]}\uFF09`;
}
function formatShortTime(ts = Date.now()) {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function formatClockTime(ts = Date.now()) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function todayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function escapeCqText(text) {
  return String(text ?? "").replace(/\[CQ:/gi, "[CQ\uFF1A");
}
function sanitizeUserText(text) {
  let s = String(text ?? "");
  s = s.replace(/\[(未读信息|已读信息|新已读信息|新加入成员|本次唤醒|过去状态|系统|管理员|owner| Owner|OWNER|角色扮演|会话令牌|当前时间)[^\]]*\]/gi, "($1)");
  return s;
}
function unquoteJsonString(value) {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (t.startsWith('"')) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === "string") return parsed;
    } catch {
    }
  }
  return value;
}
function unwrapMessage(m) {
  if (m === null || m === void 0) return "";
  if (typeof m === "string") return m;
  if (Array.isArray(m)) return m.map(unwrapMessage).filter((x) => x !== null).join("\n");
  if (typeof m === "object") {
    if (m.type === "text" && typeof m.text === "string") return m.text;
    if (Array.isArray(m.content)) {
      return m.content.filter((p) => p && p.type === "text").map((p) => String(p.text ?? "")).join("\n");
    }
    const v = m.text ?? m.content ?? m.message;
    if (typeof v === "string") return v;
    return null;
  }
  return String(m);
}
function normalizeMessageList(input) {
  let value = input;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) || parsed && typeof parsed === "object") value = parsed;
      } catch {
      }
    } else if (trimmed.startsWith('"')) {
      const unquoted = unquoteJsonString(trimmed);
      if (typeof unquoted === "string") value = unquoted;
    }
  }
  const arr = Array.isArray(value) ? value : [value];
  const out = [];
  const bad = [];
  for (const m of arr) {
    const unwrapped = unwrapMessage(m);
    if (unwrapped === null) {
      bad.push(m);
      continue;
    }
    const s = String(unwrapped).trim();
    if (s) out.push(s);
  }
  if (!out.length && bad.length) {
    throw new Error(`messages \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6216\u5B57\u7B26\u4E32\u6570\u7EC4\uFF0C\u6536\u5230\u7684\u662F\u5BF9\u8C61\u5F62\u6001\uFF1A${JSON.stringify(bad[0])?.slice(0, 120)}\u2014\u2014\u8BF7\u628A\u6D88\u606F\u6587\u672C\u76F4\u63A5\u4F5C\u4E3A\u5B57\u7B26\u4E32\u4F20\u5165`);
  }
  return out;
}
function createSendChain() {
  let chain = Promise.resolve();
  return function enqueue(task) {
    const next = chain.then(task, task);
    chain = next.then(() => void 0, () => void 0);
    return next;
  };
}
function createEventBus() {
  const listeners = /* @__PURE__ */ new Map();
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, /* @__PURE__ */ new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    emit(type, payload) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (error) {
          console.error(`[bus] ${type} \u76D1\u542C\u5668\u51FA\u9519:`, error);
        }
      }
    }
  };
}
function truncate(text, max = 400) {
  const s = String(text ?? "");
  return s.length <= max ? s : `${s.slice(0, max)}\u2026(\u5171${s.length}\u5B57)`;
}
function stripLeadingReplyPrefix(text) {
  const s = String(text ?? "");
  return s.replace(/^\s*(?:回复|reply)?\s*@[^\s:：,，]{1,24}\s*[:：,，]\s*/i, "").trim();
}
function tidyBrackets(text) {
  const s = String(text ?? "");
  const m = /^\s*\[\s*(["'“”])([\s\S]*?)\1\s*\]\s*$/.exec(s);
  if (m) return m[2].trim();
  return s;
}
function hasResponded(session) {
  if (!session) return false;
  if (Array.isArray(session.sent) && session.sent.length > 0) return true;
  return Number(session.outbound) > 0;
}
function stripEmoji(text) {
  return String(text ?? "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").replace(/\s+/g, " ").trim();
}

// packages/legacy-core/vendor/image-search.js
var image_search_exports = {};
__export(image_search_exports, {
  hasCjk: () => hasCjk,
  hasKana: () => hasKana,
  resolvePixivTag: () => resolvePixivTag,
  searchBaidu: () => searchBaidu,
  searchBing: () => searchBing,
  searchImages: () => searchImages,
  searchPixiv: () => searchPixiv
});
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
var decodeEntities = (value) => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
var stripTags = (value) => String(value ?? "").replace(/<[^>]*>/g, "").trim();
async function searchBaidu(fetchImpl, query, limit) {
  const rn = Math.min(30, Math.max(12, limit * 4));
  const url = `https://image.baidu.com/search/acjson?tn=resultjson_com&ipn=rj&word=${encodeURIComponent(query)}&pn=0&rn=${rn}`;
  const res = await fetchImpl(url, {
    headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9", referer: "https://image.baidu.com/" },
    signal: AbortSignal.timeout(15e3)
  });
  if (!res.ok) throw new Error(`\u767E\u5EA6\u56FE\u7247 HTTP ${res.status}`);
  const text = await res.text();
  let items = [];
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data?.data)) items = data.data.filter(Boolean);
  } catch {
  }
  if (!items.length) {
    const seen2 = /* @__PURE__ */ new Set();
    for (const m of text.matchAll(/"(?:middleURL|thumbURL|hoverURL)"\s*:\s*"([^"]+)"/g)) {
      const u = m[1].replace(/\\\//g, "/");
      if (seen2.has(u)) continue;
      seen2.add(u);
      items.push({ middleURL: u });
    }
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of items) {
    const url0 = item?.middleURL || item?.thumbURL || item?.hoverURL;
    if (typeof url0 !== "string" || !/^https?:\/\//i.test(url0) || seen.has(url0)) continue;
    seen.add(url0);
    out.push({
      title: stripTags(decodeEntities(item?.fromPageTitleEnc || "")).slice(0, 40) || query,
      url: url0,
      source: "baidu",
      width: Number(item?.width) || void 0,
      height: Number(item?.height) || void 0
    });
    if (out.length >= limit) break;
  }
  return out;
}
async function searchBing(fetchImpl, query, limit) {
  const count = Math.min(60, Math.max(35, limit * 6));
  const url = `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=0&count=${count}&mkt=zh-CN&datsrc=N_I&layout=RowBased&mmasync=1`;
  const res = await fetchImpl(url, {
    headers: { "user-agent": UA, "accept-language": "zh-CN,zh;q=0.9" },
    signal: AbortSignal.timeout(15e3)
  });
  if (!res.ok) throw new Error(`Bing \u56FE\u7247 HTTP ${res.status}`);
  const text = decodeEntities(await res.text());
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of text.matchAll(/"murl":"([^"]+)"/g)) {
    const u = m[1];
    if (!/^https?:\/\//i.test(u) || seen.has(u)) continue;
    seen.add(u);
    out.push({ title: query, url: u, source: "bing" });
    if (out.length >= limit) break;
  }
  return out;
}
async function searchImages(fetchImpl, query, limit = 5) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("\u641C\u7D22\u5173\u952E\u8BCD\u4E3A\u7A7A");
  const n = Math.min(8, Math.max(1, Number(limit) || 5));
  if (typeof fetchImpl !== "function") throw new Error("\u6CA1\u6709\u7F51\u7EDC\u6743\u9650\uFF08\u9700\u8981\u5728 skill.json \u7684 permissions \u91CC\u58F0\u660E web_fetch\uFF09");
  const errors = [];
  const [bing, baidu] = await Promise.all([
    searchBing(fetchImpl, q, n).catch((error) => {
      errors.push(`Bing\uFF1A${error?.message ?? error}`);
      return [];
    }),
    searchBaidu(fetchImpl, q, n).catch((error) => {
      errors.push(`\u767E\u5EA6\uFF1A${error?.message ?? error}`);
      return [];
    })
  ]);
  const merged = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (item) => {
    if (!item || seen.has(item.url) || merged.length >= n) return;
    seen.add(item.url);
    merged.push(item);
  };
  for (let i = 0; i < Math.max(bing.length, baidu.length); i++) {
    push(bing[i]);
    push(baidu[i]);
  }
  if (!merged.length) throw new Error(`\u4E24\u4E2A\u6765\u6E90\u90FD\u6CA1\u641C\u5230 \u2014\u2014 ${errors.join("\uFF1B") || "\u8FD4\u56DE\u5185\u5BB9\u91CC\u6CA1\u6709\u56FE\u7247\u94FE\u63A5"}`);
  return merged.slice(0, n);
}
var ADULT_TAG = /^(r-?18g?|r18|成人向?|エロ|guro|リョナ|グロ)/i;
var PIXIV_API = "https://api.lolicon.app/setu/v2";
var POPULAR_TIERS = [1e3, 500];
var MAX_CALLS = 5;
var hasKana = (value) => /[\u3040-\u309f\u30a0-\u30ff]/.test(String(value ?? ""));
var hasCjk = (value) => /[\u4e00-\u9fff]/.test(String(value ?? ""));
function resolvePixivTag(query, dict) {
  const raw = String(query ?? "").trim();
  const clean = raw.replace(/[（(][^)）]*[)）]/g, "").trim() || raw;
  const lookup = (key) => dict && Object.prototype.hasOwnProperty.call(dict, key) ? String(dict[key]).trim() : "";
  for (const candidate of [clean, raw]) {
    const hit = lookup(candidate);
    if (hit) return { tag: hit, mapped: true, from: candidate };
  }
  for (const candidate of [clean, raw]) {
    const base = candidate.replace(/(酱|醬|ちゃん|さん)$/u, "").trim();
    if (base && base !== candidate) {
      const hit = lookup(base);
      if (hit) return { tag: hit, mapped: true, from: base };
    }
  }
  return { tag: raw, mapped: false, from: raw };
}
async function searchPixiv(fetchImpl, query, limit = 5, {
  apiUrl = PIXIV_API,
  dict = null,
  popular = true,
  isSeen = null,
  windowDays = 30
} = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("Pixiv \u641C\u56FE\u9700\u8981\u5173\u952E\u8BCD\u6216\u6807\u7B7E");
  if (typeof fetchImpl !== "function") throw new Error("\u6CA1\u6709\u7F51\u7EDC\u6743\u9650\uFF08\u9700\u8981\u5728 skill.json \u7684 permissions \u91CC\u58F0\u660E web_fetch\uFF09");
  const n = Math.min(20, Math.max(6, (Number(limit) || 5) * 3));
  const call = async (mode, value) => {
    const url = `${String(apiUrl || PIXIV_API).trim()}?${mode}=${encodeURIComponent(value)}&num=${n}&r18=0`;
    const res = await fetchImpl(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(15e3)
    });
    if (!res.ok) throw new Error(`Pixiv \u68C0\u7D22\u63A5\u53E3 HTTP ${res.status}`);
    const data = await res.json().catch(() => null);
    if (!data) throw new Error("Pixiv \u68C0\u7D22\u63A5\u53E3\u8FD4\u56DE\u7684\u4E0D\u662F JSON");
    if (data.error) throw new Error(`Pixiv \u68C0\u7D22\u63A5\u53E3\u62A5\u9519\uFF1A${data.error}`);
    return Array.isArray(data.data) ? data.data : [];
  };
  const resolved = resolvePixivTag(q, dict);
  const tags = [];
  if (resolved.mapped && resolved.tag !== q) tags.push(resolved.tag);
  tags.push(q);
  const plan = [];
  for (const tag of tags) {
    if (popular) for (const step of POPULAR_TIERS) plan.push(`${tag} ${step}users\u5165\u308A`);
    plan.push(tag);
  }
  const out = [];
  const seenPid = /* @__PURE__ */ new Set();
  let rawCount = 0;
  let calls = 0;
  const collect = (items) => {
    for (const item of items) {
      const pid = String(item?.pid ?? "").trim();
      if (!/^\d{4,12}$/.test(pid) || seenPid.has(pid)) continue;
      const itemTags = Array.isArray(item?.tags) ? item.tags.map(String) : [];
      if (item?.r18 === true || itemTags.some((t) => ADULT_TAG.test(t.trim()))) continue;
      rawCount += 1;
      const url = `https://pixiv.re/${pid}.png`;
      if (typeof isSeen === "function" && isSeen(url)) continue;
      seenPid.add(pid);
      const title = String(item?.title ?? "").trim() || "\uFF08\u65E0\u9898\uFF09";
      const author = String(item?.author ?? "").trim() || "\u672A\u77E5\u4F5C\u8005";
      out.push({
        title: `${title} \u2014 ${author}`.slice(0, 60),
        url,
        source: "pixiv",
        page: `https://www.pixiv.net/artworks/${pid}`
      });
      if (out.length >= limit) break;
    }
  };
  for (const value of plan) {
    if (out.length >= limit || calls >= MAX_CALLS) break;
    calls += 1;
    collect(await call("tag", value));
  }
  if (out.length < limit && rawCount === 0 && calls < MAX_CALLS) {
    calls += 1;
    collect(await call("keyword", q));
  }
  if (!out.length) {
    if (rawCount > 0) {
      throw new Error(`\u8FD9\u4E2A\u6807\u7B7E\u6700\u8FD1 ${windowDays} \u5929\u53D1\u8FC7\u7684\u90FD\u91CD\u590D\u4E86\uFF08${rawCount} \u5F20\u5168\u88AB\u8FC7\u6EE4\uFF09\u3002\u6362\u4E2A\u89D2\u8272\u6216\u66F4\u5177\u4F53\u7684\u8BCD\uFF0C\u6216\u8005\u8FC7\u51E0\u5929\u518D\u8BD5`);
    }
    const via = resolved.mapped && resolved.tag !== q ? `\uFF08\u4E2D\u6587\u300C${q}\u300D\u5DF2\u6309\u65E5\u6587\u300C${resolved.tag}\u300D\u641C\u8FC7\uFF09` : "";
    throw new Error(`Pixiv \u4E0A\u6CA1\u641C\u5230\u8FD9\u4E2A\u6807\u7B7E\u7684\u5168\u5E74\u9F84\u4F5C\u54C1${via}\uFF08\u6362\u65E5\u6587\u6807\u7B7E\u518D\u8BD5\uFF0C\u6BD4\u5982\u300C\u521D\u97F3\u30DF\u30AF\u300D\u300C\u535A\u9E97\u970A\u5922\u300D\uFF09`);
  }
  return out;
}

// packages/legacy-core/vendor/image-history.js
var image_history_exports = {};
__export(image_history_exports, {
  DEFAULT_WINDOW_DAYS: () => DEFAULT_WINDOW_DAYS,
  HISTORY_MAX: () => HISTORY_MAX,
  itemKey: () => itemKey,
  loadHistory: () => loadHistory,
  saveHistory: () => saveHistory,
  seenSet: () => seenSet
});
var import_node_fs = __toESM(require("node:fs"), 1);
var import_node_path = __toESM(require("node:path"), 1);
var import_node_crypto = require("node:crypto");
var HISTORY_MAX = 500;
var DEFAULT_WINDOW_DAYS = 30;
function itemKey(url) {
  const value = String(url ?? "").trim();
  const pixiv = /pixiv\.re\/(\d{4,12})\.png/i.exec(value);
  if (pixiv) return `pixiv:${pixiv[1]}`;
  return `url:${(0, import_node_crypto.createHash)("sha256").update(value).digest("hex").slice(0, 20)}`;
}
function loadHistory(file) {
  try {
    const raw = JSON.parse(import_node_fs.default.readFileSync(file, "utf8"));
    const items = Array.isArray(raw?.items) ? raw.items : [];
    return items.filter((it) => it && typeof it.key === "string" && Number.isFinite(Number(it.at))).map((it) => ({ key: it.key, at: Number(it.at) })).slice(-HISTORY_MAX);
  } catch {
    return [];
  }
}
function seenSet(items, windowDays = DEFAULT_WINDOW_DAYS, now = Date.now()) {
  const days = Number(windowDays);
  const cutoff = days > 0 ? now - days * 864e5 : 0;
  const set = /* @__PURE__ */ new Set();
  for (const item of items || []) {
    if (item && item.at >= cutoff) set.add(item.key);
  }
  return set;
}
function saveHistory(file, items) {
  const clean = (items || []).filter((it) => it && typeof it.key === "string" && Number.isFinite(Number(it.at))).slice(-HISTORY_MAX);
  import_node_fs.default.mkdirSync(import_node_path.default.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  import_node_fs.default.writeFileSync(tmp, JSON.stringify({ version: 1, items: clean }, null, 2), "utf8");
  import_node_fs.default.renameSync(tmp, file);
  return clean;
}

// packages/legacy-core/vendor/image-pixels.js
var image_pixels_exports = {};
__export(image_pixels_exports, {
  MAX_PIXELS: () => MAX_PIXELS,
  detectMime: () => detectMime,
  flipBitmap: () => flipBitmap,
  grayscaleBitmap: () => grayscaleBitmap,
  makePreview: () => makePreview,
  normalizeDegrees: () => normalizeDegrees,
  rotateBitmap: () => rotateBitmap,
  transformImage: () => transformImage
});
function detectMime(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 137 && buf[1] === 80 && buf[2] === 78 && buf[3] === 71) return "image/png";
  if (buf[0] === 255 && buf[1] === 216 && buf[2] === 255) return "image/jpeg";
  const head6 = buf.toString("ascii", 0, 6);
  if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}
function normalizeDegrees(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const deg = (Math.round(n / 90) * 90 % 360 + 360) % 360;
  return deg === 90 || deg === 180 || deg === 270 ? deg : 0;
}
function rotateBitmap(bitmap, width, height, degrees) {
  const deg = normalizeDegrees(degrees);
  if (!deg) return { bitmap, width, height };
  const swap = deg === 90 || deg === 270;
  const nw = swap ? height : width;
  const nh = swap ? width : height;
  const out = Buffer.allocUnsafe(nw * nh * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nx;
      let ny;
      if (deg === 90) {
        nx = height - 1 - y;
        ny = x;
      } else if (deg === 180) {
        nx = width - 1 - x;
        ny = height - 1 - y;
      } else {
        nx = y;
        ny = width - 1 - x;
      }
      const si = (y * width + x) * 4;
      const di = (ny * nw + nx) * 4;
      out[di] = bitmap[si];
      out[di + 1] = bitmap[si + 1];
      out[di + 2] = bitmap[si + 2];
      out[di + 3] = bitmap[si + 3];
    }
  }
  return { bitmap: out, width: nw, height: nh };
}
function flipBitmap(bitmap, width, height, direction) {
  const horizontal = direction === "horizontal";
  const vertical = direction === "vertical";
  if (!horizontal && !vertical) return { bitmap, width, height };
  const out = Buffer.allocUnsafe(bitmap.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = horizontal ? width - 1 - x : x;
      const ny = vertical ? height - 1 - y : y;
      const si = (y * width + x) * 4;
      const di = (ny * width + nx) * 4;
      out[di] = bitmap[si];
      out[di + 1] = bitmap[si + 1];
      out[di + 2] = bitmap[si + 2];
      out[di + 3] = bitmap[si + 3];
    }
  }
  return { bitmap: out, width, height };
}
function grayscaleBitmap(bitmap) {
  for (let i = 0; i < bitmap.length; i += 4) {
    const y = 0.299 * bitmap[i + 2] + 0.587 * bitmap[i + 1] + 0.114 * bitmap[i] | 0;
    bitmap[i] = y;
    bitmap[i + 1] = y;
    bitmap[i + 2] = y;
  }
  return bitmap;
}
var MAX_PIXELS = 6e7;
function transformImage(nativeImage, buffer, mime, ops = {}) {
  const img = nativeImage.createFromBuffer(buffer);
  if (!img || typeof img.isEmpty === "function" && img.isEmpty()) {
    throw new Error("\u56FE\u7247\u89E3\u7801\u5931\u8D25\uFF08\u53EF\u80FD\u4E0D\u662F\u771F\u56FE\u7247\uFF0C\u6216\u683C\u5F0F\u4E0D\u652F\u6301\uFF09");
  }
  let { width, height } = img.getSize();
  if (!width || !height) throw new Error("\u8BFB\u4E0D\u5230\u56FE\u7247\u5C3A\u5BF8");
  if (width * height > MAX_PIXELS) {
    throw new Error(`\u56FE\u7247\u592A\u5927\uFF08${width}\xD7${height}\uFF09\uFF0C\u8D85\u8FC7\u5904\u7406\u4E0A\u9650\uFF0C\u6362\u4E00\u5F20\u5C0F\u70B9\u7684\u56FE`);
  }
  let bitmap = img.toBitmap();
  if (!Buffer.isBuffer(bitmap) || bitmap.length !== width * height * 4) {
    throw new Error("\u56FE\u7247\u50CF\u7D20\u6570\u636E\u5F02\u5E38\uFF08\u5C3A\u5BF8\u4E0E\u4F4D\u56FE\u5BF9\u4E0D\u4E0A\uFF09");
  }
  const deg = normalizeDegrees(ops.rotate);
  if (deg) {
    ({ bitmap, width, height } = rotateBitmap(bitmap, width, height, deg));
  }
  if (ops.flip === "horizontal" || ops.flip === "vertical") {
    ({ bitmap, width, height } = flipBitmap(bitmap, width, height, ops.flip));
  }
  if (ops.grayscale === true) grayscaleBitmap(bitmap);
  let out = nativeImage.createFromBitmap(bitmap, { width, height });
  const maxSize = Math.round(Number(ops.maxSize) || 0);
  if (maxSize > 0 && Math.max(width, height) > maxSize) {
    const scale = maxSize / Math.max(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    out = out.resize({ width: w, height: h, quality: "best" });
    width = w;
    height = h;
  }
  const keepPng = mime === "image/png" || mime === "image/gif";
  const encoded = keepPng ? out.toPNG() : out.toJPEG(92);
  if (!Buffer.isBuffer(encoded) || !encoded.length) throw new Error("\u56FE\u7247\u91CD\u65B0\u7F16\u7801\u5931\u8D25");
  return { buffer: encoded, mime: keepPng ? "image/png" : "image/jpeg", width, height };
}
function makePreview(nativeImage, buffer, mime, { maxSide = 1024, quality = 80 } = {}) {
  const img = nativeImage.createFromBuffer(buffer);
  if (!img || typeof img.isEmpty === "function" && img.isEmpty()) {
    throw new Error("\u56FE\u7247\u89E3\u7801\u5931\u8D25\uFF08\u53EF\u80FD\u4E0D\u662F\u771F\u56FE\u7247\uFF0C\u6216\u683C\u5F0F\u4E0D\u652F\u6301\uFF09");
  }
  const { width, height } = img.getSize();
  if (!width || !height) throw new Error("\u8BFB\u4E0D\u5230\u56FE\u7247\u5C3A\u5BF8");
  if (Math.max(width, height) <= maxSide) {
    return { buffer, mime, width, height, resized: false };
  }
  const scale = maxSide / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const small = img.resize({ width: w, height: h, quality: "good" });
  const encoded = small.toJPEG(quality);
  if (!Buffer.isBuffer(encoded) || !encoded.length) throw new Error("\u7F29\u7565\u56FE\u751F\u6210\u5931\u8D25");
  return { buffer: encoded, mime: "image/jpeg", width, height, resized: true };
}

// packages/legacy-core/vendor/image-tags.json
var image_tags_default = {
  \u535A\u4E3D\u7075\u68A6: "\u535A\u9E97\u970A\u5922",
  \u96FE\u96E8\u9B54\u7406\u6C99: "\u9727\u96E8\u9B54\u7406\u6C99",
  \u857E\u7C73\u8389\u4E9A: "\u30EC\u30DF\u30EA\u30A2\u30FB\u30B9\u30AB\u30FC\u30EC\u30C3\u30C8",
  \u8299\u5170\u6735\u9732: "\u30D5\u30E9\u30F3\u30C9\u30FC\u30EB\u30FB\u30B9\u30AB\u30FC\u30EC\u30C3\u30C8",
  \u9B42\u9B44\u5996\u68A6: "\u9B42\u9B44\u5996\u5922",
  \u897F\u884C\u5BFA\u5E7D\u5E7D\u5B50: "\u897F\u884C\u5BFA\u5E7D\u3005\u5B50",
  \u516B\u4E91\u7D2B: "\u516B\u96F2\u7D2B",
  \u516B\u4E91\u84DD: "\u516B\u96F2\u85CD",
  \u5E15\u79CB\u8389: "\u30D1\u30C1\u30E5\u30EA\u30FC\u30FB\u30CE\u30FC\u30EC\u30C3\u30B8",
  \u742A\u9732\u8BFA: "\u30C1\u30EB\u30CE",
  \u7EA2\u7F8E\u94C3: "\u7D05\u7F8E\u9234",
  \u4E1C\u98CE\u8C37\u65E9\u82D7: "\u6771\u98A8\u8C37\u65E9\u82D7",
  \u6D29\u77E2\u8BF9\u8BBF\u5B50: "\u6D29\u77E2\u8ACF\u8A2A\u5B50",
  \u53E4\u660E\u5730\u89C9: "\u53E4\u660E\u5730\u3055\u3068\u308A",
  \u53E4\u660E\u5730\u604B: "\u53E4\u660E\u5730\u3053\u3044\u3057",
  \u706B\u7130\u732B\u71D0: "\u706B\u7114\u732B\u71D0",
  \u7075\u4E4C\u8DEF\u7A7A: "\u970A\u70CF\u8DEF\u7A7A",
  \u4E0A\u767D\u6CFD\u6167\u97F3: "\u4E0A\u767D\u6CA2\u6167\u97F3",
  \u85E4\u539F\u59B9\u7EA2: "\u85E4\u539F\u59B9\u7D05",
  \u84EC\u83B1\u5C71\u8F89\u591C: "\u84EC\u83B1\u5C71\u8F1D\u591C",
  \u56E0\u5E61\u5E1D: "\u56E0\u5E61\u3066\u3090",
  \u94C3\u4ED9: "\u9234\u4ED9\u30FB\u512A\u66C7\u83EF\u9662\u30FB\u30A4\u30CA\u30D0",
  \u661F\u718A\u52C7\u4EEA: "\u661F\u718A\u52C7\u5100",
  \u8328\u6728\u534E\u6247: "\u8328\u6728\u83EF\u6247",
  \u5C11\u540D\u9488\u5999\u4E38: "\u5C11\u540D\u91DD\u5999\u4E38",
  \u7A00\u795E\u63A2\u5973: "\u7A00\u795E\u30B5\u30B0\u30E1",
  \u7EAF\u72D0: "\u7D14\u72D0",
  \u8D6B\u5361\u63D0\u4E9A: "\u30D8\u30AB\u30FC\u30C6\u30A3\u30A2\u30FB\u30E9\u30D4\u30B9\u30E9\u30BA\u30EA",
  \u6469\u591A\u7F57\u9690\u5C90\u5948: "\u6469\u591A\u7F85\u96A0\u5C90\u5948",
  \u57F4\u5B89\u795E\u88BF\u59EC: "\u57F4\u5B89\u795E\u88BF\u59EB",
  \u9AD8\u4E3D\u91CE\u963F\u543D: "\u9AD8\u9E97\u91CE\u3042\u3046\u3093",
  \u79E6\u5FC3: "\u79E6\u3053\u3053\u308D",
  \u591A\u591A\u826F\u5C0F\u4F1E: "\u591A\u3005\u826F\u5C0F\u5098",
  \u6751\u7EB1\u6C34\u871C: "\u6751\u7D17\u6C34\u871C",
  \u5C01\u517D\u9D7A: "\u5C01\u7363\u306C\u3048",
  \u5E7D\u8C37\u54CD\u5B50: "\u5E7D\u8C37\u97FF\u5B50",
  \u5BAB\u53E4\u82B3\u9999: "\u5BAE\u53E4\u82B3\u9999",
  \u4E5D\u5341\u4E5D\u5F01\u5F01: "\u4E5D\u5341\u4E5D\u5F01\u3005",
  \u4E5D\u5341\u4E5D\u516B\u6865: "\u4E5D\u5341\u4E5D\u516B\u6A4B",
  \u59EC\u6D77\u68E0\u679C: "\u59EB\u6D77\u68E0\u306F\u305F\u3066",
  \u9732\u7C73\u5A05: "\u30EB\u30FC\u30DF\u30A2",
  \u8389\u683C\u9732: "\u30EA\u30B0\u30EB\u30FB\u30CA\u30A4\u30C8\u30D0\u30B0",
  \u7C73\u65AF\u8482\u5A05: "\u30DF\u30B9\u30C6\u30A3\u30A2\u30FB\u30ED\u30FC\u30EC\u30E9\u30A4",
  \u672C\u5C45\u5C0F\u94C3: "\u672C\u5C45\u5C0F\u9234",
  \u5C14\u5B50\u7530\u91CC\u4E43: "\u723E\u5B50\u7530\u91CC\u4E43",
  \u54C6\u6765\u54AA: "\u30C9\u30EC\u30DF\u30FC\u30FB\u30B9\u30A4\u30FC\u30C8",
  \u514B\u52B3\u6069\u76AE\u4E1D: "\u30AF\u30E9\u30A6\u30F3\u30D4\u30FC\u30B9",
  \u521D\u97F3\u672A\u6765: "\u521D\u97F3\u30DF\u30AF",
  \u521D\u97F3: "\u521D\u97F3\u30DF\u30AF",
  \u955C\u97F3\u94C3: "\u93E1\u97F3\u30EA\u30F3",
  \u955C\u97F3\u8FDE: "\u93E1\u97F3\u30EC\u30F3",
  \u5DE1\u97F3\u6D41\u6B4C: "\u5DE1\u97F3\u30EB\u30AB",
  \u5DE1\u97F3: "\u5DE1\u97F3\u30EB\u30AB",
  \u91CD\u97F3\u7279\u7279: "\u91CD\u97F3\u30C6\u30C8",
  \u91CD\u97F3teto: "\u91CD\u97F3\u30C6\u30C8",
  \u7ED3\u6708\u7F18: "\u7D50\u6708\u3086\u304B\u308A",
  \u6B4C\u7231\u96EA: "\u6B4C\u611B\u30E6\u30AD",
  \u96F7\u7535\u5C06\u519B: "\u96F7\u96FB\u5C06\u8ECD",
  \u96F7\u7535\u5F71: "\u96F7\u96FB\u5F71",
  \u795E\u91CC\u7EEB\u534E: "\u795E\u91CC\u7DBE\u83EF",
  \u67AB\u539F\u4E07\u53F6: "\u6953\u539F\u4E07\u8449",
  \u5BB5\u5BAB: "\u5BB5\u5BAE",
  \u73CA\u745A\u5BAB\u5FC3\u6D77: "\u73CA\u745A\u5BAE\u5FC3\u6D77",
  \u7EB3\u897F\u59B2: "\u30CA\u30D2\u30FC\u30C0",
  \u8299\u5B81\u5A1C: "\u30D5\u30EA\u30FC\u30CA",
  \u90A3\u7EF4\u83B1\u7279: "\u30CC\u30F4\u30A3\u30EC\u30C3\u30C8",
  \u591C\u5170: "\u591C\u862D",
  \u7533\u9E64: "\u7533\u9DB4",
  \u4F18\u83C8: "\u30A8\u30A6\u30EB\u30A2",
  \u53EF\u8389: "\u30AF\u30EC\u30FC",
  \u6E29\u8FEA: "\u30A6\u30A7\u30F3\u30C6\u30A3",
  \u949F\u79BB: "\u937E\u96E2",
  \u8FBE\u8FBE\u5229\u4E9A: "\u30BF\u30EB\u30BF\u30EA\u30E4",
  \u8FEA\u5362\u514B: "\u30C7\u30A3\u30EB\u30C3\u30AF",
  \u83AB\u5A1C: "\u30E2\u30CA",
  \u91CD\u4E91: "\u91CD\u96F2",
  \u73ED\u5C3C\u7279: "\u30D9\u30CD\u30C3\u30C8",
  \u83F2\u8C22\u5C14: "\u30D5\u30A3\u30C3\u30B7\u30E5\u30EB",
  \u8BFA\u827E\u5C14: "\u30CE\u30A8\u30EB",
  \u7802\u7CD6: "\u30B9\u30AF\u30ED\u30FC\u30B9",
  \u7F57\u838E\u8389\u4E9A: "\u30ED\u30B5\u30EA\u30A2",
  \u963F\u8D1D\u591A: "\u30A2\u30EB\u30D9\u30C9",
  \u4E5D\u6761\u88DF\u7F57: "\u4E5D\u6761\u88DF\u7F85",
  \u6258\u9A6C: "\u30C8\u30FC\u30DE",
  \u8352\u6CF7\u4E00\u6597: "\u8352\u7027\u4E00\u6597",
  \u795E\u91CC\u7EEB\u4EBA: "\u795E\u91CC\u7DBE\u4EBA",
  \u63D0\u7EB3\u91CC: "\u30C6\u30A3\u30CA\u30EA",
  \u67EF\u83B1: "\u30B3\u30EC\u30A4",
  \u591A\u8389: "\u30C9\u30EA\u30FC",
  \u8D5B\u8BFA: "\u30BB\u30CE",
  \u59AE\u9732: "\u30CB\u30A3\u30ED\u30A6",
  \u83B1\u4F9D\u62C9: "\u30EC\u30A4\u30E9",
  \u73D0\u9732\u73CA: "\u30D5\u30A1\u30EB\u30B6\u30F3",
  \u8FEA\u5E0C\u96C5: "\u30C7\u30A3\u30B7\u30A2",
  \u827E\u5C14\u6D77\u68EE: "\u30A2\u30EB\u30CF\u30A4\u30BC\u30F3",
  \u7476\u7476: "\u30E8\u30A9\u30FC\u30E8",
  \u5361\u7EF4: "\u30AB\u30FC\u30F4\u30A7",
  \u767D\u672F: "\u767D\u672E",
  \u7433\u59AE\u7279: "\u30EA\u30CD\u30C3\u30C8",
  \u6797\u5C3C: "\u30EA\u30CD",
  \u5A1C\u7EF4\u5A05: "\u30CA\u30F4\u30A3\u30A2",
  \u514B\u6D1B\u7433\u5FB7: "\u30AF\u30ED\u30EA\u30F3\u30C7",
  \u590F\u6D1B\u8482: "\u30B7\u30E3\u30EB\u30ED\u30C3\u30C8",
  \u83B1\u6B27\u65AF\u5229: "\u30EA\u30AA\u30BB\u30B9\u30EA",
  \u4E09\u6708\u4E03: "\u4E09\u6708\u306A\u306E\u304B",
  \u59EC\u5B50: "\u59EB\u5B50",
  \u5E03\u6D1B\u59AE\u5A05: "\u30D6\u30ED\u30FC\u30CB\u30E3",
  \u5E0C\u513F: "\u30BC\u30FC\u30EC",
  \u514B\u62C9\u62C9: "\u30AF\u30E9\u30FC\u30E9",
  \u4F69\u62C9: "\u30DA\u30E9",
  \u6770\u5E15\u5FB7: "\u30B8\u30A7\u30D1\u30FC\u30C9",
  \u5A1C\u5854\u838E: "\u30CA\u30BF\u30FC\u30B7\u30E3",
  \u864E\u514B: "\u30D5\u30C3\u30AF",
  \u5E0C\u9732\u74E6: "\u30BB\u30FC\u30D0\u30EB",
  \u5362\u5361: "\u30EB\u30AB",
  \u505C\u4E91: "\u505C\u96F2",
  \u9A6D\u7A7A: "\u5FA1\u7A7A",
  \u7F57\u5239: "\u7F85\u5239",
  \u5361\u8299\u5361: "\u30AB\u30D5\u30AB",
  \u94F6\u72FC: "\u9280\u72FC",
  \u955C\u6D41: "\u93E1\u6D41",
  \u6258\u5E15: "\u30C8\u30D1\u30FC\u30BA",
  \u85FF\u85FF: "\u970D\u970D",
  \u5BD2\u9E26: "\u5BD2\u9D09",
  \u962E\u6885: "\u30EB\u30A2\u30F3\u30FB\u30E1\u30A4",
  "\u962E\xB7\u6885": "\u30EB\u30A2\u30F3\u30FB\u30E1\u30A4",
  \u7802\u91D1: "\u30A2\u30D9\u30F3\u30C1\u30E5\u30EA\u30F3",
  \u77E5\u66F4\u9E1F: "\u30ED\u30D3\u30F3",
  \u6D41\u8424: "\u30DB\u30BF\u30EB",
  \u7FE1\u7FE0: "\u30B8\u30A7\u30A4\u30C9",
  \u4E91\u7483: "\u96F2\u7483",
  \u98DE\u9704: "\u98DB\u9704",
  \u7075\u7802: "\u970A\u7802",
  \u8C8A\u6CFD: "\u8C8A\u6CA2",
  \u74E6\u5C14\u7279: "\u30F4\u30A7\u30EB\u30C8",
  \u53F2\u74E6\u7F57: "\u30B9\u30F4\u30A1\u30ED\u30FC\u30B0",
  \u963F\u7C73\u5A05: "\u30A2\u30FC\u30DF\u30E4",
  \u51EF\u5C14\u5E0C: "\u30B1\u30EB\u30B7\u30FC",
  \u5FB7\u514B\u8428\u65AF: "\u30C6\u30AD\u30B5\u30B9",
  \u80FD\u5929\u4F7F: "\u30A8\u30AF\u30B7\u30A2",
  \u94F6\u7070: "\u30B7\u30EB\u30D0\u30FC\u30A2\u30C3\u30B7\u30E5",
  \u65AF\u5361\u8482: "\u30B9\u30AB\u30B8",
  \u53F2\u5C14\u7279\u5C14: "\u30B9\u30EB\u30C8",
  \u4F0A\u8299\u5229\u7279: "\u30A4\u30D5\u30EA\u30FC\u30C8",
  \u827E\u96C5\u6CD5\u62C9: "\u30A8\u30A4\u30E4\u30D5\u30A3\u30E4\u30C8\u30E9",
  \u95EA\u7075: "\u30B7\u30E3\u30A4\u30CB\u30F3\u30B0",
  \u591C\u83BA: "\u30CA\u30A4\u30C1\u30F3\u30B2\u30FC\u30EB",
  \u585E\u96F7\u5A05: "\u30B5\u30EA\u30A2",
  \u5B89\u6D01\u8389\u5A1C: "\u30A2\u30F3\u30B8\u30A7\u30EA\u30FC\u30CA",
  \u661F\u718A: "\u30DB\u30B7\u30B0\u30DE",
  \u63A8\u8FDB\u4E4B\u738B: "\u30B7\u30FC\u30B8",
  \u83AB\u65AF\u63D0\u9A6C: "\u30E2\u30B9\u30C6\u30A3\u30DE",
  \u8FF7\u8FED\u9999: "\u30ED\u30FC\u30BA\u30DE\u30EA\u30FC",
  \u6CE5\u5CA9: "\u30DE\u30C9\u30ED\u30C3\u30AF",
  \u91CD\u5CB3: "\u30C1\u30E7\u30F3\u30E6\u30A8",
  \u6843\u91D1\u5A18: "\u30C6\u30F3\u30CB\u30F3\u30AB",
  \u767D\u91D1: "\u30D7\u30E9\u30C1\u30CA",
  \u62C9\u666E\u5170\u5FB7: "\u30E9\u30C3\u30D7\u30E9\u30F3\u30C9",
  \u5E7D\u7075\u9CA8: "\u30B9\u30DA\u30AF\u30BF\u30FC",
  \u4E34\u5149: "\u30CB\u30A2\u30FC\u30EB",
  \u8D6B\u62C9\u683C: "\u30D8\u30E9\u30B0",
  \u963F\u5C14\u6258\u8389\u96C5: "\u30A2\u30EB\u30C8\u30EA\u30A2",
  \u8FDC\u5742\u51DB: "\u9060\u5742\u51DB",
  \u95F4\u6850\u6A31: "\u9593\u6850\u685C",
  \u4F0A\u8389\u96C5: "\u30A4\u30EA\u30E4",
  \u5409\u5C14\u4F3D\u7F8E\u4EC0: "\u30AE\u30EB\u30AC\u30E1\u30C3\u30B7\u30E5",
  \u739B\u4FEE: "\u30DE\u30B7\u30E5",
  \u5C3C\u7984: "\u30CD\u30ED",
  \u7389\u85FB\u524D: "\u7389\u85FB\u306E\u524D",
  \u9152\u541E\u7AE5\u5B50: "\u9152\u5451\u7AE5\u5B50",
  \u6E90\u8D56\u5149: "\u6E90\u983C\u5149",
  \u65AF\u5361\u54C8: "\u30B9\u30AB\u30B5\u30CF",
  \u8D1E\u5FB7: "\u30B8\u30E3\u30F3\u30CC\u30FB\u30C0\u30EB\u30AF",
  \u9ED1\u8D1E: "\u30B8\u30E3\u30F3\u30CC\u30FB\u30AA\u30EB\u30BF",
  \u83AB\u5FB7\u96F7\u5FB7: "\u30E2\u30FC\u30C9\u30EC\u30C3\u30C9",
  \u963F\u6BD4\u76D6\u5C14: "\u30A2\u30D3\u30B2\u30A4\u30EB",
  \u845B\u9970\u5317\u658B: "\u845B\u98FE\u5317\u658E",
  \u6EB6\u89E3\u8389\u8389\u4E1D: "\u30E1\u30EB\u30C8\u30EA\u30EA\u30B9",
  \u7EC7\u7530\u4FE1\u957F: "\u7E54\u7530\u4FE1\u9577",
  \u51B2\u7530\u603B\u53F8: "\u6C96\u7530\u7DCF\u53F8",
  \u571F\u65B9\u5C81\u4E09: "\u571F\u65B9\u6B73\u4E09",
  \u5188\u7530\u4EE5\u85CF: "\u5CA1\u7530\u4EE5\u8535",
  \u6E05\u5C11\u7EB3\u8A00: "\u6E05\u5C11\u7D0D\u8A00",
  \u8FBE\u82AC\u5947: "\u30C0\u30FB\u30F4\u30A3\u30F3\u30C1",
  \u963F\u7F57\u5A1C: "\u30A2\u30ED\u30CA",
  \u767D\u5B50: "\u30B7\u30ED\u30B3",
  \u661F\u91CE: "\u30DB\u30B7\u30CE",
  \u82B9\u9999: "\u30BB\u30EA\u30AB",
  \u91CE\u5BAB: "\u30CE\u30CE\u30DF",
  \u7EEB\u97F3: "\u30A2\u30E4\u30CD",
  \u4F18\u9999: "\u30E6\u30A6\u30AB",
  \u8BFA\u4E9A: "\u30CE\u30A2",
  \u7231\u4E3D\u4E1D: "\u30A2\u30EA\u30B9",
  \u6843\u4E95: "\u30E2\u30E2\u30A4",
  \u67DA\u5B50: "\u30E6\u30BA",
  \u65E5\u5948: "\u30D2\u30CA",
  \u963F\u9732: "\u30A2\u30EB",
  \u7766\u6708: "\u30E0\u30C4\u30AD",
  \u4F73\u4EE3\u5B50: "\u30AB\u30E8\u30B3",
  \u6625\u9999: "\u30CF\u30EB\u30AB",
  \u5C0F\u6625: "\u30B3\u30CF\u30EB",
  \u82B1\u5B50: "\u30CF\u30CA\u30B3",
  \u65E5\u5BCC\u7F8E: "\u30D2\u30D5\u30DF",
  \u767D\u6D32\u6893: "\u767D\u6D32\u30A2\u30BA\u30B5",
  \u7279\u522B\u5468: "\u30B9\u30DA\u30B7\u30E3\u30EB\u30A6\u30A3\u30FC\u30AF",
  \u65E0\u58F0\u94C3\u9E7F: "\u30B5\u30A4\u30EC\u30F3\u30B9\u30B9\u30BA\u30AB",
  \u4E1C\u6D77\u5E1D\u7687: "\u30C8\u30A6\u30AB\u30A4\u30C6\u30A4\u30AA\u30FC",
  \u76EE\u767D\u9EA6\u6606: "\u30E1\u30B8\u30ED\u30DE\u30C3\u30AF\u30A4\u30FC\u30F3",
  \u5C0F\u6817\u5E3D: "\u30AA\u30B0\u30EA\u30AD\u30E3\u30C3\u30D7",
  \u9EC4\u91D1\u8239: "\u30B4\u30FC\u30EB\u30C9\u30B7\u30C3\u30D7",
  \u4F0F\u7279\u52A0: "\u30A6\u30AA\u30C3\u30AB",
  \u5927\u548C\u8D64\u9AA5: "\u30C0\u30A4\u30EF\u30B9\u30AB\u30FC\u30EC\u30C3\u30C8",
  \u8349\u4E0A\u98DE: "\u30B0\u30E9\u30B9\u30EF\u30F3\u30C0\u30FC",
  \u66FC\u57CE\u8336\u5EA7: "\u30DE\u30F3\u30CF\u30C3\u30BF\u30F3\u30AB\u30D5\u30A7",
  \u7C73\u6D74: "\u30E9\u30A4\u30B9\u30B7\u30E3\u30EF\u30FC",
  \u6625\u4E4C\u83C8\u83C8: "\u30CF\u30EB\u30A6\u30E9\u30E9",
  \u8299\u8389\u83B2: "\u30D5\u30EA\u30FC\u30EC\u30F3",
  \u83F2\u4F26: "\u30D5\u30A7\u30EB\u30F3",
  \u963F\u5C3C\u4E9A: "\u30A2\u30FC\u30CB\u30E3",
  \u7EA6\u5C14: "\u30E8\u30EB",
  \u6CF7\u5948: "\u305F\u304D\u306A",
  \u540E\u85E4\u4E00\u91CC: "\u5F8C\u85E4\u3072\u3068\u308A",
  \u5C71\u7530\u51C9: "\u5C71\u7530\u30EA\u30E7\u30A6",
  \u5E73\u6CFD\u552F: "\u5E73\u6CA2\u552F",
  \u96F7\u59C6: "\u30EC\u30E0",
  \u62C9\u59C6: "\u30E9\u30E0",
  \u827E\u7C73\u8389\u5A05: "\u30A8\u30DF\u30EA\u30A2",
  \u660E\u65E5\u9999: "\u30A2\u30B9\u30AB",
  \u7EEB\u6CE2\u4E3D: "\u7DBE\u6CE2\u30EC\u30A4",
  \u5BAB\u6C34\u4E09\u53F6: "\u5BAE\u6C34\u4E09\u8449",
  \u7ACB\u82B1\u6CF7: "\u7ACB\u82B1\u7027",
  \u7076\u95E8\u70AD\u6CBB\u90CE: "\u7AC8\u9580\u70AD\u6CBB\u90CE",
  \u7962\u8C46\u5B50: "\u79B0\u8C46\u5B50",
  \u8774\u8776\u5FCD: "\u80E1\u8776\u3057\u306E\u3076",
  \u9E7F\u76EE\u5706: "\u9E7F\u76EE\u307E\u3069\u304B",
  \u6653\u7F8E\u7130: "\u6681\u7F8E\u307B\u3080\u3089",
  \u7F8E\u6811\u6C99\u8036\u9999: "\u7F8E\u6A39\u3055\u3084\u304B",
  \u5DF4\u9EBB\u7F8E: "\u5DF4\u30DE\u30DF",
  \u4F50\u4ED3\u674F\u5B50: "\u4F50\u5009\u674F\u5B50",
  \u56DB\u5BAB\u8F89\u591C: "\u56DB\u5BAE\u304B\u3050\u3084",
  \u4F0A\u4E95\u91CE\u5F25\u5B50: "\u4F0A\u4E95\u91CE\u30DF\u30B3",
  \u4E2D\u91CE\u56DB\u53F6: "\u4E2D\u91CE\u56DB\u8449",
  \u96EA\u4E4B\u4E0B\u96EA\u4E43: "\u96EA\u30CE\u4E0B\u96EA\u4E43",
  \u7531\u6BD4\u6EE8\u7ED3\u8863: "\u7531\u6BD4\u30F6\u6D5C\u7D50\u8863",
  \u4E00\u8272\u5F69\u7FBD: "\u4E00\u8272\u3044\u308D\u306F",
  \u52A0\u85E4\u60E0: "\u52A0\u85E4\u6075",
  \u971E\u4E4B\u4E18\u8BD7\u7FBD: "\u971E\u30F6\u4E18\u8A69\u7FBD",
  \u4E94\u66F4\u7409\u7483: "\u4E94\u66F4\u7460\u7483",
  \u65B0\u57A3\u7EEB\u6FD1: "\u65B0\u57A3\u3042\u3084\u305B",
  \u767D\u4E95\u9ED1\u5B50: "\u767D\u4E95\u9ED2\u5B50",
  \u65F6\u5D0E\u72C2\u4E09: "\u6642\u5D0E\u72C2\u4E09",
  \u4E9A\u4E1D\u5A1C: "\u30A2\u30B9\u30CA",
  \u7ED3\u57CE\u660E\u65E5\u5948: "\u7D50\u57CE\u660E\u65E5\u5948",
  \u6850\u8C37\u548C\u4EBA: "\u6850\u30F6\u8C37\u548C\u4EBA",
  \u8D6B\u65AF\u7F07\u96C5: "\u30D8\u30B9\u30C6\u30A3\u30A2"
};

// packages/legacy-core/vendor/trigger.js
var trigger_exports = {};
__export(trigger_exports, {
  DEFAULT_REPLY: () => DEFAULT_REPLY,
  DEFAULT_TRIGGER: () => DEFAULT_TRIGGER,
  RULE_LIMITS: () => RULE_LIMITS,
  clampProb: () => clampProb,
  effectiveReplyPolicy: () => effectiveReplyPolicy,
  effectiveTrigger: () => effectiveTrigger,
  isPeakWindow: () => isPeakWindow,
  isoWeekday: () => isoWeekday,
  keywordRulesFor: () => keywordRulesFor,
  legacyFromReply: () => legacyFromReply,
  legacyFromTrigger: () => legacyFromTrigger,
  matchKeywordRules: () => matchKeywordRules,
  normalizeKeywordRules: () => normalizeKeywordRules,
  normalizeReply: () => normalizeReply,
  normalizeTrigger: () => normalizeTrigger,
  peakReplyFor: () => peakReplyFor,
  probabilityFromTier: () => probabilityFromTier,
  replyFromLegacy: () => replyFromLegacy,
  replyFromTier: () => replyFromTier,
  replyFromTrigger: () => replyFromTrigger,
  replyPolicyForStore: () => replyPolicyForStore,
  resolvePeakSliderPos: () => resolvePeakSliderPos,
  triggerForStore: () => triggerForStore,
  triggerFromTier: () => triggerFromTier
});

// packages/legacy-core/vendor/tier-slider.js
var TIER_SLIDER_BANDS = {
  tier1End: 10,
  // 0~10  → 1 档
  tier2End: 20,
  // 10~20 → 2 档
  tier3End: 90
  // 20~90 → 3 档；90~100 → 4 档
};
function sliderToTier(pos) {
  const b = TIER_SLIDER_BANDS;
  const raw = Number(pos);
  if (!Number.isFinite(raw)) return { tier: 4, randomPercent: 100 };
  const p = Math.min(100, Math.max(0, raw));
  if (p <= b.tier1End) return { tier: 1, randomPercent: 0 };
  if (p <= b.tier2End) return { tier: 2, randomPercent: 0 };
  if (p <= b.tier3End) {
    const pct = (p - b.tier2End) / (b.tier3End - b.tier2End) * 100;
    return { tier: 3, randomPercent: Math.round(pct * 10) / 10 };
  }
  return { tier: 4, randomPercent: 100 };
}
function tierToSlider(tier, randomPercent = 0) {
  const b = TIER_SLIDER_BANDS;
  const t = Math.min(4, Math.max(1, Number(tier) || 4));
  const pct = Math.min(100, Math.max(0, Number(randomPercent) || 0));
  if (t === 1) return Math.round(b.tier1End / 2);
  if (t === 2) return Math.round((b.tier1End + b.tier2End) / 2);
  if (t === 3) return Math.round(b.tier2End + pct / 100 * (b.tier3End - b.tier2End));
  return Math.round((b.tier3End + 100) / 2);
}

// packages/legacy-core/vendor/trigger.js
var RULE_LIMITS = Object.freeze({
  maxRules: 50,
  maxPattern: 200,
  maxMatchText: 2e3
});
var DEFAULT_REPLY = Object.freeze({
  private: Object.freeze({ probability: 100 }),
  mention: Object.freeze({ enabled: true, probability: 100 }),
  keyword: Object.freeze({ enabled: true, probability: 100 }),
  other: Object.freeze({ enabled: true, probability: 100 })
});
var DEFAULT_TRIGGER = Object.freeze({ mention: true, keyword: false, all: false });
var round2 = (n) => Math.round(n * 100) / 100;
var clampProb = (v, fallback = 100) => {
  const raw = v === null || v === void 0 || v === "" ? fallback : v;
  const n = Number(raw);
  const base = Number.isFinite(n) ? n : Number(fallback);
  const safe = Number.isFinite(base) ? base : 100;
  return round2(Math.min(100, Math.max(0, safe)));
};
function normalizeTrigger(input) {
  const t = input && typeof input === "object" ? input : {};
  const mention = t.mention === true;
  const keyword = t.keyword === true;
  const all = t.all === true;
  if (all) return { mention: false, keyword: false, all: true };
  if (!mention && !keyword) return { mention: true, keyword: false, all: false };
  return { mention: true, keyword, all: false };
}
function triggerFromTier(tier, _randomPercent = 0) {
  const t = Number(tier);
  if (!Number.isFinite(t) || t >= 4) return { mention: false, keyword: false, all: true };
  if (t <= 1) return { mention: true, keyword: false, all: false };
  return { mention: true, keyword: true, all: false };
}
function probabilityFromTier(tier, randomPercent = 0) {
  const t = Number(tier);
  if (t === 3) return clampProb(randomPercent);
  return 100;
}
function legacyFromTrigger(triggerInput, probability = 100) {
  const trigger = normalizeTrigger(triggerInput);
  const prob = clampProb(probability);
  const tier = trigger.all ? 4 : trigger.keyword ? 2 : 1;
  return {
    contextTier: tier,
    randomPercent: prob,
    contextSliderPos: tierToSlider(tier, prob)
  };
}
var isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
var channelEnabled = (v, fallback) => {
  if (!isObj(v)) return fallback;
  return v.enabled !== false;
};
var channelProb = (v, fallback = 100) => {
  if (!isObj(v)) return clampProb(fallback);
  return clampProb(v.probability ?? fallback);
};
function normalizeReply(input) {
  const r = isObj(input) ? input : {};
  return {
    private: { probability: channelProb(r.private, 100) },
    mention: { enabled: channelEnabled(r.mention, true), probability: channelProb(r.mention, 100) },
    keyword: { enabled: channelEnabled(r.keyword, true), probability: channelProb(r.keyword, 100) },
    other: { enabled: channelEnabled(r.other, true), probability: channelProb(r.other, 100) }
  };
}
function replyFromTrigger(triggerInput, probability = 100) {
  const t = normalizeTrigger(triggerInput);
  const p = clampProb(probability);
  return {
    private: { probability: 100 },
    mention: { enabled: t.mention, probability: p },
    keyword: { enabled: t.keyword, probability: p },
    other: { enabled: t.all, probability: p }
  };
}
function replyFromTier(tier, randomPercent = 0) {
  const t = Number(tier);
  const on = () => ({ enabled: true, probability: 100 });
  const off = () => ({ enabled: false, probability: 100 });
  const base = { private: { probability: 100 } };
  if (!Number.isFinite(t) || t >= 4) {
    return { ...base, mention: on(), keyword: on(), other: { enabled: true, probability: 100 } };
  }
  if (t <= 1) return { ...base, mention: on(), keyword: off(), other: off() };
  if (t <= 2) return { ...base, mention: on(), keyword: on(), other: off() };
  return { ...base, mention: on(), keyword: on(), other: { enabled: true, probability: clampProb(randomPercent) } };
}
function replyFromLegacy(store = {}) {
  if (!isObj(store)) return null;
  if (isObj(store.trigger)) return replyFromTrigger(store.trigger, store.replyProbability ?? 100);
  if (Number.isFinite(Number(store.contextSliderPos))) {
    const { tier, randomPercent } = sliderToTier(Number(store.contextSliderPos));
    return replyFromTier(tier, randomPercent);
  }
  if (Number.isFinite(Number(store.contextTier))) {
    const tier = Math.min(4, Math.max(1, Math.round(Number(store.contextTier))));
    const rp = store.randomPercent !== void 0 && store.randomPercent !== null ? store.randomPercent : 10;
    return replyFromTier(tier, rp);
  }
  return null;
}
function legacyFromReply(input) {
  const r = normalizeReply(input);
  const tier = r.other.enabled ? r.other.probability >= 100 ? 4 : 3 : r.keyword.enabled ? 2 : 1;
  return {
    trigger: { mention: r.mention.enabled, keyword: r.keyword.enabled, all: r.other.enabled },
    replyProbability: r.mention.probability,
    contextTier: tier,
    randomPercent: r.other.probability,
    contextSliderPos: tierToSlider(tier, r.other.probability)
  };
}
var ruleSeq = 0;
var newRuleId = () => `k_${Date.now().toString(36)}${(ruleSeq++).toString(36)}`;
var cleanId = (v) => {
  const s = String(v ?? "").trim();
  return /^[A-Za-z0-9_-]{1,32}$/.test(s) ? s : "";
};
var regexCache = /* @__PURE__ */ new Map();
function regexFor(pattern, flags = "i") {
  const key = `${String(pattern ?? "")}\0${String(flags ?? "")}`;
  if (regexCache.has(key)) return regexCache.get(key);
  let re = null;
  try {
    re = new RegExp(String(pattern ?? ""), String(flags ?? ""));
  } catch {
    re = null;
  }
  if (regexCache.size > 200) regexCache.clear();
  regexCache.set(key, re);
  return re;
}
var RULE_FLAGS_ORDER = "dgimsuvy";
var RULE_FLAGS_RE = new RegExp(`^[${RULE_FLAGS_ORDER}]*$`);
function normalizeFlags(raw, { mode, strict, index }) {
  if (mode !== "regex") return "";
  const text = raw === void 0 || raw === null ? "i" : String(raw).trim();
  const flags = text === "" ? "" : [...new Set(text)].join("");
  if (!RULE_FLAGS_RE.test(flags)) {
    if (strict) throw ruleError(index, `\u6B63\u5219\u6807\u5FD7\u4F4D\u4E0D\u5408\u6CD5\uFF08\u53EA\u5141\u8BB8 ${RULE_FLAGS_ORDER} \u4E2D\u7684\u5B57\u7B26\uFF09\uFF1A${text}`);
    return null;
  }
  return [...flags].sort((a, b) => RULE_FLAGS_ORDER.indexOf(a) - RULE_FLAGS_ORDER.indexOf(b)).join("");
}
function looksDangerous(pattern) {
  const p = String(pattern ?? "");
  return [
    /\((?:[^()]*[+*][^()]*)\)[+*{]/,
    /\((?:[^()]*\|[^()]*)\)[+*{]/,
    /(?:\.\*){2,}/,
    /(?:\.\+){2,}/
  ].some((re) => re.test(p));
}
var ruleError = (index, msg) => new Error(`\u5173\u952E\u8BCD\u89C4\u5219\u7B2C ${index + 1} \u6761\uFF1A${msg}`);
function normalizeKeywordRules(input, { strict = false } = {}) {
  const list = Array.isArray(input) ? input : [];
  if (strict && list.length > RULE_LIMITS.maxRules) {
    throw new Error(`\u5173\u952E\u8BCD\u89C4\u5219\u6700\u591A ${RULE_LIMITS.maxRules} \u6761\uFF08\u5F53\u524D ${list.length} \u6761\uFF09`);
  }
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    const obj = typeof raw === "string" ? { pattern: raw, mode: "plain", probability: null, enabled: true } : isObj(raw) ? raw : null;
    if (!obj) {
      if (strict) throw ruleError(i, "\u4E0D\u662F\u6709\u6548\u7684\u89C4\u5219\u5BF9\u8C61");
      continue;
    }
    const pattern = String(obj.pattern ?? "").trim();
    if (!pattern) {
      if (strict) throw ruleError(i, "\u89C4\u5219\u4E0D\u80FD\u4E3A\u7A7A");
      continue;
    }
    if (pattern.length > RULE_LIMITS.maxPattern) {
      if (strict) throw ruleError(i, `\u89C4\u5219\u8D85\u8FC7 ${RULE_LIMITS.maxPattern} \u5B57`);
      continue;
    }
    const mode = obj.mode === "regex" ? "regex" : "plain";
    const flags = normalizeFlags(obj.flags, { mode, strict, index: i });
    if (flags === null) continue;
    let probability = null;
    if (obj.probability !== null && obj.probability !== void 0 && obj.probability !== "") {
      const n = Number(obj.probability);
      if (!Number.isFinite(n)) {
        if (strict) throw ruleError(i, "\u6982\u7387\u5FC5\u987B\u662F 0~100 \u7684\u6570\u5B57");
      } else {
        probability = clampProb(n);
      }
    }
    if (mode === "regex") {
      let compiled = null;
      try {
        compiled = new RegExp(pattern, flags);
      } catch {
        compiled = null;
      }
      if (!compiled) {
        if (strict) throw ruleError(i, `\u6B63\u5219\u8868\u8FBE\u5F0F\u4E0D\u5408\u6CD5\uFF08\u6807\u5FD7\u4F4D ${flags || "\u65E0"}\uFF09`);
        continue;
      }
      if (looksDangerous(pattern)) {
        if (strict) throw ruleError(i, "\u6B63\u5219\u5305\u542B\u53EF\u80FD\u5BFC\u81F4\u707E\u96BE\u6027\u56DE\u6EAF\u7684\u5D4C\u5957\u91CF\u8BCD\uFF0C\u8BF7\u7B80\u5316");
        continue;
      }
    }
    const key = `${mode}:${flags}:${mode === "plain" ? pattern.toLowerCase() : pattern}`;
    if (seen.has(key)) {
      if (strict) throw ruleError(i, "\u4E0E\u524D\u9762\u7684\u89C4\u5219\u91CD\u590D");
      continue;
    }
    seen.add(key);
    out.push({
      id: cleanId(obj.id) || newRuleId(),
      pattern,
      mode,
      flags,
      probability,
      enabled: obj.enabled !== false
    });
    if (out.length >= RULE_LIMITS.maxRules) break;
  }
  return out;
}
function keywordRulesFor(store = {}) {
  const s = isObj(store) ? store : {};
  if (Array.isArray(s.keywordRules)) return normalizeKeywordRules(s.keywordRules);
  if (Array.isArray(s.keywords)) return normalizeKeywordRules(s.keywords);
  return [];
}
function matchKeywordRules(text, rules, defaultProbability = 100) {
  const hay = String(text ?? "").slice(0, RULE_LIMITS.maxMatchText);
  if (!hay) return null;
  const lower = hay.toLowerCase();
  const fallback = clampProb(defaultProbability);
  let best = null;
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!rule || rule.enabled === false) continue;
    const mode = rule.mode === "regex" ? "regex" : "plain";
    let hit = false;
    if (mode === "regex") {
      const re = regexFor(rule.pattern, rule.flags ?? "i");
      if (re) re.lastIndex = 0;
      hit = Boolean(re) && re.test(hay);
    } else {
      hit = lower.includes(String(rule.pattern ?? "").toLowerCase());
    }
    if (!hit) continue;
    const probability = rule.probability === null || rule.probability === void 0 ? fallback : clampProb(rule.probability);
    if (!best || probability > best.probability) best = { rule, probability, mode };
    if (probability >= 100) break;
  }
  return best;
}
function replyPolicyForStore(store = {}) {
  const hasReply = isObj(store) && isObj(store.reply);
  const reply = hasReply ? normalizeReply(store.reply) : replyFromLegacy(store) || normalizeReply(DEFAULT_REPLY);
  return { reply, rules: keywordRulesFor(store), legacy: !hasReply };
}
function peakReplyFor(peak) {
  if (!isObj(peak)) return null;
  if (isObj(peak.reply)) return normalizeReply(peak.reply);
  if (isObj(peak.trigger)) return replyFromTrigger(peak.trigger, peak.probability ?? 100);
  if (Number.isFinite(Number(peak.sliderPos))) {
    const { tier, randomPercent } = sliderToTier(Number(peak.sliderPos));
    return replyFromTier(tier, randomPercent);
  }
  return null;
}
function effectiveReplyPolicy(store = {}, at = /* @__PURE__ */ new Date()) {
  const base = replyPolicyForStore(store);
  const ps = store?.peakSchedule;
  if (isPeakWindow(ps, at)) {
    const peakReply = peakReplyFor(ps.peak);
    if (peakReply) {
      return {
        reply: { ...peakReply, private: base.reply.private },
        rules: base.rules,
        peak: true,
        legacy: base.legacy || !isObj(ps.peak?.reply)
      };
    }
  }
  return { ...base, peak: false };
}
function effectiveTrigger(store = {}, at = /* @__PURE__ */ new Date()) {
  const policy = effectiveReplyPolicy(store, at);
  const r = policy.reply;
  const probability = r.other.enabled ? r.other.probability : r.keyword.enabled ? r.keyword.probability : r.mention.probability;
  return {
    trigger: { mention: r.mention.enabled, keyword: r.keyword.enabled, all: r.other.enabled },
    probability,
    peak: policy.peak,
    legacy: policy.legacy
  };
}
function triggerForStore(store = {}) {
  const policy = replyPolicyForStore(store);
  const r = policy.reply;
  return {
    trigger: { mention: r.mention.enabled, keyword: r.keyword.enabled, all: r.other.enabled },
    probability: r.other.enabled ? r.other.probability : r.keyword.enabled ? r.keyword.probability : r.mention.probability,
    legacy: policy.legacy
  };
}
function isoWeekday(date = /* @__PURE__ */ new Date()) {
  const d = date.getDay();
  return d === 0 ? 7 : d;
}
function normalizeWeekdays(list) {
  if (!Array.isArray(list)) return [];
  const out = [...new Set(list.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))];
  return out.sort((a, b) => a - b);
}
function parseHHMM(raw) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
function isPeakWindow(ps, at = /* @__PURE__ */ new Date()) {
  if (!ps || ps.enabled !== true) return false;
  const start = parseHHMM(ps?.peak?.start);
  const end = parseHHMM(ps?.peak?.end);
  if (start === null || end === null || start === end) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  const days = normalizeWeekdays(ps.weekdays);
  if (!days.length) return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  if (start < end) {
    if (minutes < start || minutes >= end) return false;
    return days.includes(isoWeekday(at));
  }
  if (minutes < end) {
    const prev = new Date(at.getTime() - 24 * 3600 * 1e3);
    return days.includes(isoWeekday(prev));
  }
  return minutes >= start && days.includes(isoWeekday(at));
}
function resolvePeakSliderPos(store = {}, at = /* @__PURE__ */ new Date()) {
  const ps = store?.peakSchedule;
  if (!ps || ps.enabled !== true) return null;
  if (!isPeakWindow(ps, at)) return clampSlider(ps.valley?.sliderPos);
  const peak = ps.peak;
  if (isObj(peak?.reply)) return legacyFromReply(peak.reply).contextSliderPos;
  if (isObj(peak?.trigger)) return legacyFromTrigger(peak.trigger, peak.probability).contextSliderPos;
  return clampSlider(peak?.sliderPos);
}
function clampSlider(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 100;
}

// packages/legacy-core/vendor/session-config.js
var session_config_exports = {};
__export(session_config_exports, {
  GLOBAL_ONLY_PATHS: () => GLOBAL_ONLY_PATHS,
  SESSION_API_KEYS: () => SESSION_API_KEYS,
  SESSION_CONFIG_SCHEMA: () => SESSION_CONFIG_SCHEMA,
  SESSION_CONFIG_TOP: () => SESSION_CONFIG_TOP,
  deepClone: () => deepClone,
  diffSessionConfig: () => diffSessionConfig,
  enforceGlobalOnly: () => enforceGlobalOnly,
  fixSessionApiAgainstGlobal: () => fixSessionApiAgainstGlobal,
  getPath: () => getPath,
  normalizeSessionApi: () => normalizeSessionApi,
  normalizeSessionConfig: () => normalizeSessionConfig,
  pickSessionApi: () => pickSessionApi,
  sanitizeSessionConfig: () => sanitizeSessionConfig,
  setPath: () => setPath,
  snapshotSessionConfig: () => snapshotSessionConfig,
  stripSessionSecrets: () => stripSessionSecrets,
  validateSessionApi: () => validateSessionApi
});
var SESSION_CONFIG_SCHEMA = 1;
var SESSION_CONFIG_TOP = Object.freeze([
  "persona",
  "memory",
  "store",
  "tools",
  "skills",
  "proactive",
  "chatActive",
  "availability",
  "sticker",
  "commandMute",
  "blocklist",
  "run",
  "api"
]);
var SESSION_API_KEYS = Object.freeze([
  "model",
  "provider",
  "fallbackModels",
  "visionModel",
  "videoModel",
  "videoMode",
  "vision",
  "video",
  "temperature",
  "maxRounds",
  "timeoutMs",
  "thinkingMode",
  "thinkingEffort",
  "thinkingBudget"
]);
var GLOBAL_ONLY_PATHS = Object.freeze([
  ["snowluma"],
  ["api", "baseUrl"],
  ["api", "apiKey"],
  ["api", "useOfficialPrice"],
  ["api", "priceInputPerM"],
  ["api", "priceOutputPerM"],
  ["api", "priceCachedPerM"],
  ["api", "modelPrices"],
  ["providers"],
  ["providersSourceYaml"],
  ["dshProviderKeys"],
  ["deny"],
  ["globalBlocklist"],
  ["communityExemptions"],
  ["security"],
  ["server"],
  ["ui"],
  ["extensions"],
  ["modelVision"],
  ["acceptAllSessions"],
  ["chatProfiles"],
  ["dispatch"],
  ["maxConcurrentRuns"],
  ["send"],
  ["wakeDelayMs"],
  ["drainDelayMs"],
  ["sessionRetryAttempts"],
  ["persona", "botName"],
  ["persona", "selfNickname"],
  ["store", "keepSessionFiles"],
  ["store", "maxMessagesPerChat"],
  ["commandMute", "active"]
]);
var SECRET_KEY_RE = /^(apiKey|accessToken|httpAccessToken|cookie|password|secret|token|botToken)$/i;
var isPlainObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
var jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function deepClone(v) {
  if (v === void 0) return v;
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}
function getPath(obj, path4) {
  let cur = obj;
  for (const k of path4) {
    if (!cur || typeof cur !== "object") return void 0;
    cur = cur[k];
  }
  return cur;
}
function setPath(obj, path4, value) {
  let cur = obj;
  for (let i = 0; i < path4.length - 1; i += 1) {
    const k = path4[i];
    if (!cur[k] || typeof cur[k] !== "object" || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k];
  }
  const last = path4[path4.length - 1];
  if (value === void 0) delete cur[last];
  else cur[last] = value;
}
function stripSessionSecrets(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    for (const item of node) stripSessionSecrets(item);
    return node;
  }
  for (const key of Object.keys(node)) {
    if (SECRET_KEY_RE.test(key) || /^has[A-Z][A-Za-z0-9]*$/.test(key) || key === "dshProviderKeyPresence") {
      delete node[key];
      continue;
    }
    stripSessionSecrets(node[key]);
  }
  return node;
}
function pickSessionApi(api) {
  if (!isPlainObj(api)) return void 0;
  const out = {};
  for (const key of SESSION_API_KEYS) {
    if (api[key] !== void 0) out[key] = deepClone(api[key]);
  }
  return out;
}
var PROTECTED_SUBPATHS = [
  ["persona", "botName"],
  ["persona", "selfNickname"],
  // 人设正文只存在人设库里，按 personaId 实时解析；会话文件再存一份副本只会漂移。
  ["persona", "roleText"],
  ["persona", "systemPromptOverride"],
  ["store", "keepSessionFiles"],
  ["store", "maxMessagesPerChat"],
  ["commandMute", "active"]
];
function deleteProtected(out) {
  for (const path4 of PROTECTED_SUBPATHS) {
    const parent = getPath(out, path4.slice(0, -1));
    if (!isPlainObj(parent)) continue;
    delete parent[path4[path4.length - 1]];
  }
}
function sanitizeSessionConfig(input) {
  if (!isPlainObj(input)) return {};
  const out = {};
  for (const top of SESSION_CONFIG_TOP) {
    if (input[top] === void 0) continue;
    out[top] = deepClone(input[top]);
  }
  if (out.api !== void 0) {
    const api = pickSessionApi(out.api);
    if (api && Object.keys(api).length) out.api = api;
    else delete out.api;
  }
  deleteProtected(out);
  return stripSessionSecrets(out);
}
function snapshotSessionConfig(globalCfg) {
  const global = isPlainObj(globalCfg) ? globalCfg : {};
  const out = {};
  for (const top of SESSION_CONFIG_TOP) {
    if (global[top] === void 0) continue;
    out[top] = deepClone(global[top]);
  }
  if (global.api !== void 0) {
    const api = pickSessionApi(global.api);
    if (api && Object.keys(api).length) out.api = api;
    else delete out.api;
  }
  deleteProtected(out);
  return stripSessionSecrets(out);
}
var clampNum = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
var MODEL_MAX = 200;
function normalizeSessionApi(api) {
  if (!isPlainObj(api)) return void 0;
  const out = pickSessionApi(api) || {};
  out.model = String(out.model ?? "").trim().slice(0, MODEL_MAX);
  out.provider = String(out.provider ?? "").trim().slice(0, 120);
  out.visionModel = String(out.visionModel ?? "").trim().slice(0, MODEL_MAX);
  out.videoModel = String(out.videoModel ?? "").trim().slice(0, MODEL_MAX);
  out.videoMode = ["auto", "native", "frames", "off"].includes(out.videoMode) ? out.videoMode : "auto";
  out.vision = out.vision !== false;
  out.video = out.video === true;
  out.temperature = clampNum(out.temperature, 0, 2, 0.8);
  out.maxRounds = Math.round(clampNum(out.maxRounds, 1, 40, 12));
  out.timeoutMs = Math.round(clampNum(out.timeoutMs, 5e3, 36e5, 18e4));
  out.thinkingMode = ["auto", "on", "off"].includes(out.thinkingMode) ? out.thinkingMode : "auto";
  out.thinkingEffort = ["", "off", "low", "medium", "high", "xhigh", "max"].includes(String(out.thinkingEffort ?? "")) ? String(out.thinkingEffort ?? "") : "";
  out.thinkingBudget = Math.round(clampNum(out.thinkingBudget, 0, 2e5, 0));
  const list = [];
  for (const raw of Array.isArray(out.fallbackModels) ? out.fallbackModels : []) {
    const model = String(raw?.model ?? "").trim().slice(0, MODEL_MAX);
    if (!model) continue;
    const provider = String(raw?.provider ?? "").trim().slice(0, 120);
    list.push(provider ? { model, provider } : { model });
    if (list.length >= 10) break;
  }
  out.fallbackModels = list;
  return out;
}
function normalizeSessionConfig(config, { storePatch = null } = {}) {
  const out = sanitizeSessionConfig(config);
  if (out.api !== void 0) out.api = normalizeSessionApi(out.api);
  if (isPlainObj(out.store)) normalizeStoreInPlace(out.store, isPlainObj(storePatch) ? storePatch : null);
  return out;
}
function normalizeStoreInPlace(store, patchStore = null) {
  const has = (k) => Boolean(patchStore) && Object.prototype.hasOwnProperty.call(patchStore, k);
  if (has("reply")) {
    store.reply = normalizeReply(store.reply);
  } else if (has("contextSliderPos")) {
    const { tier, randomPercent } = sliderToTier(Number(store.contextSliderPos));
    store.reply = replyFromTier(tier, randomPercent);
  } else if (has("trigger") || has("replyProbability")) {
    const derived = replyFromLegacy({ trigger: store.trigger, replyProbability: store.replyProbability });
    if (derived) store.reply = derived;
  } else if (has("contextTier") || has("randomPercent")) {
    store.reply = replyFromTier(store.contextTier, store.randomPercent);
  } else if (isPlainObj(store.reply)) {
    store.reply = normalizeReply(store.reply);
  } else {
    const legacy = replyFromLegacy(store);
    if (legacy) store.reply = legacy;
  }
  if (Array.isArray(store.keywordRules) && (!patchStore || has("keywordRules") || !has("keywords"))) {
    store.keywordRules = normalizeKeywordRules(store.keywordRules);
  } else if (Array.isArray(store.keywords) && store.keywords.length) {
    store.keywordRules = normalizeKeywordRules(store.keywords);
  }
  const peak = store.peakSchedule?.peak;
  if (isPlainObj(peak)) {
    const patchPeak = isPlainObj(patchStore?.peakSchedule?.peak) ? patchStore.peakSchedule.peak : null;
    const patchTouchesPeakLegacy = Boolean(patchPeak) && ("trigger" in patchPeak || "sliderPos" in patchPeak || "probability" in patchPeak);
    if (isPlainObj(peak.reply) && (!patchTouchesPeakLegacy || isPlainObj(patchPeak?.reply))) {
      peak.reply = normalizeReply(peak.reply);
    } else {
      const derived = peakReplyFor(peak);
      if (derived) peak.reply = derived;
    }
  }
}
function diffSessionConfig(config, globalCfg) {
  const diff = diffNode(isPlainObj(config) ? config : {}, isPlainObj(globalCfg) ? globalCfg : {});
  return diff === void 0 ? {} : diff;
}
function diffNode(node, def) {
  if (!isPlainObj(node)) {
    return jsonEq(node, def) ? void 0 : deepClone(node);
  }
  const out = {};
  let any = false;
  for (const [key, value] of Object.entries(node)) {
    const dv = isPlainObj(def) ? def[key] : void 0;
    if (isPlainObj(value) && isPlainObj(dv)) {
      const sub = diffNode(value, dv);
      if (sub === void 0) continue;
      out[key] = sub;
      any = true;
      continue;
    }
    if (jsonEq(value, dv)) continue;
    out[key] = deepClone(value);
    any = true;
  }
  return any ? out : void 0;
}
function enforceGlobalOnly(merged, globalCfg) {
  const global = isPlainObj(globalCfg) ? globalCfg : {};
  for (const path4 of GLOBAL_ONLY_PATHS) {
    const gv = getPath(global, path4);
    setPath(merged, path4, gv === void 0 ? void 0 : deepClone(gv));
  }
  return stripSessionSecrets(merged);
}
function validateSessionApi(config, globalCfg) {
  const problems = [];
  const api = isPlainObj(config?.api) ? config.api : null;
  if (!api) return problems;
  const providers = Array.isArray(globalCfg?.providers) ? globalCfg.providers : [];
  const has = (pid) => providers.some((p) => String(p?.id ?? "") === pid);
  if (api.provider && !has(String(api.provider))) problems.push(`\u63D0\u4F9B\u5546\u4E0D\u5B58\u5728\uFF1A${api.provider}`);
  for (const fb of Array.isArray(api.fallbackModels) ? api.fallbackModels : []) {
    const pid = String(fb?.provider ?? "");
    if (pid && !has(pid)) problems.push(`\u5907\u9009\u6A21\u578B\u7684\u63D0\u4F9B\u5546\u4E0D\u5B58\u5728\uFF1A${pid}`);
  }
  return problems;
}
function fixSessionApiAgainstGlobal(merged, globalCfg) {
  if (!isPlainObj(merged?.api)) return false;
  const globalApi = isPlainObj(globalCfg?.api) ? globalCfg.api : {};
  const providers = Array.isArray(globalCfg?.providers) ? globalCfg.providers : [];
  let fixed = false;
  const pid = String(merged.api.provider ?? "").trim();
  if (pid && !providers.some((p) => String(p?.id ?? "") === pid)) {
    merged.api.provider = String(globalApi.provider ?? "");
    merged.api.model = String(globalApi.model ?? "");
    merged.api.visionModel = String(globalApi.visionModel ?? "");
    merged.api.videoModel = String(globalApi.videoModel ?? "");
    fixed = true;
  }
  if (!String(merged.api.model ?? "").trim()) {
    const gm = String(globalApi.model ?? "");
    if (gm) {
      merged.api.model = gm;
      if (!merged.api.provider) merged.api.provider = String(globalApi.provider ?? "");
      fixed = true;
    }
  }
  if (Array.isArray(merged.api.fallbackModels)) {
    const kept = merged.api.fallbackModels.filter((fb) => {
      const p = String(fb?.provider ?? "");
      return !p || providers.some((x) => String(x?.id ?? "") === p);
    });
    if (kept.length !== merged.api.fallbackModels.length) {
      merged.api.fallbackModels = kept;
      fixed = true;
    }
  }
  return fixed;
}

// packages/legacy-core/vendor/silence-policy.js
var silence_policy_exports = {};
__export(silence_policy_exports, {
  SILENCE_KIND_META: () => SILENCE_KIND_META,
  defaultSilencePolicy: () => defaultSilencePolicy,
  normalizeSilencePolicy: () => normalizeSilencePolicy,
  nudgesFor: () => nudgesFor,
  silenceReasonOf: () => silenceReasonOf
});
var MODES = ["enforce", "record", "off"];
var CAUSES = ["no-output", "max-rounds", "nudge-failed"];
function defaultSilencePolicy(mode = "enforce", { maxNudges = 3 } = {}) {
  const m = MODES.includes(mode) ? mode : "enforce";
  const nudgeCap = Math.max(0, Math.min(3, Math.floor(Number(maxNudges) || 0)));
  return {
    requireDisposition: m !== "off",
    maxNudges: m === "record" ? 0 : nudgeCap,
    // 主动机会（冷场开话题）：默认不追问 —— 没找到话题就安静结束是常态，
    // 每次追问都是约 17k token 的一整轮调用。
    proactiveMaxNudges: 0,
    requireSpeak: false,
    nudgeText: "",
    fallback: m === "off" ? "off" : "synthesize",
    source: "core"
  };
}
function normalizeSilencePolicy(raw, { mode = "enforce", source = "core", maxNudges } = {}) {
  const out = defaultSilencePolicy(mode, { maxNudges });
  if (source && source !== "core") out.source = String(source);
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.requireDisposition === "boolean") out.requireDisposition = raw.requireDisposition;
  if (Number.isFinite(Number(raw.maxNudges))) {
    out.maxNudges = Math.max(0, Math.min(3, Math.floor(Number(raw.maxNudges))));
  }
  if (Number.isFinite(Number(raw.proactiveMaxNudges))) {
    out.proactiveMaxNudges = Math.max(0, Math.min(3, Math.floor(Number(raw.proactiveMaxNudges))));
  }
  if (typeof raw.requireSpeak === "boolean") out.requireSpeak = raw.requireSpeak;
  if (typeof raw.nudgeText === "string" && raw.nudgeText.trim()) {
    out.nudgeText = raw.nudgeText.trim().slice(0, 1200);
  }
  if (raw.fallback === "off" || raw.fallback === "synthesize") out.fallback = raw.fallback;
  return out;
}
function nudgesFor(policy, proactive) {
  const n = Number(proactive ? policy?.proactiveMaxNudges : policy?.maxNudges);
  return Math.max(0, Math.min(3, Number.isFinite(n) ? Math.floor(n) : 0));
}
function silenceReasonOf({ messages = [], cause = "no-output", enforced = false } = {}) {
  const text = (Array.isArray(messages) ? messages : []).filter((m) => m && m.role === "assistant" && !m.nudgeRound).map((m) => String(m.content || "")).join("").trim();
  const head = text ? `\uFF08\u5185\u90E8\u8F93\u51FA ${text.length} \u5B57\uFF0C\u5F00\u5934\uFF1A\u300C${text.slice(0, 60).replace(/\s+/g, " ")}\u300D\uFF09` : "";
  const reason = CAUSES.includes(cause) ? cause : "no-output";
  if (reason === "max-rounds") return `\u6CA1\u6709\u53D1\u8A00\uFF0C\u4E5F\u6CA1\u7ED9\u51FA\u7406\u7531\uFF1A\u5DE5\u5177\u8F6E\u6B21\u8017\u5C3D${head}`;
  if (reason === "nudge-failed") return `\u6CA1\u6709\u53D1\u8A00\uFF0C\u4E5F\u6CA1\u7ED9\u51FA\u7406\u7531\uFF1A\u7CFB\u7EDF\u8FFD\u95EE\u65F6\u8C03\u7528\u5931\u8D25${head}`;
  if (enforced) return `\u6CA1\u6709\u53D1\u8A00\uFF0C\u4E5F\u6CA1\u7ED9\u51FA\u7406\u7531\uFF1A\u7CFB\u7EDF\u8FFD\u95EE\u8FC7\uFF0C\u6A21\u578B\u4ECD\u672A\u8868\u6001${head}`;
  return `\u6CA1\u6709\u53D1\u8A00\uFF0C\u4E5F\u6CA1\u7ED9\u51FA\u7406\u7531\uFF1A\u6A21\u578B\u6CA1\u6709\u8C03\u7528\u4EFB\u4F55\u5DE5\u5177\u5C31\u7ED3\u675F\u4E86${head}`;
}
var SILENCE_KIND_META = {
  stop: { icon: "\u{1F3C1}", title: "\u6A21\u578B\u51B3\u5B9A\u4E0D\u56DE\u590D" },
  silent: { icon: "\u{1F910}", title: "\u6CA1\u6709\u53D1\u8A00\uFF0C\u4E5F\u6CA1\u7ED9\u51FA\u7406\u7531" },
  "no-output": { icon: "\u{1F910}", title: "\u6CA1\u6709\u53D1\u8A00\uFF0C\u4E5F\u6CA1\u7ED9\u51FA\u7406\u7531" },
  "max-rounds": { icon: "\u23F1", title: "\u6CA1\u6709\u53D1\u8A00\uFF0C\u4E5F\u6CA1\u7ED9\u51FA\u7406\u7531" },
  timeout: { icon: "\u231B", title: "\u5904\u7406\u8D85\u65F6\u5DF2\u4E2D\u6B62" },
  error: { icon: "\u26A0", title: "\u8FD0\u884C\u51FA\u9519" },
  // 模型坚称"我发过了"，但本次运行没有任何实际外发；与"决定不回复"是两回事。
  unsent: { icon: "\u26A0", title: "\u6A21\u578B\u8BF4\u53D1\u4E86\uFF0C\u5B9E\u9645\u6CA1\u53D1\u51FA" },
  spoken: { icon: "\u{1F4AC}", title: "\u5DF2\u53D1\u8A00" }
};

// packages/legacy-core/vendor/web-search.js
var web_search_exports = {};
__export(web_search_exports, {
  baiduImageSearch: () => baiduImageSearch,
  baiduSearch: () => baiduSearch,
  bingImageSearch: () => bingImageSearch,
  bingSearch: () => bingSearch,
  bochaSearch: () => bochaSearch,
  buildSiteSearchUrl: () => buildSiteSearchUrl,
  customSearch: () => customSearch,
  deepSeekSearch: () => deepSeekSearch,
  extractImageUrls: () => extractImageUrls,
  extractPageDigest: () => extractPageDigest,
  metasoSearch: () => metasoSearch,
  parseBingResults: () => parseBingResults,
  queryKeywords: () => queryKeywords,
  sanitizeQuery: () => sanitizeQuery,
  searchImages: () => searchImages2,
  simplifyQuery: () => simplifyQuery,
  webFetch: () => webFetch,
  webSearch: () => webSearch,
  zhipuSearch: () => zhipuSearch
});

// environment:config
var getConfig = () => __utilityHost.config();
var DATA_DIR = __utilityHost.dataDir ?? "";

// environment:safe-fetch
var safeFetch = (url, options) => __utilityHost.safeFetch(url, options);
var safeFetchBinary = (url, maxBytes) => __utilityHost.safeFetchBinary(url, maxBytes);

// packages/legacy-core/vendor/web-search.js
function sanitizeQuery(query) {
  return String(query ?? "").replace(/\[CQ:[^\]]*\]/gi, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}
function simplifyQuery(query) {
  return String(query ?? "").replace(/(帮我|麻烦|请)?\s*(搜一下|搜索一下|搜索|搜搜|查一下|查询一下|查询|找一下|找找|搜|查)/g, " ").replace(/(今日|今天|昨日|昨天|明天|明日|最新|最近|近期)/g, " ").replace(/\s+/g, " ").trim();
}
function queryKeywords(query) {
  const s = String(query ?? "");
  const latin = s.match(/[A-Za-z][A-Za-z0-9_.-]*/g) || [];
  const bigrams = [];
  for (const run of s.match(/[一-鿿]+/g) || []) {
    for (let i = 0; i < run.length - 1; i++) bigrams.push(run.slice(i, i + 2));
  }
  return { latin, bigrams };
}
function decodeHtml(s) {
  return String(s ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
async function fetchBingoResults(searchUrl, query, maxResults) {
  const url = new URL(searchUrl);
  url.searchParams.set("q", query);
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "zh-CN,zh;q=0.9"
    },
    signal: AbortSignal.timeout(15e3)
  });
  if (!res.ok) throw new Error(`\u641C\u7D22\u670D\u52A1 HTTP ${res.status}`);
  const html = await res.text();
  return parseBingResults(html, maxResults);
}
function parseBingResults(html, maxResults = 6) {
  const results = [];
  for (const block of String(html ?? "").split(/<li\b[^>]*\bclass\s*=\s*["'][^"']*\bb_algo\b[^"']*["']/i).slice(1)) {
    const hrefMatch = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"/i);
    if (!hrefMatch) continue;
    const urlStr = decodeHtml(hrefMatch[1]);
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleMatch ? decodeHtml(titleMatch[1]) : "";
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? decodeHtml(snippetMatch[1]) : "";
    if (urlStr && title) results.push({ title, url: urlStr, snippet });
    if (results.length >= maxResults) break;
  }
  return results;
}
async function bingSearch(query) {
  const cfg = getConfig().webSearch ?? {};
  const searchUrl = String(cfg.searchUrl || "https://cn.bing.com/search");
  const maxResults = Math.max(1, Math.min(10, Number(cfg.maxResults) || 6));
  const results = await fetchBingoResults(searchUrl, sanitizeQuery(query), maxResults);
  if (!results.length) throw new Error("\u641C\u7D22\u6CA1\u6709\u89E3\u6790\u5230\u7ED3\u679C\uFF08\u5F15\u64CE\u9875\u9762\u7ED3\u6784\u53EF\u80FD\u5DF2\u6539\u7248\uFF09");
  return { query, results };
}
async function webSearch(query) {
  const clean = sanitizeQuery(query);
  if (!clean) throw new Error("\u67E5\u8BE2\u8BCD\u4E3A\u7A7A");
  const cfg = getConfig().webSearch ?? {};
  const provider = String(cfg.provider || "bing").toLowerCase();
  if (provider === "deepseek") return deepSeekSearch(clean);
  if (provider === "zhipu") return zhipuSearch(clean);
  if (provider === "bocha") return bochaSearch(clean);
  if (provider === "baidu") return baiduSearch(clean);
  if (provider === "metaso") return metasoSearch(clean);
  if (provider === "custom" || provider.startsWith("custom:")) {
    return customSearch(clean, provider);
  }
  return bingSearch(clean);
}
async function deepSeekSearch(query) {
  const cfg = getConfig().webSearch?.deepseek ?? {};
  const apiKey = String(cfg.apiKey || process.env.DEEPSEEK_API_KEY || "").trim();
  if (!apiKey) throw new Error("DeepSeek \u641C\u7D22\u9700\u8981 API Key\uFF08\u8BBE\u7F6E\u91CC\u586B\uFF0C\u6216\u73AF\u5883\u53D8\u91CF DEEPSEEK_API_KEY\uFF09");
  const baseUrl = String(cfg.baseUrl || "https://api.deepseek.com/responses").replace(/\/+$/, "");
  const model = String(cfg.model || "deepseek-v4-flash");
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: `\u8BF7\u8054\u7F51\u641C\u7D22\u5E76\u56DE\u7B54\uFF08\u7528\u4E2D\u6587\uFF0C\u7B80\u6D01\u3001\u53EA\u7ED9\u7ED3\u8BBA\u548C\u5173\u952E\u4FE1\u606F\uFF09\uFF1A${query}`,
      tools: [{ type: "web_search" }],
      stream: false
    }),
    signal: AbortSignal.timeout(Math.max(1e4, Number(cfg.timeoutMs) || 6e4))
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek \u641C\u7D22 HTTP ${res.status}\uFF1A${text.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => {
    throw new Error("DeepSeek \u641C\u7D22\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684 JSON");
  });
  const outputText = String(data?.output_text ?? "").trim();
  if (!outputText) {
    const alt = data?.output?.find?.((item) => item?.type === "message" && item?.content?.length)?.content?.map((c) => c?.text ?? "").join("") ?? "";
    if (!alt) throw new Error("DeepSeek \u641C\u7D22\u6CA1\u6709\u8FD4\u56DE\u6587\u672C\uFF08\u53EF\u80FD\u662F\u6A21\u578B\u4E0D\u652F\u6301 web_search \u5DE5\u5177\uFF09");
    return { query, results: [{ title: "DeepSeek \u641C\u7D22", url: "", snippet: alt }] };
  }
  return { query, results: [{ title: "DeepSeek \u641C\u7D22", url: "", snippet: outputText }] };
}
async function webFetch(url, { browseLocked = false } = {}) {
  const result = await safeFetch(url, { browseLocked });
  return result;
}
async function zhipuSearch(query) {
  const cfg = getConfig().webSearch?.zhipu ?? {};
  const apiKey = String(cfg.apiKey || process.env.ZHIPU_API_KEY || "").trim();
  if (!apiKey) throw new Error("\u667A\u8C31\u641C\u7D22\u9700\u8981 API Key\uFF08\u8BBE\u7F6E\u91CC\u586B\uFF0C\u6216\u73AF\u5883\u53D8\u91CF ZHIPU_API_KEY\uFF09");
  const endpoint = String(cfg.baseUrl || "https://open.bigmodel.cn/api/paas/v4/web_search").replace(/\/+$/, "");
  const engine = String(cfg.engine || "search_std");
  const count = Math.min(50, Math.max(1, Number(cfg.count) || 10));
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ search_engine: engine, search_query: query, count }),
    signal: AbortSignal.timeout(Math.max(1e4, Number(cfg.timeoutMs) || 2e4))
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`\u667A\u8C31\u641C\u7D22 HTTP ${res.status}\uFF1A${text.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => {
    throw new Error("\u667A\u8C31\u641C\u7D22\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684 JSON");
  });
  const arr = Array.isArray(data?.search_result) ? data.search_result : [];
  const results = arr.filter((r) => r?.link || r?.url).map((r) => ({
    title: String(r.title ?? r.name ?? "").trim() || "\uFF08\u65E0\u6807\u9898\uFF09",
    url: String(r.link ?? r.url ?? ""),
    snippet: String(r.content ?? r.summary ?? "").trim()
  })).slice(0, Math.max(1, Number(getConfig().webSearch?.maxResults) || 6));
  if (!results.length) throw new Error("\u667A\u8C31\u641C\u7D22\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7ED3\u679C\uFF08\u68C0\u67E5 API Key \u6216\u641C\u7D22\u5F15\u64CE\u7F16\u7801\uFF09");
  return { query, results };
}
async function bochaSearch(query) {
  const cfg = getConfig().webSearch?.bocha ?? {};
  const apiKey = String(cfg.apiKey || process.env.BOCHA_API_KEY || "").trim();
  if (!apiKey) throw new Error("\u535A\u67E5\u641C\u7D22\u9700\u8981 API Key\uFF08\u8BBE\u7F6E\u91CC\u586B\uFF0C\u6216\u73AF\u5883\u53D8\u91CF BOCHA_API_KEY\uFF09");
  const endpoint = String(cfg.baseUrl || "https://api.bochaai.com/v1/web-search").replace(/\/+$/, "");
  const count = Math.min(50, Math.max(1, Number(cfg.count) || 10));
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ query, count, freshness: "noLimit", summary: false }),
    signal: AbortSignal.timeout(Math.max(1e4, Number(cfg.timeoutMs) || 2e4))
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`\u535A\u67E5\u641C\u7D22 HTTP ${res.status}\uFF1A${text.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => {
    throw new Error("\u535A\u67E5\u641C\u7D22\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684 JSON");
  });
  if (data?.code && Number(data.code) !== 200) {
    throw new Error(`\u535A\u67E5\u641C\u7D22 API \u9519\u8BEF\uFF08code ${data.code}\uFF09\uFF1A${data.message || data.msg || "\u672A\u77E5"}`);
  }
  const arr = Array.isArray(data?.data?.webPages?.value) ? data.data.webPages.value : [];
  const results = arr.filter((r) => r?.url).map((r) => ({
    title: String(r.name ?? r.title ?? "").trim() || "\uFF08\u65E0\u6807\u9898\uFF09",
    url: String(r.url ?? ""),
    snippet: String(r.snippet ?? r.summary ?? r.content ?? "").trim()
  })).slice(0, Math.max(1, Number(getConfig().webSearch?.maxResults) || 6));
  if (!results.length) throw new Error("\u535A\u67E5\u641C\u7D22\u6CA1\u6709\u8FD4\u56DE\u7F51\u9875\u7ED3\u679C");
  return { query, results };
}
async function baiduSearch(query) {
  const cfg = getConfig().webSearch?.baidu ?? {};
  const apiKey = String(cfg.apiKey || process.env.BAIDU_SEARCH_API_KEY || "").trim();
  if (!apiKey) throw new Error("\u767E\u5EA6\u641C\u7D22\u9700\u8981 API Key\uFF08\u8BBE\u7F6E\u91CC\u586B\uFF0C\u6216\u73AF\u5883\u53D8\u91CF BAIDU_SEARCH_API_KEY\uFF09");
  const endpoint = String(cfg.baseUrl || "https://qianfan.baidubce.com/v2/ai_search/web_search").replace(/\/+$/, "");
  const topK = Math.min(10, Math.max(1, Number(cfg.count) || 6));
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: query }],
      search_source: "baidu_search_v2",
      resource_type_filter: [{ type: "web", top_k: topK }]
    }),
    signal: AbortSignal.timeout(Math.max(1e4, Number(cfg.timeoutMs) || 2e4))
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`\u767E\u5EA6\u641C\u7D22 HTTP ${res.status}\uFF1A${text.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => {
    throw new Error("\u767E\u5EA6\u641C\u7D22\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684 JSON");
  });
  if (data?.error_code && Number(data.error_code) !== 0) {
    throw new Error(`\u767E\u5EA6\u641C\u7D22 API \u9519\u8BEF\uFF08code ${data.error_code}\uFF09\uFF1A${data.error_msg || data.message || "\u672A\u77E5"}`);
  }
  const arr = Array.isArray(data?.references) ? data.references : [];
  const results = arr.filter((r) => r?.url || r?.link).map((r) => ({
    title: String(r.title ?? r.name ?? "").trim() || "\uFF08\u65E0\u6807\u9898\uFF09",
    url: String(r.url ?? r.link ?? ""),
    snippet: String(r.content ?? r.snippet ?? r.summary ?? "").trim()
  })).slice(0, Math.max(1, Number(getConfig().webSearch?.maxResults) || 6));
  if (!results.length) throw new Error("\u767E\u5EA6\u641C\u7D22\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7ED3\u679C");
  return { query, results };
}
async function metasoSearch(query) {
  const cfg = getConfig().webSearch?.metaso ?? {};
  const apiKey = String(cfg.apiKey || process.env.METASO_API_KEY || "").trim();
  const endpoint = String(cfg.baseUrl || "https://metaso.cn/api/open/v1/search").replace(/\/+$/, "");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...apiKey ? { authorization: `Bearer ${apiKey}` } : {}
    },
    body: JSON.stringify({ query, top_k: Math.min(10, Math.max(1, Number(cfg.count) || 6)) }),
    signal: AbortSignal.timeout(Math.max(1e4, Number(cfg.timeoutMs) || 2e4))
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`\u79D8\u5854\u641C\u7D22 HTTP ${res.status}\uFF1A${text.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => {
    throw new Error("\u79D8\u5854\u641C\u7D22\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684 JSON");
  });
  const arr = Array.isArray(data?.results) ? data.results : Array.isArray(data?.data) ? data.data : Array.isArray(data?.sources) ? data.sources : [];
  const results = arr.filter((r) => r?.url || r?.link).map((r) => ({
    title: String(r.title ?? r.name ?? "").trim() || "\uFF08\u65E0\u6807\u9898\uFF09",
    url: String(r.url ?? r.link ?? ""),
    snippet: String(r.content ?? r.snippet ?? r.summary ?? "").trim()
  })).slice(0, Math.max(1, Number(getConfig().webSearch?.maxResults) || 6));
  if (!results.length) throw new Error("\u79D8\u5854\u641C\u7D22\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7ED3\u679C\uFF08\u53EF\u80FD\u5DF2\u7528\u5B8C\u514D\u8D39\u989D\u5EA6\u6216\u63A5\u53E3\u5730\u5740\u9700\u8981\u66F4\u65B0\uFF09");
  return { query, results };
}
function resolveCustomConfig(providerId = null) {
  const ws = getConfig().webSearch ?? {};
  if (providerId && String(providerId).startsWith("custom:")) {
    const id = String(providerId).slice("custom:".length);
    const found = (Array.isArray(ws.providers) ? ws.providers : []).find((p) => String(p?.id) === id);
    if (found) return found;
  }
  return ws.custom ?? {};
}
async function customSearch(query, providerId = null) {
  const cfg = resolveCustomConfig(providerId);
  const type = String(cfg.type || "openai").toLowerCase();
  if (type === "bing") {
    return bingSearchWithUrl(query, String(cfg.baseUrl || ""));
  }
  const endpoint = String(cfg.baseUrl || "").replace(/\/+$/, "");
  if (!endpoint) throw new Error("\u81EA\u5B9A\u4E49\u641C\u7D22\u672A\u914D\u7F6E\u63A5\u53E3\u5730\u5740\uFF08\u8BBE\u7F6E \u2192 \u6A21\u578B API \u2192 \u641C\u7D22\u63D0\u4F9B\u65B9 \u2192 \u81EA\u5B9A\u4E49\uFF09");
  const apiKey = String(cfg.apiKey || "").trim();
  const model = String(cfg.model || "").trim();
  const topK = Math.min(10, Math.max(1, Number(cfg.count) || 6));
  const body = { query, q: query, top_k: topK, count: topK };
  if (model) {
    body.model = model;
    body.messages = [{ role: "user", content: query }];
  }
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...apiKey ? { authorization: `Bearer ${apiKey}` } : {}
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1e4, Number(cfg.timeoutMs) || 2e4))
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`\u81EA\u5B9A\u4E49\u641C\u7D22 HTTP ${res.status}\uFF1A${text.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => {
    throw new Error("\u81EA\u5B9A\u4E49\u641C\u7D22\u8FD4\u56DE\u4E86\u65E0\u6CD5\u89E3\u6790\u7684 JSON");
  });
  const arr = Array.isArray(data?.results) ? data.results : Array.isArray(data?.data) ? data.data : Array.isArray(data?.sources) ? data.sources : Array.isArray(data?.references) ? data.references : Array.isArray(data?.webPages?.value) ? data.webPages.value : Array.isArray(data) ? data : [];
  const results = arr.filter((r) => r && (r.url || r.link)).map((r) => ({
    title: String(r.title ?? r.name ?? r.headline ?? "").trim() || "\uFF08\u65E0\u6807\u9898\uFF09",
    url: String(r.url ?? r.link ?? ""),
    snippet: String(r.content ?? r.snippet ?? r.summary ?? r.body ?? "").trim()
  })).slice(0, Math.max(1, Number(getConfig().webSearch?.maxResults) || 6));
  if (!results.length) {
    throw new Error("\u81EA\u5B9A\u4E49\u641C\u7D22\u6CA1\u6709\u8FD4\u56DE\u53EF\u8BC6\u522B\u7684\u7ED3\u679C\uFF08\u8BF7\u68C0\u67E5\u63A5\u53E3\u8FD4\u56DE\u662F\u5426\u5305\u542B results/data/sources \u7B49\u6570\u7EC4\uFF0C\u6216\u6539\u7528 bing \u7C7B\u578B\u6293\u9875\u9762\uFF09");
  }
  return { query, results };
}
async function bingSearchWithUrl(query, searchUrl) {
  const cfg = getConfig().webSearch ?? {};
  const url = String(searchUrl || cfg.searchUrl || "https://cn.bing.com/search");
  const maxResults = Math.max(1, Math.min(10, Number(cfg.maxResults) || 6));
  const results = await fetchBingoResults(url, query, maxResults).catch((error) => {
    throw new Error(`\u81EA\u5B9A\u4E49\u641C\u7D22\uFF08bing \u7C7B\u578B\uFF09\uFF1A${error?.message ?? error}`);
  });
  if (!results.length) throw new Error("\u81EA\u5B9A\u4E49\u641C\u7D22\uFF08bing \u7C7B\u578B\uFF09\u6CA1\u6709\u89E3\u6790\u5230\u7ED3\u679C\uFF0C\u8BF7\u786E\u8BA4\u8BE5\u5F15\u64CE\u8FD4\u56DE b_algo \u7ED3\u6784");
  return { query, results };
}
function buildSiteSearchUrl(template, query) {
  const tpl = String(template ?? "").trim();
  if (!tpl) throw new Error("\u7AD9\u5185\u641C\u7D22\u6A21\u677F\u4E3A\u7A7A");
  const q = String(query ?? "").trim();
  if (tpl.includes("{query}")) return tpl.replaceAll("{query}", encodeURIComponent(q));
  if (tpl.includes("%s")) return tpl.replaceAll("%s", encodeURIComponent(q));
  return tpl + (tpl.includes("?") ? "&" : "?") + "q=" + encodeURIComponent(q);
}
function extractImageUrls(html, baseUrl = "", max = 10) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (raw) => {
    const s = String(raw ?? "").trim();
    if (!s) return;
    const isBareRelative = !/^https?:\/\//i.test(s) && !s.startsWith("//") && !s.startsWith("/") && !s.startsWith("data:");
    if (isBareRelative && !baseUrl) return;
    let abs = s;
    try {
      abs = s.startsWith("//") ? new URL(`https:${s}`).toString() : new URL(s, baseUrl || void 0).toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  };
  for (const m of String(html ?? "").matchAll(/<img[^>]+>/gi)) {
    const tag = m[0];
    for (const attr of ["data-src", "data-original", "data-lazy-src", "srcset", "src"]) {
      const mm = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
      if (!mm) continue;
      push(String(mm[1]).split(",")[0].trim().split(/\s+/)[0]);
      if (out.length >= max) return out;
    }
    if (out.length >= max) break;
  }
  if (out.length < max) {
    for (const m of String(html ?? "").matchAll(/["'](https?:\/\/[^"'\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"'\s]*)?)["']/gi)) {
      push(m[1]);
      if (out.length >= max) break;
    }
  }
  return out.slice(0, Math.max(1, Number(max) || 10));
}
function extractPageDigest(html, _baseUrl = "", { maxChars = 6e3, maxLinks = 24 } = {}) {
  const raw = String(html ?? "");
  const cleaned = raw.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const text = decodeHtml(cleaned.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const links = [];
  for (const m of cleaned.matchAll(/<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (links.length >= maxLinks) break;
    const href = String(m[1]).trim();
    if (!/^https?:\/\//i.test(href)) continue;
    const label = decodeHtml(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (label) links.push({ title: label.slice(0, 80), url: href });
  }
  const cap = Math.max(200, Number(maxChars) || 6e3);
  return { text: text.length > cap ? `${text.slice(0, cap)}\u2026\uFF08\u5DF2\u622A\u65AD\uFF09` : text, links, images: extractImageUrls(cleaned, _baseUrl, 10) };
}
async function bingImageSearch(query, { limit = 8, browseLocked = false } = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("\u641C\u7D22\u5173\u952E\u8BCD\u4E3A\u7A7A");
  const url = `https://cn.bing.com/images/search?q=${encodeURIComponent(q)}&form=HDRSC2`;
  const { body } = await safeFetch(url, { browseLocked });
  const html = String(body ?? "");
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of html.matchAll(/m="([^"]+)"/g)) {
    const raw = decodeHtml(m[1]).replace(/&quot;/g, '"');
    let url2 = "";
    try {
      const j = JSON.parse(raw);
      url2 = String(j.murl || j.mediaurl || "").trim();
    } catch {
      const mm = raw.match(/"murl"\s*:\s*"([^"]+)"/);
      url2 = mm ? mm[1] : "";
    }
    if (!/^https?:\/\//i.test(url2) || seen.has(url2)) continue;
    seen.add(url2);
    out.push({ title: q, url: url2 });
    if (out.length >= Math.max(1, Number(limit) || 8)) break;
  }
  if (!out.length) throw new Error("Bing \u56FE\u7247\u641C\u7D22\u6CA1\u89E3\u6790\u5230\u7ED3\u679C\uFF08\u9875\u9762\u7ED3\u6784\u53EF\u80FD\u5DF2\u6539\u7248\uFF09");
  return out;
}
async function baiduImageSearch(query, { limit = 8, browseLocked = false } = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("\u641C\u7D22\u5173\u952E\u8BCD\u4E3A\u7A7A");
  const url = `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(q)}`;
  const { body } = await safeFetch(url, { browseLocked });
  const html = String(body ?? "");
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const key of ["objURL", "middleURL", "thumbURL", "hoverURL"]) {
    const re = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, "g");
    for (const m of html.matchAll(re)) {
      const u = decodeHtml(m[1]).replace(/\\\//g, "/");
      if (!/^https?:\/\//i.test(u) || seen.has(u)) continue;
      seen.add(u);
      out.push({ title: q, url: u });
      if (out.length >= Math.max(1, Number(limit) || 8)) break;
    }
    if (out.length >= Math.max(1, Number(limit) || 8)) break;
  }
  if (!out.length) throw new Error("\u767E\u5EA6\u56FE\u7247\u641C\u7D22\u6CA1\u89E3\u6790\u5230\u7ED3\u679C\uFF08\u9875\u9762\u7ED3\u6784\u53EF\u80FD\u5DF2\u6539\u7248\uFF09");
  return out;
}
async function searchImages2(query, { limit = 8, browseLocked = false } = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw new Error("\u641C\u7D22\u5173\u952E\u8BCD\u4E3A\u7A7A");
  const n = Math.max(1, Math.min(12, Number(limit) || 8));
  const errors = [];
  for (const fn of [baiduImageSearch, bingImageSearch]) {
    try {
      const list = await fn(q, { limit: n, browseLocked });
      if (list.length) return list;
    } catch (error) {
      errors.push(`${fn.name}: ${error?.message ?? error}`);
    }
  }
  throw new Error(`\u56FE\u7247\u641C\u7D22\u5168\u90E8\u5931\u8D25 \u2014\u2014 ${errors.join("\uFF1B")}`);
}

// packages/legacy-core/vendor/holidays.js
var holidays_exports = {};
__export(holidays_exports, {
  holidayOn: () => holidayOn,
  upcomingHoliday: () => upcomingHoliday
});
var SOLAR_HOLIDAYS = {
  "01-01": { name: "\u5143\u65E6", greeting: "\u65B0\u5E74\u5FEB\u4E50\uFF01\u65B0\u7684\u4E00\u5E74\u987A\u987A\u5229\u5229" },
  "02-14": { name: "\u60C5\u4EBA\u8282", greeting: "\u60C5\u4EBA\u8282\u5FEB\u4E50" },
  "03-08": { name: "\u5987\u5973\u8282", greeting: "\u5987\u5973\u8282\u5FEB\u4E50" },
  "04-01": { name: "\u611A\u4EBA\u8282", greeting: "\u611A\u4EBA\u8282\u5FEB\u4E50\uFF08\u4ECA\u5929\u8BF4\u8BDD\u90FD\u5E26\u70B9\u8C31\uFF09" },
  "05-01": { name: "\u52B3\u52A8\u8282", greeting: "\u52B3\u52A8\u8282\u5FEB\u4E50\uFF0C\u597D\u597D\u4F11\u606F" },
  "05-04": { name: "\u9752\u5E74\u8282", greeting: "\u9752\u5E74\u8282\u5FEB\u4E50" },
  "06-01": { name: "\u513F\u7AE5\u8282", greeting: "\u513F\u7AE5\u8282\u5FEB\u4E50\uFF0C\u6C38\u8FDC\u5E74\u8F7B" },
  "09-10": { name: "\u6559\u5E08\u8282", greeting: "\u6559\u5E08\u8282\u5FEB\u4E50" },
  "10-01": { name: "\u56FD\u5E86\u8282", greeting: "\u56FD\u5E86\u5FEB\u4E50\uFF01\u5047\u671F\u6109\u5FEB" },
  "10-31": { name: "\u4E07\u5723\u591C", greeting: "\u4E07\u5723\u591C\u5FEB\u4E50\uFF0C\u4E0D\u7ED9\u7CD6\u5C31\u6363\u86CB" },
  "11-01": { name: "\u4E07\u5723\u8282", greeting: "\u4E07\u5723\u8282\u5FEB\u4E50" },
  "12-24": { name: "\u5E73\u5B89\u591C", greeting: "\u5E73\u5B89\u591C\u5FEB\u4E50" },
  "12-25": { name: "\u5723\u8BDE\u8282", greeting: "\u5723\u8BDE\u5FEB\u4E50" }
};
var LUNAR_HOLIDAYS = {
  // 2024
  "2024-02-10": { name: "\u6625\u8282", greeting: "\u65B0\u5E74\u5FEB\u4E50\uFF01\u606D\u559C\u53D1\u8D22" },
  "2024-02-24": { name: "\u5143\u5BB5\u8282", greeting: "\u5143\u5BB5\u8282\u5FEB\u4E50\uFF0C\u8BB0\u5F97\u5403\u6C64\u5706" },
  "2024-04-04": { name: "\u6E05\u660E\u8282", greeting: "\u6E05\u660E\u65F6\u8282\uFF0C\u6CE8\u610F\u51FA\u884C" },
  "2024-06-10": { name: "\u7AEF\u5348\u8282", greeting: "\u7AEF\u5348\u5B89\u5EB7\uFF0C\u5403\u7CBD\u5B50\u4E86\u5417" },
  "2024-08-10": { name: "\u4E03\u5915", greeting: "\u4E03\u5915\u5FEB\u4E50" },
  "2024-08-18": { name: "\u4E2D\u5143\u8282", greeting: "\u4E2D\u5143\u8282" },
  "2024-09-17": { name: "\u4E2D\u79CB\u8282", greeting: "\u4E2D\u79CB\u5FEB\u4E50\uFF0C\u4EBA\u6708\u4E24\u56E2\u5706" },
  "2024-10-11": { name: "\u91CD\u9633\u8282", greeting: "\u91CD\u9633\u8282\u5FEB\u4E50" },
  // 2025
  "2025-01-28": { name: "\u9664\u5915", greeting: "\u9664\u5915\u5FEB\u4E50\uFF01\u5B88\u5C81\u8FCE\u65B0\u5E74" },
  "2025-01-29": { name: "\u6625\u8282", greeting: "\u65B0\u5E74\u5FEB\u4E50\uFF01\u86C7\u5E74\u5927\u5409" },
  "2025-02-12": { name: "\u5143\u5BB5\u8282", greeting: "\u5143\u5BB5\u8282\u5FEB\u4E50\uFF0C\u8BB0\u5F97\u5403\u6C64\u5706" },
  "2025-04-04": { name: "\u6E05\u660E\u8282", greeting: "\u6E05\u660E\u65F6\u8282\uFF0C\u6CE8\u610F\u51FA\u884C" },
  "2025-05-31": { name: "\u7AEF\u5348\u8282", greeting: "\u7AEF\u5348\u5B89\u5EB7\uFF0C\u5403\u7CBD\u5B50\u4E86\u5417" },
  "2025-08-29": { name: "\u4E03\u5915", greeting: "\u4E03\u5915\u5FEB\u4E50" },
  "2025-09-06": { name: "\u4E2D\u5143\u8282", greeting: "\u4E2D\u5143\u8282" },
  "2025-10-06": { name: "\u4E2D\u79CB\u8282", greeting: "\u4E2D\u79CB\u5FEB\u4E50\uFF0C\u4EBA\u6708\u4E24\u56E2\u5706" },
  "2025-10-29": { name: "\u91CD\u9633\u8282", greeting: "\u91CD\u9633\u8282\u5FEB\u4E50" },
  // 2026
  "2026-02-16": { name: "\u9664\u5915", greeting: "\u9664\u5915\u5FEB\u4E50\uFF01\u5B88\u5C81\u8FCE\u65B0\u5E74" },
  "2026-02-17": { name: "\u6625\u8282", greeting: "\u65B0\u5E74\u5FEB\u4E50\uFF01\u9A6C\u5E74\u5927\u5409" },
  "2026-03-03": { name: "\u5143\u5BB5\u8282", greeting: "\u5143\u5BB5\u8282\u5FEB\u4E50\uFF0C\u8BB0\u5F97\u5403\u6C64\u5706" },
  "2026-04-05": { name: "\u6E05\u660E\u8282", greeting: "\u6E05\u660E\u65F6\u8282\uFF0C\u6CE8\u610F\u51FA\u884C" },
  "2026-06-19": { name: "\u7AEF\u5348\u8282", greeting: "\u7AEF\u5348\u5B89\u5EB7\uFF0C\u5403\u7CBD\u5B50\u4E86\u5417" },
  "2026-08-19": { name: "\u4E03\u5915", greeting: "\u4E03\u5915\u5FEB\u4E50" },
  "2026-08-27": { name: "\u4E2D\u5143\u8282", greeting: "\u4E2D\u5143\u8282" },
  "2026-09-25": { name: "\u4E2D\u79CB\u8282", greeting: "\u4E2D\u79CB\u5FEB\u4E50\uFF0C\u4EBA\u6708\u4E24\u56E2\u5706" },
  "2026-10-18": { name: "\u91CD\u9633\u8282", greeting: "\u91CD\u9633\u8282\u5FEB\u4E50" },
  // 2027（重阳由 10-07 修正为 10-08）
  "2027-02-05": { name: "\u9664\u5915", greeting: "\u9664\u5915\u5FEB\u4E50\uFF01\u5B88\u5C81\u8FCE\u65B0\u5E74" },
  "2027-02-06": { name: "\u6625\u8282", greeting: "\u65B0\u5E74\u5FEB\u4E50\uFF01\u7F8A\u5E74\u5927\u5409" },
  "2027-02-20": { name: "\u5143\u5BB5\u8282", greeting: "\u5143\u5BB5\u8282\u5FEB\u4E50\uFF0C\u8BB0\u5F97\u5403\u6C64\u5706" },
  "2027-04-05": { name: "\u6E05\u660E\u8282", greeting: "\u6E05\u660E\u65F6\u8282\uFF0C\u6CE8\u610F\u51FA\u884C" },
  "2027-06-09": { name: "\u7AEF\u5348\u8282", greeting: "\u7AEF\u5348\u5B89\u5EB7\uFF0C\u5403\u7CBD\u5B50\u4E86\u5417" },
  "2027-08-08": { name: "\u4E03\u5915", greeting: "\u4E03\u5915\u5FEB\u4E50" },
  "2027-09-15": { name: "\u4E2D\u79CB\u8282", greeting: "\u4E2D\u79CB\u5FEB\u4E50\uFF0C\u4EBA\u6708\u4E24\u56E2\u5706" },
  "2027-10-08": { name: "\u91CD\u9633\u8282", greeting: "\u91CD\u9633\u8282\u5FEB\u4E50" },
  // 2028（猴年）
  "2028-01-25": { name: "\u9664\u5915", greeting: "\u9664\u5915\u5FEB\u4E50\uFF01\u5B88\u5C81\u8FCE\u65B0\u5E74" },
  "2028-01-26": { name: "\u6625\u8282", greeting: "\u65B0\u5E74\u5FEB\u4E50\uFF01\u7334\u5E74\u5927\u5409" },
  "2028-02-09": { name: "\u5143\u5BB5\u8282", greeting: "\u5143\u5BB5\u8282\u5FEB\u4E50\uFF0C\u8BB0\u5F97\u5403\u6C64\u5706" },
  "2028-04-04": { name: "\u6E05\u660E\u8282", greeting: "\u6E05\u660E\u65F6\u8282\uFF0C\u6CE8\u610F\u51FA\u884C" },
  "2028-05-28": { name: "\u7AEF\u5348\u8282", greeting: "\u7AEF\u5348\u5B89\u5EB7\uFF0C\u5403\u7CBD\u5B50\u4E86\u5417" },
  "2028-08-26": { name: "\u4E03\u5915", greeting: "\u4E03\u5915\u5FEB\u4E50" },
  "2028-09-03": { name: "\u4E2D\u5143\u8282", greeting: "\u4E2D\u5143\u8282" },
  "2028-10-03": { name: "\u4E2D\u79CB\u8282", greeting: "\u4E2D\u79CB\u5FEB\u4E50\uFF0C\u4EBA\u6708\u4E24\u56E2\u5706" },
  "2028-10-26": { name: "\u91CD\u9633\u8282", greeting: "\u91CD\u9633\u8282\u5FEB\u4E50" },
  // 2029（鸡年）
  "2029-02-12": { name: "\u9664\u5915", greeting: "\u9664\u5915\u5FEB\u4E50\uFF01\u5B88\u5C81\u8FCE\u65B0\u5E74" },
  "2029-02-13": { name: "\u6625\u8282", greeting: "\u65B0\u5E74\u5FEB\u4E50\uFF01\u9E21\u5E74\u5927\u5409" },
  "2029-02-27": { name: "\u5143\u5BB5\u8282", greeting: "\u5143\u5BB5\u8282\u5FEB\u4E50\uFF0C\u8BB0\u5F97\u5403\u6C64\u5706" },
  "2029-04-04": { name: "\u6E05\u660E\u8282", greeting: "\u6E05\u660E\u65F6\u8282\uFF0C\u6CE8\u610F\u51FA\u884C" },
  "2029-06-16": { name: "\u7AEF\u5348\u8282", greeting: "\u7AEF\u5348\u5B89\u5EB7\uFF0C\u5403\u7CBD\u5B50\u4E86\u5417" },
  "2029-08-16": { name: "\u4E03\u5915", greeting: "\u4E03\u5915\u5FEB\u4E50" },
  "2029-08-24": { name: "\u4E2D\u5143\u8282", greeting: "\u4E2D\u5143\u8282" },
  "2029-09-22": { name: "\u4E2D\u79CB\u8282", greeting: "\u4E2D\u79CB\u5FEB\u4E50\uFF0C\u4EBA\u6708\u4E24\u56E2\u5706" },
  "2029-10-16": { name: "\u91CD\u9633\u8282", greeting: "\u91CD\u9633\u8282\u5FEB\u4E50" }
};
function pad(n) {
  return String(n).padStart(2, "0");
}
function keyOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function solarKeyOf(d) {
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function holidayOn(date = /* @__PURE__ */ new Date()) {
  const lunar = LUNAR_HOLIDAYS[keyOf(date)];
  if (lunar) return { ...lunar, type: "lunar" };
  const solar = SOLAR_HOLIDAYS[solarKeyOf(date)];
  if (solar) return { ...solar, type: "solar" };
  return null;
}
function upcomingHoliday(days = 7) {
  const now = /* @__PURE__ */ new Date();
  for (let i = 0; i <= Math.max(0, Number(days) || 7); i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const h = holidayOn(d);
    if (h) return { ...h, date: keyOf(d), daysAway: i };
  }
  return null;
}

// packages/legacy-core/vendor/stickers.js
var stickers_exports = {};
__export(stickers_exports, {
  applyStickerNote: () => applyStickerNote,
  buildStickerContext: () => buildStickerContext,
  buildStickerStrategyHint: () => buildStickerStrategyHint,
  findSticker: () => findSticker,
  formatStickerList: () => formatStickerList,
  loadStickerStore: () => loadStickerStore,
  markStickerUsed: () => markStickerUsed,
  mergeStickerLibrary: () => mergeStickerLibrary,
  normalizeStickerEntry: () => normalizeStickerEntry,
  nowIso: () => nowIso,
  saveStickerStore: () => saveStickerStore
});
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var STICKER_FILE = import_node_path2.default.join(DATA_DIR, "stickers.json");
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function normalizeStickerEntry(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const id = String(entry.id || entry.emoji_id || entry.resId || "").trim();
  if (!id) return null;
  const tags = Array.isArray(entry.tags) ? entry.tags.map((t) => String(t ?? "").trim()).filter(Boolean).slice(0, 20) : [];
  return {
    id,
    resId: String(entry.resId || entry.emoji_id || id).trim(),
    // QQ 原生收藏身份（add_custom_face 的 emoji_id）：入了 QQ 收藏的条目靠它
    // 做幂等补录、备注回写（modify_custom_face）与长效地址回查。
    emojiId: String(entry.emojiId || "").trim(),
    // 消息里的协议端缓存文件 id：转存失败后的重试线索（get_image 认它）。
    qqFile: String(entry.qqFile || "").trim(),
    // 本地转存产物（file:///）。搬家自愈后由 healLocalPaths 重写。
    localFile: String(entry.localFile || "").trim(),
    // 本地转存失败标记：提示这条目当前靠 url 存活（QQ 图床 rkey ~1h，僵尸预警）。
    persistFailed: entry.persistFailed === true,
    url: String(entry.url || "").trim(),
    md5: String(entry.md5 || "").trim().toUpperCase(),
    desc: String(entry.desc ?? "").trim(),
    localNote: String(entry.localNote ?? "").trim(),
    tags,
    usage: String(entry.usage ?? "").trim(),
    source: entry.source === "manual" ? "manual" : entry.source === "ai" ? "ai" : "qq",
    useCount: Math.max(0, Number(entry.useCount) || 0),
    lastUsedAt: Number(entry.lastUsedAt) || 0,
    lastContext: String(entry.lastContext ?? "").slice(0, 200),
    createdAt: String(entry.createdAt || nowIso()),
    updatedAt: String(entry.updatedAt || nowIso())
  };
}
function loadStickerStore(file = STICKER_FILE) {
  try {
    let text = import_node_fs2.default.readFileSync(file, "utf8");
    if (text.charCodeAt(0) === 65279) text = text.slice(1);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeStickerEntry).filter(Boolean);
  } catch {
    return [];
  }
}
function saveStickerStore(entries, file = STICKER_FILE) {
  import_node_fs2.default.mkdirSync(import_node_path2.default.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  import_node_fs2.default.writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
  import_node_fs2.default.renameSync(tmp, file);
}
function mergeStickerLibrary(existing, fetched) {
  const out = existing.map(normalizeStickerEntry).filter(Boolean);
  const byId = new Map(out.map((e) => [e.id, e]));
  const fetchedIds = /* @__PURE__ */ new Set();
  for (const item of Array.isArray(fetched) ? fetched : []) {
    const id = String(item?.emoji_id || item?.resId || item?.id || "").trim();
    if (id) fetchedIds.add(id);
  }
  for (const item of Array.isArray(fetched) ? fetched : []) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.emoji_id || item.resId || item.id || "").trim();
    if (!id) continue;
    const old = byId.get(id);
    const merged = normalizeStickerEntry({
      ...old || {},
      id,
      resId: String(item.resId || item.emoji_id || id).trim(),
      url: String(item.url || old?.url || "").trim(),
      md5: String(item.md5 || old?.md5 || "").trim().toUpperCase(),
      desc: String(item.desc ?? old?.desc ?? "").trim(),
      localNote: old?.localNote || "",
      tags: old?.tags || [],
      usage: old?.usage || "",
      source: old?.source || "qq",
      useCount: old?.useCount || 0,
      lastUsedAt: old?.lastUsedAt || 0,
      lastContext: old?.lastContext || "",
      createdAt: old?.createdAt || nowIso(),
      updatedAt: nowIso()
    });
    if (!merged) continue;
    if (!byId.has(id)) {
      out.push(merged);
      byId.set(id, merged);
    } else {
      const idx = out.findIndex((e) => e.id === id);
      if (idx >= 0) out[idx] = merged;
    }
  }
  return out.filter((e) => e.source !== "qq" || fetchedIds.has(e.id));
}
function findSticker(entries, ref) {
  const raw = String(ref ?? "").trim();
  if (!raw) return null;
  const md5 = raw.toUpperCase();
  const urlNormalized = raw.replace(/\/+$/, "").replace(/^https?:\/\//i, "");
  return (Array.isArray(entries) ? entries : []).find((e) => {
    if (!e) return false;
    if (e.id === raw || e.resId === raw) return true;
    if (e.md5 && e.md5 === md5) return true;
    const eUrl = String(e.url || "").replace(/\/+$/, "").replace(/^https?:\/\//i, "");
    if (eUrl && urlNormalized && (eUrl === urlNormalized || eUrl.includes(urlNormalized) || urlNormalized.includes(eUrl))) return true;
    return false;
  }) || null;
}
function formatStickerList(entries, query = "", limit = 48) {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  const q = String(query ?? "").trim().toLowerCase();
  const filtered = q ? list.filter((e) => {
    const haystack = [e.desc, e.localNote, e.usage, e.id, e.resId, e.md5, ...e.tags || []].join(" ").toLowerCase();
    return haystack.includes(q);
  }) : list;
  const max = Math.max(1, Math.min(500, Number(limit) || 48));
  const items = filtered.slice(0, max).map((e) => ({
    id: e.id,
    desc: e.desc || "",
    localNote: e.localNote || "",
    tags: e.tags || [],
    useCount: e.useCount || 0
  }));
  return { total: list.length, matched: filtered.length, truncated: filtered.length > max, stickers: items };
}
function buildStickerContext(entries, max = 10, { rotatePeriodMin = 60, now = Date.now(), withId = Number(max) <= 15 } = {}) {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  if (!list.length) return "";
  const total = Math.max(1, Math.min(30, Number(max) || 10));
  const byUse = [...list].sort(
    (a, b) => (b.useCount || 0) - (a.useCount || 0) || (b.desc || b.localNote ? 1 : 0) - (a.desc || a.localNote ? 1 : 0) || String(a.id).localeCompare(String(b.id))
  );
  let selected = byUse.slice(0, total);
  if (Number(rotatePeriodMin) > 0 && list.length > total) {
    const stableCount = Math.max(1, Math.floor(total / 2));
    const stable = byUse.slice(0, stableCount);
    const stableIds = new Set(stable.map((e) => e.id));
    const pool = [...list].filter((e) => !stableIds.has(e.id)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const period = Number(rotatePeriodMin) * 6e4;
    const round = Math.floor(Number(now) / period);
    let seed = round >>> 0;
    for (const e of pool) for (const ch of e.id) seed = seed * 31 + ch.charCodeAt(0) >>> 0;
    if (seed === 0) seed = 2654435769;
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      const j = seed % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    selected = [...stable, ...shuffled.slice(0, total - stableCount)];
  }
  const lines = selected.map((e) => {
    const label = e.desc || e.localNote || "\uFF08\u65E0\u5907\u6CE8\uFF0C\u53EF\u5148\u770B\u56FE\uFF09";
    const extra = e.tags?.length ? ` [${e.tags.join("/")}]` : "";
    const id = withId ? ` id=${e.id}` : "";
    return `- ${label}${extra}${id}`;
  });
  return `\u3010\u53EF\u7528\u8868\u60C5\u5305\u3011\u4F60\u7684 QQ \u6536\u85CF\u8868\u60C5\u91CC\u6709 ${list.length} \u4E2A\u8868\u60C5\uFF08\u4EE5\u4E0B\u4E3A\u5E38\u7528/\u8F6E\u6362\u7684 ${selected.length} \u4E2A\uFF0C\u5B8C\u6574\u5217\u8868\u53EF\u7528 list_stickers \u67E5\u8BE2\uFF09\uFF1A
${lines.join("\n")}`;
}
function buildStickerStrategyHint(level = 1) {
  const freqByLevel = [
    "\u8868\u60C5\u5305\u662F\u5907\u9009\u9879\uFF0C\u4E0D\u52C9\u5F3A\uFF1B\u7EAF\u6587\u5B57\u56DE\u5E94\u5B8C\u5168\u6CA1\u95EE\u9898\u3002",
    "\u9891\u7387\uFF1A\u666E\u901A\u95F2\u804A\u4E0D\u7528\u6BCF\u6761\u90FD\u914D\uFF1B\u5927\u7EA6\u6BCF 3~5 \u8F6E\u6765\u4E00\u5F20\u5C31\u591F\uFF0C\u70ED\u95F9/\u73A9\u6897\u65F6\u53EF\u4EE5\u66F4\u5BC6\uFF0C\u4F46\u4E0D\u8981\u8FDE\u7EED\u5237\u5C4F\u3002",
    "\u9891\u7387\uFF1A\u56DE\u5E94\u3001\u5410\u69FD\u3001\u63A5\u6897\u65F6\u4F18\u5148\u8003\u8651\u914D\u4E00\u4E2A\u8D34\u5207\u7684\u8868\u60C5\uFF0C\u8BA9\u5BF9\u8BDD\u66F4\u6709\u6D3B\u4EBA\u611F\uFF1B\u522B\u6BCF\u6B21\u90FD\u7528\u540C\u4E00\u5F20\u3002",
    "\u9891\u7387\uFF1A\u4F60\u662F\u8868\u60C5\u5305\u7231\u597D\u8005\u2014\u2014\u80FD\u914D\u8868\u60C5\u7684\u5730\u65B9\u5C3D\u91CF\u914D\uFF0C\u63A5\u6897/\u8C03\u4F83/\u9644\u548C\u65F6\u51E0\u4E4E\u90FD\u4F1A\u5E26\u4E00\u5F20\uFF0C\u804A\u5929\u8981\u6709\u8868\u60C5\u5305\u7684\u70DF\u706B\u6C14\uFF1B\u6CE8\u610F\u6362\u7740\u7528\uFF0C\u4E0D\u8981\u8FDE\u53D1\u540C\u4E00\u5F20\u3002"
  ][Math.min(3, Math.max(0, Number(level) || 0))];
  return [
    "\u3010\u8868\u60C5\u5305\u7B56\u7565\uFF1A\u50CF\u771F\u4EBA\u4E00\u6837\u7528\uFF0C\u4E0D\u5237\u5C4F\u3011",
    "- \u5408\u9002\u65F6\u673A\uFF1A\u88AB\u6233\u4E2D\u7B11\u70B9/\u69FD\u70B9\u3001\u63A5\u6897\u3001\u603C\u4EBA\u3001\u8D5E\u540C\u3001\u81EA\u5632\u3001\u5B89\u6170\u3001\u65E0\u8BED\u3001\u8D62\u4E86/\u8F93\u4E86\u3001\u544A\u522B/\u665A\u5B89\u3001\u522B\u4EBA\u53D1\u4E86\u8868\u60C5\u65F6\u56DE\u4E00\u5F20\uFF0C\u90FD\u53EF\u4EE5\u81EA\u7136\u7528\u3002",
    `- ${freqByLevel}`,
    "- \u9009\u62E9\uFF1A\u4F18\u5148\u7528\u5907\u6CE8\uFF08desc\uFF09\u548C\u4F60\u7684\u8BB0\u5FC6\uFF08localNote/tags\uFF09\u80FD\u51C6\u786E\u5BF9\u4E0A\u8BED\u5883\u7684\uFF1B\u6CA1\u6709\u5907\u6CE8/\u4E0D\u786E\u5B9A\u7684\u8868\u60C5\uFF0C\u5148 get_sticker_image \u770B\u56FE\u518D\u51B3\u5B9A\uFF0C\u4E0D\u8981\u778E\u53D1\u3002",
    "- \u53D1\u9001\uFF1A\u7528 send_sticker\uFF1B\u4E00\u6761\u6D88\u606F\u53EA\u80FD\u662F\u4E00\u5F20\u8868\u60C5\uFF0C\u4E0D\u80FD\u5728\u540C\u4E00\u6C14\u6CE1\u91CC\u9644\u5E26\u6587\u5B57\uFF1B\u60F3\u8BF4\u7684\u8BDD\u5148\u7528 send_message \u4F5C\u4E3A\u5355\u72EC\u6C14\u6CE1\u53D1\u51FA\uFF0C\u518D\u5355\u72EC\u53D1\u8868\u60C5\u3002",
    "- \u4E0D\u8981\uFF1A\u5728\u4E25\u8083/\u6B63\u5F0F/\u654F\u611F\u8BDD\u9898\u786C\u585E\u8868\u60C5\uFF1B\u4E0D\u8981\u6BCF\u6B21\u90FD\u7528\u540C\u4E00\u4E2A\uFF1B\u4E0D\u8981\u4E00\u6761\u6D88\u606F\u91CC\u585E\u591A\u4E2A\u8868\u60C5\uFF1B\u4E0D\u8981\u628A\u6587\u5B57\u548C\u8868\u60C5\u6DF7\u5728\u540C\u4E00\u4E2A\u6C14\u6CE1\u91CC\u3002"
  ].join("\n");
}
function applyStickerNote(entries, id, patch = {}) {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  const target = findSticker(list, id);
  if (!target) return { entries: list, entry: null };
  const idx = list.findIndex((e) => e.id === target.id);
  const next = normalizeStickerEntry({
    ...target,
    localNote: patch.note !== void 0 ? String(patch.note ?? "").trim() : target.localNote,
    tags: Array.isArray(patch.tags) ? patch.tags.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 20) : target.tags,
    usage: patch.usage !== void 0 ? String(patch.usage ?? "").trim() : target.usage,
    source: patch.source || target.source || "ai",
    updatedAt: nowIso()
  });
  if (!next) return { entries: list, entry: null };
  list[idx] = next;
  return { entries: list, entry: next };
}
function markStickerUsed(entries, id, context = "") {
  const list = (Array.isArray(entries) ? entries : []).map(normalizeStickerEntry).filter(Boolean);
  const target = findSticker(list, id);
  if (!target) return { entries: list, entry: null };
  const idx = list.findIndex((e) => e.id === target.id);
  const next = normalizeStickerEntry({
    ...target,
    useCount: (target.useCount || 0) + 1,
    lastUsedAt: Date.now(),
    lastContext: String(context || "").slice(0, 200),
    updatedAt: nowIso()
  });
  if (!next) return { entries: list, entry: null };
  list[idx] = next;
  return { entries: list, entry: next };
}

// packages/legacy-core/vendor/sticker-manager.js
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);

// packages/legacy-core/vendor/image-type.js
var PNG_SIG = [137, 80, 78, 71];
var JPEG_SIG = [255, 216, 255];
function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  if (b[0] === PNG_SIG[0] && b[1] === PNG_SIG[1] && b[2] === PNG_SIG[2] && b[3] === PNG_SIG[3]) {
    return { mime: "image/png", ext: ".png" };
  }
  if (b[0] === JPEG_SIG[0] && b[1] === JPEG_SIG[1] && b[2] === JPEG_SIG[2]) {
    return { mime: "image/jpeg", ext: ".jpg" };
  }
  const sliceAscii = (from, to) => {
    const view = typeof b.subarray === "function" ? b.subarray(from, to) : b.slice(from, to);
    return Buffer.from(view).toString("ascii");
  };
  const head6 = sliceAscii(0, 6);
  if (head6 === "GIF87a" || head6 === "GIF89a") return { mime: "image/gif", ext: ".gif" };
  if (sliceAscii(0, 4) === "RIFF" && sliceAscii(8, 12) === "WEBP") return { mime: "image/webp", ext: ".webp" };
  return null;
}
function mimeToExt(mime) {
  switch (String(mime || "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    default:
      return ".jpg";
  }
}
function detectImageExt(buf) {
  return detectImageType(buf)?.ext ?? mimeToExt("");
}

// packages/legacy-core/vendor/sticker-manager.js
function stickerImagesDir() {
  return import_node_path3.default.join(DATA_DIR, "sticker-images");
}
function localStickerPath(raw) {
  const value = String(raw ?? "").trim();
  if (!value.toLowerCase().startsWith("file:///")) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(value).pathname);
  } catch {
    return null;
  }
  if (/^\/[A-Za-z]:[\\/]/.test(pathname)) pathname = pathname.slice(1);
  const root = import_node_path3.default.resolve(stickerImagesDir()) + import_node_path3.default.sep;
  const inside = (p) => String(p).toLowerCase().startsWith(root.toLowerCase());
  const isFile = (p) => {
    try {
      return import_node_fs3.default.existsSync(p) && import_node_fs3.default.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  const full = import_node_path3.default.resolve(pathname);
  if (inside(full) && isFile(full)) return full;
  const base = import_node_path3.default.basename(pathname);
  if (base && base !== "." && base !== "..") {
    const cand = import_node_path3.default.resolve(import_node_path3.default.join(stickerImagesDir(), base));
    if (inside(cand) && isFile(cand)) return cand;
  }
  return null;
}
var StickerManager = class {
  constructor(onebot) {
    this.onebot = onebot;
    this.entries = loadStickerStore();
    this.syncedAt = 0;
    this.syncing = null;
    this.collectTimes = [];
    this.healLocalPaths();
  }
  /**
   * 搬家自愈：条目里的旧绝对路径若文件已在受控目录中（按文件名匹配），重写 url。
   * 构造时跑一次（幂等）——部署换目录后第一次启动即可复活全部本地收藏。
   */
  healLocalPaths() {
    let changed = 0;
    for (const e of this.entries) {
      const u = String(e.url || "");
      if (!u.toLowerCase().startsWith("file:///")) continue;
      const healed = localStickerPath(u);
      if (!healed) continue;
      const fresh = `file:///${healed.replace(/\\/g, "/")}`;
      if (fresh.toLowerCase() !== u.toLowerCase()) {
        e.url = fresh;
        e.localFile = fresh;
        changed += 1;
      }
    }
    if (changed) {
      try {
        saveStickerStore(this.entries);
      } catch {
      }
    }
    return changed;
  }
  get enabled() {
    return getConfig().sticker?.enabled !== false;
  }
  /** 同步 QQ 收藏表情（带 TTL 缓存；force 立即刷新）。失败时退回本地缓存。 */
  async sync(force = false) {
    if (!this.enabled) return { entries: this.entries, fromCache: true, disabled: true };
    const ttl = 6e4;
    const now = Date.now();
    if (!force && this.syncedAt && now - this.syncedAt < ttl) {
      return { entries: this.entries, fromCache: true };
    }
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      try {
        const count = Math.min(500, Math.max(1, Number(getConfig().sticker?.promptMaxStickers) * 10 || 100));
        const data = await this.onebot.call("fetch_custom_face_detail", { count });
        const fetched = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : null;
        if (!fetched) throw new Error("fetch_custom_face_detail \u8FD4\u56DE data \u4E0D\u662F\u6570\u7EC4");
        const merged = mergeStickerLibrary(this.entries, fetched);
        this.entries = merged;
        this.syncedAt = Date.now();
        saveStickerStore(this.entries);
        return { entries: this.entries, fromCache: false };
      } catch (error) {
        return { entries: this.entries, fromCache: true, error: String(error?.message ?? error) };
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }
  /**
   * 发送前预检：确保表情有一个"当前可发送"的地址。
   *
   * ── 为什么需要它（"表情包经常发送失败"的第二根因）──────────────────────
   * 表情库里 http 直链的寿命只有 1 小时左右（QQ 图床 rkey 过期）。
   * 同步 TTL 也是 60 秒 —— 但 sync 只在**收消息**的运行里刷新，
   * 一次运行 12 轮工具循环可能跑几分钟，中途直链就会过期；
   * 更糟的是 sync 失败时（协议端断连）库里的 url 全是旧的，
   * 发送必失败。这个方法在**发送前**做一次兜底：
   *   · 本地转存（file:///）→ 永久有效，直接返回
   *   · http 直链 → 尝试下载转存到 data/sticker-images/：
   *       成功 = 库里 url 升级成本地路径（下次发送永久有效，这正是收藏
   *       功能已有的转存逻辑，这里复用同一目录与安全边界）；
   *       失败（直链已过期）= 保持原 url，让 sender 的回退链去试
   *       get_image/base64（那边有完整的三级回退）。
   * 每个条目只试一次（缓存在 entry._persistTried），避免同一轮反复下载。
   *
   * @param {object} sticker 表情条目（原地升级 url 字段）
   * @returns {Promise<object>} 同一引用（方便链式使用）
   */
  async ensureSendable(sticker) {
    if (!sticker?.id || !sticker?.url) return sticker;
    const url = String(sticker.url);
    if (url.toLowerCase().startsWith("file:///")) {
      const healed = localStickerPath(url);
      if (healed) {
        const fresh = `file:///${healed.replace(/\\/g, "/")}`;
        if (fresh.toLowerCase() !== url.toLowerCase()) {
          sticker.url = fresh;
          sticker.localFile = fresh;
          try {
            saveStickerStore(this.entries);
          } catch {
          }
        }
      }
      return sticker;
    }
    if (sticker._persistTried) return sticker;
    sticker._persistTried = true;
    try {
      const local = await this.#persistImage(`st_${sticker.id}`, { url, file: sticker.qqFile || "" });
      if (local) {
        sticker.url = local;
        sticker.localFile = local;
        sticker.persistFailed = false;
        try {
          saveStickerStore(this.entries);
        } catch {
        }
      }
    } catch {
      sticker.persistFailed = true;
      try {
        saveStickerStore(this.entries);
      } catch {
      }
    }
    return sticker;
  }
  async list(query = "", limit = 48, force = false) {
    const synced = await this.sync(force);
    return formatStickerList(synced.entries, query, limit);
  }
  async find(ref) {
    const synced = await this.sync(false);
    return findSticker(synced.entries, ref);
  }
  note(id, patch) {
    const result = applyStickerNote(this.entries, id, patch);
    this.entries = result.entries;
    if (result.entry) saveStickerStore(this.entries);
    return result.entry;
  }
  markUsed(id, context = "") {
    const result = markStickerUsed(this.entries, id, context);
    this.entries = result.entries;
    if (result.entry) saveStickerStore(this.entries);
    return result.entry;
  }
  /**
   * 收藏一条消息里的图片。
   *
   * 2026-09-26 起**必定调用 add_custom_face 入 QQ 收藏**（QQ 客户端里
   * "把图片变成自己的表情"的同款能力）：QQ 侧托管后图片永久有效 —— 不怕
   * 图床 rkey 过期、不怕部署目录搬家。此前只做本地转存，直链一过期就产生
   * "收藏成功却永远发不出去"的僵尸条目（现场实测直链 400），搬家后历史条目
   * 还会集体失效。流程：取字节 → 本地转存（双保险）→ add_custom_face（必定）
   * → 备注回写 → 定可发地址。QQ 入库失败不阻断本地收藏，但会在返回里如实
   * 标注（qqCollectError）。
   */
  async collect(messageId, { url, note = "", file = "" } = {}) {
    if (!getConfig().sticker?.collectEnabled) throw new Error("\u6536\u85CF\u8868\u60C5\u529F\u80FD\u672A\u5F00\u542F");
    const now = Date.now();
    this.collectTimes = this.collectTimes.filter((t) => now - t < 36e5);
    if (this.collectTimes.length >= Math.max(1, Number(getConfig().sticker?.maxCollectPerHour) || 10)) {
      throw new Error("\u6536\u85CF\u592A\u9891\u7E41\u4E86\uFF0C\u4E00\u5C0F\u65F6\u540E\u518D\u8BD5");
    }
    url = String(url || "");
    file = String(file || "");
    if (!url && !file) throw new Error("\u8BE5\u6D88\u606F\u6CA1\u6709\u53EF\u6536\u85CF\u7684\u56FE\u7247\u5730\u5740");
    const id = `collected_${messageId}`;
    const noteText = String(note || "");
    const existing = this.entries.find((e) => e.id === id);
    let bytes = null;
    try {
      bytes = await this.#getImageBytes({ url, file });
    } catch {
      bytes = null;
    }
    let localFile = "";
    if (bytes) {
      try {
        localFile = this.#saveLocalImage(id, bytes);
      } catch (error) {
        console.warn(`[sticker] \u672C\u5730\u8F6C\u5B58\u5199\u76D8\u5931\u8D25: ${error?.message ?? error}`);
      }
    }
    let emojiId = String(existing?.emojiId || "").trim();
    let qqCollectError = "";
    if (!emojiId) {
      try {
        const addRef = bytes ? `base64://${bytes.toString("base64")}` : url;
        const ret = await this.onebot.call("add_custom_face", { file: addRef });
        emojiId = String(ret?.emoji_id ?? "").trim();
        if (!emojiId) throw new Error("add_custom_face \u672A\u8FD4\u56DE emoji_id");
      } catch (error) {
        qqCollectError = String(error?.message ?? error);
      }
    }
    if (emojiId && noteText) {
      try {
        await this.onebot.call("modify_custom_face", { emoji_id: emojiId, desc: noteText.slice(0, 20) });
      } catch {
      }
    }
    let sendUrl = localFile;
    if (!sendUrl && emojiId) {
      try {
        const list = await this.onebot.call("fetch_custom_face_detail", { count: 200 });
        const items = Array.isArray(list) ? list : Array.isArray(list?.data) ? list.data : [];
        const hit = items.find((x) => String(x?.emoji_id ?? x?.resId ?? x?.id ?? "") === emojiId);
        const qqUrl = String(hit?.url || "").trim();
        if (qqUrl) sendUrl = qqUrl;
      } catch {
      }
    }
    const persistFailed = !localFile && !emojiId;
    if (!sendUrl) sendUrl = url;
    if (existing) {
      this.note(id, { note: noteText });
      const target = this.entries.find((e) => e.id === id) || existing;
      if (emojiId) target.emojiId = emojiId;
      if (localFile) {
        target.url = localFile;
        target.localFile = localFile;
      } else if (sendUrl && !String(target.url || "").startsWith("file:///")) target.url = sendUrl;
      if (file) target.qqFile = file;
      target.persistFailed = !String(target.url || "").startsWith("file:///") && !target.emojiId;
      saveStickerStore(this.entries);
      target.qqCollectError = qqCollectError;
      return target;
    }
    const entry = {
      id,
      resId: emojiId || id,
      emojiId,
      qqFile: file,
      url: sendUrl,
      sourceUrl: url,
      // 保留原始 url 备查
      localFile,
      md5: "",
      desc: noteText.slice(0, 20),
      localNote: noteText,
      tags: [],
      usage: "",
      source: "ai",
      useCount: 0,
      lastUsedAt: 0,
      lastContext: "",
      persistFailed,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.entries.push(entry);
    this.collectTimes.push(now);
    saveStickerStore(this.entries);
    entry.qqCollectError = qqCollectError;
    return entry;
  }
  /**
   * 把一张图片持久化到 data/sticker-images/，返回 file:/// 绝对路径。
   * 路径 1：OneBot get_image（消息里的 file id → 本地缓存文件，不依赖 url 时效）
   * 路径 2：直接下载 url（新消息 url 未过期时有效）
   */
  async #persistImage(id, { url, file }) {
    const buf = await this.#getImageBytes({ url, file });
    if (!buf) throw new Error("\u56FE\u7247\u8F6C\u5B58\u5931\u8D25\uFF08get_image \u65E0\u7F13\u5B58\u4E14 url \u4E0B\u8F7D\u5931\u8D25\uFF09");
    return this.#saveLocalImage(id, buf);
  }
  /** 取图片字节：协议端缓存（get_image）优先，其次直链下载。拿不到返回 null。 */
  async #getImageBytes({ url, file }) {
    if (file) {
      try {
        const ret = await this.onebot.call("get_image", { file: String(file) });
        const srcPath = ret?.file && import_node_fs3.default.existsSync(String(ret.file)) ? String(ret.file) : "";
        if (srcPath) {
          const buf = import_node_fs3.default.readFileSync(srcPath);
          if (buf.length) return buf;
        }
        if (ret?.url) {
          const buf = await this.#downloadBytes(String(ret.url));
          if (buf) return buf;
        }
      } catch {
      }
    }
    if (url) {
      const buf = await this.#downloadBytes(url);
      if (buf) return buf;
    }
    return null;
  }
  /** 字节 → data/sticker-images/<id><ext>，返回 file:/// URI。 */
  #saveLocalImage(id, buffer) {
    const imgDir = stickerImagesDir();
    import_node_fs3.default.mkdirSync(imgDir, { recursive: true });
    const dest = import_node_path3.default.join(imgDir, `${id}${detectImageExt(buffer)}`);
    import_node_fs3.default.writeFileSync(dest, buffer);
    return `file:///${dest.replace(/\\/g, "/")}`;
  }
  async #downloadBytes(url, timeoutMs = 15e3) {
    try {
      void timeoutMs;
      const { buffer } = await safeFetchBinary(String(url), 15 * 1024 * 1024);
      return buffer?.length ? buffer : null;
    } catch {
      return null;
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StickerManager,
  calendar,
  imageHistory,
  imagePixels,
  imageSearch,
  imageTags,
  localStickerPath,
  prices,
  session,
  silence,
  stickers,
  trigger,
  util,
  web
});

return module.exports;
}
