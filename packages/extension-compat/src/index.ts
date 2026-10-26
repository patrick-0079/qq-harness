export { createLegacyRuntime } from '../generated/runtime.mjs';
export { ExtensionHost, EXTENSION_DIRS, redact } from './host.js';
export { extensionService } from './service.js';
export { legacyManager } from './native-manager.js';
export type { ExtensionService } from './service.js';
export type {
  ExtensionDescriptor,
  ExtensionHostOptions,
  ExtensionEnvironment,
  LegacyRuntime,
  LegacyObject,
} from './types.js';
