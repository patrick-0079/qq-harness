import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { LegacyObject } from './types.js';

/** Resources belong to a module instance, including failed setup and hot reload. */
export function capsuleEnvironment(options:{root:string;dataDir:string;modules:Record<string,LegacyObject>;fetch:(url:string,init?:RequestInit)=>Promise<Response>;log:(value:unknown)=>void;runTimer?:(fn:()=>unknown)=>unknown}) {
  const timers=new Map<ReturnType<typeof setTimeout>,()=>void>();
  const environment={...process.env,QQ_AGENT_DATA_DIR:options.dataDir};
  const controller=new AbortController(),listeners=new Set<{event:string|symbol;fn:(...args:any[])=>void}>();
  let disposed=false;
  const timer=(repeat:boolean,fn:(...args:unknown[])=>unknown,ms:number,...args:unknown[])=>{
    if(disposed)throw new Error('扩展实例已卸载');
    const wrapped=()=>{
      if(!repeat)timers.delete(id);
      if(disposed)return;
      try{void Promise.resolve(options.runTimer ? options.runTimer(()=>fn(...args)) : fn(...args)).catch(options.log);}catch(error){options.log(error);}
    };
    const id=repeat?setInterval(wrapped,ms):setTimeout(wrapped,ms);
    timers.set(id,()=>repeat?clearInterval(id):clearTimeout(id));return id;
  };
  const clearTimer=(id:ReturnType<typeof setTimeout>)=>{timers.get(id)?.();timers.delete(id);};
  const globals=Object.create(globalThis) as typeof globalThis;
  const scopedProcess=new Proxy(process,{get:(target,key)=>{
    if(key==='env')return environment;if(key==='cwd')return()=>options.root;
    if(['on','addListener','once','prependListener','prependOnceListener'].includes(String(key)))return(event:string|symbol,fn:(...args:any[])=>void)=>{if(disposed)throw new Error('扩展实例已卸载');listeners.add({event,fn});(target[key as 'on'] as Function).call(target,event,fn);return scopedProcess;};
    if(key==='off'||key==='removeListener')return(event:string|symbol,fn:(...args:any[])=>void)=>{for(const row of listeners)if(row.event===event&&row.fn===fn){target.off(event,fn);listeners.delete(row);}return scopedProcess;};
    return Reflect.get(target,key);
  }});
  const fetch=(url:string,init:RequestInit={})=>{if(disposed)return Promise.reject(new Error('扩展实例已卸载'));return options.fetch(url,{...init,signal:AbortSignal.any([controller.signal,init.signal??controller.signal])});};
  // Define own properties: assigning through an inherited Node global accessor
  // (notably process) would change the real host instead of this facade.
  const bindings={globalThis:globals,process:scopedProcess,fetch,setTimeout:(fn:(...args:any[])=>unknown,ms:number,...args:unknown[])=>timer(false,fn,ms,...args),setInterval:(fn:(...args:any[])=>unknown,ms:number,...args:unknown[])=>timer(true,fn,ms,...args),clearTimeout:clearTimer,clearInterval:clearTimer};
  Object.defineProperties(globals,Object.fromEntries(Object.entries(bindings).map(([key,value])=>[key,{value,writable:true,configurable:true,enumerable:true}])));
  return {
    ...options,
    signal: controller.signal,
    // Old packages keep reload state on globalThis. It belongs to this instance,
    // so two applications or a failed reload cannot share prototype patches.
    globals,process:scopedProcess,fetch,
    url:(relative:string)=>pathToFileURL(path.join(options.root,relative)).href,
    dirname:(relative:string)=>path.dirname(path.join(options.root,relative)),
    module:(name:string)=>{const value=options.modules[name];if(!value)throw new Error(`该旧宿主依赖尚未适配：${name}`);return value;},
    setTimeout:(fn:(...args:unknown[])=>unknown,ms:number,...args:unknown[])=>timer(false,fn,ms,...args),
    setInterval:(fn:(...args:unknown[])=>unknown,ms:number,...args:unknown[])=>timer(true,fn,ms,...args),
    clearTimer,
    dispose:()=>{disposed=true;controller.abort(new Error('扩展实例已卸载'));for(const clear of timers.values())clear();timers.clear();for(const {event,fn}of listeners)process.off(event,fn);listeners.clear();},
  };
}
