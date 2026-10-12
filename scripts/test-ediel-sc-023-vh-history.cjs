// masterplan: ESCO-07, SC-023, AT-Z15V-ESCO, AT-Z15VH-ESCO
// Finite source-mechanics proof; no native/source admission substitution.
const {spawnSync}=require('node:child_process')
const path=require('node:path')
const root=path.join(__dirname,'..')
if(process.argv.includes('--pg-lock')){
 pgLockProof().catch(error=>{console.error(error);process.exitCode=1})
 return
}
if(process.env.EDIEL_SC023_TS_ONLY!=='1'){
const run=spawnSync(process.execPath,[path.join(__dirname,'ediel-partial-permission-source-sql-regression.mjs')],{
 cwd:root,encoding:'utf8',env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite'),EDIEL_PERMISSION_PROBE_MODULE:path.join(__dirname,'ediel-sc-023-vh-history-sql-regression.mjs')}
})
if(run.status!==0){console.error(JSON.stringify({status:run.status,signal:run.signal,error:run.error?.message}));console.error(run.stdout);console.error(run.stderr);process.exit(1)}
if(!/SC-023 own history SQL: 46 cases PASS;/.test(run.stdout)){console.error('SC023_SQL_NOT_EXECUTED: no completed own SQL result');console.error(run.stderr);process.exit(1)}
console.log(run.stdout)
}

// Real own TS facade with a typed RPC IO port; the SQL suite above checks the
// actual authorization/writer. This does not wire or simulate generated types.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const moduleCache=new Map()
function ownModule(file){
 if(moduleCache.has(file))return moduleCache.get(file)
 const output=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText
 const module={exports:{}};moduleCache.set(file,module.exports)
 const ownRequire=name=>{if(name==='../services/vhHistoryDelivery')return ownModule('lib/ediel/services/vhHistoryDelivery.ts');throw Error('unexpected_SC023_IO:'+name)}
 vm.runInNewContext(output,{module,exports:module.exports,require:ownRequire},{filename:file})
 return module.exports
}
async function typedProof(){
 const service=ownModule('lib/ediel/services/vhHistoryDelivery.ts'),flow=ownModule('lib/ediel/flows/vhHistoryRequest.ts')
 const company='00000000-0000-0000-0000-000000000001',permission='00000000-0000-0000-0000-000000900110',actor='00000000-0000-0000-0000-000000000002',site='00000000-0000-0000-0000-000000970010',request='00000000-0000-0000-0000-000000975002',message='00000000-0000-0000-0000-000000975001'
 const input={companyId:company,permissionId:permission,actorUserId:actor},link={...input,siteId:site,requestId:request,messageId:message,transactionId:'SC023-VH-REQUEST'}
 const own={siteId:site,point:'735123456789099990',product:'8716867000030',approvedStart:'2025-12-31T23:00:00Z',approvedEnd:'2026-01-01T23:00:00Z',basisHash:'a'.repeat(64),closure:null,closureHistory:[],requests:[]}
 const value={companyId:company,permissionId:permission,environment:'test',state:'approved_or_receiving',openingSourceMessageId:'00000000-0000-0000-0000-000000900130',objects:[own],dataAccessGranted:false,transportAuthorityGranted:false}
 let result=value,calls=[]
 const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='ediel_vh_history_delivery_audit_v1')return{error:null,data:result};if(result.state==='historical_delivery_closed')return{data:null,error:new Error('vh_history_request_delivery_closed')};return{error:null,data:{requestId:request,state:'awaiting',idempotent:false,transportAuthorityGranted:false}}}}
 assert.equal((await service.readVhHistoryDeliveryAudit(client,input)).permissionId,permission)
 assert.equal(calls[0].args.p_actor_user_id,actor)
 result={...value,companyId:'00000000-0000-0000-0000-000000000099'}
 await assert.rejects(service.readVhHistoryDeliveryAudit(client,input),/vh_history_audit_scope_invalid/)
 result={...value,state:'historical_delivery_closed'};calls=[]
 await assert.rejects(flow.linkExistingVhHistoryRequest(client,link),/vh_history_request_delivery_closed/)
 assert.equal(calls.length,1,'closed history is rejected by authoritative SQL link, without a read, enqueue or retry call')
 assert.equal(calls[0].name,'ediel_link_vh_history_request_v1')
 result=value;calls=[]
 const linked=await flow.linkExistingVhHistoryRequest(client,link)
 assert.equal(linked.state,'awaiting');assert.equal(calls.length,1);assert.equal(calls[0].args.p_request_id,request);assert.equal(calls[0].args.p_actor_user_id,actor)
 const writeOnlyCalls=[]
 const writeOnly={rpc:async(name,args)=>{writeOnlyCalls.push({name,args});return name==='ediel_vh_history_delivery_audit_v1'?{data:null,error:new Error('42501: metering.read denied for legitimate link writer')}:{error:null,data:{requestId:request,state:'awaiting',idempotent:false,transportAuthorityGranted:false}}}}
 assert.equal((await flow.linkExistingVhHistoryRequest(writeOnly,link)).state,'awaiting','typed link must retain the SQL write operation authority without adding metering.read')
 assert.equal(writeOnlyCalls.length,1);assert.equal(writeOnlyCalls[0].name,'ediel_link_vh_history_request_v1')
 calls=[];await assert.rejects(flow.linkExistingVhHistoryRequest(client,{...link,siteId:'not-an-id'}),/vh_history_request_scope_unqualified/);assert.equal(calls.length,0,'invalid scope is rejected before IO')
 const replay={rpc:async name=>{assert.equal(name,'ediel_link_vh_history_request_v1');return{error:null,data:{requestId:request,state:'manual_review',idempotent:true,transportAuthorityGranted:false}}}}
 assert.deepEqual(JSON.parse(JSON.stringify(await flow.linkExistingVhHistoryRequest(replay,link))),{requestId:request,state:'manual_review',idempotent:true,transportAuthorityGranted:false},'authoritative exact replay retains manual review without new read or transport authority')
 const upper={...link,companyId:'A0000000-0000-0000-0000-000000000001',permissionId:'B0000000-0000-0000-0000-000000900110',actorUserId:'F0000000-0000-0000-0000-000000000002',siteId:'D0000000-0000-0000-0000-000000970010',requestId:'C0000000-0000-0000-0000-000000975002',messageId:'E0000000-0000-0000-0000-000000975001'}
 const canonicalCalls=[],canonical={rpc:async(name,args)=>{canonicalCalls.push({name,args});return{error:null,data:name==='ediel_vh_history_delivery_audit_v1'?{...value,companyId:upper.companyId.toLowerCase(),permissionId:upper.permissionId.toLowerCase()}:{requestId:upper.requestId.toLowerCase(),state:'awaiting',idempotent:false,transportAuthorityGranted:false}}}}
 const upperResults=await Promise.allSettled([service.readVhHistoryDeliveryAudit(canonical,upper),flow.linkExistingVhHistoryRequest(canonical,upper)])
 if(upperResults.some(r=>r.status==='rejected'))console.error(upperResults.map(r=>r.status==='rejected'?String(r.reason):r.status))
 assert.deepEqual(upperResults.map(r=>r.status),['fulfilled','fulfilled'],'accepted uppercase UUIDs must agree with PostgreSQL canonical lowercase results')
 assert.equal(upperResults[0].value.companyId,upper.companyId.toLowerCase());assert.equal(upperResults[1].value.requestId,upper.requestId.toLowerCase())
 for(const call of canonicalCalls)for(const [key,value]of Object.entries(call.args))if(key!=='p_transaction_id')assert.equal(value,value.toLowerCase(),'canonicalize UUID before IO')
 console.log('SC-023 actual typed audit/link facade: 9 cases PASS; injected RPC IO only, generated/native consumer NOT_VERIFIED.')
}
typedProof().catch(error=>{console.error(error);process.exitCode=1})

// Real PostgreSQL17, two workers and a lock observer. No Supabase replay,
// native/capture/GEN, external data, ports or mounts. Authority and cohort DML
// below are finite ports; exact captured graph helpers and pg_proc scheduling
// from the actual owned/public functions are real. They prove lock order only.
async function pgLockProof(){
 const {spawn}=require('node:child_process'),fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto')
 const container=process.env.EDIEL_SC023_PG_CONTAINER
 assert.equal(container,'sc023-lock-a889d2bf','use the explicitly owned disposable container only')
 const schema=fs.readFileSync(path.join(root,'supabase/schema.sql'),'utf8')
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261012212000_ediel_vh_history_delivery_sc023.sql'),'utf8')
 const hash=x=>crypto.createHash('sha256').update(x).digest('hex')
 function captured(name,source=schema){
  const start=source.indexOf('CREATE FUNCTION '+name+'(');assert.ok(start>=0,name)
  const tail=source.slice(start),delimiter=tail.match(/\bAS (\$[\w]*\$)/)?.[1];assert.ok(delimiter,name)
  const begin=tail.indexOf(delimiter),end=tail.indexOf(delimiter+';',begin+delimiter.length);assert.ok(end>begin,name)
  return {definition:tail.slice(0,end+delimiter.length+1),body:tail.slice(begin+delimiter.length,end)}
 }
 const helpers=['gridex_ediel_ack_replay.lock_current_graph_v2','gridex_ediel_services.lock_evidence_graph_v1','gridex_service_permission.lock_request_writer_v1'].map(name=>captured(name))
 assert.equal(hash(helpers[2].body),'da71d930e83ca1407ef7e192b2a03165069195aab8faa48aa9de8da648c7d1a9')
 const predecessor=captured('public.ediel_apply_permission_source_v1')
 // CURRENT authentic capture has the early prefix; the migration retains its
 // distinct historical predecessor hash for actual canonical replay.
 assert.equal(hash(predecessor.body),'0b24a3fec54ca9e73a235326fcfe3f9c75216a0b146bb1ed9c9d18924b42ec0e')
 let serial=0
 class Session{
  constructor(name){
   this.name=name;this.pending=new Map();this.errors='';this.output='';this.buffer=''
   this.child=spawn('docker',['exec','-i',container,'psql','-X','-A','-t','-U','postgres','-d','postgres'],{stdio:['pipe','pipe','pipe']})
   this.child.stdout.setEncoding('utf8');this.child.stderr.setEncoding('utf8')
   this.child.stdout.on('data',chunk=>{this.output+=chunk;this.buffer+=chunk;let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at).trim();this.buffer=this.buffer.slice(at+1);const task=this.pending.get(line);if(task){clearTimeout(task.timer);this.pending.delete(line);task.resolve(this.output.slice(task.from))}}})
   this.child.stderr.on('data',chunk=>{this.errors+=chunk})
  }
  sql(command){
   const marker='SC023_MARK_'+(++serial),from=this.output.length
   const promise=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(this.name+': component command timeout: '+command)),12000);this.pending.set(marker,{resolve,timer,from})})
   this.child.stdin.write(command+'\n\\echo '+marker+'\n');return promise
  }
  end(){this.child.stdin.end('ROLLBACK;\n\\q\n')}
 }
 const observer=new Session('observer'),a=new Session('writerA'),b=new Session('workerB'),sessions=[observer,a,b]
 try{
  await Promise.all(sessions.map(s=>s.sql("\\set VERBOSITY verbose\nSET deadlock_timeout='100ms';SET statement_timeout='10s';SET application_name='sc023-"+s.name+"';")))
  const relations=new Set(['public.ediel_messages','gridex_vh_history.deliveries','gridex_vh_history.requests'])
  for(const fn of [predecessor,captured('public.ediel_vh_history_delivery_audit_v1',migration),captured('public.ediel_link_vh_history_request_v1',migration)])for(const match of fn.body.matchAll(/([a-z_]+\.[a-z_0-9]+)%rowtype/g))relations.add(match[1])
  for(const helper of helpers)for(const match of helper.body.matchAll(/LOCK TABLE\s+([\s\S]*?)\s+IN (?:SHARE|SHARE ROW EXCLUSIVE) MODE;/g))for(const table of match[1].split(','))relations.add(table.trim())
  const schemas=[...new Set([...relations].map(r=>r.split('.')[0]).concat('gridex_service_permission','gridex_ediel_ack_replay'))].filter(x=>x!=='public')
  const setup=[...['public',...schemas].map(x=>'DROP SCHEMA IF EXISTS '+x+' CASCADE;CREATE SCHEMA '+x+';'),"DO $$BEGIN CREATE ROLE service_role;EXCEPTION WHEN duplicate_object THEN NULL;END$$;",...[...relations].map(r=>'CREATE TABLE '+r+'(id integer PRIMARY KEY,version integer DEFAULT 0);'),...helpers.map(h=>h.definition),predecessor.definition,captured('public.ediel_vh_history_delivery_audit_v1',migration).definition,captured('public.ediel_link_vh_history_request_v1',migration).definition,"GRANT USAGE ON ALL SCHEMAS IN DATABASE postgres TO service_role;"]
  // PostgreSQL has no ALL SCHEMAS shorthand: fixture grants are explicit and
  // apply only inside this disposable database, never production migrations.
  setup.pop();setup.push(...['public',...schemas].map(x=>'GRANT USAGE ON SCHEMA '+x+' TO service_role;'),'GRANT ALL ON ALL TABLES IN SCHEMA public,gridex_vh_history TO service_role;')
  // The installed CURRENT captured writer already contains the prefix. The
  // production migration keeps its historical predecessor guard; applying
  // that hook twice to a captured postimage would misrepresent the fixture.
  await observer.sql(setup.join('\n'))
  assert.equal(/ERROR:/.test(observer.errors),false,'actual captured helper/function/guard bootstrap must execute: '+observer.errors)
  const proc=await observer.sql("SELECT json_build_object('writer',p.prosrc,'audit',a.prosrc,'link',l.prosrc)::text FROM pg_proc p,pg_proc a,pg_proc l WHERE p.oid='public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid)'::regprocedure AND a.oid='public.ediel_vh_history_delivery_audit_v1(uuid,uuid,uuid)'::regprocedure AND l.oid='public.ediel_link_vh_history_request_v1(uuid,uuid,uuid,uuid,uuid,text,uuid)'::regprocedure;")
  const bodies=JSON.parse(proc.split('\n').find(line=>line.startsWith('{')))
  const writerAt=bodies.writer.indexOf('PERFORM gridex_service_permission.lock_request_writer_v1();'),sourceAt=bodies.writer.indexOf('SELECT * INTO m FROM public.ediel_messages')
  const writerEarly=writerAt>=0&&writerAt<sourceAt
  const readerEarly=name=>{const x=bodies[name];return x.indexOf('PERFORM gridex_ediel_services.lock_evidence_graph_v1();')>=0&&x.indexOf('PERFORM gridex_ediel_services.lock_evidence_graph_v1();')<x.indexOf('PERFORM gridex_vh_history.')}
  console.log(JSON.stringify({postgres:'17',migrationHash:hash(migration),predecessorHash:hash(predecessor.body),helperHash:hash(helpers[2].body),writerEarly,auditEarly:readerEarly('audit'),linkEarly:readerEarly('link'),ports:['permission admission','cohort DML','historical original authority','E66/DDQ data'],whole:'NOT_EXECUTED'}))
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  async function blocked(name,graphMode=null){
   for(let i=0;i<80;i++){
    const x=await observer.sql("SELECT json_build_object('mode',l.mode,'relation',l.relation::regclass::text,'sourceOrJobLock',(SELECT count(*) FROM pg_locks own WHERE own.pid=a.pid AND own.granted AND own.relation IN('public.ediel_messages'::regclass,'gridex_vh_history.deliveries'::regclass)))::text FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid AND NOT l.granted WHERE a.application_name='sc023-"+name+"' AND a.wait_event_type='Lock';")
    const line=x.split('\n').find(s=>s.startsWith('{'))
    if(line){const lock=JSON.parse(line);if(graphMode){assert.equal(lock.mode,graphMode);assert.ok(lock.relation);assert.equal(lock.sourceOrJobLock,0,'the waiting second worker has no source/job lock before graph acquisition');console.log(JSON.stringify({blockedWorker:name,earlyLock:lock}))}return}
    await pause(20)
   }
   throw Error(name+' did not block at the required early lock boundary')
  }
  const failures=[]
  async function workersCase(label,body){
   await observer.sql('TRUNCATE public.ediel_messages,public.metering_permissions,public.metering_permission_sites,gridex_vh_history.deliveries;INSERT INTO public.ediel_messages(id) VALUES(1),(2),(42);INSERT INTO public.metering_permissions(id,version) VALUES(1,0),(2,0),(99,17);INSERT INTO public.metering_permission_sites(id,version) VALUES(1,0),(2,0),(99,23);INSERT INTO gridex_vh_history.deliveries(id) VALUES(42);')
   const errorsAt=sessions.map(s=>s.errors.length)
   await Promise.all([a.sql('BEGIN;SET ROLE service_role;'),b.sql('BEGIN;SET ROLE service_role;')])
   await body()
   await Promise.all([a.sql('COMMIT;RESET ROLE;'),b.sql('COMMIT;RESET ROLE;')])
   const errors=sessions.map((s,i)=>s.errors.slice(errorsAt[i])).join('\n'),deadlock=/40P01/.test(errors)
   assert.deepEqual([...errors.matchAll(/^ERROR:\s+(\w{5}):/gm)].map(x=>x[1]).filter(x=>!['40P01','25P02'].includes(x)),[],'a bootstrap/authority error is not the lock witness: '+errors)
   const rows=await observer.sql("SELECT json_build_object('versions',(SELECT json_agg(version ORDER BY id) FROM public.metering_permissions),'jobs',(SELECT json_agg(json_build_object('id',id,'version',version) ORDER BY id) FROM gridex_vh_history.deliveries))::text;")
   const snapshot=JSON.parse(rows.split('\n').find(x=>x.startsWith('{')))
   assert.equal(snapshot.versions[2],17,'independent V permission value is unchanged')
   console.log(JSON.stringify({case:label,deadlock,committedSnapshot:snapshot,sqlstate:deadlock?'40P01':null}))
   if(errors)console.log(errors)
   if(deadlock)failures.push(label+': genuine 40P01 rolls back a legitimate finite operation')
   else if(label.startsWith('distinct')){assert.deepEqual(snapshot.versions,[1,1,17]);assert.deepEqual(snapshot.jobs,[{id:1,version:0},{id:2,version:0},{id:42,version:0}],'both exact finite history jobs commit')}
   else{assert.deepEqual(snapshot.versions,[0,0,17]);assert.deepEqual(snapshot.jobs,[{id:42,version:1}],'exact finite closure/restoration update commits alongside the original reader')}
  }
  const writerPrefix=writerEarly?'SELECT gridex_service_permission.lock_request_writer_v1();':''
  const effect=n=>"SELECT id FROM public.ediel_messages WHERE id="+n+" FOR UPDATE;UPDATE public.metering_permissions SET version=version+1 WHERE id="+n+";UPDATE public.metering_permission_sites SET version=version+1 WHERE id="+n+";INSERT INTO gridex_vh_history.deliveries(id) VALUES("+n+");"
  await workersCase('distinct S18/Z14 effect-to-reader table lock',async()=>{
   await a.sql(writerPrefix+effect(1))
   const second=b.sql(writerPrefix+effect(2))
   if(writerEarly){await blocked('workerB','ShareRowExclusiveLock');await a.sql('SELECT gridex_ediel_services.lock_evidence_graph_v1();COMMIT;BEGIN;');await second;await b.sql('SELECT gridex_ediel_services.lock_evidence_graph_v1();')}
   else{await second;await Promise.all([a.sql('SELECT gridex_ediel_services.lock_evidence_graph_v1();'),b.sql('SELECT gridex_ediel_services.lock_evidence_graph_v1();')])}
  })
  for(const [name,jobMode,label]of [['audit','SHARE','audit versus S18/Z15 closure'],['link','UPDATE','link versus VH/Z24 restoration']])await workersCase(label,async()=>{
   const readPrefix=readerEarly(name)?'SELECT gridex_ediel_services.lock_evidence_graph_v1();':''
   await a.sql(writerPrefix+'SELECT id FROM public.ediel_messages WHERE id=42 FOR UPDATE;')
   const jobFirst=b.sql(readPrefix+'SELECT id FROM gridex_vh_history.deliveries WHERE id=42 FOR '+jobMode+';')
   if(writerEarly&&readerEarly(name)){await blocked('workerB','ShareLock');await a.sql('UPDATE gridex_vh_history.deliveries SET version=version+1 WHERE id=42;COMMIT;BEGIN;');await jobFirst;await b.sql('SELECT id FROM public.ediel_messages WHERE id=42 FOR SHARE;')}
   else{await jobFirst;const closure=a.sql('UPDATE gridex_vh_history.deliveries SET version=version+1 WHERE id=42;');await blocked('writerA');await Promise.all([closure,b.sql('SELECT id FROM public.ediel_messages WHERE id=42 FOR SHARE;')])}
  })
  assert.deepEqual(failures,[],'both legitimate finite operations must commit without a lock cycle')
  assert.equal(writerEarly&&readerEarly('audit')&&readerEarly('link'),true,'actual owned/public scheduling must precede source/actor/job locks')
  console.log('SC-023 genuine PostgreSQL17 two-worker lock proof: 3 interleavings PASS; domain authority/native/whole NOT_EXECUTED.')
 }finally{for(const session of sessions)session.end()}
}
