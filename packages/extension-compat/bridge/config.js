export const ROOT = __extensionHost.root;
export const DATA_DIR = __extensionHost.dataDir;
export const getConfig = () => __extensionHost.view();
export const getGlobalConfig = () => __extensionHost.global();
export const updateConfig = (patch) => __extensionHost.update(patch);
export const listPersonaLibrary = () => __extensionHost.personas();
