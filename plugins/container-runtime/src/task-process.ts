const CONTROL = String.raw`
import os,sys,json,time,signal,re,ctypes,subprocess,pwd,stat
job=json.load(sys.stdin)
if not re.fullmatch(r'[a-f0-9-]{36}',job['owner']) or not re.fullmatch(r'[a-f0-9-]{36}',job['id']):raise RuntimeError('invalid task identity')
base='/run/qq-harness-'+job['owner'];os.makedirs(base,mode=0o700,exist_ok=True)
fd=os.open(base,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
if os.fstat(fd).st_uid!=0:raise RuntimeError('task directory must be root owned')
os.fchmod(fd,0o700);os.close(fd)
record=base+'/'+job['id']+'.json'; cancelled=base+'/'+job['id']+'.cancel'
def info(pid):
    try:
        p=open('/proc/'+str(pid)+'/stat').read().rsplit(') ',1)[1].split()
        return {'ppid':int(p[1]),'start':p[19],'state':p[0]}
    except (OSError,IndexError,ValueError):return None
def children(parent):
    all={int(n):info(int(n)) for n in os.listdir('/proc') if n.isdigit()}
    found={parent};changed=True
    while changed:
        changed=False
        for pid,detail in all.items():
            if detail and detail['ppid'] in found and pid not in found:found.add(pid);changed=True
    return {pid:all[pid] for pid in found if pid!=parent and all.get(pid) and all[pid]['state']!='Z'}
def kill_children(parent,sig):
    for pid,old in reversed(list(children(parent).items())):
        current=info(pid)
        if current and current['start']==old['start']:
            try:os.kill(pid,sig)
            except ProcessLookupError:pass
`;
export const TASK_SCRIPT =
  CONTROL +
  String.raw`
libc=ctypes.CDLL(None,use_errno=True)
if libc.prctl(36,1,0,0,0)!=0:raise RuntimeError('subreaper is unavailable')
account=pwd.getpwnam(job['username'])
if account.pw_uid!=job['uid'] or account.pw_gid!=job['gid'] or account.pw_uid<1000:raise RuntimeError('session account changed')
marker='/var/lib/qq-harness-users/'+job['username']+'.json'
registered=json.load(open(marker))
if registered.get('owner')!=job['owner'] or registered.get('uid')!=account.pw_uid:raise RuntimeError('session account is not owned')
me=os.getpid();start=info(me)['start']
with open(record+'.tmp','w') as f:json.dump({'pid':me,'start':start,'username':job['username']},f)
os.chmod(record+'.tmp',0o600);os.replace(record+'.tmp',record)
def stop(signum,frame):
    kill_children(me,signal.SIGTERM)
    signal.signal(signal.SIGALRM,force)
    signal.setitimer(signal.ITIMER_REAL,0.3)
def force(signum,frame):kill_children(me,signal.SIGKILL)
for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,stop)
signal.signal(signal.SIGALRM,force)
def demote():
    os.setsid();os.setgroups([]);os.setgid(account.pw_gid);os.setuid(account.pw_uid);os.umask(0o077)
    if libc.prctl(38,1,0,0,0)!=0:raise RuntimeError('no_new_privs is unavailable')
    os.chdir(job['workdir'])
code=125;expired=False
def deadline(signum,frame):
    global expired
    expired=True;stop(signum,frame)
signal.signal(signal.SIGALRM,deadline)
signal.setitimer(signal.ITIMER_REAL,max(0.001,job['timeoutMs']/1000))
try:
    if os.path.exists(cancelled):sys.exit(125)
    env={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':account.pw_dir,'USER':job['username'],'LOGNAME':job['username'],'TMPDIR':account.pw_dir+'/.tmp','LANG':'C.UTF-8'}
    proc=subprocess.Popen(job['argv'],stdin=subprocess.PIPE,stdout=sys.stdout,stderr=sys.stderr,env=env,preexec_fn=demote)
    if os.path.exists(cancelled):stop(0,None)
    proc.communicate((job.get('stdin') or '').encode());code=124 if expired else proc.returncode
finally:
    signal.setitimer(signal.ITIMER_REAL,0)
    kill_children(me,signal.SIGTERM);until=time.monotonic()+0.3
    while children(me) and time.monotonic()<until:time.sleep(0.02)
    for unused in range(10):
        if not children(me):break
        kill_children(me,signal.SIGKILL);time.sleep(0.02)
    while True:
        try:
            pid,status=os.waitpid(-1,os.WNOHANG)
            if not pid:break
        except ChildProcessError:break
    for filename in (record,cancelled):
        try:os.unlink(filename)
        except FileNotFoundError:pass
sys.exit(code if code>=0 else 128-code)
`;
export const CANCEL_SCRIPT =
  CONTROL +
  String.raw`
open(cancelled,'a').close();os.chmod(cancelled,0o600)
if os.path.exists(record):
    saved=json.load(open(record));pid=saved['pid'];current=info(pid)
    if current and current['start']==saved['start'] and saved['username']==job['username']:
        os.kill(pid,signal.SIGTERM);until=time.monotonic()+2
        while time.monotonic()<until:
            current=info(pid)
            if not current or current['start']!=saved['start']:break
            time.sleep(0.025)
        current=info(pid)
        if current and current['start']==saved['start']:
            kill_children(pid,signal.SIGKILL)
            os.kill(pid,signal.SIGKILL)
print('cancelled')
`;
