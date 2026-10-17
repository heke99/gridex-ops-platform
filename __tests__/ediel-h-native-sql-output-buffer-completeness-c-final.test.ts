// SOURCE-only subprocess regression. No real psql, database, native suite or originals.
// The isolated runner resolves this import to the exact old or actual-new helper.
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash,randomUUID} from 'node:crypto'
import {spawn,type ChildProcess} from 'node:child_process'
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,lstatSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'

// Close every non-stdlib fixture port; calling any of these is a test error.
vi.mock('@/lib/supabase/service',()=>({supabaseService:()=>{throw Error('unexpected_backend_port')}}))
vi.mock('@/lib/ediel/testing/invoiceTestContractLifecycle',()=>({signInvoiceTestContractCanonically:()=>{throw Error('unexpected_signature_port')}}))
vi.mock('@/lib/customer-contracts/documents',()=>({archiveSignedCustomerContractPdf:()=>{throw Error('unexpected_archive_port')}}))
vi.mock('@/lib/customer-contracts/agreementPdf',()=>({buildAgreementPdfAttachment:()=>{throw Error('unexpected_pdf_port')}}))
vi.mock('@/lib/operations/db',()=>({savePowerOfAttorney:()=>{throw Error('unexpected_poa_port')}}))
vi.mock('@/lib/legal/authorizationChain',()=>({ensureAuthorizationDocumentFromPowerOfAttorney:()=>{throw Error('unexpected_authorization_port')}}))
vi.mock('@/lib/operations/powerOfAttorneyWorkflow',()=>({powerOfAttorneyCoverageFromScopes:()=>{throw Error('unexpected_scope_port')}}))
vi.mock('@/lib/ediel/flows/prodatSwitch',()=>({prepareAndQueueEdielZ03:()=>{throw Error('unexpected_z03_port')}}))
vi.mock('@/lib/ediel/transport',()=>({sendEdielMessageViaSmtp:()=>{throw Error('unexpected_smtp_port')}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:()=>{throw Error('unexpected_ediel_db_port')}}))
vi.mock('@/lib/ediel/core/edifactTokenizer',()=>({tokenizeEdifact:()=>{throw Error('unexpected_tokenizer_port')},segmentComposite:()=>{throw Error('unexpected_segment_port')}}))
vi.mock('../e2e/production/helpers/swedish-organization-number.mjs',()=>({syntheticSwedishOrganizationNumber:()=>{throw Error('unexpected_organization_port')}}))
vi.mock('../scripts/helpers/native-fixture-company-identity',()=>({nativeFixtureCompanyIdentitySql:()=>{throw Error('unexpected_identity_port')}}))
import {nativeSql} from '../scripts/helpers/ediel-h05h08-normal-switch-native-fixture'

const BIG=64*1024*1024+4096
const TAIL='TAIL_å😀'
const FIXED_ARGS=['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1']
const ENV_KEYS=['PATH','TMPDIR','NEXT_PUBLIC_SUPABASE_URL','H_SQL_TEST_SCENARIO','H_SQL_TEST_TRACE','H_SQL_TEST_MARKER','H_SQL_TEST_BARRIER','H_SQL_TEST_WORKER','H_SQL_TEST_SHARED_SPOOL','H_SQL_TEST_LAUNCH_COORDINATOR'] as const
const OVERLAP_TEST='preserves per-call identity during an externally coordinated overlap'
const fakePsql=String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const input=fs.readFileSync(0,'utf8'),scenario=process.env.H_SQL_TEST_SCENARIO;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const fdInfo=fd=>{const s=fs.fstatSync(fd);let target=null;try{target=fs.readlinkSync('/proc/self/fd/'+fd)}catch{}return {regular:s.isFile(),mode:s.mode&511,target}};
const trace={pid:process.pid,args:process.argv.slice(2),inputBytes:Buffer.byteLength(input),inputSHA256:hash(input),stdout:fdInfo(1),stderr:fdInfo(2)};
fs.writeFileSync(process.env.H_SQL_TEST_TRACE,JSON.stringify(trace),{mode:384});
const BIG=64*1024*1024+4096,TAIL='TAIL_å😀',chunk=Buffer.alloc(1024*1024,120);
const emit=(fd,count)=>{for(let left=count;left>0;){const n=Math.min(chunk.length,left);fs.writeSync(fd,chunk,0,n);left-=n}};
const write=(fd,s)=>fs.writeSync(fd,s);
switch(scenario){
 case 'json':write(1,JSON.stringify({marker:process.env.H_SQL_TEST_MARKER,inputSHA256:hash(input)}));break;
 case 'empty':write(1,' \n\t ');break;
 case 'padded':write(1,' \n {"ok":true} \t\n');break;
 case 'large-stdout':write(1,'{"body":"');emit(1,BIG);write(1,TAIL+'"}');break;
 case 'large-stderr':emit(2,BIG);write(2,TAIL);write(1,'{"ok":true}');break;
 case 'nonzero':write(1,'{"partial":true}');write(2,'declared stderr å\n');process.exitCode=23;break;
 case 'large-nonzero':write(1,'{"partial":true}');emit(2,BIG);write(2,TAIL);process.exitCode=23;break;
 case 'signal':write(1,'signal stdout å');write(2,'signal stderr 😀');process.kill(process.pid,'SIGTERM');break;
 case 'timeout':write(1,'timeout stdout å');write(2,'timeout stderr 😀');setInterval(()=>{},1000);break;
 case 'malformed':write(1,'{"broken":');break;
 case 'identity':{
  const barrier=process.env.H_SQL_TEST_BARRIER,worker=process.env.H_SQL_TEST_WORKER;
  if(!barrier||!['one','two'].includes(worker))throw Error('required_overlap_coordinator_missing');
  {
   fs.writeFileSync(path.join(barrier,worker+'.ready'),String(process.pid),{mode:384});
   const until=Date.now()+5000,wait=new Int32Array(new SharedArrayBuffer(4));
   while(!['one','two'].every(v=>fs.existsSync(path.join(barrier,v+'.ready')))){
    if(Date.now()>until)throw Error('overlap_barrier_timeout');Atomics.wait(wait,0,0,10);
   }
   const traceTemporary=path.join(barrier,worker+'.trace.tmp');
   fs.copyFileSync(process.env.H_SQL_TEST_TRACE,traceTemporary);
   fs.renameSync(traceTemporary,path.join(barrier,worker+'.trace'));
   while(!['one','two'].every(v=>fs.existsSync(path.join(barrier,v+'.trace')))){
    if(Date.now()>until)throw Error('overlap_trace_timeout');Atomics.wait(wait,0,0,10);
   }
  }
  write(1,JSON.stringify({marker:process.env.H_SQL_TEST_MARKER,inputSHA256:hash(input)}));break;
 }
 default:throw Error('undeclared_fake_psql_scenario');
}
`

type Trace={pid:number;args:string[];inputBytes:number;inputSHA256:string;stdout:{regular:boolean;mode:number;target:string|null};stderr:{regular:boolean;mode:number;target:string|null}}
type ChildError=Error&{code?:string;status?:number|null;signal?:string|null;stdout?:string|null;stderr?:string|null;output?:Array<string|null>}
let root:string,bin:string,spool:string,tracePath:string
let previous:Map<string,string|undefined>
let stderrBytes:number,stderrHash:ReturnType<typeof createHash>
let stderrSpy:{mockRestore:()=>void}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
function repeatedHash(count:number,tail=''){
 const value=createHash('sha256'),chunk=Buffer.alloc(1024*1024,120)
 for(let left=count;left>0;){const n=Math.min(left,chunk.length);value.update(chunk.subarray(0,n));left-=n}
 return value.update(tail).digest('hex')
}
function capture<T>(call:()=>T):{value?:T;error?:ChildError}{try{return {value:call()}}catch(error){return {error:error as ChildError}}}
function smallError(error:ChildError|undefined){return error?{name:error.name,code:error.code??null,status:error.status??null,signal:error.signal??null,messagePrefix:error.message.slice(0,100)}:null}
function trace():Trace{return JSON.parse(readFileSync(tracePath,'utf8')) as Trace}
function scenario(name:string){process.env.H_SQL_TEST_SCENARIO=name}
function noHelperLeak(){expect(readdirSync(spool).filter(name=>name.startsWith('gridex-h-native-sql-'))).toEqual([])}
function regularPrivateStreams(t:Trace){
 expect(t.stdout.regular).toBe(true);expect(t.stderr.regular).toBe(true)
 expect(t.stdout.mode).toBe(0o600);expect(t.stderr.mode).toBe(0o600)
 expect(t.stdout.target).not.toBe(t.stderr.target)
 expect(t.stdout.target?.startsWith(spool+'/gridex-h-native-sql-')).toBe(true)
 expect(t.stderr.target?.startsWith(spool+'/gridex-h-native-sql-')).toBe(true)
 expect(existsSync(t.stdout.target!)).toBe(false);expect(existsSync(t.stderr.target!)).toBe(false)
}

type WorkerResult={code:number|null;signal:NodeJS.Signals|null;output:string;error?:Error}
type OverlapWorker={child:ChildProcess;done:Promise<WorkerResult>;result?:WorkerResult}
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,10))
async function awaitLaunch(ready:()=>boolean,workers:OverlapWorker[]=[]){
 const deadline=Date.now()+30000
 while(!ready()){
  const failed=workers.find(worker=>worker.result)
  if(failed)throw Error('overlap_worker_exited_before_launch:'+JSON.stringify(failed.result))
  if(Date.now()>=deadline)throw Error('overlap_worker_launch_timeout')
  await pause()
 }
}
function startOverlapWorker(worker:'one'|'two',barrier:string,shared:string):OverlapWorker{
 // Resolve the installed runner before launching. PATH remains fake-psql-only;
 // neither the runner nor its child may discover a real database executable.
 const cli=join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs')
 const child=spawn(process.execPath,[cli,'run',resolve('__tests__/ediel-h-native-sql-output-buffer-completeness-c-final.test.ts'),
  '--config',resolve('vitest.config.ts'),'--maxWorkers=1','--no-file-parallelism','--coverage.enabled=false','--reporter=dot','-t',OVERLAP_TEST],{
  cwd:process.cwd(),detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,
   H_SQL_TEST_BARRIER:barrier,H_SQL_TEST_WORKER:worker,H_SQL_TEST_SHARED_SPOOL:shared,H_SQL_TEST_LAUNCH_COORDINATOR:'1'},
 })
 let output='',launchError:Error|undefined
 const append=(chunk:Buffer)=>{output=(output+chunk.toString('utf8')).slice(-32768)}
 child.stdout!.on('data',append);child.stderr!.on('data',append)
 const owned={} as OverlapWorker
 owned.child=child
 owned.done=new Promise<WorkerResult>(resolve=>{
  child.once('error',error=>{launchError=error})
  child.once('close',(code,signal)=>{owned.result={code,signal,output,...(launchError?{error:launchError}:{})};resolve(owned.result)})
 })
 return owned
}
async function drainOwnedWorkers(workers:OverlapWorker[]){
 const signal=(worker:OverlapWorker,value:NodeJS.Signals)=>{
  if(worker.result||!worker.child.pid)return
  // Each detached Linux process group belongs to this one test invocation.
  try{process.kill(-worker.child.pid,value)}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error}
 }
 for(const worker of workers)signal(worker,'SIGTERM')
 const escalation=setTimeout(()=>{for(const worker of workers)signal(worker,'SIGKILL')},1000)
 try{await Promise.all(workers.map(worker=>worker.done))}finally{clearTimeout(escalation)}
}
async function coordinateOverlap(){
 const barrier=join(root,'barrier'),shared=join(root,'shared-spool'),workers:OverlapWorker[]=[]
 mkdirSync(barrier,{mode:0o700});mkdirSync(shared,{mode:0o700})
 let deadline:ReturnType<typeof setTimeout>|undefined
 try{
  // Start both OS workers before awaiting either. The launch handshake excludes
  // runner startup from the unchanged fake-psql five-second overlap barrier.
  workers.push(startOverlapWorker('one',barrier,shared))
  workers.push(startOverlapWorker('two',barrier,shared))
  await awaitLaunch(()=>['one','two'].every(worker=>existsSync(join(barrier,worker+'.launched'))),workers)
  writeFileSync(join(barrier,'launch.release'),'admit both owned workers',{mode:0o600})
  const results=await Promise.race([Promise.all(workers.map(worker=>worker.done)),new Promise<never>((_,reject)=>{
   deadline=setTimeout(()=>reject(Error('overlap_worker_completion_timeout')),15000)
  })])
  for(const result of results){expect(result.error).toBeUndefined();expect(result.signal,result.output).toBeNull();expect(result.code,result.output).toBe(0)}
  // The workers assert exact input/marker identity and every private FD while
  // overlapping. Cleanup is global only after both actual runners have exited.
  const traces=['one','two'].map(worker=>JSON.parse(readFileSync(join(barrier,worker+'.trace'),'utf8')) as Trace)
  expect(new Set(traces.map(trace=>trace.pid)).size).toBe(2)
  expect(new Set(traces.flatMap(trace=>[trace.stdout.target,trace.stderr.target])).size).toBe(4)
  expect(readdirSync(shared)).toEqual([]);noHelperLeak()
 }finally{
  if(deadline)clearTimeout(deadline)
  await drainOwnedWorkers(workers)
 }
}

beforeEach(()=>{
 if(process.platform!=='linux')throw Error('declared_linux_fd_contract_required')
 previous=new Map(ENV_KEYS.map(key=>[key,process.env[key]]))
 root=mkdtempSync(join(tmpdir(),'gridex-h-output-proof-'));chmodSync(root,0o700)
 bin=join(root,'bin');mkdirSync(bin,{mode:0o700})
 // Ordinary controls use private per-test spools; only the overlap case shares one.
 spool=join(root,'spool');mkdirSync(spool,{mode:0o700})
 tracePath=join(root,'trace.json')
 writeFileSync(join(bin,'psql'),'#!'+process.execPath+'\n'+fakePsql,{mode:0o700})
 process.env.PATH=bin;process.env.TMPDIR=spool
 process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
 process.env.H_SQL_TEST_TRACE=tracePath;process.env.H_SQL_TEST_MARKER=randomUUID()
 scenario('json');stderrBytes=0;stderrHash=createHash('sha256')
 stderrSpy=vi.spyOn(process.stderr,'write').mockImplementation(((chunk:string|Uint8Array,...rest:unknown[])=>{
  const data=typeof chunk==='string'?Buffer.from(chunk,typeof rest[0]==='string'?rest[0] as BufferEncoding:'utf8'):Buffer.from(chunk)
  stderrBytes+=data.length;stderrHash.update(data)
  const callback=rest.find(value=>typeof value==='function') as (()=>void)|undefined
  if(callback)callback();return true
 }) as typeof process.stderr.write)
})
afterEach(()=>{
 stderrSpy?.mockRestore()
 for(const [key,value] of previous){if(value===undefined)delete process.env[key];else process.env[key]=value}
 rmSync(root,{recursive:true,force:true})
})

describe('actual H nativeSql with declared fake psql, SOURCE only',()=>{
 it('keeps the local URL guard before any process or spool allocation',()=>{
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://invalid.example.test'
  expect(()=>nativeSql('guard')).toThrow('owned_local_only')
  expect(existsSync(tracePath)).toBe(false);noHelperLeak()
 })
 it('keeps fixed psql argv and exact Unicode stdin',()=>{
  const input='SELECT declared_only; -- å 😀\n',result=nativeSql<{marker:string;inputSHA256:string}>(input),t=trace()
  expect(result).toEqual({marker:process.env.H_SQL_TEST_MARKER,inputSHA256:hash(input)})
  expect(t.args).toEqual(FIXED_ARGS);expect(t.inputBytes).toBe(Buffer.byteLength(input));expect(t.inputSHA256).toBe(hash(input));noHelperLeak()
 })
 it('keeps empty and padded JSON behavior',()=>{
  scenario('empty');expect(nativeSql('empty')).toBeUndefined()
  scenario('padded');expect(nativeSql('padded')).toEqual({ok:true});noHelperLeak()
 })
 it('returns complete valid JSON beyond the former 64 MiB stdout ceiling',()=>{
  scenario('large-stdout');const result=capture(()=>nativeSql<{body:string}>('large stdout'))
  expect(smallError(result.error)).toBeNull()
  expect(result.value).toBeDefined()
  expect(result.value).not.toBeNull()
  const body=result.value!.body
  expect(body.length).toBe(BIG+TAIL.length)
  expect(body.endsWith(TAIL)).toBe(true);expect(hash(body)).toBe(repeatedHash(BIG,TAIL));noHelperLeak()
 },20000)
 it('accepts complete stderr beyond 64 MiB while preserving a successful result',()=>{
  scenario('large-stderr');const result=capture(()=>nativeSql('large stderr'))
  expect(smallError(result.error)).toBeNull();expect(result.value).toEqual({ok:true})
  expect(stderrBytes).toBe(BIG+Buffer.byteLength(TAIL));expect(stderrHash.digest('hex')).toBe(repeatedHash(BIG,TAIL));noHelperLeak()
 },20000)
 it('preserves nonzero status and full small stream/error metadata',()=>{
  scenario('nonzero');const result=capture(()=>nativeSql('small failure')),error=result.error!
  expect(smallError(error)?.status).toBe(23);expect(error.signal).toBeNull()
  expect(error.stdout).toBe('{"partial":true}');expect(error.stderr).toBe('declared stderr å\n')
  expect(error.output).toEqual([null,error.stdout,error.stderr]);expect(error.message.endsWith('\ndeclared stderr å\n')).toBe(true)
  expect(stderrBytes).toBe(Buffer.byteLength(error.stderr!));noHelperLeak()
 })
 it('preserves exit 23 and complete error streams beyond the former ceiling',()=>{
  scenario('large-nonzero');const result=capture(()=>nativeSql('large failure')),error=result.error
  expect(smallError(error)?.status).toBe(23);expect(error?.code).toBeUndefined();expect(error?.signal).toBeNull()
  expect(error?.stdout).toBe('{"partial":true}');expect(error?.stderr?.length).toBe(BIG+TAIL.length)
  expect(error?.stderr?.endsWith(TAIL)).toBe(true);expect(hash(error?.stderr??'')).toBe(repeatedHash(BIG,TAIL))
  expect(error?.output?.[1]).toBe(error?.stdout);expect(error?.output?.[2]).toBe(error?.stderr)
  expect(hash(error?.message??'')).toBe(hash('Command failed: psql '+FIXED_ARGS.join(' ')+'\n'+(error?.stderr??'')))
  expect(stderrBytes).toBe(BIG+Buffer.byteLength(TAIL));noHelperLeak()
 },20000)
 it('preserves non-timeout signal metadata and full stderr in the error message',()=>{
  scenario('signal');const result=capture(()=>nativeSql('signal')),error=result.error
  expect(smallError(error)?.status).toBeNull();expect(error?.signal).toBe('SIGTERM');expect(error?.code).toBeUndefined()
  expect(error?.stdout).toBe('signal stdout å');expect(error?.stderr).toBe('signal stderr 😀')
  expect(error?.output).toEqual([null,error?.stdout,error?.stderr])
  expect(error?.message).toBe('Command failed: psql '+FIXED_ARGS.join(' ')+'\n'+error?.stderr);noHelperLeak()
 })
 it('preserves the existing real 10000 ms timeout and captured streams',()=>{
  scenario('timeout');const started=Date.now(),result=capture(()=>nativeSql('timeout')),error=result.error
  expect(smallError(error)?.code).toBe('ETIMEDOUT');expect(error?.status).toBeNull();expect(error?.signal).toBe('SIGTERM')
  expect(Date.now()-started).toBeGreaterThanOrEqual(9500)
  expect(error?.stdout).toBe('timeout stdout å');expect(error?.stderr).toBe('timeout stderr 😀')
  expect(error?.output).toEqual([null,error?.stdout,error?.stderr]);noHelperLeak()
 },20000)
 it('keeps malformed JSON as SyntaxError and removes its temporary files',()=>{
  scenario('malformed');const result=capture(()=>nativeSql('malformed'))
  expect(result.error?.name).toBe('SyntaxError');noHelperLeak()
 })
 it('preserves spawn failure without finding a real psql',()=>{
  rmSync(join(bin,'psql'));const result=capture(()=>nativeSql('launch failure')),error=result.error
  expect(smallError(error)?.code).toBe('ENOENT');expect(error?.status).toBeNull();expect(error?.signal).toBeNull()
  expect(error?.stdout).toBeUndefined();expect(error?.stderr).toBeUndefined();expect(existsSync(tracePath)).toBe(false);noHelperLeak()
 })
 it('uses private distinct regular stream files and removes them after success',()=>{
  nativeSql('private streams');regularPrivateStreams(trace());noHelperLeak()
 })
 it(OVERLAP_TEST,async()=>{
  const barrier=process.env.H_SQL_TEST_BARRIER,worker=process.env.H_SQL_TEST_WORKER,shared=process.env.H_SQL_TEST_SHARED_SPOOL
  const launch=process.env.H_SQL_TEST_LAUNCH_COORDINATOR
  if([barrier,worker,shared,launch].every(value=>value===undefined)){await coordinateOverlap();return}
  expect(Boolean(barrier&&shared&&['one','two'].includes(worker??''))).toBe(true)
  if(!barrier||!shared||!['one','two'].includes(worker??''))throw Error('required_overlap_coordinator_missing')
  if(launch!==undefined&&launch!=='1')throw Error('invalid_overlap_launch_coordinator')
  for(const directory of [barrier,shared]){const stat=lstatSync(directory);expect(stat.isDirectory()).toBe(true);expect(stat.mode&0o777).toBe(0o700)}
  if(launch==='1'){
   writeFileSync(join(barrier,worker+'.launched'),String(process.pid),{mode:0o600})
   await awaitLaunch(()=>existsSync(join(barrier,'launch.release')))
  }
  spool=shared;process.env.TMPDIR=shared
  scenario('identity');const input='identity '+process.env.H_SQL_TEST_MARKER
  expect(nativeSql(input)).toEqual({marker:process.env.H_SQL_TEST_MARKER,inputSHA256:hash(input)})
  const t=trace();expect(t.inputSHA256).toBe(hash(input));regularPrivateStreams(t)
  const other=worker==='one'?'two':'one',peer=JSON.parse(readFileSync(join(barrier,other+'.trace'),'utf8')) as Trace
  expect(Number(readFileSync(join(barrier,worker+'.ready'),'utf8'))).toBe(t.pid)
  expect(Number(readFileSync(join(barrier,other+'.ready'),'utf8'))).toBe(peer.pid)
  expect(peer.pid).toBeGreaterThan(0);expect(peer.pid).not.toBe(t.pid);expect(peer.inputSHA256).not.toBe(t.inputSHA256)
  expect(peer.stdout.regular&&peer.stderr.regular).toBe(true);expect(peer.stdout.mode).toBe(0o600);expect(peer.stderr.mode).toBe(0o600)
  expect(new Set([t.stdout.target,t.stderr.target,peer.stdout.target,peer.stderr.target]).size).toBe(4)
  // Both fake children reached the barrier while holding distinct output FDs.
  // A peer may still own its directory; coordinator checks global cleanup after BOTH exit.
 },50000)
})
