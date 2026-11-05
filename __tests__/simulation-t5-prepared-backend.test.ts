import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { describe, expect, it } from 'vitest'

const script = path.resolve(__dirname, '../scripts/simulation/track5/lib/prepared-backend.py')
const assignment = { schema: 'gridex-simulation-runtime-assignment-v1', worker: 'T5', state: 'ACTIVE', sourceCommit: 'a'.repeat(40),
  environmentId: 'finite-t5', projectId: 'finite-t5', runDir: '/finite/app', simHome: '/finite/home', expiresAt: '2026-11-01T20:00:00Z',
  ports: { SIM_DB_PORT: 54322 } }
function fixture() {
  const observation = { sourceCommit: assignment.sourceCommit, sourceTree: 'b'.repeat(40), sourceInputsSha256: 'c'.repeat(64),
    replayScriptSha256: 'd'.repeat(64), configSha256: 'e'.repeat(64), replayLogSha256: 'f'.repeat(64), schemaFingerprint: '1'.repeat(64), receiverJournalSha256: '4'.repeat(64),
    environmentId: assignment.environmentId, projectId: assignment.projectId, runDir: assignment.runDir, simHome: assignment.simHome,
    dockerDaemonId: 'finite-daemon', dockerSocket: { device: 1, inode: 2 }, networkNamespace: 'net:[123]',
    containerId: '2'.repeat(64), containerImageId: 'sha256:' + '3'.repeat(64), containerStartedAt: '2026-11-01T17:00:00Z',
    postgresSystemIdentifier: '123456789', postgresVersion: 170006, producer: { pid: 42, startTimeTicks: '123', networkNamespace: 'net:[123]' } }
  return { assignment, observation, receipt: { schema: 'gridex-t5-prepared-backend-v1', assignmentSha256: '',
    recordedAt: '2026-11-01T18:00:00Z', expiresAt: assignment.expiresAt, observation: structuredClone(observation) } }
}
function check(x: ReturnType<typeof fixture>, mode = 'validate') {
  const code = `import importlib.util,json,sys,datetime,hashlib
s=importlib.util.spec_from_file_location('prepared',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
x=json.loads(sys.argv[2]);a=json.dumps(x['assignment'],separators=(',',':')).encode()
if not x['receipt']['assignmentSha256']:x['receipt']['assignmentSha256']=hashlib.sha256(a).hexdigest()
try:
 m.validate(x['receipt'],x['observation'],a,datetime.datetime(2026,11,1,19,tzinfo=datetime.timezone.utc))
 print('CHECKED')
except (ValueError,KeyError,TypeError):print('HOLD');sys.exit(1)`
  const result = spawnSync('python3', ['-B', '-I', '-c', code, script, JSON.stringify(x), mode], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
  return { status: result.status, output: result.stdout, error: result.stderr }
}
function held(result: ReturnType<typeof check>) {
  expect(result).toEqual({ status: 1, output: 'HOLD\n', error: '' })
}
describe('T5 actual prepared-backend binding, finite observations only', () => {
  it('accepts the same exact observed backend while its source/lifecycle bindings match', () => {
    expect(check(fixture())).toEqual({ status: 0, output: 'CHECKED\n', error: '' })
  })
  for (const key of ['sourceCommit', 'sourceTree', 'sourceInputsSha256', 'replayScriptSha256', 'configSha256', 'replayLogSha256',
    'schemaFingerprint', 'receiverJournalSha256', 'dockerDaemonId', 'containerId', 'containerImageId', 'containerStartedAt', 'postgresSystemIdentifier', 'networkNamespace'] as const) {
    it(`rejects a changed ${key}, including same-name replacement`, () => {
      const x = fixture(); x.observation[key] = 'changed'; held(check(x))
    })
  }
  it('rejects a changed socket or producer birth identity', () => {
    for (const key of ['socket', 'producer']) {
      const x = fixture()
      if (key === 'socket') x.observation.dockerSocket.inode++
      else x.observation.producer.startTimeTicks = '999'
      held(check(x))
    }
  })
  it('rejects expired, future, foreign-assignment and non-PG17 receipts', () => {
    const cases = [fixture(), fixture(), fixture(), fixture()]
    cases[0].receipt.expiresAt = '2026-11-01T18:00:00Z'
    cases[1].receipt.recordedAt = '2026-11-01T19:01:00Z'
    cases[2].receipt.assignmentSha256 = '0'.repeat(64)
    cases[3].observation.postgresVersion = 160000; cases[3].receipt.observation.postgresVersion = 160000
    for (const x of cases) held(check(x))
  })
  it('cannot turn matching invalid/empty backend identities into proof', () => {
    for (const key of ['containerId', 'schemaFingerprint', 'sourceTree', 'postgresSystemIdentifier'] as const) {
      const x = fixture(); x.observation[key] = ''; x.receipt.observation[key] = ''
      held(check(x))
    }
  })
  for (const skip of ['', 'SKIP_REPLAY', 'SKIP_BUILD']) it(`actual startup refuses ${skip || 'missing backend receipt'} before any process or backend mutation`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't5-up-port-'))
    try {
      fs.mkdirSync(path.join(dir, 'lib'))
      fs.copyFileSync(path.resolve(__dirname, '../scripts/simulation/track5/up.sh'), path.join(dir, 'up.sh'))
      fs.copyFileSync(script, path.join(dir, 'lib/prepared-backend.py'))
      fs.writeFileSync(path.join(dir, 'lib/common.sh'), `HARNESS_DIR=${JSON.stringify(dir)}\ndie(){ echo "$*" >&2; exit 1; }\nt5_process_custody(){ echo "$*" >> "$TRACE"; }\nt5_acquire_runtime_lock(){ echo MUTATION >> "$TRACE"; }\n`)
      const trace = path.join(dir, 'trace')
      const result = spawnSync('bash', [path.join(dir, 'up.sh')], { encoding: 'utf8', timeout: 5000,
        env: { ...process.env, TRACE: trace, SIM_HOME: dir, RUN_DIR: dir, SIM_RUNTIME_ASSIGNMENT_FILE: path.join(dir, 'missing.json'), ...(skip ? { [skip]: '1' } : {}) } })
      expect(result.status).toBe(1)
      const calls = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8') : ''
      expect(calls).toBe(skip ? '' : 'namespace-plan\n')
      expect(result.stderr).toContain(skip ? 'bare replay/build reuse is unsupported' : 'exakt levande backend')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('prepared-backend actual observer through finite command ports', () => {
  it('preserves clean source during actual dynamic import even when the caller omits -B', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't5-no-bytecode-'))
    try {
      const target = path.join(dir, 'prepared-backend.py')
      fs.copyFileSync(script, target)
      fs.copyFileSync(path.join(path.dirname(script), 'receiver-network.py'), path.join(dir, 'receiver-network.py'))
      const code = `import runpy,importlib.util,pathlib,sys
runpy.run_path(sys.argv[1],run_name='source_import_boundary')
p=pathlib.Path(sys.argv[1]).with_name('receiver-network.py')
s=importlib.util.spec_from_file_location('receiver',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
assert not (p.parent/'__pycache__').exists()
print('SOURCE_UNCHANGED')`
      const r = spawnSync('python3', ['-I', '-c', code, target], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      expect(r.stderr).toBe(''); expect(r.status).toBe(0); expect(r.stdout).toBe('SOURCE_UNCHANGED\n')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
  it('stages exact original inputs once, with only the declared disposable config substitution', () => {
    const code = `import importlib.util,json,sys,tempfile,pathlib,datetime
s=importlib.util.spec_from_file_location('prepared',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
prepare=pathlib.Path(sys.argv[2]).read_bytes()
with tempfile.TemporaryDirectory(prefix='t5-stage-') as name:
 root=pathlib.Path(name);app=root/'app';home=root/'home';app.mkdir();home.mkdir(mode=0o700)
 originals={'scripts/gridex-aud-003-clean-replay.sh':b'canonical','scripts/simulation/track5/lib/prepare-supabase.py':prepare,'supabase/migrations/20260101000000_fixture.sql':b'select 1;','supabase/seed.sql':b'--seed','supabase/config.toml':b'project_id="original"\\n[api]\\nport=54321\\n[db]\\nport=54322\\nmajor_version=17\\nshadow_port=54320\\n[db.pooler]\\nport=54329\\n[studio]\\nport=54323\\n[inbucket]\\nport=54324\\nsmtp_port=54325\\n[auth]\\njwt_expiry=3600\\n[auth.sessions]\\ntimebox="1h"\\n'}
 for rel,raw in originals.items():p=app/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
 def command(argv,raw=None):
  if argv[:3]==['git','-C',str(app)]:
   if argv[3:]==['rev-parse','HEAD']:return 'a'*40
   if argv[3:]==['status','--porcelain','--untracked-files=normal']:return ''
   if argv[3:]==['ls-files','-z']:return chr(0).join(sorted(originals))
  raise RuntimeError('UNDECLARED_COMMAND')
 m.command=command
 a={'schema':'gridex-simulation-runtime-assignment-v1','worker':'T5','state':'ACTIVE','expiresAt':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)).isoformat(),'runDir':str(app),'simHome':str(home),'sourceCommit':'a'*40,'projectId':'finite-t5','ports':{'SIM_API_PORT':54321,'SIM_DB_PORT':54322,'SIM_SHADOW_PORT':54320,'SIM_POOLER_PORT':54329,'SIM_STUDIO_PORT':54323,'SIM_MAIL_HTTP_PORT':54324,'SIM_SMTP_PORT':54325}}
 raw=json.dumps(a).encode();m.stage(a,raw)
 receipt=json.loads((home/'replay-inputs.private.json').read_text());assert receipt['assignmentSha256']==m.sha(raw) and len(receipt['files'])==len(originals)
 assert (home/'replay-inputs.private.json').stat().st_mode&0o777==0o600
 for rel,original in originals.items():
  assert (app/rel).read_bytes()==original
  if rel!='supabase/config.toml':assert (home/'replay-root'/rel).read_bytes()==original
 config=(home/'replay-root/supabase/config.toml').read_text();assert 'project_id = "finite-t5"' in config and 'jwt_expiry = 60' in config and 'timebox = "3m"' in config
 try:m.stage(a,raw)
 except FileExistsError:pass
 else:raise AssertionError('existing staging overwritten')
 print('STAGED')`
    const prepare = path.resolve(__dirname, '../scripts/simulation/track5/lib/prepare-supabase.py')
    const r = spawnSync('python3', ['-B', '-I', '-c', code, script, prepare], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
    expect(r.stderr).toBe(''); expect(r.status).toBe(0); expect(r.stdout).toBe('STAGED\n')
  })
  function observe(fault: string) {
    const code = `import importlib.util,json,sys,tempfile,pathlib,os
s=importlib.util.spec_from_file_location('prepared',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
fault=sys.argv[2]
with tempfile.TemporaryDirectory(prefix='t5-observer-') as root:
 p=pathlib.Path(root);app=p/'app';home=p/'home';scripts=app/'scripts';scripts.mkdir(parents=True);home.mkdir(mode=0o700)
 replay=home/'replay-root';(replay/'scripts').mkdir(parents=True);(replay/'supabase').mkdir()
 original=b'canonical exact fixture';(scripts/'gridex-aud-003-clean-replay.sh').write_bytes(original)
 (replay/'scripts/gridex-aud-003-clean-replay.sh').write_bytes(b'patched' if fault=='patched-replay' else original)
 (scripts/'gridex-aud-003-schema-fingerprint.sql').write_bytes(b'-- fingerprint fixture')
 (scripts/'gridex-aud-003-main-ledger.json').write_text(json.dumps({'entries':[{'version':'20260101000000','name':'fixture'}]}))
 config='project_id="finite-t5"\\n[api]\\nport=54321\\n[db]\\nport=54322\\nmajor_version=17\\nshadow_port=54320\\n[db.pooler]\\nport=54329\\n[studio]\\nport=54323\\n[inbucket]\\nport=54324\\nsmtp_port=54325\\n'
 (replay/'supabase/config.toml').write_text(config.replace('port=54321','port=54319') if fault=='wrong-api-port' else config)
 log=home/'replay.log';log.write_text('[GRIDEX-REM-002 replay] schema fingerprint verified: '+'1'*64+'\\n[GRIDEX-REM-002 replay] PASS: empty local Supabase -> verified reconstructed foundation -> canonical checksum-pinned history -> CLI-owned observed dev ledger\\n'+('external mode: NO ledger provenance' if fault=='external' else ''));log.chmod(0o600)
 a={'sourceCommit':'a'*40,'projectId':'finite-t5','runDir':str(app),'simHome':str(home),'environmentId':'finite-t5','ports':{'SIM_API_PORT':54321,'SIM_DB_PORT':54322,'SIM_SHADOW_PORT':54320,'SIM_POOLER_PORT':54329,'SIM_STUDIO_PORT':54323,'SIM_MAIL_HTTP_PORT':54324,'SIM_SMTP_PORT':54325}}
 calls=[]
 def command(argv,raw=None):
  calls.append(argv)
  if argv[:1]==['git']:
   if argv[3:]==['rev-parse','HEAD']:return 'a'*40
   if argv[3:]==['rev-parse','HEAD^{tree}']:return 'b'*40
   if argv[3:]==['status','--porcelain','--untracked-files=normal']:return ' M source' if fault=='dirty-source' else ''
   if argv[3:]==['ls-files','-z']:return 'scripts/gridex-aud-003-clean-replay.sh'
  if argv==['docker','info','--format','{{json .}}']:return json.dumps({'ID':'finite-daemon'})
  if argv==['docker','inspect','supabase_db_finite-t5']:
   return json.dumps([{'Id':'2'*64,'Image':'sha256:'+'3'*64,'State':{'Running':fault!='stopped','StartedAt':'2026-11-01T15:00:00Z'},'Config':{'Labels':{'com.supabase.cli.project':'other' if fault=='wrong-project' else 'finite-t5'}},'NetworkSettings':{'Ports':{'5432/tcp':[{'HostPort':'54322','HostIp':'127.0.0.1'}]}}}])
  if argv[:4]==['docker','exec','-i','2'*64]:
   if b'pg_control_system' in raw:return json.dumps({'systemIdentifier':'123456789','version':170006})
   if raw==b'-- fingerprint fixture':return ('9' if fault=='fingerprint' else '1')*64
   if b'schema_migrations' in raw:return '20260101000000'+(chr(9) if b'chr(9)' in raw else chr(92)+'t')+('wrong' if fault=='ledger' else 'fixture')
  raise RuntimeError('UNDECLARED_COMMAND')
 m.receiver_binding=lambda a,b:'4'*64
 m.command=command;m.socket_identity=lambda home:{'device':1,'inode':2};m.capacity=lambda docker:None
 m.birth=lambda pid:{'pid':pid,'startTimeTicks':'123','networkNamespace':os.readlink('/proc/self/ns/net')}
 staged={'schema':'gridex-t5-replay-input-copy-v1','sourceCommit':'9'*40 if fault=='staged-source' else a['sourceCommit'],'assignmentSha256':'a'*64,'files':[['scripts/gridex-aud-003-clean-replay.sh',m.sha(original)]],'configSha256':m.sha(config.encode()),'producer':m.birth(42)}
 stage_path=home/'replay-inputs.private.json';stage_path.write_text(json.dumps(staged));stage_path.chmod(0o600)
 try:
  result=m.observe(a,str(log),42)
  assert result['containerId']=='2'*64 and result['schemaFingerprint']=='1'*64
  assert any(x[:4]==['docker','exec','-i','2'*64] for x in calls)
  print('OBSERVED')
 except ValueError:print('HOLD');sys.exit(1)`
    return spawnSync('python3', ['-B', '-I', '-c', code, script, fault], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  it('reads exact source/config and live container/system/ledger/fingerprint through declared ports', () => {
    const r = observe('none'); expect(r.stderr).toBe(''); expect(r.status).toBe(0); expect(r.stdout).toBe('OBSERVED\n')
  })
  for (const fault of ['patched-replay', 'wrong-api-port', 'external', 'dirty-source', 'stopped', 'wrong-project', 'fingerprint', 'ledger', 'staged-source']) {
    it(`rejects actual ${fault} observations`, () => {
      const r = observe(fault); expect(r.stderr).toBe(''); expect(r.status).toBe(1); expect(r.stdout).toBe('HOLD\n')
    })
  }
  it('enforces actual driver/root capacity and effective RAM without starting a stack', () => {
    const code = `import importlib.util,json,sys,tempfile,types
s=importlib.util.spec_from_file_location('prepared',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.effective_ram=lambda physical,*args:physical
with tempfile.TemporaryDirectory() as root:
 for driver,free,ram,ok in [('vfs',39,8,False),('vfs',40,8,True),('overlay2',15,8,True),('overlayfs',14,8,False),('unknown',100,8,False),('overlay2',100,7,False)]:
  m.os.statvfs=lambda p:types.SimpleNamespace(f_bavail=free*2**30,f_frsize=1)
  m.os.sysconf=lambda key:4096 if key=='SC_PAGE_SIZE' else ram*2**30//4096
  try:m.capacity({'Driver':driver,'DockerRootDir':root});passed=True
  except ValueError:passed=False
  assert passed==ok,(driver,free,ram)
 print('CAPACITY_CHECKED')`
    const r = spawnSync('python3', ['-B', '-I', '-c', code, script], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
    expect(r.stderr).toBe(''); expect(r.status).toBe(0); expect(r.stdout).toBe('CAPACITY_CHECKED\n')
  })
  it('resolves current nested cgroups and lower ancestor memory limits instead of mount-root max alone', () => {
    const code = `import importlib.util,sys
s=importlib.util.spec_from_file_location('prepared',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
limits={'/sys/fs/cgroup/parent/current/memory.max':'max','/sys/fs/cgroup/parent/memory.max':str(7*2**30),'/sys/fs/cgroup/memory.max':'max'}
read=lambda p:limits[str(p)]
mount='1 0 0:1 / /sys/fs/cgroup ro - cgroup2 cgroup rw'
assert m.effective_ram(32*2**30,'0::/parent/current',mount,read)==7*2**30
limits['/sys/fs/cgroup/parent/current/memory.max']=str(4*2**30)
assert m.effective_ram(32*2**30,'0::/parent/current',mount,read)==4*2**30
limits={'/cg/a/memory.limit_in_bytes':str(9*2**30),'/cg/memory.limit_in_bytes':str(8*2**30)}
assert m.effective_ram(16*2**30,'5:memory:/docker/a','1 0 0:1 /docker /cg ro - cgroup cgroup rw,memory',read)==8*2**30
for groups,mounts in [('', ''),('0::/wrong', '1 0 0:1 /other /cg ro - cgroup2 cgroup rw')]:
 try:m.effective_ram(32*2**30,groups,mounts,read)
 except ValueError:continue
 raise AssertionError('unknown cgroup accepted')
print('CGROUP_CHECKED')`
    const r = spawnSync('python3', ['-B', '-I', '-c', code, script], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
    expect(r.stderr).toBe(''); expect(r.status).toBe(0); expect(r.stdout).toBe('CGROUP_CHECKED\n')
  })
})
