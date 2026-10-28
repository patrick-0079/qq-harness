import type { ContainerSessionService } from '@qq-harness/domain';
import type { LegacyObject } from './types.js';

// Source and arguments travel through stdin, never shell interpolation or host mounts.
// Each invocation has its own module; the container lifecycle and cancellation stay
// owned by container-session. Missing interpreters are errors, not host execution.
const nodeRunner = String.raw`
const fs=require('node:fs'),vm=require('node:vm');
const job=JSON.parse(fs.readFileSync(0,'utf8')),logs=[];
const api={log:(...a)=>{if(logs.length<200)logs.push(a.map(String).join(' '))},now:()=>Date.now()};
(async()=>{try{const module={exports:{}};
const context=vm.createContext({module,exports:module.exports,args:job.args,argv:job.argv,api,console:{log:api.log}},{codeGeneration:{strings:false,wasm:false}});
new vm.Script(job.source,{filename:job.script}).runInContext(context,{timeout:job.timeoutMs});
if(typeof module.exports!=='function')throw Error('脚本必须导出 module.exports 函数');
const result=await module.exports({args:job.args,argv:job.argv,api});
process.stdout.write(JSON.stringify({ok:true,result,logs}));
}catch(e){process.stdout.write(JSON.stringify({ok:false,error:String(e.message||e),logs}));}})();
`;
const pythonRunner = String.raw`
import sys,json,contextlib,io,traceback
job=json.load(sys.stdin)
out=io.StringIO()
try:
 scope={'args':job['args'],'argv':job['argv'],'__name__':'__skill__'}
 with contextlib.redirect_stdout(out):
  exec(compile(job['source'],job['script'],'exec'),scope)
  result=scope['main'](job['args'],job['argv']) if callable(scope.get('main')) else scope.get('result')
 print(json.dumps({'ok':True,'result':result,'logs':out.getvalue().splitlines()[:200]},ensure_ascii=False))
except Exception as e:
 print(json.dumps({'ok':False,'error':str(e),'logs':out.getvalue().splitlines()[:200]},ensure_ascii=False))
`;
export function skillContainerBackend(session: ContainerSessionService) {
  return {
    probe: ({ chatKey }: LegacyObject) => ({ ok: !!chatKey && session.available(chatKey) }),
    available: ({ chatKey }: LegacyObject) => ({
      ok: !!chatKey && session.available(chatKey),
      reason: '当前会话未启用或未绑定容器，JS 使用 Worker 降级',
    }),
    async run(job: LegacyObject) {
      const started = Date.now();
      const signal = AbortSignal.any([job.signal, AbortSignal.timeout(job.timeoutMs)]);
      const lang = job.entry?.lang ?? job.lang ?? 'js';
      const input = JSON.stringify({
        source: job.source,
        script: job.script,
        args: job.args,
        argv: job.argv,
        timeoutMs: job.timeoutMs,
      });
      let result;
      if (lang === 'js')
        result = await session.command(
          job.chatKey,
          ['node', '--max-old-space-size=' + Math.min(256, Math.max(16, job.memoryMb)), '-e', nodeRunner],
          signal,
          input,
        );
      else if (lang === 'python' || lang === 'py')
        result = await session.command(job.chatKey, ['python3', '-c', pythonRunner], signal, input);
      else if (lang === 'sh' || lang === 'bash') {
        // Shell receives the declared argv as positional parameters and JSON args
        // as data in HARNESS_SKILL_ARGS; source remains an uninterpolated argv value.
        result = await session.command(
          job.chatKey,
          [
            'env',
            'HARNESS_SKILL_ARGS=' + JSON.stringify(job.args),
            lang,
            '-c',
            job.source,
            job.script,
            ...job.argv.map(String),
          ],
          signal,
        );
        return {
          ok: result.exitCode === 0,
          result: { content: result.stdout },
          error: result.exitCode ? result.stderr || `脚本退出 ${result.exitCode}` : undefined,
          logs: [],
          backend: 'container',
          durationMs: Date.now() - started,
        };
      } else throw new Error(`不支持的容器脚本语言：${lang}`);
      if (result.exitCode !== 0) throw new Error(result.stderr || `容器脚本退出 ${result.exitCode}`);
      if (result.truncated) throw new Error('容器脚本输出超过上限，结果未完整读取');
      try {
        return { ...JSON.parse(result.stdout), backend: 'container', durationMs: Date.now() - started };
      } catch {
        throw new Error('容器脚本未返回有效 JSON');
      }
    },
  };
}
