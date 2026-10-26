import path from 'node:path';
import { definePlugin } from '@qq-harness/plugin-sdk';
import { chatKeySchema, chatSettingsSchema, configSchema, type HarnessConfig } from '@qq-harness/contracts';
import { configService } from '@qq-harness/domain';
import { deepMerge, readJson, writeJsonAtomic } from '@qq-harness/files';

export function configFile(dataDir: string, initial: unknown = {}) {
  return definePlugin({
    id: 'config-file',
    name: '配置与会话快照',
    setup(ctx) {
      const file = path.join(dataDir, 'config.json');
      let config = configSchema.parse(readJson(file, initial));
      const save = (value: HarnessConfig) => {
        writeJsonAtomic(file, value);
        config = value;
        ctx.host.publish('config.changed', {});
      };
      ctx.provide(configService, {
        get: () => structuredClone(config),
        public: () => {
          const value = structuredClone(config);
          const { apiKey, ...model } = value.model;
          const { accessToken, httpAccessToken, ...onebot } = value.onebot;
          return {
            ...value,
            model: { ...model, hasApiKey: Boolean(apiKey) },
            onebot: {
              ...onebot,
              hasAccessToken: Boolean(accessToken),
              hasHttpAccessToken: Boolean(httpAccessToken),
            },
          };
        },
        effective: (chatKey) => structuredClone(config.profiles[chatKey] ?? config.defaults),
        patch: (patch) => {
          ctx.assertActive();
          save(configSchema.parse(deepMerge(config, patch)));
        },
        saveProfile: (chatKey, patch) => {
          ctx.assertActive();
          chatKeySchema.parse(chatKey);
          const snapshot = chatSettingsSchema.parse(
            deepMerge(config.profiles[chatKey] ?? config.defaults, patch),
          );
          save({ ...config, profiles: { ...config.profiles, [chatKey]: snapshot } });
        },
        clearProfile: (chatKey) => {
          ctx.assertActive();
          const next = structuredClone(config);
          delete next.profiles[chatKey];
          save(next);
        },
      });
    },
  });
}
