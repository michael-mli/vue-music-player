// Private host-local fixture isolation. Permit SFU replies to proxy-created UDP
// connections, but prevent new SFU probes from selecting a direct local path.
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {promisify} from 'node:util'
import {execFile} from 'node:child_process'

const exec=promisify(execFile)
export async function createLocalIceGuard(){
  const rule=['-p','udp','--sport','17902','-m','addrtype','--dst-type','LOCAL',
    '-m','conntrack','--ctstate','NEW','-m','comment','--comment',`ktv-private-${randomUUID()}`,'-j','DROP']
  // The independent timeout removes the exact rule even if the parent dies;
  // stdin EOF also removes it. No existing firewall policy is replaced.
  const script=`trap 'iptables -w 5 -D OUTPUT "$@" >/dev/null 2>&1' EXIT
trap 'exit 0' TERM INT HUP
iptables -w 5 -I OUTPUT 1 "$@" || exit 1
printf 'READY\\n'
cat >/dev/null`
  const child=spawn('sudo',['-n','timeout','--kill-after=5s','900s','bash','-c',script,'ktv-private-ice',...rule],
    {stdio:['pipe','pipe','ignore']})
  const ended=once(child,'exit').catch(()=>[])
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.stdin.end();reject(new Error('LOCAL_ICE_GUARD_START'))},10000)
    child.once('error',()=>{clearTimeout(timer);reject(new Error('LOCAL_ICE_GUARD_START'))})
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('LOCAL_ICE_GUARD_START'))})
    child.stdout.once('data',data=>{clearTimeout(timer);data.toString()==='READY\n'?resolve():reject(new Error('LOCAL_ICE_GUARD_START'))})
  })
  let closed=false
  return {async close(){
    if(closed)return;closed=true;child.stdin.end();await ended
    try{await exec('sudo',['-n','iptables','-w','5','-C','OUTPUT',...rule]);throw new Error('LOCAL_ICE_GUARD_REMAINS')}
    catch(error){if(error.code!==1)throw new Error('LOCAL_ICE_GUARD_CLEANUP')}
  }}
}
