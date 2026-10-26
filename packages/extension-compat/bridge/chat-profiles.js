export const withChatScope = (chatKey, fn) => __extensionHost.scope(chatKey, fn);
export const effectiveConfigForChat = (chatKey) => __extensionHost.view(chatKey);
export const profilePersonaEntries = () => [];
