import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = path.resolve(__dirname, '../scripts/simulation/track5/lib/receiver-network.py')
// Every system command below is intercepted by a finite Python adapter.
const run = (change = '', action = 'prepare', exercise = '') => spawnSync('python3', ['-B', '-I', '-c', `
import importlib.util,json,sys,datetime,tempfile,pathlib
s=importlib.util.spec_from_file_location('network',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
a={'schema':'gridex-simulation-runtime-assignment-v1','worker':'T5','state':'ACTIVE','environmentId':'finite-t5','sourceCommit':'a'*40,'runDir':'/finite/app','simHome':'/finite/home','expiresAt':'2099-01-01T00:00:00Z','ports':{k:22000+i for i,k in enumerate(m.PORTS)},'receiver':{'ip':'93.184.216.34','hosts':['a.t5.sim.invalid','b.t5.sim.invalid'],'networkTag':'gridex-sim-t5-finite'}}
raw=json.dumps(a).encode();sha=m.sha(raw)
g={'schema':'gridex-t5-receiver-network-grant-v1','worker':'T5','state':'GRANTED','environmentId':'finite-t5','assignmentSha256':sha,'sourceCommit':'a'*40,'transportSha256':'b'*64,'producer':'finite-producer','allowedOperations':['prepare','verify','cleanup'],'expiresAt':a['expiresAt'],'namespaces':{'net':'net:[2]','mnt':'mnt:[3]','pid':'pid:[4]'},'hostNamespaces':{'net':'net:[12]','mnt':'mnt:[13]','pid':'pid:[14]'}}
c={'uid':0,'namespaces':g['namespaces'].copy(),'interfaces':['lo'],'defaultRoutes':[],'rootPropagation':'private','sourceCommit':'a'*40,'sourceClean':True,'transportSha256':'b'*64,'busyPorts':[]}
exec(sys.argv[2])
class Fake:
 def __init__(self): self.calls=[]
 def __call__(self,args,**kw):
  self.calls.append(args)
  if args[0]=='mountpoint': return ''
  return ''
r=Fake()
try:
 m.authorize(raw,g,c,sys.argv[3]);exec(sys.argv[4]);commands=m.network_commands(a)
 for command in commands:r(command)
 print(json.dumps({'commands':r.calls,'hosts':m.hosts_bytes(b'127.0.0.1 localhost\\n',a).decode()}))
except (ValueError,KeyError,TypeError) as e:print(str(e));sys.exit(1)
`, source, change, action, exercise], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })

describe('T5 isolated receiver network, finite command adapter only', () => {
  it('binds assigned address and exact443 DNAT to high TLS port; guards other target traffic', () => {
    const result = run(); expect(result.status, result.stderr).toBe(0)
    const observed = JSON.parse(result.stdout)
    expect(observed.commands).toHaveLength(3)
    expect(observed.commands[0]).toEqual(['ip', 'address', 'add', '93.184.216.34/32', 'dev', 'lo'])
    expect(observed.commands[1]).toContain('127.0.0.1:22009')
    expect(observed.commands[1]).toContain('443')
    expect(observed.commands[2].slice(-2)).toEqual(['-j', 'REJECT'])
    expect(observed.hosts).toContain('93.184.216.34 a.t5.sim.invalid b.t5.sim.invalid')
  })
  for (const [reason, change] of [
    ['namespace', "c['namespaces']['net']='net:[12]'"],
    ['namespace', "g['hostNamespaces']['mnt']=g['namespaces']['mnt']"],
    ['namespace', "g['hostNamespaces']['pid']=g['namespaces']['pid']"],
    ['interfaces', "c['interfaces'].append('eth0')"],
    ['routes', "c['defaultRoutes']=['default']"],
    ['propagation', "c['rootPropagation']='shared'"],
    ['grant', "g['state']='TEMPLATE'"],
    ['grant', "g['allowedOperations']=[]"],
    ['grant', "g['expiresAt']='2000-01-01T00:00:00Z'"],
    ['assignment', "g['assignmentSha256']='0'*64"],
    ['source', "c['sourceClean']=False"],
    ['source', "c['transportSha256']='c'*64"],
    ['ports', "a['ports']['SIM_DB_PORT']=a['ports']['SIM_API_PORT'];raw=json.dumps(a).encode();g['assignmentSha256']=m.sha(raw)"],
    ['port_busy', "c['busyPorts']=[22009]"],
    ['receiver', "a['receiver']['ip']='127.0.0.1';raw=json.dumps(a).encode();g['assignmentSha256']=m.sha(raw)"],
    ['receiver', "a['receiver']['hosts']=['outside.example'];raw=json.dumps(a).encode();g['assignmentSha256']=m.sha(raw)"],
    ['uid', "c['uid']=1000"],
    ['tls_disabled', "c['tlsRejectUnauthorized']='0'"],
  ]) it(`rejects ${reason} before any mutation`, () => {
    const result = run(change); expect(result.status).toBe(1); expect(result.stdout).toContain('receiver_' + reason)
  })
  it('never rewrites an existing assigned host mapping', () => {
    const result = run("m.hosts_bytes(b'127.0.0.1 a.t5.sim.invalid\\n',a)")
    expect(result.status).not.toBe(0)
  })
  it('reuses TLS only after certificate lifetime, all-host trust and matching public key checks', () => {
    const result = run('', 'verify', `
with tempfile.TemporaryDirectory() as tmp:
 d=pathlib.Path(tmp)
 for name in ('ca.pem','server.pem','server.key'):
  p=d/name;p.write_text('FINITE_TLS_FIXTURE');p.chmod(0o600)
 calls=[]
 def cert(args,**kw):
  calls.append(args);return 'SAME_PUBLIC_KEY' if args[1]=='pkey' or '-pubkey' in args else ''
 m.tls_files(d,a,cert)
 assert [x[x.index('-verify_hostname')+1] for x in calls if '-verify_hostname' in x]==a['receiver']['hosts']
 assert len([x for x in calls if '-checkend' in x])==2
 assert not any(x[1]=='req' for x in calls)
`)
    expect(result.status, result.stderr).toBe(0)
  })
  for (const mode of ['partial', 'wrong-key', 'expired']) it(`rejects ${mode} TLS before a successful network qualification`, () => {
    const exercise = `
with tempfile.TemporaryDirectory() as tmp:
 d=pathlib.Path(tmp)
 for name in ${mode === 'partial' ? "('ca.pem',)" : "('ca.pem','server.pem','server.key')"}:
  p=d/name;p.write_text('FINITE_TLS_FIXTURE');p.chmod(0o600)
 def cert(args,**kw):
  ${mode === 'expired' ? "if '-checkend' in args:raise ValueError('receiver_tls_expired')" : "if args[1]=='pkey':return 'WRONG_PUBLIC_KEY'"}
  return ''
 m.tls_files(d,a,cert)
`
    const result = run('', 'verify', exercise); expect(result.status).toBe(1); expect(result.stdout).toContain('receiver_tls_')
  })
  it('invokes the actual frozen product transport with every assigned hostname and local CA', () => {
    const result = run('', 'verify', `
def node(args,**kw):
 if args==['node','--version']:return 'v22.23.4\\n'
 assert args[:4]==['node','--experimental-strip-types','--input-type=module','-e']
 assert json.loads(args[5])['receiver']['hosts']==a['receiver']['hosts']
 assert args[6]=='/finite/app/lib/integrations/publicWebhookTransport.ts'
 assert kw['env']['NODE_EXTRA_CA_CERTS']=='/finite/receiver/ca.pem'
 return json.dumps({'hostsVerified':2,'actualProductTransport':True})
m.probe(a,node,pathlib.Path('/finite/receiver'))
`)
    expect(result.status, result.stderr).toBe(0)
  })
  it('rejects an incomplete all-host product probe', () => {
    const result = run('', 'verify', `
def node(args,**kw):return 'v22.23.4' if args==['node','--version'] else json.dumps({'hostsVerified':1,'actualProductTransport':True})
m.probe(a,node,pathlib.Path('/finite/receiver'))
`)
    expect(result.status).toBe(1); expect(result.stdout).toContain('receiver_probe')
  })
  it('cleans only its exact two rules/address/bind and never flushes a table', () => {
    const result = run('', 'cleanup', `
commands=m.cleanup_commands(a)
assert commands[0]==['umount','/etc/hosts']
assert len(commands)==4 and all('-F' not in x and '--flush' not in x for x in commands)
assert all('-D' in x and a['receiver']['networkTag'] in x for x in commands[1:3])
assert commands[-1]==['ip','address','delete',a['receiver']['ip']+'/32','dev','lo']
`)
    expect(result.status, result.stderr).toBe(0)
  })
  it('holds cleanup when its tag has duplicate rules', () => {
    const result = run('', 'cleanup', `
def duplicate(args,**kw):return '-A OUTPUT --comment '+a['receiver']['networkTag']+'\\n-A OUTPUT --comment '+a['receiver']['networkTag']+'\\n'
m.rules_present(a,duplicate)
`)
    expect(result.status).toBe(1); expect(result.stdout).toContain('receiver_rule_ownership')
  })
  it('rejects disabled TLS again at the product probe boundary', () => {
    const result = run('', 'verify', `
m.os.environ['NODE_TLS_REJECT_UNAUTHORIZED']='0'
def forbidden(*args,**kw):raise AssertionError('probe must not start Node with disabled TLS')
m.probe(a,forbidden,pathlib.Path('/finite/receiver'))
`)
    expect(result.status).toBe(1); expect(result.stdout).toContain('receiver_tls_disabled')
  })
  it('binds the complete unchanged private TLS trio', () => {
    const result = run('', 'verify', `
with tempfile.TemporaryDirectory() as tmp:
 d=pathlib.Path(tmp)
 for name in ('ca.pem','server.pem','server.key'):
  p=d/name;p.write_text('FINITE_'+name);p.chmod(0o600)
 recorded=m.tls_fingerprints(d)
 assert set(recorded)=={'ca.pem','server.pem','server.key'}
 assert len(set(recorded.values()))==3
 m.require_tls_fingerprints(d,recorded)
`)
    expect(result.status, result.stderr).toBe(0)
  })
  for (const file of ['ca.pem', 'server.pem', 'server.key']) it(`rejects changed ${file} against the existing private journal binding`, () => {
    const result = run('', 'verify', `
with tempfile.TemporaryDirectory() as tmp:
 d=pathlib.Path(tmp)
 for name in ('ca.pem','server.pem','server.key'):
  p=d/name;p.write_text('FINITE_'+name);p.chmod(0o600)
 recorded=m.tls_fingerprints(d)
 (d/${JSON.stringify(file)}).write_text('CHANGED_SAME_OWNED_PATH')
 m.require_tls_fingerprints(d,recorded)
`)
    expect(result.status).toBe(1); expect(result.stdout).toContain('receiver_tls_fingerprint_changed')
  })
})
