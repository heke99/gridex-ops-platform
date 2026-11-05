import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const supervisor = path.join(root, 'scripts/simulation/track5/lib/native-supervisor.py')
const shell = path.join(root, 'scripts/simulation/track5/native-producer.sh')
const py = (code: string) => spawnSync('python3', ['-B', '-I', '-c', `import importlib.util,json,sys
s=importlib.util.spec_from_file_location('supervisor',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
${code}`, supervisor], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })

describe('T5 producer source contract; no services or namespace creation', () => {
  it('declares complete group IDs and requires every executed AUTH ID', () => {
    const r = py(`assert m.scenario_ids(['auth01'])==['AUTH01.01','AUTH01.02','AUTH01.03','AUTH01.04','AUTH01.05','AUTH01.06']
assert len(set(m.scenario_ids(list(m.CATALOG))))==16
try:m.check_groups(['auth01'],['AUTH01.01']);raise AssertionError('partial authorization accepted')
except ValueError:pass`)
    expect(r.status, r.stderr).toBe(0)
  })
  it('forms a sealed private PID/mount/network realm, not a host daemon command', () => {
    const r = py(`cmd=m.realm_command('/finite/app','/finite/bundle')
assert '--net' in cmd and '--pid' in cmd and '--mount' in cmd and '--mount-proc' in cmd
assert '--kill-child=KILL' in cmd and '--propagation' in cmd and 'private' in cmd
assert cmd[-1]=='/finite/bundle'`)
    expect(r.status, r.stderr).toBe(0)
  })
  it('consumes a one-shot local budget atomically and never retries an existing reservation', () => {
    const r = py(`import tempfile,pathlib
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)/'budget.json';m.consume_budget(p,'a'*64)
 try:m.consume_budget(p,'a'*64);raise AssertionError('duplicate run accepted')
 except FileExistsError:pass`)
    expect(r.status, r.stderr).toBe(0)
  })
  it('keeps private allocation fields out of the public commitment', () => {
    const r = py(`g={'producer':'finite','ports':{'private':1234},'runtimeReceipt':'later','publicBinding':{},'reviews':[]}
assert m.core_digest(g)==m.core_digest({**g,'runtimeReceipt':'another','reviews':['later']})
assert m.core_digest(g)!=m.core_digest({**g,'ports':{'private':1235}})`)
    expect(r.status, r.stderr).toBe(0)
  })
  it('binds actual dependency bytes/modes and rejects escaped installation links', () => {
    const r = py(`import tempfile,pathlib
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d)/'modules';root.mkdir();p=root/'package.js';p.write_text('finite')
 first=m.dependency_inventory(root)[0];p.write_text('changed');assert m.dependency_inventory(root)[0]!=first
 (root/'escape').symlink_to('/etc/passwd')
 try:m.dependency_inventory(root);raise AssertionError('escaped dependency accepted')
 except ValueError:pass`)
    expect(r.status, r.stderr).toBe(0)
  })
  for (const fault of ['skipped', 'missing', 'runner-count', 'dirty']) it(`rejects ${fault} despite a zero shell exit`, () => {
    const r = py(`r={'steps':[{'name':'suite AUTH01.01 finite','status':'passed'}], 'exitCode':0,'runDirClean':True,'executionScope':'ISOLATED_NATIVE','appCommit':'a'*40,'builtCommit':'a'*40,'replayCommit':'a'*40,
'vitest':{'success':True,'numTotalTests':1,'numPassedTests':1,'numFailedTests':0,'numPendingTests':0,'numTodoTests':0,'numFailedTestSuites':0,'numTotalTestSuites':1},'summary':{'passed':1,'failed':0,'skipped':0,'total':1}}
${fault === 'skipped' ? "r['steps'][0]['status']='skipped'" : fault === 'missing' ? "r['steps']=[]" : fault === 'runner-count' ? "r['vitest']['numTotalTests']=0" : "r['runDirClean']=False"}
try:m.validate_report(r,['AUTH01.01 finite'],'a'*40);raise AssertionError('bad report accepted')
except ValueError:pass`)
    expect(r.status, r.stderr).toBe(0)
  })
  it('rejects an authenticated run actor mismatch without using the unsupported installation-token /user endpoint', () => {
    const r = py(`g={'repository':'heke99/gridex-ops-platform','actor':'authorized-actor','github':{'runId':123}}
def fetch(repo,route):
 assert route=='actions/runs/123'
 return {'actor':{'login':'other-actor'},'triggering_actor':{'login':'other-actor'}}
m.api=fetch
m.call=lambda *args,**kw: (_ for _ in ()).throw(AssertionError('/user must not be invoked'))
try:m.authenticate(g,'a'*64);raise AssertionError('wrong actor accepted')
except ValueError as e:assert str(e)=='native_actor'`)
    expect(r.status, r.stderr).toBe(0)
  })
  for (const fault of ['none', 'public-digest', 'runtime-is-source', 'ref-drift', 'review-author', 'duplicate-reviewer', 'multiple-source-sessions']) it(`authenticates the full finite ref graph: ${fault}`, () => {
    const r = py(`file='scripts/simulation/track5/native-producer.sh'
session=lambda n:'refs/tags/agent-claims/masterplan/slot-session-00000000-0000-4000-8000-'+str(n).zfill(12)
resources=sorted(['refs/tags/agent-claims/masterplan/file-'+m.sha(file.encode()),session(1)])
runtime=sorted(['refs/tags/agent-claims/masterplan/producer-t5-native-finite','refs/tags/agent-claims/masterplan/backend-t5-native-finite'])
g={'repository':'heke99/gridex-ops-platform','actor':'authorized-actor','github':{'runId':123,'attempt':1},'source':{'commit':'a'*40,'files':{file:'f'*64}},'sourceCustody':[{'receipt':'3'*40,'resources':resources}],
'runtimeRefs':runtime,'runtimeReceipt':'4'*40,'publicBinding':{'ref':'refs/tags/agent-runtime-admissions/finite-input','receipt':'5'*40},'reviews':[{'ref':'refs/tags/agent-runtime-admissions/finite-review-1','receipt':'6'*40},{'ref':'refs/tags/agent-runtime-admissions/finite-review-2','receipt':'7'*40}],'expiresAt':'2099-01-01T00:00:00Z'}
digest='b'*64
def neutral(files,operation):return {'message':json.dumps({'base':'1'*40,'files':files,'operation':operation}),'tree':{'sha':'2'*40},'parents':[{'sha':'1'*40}]}
commits={'1'*40:{'tree':{'sha':'2'*40}},'3'*40:neutral([file],'Reserve source files and rule IDs; resources-sha256='+m.sha('\\n'.join(resources).encode())),
'4'*40:neutral([],'Reserve T5 native producer/backend; resources-sha256='+m.sha('\\n'.join(runtime).encode())+'; inputs-sha256='+digest),
'5'*40:{'message':json.dumps({'schema':'gridex-t5-native-commitment-v1','inputSha256':digest})}}
refs={**dict.fromkeys(resources,'3'*40),**dict.fromkeys(runtime,'4'*40),g['publicBinding']['ref']:'5'*40,session(2):'8'*40,session(3):'9'*40}
for i,review in enumerate(g['reviews']):
 refs[review['ref']]=review['receipt']
 commits[review['receipt']]={'message':json.dumps({'schema':'gridex-t5-native-review-v1','inputSha256':digest,'verdict':'APPROVE_NATIVE_INPUT','expiresAt':g['expiresAt'],'reviewerSession':session(i+2),'sessionReceipt':str(i+8)*40})}
fault=${JSON.stringify(fault)}
if fault=='public-digest':commits['5'*40]['message']=json.dumps({'schema':'gridex-t5-native-commitment-v1','inputSha256':'c'*64})
if fault=='runtime-is-source':commits['4'*40]=commits['3'*40]
if fault=='ref-drift':refs[runtime[0]]='0'*40
if fault=='review-author':
 r=json.loads(commits['6'*40]['message']);r['reviewerSession']=session(1);r['sessionReceipt']='3'*40;commits['6'*40]['message']=json.dumps(r)
if fault=='duplicate-reviewer':commits['7'*40]=commits['6'*40]
if fault=='multiple-source-sessions':
 resources=sorted(resources+[session(4)]);g['sourceCustody'][0]['resources']=resources;refs[session(4)]='3'*40
 commits['3'*40]=neutral([file],'Reserve source files and rule IDs; resources-sha256='+m.sha('\\n'.join(resources).encode()))
def fetch(repo,route):
 assert repo==g['repository']
 if route=='actions/runs/123':return {'actor':{'login':g['actor']},'triggering_actor':{'login':g['actor']},'event':'workflow_dispatch','head_sha':'a'*40,'run_attempt':1,'path':m.WF}
 if route.startswith('git/commits/'):return commits[route.split('/')[-1]]
 if route.startswith('git/ref/'):
  ref='refs/'+route.removeprefix('git/ref/');return {'ref':ref,'object':{'type':'commit','sha':refs[ref]}}
 raise AssertionError('undeclared API read')
m.api=fetch;m.call=lambda *args,**kw: (_ for _ in ()).throw(AssertionError('/user must not be invoked'))
try:
 m.authenticate(g,digest)
 assert fault=='none','bad admission accepted'
except ValueError:assert fault!='none','qualified finite graph rejected'`)
    expect(r.status, r.stderr).toBe(0)
  })
  it('issues no phase command after execution expiry, even during cleanup grace', () => {
    const r = py(`calls=[]
m.check_realm=lambda _: (_ for _ in ()).throw(ValueError('native_realm_admission'))
try:m.execution_phase('/finite/bundle',lambda:calls.append('docker load'));raise AssertionError('expired phase launched')
except ValueError:pass
assert calls==[]`)
    expect(r.status, r.stderr).toBe(0)
  })
  it('records nested finite/max CPU quotas and actual affinity without a CPU capacity gate', () => {
    const r = py(`values={'/sys/fs/cgroup/job/cpu.max':'200000 100000','/sys/fs/cgroup/cpu.max':'max 100000'}
r=m.cpu_observation(16,{2,3},'0::/tenant/job\\n','1 0 0:1 /tenant /sys/fs/cgroup rw - cgroup2 cgroup rw',lambda p:values[str(p)])
assert r['physicalCount']==16 and r['affinity']==[2,3] and r['affinityCount']==2
assert [(x['quota'],x['period']) for x in r['limits']]==[(200000,100000),('max',100000)]`)
    expect(r.status, r.stderr).toBe(0)
  })
  it('records unavailable CPU controllers explicitly and supports v1 unlimited quota', () => {
    const r = py(`r=m.cpu_observation(1,{0},'', '',lambda p: (_ for _ in ()).throw(AssertionError('no read expected')))
assert r['controller']=='unavailable' and r['limits']==[]
values={'/sys/fs/cgroup/cpu/cpu.cfs_quota_us':'-1','/sys/fs/cgroup/cpu/cpu.cfs_period_us':'100000'}
r=m.cpu_observation(8,{0,1},'2:cpu,cpuacct:/tenant\\n','1 0 0:1 /tenant /sys/fs/cgroup/cpu rw - cgroup cgroup rw,cpu,cpuacct',lambda p:values[str(p)])
assert r['limits'][0]['quota']=='max' and r['limits'][0]['period']==100000`)
    expect(r.status, r.stderr).toBe(0)
  })
})

function shellFixture(replay: string, scenarioExit = 0) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 't5-native-shell-')))
  const app = path.join(dir, 'app'), home = path.join(dir, 'home'), bin = path.join(dir, 'bin'), trace = path.join(dir, 'trace')
  fs.mkdirSync(path.join(app, 'scripts/simulation/track5/lib'), { recursive: true })
  fs.mkdirSync(path.join(home, 'replay-root/scripts'), { recursive: true }); fs.mkdirSync(path.join(home, 'logs')); fs.mkdirSync(path.join(home, 'reports')); fs.mkdirSync(bin)
  const executable = (target: string, content: string) => fs.writeFileSync(target, '#!/bin/bash\n' + content, { mode: 0o755 })
  executable(path.join(bin, 'python3'), 'echo "helper:$2" >> "$TRACE"\nexit 0\n')
  executable(path.join(app, 'scripts/simulation/track5/up.sh'), 'echo up >> "$TRACE"\n')
  executable(path.join(app, 'scripts/simulation/track5/run.sh'), `echo scenario >> "$TRACE"\nexit ${scenarioExit}\n`)
  executable(path.join(app, 'scripts/simulation/track5/down.sh'), 'echo down >> "$TRACE"\n')
  fs.writeFileSync(path.join(home, 'replay-root/scripts/gridex-aud-003-clean-replay.sh'), `cleanup(){ echo canonical-cleanup >> "$TRACE"; }\ntrap cleanup EXIT\necho replay >> "$TRACE"\n${replay}\n`)
  return { dir, app, home, bin, trace }
}
describe('actual producer shell with finite command fixtures only', () => {
  for (const [name, replay, scenarioExit, expected] of [
    ['success', ':', 0, 0], ['canonical error', 'false', 0, 1], ['scenario error', ':', 7, 1],
    ['TERM', 'kill -TERM $$', 0, 143],
  ] as const) it(`preserves bare-source errexit and canonical EXIT on ${name}`, () => {
    const f = shellFixture(replay, scenarioExit)
    try {
      const r = spawnSync('bash', ['-c', 'source "$1"; t5_canonical_flow "$2" "$3"', 'fixture', shell, f.app, f.dir], {
        env: { ...process.env, PATH: f.bin + ':' + process.env.PATH, SIM_HOME: f.home, RUN_DIR: f.app, TRACE: f.trace, T5_GROUPS: 'auth01', SIM_RUNTIME_ASSIGNMENT_FILE: path.join(f.dir, 'assignment.json') },
        timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
      expect(r.status, r.stderr).toBe(expected)
      const trace = fs.readFileSync(f.trace, 'utf8').trim().split('\n')
      expect(trace.at(-1)).toBe('canonical-cleanup')
      if (name === 'canonical error' || name === 'TERM') expect(trace).not.toContain('up')
      if (name === 'success') expect(trace).toContain('down')
    } finally { fs.rmSync(f.dir, { recursive: true, force: true }) }
  })
  it('runs canonical EXIT on an actual bounded shell timeout', () => {
    const f = shellFixture('while :; do :; done')
    try {
      const r = spawnSync('bash', ['-c', 'source "$1"; t5_canonical_flow "$2" "$3"', 'fixture', shell, f.app, f.dir], {
        env: { ...process.env, PATH: f.bin + ':' + process.env.PATH, SIM_HOME: f.home, RUN_DIR: f.app, TRACE: f.trace, T5_GROUPS: 'auth01', SIM_RUNTIME_ASSIGNMENT_FILE: path.join(f.dir, 'assignment.json') },
        timeout: 200, killSignal: 'SIGTERM', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      })
      expect(r.error).toBeDefined(); expect(r.status).toBe(143)
      expect(fs.readFileSync(f.trace, 'utf8').trim().split('\n').at(-1)).toBe('canonical-cleanup')
    } finally { fs.rmSync(f.dir, { recursive: true, force: true }) }
  })
})
