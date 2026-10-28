export const ACCOUNT_SCRIPT = String.raw`
import os,sys,json,re,pwd,grp,hashlib,subprocess,stat,shutil
job=json.load(sys.stdin)
name=job['username']; owner=job['owner']
if not re.fullmatch(r'[gp][0-9]{1,20}',name): raise RuntimeError('invalid session username')
if not re.fullmatch(r'[a-f0-9-]{36}',owner): raise RuntimeError('invalid owner')
if os.getuid()!=0: raise RuntimeError('account provisioning requires container root')
def directory(path,uid=0,gid=0,mode=0o700):
    os.makedirs(path,exist_ok=True)
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        if os.fstat(fd).st_uid not in (0,uid): raise RuntimeError('directory owned by another user')
        os.fchown(fd,uid,gid);os.fchmod(fd,mode)
    finally: os.close(fd)
base='/var/lib/qq-harness-users';directory(base)
marker=base+'/'+name+'.json'
prior=json.load(open(marker)) if os.path.exists(marker) else None
home='/home/'+name
try: account=pwd.getpwnam(name)
except KeyError: account=None
if account:
    if not prior or prior.get('owner')!=owner or prior.get('uid')!=account.pw_uid or account.pw_uid<1000 or account.pw_gid<1000 or account.pw_dir!=home:
        raise RuntimeError('session account already exists but is not owned by this instance')
    uid,gid=account.pw_uid,account.pw_gid
else:
    if prior and prior.get('owner')!=owner: raise RuntimeError('account belongs to another instance')
    uid=int(prior['uid']) if prior else 20000+int.from_bytes(hashlib.sha256(name.encode()).digest()[:4],'big')%40000
    for unused in range(40000):
        try: pwd.getpwuid(uid); occupied=True
        except KeyError: occupied=False
        try: group=grp.getgrgid(uid); occupied=occupied or group.gr_name!=name
        except KeyError: pass
        if not occupied: break
        uid=20000+(uid-19999)%40000
    else: raise RuntimeError('no free session UID')
    gid=uid
    with open(marker+'.tmp','w') as f:json.dump({'owner':owner,'uid':uid,'gid':gid},f)
    os.chmod(marker+'.tmp',0o600);os.replace(marker+'.tmp',marker)
    try: group=grp.getgrnam(name)
    except KeyError: group=None
    if group and group.gr_gid!=gid: raise RuntimeError('session group collision')
    for argv in ([] if group else [['groupadd','--gid',str(gid),name]])+[['useradd','--uid',str(uid),'--gid',str(gid),'--home-dir',home,'--shell','/bin/sh','--no-create-home','--password','!',name]]:
        result=subprocess.run(argv,capture_output=True,text=True)
        if result.returncode: raise RuntimeError(result.stderr[-1500:])
directory(home,uid,gid);directory(home+'/workspace',uid,gid);directory(home+'/.tmp',uid,gid)
legacy=job.get('legacy')
if legacy and not os.path.exists(marker+'.legacy'):
    if legacy!='/tmp/qq-harness-workspace': raise RuntimeError('invalid migration source')
    if os.path.islink(legacy): raise RuntimeError('legacy workspace is a symbolic link')
    if os.path.isdir(legacy):
        for entry in os.scandir(legacy):
            dest=home+'/workspace/'+entry.name
            if os.path.lexists(dest): continue
            if entry.is_symlink(): os.symlink(os.readlink(entry.path),dest)
            elif entry.is_dir(follow_symlinks=False):shutil.copytree(entry.path,dest,symlinks=True)
            else:shutil.copy2(entry.path,dest,follow_symlinks=False)
            for root,dirs,files in os.walk(dest,followlinks=False) if os.path.isdir(dest) and not os.path.islink(dest) else []:
                for filename in dirs+files:
                    p=os.path.join(root,filename);os.chown(p,uid,gid,follow_symlinks=False)
                    if not os.path.islink(p):os.chmod(p,0o700 if os.path.isdir(p) or os.stat(p).st_mode&0o111 else 0o600)
            os.chown(dest,uid,gid,follow_symlinks=False)
            if not os.path.islink(dest):os.chmod(dest,0o700 if os.path.isdir(dest) or os.stat(dest).st_mode&0o111 else 0o600)
    open(marker+'.legacy','a').close()
print(json.dumps({'username':name,'uid':uid,'gid':gid,'home':home,'workspace':home+'/workspace'}))
`;

export function sessionIdentity(chatKey: string) {
  const match = /^(group|private):([0-9]{1,20})$/.exec(chatKey);
  if (!match) throw Error('会话标识无法映射容器用户：需要group/private和最多20位号码');
  const username = (match[1] === 'group' ? 'g' : 'p') + match[2];
  return { username, home: '/home/' + username, workspace: '/home/' + username + '/workspace' };
}
