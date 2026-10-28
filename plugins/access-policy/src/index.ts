import { definePlugin } from '@qq-harness/plugin-sdk';
import { configService, accessService } from '@qq-harness/domain';
import { chatKeySchema } from '@qq-harness/contracts';

export function restrictedAccessPolicy(allowedChats?: readonly string[]) {
  const boundary =
    allowedChats === undefined ? undefined : new Set(allowedChats.map((key) => chatKeySchema.parse(key)));
  return definePlugin({
    id: 'access-policy',
    name: '会话准入与黑名单',
    requires: [configService.id],
    setup(ctx) {
      const config = ctx.use(configService);
      // Configuration reads clone full session snapshots. Keep one immutable
      // access view per revision instead of cloning all personas for every row.
      let value=config.get();
      ctx.effect(ctx.host.subscribe(event=>{if(event.type==='config.changed')value=config.get();}));
      const withinBoundary = (chatKey: string, senderId?: string) => {
        if (!chatKeySchema.safeParse(chatKey).success) return false;
        // 启动 profile 可限定测试边界；管理 API 修改准入不能扩大它。
        if (boundary && !boundary.has(chatKey)) return false;
        return (
          !value.deniedChats.includes(chatKey) &&
          !(senderId && value.deniedUsers.includes(senderId)) &&
          !(senderId && (value.profiles[chatKey]??value.defaults).behavior.blockedUsers.includes(senderId))
        );
      };
      const allowed=(chatKey:string,senderId?:string)=>withinBoundary(chatKey,senderId)&&(value.acceptAllSessions||value.admissions.includes(chatKey)||Object.hasOwn(value.profiles,chatKey));
      ctx.provide(accessService, {
        allowed,
        withinBoundary,
        assert: (chatKey, senderId) => {
          ctx.assertActive();
          if (!allowed(chatKey, senderId)) throw new Error('会话或用户未获准入');
        },
      });
    },
  });
}
export const accessPolicy = restrictedAccessPolicy();
