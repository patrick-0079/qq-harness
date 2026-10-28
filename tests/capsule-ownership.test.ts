import {expect,test,vi} from 'vitest';import {capsuleEnvironment} from '../packages/extension-compat/src/capsule.js';
test('globalThis 定时器、process 监听、环境修改和未完成网络请求都属于扩展实例',async()=>{
 const event='harness-capsule-fixture',baseline=process.listenerCount(event),listener=vi.fn(),timer=vi.fn();let signal:AbortSignal|undefined;
 const environment=capsuleEnvironment({root:'D:/fixture',dataDir:'D:/fixture/data',modules:{},log:()=>{},fetch:async(_url,init)=>{signal=init!.signal!;return new Promise<Response>((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true}));}});
 environment.process.on(event,listener);environment.process.env.HARNESS_ISOLATION='local-only';expect(process.env.HARNESS_ISOLATION).toBeUndefined();expect(process.listenerCount(event)).toBe(baseline+1);
 const pending=environment.globals.fetch('https://fixture.invalid');const rejected=expect(pending).rejects.toThrow('卸载');environment.globals.setTimeout(timer,20);environment.dispose();await rejected;await new Promise(resolve=>setTimeout(resolve,30));
 expect(signal?.aborted).toBe(true);expect(timer).not.toHaveBeenCalled();expect(process.listenerCount(event)).toBe(baseline);await expect(environment.fetch('https://fixture.invalid')).rejects.toThrow('卸载');
});
