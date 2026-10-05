import {execFileSync,spawn} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {afterAll,beforeAll,expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {decisionNativeSql,decisionUser,literal} from './helpers/ediel-decision-original-native-fixture'
import {nativeLockProcess,nativeLockProcessEnv} from './helpers/native-lock-process'

// Genuine local PostgreSQL/GoTrue/permission/publisher/read/prepare boundaries.
// The source and owner references and Latin1 original are explicitly synthetic;
// this proves conflict mechanics, not an authentic certification or market grant.
const companyId=randomUUID(),runId=randomUUID()
const raw="UNB+UNOC:3+S:ZZ+TEST:ZZ+260930:1200+I++APP++++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z09+DOC+9'FTX+AAI+++SYNTHETIC ?+ café'UNT+4+M'UNZ+1+I'"
const bytes=Buffer.from(raw,'latin1'),wireHash=createHash('sha256').update(bytes).digest('hex')
type Outcome='positive'|'negative'
type Context=Record<string,unknown>
let actor:Awaited<ReturnType<typeof decisionUser>>
let authorityBefore:unknown
const validUntil=new Date(Date.now()+3600000).toISOString()
const scope=(outcome:Outcome,stepNo:number):Context=>({companyId,runId,actorUserId:actor.id,
 roleCode:'supplier',caseCode:'synthetic-native-outcome',suite:'PRODAT',revision:'synthetic-native-v1',stepNo,
 sourceReference:'synthetic://native-original-outcome',ownerDecisionReference:'synthetic://native-original-owner-decision',
 expectedOutcome:outcome,expectedDiagnosticCodes:outcome==='negative'?['SYNTHETIC_NEGATIVE']:[],testReceiverEdielId:'TEST',validUntil})
const publishSql=(context:Context)=>`public.gridex_ediel_${context.expectedOutcome}_fixture_publish_v1(${literal(context)}::jsonb,decode('${bytes.toString('hex')}','hex'))`
const publish=(context:Context)=>decisionNativeSql<string>(`SET ROLE gridex_ediel_fixture_authority_owner;SELECT to_jsonb(${publishSql(context)});RESET ROLE;`)
const originalRowsSql=`SELECT coalesce(jsonb_agg(row ORDER BY row->>'kind',row->>'id'),'[]'::jsonb) FROM (
 SELECT to_jsonb(f)||jsonb_build_object('kind','positive') row FROM gridex_negative_fixtures.positive_originals f WHERE company_id=${literal(companyId)}
 UNION ALL SELECT to_jsonb(f)||jsonb_build_object('kind','negative') row FROM gridex_negative_fixtures.originals f WHERE company_id=${literal(companyId)}) originals`
const originalRows=()=>decisionNativeSql<Context[]>(originalRowsSql)
const authoritySql=`SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='gridex_negative_fixtures' OR(n.nspname='public' AND p.proname LIKE 'gridex_ediel_%_fixture_%')),
 'schema',(SELECT jsonb_build_object('owner',nspowner,'acl',nspacl) FROM pg_namespace WHERE nspname='gridex_negative_fixtures'),
 'tables',(SELECT jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) ORDER BY c.oid)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gridex_negative_fixtures' AND c.relkind='r'),
 'publisherRole',(SELECT to_jsonb(r) FROM pg_roles r WHERE rolname='gridex_ediel_fixture_authority_owner'),
 'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member),'[]'::jsonb) FROM pg_auth_members m
  WHERE m.roleid='gridex_ediel_fixture_authority_owner'::regrole OR m.member='gridex_ediel_fixture_authority_owner'::regrole))`

type Membership={oid:number;roleid:number;member:number;grantor:number;admin_option:boolean;inherit_option:boolean;set_option:boolean}
type NativeAuthority={authority:Context&{memberships:Membership[]};currentUser:string;sessionUser:string;currentRoleOid:number;
 publisherRoleOid:number;serverVersion:number;canSet:boolean;publicUsage:boolean;privateUsage:boolean;publicSchema:unknown;roles:unknown}
const nativeAuthoritySql=`SELECT jsonb_build_object('authority',(${authoritySql}),
 'currentUser',current_user,'sessionUser',session_user,'currentRoleOid',current_user::regrole::oid,
 'publisherRoleOid','gridex_ediel_fixture_authority_owner'::regrole::oid,
 'serverVersion',current_setting('server_version_num')::integer,
 'canSet',pg_has_role(current_user,'gridex_ediel_fixture_authority_owner','SET'),
 'publicUsage',has_schema_privilege('gridex_ediel_fixture_authority_owner','public','USAGE'),
 'privateUsage',has_schema_privilege('gridex_ediel_fixture_authority_owner','gridex_negative_fixtures','USAGE'),
 'publicSchema',(SELECT jsonb_build_object('oid',oid,'owner',nspowner,'acl',nspacl) FROM pg_namespace WHERE nspname='public'),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r WHERE rolname IN(current_user,'gridex_ediel_fixture_authority_owner')))`
const nativeAuthority=()=>decisionNativeSql<NativeAuthority>(nativeAuthoritySql)
let pristineAuthority:NativeAuthority|undefined,bridgeAttempted=false
const ownBridgeRow=(row:Membership,before:NativeAuthority)=>row.roleid===before.publisherRoleOid&&
 row.member===before.currentRoleOid&&row.grantor===before.currentRoleOid

function installNativePublisherBridge(){
 pristineAuthority=nativeAuthority()
 const before=pristineAuthority
 expect(before).toMatchObject({currentUser:'postgres',sessionUser:'postgres'})
 if(!before.publicUsage||!before.privateUsage)throw Error('native_gov08_publisher_namespace_usage_required')
 expect(before.serverVersion).toBeGreaterThanOrEqual(160000)
 expect(before.authority.publisherRole).toMatchObject({rolcanlogin:false})
 if(before.canSet)return
 expect(before.authority.memberships.some(row=>row.roleid===before.publisherRoleOid&&row.member===before.currentRoleOid&&row.admin_option)).toBe(true)
 expect(before.authority.memberships.filter(row=>ownBridgeRow(row,before))).toEqual([])
 // Commit once before concurrent publishers start. A GRANT inside each A/B
 // transaction would serialize pg_auth_members and conceal the product race.
 bridgeAttempted=true
 decisionNativeSql(`BEGIN;
  GRANT gridex_ediel_fixture_authority_owner TO CURRENT_USER WITH SET TRUE GRANTED BY CURRENT_USER;
  GRANT gridex_ediel_fixture_authority_owner TO CURRENT_USER WITH INHERIT FALSE GRANTED BY CURRENT_USER;
  GRANT gridex_ediel_fixture_authority_owner TO CURRENT_USER WITH ADMIN FALSE GRANTED BY CURRENT_USER;
  COMMIT;`)
 const active=nativeAuthority(),added=active.authority.memberships.filter(row=>ownBridgeRow(row,before))
 expect(added).toHaveLength(1)
 expect(added[0]).toMatchObject({admin_option:false,inherit_option:false,set_option:true})
 expect(active.canSet).toBe(true)
 expect({...active,canSet:before.canSet,authority:{...active.authority,
  memberships:active.authority.memberships.filter(row=>!ownBridgeRow(row,before))}}).toEqual(before)
}

function restoreNativePublisherBridge(){
 const before=pristineAuthority
 if(!before)return
 // Inspect actual state even if exec timed out after a successful COMMIT.
 // Never revoke the original creator's membership or any foreign grantor.
 if(bridgeAttempted&&nativeAuthority().authority.memberships.some(row=>ownBridgeRow(row,before))){
  decisionNativeSql(`BEGIN;
   REVOKE gridex_ediel_fixture_authority_owner FROM CURRENT_USER GRANTED BY CURRENT_USER RESTRICT;
   COMMIT;`)
 }
 expect(nativeAuthority()).toEqual(before)
}

afterAll(()=>restoreNativePublisherBridge())

beforeAll(async()=>{
 try{
 decisionNativeSql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'SYNTHETIC native original-outcome tenant','active')`)
 actor=await decisionUser(companyId,['communication.write','communication.send'],'SyntheticNativeOutcome1!')
 decisionNativeSql(`INSERT INTO public.ediel_test_runs(id,company_id,environment,status,role_code,test_suite,test_case_code,approval_version,created_by)
  VALUES(${literal(runId)},${literal(companyId)},'test','draft','supplier','PRODAT','synthetic-native-outcome','synthetic-native-v1',${literal(actor.id)})`)
 installNativePublisherBridge()
 authorityBefore=decisionNativeSql(authoritySql)
 }catch(error){
  try{restoreNativePublisherBridge()}catch(cleanupError){throw new AggregateError([error,cleanupError],'native_gov08_setup_and_cleanup_failed')}
  throw error
 }
})

it.each([{first:'positive' as const,second:'negative' as const,step:1},{first:'negative' as const,second:'positive' as const,step:2}])(
 'authorized $first original remains immutable and idempotent when $second is rejected',async({first,second,step})=>{
  const context=scope(first,step),registrationId=publish(context),before=originalRows()
  expect(publish(context)).toBe(registrationId)
  expect(()=>publish(scope(second,step))).toThrow(`ediel_${second}_fixture_original_conflict`)
  expect(originalRows()).toEqual(before)
  expect(before.find(row=>row.id===registrationId)).toMatchObject({company_id:companyId,run_id:runId,
   role_code:'supplier',case_code:'synthetic-native-outcome',suite:'PRODAT',revision:'synthetic-native-v1',step_no:step,
   expected_outcome:first,expected_diagnostic_codes:context.expectedDiagnosticCodes,original_wire:raw,
   wire_sha256:wireHash,original_file_sha256:wireHash,source_reference:context.sourceReference,owner_decision_reference:context.ownerDecisionReference})
  const readContext={...context,rawPayload:raw,registrationId}
  const read=await supabaseService.rpc(first==='positive'?'gridex_ediel_positive_fixture_read_v1':'gridex_ediel_negative_fixture_prepare_read_v1',{p_context:readContext})
  expect(read.error).toBeNull()
  expect(read.data).toMatchObject({registrationId,wireSha256:wireHash,originalFileSha256:wireHash,expectedOutcome:first,authorizesBusinessEffect:false})
  const prepared=await supabaseService.rpc(`gridex_ediel_${first}_fixture_prepare_v1`,{p_context:readContext})
  expect(prepared.error).toBeNull()
  expect(prepared.data.witnessId).toMatch(/^[a-f0-9-]{36}$/)
  expect(prepared.data.qualification).toEqual(read.data)
  expect(originalRows()).toEqual(before)
 })

it.each(['REPEATABLE READ','SERIALIZABLE','READ COMMITTED','READ UNCOMMITTED'].flatMap((isolation,index)=>[
 {isolation,first:'positive' as const,second:'negative' as const,step:10+index*2},
 {isolation,first:'negative' as const,second:'positive' as const,step:11+index*2},
]))('native $isolation snapshot cannot publish $second after committed $first',async({isolation,first,second,step})=>{
 // B observes the actual original tables before A publishes. Session markers,
 // rather than sleeps, establish the snapshot -> publication -> commit order.
 expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321')
 const before=originalRows(),context=scope(first,step)
 const sessions=['publisher','snapshot'].map(label=>{
  const marker=`gov08_${label}_${randomUUID()}`
  const child=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
   {stdio:['pipe','pipe','pipe'],env:nativeLockProcessEnv()})
  let stdout='',stderr=''
  child.stdout.on('data',chunk=>{stdout+=String(chunk)});child.stderr.on('data',chunk=>{stderr+=String(chunk)})
  const done=new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
   const deadline=setTimeout(()=>reject(Error('native_gov08_psql_completion_timeout')),30000)
   child.once('error',error=>{clearTimeout(deadline);reject(error)})
   child.once('close',code=>{clearTimeout(deadline);resolve({code,stdout,stderr})})
  })
  void done.catch(()=>undefined)
  const lock=nativeLockProcess(child,{marker,markerError:`native_gov08_${label}_ready_timeout`,lifetimeMs:20000})
  return {child,marker,lock,done,output:()=>stdout}
 })
 const [a,b]=sessions
 try{
  b.child.stdin.write(`BEGIN ISOLATION LEVEL ${isolation};
   SELECT ${literal(b.marker)}||':'||current_setting('transaction_isolation')||':'||(
    (SELECT count(*) FROM gridex_negative_fixtures.positive_originals WHERE company_id=${literal(companyId)} AND run_id=${literal(runId)} AND step_no=${step})+
    (SELECT count(*) FROM gridex_negative_fixtures.originals WHERE company_id=${literal(companyId)} AND run_id=${literal(runId)} AND step_no=${step}))::text;\n`)
  await b.lock.ready
  expect(b.output()).toContain(`${b.marker}:${isolation.toLowerCase()}:0`)
  a.child.stdin.write(`BEGIN ISOLATION LEVEL READ COMMITTED;SET LOCAL ROLE gridex_ediel_fixture_authority_owner;
   SELECT to_jsonb(${publishSql(context)});SELECT ${literal(a.marker)}||':'||current_setting('transaction_isolation');\n`)
  await a.lock.ready
  await a.lock.release('COMMIT')
  expect(await a.done).toMatchObject({code:0,stderr:''})
  expect(a.output()).toContain(`${a.marker}:read committed`)
  const committed=originalRows(),original=committed.find(row=>row.step_no===step)
  expect(committed).toHaveLength(before.length+1)
  expect(committed.filter(row=>row.step_no!==step)).toEqual(before)
  expect(original).toMatchObject({kind:first,company_id:companyId,run_id:runId,role_code:'supplier',
   case_code:'synthetic-native-outcome',suite:'PRODAT',revision:'synthetic-native-v1',step_no:step,
   expected_outcome:first,expected_diagnostic_codes:context.expectedDiagnosticCodes,test_receiver_ediel_id:'TEST',
   original_wire:raw,wire_sha256:wireHash,original_file_sha256:wireHash,
   source_reference:context.sourceReference,owner_decision_reference:context.ownerDecisionReference})
  b.child.stdin.end(`SET LOCAL ROLE gridex_ediel_fixture_authority_owner;SELECT to_jsonb(${publishSql(scope(second,step))});COMMIT;\n`)
  const rejected=await b.done
  expect(rejected.code).toBe(3)
  const unsupported=isolation==='REPEATABLE READ'||isolation==='SERIALIZABLE'
  expect(rejected.stderr).toMatch(unsupported?/ERROR:\s+25000: ediel_fixture_publisher_read_committed_required/:
   new RegExp(`ERROR:\\s+P0001: ediel_${second}_fixture_original_conflict`))
  expect(originalRows()).toEqual(committed)
  expect(decisionNativeSql(authoritySql)).toEqual(authorityBefore)
 }finally{
  const cleanup=await Promise.allSettled(sessions.map(session=>session.lock.dispose()))
  for(const result of cleanup)if(result.status==='rejected')throw result.reason
 }
},35000)

it.each([{first:'positive' as const,second:'negative' as const,step:31},{first:'negative' as const,second:'positive' as const,step:32}])(
 'native in-flight $first blocks zero-padded $second on the same stored step',async({first,second,step})=>{
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321')
  const before=originalRows(),firstContext=scope(first,step),secondContext={...scope(second,step),stepNo:`0${step}`}
  const sessions=['first','alias'].map(label=>{
   const marker=`gov08_alias_${label}_${randomUUID()}`
   const child=spawn('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
    {stdio:['pipe','pipe','pipe'],env:nativeLockProcessEnv()})
   let stdout='',stderr=''
   child.stdout.on('data',chunk=>{stdout+=String(chunk)});child.stderr.on('data',chunk=>{stderr+=String(chunk)})
   const done=new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(Error('native_gov08_alias_completion_timeout')),30000)
    child.once('error',error=>{clearTimeout(deadline);reject(error)})
    child.once('close',code=>{clearTimeout(deadline);resolve({code,stdout,stderr})})
   })
   void done.catch(()=>undefined)
   const lock=nativeLockProcess(child,{marker,markerError:`native_gov08_alias_${label}_ready_timeout`,lifetimeMs:20000})
   return {child,marker,lock,done,output:()=>stdout,error:()=>stderr}
  })
  const [a,b]=sessions
  try{
   a.child.stdin.write(`BEGIN ISOLATION LEVEL READ COMMITTED;SET LOCAL ROLE gridex_ediel_fixture_authority_owner;
    SELECT to_jsonb(${publishSql(firstContext)});SELECT pg_backend_pid()::text||':'||${literal(a.marker)};\n`)
   await a.lock.ready
   b.child.stdin.write(`BEGIN ISOLATION LEVEL READ COMMITTED;SET LOCAL ROLE gridex_ediel_fixture_authority_owner;
    SELECT pg_backend_pid()::text||':'||${literal(b.marker)};\n`)
   await b.lock.ready
   const pid=(session:typeof a)=>{
    const found=session.output().match(new RegExp(`([0-9]+):${session.marker}`))
    expect(found).not.toBeNull();return Number(found![1])
   }
   const aPid=pid(a),bPid=pid(b)
   b.child.stdin.end(`SELECT to_jsonb(${publishSql(secondContext)});COMMIT;\n`)
   const observe=()=>decisionNativeSql<{sameAdvisoryKey:boolean;blockers:number[]}>(`SELECT jsonb_build_object(
    'sameAdvisoryKey',EXISTS(SELECT FROM pg_locks waiting JOIN pg_locks held
     ON held.locktype=waiting.locktype AND held.database=waiting.database AND held.classid=waiting.classid
      AND held.objid=waiting.objid AND held.objsubid=waiting.objsubid
     WHERE waiting.pid=${bPid} AND held.pid=${aPid} AND waiting.locktype='advisory'
      AND waiting.mode='ExclusiveLock' AND held.mode='ExclusiveLock' AND NOT waiting.granted AND held.granted),
    'blockers',to_jsonb(pg_blocking_pids(${bPid})))`)
   let waiting=observe()
   const deadline=Date.now()+10000
   while((!waiting.sameAdvisoryKey||!waiting.blockers.includes(aPid))&&Date.now()<deadline){
    if(b.child.exitCode!==null)throw Error(`native_gov08_alias_exited_before_advisory_wait: ${b.error()}`)
    await new Promise(resolve=>setTimeout(resolve,10));waiting=observe()
   }
   expect(waiting.sameAdvisoryKey).toBe(true)
   expect(waiting.blockers).toContain(aPid)
   expect(originalRows()).toEqual(before)
   await a.lock.release('COMMIT')
   expect(await a.done).toMatchObject({code:0,stderr:''})
   const rejected=await b.done
   expect(rejected.code).toBe(3)
   expect(rejected.stderr).toMatch(new RegExp(`ERROR:\\s+P0001: ediel_${second}_fixture_original_conflict`))
   const committed=originalRows(),original=committed.find(row=>row.step_no===step)
   expect(committed).toHaveLength(before.length+1)
   expect(committed.filter(row=>row.step_no!==step)).toEqual(before)
   expect(original).toMatchObject({kind:first,company_id:companyId,run_id:runId,role_code:'supplier',
    case_code:'synthetic-native-outcome',suite:'PRODAT',revision:'synthetic-native-v1',step_no:step,
    expected_outcome:first,expected_diagnostic_codes:firstContext.expectedDiagnosticCodes,test_receiver_ediel_id:'TEST',
    original_wire:raw,wire_sha256:wireHash,original_file_sha256:wireHash,
    source_reference:firstContext.sourceReference,owner_decision_reference:firstContext.ownerDecisionReference})
   expect(decisionNativeSql(authoritySql)).toEqual(authorityBefore)
  }finally{
   const cleanup=await Promise.allSettled(sessions.map(session=>session.lock.dispose()))
   for(const result of cleanup)if(result.status==='rejected')throw result.reason
  }
 },35000)

it('retained legacy contradictions hold at actual private/public reads, preparation and existing prepared witnesses',()=>{
 // Only the two original publisher bodies are temporarily restored. The real
 // current readers/permissions remain installed, and every change is rolled
 // back even if a psql assertion aborts the connection's transaction.
 const predecessors=[
  ['20260930171839_ediel_source_qualified_negative_fixture_v1.sql','publish_v1'],
  ['20260930212435_ediel_source_qualified_positive_fixture_v1.sql','publish_positive_v1'],
 ].map(([file,name])=>{
  // Clean replay holds these originals outside the working-tree migration
  // paths. Reuse the existing same-HEAD, manifest-bound source contract.
  const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
  const source=execFileSync('git',['show',`${revision}:supabase/migrations/${file}`],{encoding:'utf8'})
  const manifest=JSON.parse(execFileSync('git',['show',`${revision}:scripts/migration-history-manifest.json`],{encoding:'utf8'})) as {files:Record<string,string>}
  expect(createHash('sha256').update(source).digest('hex')).toBe(manifest.files[file])
  const start=source.indexOf(`CREATE FUNCTION gridex_negative_fixtures.${name}(`),end=source.indexOf('$$;',start)
  expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start)
  return source.slice(start,end+3).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
 }).join('\n')
 const legacy=[{step:3,first:'positive' as const,second:'negative' as const},{step:4,first:'negative' as const,second:'positive' as const}]
 const contexts=legacy.flatMap(({step})=>['positive','negative'].map(outcome=>({outcome:outcome as Outcome,step,
  readContext:{...scope(outcome as Outcome,step),rawPayload:raw}})))
 const initial=legacy.map(({step,first})=>`PERFORM set_config('gridex_gov08.registration_${step}_${first}',(${publishSql(scope(first,step))})::text,true);`).join('\n')
 const pending=legacy.map(({step,first})=>`q:=public.gridex_ediel_${first}_fixture_prepare_v1(${literal({...scope(first,step),rawPayload:raw})}::jsonb||jsonb_build_object('registrationId',current_setting('gridex_gov08.registration_${step}_${first}')));
  IF q#>>'{qualification,expectedOutcome}' IS DISTINCT FROM '${first}' OR q#>>'{qualification,authorizesBusinessEffect}' IS DISTINCT FROM 'false'
   THEN RAISE EXCEPTION 'native_preconflict_qualification_required';END IF;
  PERFORM set_config('gridex_gov08.witness_${step}_${first}',q->>'witnessId',true);`).join('\n')
 const opposing=legacy.map(({step,second})=>`PERFORM set_config('gridex_gov08.registration_${step}_${second}',(${publishSql(scope(second,step))})::text,true);`).join('\n')
 const boundaries=contexts.flatMap(({outcome,step,readContext})=>{
  const context=`${literal(readContext)}::jsonb||jsonb_build_object('registrationId',current_setting('gridex_gov08.registration_${step}_${outcome}'))`
  return [
   [`private ${outcome} read step ${step}`,`SELECT gridex_negative_fixtures.${outcome==='positive'?'read_positive_v1':'read_v1'}(${context})`,outcome],
   [`public ${outcome} read step ${step}`,`SELECT public.gridex_ediel_${outcome}_fixture_read_v1(${context})`,outcome],
   [`private ${outcome} prepare step ${step}`,`SELECT gridex_negative_fixtures.prepare_${outcome}_v1(${context})`,outcome],
   [`public ${outcome} prepare step ${step}`,`SELECT public.gridex_ediel_${outcome}_fixture_prepare_v1(${context})`,outcome],
   ...(outcome==='negative'?[
    [`private negative prepare read step ${step}`,`SELECT gridex_negative_fixtures.read_negative_preparation_v1(${context})`,outcome],
    [`public negative prepare read step ${step}`,`SELECT public.gridex_ediel_negative_fixture_prepare_read_v1(${context})`,outcome],
   ]:[]),
  ]
 })
 for(const {step,first} of legacy)boundaries.push([`pending ${first} witness step ${step}`,
  `SELECT gridex_negative_fixtures.prepared_${first}_fixture_v1(${literal(companyId)}::uuid,current_setting('gridex_gov08.witness_${step}_${first}')::uuid,${literal(raw)},${literal(actor.id)}::uuid)`,first])
 const holds=boundaries.map(([label,statement,outcome])=>`BEGIN
  EXECUTE ${literal(statement)};RAISE EXCEPTION 'native_original_conflict_missing: ${label}';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM IS DISTINCT FROM 'ediel_${outcome}_fixture_original_conflict' OR SQLSTATE IS DISTINCT FROM 'P0001' THEN RAISE;END IF;
 END;`).join('\n')
 const before=originalRows(),beforeAuthority=decisionNativeSql(authoritySql)
 const result=decisionNativeSql<{holds:number;originals:Context[]}>(`BEGIN;
  CREATE TEMP TABLE gov08_current_publishers ON COMMIT DROP AS SELECT p.oid,to_jsonb(p)-'prosrc' metadata,pg_get_functiondef(p.oid) definition FROM pg_proc p
   WHERE p.oid IN('gridex_negative_fixtures.publish_v1(jsonb,bytea,text)'::regprocedure,'gridex_negative_fixtures.publish_positive_v1(jsonb,bytea,text)'::regprocedure);
  ${predecessors}
  SET LOCAL ROLE gridex_ediel_fixture_authority_owner;DO $initial$ BEGIN ${initial} END $initial$;RESET ROLE;
  SET LOCAL ROLE service_role;DO $pending$ DECLARE q jsonb;BEGIN ${pending} END $pending$;RESET ROLE;
  SET LOCAL ROLE gridex_ediel_fixture_authority_owner;DO $opposing$ BEGIN ${opposing} END $opposing$;RESET ROLE;
  DO $restore$ DECLARE saved record;BEGIN
   IF(SELECT count(*) FROM gov08_current_publishers)<>2 THEN RAISE EXCEPTION 'native_two_publishers_required';END IF;
   FOR saved IN SELECT * FROM gov08_current_publishers LOOP
    IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=saved.oid) IS DISTINCT FROM saved.metadata
     THEN RAISE EXCEPTION 'native_predecessor_publisher_metadata_changed';END IF;
    EXECUTE saved.definition;
    IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=saved.oid) IS DISTINCT FROM saved.metadata
     OR pg_get_functiondef(saved.oid) IS DISTINCT FROM saved.definition THEN RAISE EXCEPTION 'native_current_publisher_not_restored';END IF;
   END LOOP;
  END $restore$;
  CREATE TEMP TABLE gov08_originals_before ON COMMIT DROP AS ${originalRowsSql};
  SET LOCAL ROLE service_role;DO $holds$ BEGIN ${holds} END $holds$;RESET ROLE;
  DO $retained$ BEGIN
   IF(${originalRowsSql}) IS DISTINCT FROM(SELECT * FROM gov08_originals_before) THEN RAISE EXCEPTION 'native_original_rows_changed';END IF;
   IF(SELECT count(*) FROM gridex_negative_fixtures.positive_originals WHERE company_id=${literal(companyId)} AND step_no IN(3,4))<>2
    OR(SELECT count(*) FROM gridex_negative_fixtures.originals WHERE company_id=${literal(companyId)} AND step_no IN(3,4))<>2
    THEN RAISE EXCEPTION 'native_legacy_dual_originals_required';END IF;
  END $retained$;
  SELECT jsonb_build_object('holds',${boundaries.length},'originals',(${originalRowsSql}));ROLLBACK;`)
 expect(result.holds).toBe(22)
 for(const {step,outcome} of contexts){
  expect(result.originals.find(row=>row.step_no===step&&row.expected_outcome===outcome)).toMatchObject({original_wire:raw,
   wire_sha256:wireHash,original_file_sha256:wireHash,expected_diagnostic_codes:outcome==='negative'?['SYNTHETIC_NEGATIVE']:[],
   source_reference:'synthetic://native-original-outcome',owner_decision_reference:'synthetic://native-original-owner-decision'})
 }
 expect(result.originals).toHaveLength(before.length+4)
 expect(originalRows()).toEqual(before)
 expect(decisionNativeSql(authoritySql)).toEqual(beforeAuthority)
})

it('conflict handling retains the declared publisher ACL and gives no market or business authority',async()=>{
 const before=originalRows()
 const acl=decisionNativeSql<{role:string;positive:boolean;negative:boolean;readPositive:boolean;readNegative:boolean}[]>(`SELECT jsonb_agg(row ORDER BY row->>'role') FROM(
  SELECT jsonb_build_object('role',role,'positive',has_function_privilege(role,'public.gridex_ediel_positive_fixture_publish_v1(jsonb,bytea)','EXECUTE'),
   'negative',has_function_privilege(role,'public.gridex_ediel_negative_fixture_publish_v1(jsonb,bytea)','EXECUTE'),
   'readPositive',has_table_privilege(role,'gridex_negative_fixtures.positive_originals','SELECT'),
   'readNegative',has_table_privilege(role,'gridex_negative_fixtures.originals','SELECT')) row
  FROM unnest(ARRAY['anon','authenticated','service_role','gridex_ediel_fixture_authority_owner']) role) roles`)
 for(const row of acl)expect(row).toEqual({role:row.role,positive:row.role==='gridex_ediel_fixture_authority_owner',negative:row.role==='gridex_ediel_fixture_authority_owner',readPositive:false,readNegative:false})
 for(const outcome of ['positive','negative'] as const){
  const denied=await actor.client.rpc(`gridex_ediel_${outcome}_fixture_publish_v1`,{p_context:scope(outcome,5),p_original:`\\x${bytes.toString('hex')}`})
  expect(denied.error?.code).toBe('42501')
 }
 expect(originalRows()).toEqual(before)
 expect(decisionNativeSql(authoritySql)).toEqual(authorityBefore)
 expect(decisionNativeSql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(companyId)}),
  'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(companyId)}),
  'positiveConsumptions',(SELECT count(*) FROM gridex_negative_fixtures.positive_consumptions WHERE company_id=${literal(companyId)}),
  'negativeConsumptions',(SELECT count(*) FROM gridex_negative_fixtures.negative_prepared_consumptions WHERE company_id=${literal(companyId)}))`))
  .toEqual({messages:0,attempts:0,positiveConsumptions:0,negativeConsumptions:0})
})
