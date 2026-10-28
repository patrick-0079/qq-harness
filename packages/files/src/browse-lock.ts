export function browseGuard(security:unknown):(url:URL)=>void {
 const cfg=(security??{}) as Record<string,any>,lock=cfg.browseLock??{};
 return url=>{
  if(lock.enabled!==true)return;
  const raw=Array.isArray(lock.hosts)?lock.hosts:Array.isArray(lock.allowedHosts)?lock.allowedHosts:Array.isArray(lock.domains)?lock.domains:[];
  const hosts=raw.map((v:unknown)=>String(v).trim().toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'').replace(/^\*\./,''));
  const host=url.hostname.toLowerCase();if(!hosts.some((value:string)=>value&&(host===value||host.endsWith('.'+value))))throw new Error('浏览锁定：该域名不在允许清单');
 };
}
