import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createApplication } from "../apps/server/src/app.js";
import {
  configService,
  conversationService,
  modelService,
  storageService,
  adapterService,
  type ModelResponse,
} from "@qq-harness/domain";
const apps: Awaited<ReturnType<typeof createApplication>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0).reverse()) await app.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const silent = (activeTopic?: boolean): ModelResponse => ({
  message: {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "finish",
        type: "function",
        function: {
          name: "finish",
          arguments: JSON.stringify({
            mode: "silent",
            silentReason: "无须回应",
            ...(activeTopic === undefined ? {} : { activeTopic }),
          }),
        },
      },
    ],
  },
  usage: { input: 0, output: 0 },
});
async function boot(patch: Record<string, unknown> = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T00:00:00Z"));
  const app = await createApplication({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "harness-behavior-")),
    v2Managers: false,
    extensionHotReload: false,
    initialConfig: {
      acceptAllSessions: true,
      send: { minIntervalMs: 0, dedupeMs: 0 },
      defaults: {
        wakeDelayMs: 100,
        drainDelayMs: 100,
        memory: { enabled: false },
        behavior: {
          enabled: true,
          reply: { other: { enabled: true, probability: 0 } },
        },
        ...patch,
      },
    },
  });
  apps.push(app);
  let seq = 0;
  const ingest = (
    text: string,
    atMe = false,
    extra: Record<string, unknown> = {},
  ) =>
    app.runtime
      .use(conversationService)
      .ingest({
        id: String(++seq),
        chatKey: "group:1",
        senderId: "2",
        senderName: "甲",
        text,
        atMe,
        timestamp: Date.now(),
        ...extra,
      });
  return { ...app, ingest };
}
test("概率未命中保留未读并按上限沉入历史，条件命中聚批，指令禁言仍响应 @", async () => {
  const app = await boot({
    commandMute: { enabled: true, command: "/安静", durationMin: 30 },
    behavior: {
      enabled: true,
      maxPendingUnread: 2,
      reply: {
        other: { enabled: true, probability: 0 },
        keyword: { enabled: true, probability: 100 },
      },
      keywordRules: [{ id: "go", pattern: "开始" }],
    },
  });
  const model = vi
    .spyOn(app.runtime.use(modelService), "complete")
    .mockResolvedValue(silent());
  for (const text of ["甲", "乙", "丙"]) await app.ingest(text);
  await vi.advanceTimersByTimeAsync(200);
  expect(model).not.toHaveBeenCalled();
  expect(
    app.runtime
      .use(storageService)
      .unread("group:1")
      .map((m) => m.text),
  ).toEqual(["乙", "丙"]);
  await app.ingest("开始");
  await vi.advanceTimersByTimeAsync(200);
  expect(model).toHaveBeenCalledTimes(1);
  expect(app.runtime.use(storageService).unread("group:1")).toHaveLength(0);
  await app.ingest("/安静", true);
  await app.ingest("普通消息");
  await vi.advanceTimersByTimeAsync(200);
  expect(model).toHaveBeenCalledTimes(1);
  await app.ingest("点名", true);
  await vi.advanceTimersByTimeAsync(200);
  expect(model).toHaveBeenCalledTimes(2);
  app.runtime.use(configService).saveProfile("group:1", { online: false });
  await app.ingest("下线消息", true);
  await vi.advanceTimersByTimeAsync(200);
  expect(model).toHaveBeenCalledTimes(2);
  expect(app.runtime.use(storageService).unread("group:1")).toHaveLength(0);
  app.runtime.use(configService).saveProfile("group:1", { online: true });
  await vi.advanceTimersByTimeAsync(200);
  expect(model).toHaveBeenCalledTimes(2);
});
test("未发言追问次数受配置约束，活跃期开启后不续期，关闭后按原概率判断", async () => {
  const app = await boot({
    behavior: {
      enabled: true,
      run: { maxNudges: 2, retryAttempts: 0 },
      chatActive: { enabled: true, maxMinutes: 1 },
    },
  });
  const model = vi
    .spyOn(app.runtime.use(modelService), "complete")
    .mockResolvedValue({
      message: { role: "assistant", content: "内部文字不发送" },
      usage: { input: 0, output: 0 },
    });
  await app.ingest("需要处理", true);
  await vi.advanceTimersByTimeAsync(200);
  expect(model).toHaveBeenCalledTimes(3);
  expect(app.runtime.use(adapterService).sent).toHaveLength(0);
  expect(app.runtime.use(storageService).archives()[0]).toMatchObject({
    status: "silent",
    reason: expect.stringContaining("追问"),
  });
  model.mockResolvedValue(silent(true));
  await app.ingest("开活跃", true);
  await vi.advanceTimersByTimeAsync(200);
  const deadline = app.runtime
    .use(storageService)
    .state("conversation-active", "group:1");
  expect(Number(deadline)).toBeGreaterThan(Date.now());
  await app.ingest("活跃期普通消息");
  await vi.advanceTimersByTimeAsync(200);
  expect(
    app.runtime.use(storageService).state("conversation-active", "group:1"),
  ).toBe(deadline);
  model.mockResolvedValue(silent(false));
  await app.ingest("关活跃");
  await vi.advanceTimersByTimeAsync(200);
  expect(
    app.runtime.use(storageService).state("conversation-active", "group:1"),
  ).toBe(0);
  const calls = model.mock.calls.length;
  await app.ingest("不命中");
  await vi.advanceTimersByTimeAsync(200);
  expect(model).toHaveBeenCalledTimes(calls);
});
test("没有成功发送才自动重试，已成功发送的失败运行不会再次发言", async () => {
  const app = await boot({
      behavior: { enabled: true, run: { retryAttempts: 1 } },
    }),
    model = vi.spyOn(app.runtime.use(modelService), "complete");
  model
    .mockRejectedValueOnce(new Error("模拟网络失败"))
    .mockResolvedValue(silent());
  await app.ingest("第一次", true);
  await vi.advanceTimersByTimeAsync(1600);
  expect(model).toHaveBeenCalledTimes(2);
  expect(app.runtime.use(storageService).archives()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ status: "failed" }),
      expect.objectContaining({ status: "silent" }),
    ]),
  );
  model.mockClear();
  model
    .mockResolvedValueOnce({
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "send",
            type: "function",
            function: {
              name: "send_message",
              arguments: '{"messages":["已发出"]}',
            },
          },
        ],
      },
      usage: { input: 0, output: 0 },
    })
    .mockRejectedValue(new Error("发送之后模型失败"));
  await app.ingest("第二次", true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(model).toHaveBeenCalledTimes(2);
  expect(app.runtime.use(adapterService).sent).toHaveLength(1);
});
test("主动话题按冷场和固定检查间隔判定，不补发下线积压", async () => {
  const app = await boot({
      behavior: {
        enabled: true,
        proactive: {
          enabled: true,
          checkIntervalMinMs: 60000,
          checkIntervalMaxMs: 60000,
          idleThresholdMs: 60000,
          probability: 1,
        },
      },
    }),
    model = vi
      .spyOn(app.runtime.use(modelService), "complete")
      .mockResolvedValue(silent());
  await app.ingest("之前的消息", false, { timestamp: Date.now() - 120000 });
  await vi.advanceTimersByTimeAsync(2000);
  expect(model).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.mock.calls[0]?.[0])).toContain("寻找话题");
  expect(app.runtime.use(storageService).unread("group:1")).toHaveLength(0);
  app.runtime.use(configService).saveProfile("group:1", { online: false });
  await vi.advanceTimersByTimeAsync(120000);
  expect(model).toHaveBeenCalledTimes(1);
});
