import type { PluginContext } from '@qq-harness/plugin-sdk';
import { storageService,replySegments } from '@qq-harness/domain';
export const messageTarget=(ctx:PluginContext,chatKey:string,args:{replyToMessageId?:string;atUserId?:string})=>replySegments(ctx.use(storageService),chatKey,args);
