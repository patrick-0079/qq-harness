export * as tools from '../vendor/src/tool-registry.js';
export * as manifests from '../vendor/src/skills/manifest.js';
export * as dependencies from '../vendor/src/skills/dependencies.js';
export * as settings from '../vendor/src/skills/config.js';
export * as prompt from '../vendor/src/extensions/prompt-pipeline.js';
export * as variables from '../vendor/src/extensions/template-vars.js';
export * as tabs from '../vendor/src/extensions/tab-registry.js';
export * as types from '../vendor/src/extensions/types.js';
export * as catalog from '../vendor/src/extensions/type-catalog.js';
export * as sandbox from '../vendor/src/sandbox/index.js';
export * as importer from '../vendor/src/extensions/importer.js';
export * as fetch from '../vendor/src/safe-fetch.js';
export * as knowledge from '../vendor/src/knowledge/tree.js';
export * as validation from '../vendor/src/knowledge/validate.js';
export * as stale from '../vendor/src/knowledge/stale.js';
export * as summaries from '../vendor/src/knowledge/ensure.js';
export * as injection from '../vendor/src/extensions/prompt-inject.js';
export * as zip from '../vendor/src/zip-install.js';
export * as extensionCore from '../vendor/src/extensions/index.js';
export * as ui from '../vendor/src/extensions/ui-registry.js';
export { onToolsChanged } from '../vendor/src/extensions/api.js';
export { skillManager, MULTI_PROVIDER_CAPABILITIES } from '../vendor/src/skills/manager.js';
export { extensionRegistry } from '../vendor/src/extensions/registry.js';
export { extensionHookBus } from '../vendor/src/extensions/hook-bus.js';
export { docRegistry } from '../vendor/src/extensions/doc-registry.js';
export { uiExtensionRegistry, UI_SLOTS } from '../vendor/src/extensions/ui-registry.js';
export { createExtensionApi } from '../vendor/src/extensions/api.js';
export { loadPlugins, watchPlugins, unloadSkill } from '../vendor/src/plugin-loader.js';
import * as tool from '../vendor/plugins/ext-tool/index.js';
import * as mcp from '../vendor/plugins/ext-mcp/index.js';
import * as skill from '../vendor/plugins/ext-skill/index.js';
import * as knowledge from '../vendor/plugins/ext-knowledge/index.js';
import * as promptinject from '../vendor/plugins/ext-promptinject/index.js';
export const builtinModules = {
  'ext-tool': tool,
  'ext-mcp': mcp,
  'ext-skill': skill,
  'ext-knowledge': knowledge,
  'ext-promptinject': promptinject,
};
