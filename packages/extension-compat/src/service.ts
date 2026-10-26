import { service } from '@qq-harness/plugin-sdk';
import type { ExtensionDescriptor, LegacyObject } from './types.js';
import type { PluginContext } from '@qq-harness/plugin-sdk';
export interface ExtensionService {
  list(chatKey?: string): ExtensionDescriptor[];
  tabs(surface?: string): LegacyObject[];
  reload(): Promise<void>;
  configure(id: string, patch: LegacyObject, chatKey?: string): Promise<void>;
  clearSettings(id: string, chatKey: string): Promise<void>;
  capability(name: string, input?: LegacyObject, chatKey?: string): unknown;
  contributions(page: string, chatKey?: string): LegacyObject[];
  action(owner: string, action: string, args: LegacyObject, chatKey?: string): Promise<unknown>;
  readDoc(id: string, chatKey?: string): unknown;
  runScript(args: LegacyObject, chatKey: string): Promise<unknown>;
  renderTemplate(text: string, owner?: string): unknown;
  runHook(name: string, input: LegacyObject, chatKey?: string): Promise<LegacyObject[]>;
  raw(): LegacyObject;
  attachManager(owner: PluginContext, id: string): Promise<void>;
}
export const extensionService = service<ExtensionService>('harness.extensions');
