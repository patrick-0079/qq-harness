import path from 'node:path';
import fs from 'node:fs';
import { definePlugin } from '@qq-harness/plugin-sdk';
import {
  chatKeySchema,
  chatSettingsSchema,
  configSchema,
  memoryScheduleOverrideSchema,
  type HarnessConfig,
} from '@qq-harness/contracts';
import { configService } from '@qq-harness/domain';
import {
  deepMerge,
  readJson,
  writeJsonAtomic,
  redactConfigTree,
  restoreMaskedSecrets,
  stripSessionSecrets,
} from '@qq-harness/files';
export function configFile(
  dataDir: string,
  initial: unknown = {},
  options: {
    initialConcurrency?: number;
    onChange?: (value: HarnessConfig) => void;
  } = {},
) {
  return definePlugin({
    id: 'config-file',
    name: '配置与会话快照',
    setup(ctx) {
      const file = path.join(dataDir, 'config.json');
      const loaded = {
        ...(readJson(file, initial) as Record<string, unknown>),
      };
      if (!Object.hasOwn(loaded, 'execution') && options.initialConcurrency !== undefined)
        loaded.execution = { concurrency: options.initialConcurrency };
      let config = configSchema.parse(loaded);
      // Upgrade persisted unlimited defaults once; a later explicit zero remains unlimited.
      if (config.managementVersion < 1) {
        if (fs.existsSync(file)) {
          const backup = file + '.before-management-v1';
          if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
          for (const settings of [config.defaults, ...Object.values(config.profiles)])
            if (settings.maxReplyMessages === 0) settings.maxReplyMessages = 5;
        }
        config.managementVersion = 1;
        if (fs.existsSync(file)) writeJsonAtomic(file, config);
      }
      config.defaults.legacySession = stripSessionSecrets(config.defaults.legacySession);
      for (const profile of Object.values(config.profiles))
        profile.legacySession = stripSessionSecrets(profile.legacySession);
      options.onChange?.(structuredClone(config));
      const save = (value: HarnessConfig) => {
        writeJsonAtomic(file, value);
        config = value;
        options.onChange?.(structuredClone(config));
        ctx.host.publish('config.changed', {});
      };
      ctx.provide(configService, {
        initialOperations: () => structuredClone(loaded.operations ?? {}),
        get: () => structuredClone(config),
        public: () => {
          const value = structuredClone(config);
          const { apiKey, ...model } = value.model;
          const { accessToken, httpAccessToken, ...onebot } = value.onebot;
          return {
            ...value,
            operations: redactConfigTree({
              ...value.operations,
              opencodeGoKey: value.operations.opencodeGoKey ? '******' : '',
              deepseekKey: value.operations.deepseekKey ? '******' : '',
              glmKey: value.operations.glmKey ? '******' : '',
            }),
            defaults: {
              ...value.defaults,
              legacySession: redactConfigTree(value.defaults.legacySession),
            },
            profiles: Object.fromEntries(
              Object.entries(value.profiles).map(([k, v]) => [
                k,
                { ...v, legacySession: redactConfigTree(v.legacySession) },
              ]),
            ),
            legacyGlobal: redactConfigTree(value.legacyGlobal),
            providers: value.providers.map(({ apiKey, ...provider }) => ({
              ...provider,
              hasApiKey: Boolean(apiKey),
            })),
            model: { ...model, hasApiKey: Boolean(apiKey) },
            onebot: {
              ...onebot,
              hasAccessToken: Boolean(accessToken),
              hasHttpAccessToken: Boolean(httpAccessToken),
            },
          };
        },
        effective: (chatKey) =>
          structuredClone({
            ...(config.profiles[chatKey] ?? config.defaults),
            memory: {
              ...config.defaults.memory,
              ...config.memoryOverrides[chatKey],
            },
          }),
        patch: (patch) => {
          ctx.assertActive();
          patch = restoreMaskedSecrets(patch, config);
          if (patch && typeof patch === 'object' && 'providers' in patch && Array.isArray(patch.providers))
            patch = {
              ...patch,
              providers: patch.providers.map((value: unknown) =>
                value && typeof value === 'object' && 'id' in value && !('apiKey' in value)
                  ? {
                      ...value,
                      apiKey: config.providers.find((provider) => provider.id === value.id)?.apiKey ?? '',
                    }
                  : value,
              ),
            };
          const next = configSchema.parse(deepMerge(config, patch));
          if (patch && typeof patch === 'object' && 'systemPresence' in patch && next.systemPresence)
            next.paused = next.systemPresence.state === 'offline';
          else if (next.paused !== config.paused && config.systemPresence)
            next.systemPresence = {
              ...config.systemPresence,
              state: next.paused ? 'offline' : 'online',
              revision: config.systemPresence.revision + 1,
              changedAt: Date.now(),
              source: 'config',
              actor: 'system',
              reason: '',
            };
          for (const kind of ['personas', 'prompts'] as const) {
            for (const previous of config[kind]) {
              if (!previous.readOnly && previous.id !== 'builtin-compatible') continue;
              const replacement = next[kind].find((item) => item.id === previous.id);
              if (
                !replacement ||
                replacement.name !== previous.name ||
                replacement.text !== previous.text ||
                (previous.readOnly && !replacement.readOnly)
              )
                throw Error('内置人设与提示词只读，请复制为自定义项后修改');
            }
            for (const item of next[kind]) {
              if (item.readOnly && !config[kind].some((old) => old.id === item.id && old.readOnly))
                throw Error('不能将自定义目录项标记为内置');
            }
          }
          next.defaults.legacySession = stripSessionSecrets(next.defaults.legacySession);
          for (const profile of Object.values(next.profiles))
            profile.legacySession = stripSessionSecrets(profile.legacySession);
          save(next);
        },
        saveProfile: (chatKey, patch) => {
          ctx.assertActive();
          chatKeySchema.parse(chatKey);
          const created = !config.profiles[chatKey];
          const snapshot = chatSettingsSchema.parse(
            deepMerge(config.profiles[chatKey] ?? config.defaults, patch),
          );
          snapshot.legacySession = stripSessionSecrets(snapshot.legacySession);
          save({
            ...config,
            profiles: { ...config.profiles, [chatKey]: snapshot },
          });
          if (created) ctx.host.publish('profile.created', { chatKey });
        },
        clearProfile: (chatKey) => {
          ctx.assertActive();
          const next = structuredClone(config);
          if (Object.hasOwn(next.profiles, chatKey) && !next.admissions.includes(chatKey))
            next.admissions.push(chatKey);
          delete next.profiles[chatKey];
          delete next.memoryOverrides[chatKey];
          save(next);
          ctx.host.publish('profile.restored', { chatKey, section: 'all' });
        },
        restoreProfile: (chatKey, section) => {
          ctx.assertActive();
          chatKeySchema.parse(chatKey);
          const sections: Record<string, string[]> = {
            persona: ['persona', 'personaSelection'],
            model: ['modelSelection'],
            memory: ['scratchpadMaxDays', 'memoryModel'],
            chat: [
              'online',
              'trigger',
              'keywords',
              'wakeDelayMs',
              'drainDelayMs',
              'runTimeoutMs',
              'queueTimeoutMs',
              'maxRounds',
              'maxReplyMessages',
              'replyPolicy',
              'commandMute',
              'silencePolicy',
              'behavior',
            ],
            tools: ['plugins', 'tools'],
            sticker: [],
            images: [],
          };
          const keys = sections[section];
          if (!keys) throw new Error('未知设置分区');
          const next = structuredClone(config);
          const profile = next.profiles[chatKey];
          if (profile)
            for (const key of keys)
              (profile as Record<string, unknown>)[key] = (next.defaults as Record<string, unknown>)[key];
          const legacySections: Record<string, string[]> = {
            persona: ['persona'],
            model: ['api'],
            memory: ['memory'],
            chat: ['store', 'proactive', 'chatActive', 'availability', 'commandMute', 'blocklist', 'run'],
            tools: ['tools', 'skills'],
            sticker: ['sticker'],
            images: [],
          };
          if (profile)
            for (const key of legacySections[section] ?? []) {
              if (Object.hasOwn(next.defaults.legacySession, key))
                profile.legacySession[key] = structuredClone(next.defaults.legacySession[key]);
              else delete profile.legacySession[key];
            }
          if (profile && section === 'images') {
            const skills = {
              ...((profile.legacySession.skills as Record<string, unknown>) ?? {}),
            };
            const defaults = (next.defaults.legacySession.skills as Record<string, unknown>) ?? {};
            if (Object.hasOwn(defaults, 'image-studio'))
              skills['image-studio'] = structuredClone(defaults['image-studio']);
            else delete skills['image-studio'];
            profile.legacySession.skills = skills;
          }
          if (section === 'memory') delete next.memoryOverrides[chatKey];
          save(configSchema.parse(next));
          ctx.host.publish('profile.restored', { chatKey, section });
        },
        saveMemorySchedule: (chatKey, patch) => {
          ctx.assertActive();
          const next = structuredClone(config);
          if (chatKey) {
            chatKeySchema.parse(chatKey);
            if (patch === null) delete next.memoryOverrides[chatKey];
            else
              next.memoryOverrides[chatKey] = {
                ...next.memoryOverrides[chatKey],
                ...memoryScheduleOverrideSchema.parse(patch),
              };
          } else
            next.defaults.memory = {
              ...next.defaults.memory,
              ...memoryScheduleOverrideSchema.parse(patch),
            };
          save(configSchema.parse(next));
        },
      });
    },
  });
}
