/** Explicit local process orchestration only; never recreates Supabase resources. */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
const ROOT = '/workspace/elklart-runtime'
const OPS = '/workspace/gridex-ops-platform'
const WEB = '/workspace/gridex-web'
export const SERVICES = Object.freeze([
  { name: 'capway', port: 38480, metadata: `${ROOT}/boundary-processes-capway.json`, script: `${OPS}/scripts/demo/elklart-boundary-apps.mjs`, start: ['start','capway'], stop: ['stop','capway'], cwd: OPS },
  { name: 'resend', port: 38481, metadata: `${ROOT}/boundary-processes-resend.json`, script: `${OPS}/scripts/demo/elklart-boundary-apps.mjs`, start: ['start','resend'], stop: ['stop','resend'], cwd: OPS },
  { name: 'smtp', port: 38482, metadata: `${ROOT}/provider-smtp/supervisor.json`, script: `${OPS}/scripts/demo/elklart-smtp-provider.mjs`, start: ['--start'], stop: ['--stop'], cwd: OPS },
  { name: 'ops', port: 3000, metadata: `${ROOT}/ops/app.pid`, script: `${OPS}/scripts/demo/elklart-ops-app.mjs`, start: ['start'], stop: ['stop'], cwd: OPS },
  { name: 'portal', port: 3001, metadata: `${ROOT}/portal/app.pid`, script: `${WEB}/scripts/elklart-demo/portal-app.mjs`, start: ['start'], stop: ['stop'], cwd: WEB },
])
const assert = (ok, message) => { if (!ok) throw Error(message) }
function privatePath(file, missing = false, directory = false) {
  for (let current = file; current !== path.dirname(current); current = path.dirname(current)) {
    try { assert(!fs.lstatSync(current).isSymbolicLink(), 'Symlink refused') } catch(error) { if (!(missing && error.code === 'ENOENT')) throw error }
  }
  try { const info = fs.statSync(file); assert(info.uid === process.getuid() && !(info.mode & 0o7077) && (directory ? info.isDirectory() : info.isFile()), 'Private owner/mode/type required') }
  catch(error) { if (!(missing && error.code === 'ENOENT')) throw error }
}
function marker(stopped) {
  const target = `${ROOT}/apps-stopped.json`; privatePath(ROOT, false, true); privatePath(target, true)
  const temp = `${target}.${randomUUID()}.tmp`, fd = fs.openSync(temp, 'wx', 0o600)
  try { fs.writeFileSync(fd, JSON.stringify({ appsStopped: stopped })); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temp,target); const parent=fs.openSync(ROOT,'r');try {fs.fsyncSync(parent)}finally{fs.closeSync(parent)}
}
export function commandPlan(action) {
  assert(['start','stop'].includes(action), 'Expected start or stop')
  return (action === 'stop' ? [...SERVICES].reverse() : SERVICES).map(service => ({ ...service, args: [service.script, ...service[action]] }))
}
function portOpen(port, host) { return new Promise((resolve,reject) => { const socket=net.connect({port,host}); const finish=value=>{socket.destroy();resolve(value)};socket.setTimeout(500,()=>{socket.destroy();reject(Error('Loopback probe timeout'))});socket.once('connect',()=>finish(true));socket.once('error',error=>{socket.destroy();if(['ECONNREFUSED','ENETUNREACH','EAFNOSUPPORT'].includes(error.code))resolve(false);else reject(Error('Loopback probe inconclusive'))}) }) }
async function listening(port) { return (await Promise.all(['127.0.0.1','::1'].map(host=>portOpen(port,host)))).some(Boolean) }
function request(service, pathname, headers = {}) {
  const secure = service.name !== 'capway'
  return new Promise(resolve => {
    const client = secure ? https : http
    const req=client.request({ hostname:'127.0.0.1',port:service.port,path:pathname,method:'GET',headers,
      ...(secure ? { ca:fs.readFileSync(`${ROOT}/tls/ca.pem`),servername:'localhost',rejectUnauthorized:true } : {}) },res=>{res.resume();resolve(res.statusCode >= 200 && res.statusCode < 400)})
    req.setTimeout(3000,()=>req.destroy());req.once('error',()=>resolve(false));req.end()
  })
}
async function healthy(service) {
  if (service.name === 'smtp') return listening(service.port) // Readiness only; SMTP/TLS proof is separate.
  if (service.name === 'capway') {
    const file=`${ROOT}/ops/app-secrets.json`;privatePath(file)
    return request(service,'/v1/Invoices/Ping',{'x-elklart-demo-key':JSON.parse(fs.readFileSync(file)).ELKLART_CAPWAY_API_KEY})
  }
  if(service.name === 'resend') {const file=`${ROOT}/provider-mail/api-key`;privatePath(file);return request(service,'/domains',{authorization:`Bearer ${fs.readFileSync(file,'utf8').trim()}`})}
  return request(service,'/login')
}
const dependencies = {
  marker,
  exists(service) { privatePath(service.metadata,true); return fs.existsSync(service.metadata) },
  listening,
  healthy,
  run(plan) {
    const result=spawnSync(process.execPath,plan.args,{cwd:plan.cwd,env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_EXTRA_CA_CERTS:`${ROOT}/tls/ca.pem`},stdio:'pipe',timeout:30000})
    assert(result.status === 0 && !result.error, `Owned ${plan.name} launcher failed; inspect private logs`)
  },
  pause: ms=>new Promise(resolve=>setTimeout(resolve,ms)),
}
export async function orchestrate(action, deps=dependencies) {
  assert(['start','stop','status'].includes(action), 'Expected start, stop or status')
  if(action === 'status') return Promise.all(SERVICES.map(async service=>({name:service.name,metadataPresent:deps.exists(service),listening:await deps.listening(service.port)})))
  // Any partial operation must leave the snapshot prerequisite false.
  deps.marker(false)
  if(action === 'start') {
    for(const service of SERVICES) assert(!deps.exists(service) && !await deps.listening(service.port), 'Start requires all five owned services stopped; use stop first')
    for(const plan of commandPlan('start')) {
      await deps.run(plan)
      let ready=false
      for(let attempt=0;attempt<120;attempt++) { if(await deps.healthy(plan)){ready=true;break} await deps.pause(500) }
      assert(ready, `Owned ${plan.name} readiness failed; stop before retrying`)
    }
    return {started:true}
  }
  const failures=[]
  for(const plan of commandPlan('stop')) {
    try { if(deps.exists(plan)) await deps.run(plan) } catch {failures.push(plan.name)}
  }
  for(let attempt=0;attempt<100;attempt++) {
    const open=await Promise.all(SERVICES.map(service=>deps.listening(service.port)))
    if(!open.some(Boolean)) {assert(!failures.length,'An owned stop failed; reconcile metadata before snapshot');deps.marker(true);return {appsStopped:true}}
    if(attempt===99) throw Error('Known writer ports remain open; snapshot marker remains false')
    await deps.pause(100)
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) Promise.resolve().then(async()=>{
  assert(Number(process.versions.node.split('.')[0])===22,'Use private verified Node22 runtime')
  privatePath(ROOT,false,true);privatePath(`${ROOT}/bin/node22`);privatePath(`${ROOT}/tls/ca.pem`)
  const result=await orchestrate(process.argv[2]);console.log(JSON.stringify(result))
}).catch(()=>{console.error('Demo process operation refused or incomplete; snapshot safety marker is not certified. Inspect private metadata/logs.');process.exitCode=1})
