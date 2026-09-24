import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {expect,it,vi} from 'vitest'
import {closureFixture} from '../__tests__/helpers/closureWireFixtures'
import {supabaseService} from '@/lib/supabase/service'
import {captureCorrectionContext} from '@/lib/ediel/sources/correctionContextCapture'
const literal=(v:unknown)=>"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'"
function sql<T>(query:string):T{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 const out=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',timeout:10000,maxBuffer:2_000_000}).trim()
 return out?JSON.parse(out) as T:undefined as T
}
const raw=()=>closureFixture({reason:'Z24'}).wire
const project=(wire:string)=>sql<Record<string,unknown>>(`SELECT gridex_received_sources.correction_wire_observation_v1(${literal(wire)});`)
async function seed(wire=raw()){
 const companyId=randomUUID(),actorUserId=randomUUID(),sourceMessageId=randomUUID()
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.permissions WHERE key='communication.send'`)).toBe(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_profiles WHERE profile_key='PRODAT:Z05:C:26.A:r3' AND is_enabled`)).toBe(1)
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'Synthetic correction capture','active');
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
 VALUES(${literal(actorUserId)},'authenticated','authenticated',${literal(`${actorUserId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actorUserId)},${literal(`${actorUserId}@example.invalid`)},'Synthetic capture actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
 VALUES(${literal(companyId)},${literal(actorUserId)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
 INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active)
 SELECT ${literal(actorUserId)},id,'company_admin',${literal(companyId)},'active',true FROM public.roles WHERE key='company_admin' ON CONFLICT DO NOTHING;
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(actorUserId)},${literal(companyId)},id,'communication.send' FROM public.permissions WHERE key='communication.send';
 -- Pin the actual enabled C registry profile like the retained closure fixture.
 -- Code/date-only inference sees L, LK and C as three Z05 candidates; it cannot
 -- use parsed subtype to choose one. Preserve the real receive/commit clock.
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceMessageId)},${literal(companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{"subtype":"C"}',clock_timestamp(),'23-DDQ-PRODAT','12345','54321',pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
 WHERE profile.profile_key='PRODAT:Z05:C:26.A:r3' AND profile.is_enabled;`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceMessageId)}`)).toBe(1)
 expect(sql(`SELECT to_jsonb(company_id=${literal(companyId)}::uuid AND environment='test' AND origin='database_insert'
  AND message_code='Z05' AND raw_payload=${literal(wire)} AND payload_hash=encode(sha256(convert_to(raw_payload,'UTF8')),'hex')
  AND received_context @> jsonb_build_object('version',1,'contextOrigin','database_insert','sourceMessageId',source_message_id,
   'companyId',company_id,'environment',environment,'messageCode',message_code,'payloadHash',payload_hash)
  AND (received_context->>'sourceReceivedAt')::timestamptz=source_received_at
  AND isfinite((received_context->>'capturedAt')::timestamptz) AND (received_context->>'capturedAt')::timestamptz<=captured_at)
  FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceMessageId)}`)).toBe(true)
 const permission=await supabaseService.rpc('gridex_actor_has_company_permission',{p_actor_user_id:actorUserId,p_company_id:companyId,p_permission:'communication.send'})
 expect(permission.error).toBeNull();expect(permission.data).toBe(true)
 expect(sql(`SELECT jsonb_build_object('companyActive',c.is_active,'companyStatus',c.status,'userStatus',u.user_status,'membershipActive',m.is_active,'membershipStatus',m.status) FROM public.companies c JOIN public.company_memberships m ON m.company_id=c.id JOIN public.user_profiles u ON u.id=m.user_id WHERE c.id=${literal(companyId)} AND u.id=${literal(actorUserId)}`))
  .toEqual({companyActive:true,companyStatus:'active',userStatus:'active',membershipActive:true,membershipStatus:'active'})
 return {companyId,actorUserId,sourceMessageId,environment:'test' as const}
}
const call=(f:Awaited<ReturnType<typeof seed>>)=>`public.gridex_capture_correction_concern_v1(${literal(f.companyId)},'test',${literal(f.sourceMessageId)},${literal(f.actorUserId)})`

// Replay temporarily moves the original migrations out of their working-tree
// paths. Execute only the committed, checksum-bound original, never a marker.
function committedMigration(name:string){
 const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
 const source=execFileSync('git',['show',`${revision}:supabase/migrations/${name}`],{encoding:'utf8'})
 const manifest=JSON.parse(execFileSync('git',['show',`${revision}:scripts/migration-history-manifest.json`],{encoding:'utf8'})) as {files:Record<string,string>}
 expect(createHash('sha256').update(source).digest('hex')).toBe(manifest.files[name])
 expect(source.match(/^BEGIN;$/gm)).toHaveLength(1);expect(source.match(/^COMMIT;$/gm)).toHaveLength(1)
 return source.replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n?$/m,'')
}
const registryMigration='20260924003708_communication_permission_registry_completion.sql'
const resolverMigration='20260924003724_company_direct_permission_scope_repair.sql'
const assignments=`jsonb_build_object(
 'roles',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb) FROM public.role_permissions r),
 'users',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]'::jsonb) FROM public.user_permissions u),
 'overrides',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]'::jsonb) FROM public.user_permission_overrides o))`
// Run before this file creates synthetic grants. The ordinary clean replay,
// not fixture INSERTs, must have materialized both canonical registry rows.
it('canonical communication keys materialize once without creating any assignments',()=>{
 expect(sql(`SELECT jsonb_object_agg(key,n) FROM (SELECT key,count(*) n FROM public.permissions
  WHERE key IN ('communication.read','communication.send') GROUP BY key) p`)).toEqual({'communication.read':1,'communication.send':1})
 expect(sql(`SELECT jsonb_build_object(
  'roles',(SELECT count(*) FROM public.role_permissions WHERE permission_key IN ('communication.read','communication.send') OR permission_id IN (SELECT id FROM public.permissions WHERE key IN ('communication.read','communication.send'))),
  'users',(SELECT count(*) FROM public.user_permissions WHERE permission_key IN ('communication.read','communication.send') OR permission_id IN (SELECT id FROM public.permissions WHERE key IN ('communication.read','communication.send'))),
  'overrides',(SELECT count(*) FROM public.user_permission_overrides WHERE permission_key IN ('communication.read','communication.send')))`)).toEqual({roles:0,users:0,overrides:0})
 const source=committedMigration(registryMigration)
 expect(sql(`BEGIN; CREATE TEMP TABLE before_registry AS SELECT ${assignments} AS state;
  DELETE FROM public.permissions WHERE key IN ('communication.read','communication.send');
  ${source}
  SELECT jsonb_build_object('assignmentsUnchanged',(SELECT state FROM before_registry)=${assignments},
   'keys',(SELECT jsonb_object_agg(key,n) FROM (SELECT key,count(*) n FROM public.permissions WHERE key IN ('communication.read','communication.send') GROUP BY key) p));
  ROLLBACK;`)).toEqual({assignmentsUnchanged:true,keys:{'communication.read':1,'communication.send':1}})
})
it('registry replay preserves preexisting IDs, metadata, disabled state and all assignments',()=>{
 const source=committedMigration(registryMigration)
 const company=randomUUID(),actor=randomUUID(),role=randomUUID()
 const registry=`(SELECT jsonb_agg(to_jsonb(p) ORDER BY key) FROM public.permissions p WHERE key IN ('communication.read','communication.send'))`
 expect(sql(`BEGIN;
  INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Synthetic registry replay','active');
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES(${literal(actor)},'authenticated','authenticated',${literal(`${actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.roles(id,key,name) VALUES(${literal(role)},${literal(`registry_replay_${role}`)},'Synthetic registry replay');
  INSERT INTO public.role_permissions(role_id,permission_id) SELECT ${literal(role)},id FROM public.permissions WHERE key='communication.send';
  INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(actor)},${literal(company)},id,key FROM public.permissions WHERE key='communication.send';
  INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect) VALUES(${literal(actor)},${literal(company)},'communication.send','deny');
  UPDATE public.permissions SET name='Synthetic preexisting metadata',description='Preserve this description',category='Preserve category',is_active=false WHERE key='communication.send';
  CREATE TEMP TABLE before_registry AS SELECT ${assignments} AS grants,${registry} AS registry;
  ${source}
  ${source}
  SELECT to_jsonb((SELECT grants FROM before_registry)=${assignments} AND (SELECT registry FROM before_registry)=${registry});
  ROLLBACK;`)).toBe(true)
})
it('resolver forward preserves its owner and effective private RPC ACL',()=>{
 const source=committedMigration(resolverMigration)
 const security=`(SELECT jsonb_build_object('owner',proowner,'acl',proacl,'securityDefiner',prosecdef,'volatility',provolatile,'config',proconfig) FROM pg_proc WHERE oid='public.gridex_get_user_permissions_in_company(uuid,uuid)'::regprocedure)`
 expect(sql(`BEGIN; CREATE TEMP TABLE before_resolver AS SELECT ${security} AS state;
  ${source}
  SELECT jsonb_build_object('preserved',(SELECT state FROM before_resolver)=${security},
   'anon',has_function_privilege('anon','public.gridex_get_user_permissions_in_company(uuid,uuid)','EXECUTE'),
   'authenticated',has_function_privilege('authenticated','public.gridex_get_user_permissions_in_company(uuid,uuid)','EXECUTE'),
   'service',has_function_privilege('service_role','public.gridex_get_user_permissions_in_company(uuid,uuid)','EXECUTE'));
  ROLLBACK;`)).toEqual({preserved:true,anon:false,authenticated:false,service:true})
})
it('bare C date alone never narrows the unknown prior boundary',()=>{
 expect(project(raw())).toMatchObject({objectId:'735123456789012345',identityAgency:'9',legalSender:'12345',legalReceiver:'54321',caseReference:'CLOSE-CASE',
  oldStop:{kind:'unknown'},observedSourceStop:{kind:'known',utc:'2026-10-15T11:34:00.000Z'},proposedStop:{kind:'not_asserted'},candidateTarget:null,disposition:'unreviewed'})
})
it('C without LI still captures a concern with no inferred target',()=>{
 const wire=raw().replace("RFF+LI:CLOSE-CASE'",'').replace('UNT+16+M','UNT+15+M')
 expect(project(wire)).toMatchObject({caseReference:null,candidateTarget:null,oldStop:{kind:'unknown'},observedSourceStop:{kind:'known'}})
})
it.each([
 (s:string)=>s.replace('CAV+Z24','CAV+Z22'),
 (s:string)=>s.replace('DTM+93:202610151234:203','DTM+93:202602291234:203'),
 (s:string)=>s.replace('BGM+Z05','BGM+Z04'),
 (s:string)=>s.replace('UNZ+1','UNZ+2'),
 (s:string)=>s.replace(':::9',':::89'),
 (s:string)=>s+"UNH+OTHER+PRODAT'",
 (s:string)=>s.replace('UNA:+','UNA::'),
])('unsupported original remains a wildcard whole-interval concern %#',change=>{
 expect(project(change(raw()))).toMatchObject({objectId:null,oldStop:{kind:'unknown'},proposedStop:{kind:'unknown'},candidateTarget:null,disposition:'unreviewed'})
})
it('literal released text cannot become a date or LI authority',()=>{
 const wire=closureFixture({reason:'Z24',li:"CASE?'DTM+93:190001010000:203'"}).wire
 expect(project(wire)).toMatchObject({caseReference:"CASE?'DTM+93:190001010000:203'",observedSourceStop:{kind:'known',utc:'2026-10-15T11:34:00.000Z'}})
 expect(project(closureFixture({reason:'Z24',alphabet:['*',';','!','~']}).wire)).toMatchObject({objectId:'735123456789012345',proposedStop:{kind:'not_asserted'}})
})
it('additional changed-end assertion holds whole interval rather than treating it as absent',()=>{
 const wire=raw().replace("RFF+Z05", "FTX+AAI+++Changed end date unknown'RFF+Z05").replace('UNT+16+M','UNT+17+M')
 expect(project(wire)).toMatchObject({oldStop:{kind:'unknown'},observedSourceStop:{kind:'known'},proposedStop:{kind:'unknown'}})
})
it('real capture is idempotent, separately witnessed, hash-bound and independent of mutable source status',async()=>{
 const f=await seed(),first=await captureCorrectionContext(f)
 expect(first).toMatchObject({status:'recorded',disposition:'unreviewed',contentHash:createHash('sha256').update(raw()).digest('hex')})
 expect(await captureCorrectionContext(f)).toEqual(first)
 const rows=sql<{created:string;witness:string;facts:Record<string,unknown>}[]>(`SELECT jsonb_agg(jsonb_build_object('created',c.created_xid::text,'witness',w.xmin::text,'facts',c.facts)) FROM gridex_received_sources.correction_concerns c JOIN gridex_received_sources.correction_witnesses w ON w.capture_id=c.id WHERE c.source_message_id=${literal(f.sourceMessageId)}`)
 expect(rows).toHaveLength(1);expect(rows[0].created).not.toBe(rows[0].witness)
 expect(rows[0].facts).toMatchObject({scope:{companyId:f.companyId,customerId:null,supplyPeriodId:null},provenance:{authentication:'unknown'},disposition:'unreviewed'})
 sql(`UPDATE public.ediel_messages SET status='processed' WHERE id=${literal(f.sourceMessageId)}`)
 expect(await captureCorrectionContext(f)).toEqual(first)
})
it('cross-company/environment and unauthorized actor never append',async()=>{
 const f=await seed(),other=await seed()
 const wrongCompany=await supabaseService.rpc('gridex_actor_has_company_permission',{p_actor_user_id:other.actorUserId,p_company_id:f.companyId,p_permission:'communication.send'})
 expect(wrongCompany.error).toBeNull();expect(wrongCompany.data).toBe(false)
 for(const input of [{...f,companyId:other.companyId},{...f,environment:'production' as const},{...f,actorUserId:other.actorUserId}])
  expect(await captureCorrectionContext(input)).toEqual({status:'unconfirmed',disposition:'unreviewed'})
 sql(`UPDATE public.user_profiles SET user_status='disabled' WHERE id=${literal(f.actorUserId)}`)
 expect(await captureCorrectionContext(f)).toEqual({status:'unconfirmed',disposition:'unreviewed'})
 expect(sql(`SELECT jsonb_build_object('concerns',(SELECT count(*) FROM gridex_received_sources.correction_concerns WHERE source_message_id=${literal(f.sourceMessageId)}),'witnesses',(SELECT count(*) FROM gridex_received_sources.correction_witnesses WHERE company_id=${literal(f.companyId)}))`)).toEqual({concerns:0,witnesses:0})
})
it('same-transaction witness is rejected, later committed readback can recover interrupted capture',async()=>{
 const f=await seed()
 expect(()=>sql(`BEGIN; SET LOCAL ROLE service_role; WITH receipt AS (SELECT ${call(f)} AS r) SELECT public.gridex_witness_correction_concern_v1(${literal(f.companyId)},'test',(r->>'captureId')::uuid,r->>'factsHash') FROM receipt; COMMIT;`)).toThrow(/correction_availability_unproven/)
 const receipt=sql<{captureId:string;factsHash:string}>(`SET ROLE service_role; SELECT ${call(f)}`)
 const {data,error}=await supabaseService.rpc('gridex_witness_correction_concern_v1',{p_company_id:f.companyId,p_environment:'test',p_capture_id:receipt.captureId,p_facts_hash:'0'.repeat(64)})
 expect(data).toBeNull();expect(error).not.toBeNull()
 expect(await captureCorrectionContext(f)).toMatchObject({status:'recorded',captureId:receipt.captureId})
})
it('client RPC and all direct DML are denied; owner mutation and truncate are append-only',async()=>{
 const f=await seed();expect(await captureCorrectionContext(f)).toMatchObject({status:'recorded'})
 expect(()=>sql(`SET ROLE authenticated; SELECT ${call(f)}`)).toThrow(/permission denied/)
 for(const table of ['correction_concerns','correction_witnesses']){
  for(const role of ['authenticated','service_role']){
   expect(()=>sql(`SET ROLE ${role}; SELECT * FROM gridex_received_sources.${table}`)).toThrow(/permission denied/)
   expect(()=>sql(`SET ROLE ${role}; DELETE FROM gridex_received_sources.${table}`)).toThrow(/permission denied/)
   expect(()=>sql(`SET ROLE ${role}; INSERT INTO gridex_received_sources.${table} DEFAULT VALUES`)).toThrow(/permission denied/)
  }
  expect(()=>sql(`UPDATE gridex_received_sources.${table} SET company_id=company_id`)).toThrow(/append_only/)
  expect(()=>sql(`DELETE FROM gridex_received_sources.${table}`)).toThrow(/append_only/)
  expect(()=>sql(`TRUNCATE gridex_received_sources.${table} CASCADE`)).toThrow(/append_only/)
 }
})
it('different sealed originals with equal bytes keep distinct source provenance',async()=>{
 const one=await seed(),two=await seed(),a=await captureCorrectionContext(one),b=await captureCorrectionContext(two)
 expect(a.status).toBe('recorded');expect(b.status).toBe('recorded')
 if(a.status!=='recorded'||b.status!=='recorded')throw Error('capture_missing')
 expect(a.contentHash).toBe(b.contentHash);expect(a.captureId).not.toBe(b.captureId);expect(a.factsHash).not.toBe(b.factsHash)
})
it('original byte/hash substitution and source ID reuse cannot relabel a captured concern',async()=>{
 const f=await seed(),receipt=await captureCorrectionContext(f)
 expect(receipt).toMatchObject({status:'recorded'})
 expect(()=>sql(`UPDATE public.ediel_messages SET raw_payload=raw_payload||' ' WHERE id=${literal(f.sourceMessageId)}`)).toThrow()
 expect(()=>sql(`UPDATE gridex_received_sources.sources SET payload_hash=repeat('0',64) WHERE source_message_id=${literal(f.sourceMessageId)}`)).toThrow(/append_only/)
 const original=sql<Record<string,unknown>>(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${literal(f.sourceMessageId)}`)
 sql(`DELETE FROM public.ediel_messages WHERE id=${literal(f.sourceMessageId)}`)
 expect(await captureCorrectionContext(f)).toEqual(receipt)
 expect(()=>sql(`INSERT INTO public.ediel_messages SELECT * FROM jsonb_populate_record(NULL::public.ediel_messages,${literal(original)}::jsonb)`)).toThrow(/sources_pkey/)
 expect(await captureCorrectionContext(f)).toEqual(receipt)
})
it.each(['ediel_testing.write','communication.read'])('a separate actor with only %s cannot capture',async limitedPermission=>{
 const f=await seed(),limitedActor=randomUUID()
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.permissions WHERE key=${literal(limitedPermission)}`)).toBe(1)
 // Preserve the functioning administrator; create a distinct limited actor.
 sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
 VALUES(${literal(limitedActor)},'authenticated','authenticated',${literal(`${limitedActor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status)
 VALUES(${literal(limitedActor)},${literal(`${limitedActor}@example.invalid`)},'Synthetic limited capture actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
 VALUES(${literal(f.companyId)},${literal(limitedActor)},'viewer','active',now(),'{}','viewer',true,now(),'viewer');
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(limitedActor)},${literal(f.companyId)},id,${literal(limitedPermission)} FROM public.permissions WHERE key=${literal(limitedPermission)};`)
 for(const [permission,expected] of [[limitedPermission,true],['communication.send',false]] as const){
  const {data,error}=await supabaseService.rpc('gridex_actor_has_company_permission',{
   p_actor_user_id:limitedActor,p_company_id:f.companyId,p_permission:permission,
  })
  expect(error).toBeNull();expect(data).toBe(expected)
 }
 expect(await captureCorrectionContext({...f,actorUserId:limitedActor})).toEqual({status:'unconfirmed',disposition:'unreviewed'})
 expect(sql(`SELECT jsonb_build_object('concerns',(SELECT count(*) FROM gridex_received_sources.correction_concerns WHERE source_message_id=${literal(f.sourceMessageId)}),'witnesses',(SELECT count(*) FROM gridex_received_sources.correction_witnesses WHERE company_id=${literal(f.companyId)}))`)).toEqual({concerns:0,witnesses:0})
})
it('capture facts are absent at a pre-capture cutoff and immutable across a later retry',async()=>{
 const f=await seed(),before=sql<string>('SELECT to_jsonb(clock_timestamp())')
 const snapshot=()=>sql(`SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]'::jsonb) FROM gridex_received_sources.correction_concerns c WHERE c.company_id=${literal(f.companyId)} AND c.captured_at<=${literal(before)}::timestamptz`)
 const saved=JSON.stringify(snapshot());expect(saved).toBe('[]')
 expect(await captureCorrectionContext(f)).toMatchObject({status:'recorded'})
 expect(JSON.stringify(snapshot())).toBe(saved)
 const facts=()=>sql(`SELECT jsonb_agg(to_jsonb(c)) FROM gridex_received_sources.correction_concerns c WHERE c.company_id=${literal(f.companyId)}`)
 const first=JSON.stringify(facts());await captureCorrectionContext(f);expect(JSON.stringify(facts())).toBe(first)
})
it('lost concern witness preserves discoverable raw C and an actual saved older source snapshot',async()=>{
 const before=sql<string>('SELECT to_jsonb(clock_timestamp())'),f=await seed()
 const snapshot=(cutoff:string)=>sql<{snapshotId:string;readsetText:string;readsetHash:string}>(`SET ROLE service_role; SELECT public.gridex_source_object_snapshot_v1(${literal(f.companyId)},'test',${literal(cutoff)}::timestamptz)`)
 const saved=snapshot(before)
 expect(JSON.parse(saved.readsetText).sources).toEqual([])
 sql(`SET ROLE service_role; SELECT ${call(f)}`) // Committed append, deliberately no witness RPC.
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.correction_witnesses WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 const current=snapshot(sql<string>('SELECT to_jsonb(clock_timestamp())'))
 expect(JSON.parse(current.readsetText).sources).toEqual([expect.objectContaining({sourceMessageId:f.sourceMessageId,rawPayload:raw(),messageCode:'Z05'})])
 expect(sql(`SELECT jsonb_build_object('readsetText',readset_text,'readsetHash',readset_hash) FROM gridex_received_sources.object_selection_snapshots WHERE id=${literal(saved.snapshotId)}`)).toEqual({readsetText:saved.readsetText,readsetHash:saved.readsetHash})
})

// I1: unsupported physical grammar cannot narrow a hold to an alleged object.
it.each([
 ['PRODAT:D:97A:UN:E2SE6A','PRODAT:BOGUS'],
 ['PRODAT:D:97A:UN:E2SE6A','PRODAT:X:97A:UN:E2SE6A'],
 ['PRODAT:D:97A:UN:E2SE6A','PRODAT:D:96A:UN:E2SE6A'],
 ['PRODAT:D:97A:UN:E2SE6A','PRODAT:D:97A:ZZ:E2SE6A'],
 ['PRODAT:D:97A:UN:E2SE6A','PRODAT:D:97A:UN:OTHER'],
 ['PRODAT:D:97A:UN:E2SE6A','PRODAT:D:97A:UN'],
 ['PRODAT:D:97A:UN:E2SE6A','PRODAT:D:97A:UN:E2SE6A:EXTRA'],
 ['PRODAT:D:97A:UN:E2SE6A','PRODAT:D:97A:UN:E2SE6A:'],
 ['UNOC:3','UNOA:3'],['UNOC:3','UNOC:4'],['UNOC:3','UNOC'],['UNOC:3','UNOC:3:EXTRA'],
])('unsupported namespace %s -> %s produces only a wildcard concern',(from,to)=>{
 expect(project(raw().replace(from,to))).toEqual({objectId:null,identityAgency:null,legalSender:null,legalReceiver:null,
  caseReference:null,candidateTarget:null,oldStop:{kind:'unknown'},proposedStop:{kind:'unknown'},observedSourceStop:{kind:'unknown'},disposition:'unreviewed'})
})

it('an operationally paused company cannot append a concern despite its active actor',async()=>{
 const f=await seed()
 sql(`UPDATE public.companies SET status='paused' WHERE id=${literal(f.companyId)}`)
 expect(sql(`SELECT to_jsonb(status) FROM public.companies WHERE id=${literal(f.companyId)}`)).toBe('paused')
 expect(await captureCorrectionContext(f)).toEqual({status:'unconfirmed',disposition:'unreviewed'})
 expect(sql(`SELECT jsonb_build_object('concerns',(SELECT count(*) FROM gridex_received_sources.correction_concerns WHERE source_message_id=${literal(f.sourceMessageId)}),'witnesses',(SELECT count(*) FROM gridex_received_sources.correction_witnesses WHERE company_id=${literal(f.companyId)}))`)).toEqual({concerns:0,witnesses:0})
})

function limitedActor(companyIds:string[]){
 const actor=randomUUID()
 sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  VALUES(${literal(actor)},'authenticated','authenticated',${literal(`${actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
  INSERT INTO public.user_profiles(id,email,full_name,user_status)
  VALUES(${literal(actor)},${literal(`${actor}@example.invalid`)},'Synthetic direct permission actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
  ${companyIds.map(company=>`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
   VALUES(${literal(company)},${literal(actor)},'viewer','active',now(),'{}','viewer',true,now(),'viewer');`).join('\n')}`)
 return actor
}
function grantDirect(actor:string,company:string|null,options:{effect?:string;status?:string;active?:boolean}={},grantId=randomUUID()){
 sql(`INSERT INTO public.user_permissions(id,user_id,company_id,permission_id,permission_key,effect,status,is_active)
  SELECT ${literal(grantId)},${literal(actor)},${company===null?'NULL':literal(company)},id,key,${literal(options.effect??'allow')},${literal(options.status??'active')},${options.active??true}
  FROM public.permissions WHERE key='communication.send';`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.user_permissions WHERE user_id=${literal(actor)}`)).toBe(1)
}
async function effective(actor:string,company:string){
 const {data,error}=await supabaseService.rpc('gridex_actor_has_company_permission',{
  p_actor_user_id:actor,p_company_id:company,p_permission:'communication.send',
 })
 expect(error).toBeNull();return data
}
async function deniedCapture(f:Awaited<ReturnType<typeof seed>>,actor:string){
 expect(await effective(actor,f.companyId)).toBe(false)
 expect(await captureCorrectionContext({...f,actorUserId:actor})).toEqual({status:'unconfirmed',disposition:'unreviewed'})
 expect(sql(`SELECT jsonb_build_object('concerns',(SELECT count(*) FROM gridex_received_sources.correction_concerns WHERE source_message_id=${literal(f.sourceMessageId)}),
  'witnesses',(SELECT count(*) FROM gridex_received_sources.correction_witnesses WHERE company_id=${literal(f.companyId)}))`)).toEqual({concerns:0,witnesses:0})
}
function grantCompanyRole(actor:string,company:string){
 const roleId=randomUUID(),userRoleId=randomUUID(),key=`correction_native_${roleId.replaceAll('-','')}`
 sql(`INSERT INTO public.roles(id,key,name,scope,is_active) VALUES(${literal(roleId)},${literal(key)},'Synthetic correction role','company',true);
  INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
  SELECT ${literal(roleId)},${literal(key)},id,key,'allow' FROM public.permissions WHERE key='communication.send';
  INSERT INTO public.user_roles(id,user_id,role_id,role,company_id,status,is_active)
  VALUES(${literal(userRoleId)},${literal(actor)},${literal(roleId)},${literal(key)},${literal(company)},'active',true);`)
 return {roleId,userRoleId}
}
it('a dual-member actor can capture with its A direct grant but cannot borrow it in B',async()=>{
 const a=await seed(),b=await seed(),actor=limitedActor([a.companyId,b.companyId])
 grantDirect(actor,a.companyId)
 expect(await effective(actor,a.companyId)).toBe(true)
 await deniedCapture(b,actor)
 expect(await captureCorrectionContext({...a,actorUserId:actor})).toMatchObject({status:'recorded',disposition:'unreviewed'})
})
it.each([
 ['deny effect',{effect:'deny'}],['removed status',{status:'removed_from_company'}],['inactive flag',{active:false}],
] as const)('a direct grant with %s is not positive capture authority',async(_label,options)=>{
 const f=await seed(),actor=limitedActor([f.companyId]);grantDirect(actor,f.companyId,options)
 await deniedCapture(f,actor)
})
it('a company-bound direct grant does not resolve for a null requested company',async()=>{
 const f=await seed(),actor=limitedActor([f.companyId]);grantDirect(actor,f.companyId)
 expect(await effective(actor,f.companyId)).toBe(true)
 expect(sql(`SELECT to_jsonb('communication.send'=ANY(public.gridex_get_user_permissions_in_company(${literal(actor)},NULL)))`)).toBe(false)
})
it('a legacy null-company direct allow remains global for active selected-company members',async()=>{
 const a=await seed(),b=await seed(),actor=limitedActor([a.companyId,b.companyId]),grantId=randomUUID()
 const globalGrants=()=>sql(`SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) FROM public.user_permissions p WHERE company_id IS NULL`)
 const before=globalGrants()
 let originalFailure:unknown
 try{
  // Commit for the real HTTP permission/capture RPCs, then remove only this
  // compatibility fixture before the suite's strict tenant invariant gate.
  grantDirect(actor,null,{},grantId)
  expect(await effective(actor,a.companyId)).toBe(true);expect(await effective(actor,b.companyId)).toBe(true)
  expect(sql(`SELECT to_jsonb('communication.send'=ANY(public.gridex_get_user_permissions_in_company(${literal(actor)},NULL)))`)).toBe(true)
  expect(await captureCorrectionContext({...b,actorUserId:actor})).toMatchObject({status:'recorded',disposition:'unreviewed'})
 }catch(error){originalFailure=error;throw error}
 finally{
  try{
   sql(`DELETE FROM public.user_permissions WHERE id=${literal(grantId)} AND user_id=${literal(actor)} AND company_id IS NULL AND permission_key='communication.send'`)
   expect(sql(`SELECT to_jsonb(count(*)) FROM public.user_permissions WHERE id=${literal(grantId)}`)).toBe(0)
   expect(globalGrants()).toEqual(before)
  }catch(cleanupError){
   if(originalFailure!==undefined)throw new AggregateError([originalFailure,cleanupError],'Legacy grant cleanup failed after the original assertion failure',{cause:originalFailure})
   throw cleanupError
  }
 }
})
it.each(['status','is_active'] as const)('a direct company grant requires active membership by %s',async field=>{
 const f=await seed(),actor=limitedActor([f.companyId]);grantDirect(actor,f.companyId)
 expect(await effective(actor,f.companyId)).toBe(true)
 sql(`UPDATE public.company_memberships SET ${field}=${field==='status'?"'suspended'":'false'} WHERE user_id=${literal(actor)} AND company_id=${literal(f.companyId)}`)
 // The resolver itself must not leak it, even without the wrapper membership check.
 expect(sql(`SELECT to_jsonb('communication.send'=ANY(public.gridex_get_user_permissions_in_company(${literal(actor)},${literal(f.companyId)})))`)).toBe(false)
 await deniedCapture(f,actor)
})
it('valid role grants stay company scoped and independent of a deny-only direct row',async()=>{
 const a=await seed(),b=await seed(),actor=limitedActor([a.companyId,b.companyId])
 grantCompanyRole(actor,a.companyId);grantDirect(actor,a.companyId,{effect:'deny'})
 expect(await effective(actor,a.companyId)).toBe(true)
 await deniedCapture(b,actor)
 expect(await captureCorrectionContext({...a,actorUserId:actor})).toMatchObject({status:'recorded',disposition:'unreviewed'})
})
it.each(['role_inactive','assignment_inactive','assignment_removed','membership_inactive'] as const)('role behavior remains closed for %s',async variant=>{
 const f=await seed(),actor=limitedActor([f.companyId]),role=grantCompanyRole(actor,f.companyId)
 expect(await effective(actor,f.companyId)).toBe(true)
 const change={role_inactive:`UPDATE public.roles SET is_active=false WHERE id=${literal(role.roleId)}`,
  assignment_inactive:`UPDATE public.user_roles SET is_active=false WHERE id=${literal(role.userRoleId)}`,
  assignment_removed:`UPDATE public.user_roles SET status='removed_from_company' WHERE id=${literal(role.userRoleId)}`,
  membership_inactive:`UPDATE public.company_memberships SET is_active=false WHERE user_id=${literal(actor)} AND company_id=${literal(f.companyId)}`}[variant]
 sql(change);await deniedCapture(f,actor)
})
it('a valid global platform role retains its permission in both companies and a null scope',async()=>{
 const a=await seed(),b=await seed(),actor=limitedActor([a.companyId,b.companyId])
 // Roll back the fixture's global role link and grant so no existing role policy changes.
 expect(sql(`BEGIN;
  INSERT INTO public.roles(key,name,scope,is_active) VALUES('platform_admin','Synthetic platform admin','platform',true) ON CONFLICT(key) DO NOTHING;
  INSERT INTO public.role_permissions(role_id,permission_id,effect) SELECT r.id,p.id,'allow' FROM public.roles r CROSS JOIN public.permissions p WHERE r.key='platform_admin' AND p.key='communication.send';
  INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active) SELECT ${literal(actor)},id,key,NULL,'active',true FROM public.roles WHERE key='platform_admin';
  SELECT jsonb_build_array('communication.send'=ANY(public.gridex_get_user_permissions_in_company(${literal(actor)},${literal(a.companyId)})),
   'communication.send'=ANY(public.gridex_get_user_permissions_in_company(${literal(actor)},${literal(b.companyId)})),
   'communication.send'=ANY(public.gridex_get_user_permissions_in_company(${literal(actor)},NULL)));
  ROLLBACK;`)).toEqual([true,true,true])
})
it('the existing explicit platform superadmin wrapper authority remains unchanged',async()=>{
 const f=await seed(),actor=limitedActor([f.companyId])
 expect(await effective(actor,f.companyId)).toBe(false)
 sql(`INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${literal(actor)},'super_admin',true)`)
 expect(await effective(actor,f.companyId)).toBe(true)
 expect(sql(`SELECT to_jsonb('admin.access'=ANY(public.gridex_get_user_permissions_in_company(${literal(actor)},${literal(f.companyId)})))`)).toBe(true)
 expect(await captureCorrectionContext({...f,actorUserId:actor})).toMatchObject({status:'recorded',disposition:'unreviewed'})
})

// Outbound regression: bypassing the last provider-entry decision must never
// invoke nodemailer. Real helper/readiness are retained; only external SMTP is stubbed.
const provider = vi.hoisted(()=>vi.fn())
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
it.each(['raw','attachment'] as const)('outbound helper callback denial prevents %s provider entry',async mode=>{
 vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid')
 vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
 provider.mockReset();provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[]})
 const {sendEdielEmail}=await import('@/lib/email/sendEdielEmail')
 const input=mode==='raw'?{raw:Buffer.from('Subject: synthetic\r\n\r\nBody'),to:'recipient@example.invalid'}:
  {to:'recipient@example.invalid',subject:'synthetic',text:''}
 try{await expect(sendEdielEmail(input,{beforeProviderCall:async()=>{throw Error('entry_denied')}})).rejects.toThrow('entry_denied');expect(provider).not.toHaveBeenCalled()}
 finally{vi.unstubAllEnvs()}
})

async function outboundParsed(wire:string,companyId:string){
 const {createProdatRegisterEvidence}=await import('@/lib/ediel/prodat/prodatRegisterEvidence')
 const {tokenizeEdifact}=await import('@/lib/ediel/core/edifactTokenizer')
 const t=tokenizeEdifact(wire),source={kind:'caller_selection' as const,companyId,reference:'synthetic-dispatch-selection'}
 const address={lines:['Street','',''] as const,postalCode:'12345',city:'City',country:'SE',representation:{convention:'synthetic-postal-v1',reference:'synthetic-address',mode:1 as const}}
 const identity={id:'CUSTOMER-1',qualifier:'' as const,agency:'89' as const}
 return {subtype:'H',prodatEngine:{registerEvidence:createProdatRegisterEvidence({code:'Z08',rawSegments:t.segments.map(s=>s.raw),una:t.una,facts:{
  endUserAddressObjects:[{meteringPointId:'735123456789012345',identityAgency:'9',endUser:identity,availability:'available',addressLines:['Street'],source}],
  invoiceeObjects:[{meteringPointId:'735123456789012345',identityAgency:'9',endUser:{identity,address},invoicee:{identity,nameLines:['Ångström'],address,availability:'available'},event:{state:'none',reference:'synthetic-no-change'},source}],
 }})}}
}
async function outboundSeed(){
 const f=await seed(),messageId=randomUUID(),routeId=randomUUID(),profileId=randomUUID(),gridId=randomUUID(),marketActor=randomUUID()
 // Actors are global and the disposable suite retains earlier fixture rows.
 // Own a distinct normalized name even when one test seeds two tenants.
 const marketActorName=`Dispatch electricity grid ${marketActor}`
 // Company creation deliberately seeds capabilities disabled; establish only this
 // synthetic tenant's test capability through its actual canonical gate.
 sql(`UPDATE public.company_capabilities SET enabled=true,readiness_status='ready' WHERE company_id=${literal(f.companyId)} AND capability_code='ediel_test';`)
 expect(sql(`SELECT to_jsonb(allowed) FROM public.canonical_tenant_operation_decision(${literal(f.companyId)},'ediel.test.process')`)).toBe(true)
 // Allocate against the actual globally unique identifier owner. The short
 // transaction serializes this fixture allocator; it never rewrites old actors.
 const receiver=sql<string>(`BEGIN;
 SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_dispatch_actor_identifier',0));
 WITH actor AS (
  INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants)
  VALUES(${literal(marketActor)},${literal(marketActorName)},'active','verified',true) RETURNING id
 ), available AS (
  SELECT candidate::text AS value FROM generate_series(60000,89999) candidate
  WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text)
  ORDER BY candidate LIMIT 1
 ), allocated AS (
  INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified)
  SELECT actor.id,'EdielId',available.value,true FROM actor CROSS JOIN available RETURNING identifier_value
 ) SELECT to_jsonb(identifier_value) FROM allocated; COMMIT;`)
 expect(receiver).toMatch(/^[6-8][0-9]{4}$/)
 expect(sql(`SELECT to_jsonb(actor_id) FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(receiver)}`)).toBe(marketActor)
 const wire=closureFixture({reason:'Z25'}).wire.replace('BGM+Z05','BGM+Z08').replaceAll('54321',receiver).replace('Synthetic','Ångström')
 const parsed=await outboundParsed(wire,f.companyId)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_profiles p JOIN public.ediel_rule_packs r ON r.id=p.rule_pack_id WHERE p.profile_key='PRODAT:Z08:H:26.A:r3' AND p.is_enabled AND r.status='active' AND r.valid_from<=current_date AND (r.valid_to IS NULL OR r.valid_to>=current_date) AND r.source_hash ~ '^[a-f0-9]{64}$'`)).toBe(1)
 sql(`INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${literal(gridId)},${literal(f.companyId)},'Dispatch native grid',${literal(receiver)},'test',true,'active');
 INSERT INTO public.communication_routes(id,company_id,route_name,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(f.companyId)},'Dispatch native route',${literal(gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email,message_family,business_code)
 VALUES(${literal(profileId)},${literal(f.companyId)},${literal(routeId)},'Dispatch native profile','test','edifact','12345',${literal(receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid','PRODAT','Z08');
 INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) VALUES(${literal(marketActor)},'grid_owner',true);
 INSERT INTO public.platform_actor_routes(actor_id,message_family,environment,status,is_verified,application_reference,communication_type,communication_address,metadata) VALUES(${literal(marketActor)},'PRODAT','production','active',true,'23-DDQ-PRODAT','email','recipient@example.invalid','{"subaddress_status":"not_required_confirmed"}');
 INSERT INTO public.platform_actor_certificates(actor_id,environment,purpose,status,fingerprint_sha256,ediel_id,valid_to,raw_certificate_pem) VALUES(${literal(marketActor)},'production','encryption','valid','synthetic',${literal(receiver)},'2099-01-01','synthetic-readiness-only');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,application_reference,sender_ediel_id,receiver_ediel_id,receiver_email,communication_route_id,route_profile_id,source_operation_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(messageId)},${literal(f.companyId)},'test','outbound','edifact','PRODAT','Z08','queued',${literal(wire)},${literal(parsed)},'23-DDQ-PRODAT','12345',${literal(receiver)},'recipient@example.invalid',${literal(routeId)},${literal(profileId)},${literal(randomUUID())},r.id,p.profile_key,p.id,r.guide_version||':r'||r.guide_revision,r.source_hash,p.profile
 FROM public.ediel_message_profiles p JOIN public.ediel_rule_packs r ON r.id=p.rule_pack_id WHERE p.profile_key='PRODAT:Z08:H:26.A:r3' AND p.is_enabled;`)
 expect(sql(`SELECT jsonb_build_object('id',id,'name',name,'normalizedName',normalized_name) FROM public.platform_market_actors WHERE normalized_name=${literal(marketActorName.toLowerCase())}`))
  .toEqual({id:marketActor,name:marketActorName,normalizedName:marketActorName.toLowerCase()})
 expect(sql(`SELECT to_jsonb(can_use_for_prodat) FROM public.actor_readiness_status WHERE platform_market_actor_id=${literal(marketActor)}`)).toBe(true)
 return {...f,messageId,routeId,wire,marketActor,marketActorName,receiver}
}
function smtpFixture(){
 vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS','synthetic@example.invalid');vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false');vi.stubEnv('EMAIL_PROVIDER','resend')
 vi.stubEnv('EDIEL_SMTP_FROM','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','synthetic@example.invalid');vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
 provider.mockReset();provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'native-provider-id',response:'250 synthetic accepted'})
}
async function directOutbound(f:Awaited<ReturnType<typeof outboundSeed>>){
 const {sendQueuedEdielMessage}=await import('@/lib/ediel/orchestrator')
 return sendQueuedEdielMessage({edielMessageId:f.messageId,actorUserId:f.actorUserId})
}
function outboundFacts(f:Awaited<ReturnType<typeof outboundSeed>>){
 return sql<Record<string,unknown>[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('kind',e.kind,'facts',e.facts,'witnessed',w.event_id IS NOT NULL) ORDER BY e.observed_at),'[]') FROM gridex_outbound_dispatch.events e LEFT JOIN gridex_outbound_dispatch.witnesses w ON w.event_id=e.id WHERE e.message_id=${literal(f.messageId)}`)
}
it.each(['accepted','partial','empty','malformed','all_rejected','connect_negative','data_ambiguous'] as const)('outbound direct %s cannot resend after mutable reset',async outcome=>{
 const f=await outboundSeed();smtpFixture()
 if(outcome==='partial')provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:['other@example.invalid'],messageId:'partial-id',response:'250 partial'})
 if(outcome==='empty')provider.mockResolvedValue({accepted:[],rejected:[]})
 if(outcome==='malformed')provider.mockResolvedValue({accepted:'invalid',rejected:null})
 if(outcome==='all_rejected')provider.mockResolvedValue({accepted:[],rejected:['recipient@example.invalid'],response:'550 rejected'})
 if(outcome==='connect_negative')provider.mockRejectedValue(Object.assign(Error('connect refused'),{code:'ECONNECTION',syscall:'connect'}))
 if(outcome==='data_ambiguous')provider.mockRejectedValue(Object.assign(Error('lost DATA result'),{code:'ESOCKET',command:'DATA'}))
 try{
  await directOutbound(f).catch(()=>null)
  expect(provider).toHaveBeenCalledTimes(1)
  expect(outboundFacts(f)).toEqual(expect.arrayContaining([expect.objectContaining({kind:'provider_call_entered',witnessed:true}),expect.objectContaining({kind:'provider_result',witnessed:true})]))
  const want={accepted:'accepted',partial:'partial',empty:'uncertain',malformed:'uncertain',all_rejected:'all_rejected',connect_negative:'pre_connect_negative',data_ambiguous:'uncertain'}[outcome]
  expect(outboundFacts(f).find(e=>e.kind==='provider_result')?.facts).toMatchObject({classification:want})
  if(outcome==='partial')expect(outboundFacts(f).find(e=>e.kind==='provider_result')?.facts).toMatchObject({provider:{accepted:['recipient@example.invalid'],rejected:['other@example.invalid'],messageId:'partial-id',response:'250 partial'}})
  sql(`UPDATE public.ediel_messages SET status='queued',message_sent_at=NULL WHERE id=${literal(f.messageId)};`)
  await directOutbound(f).catch(()=>null);expect(provider).toHaveBeenCalledTimes(1)
 }finally{vi.unstubAllEnvs()}
})
// Observe real RPCs; never manufacture their SQL decisions. Hold the winner
// before entry until both real reservations finish, then hold the loser response
// until entry commits so its ordinary status projection cannot mask contention.
function observeReservationContention(messageId:string){
 const original=supabaseService.rpc.bind(supabaseService)
 const arrivals:Record<string,unknown>[]=[],decisions:Record<string,unknown>[]=[],entries:Record<string,unknown>[]=[]
 let arrivalsReady!:()=>void,decisionsReady!:()=>void,entryReady!:()=>void
 const bothArrived=new Promise<void>(resolve=>{arrivalsReady=resolve})
 const bothDecided=new Promise<void>(resolve=>{decisionsReady=resolve})
 const entered=new Promise<void>(resolve=>{entryReady=resolve})
 const timer=setTimeout(()=>{arrivalsReady();decisionsReady();entryReady()},10000)
 const spy=vi.spyOn(supabaseService,'rpc').mockImplementation(((name:string,args:Record<string,unknown>)=>{
  const input=args.p_input as Record<string,unknown>|undefined
  if(name!=='gridex_outbound_dispatch_v1'||input?.messageId!==messageId)return original(name,args)
  if(input.action==='prepare')return (async()=>{
   arrivals.push(input);if(arrivals.length===2)arrivalsReady()
   await bothArrived
   const result=await original(name,args)
   decisions.push({attemptId:input.attemptId,data:result.data,error:result.error})
   if(decisions.length===2)decisionsReady()
   await bothDecided
   if((result.data as {proceed?:boolean}|null)?.proceed!==true)await entered
   return result
  })()
  if(input.action==='enter')return (async()=>{
   const result=await original(name,args)
   entries.push({attemptId:input.attemptId,data:result.data,error:result.error})
   entryReady();return result
  })()
  return original(name,args)
 }) as typeof supabaseService.rpc)
 return {arrivals,assert(){
  expect(arrivals).toHaveLength(2)
  expect(new Set(arrivals.map(a=>a.attemptId)).size).toBe(2)
  expect(decisions).toHaveLength(2)
  expect(decisions.every(d=>d.error===null)).toBe(true)
  expect(decisions.map(d=>(d.data as {proceed:boolean}).proceed).sort()).toEqual([false,true])
  expect(decisions.find(d=>(d.data as {proceed:boolean}).proceed===false)?.data).toMatchObject({scoped:true,proceed:false,state:'prepared',acceptedReceipt:null})
  expect(entries).toEqual([expect.objectContaining({error:null,data:expect.objectContaining({scoped:true,proceed:true})})])
 },restore(){clearTimeout(timer);arrivalsReady();decisionsReady();entryReady();spy.mockRestore()}}
}
it('outbound direct and actual worker claim race admits only one provider call',async()=>{
 const f=await outboundSeed(),outboxId=randomUUID();smtpFixture()
 sql(`INSERT INTO public.ediel_outbox(id,company_id,environment,ediel_message_id,status,lock_key) VALUES(${literal(outboxId)},${literal(f.companyId)},'test',${literal(f.messageId)},'queued',${literal(outboxId)});`)
 const {processEdielOutbox}=await import('@/lib/ediel/outbox/processEdielOutbox')
 const contention=observeReservationContention(f.messageId)
 try{
  const results=await Promise.allSettled([directOutbound(f),processEdielOutbox({companyId:f.companyId,actorUserId:f.actorUserId,environment:'test'})])
  contention.assert()
  expect(contention.arrivals.map(a=>(a.owner as {kind:string}).kind).sort()).toEqual(['direct','worker'])
  expect(results[1].status).toBe('fulfilled')
  if(results[1].status==='fulfilled')expect(results[1].value).toMatchObject({processed:1,failed:0,blocked:0})
  if(results[0].status==='rejected')expect(results[0].reason.name).toBe('SmtpDeliveryUncertainError')
  expect(provider).toHaveBeenCalledTimes(1)
  expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toEqual([expect.objectContaining({witnessed:true})])
  expect(outboundFacts(f).filter(e=>e.kind==='provider_result')).toEqual([expect.objectContaining({witnessed:true,facts:expect.objectContaining({classification:'accepted'})})])
 }finally{contention.restore();vi.unstubAllEnvs()}
})
it('outbound independently claimed worker retains acceptance despite later mutable reset',async()=>{
 const f=await outboundSeed(),outboxId=randomUUID();smtpFixture()
 sql(`INSERT INTO public.ediel_outbox(id,company_id,environment,ediel_message_id,status,lock_key) VALUES(${literal(outboxId)},${literal(f.companyId)},'test',${literal(f.messageId)},'queued',${literal(outboxId)});`)
 const {sendOutboxItem}=await import('@/lib/ediel/outbox/sendOutboxItem')
 try{await sendOutboxItem({outboxItemId:outboxId,actorUserId:f.actorUserId});expect(provider).toHaveBeenCalledTimes(1)
  sql(`UPDATE public.ediel_messages SET status='queued',message_sent_at=NULL WHERE id=${literal(f.messageId)}; UPDATE public.ediel_outbox SET status='queued' WHERE id=${literal(outboxId)};`)
  await sendOutboxItem({outboxItemId:outboxId,actorUserId:f.actorUserId});expect(provider).toHaveBeenCalledTimes(1)
 }finally{vi.unstubAllEnvs()}
})

const dispatchCall=async(input:Record<string,unknown>)=>supabaseService.rpc('gridex_outbound_dispatch_v1',{p_input:input})
async function preparedOutbound(f:Awaited<ReturnType<typeof outboundSeed>>,owner:Record<string,unknown>={kind:'direct'}){
 const attemptId=randomUUID(),payload=Buffer.from(f.wire,'latin1')
 const identity={companyId:f.companyId,environment:'test',messageId:f.messageId,actorUserId:f.actorUserId,attemptId}
 const binding={originalHash:createHash('sha256').update(f.wire).digest('hex'),routeId:f.routeId,to:'recipient@example.invalid',from:'synthetic@example.invalid',encoding:'latin1',mimeMode:'ediel-singlepart-compact',payloadBase64:payload.toString('base64'),payloadHash:createHash('sha256').update(payload).digest('hex'),payloadLength:payload.length}
 const prepared=await dispatchCall({...identity,action:'prepare',owner,binding})
 expect(prepared.error).toBeNull();expect(prepared.data).toMatchObject({scoped:true,proceed:true})
 return {identity,binding,prepared:prepared.data as {eventId:string}}
}
it('outbound duplicate attempt and stale owner after safe release cannot enter',async()=>{
 const f=await outboundSeed(),first=await preparedOutbound(f)
 const duplicate=await dispatchCall({...first.identity,action:'prepare',owner:{kind:'direct'},binding:first.binding})
 expect(duplicate.data).toMatchObject({proceed:false})
 expect((await dispatchCall({...first.identity,action:'release'})).error).toBeNull()
 const next=await preparedOutbound(f)
 expect((await dispatchCall({...first.identity,action:'enter'})).error).not.toBeNull()
 const entered=await dispatchCall({...next.identity,action:'enter'})
 expect(entered.data).toMatchObject({proceed:true})
 expect((await dispatchCall({...next.identity,action:'enter'})).data).toMatchObject({proceed:false})
 expect((await dispatchCall({...next.identity,action:'release'})).error).not.toBeNull()
 expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toHaveLength(1)
})
it('outbound private facts deny DML and tenant/actor/claim impersonation',async()=>{
 const f=await outboundSeed(),prepared=await preparedOutbound(f),foreign=await seed()
 for(const table of ['epoch','originals','attempts','reservations','events','witnesses'])for(const role of ['anon','authenticated','service_role']){
  expect(()=>sql(`SET ROLE ${role}; DELETE FROM gridex_outbound_dispatch.${table};`)).toThrow()
 }
 for(const patch of [{companyId:foreign.companyId},{environment:'production'},{actorUserId:foreign.actorUserId}]){
  expect((await dispatchCall({...prepared.identity,...patch,action:'enter'})).error).not.toBeNull()
 }
 const fresh=await outboundSeed(),attemptId=randomUUID()
 expect(fresh.receiver).not.toBe(f.receiver)
 expect(fresh.marketActor).not.toBe(f.marketActor)
 expect(fresh.marketActorName.toLowerCase()).not.toBe(f.marketActorName.toLowerCase())
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.platform_market_actors WHERE id IN (${literal(f.marketActor)},${literal(fresh.marketActor)})`)).toBe(2)
 const forged=await dispatchCall({...prepared.identity,companyId:fresh.companyId,actorUserId:fresh.actorUserId,messageId:fresh.messageId,attemptId,action:'prepare',binding:{...prepared.binding,routeId:fresh.routeId,originalHash:createHash('sha256').update(fresh.wire).digest('hex')},owner:{kind:'worker',outboxId:randomUUID(),sendAttemptId:randomUUID(),workerId:'forged'}})
 expect(forged.error).not.toBeNull()
 expect(sql(`SELECT to_jsonb(complete) FROM gridex_outbound_dispatch.epoch`)).toBe(false)
})
it.each(['provider_result','message_status','message_event','outbox_status'] as const)('outbound %s persistence failure cannot produce a second send',async failure=>{
 const f=await outboundSeed(),outboxId=randomUUID(),suffix=randomUUID().replaceAll('-','');smtpFixture()
 const table=failure==='provider_result'?'gridex_outbound_dispatch.events':failure==='message_status'?'public.ediel_messages':failure==='message_event'?'public.ediel_message_events':'public.ediel_outbox'
 const condition=failure==='provider_result'?`NEW.message_id=${literal(f.messageId)}::uuid AND NEW.kind='provider_result'`:failure==='message_status'?`NEW.id=${literal(f.messageId)}::uuid AND NEW.status='sent'`:failure==='message_event'?`NEW.ediel_message_id=${literal(f.messageId)}::uuid AND NEW.event_type='sent'`:`NEW.id=${literal(outboxId)}::uuid AND NEW.status='sent'`
 sql(`INSERT INTO public.ediel_outbox(id,company_id,environment,ediel_message_id,status,lock_key) VALUES(${literal(outboxId)},${literal(f.companyId)},'test',${literal(f.messageId)},'queued',${literal(outboxId)});
 CREATE FUNCTION public.native_fail_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'synthetic_persistence_failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER native_fail_${suffix} BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION public.native_fail_${suffix}();`)
 const {sendOutboxItem}=await import('@/lib/ediel/outbox/sendOutboxItem')
 try{
  await sendOutboxItem({outboxItemId:outboxId,actorUserId:f.actorUserId}).catch(()=>null);expect(provider).toHaveBeenCalledTimes(1)
  expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toHaveLength(1)
  sql(`UPDATE public.ediel_messages SET status='queued',message_sent_at=NULL WHERE id=${literal(f.messageId)}; UPDATE public.ediel_outbox SET status='queued' WHERE id=${literal(outboxId)};`)
  await sendOutboxItem({outboxItemId:outboxId,actorUserId:f.actorUserId}).catch(()=>null);expect(provider).toHaveBeenCalledTimes(1)
  if(failure==='provider_result')expect(outboundFacts(f).filter(e=>e.kind==='provider_result')).toHaveLength(0)
 }finally{sql(`DROP TRIGGER native_fail_${suffix} ON ${table}; DROP FUNCTION public.native_fail_${suffix}();`);vi.unstubAllEnvs()}
})
it.each(['nodemailer-attachment','ediel-multipart-validation-base64','ediel-singlepart-base64','ediel-singlepart-lines','ediel-singlepart-compact'] as const)('outbound %s binds actual latin1 bytes and concrete envelope',async mimeMode=>{
 const f=await outboundSeed();smtpFixture()
 const {getEdielMessageById}=await import('@/lib/ediel/db'),{sendEdielMessageViaSmtp}=await import('@/lib/ediel/transport')
 try{
  const message=await getEdielMessageById(f.messageId,{companyId:f.companyId});expect(message).not.toBeNull()
  await sendEdielMessageViaSmtp(message!,{actorUserId:f.actorUserId,smtpMimeMode:mimeMode})
  expect(provider).toHaveBeenCalledTimes(1)
  const binding=sql<Record<string,unknown>>(`SELECT binding FROM gridex_outbound_dispatch.attempts WHERE message_id=${literal(f.messageId)}`)
  expect(binding).toMatchObject({to:'recipient@example.invalid',from:'synthetic@example.invalid',mimeMode,encoding:'latin1'})
  const bytes=Buffer.from(String(binding.payloadBase64),'base64')
  expect(bytes.includes(Buffer.from('Ångström','latin1'))).toBe(true)
  expect(binding.payloadHash).toBe(createHash('sha256').update(bytes).digest('hex'))
  expect(binding.originalHash).toBe(createHash('sha256').update(f.wire,'utf8').digest('hex'))
  expect(binding.payloadHash).not.toBe(binding.originalHash)
  const options=provider.mock.calls[0][0]
  if(mimeMode==='nodemailer-attachment'){expect(options.attachments[0].content.equals(bytes)).toBe(true);expect(binding).not.toHaveProperty('rawBase64')}
  else expect(Buffer.from(String(binding.rawBase64),'base64').equals(options.raw)).toBe(true)
 }finally{vi.unstubAllEnvs()}
})
it('outbound helper archive preparation failure never reaches callback or provider',async()=>{
 smtpFixture();const {sendEdielEmail}=await import('@/lib/email/sendEdielEmail');let entered=false
 try{await expect(sendEdielEmail({to:'recipient@example.invalid',raw:Buffer.from('Content-Type: application/pkcs7-mime\r\n\r\ninvalid!')},{beforeProviderCall:async()=>{entered=true}})).rejects.toThrow('smime_archive_body_not_base64');expect(entered).toBe(false);expect(provider).not.toHaveBeenCalled()}
 finally{vi.unstubAllEnvs()}
})
it('outbound fixture preflight retains actual Z08H wire validation',async()=>{
 const {preflightEdielMessageRow}=await import('@/lib/ediel/core/messageBuilder')
 const wire=closureFixture({reason:'Z25'}).wire.replace('BGM+Z05','BGM+Z08').replace('Synthetic','Ångström')
 const companyId=randomUUID(),parsed=await outboundParsed(wire,companyId)
 const result=preflightEdielMessageRow({id:randomUUID(),company_id:companyId,environment:'test',direction:'outbound',message_family:'PRODAT',message_standard:'edifact',message_code:'Z08',message_version:'E2SE6A',raw_payload:wire,parsed_payload:parsed,application_reference:'23-DDQ-PRODAT',sender_ediel_id:'12345',receiver_ediel_id:'54321'} as unknown as import('@/lib/ediel/types').EdielMessageRow,'send')
 expect(result.issues.filter(i=>i.severity==='error')).toEqual([])
})
it('outbound S/MIME archive is durable before provider entry and binds exact raw bytes',async()=>{
 const f=await outboundSeed(),certificateId=randomUUID();smtpFixture()
 const {X509Certificate}=await import('node:crypto')
 const {getEdielMessageById}=await import('@/lib/ediel/db'),{sendEdielMessageViaSmtp}=await import('@/lib/ediel/transport')
 const before=await getEdielMessageById(f.messageId,{companyId:f.companyId});expect(before).not.toBeNull()
 const pem=execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','/dev/null','-days','365','-set_serial','1234','-subj',`/CN=${before!.receiver_ediel_id}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']})
 const cert=new X509Certificate(pem)
 sql(`INSERT INTO public.ediel_certificates(id,company_id,certificate_fingerprint,secret_reference,status,environment,subject,issuer,serial_number,fingerprint_sha256,public_certificate_pem,valid_from,valid_to,owner_ediel_id,message_family,message_type,purpose,usage)
 VALUES(${literal(certificateId)},${literal(f.companyId)},${literal(cert.fingerprint256)},'public://synthetic','active','test',${literal(cert.subject)},${literal(cert.issuer)},${literal(cert.serialNumber)},${literal(cert.fingerprint256)},${literal(pem)},${literal(new Date(cert.validFrom).toISOString())},${literal(new Date(cert.validTo).toISOString())},${literal(before!.receiver_ediel_id)},'PRODAT','PRODAT','encryption','outbound_recipient');
 UPDATE public.ediel_route_profiles SET encryption_mode='smime',transport_security_mode='required_encrypted',receiver_certificate_id=${literal(certificateId)} WHERE communication_route_id=${literal(f.routeId)};`)
 provider.mockImplementation(async()=>{
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_payloads WHERE ediel_message_id=${literal(f.messageId)} AND metadata->>'archive_verified'='true'`)).toBe(1)
  expect(outboundFacts(f)).toEqual(expect.arrayContaining([expect.objectContaining({kind:'provider_call_entered',witnessed:true})]))
  return {accepted:['recipient@example.invalid'],rejected:[],messageId:'native-smime',response:'250 accepted'}
 })
 try{
  await sendEdielMessageViaSmtp(before!,{actorUserId:f.actorUserId,smtpMimeMode:'ediel-smime-enveloped'})
  expect(provider).toHaveBeenCalledTimes(1)
  const binding=sql<Record<string,unknown>>(`SELECT binding FROM gridex_outbound_dispatch.attempts WHERE message_id=${literal(f.messageId)}`)
  expect(binding).toMatchObject({mimeMode:'ediel-smime-enveloped',encoding:'latin1',from:'synthetic@example.invalid',to:'recipient@example.invalid'})
  expect(Buffer.from(String(binding.rawBase64),'base64').equals(provider.mock.calls[0][0].raw)).toBe(true)
 }finally{vi.unstubAllEnvs()}
})
it('outbound committed entry response loss suppresses both the initial provider and later retry',async()=>{
 const f=await outboundSeed();smtpFixture()
 const original=supabaseService.rpc.bind(supabaseService)
 const spy=vi.spyOn(supabaseService,'rpc').mockImplementation(((name:string,args:Record<string,unknown>)=>{
  const request=original(name,args)
  if(name==='gridex_outbound_dispatch_v1'&&(args.p_input as Record<string,unknown>)?.action==='enter'){
   return Promise.resolve(request).then(r=>{expect(r.error).toBeNull();return {...r,data:null,error:{message:'synthetic_response_lost_after_commit'}}})
  }
  return request
 }) as typeof supabaseService.rpc)
 try{
  await directOutbound(f).catch(()=>null);expect(provider).not.toHaveBeenCalled()
  expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toHaveLength(1)
  spy.mockRestore();await directOutbound(f).catch(()=>null);expect(provider).not.toHaveBeenCalled()
 }finally{spy.mockRestore();vi.unstubAllEnvs()}
})
it('outbound historical sent status is uninstrumented and scoped unrelated originals do not consume capacity',async()=>{
 const f=await outboundSeed()
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key FROM public.permissions WHERE key='communication.read';
 UPDATE public.ediel_messages SET status='sent',message_sent_at=clock_timestamp() WHERE id=${literal(f.messageId)};`)
 const read=(point:string)=>sql<Record<string,unknown>>(`SET ROLE service_role; SELECT gridex_outbound_dispatch.readset_v1(${literal(f.companyId)},'test',${literal(f.actorUserId)},${literal({point})});`)
 expect(read('735123456789012345')).toMatchObject({complete:false,originalCount:1,gaps:expect.arrayContaining([expect.objectContaining({messageId:f.messageId,reason:'uninstrumented_original'})])})
 expect(read('735999999999999999')).toMatchObject({complete:false,originalCount:0,originals:[]})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_outbound_dispatch.events WHERE message_id=${literal(f.messageId)}`)).toBe(0)
})
it('outbound duplicate already-claimed invocations share the actual worker fence',async()=>{
 const f=await outboundSeed(),outboxId=randomUUID(),workerId='native-duplicate-worker';smtpFixture()
 sql(`INSERT INTO public.ediel_outbox(id,company_id,environment,ediel_message_id,status,lock_key) VALUES(${literal(outboxId)},${literal(f.companyId)},'test',${literal(f.messageId)},'queued',${literal(outboxId)});`)
 const {claimEdielOutboxItem}=await import('@/lib/ediel/outbox/claimOutboxItems'),{sendOutboxItem}=await import('@/lib/ediel/outbox/sendOutboxItem')
 const claimed=await claimEdielOutboxItem({outboxItemId:outboxId,actorUserId:f.actorUserId,workerId});expect(claimed?.current_send_attempt_id).toBeTruthy()
 const params={outboxItemId:outboxId,actorUserId:f.actorUserId,workerId,sendAttemptId:claimed!.current_send_attempt_id,alreadyClaimed:true}
 const contention=observeReservationContention(f.messageId)
 try{
  const results=await Promise.all([sendOutboxItem(params),sendOutboxItem(params)])
  contention.assert()
  expect(contention.arrivals.map(a=>a.owner)).toEqual([expect.objectContaining({kind:'worker',outboxId,sendAttemptId:claimed!.current_send_attempt_id,workerId}),expect.objectContaining({kind:'worker',outboxId,sendAttemptId:claimed!.current_send_attempt_id,workerId})])
  expect(results.every(r=>r.status==='sent'||r.status==='delivery_uncertain')).toBe(true)
  expect(results.some(r=>r.status==='delivery_uncertain')).toBe(true)
  expect(provider).toHaveBeenCalledTimes(1)
  expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toEqual([expect.objectContaining({witnessed:true})])
  expect(outboundFacts(f).filter(e=>e.kind==='provider_result')).toEqual([expect.objectContaining({witnessed:true,facts:expect.objectContaining({classification:'accepted'})})])
 }finally{contention.restore();vi.unstubAllEnvs()}
})
it('outbound failed actor authorization permits zero provider calls and no entry',async()=>{
 const f=await outboundSeed();smtpFixture()
 sql(`UPDATE public.user_profiles SET user_status='inactive' WHERE id=${literal(f.actorUserId)};`)
 try{await directOutbound(f).catch(()=>null);expect(provider).not.toHaveBeenCalled();expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toHaveLength(0)}finally{vi.unstubAllEnvs()}
})
it('outbound accepted projection repair with a changed route and MIME invokes no provider',async()=>{
 const f=await outboundSeed(),newRoute=randomUUID(),newProfile=randomUUID();smtpFixture()
 const {getEdielMessageById}=await import('@/lib/ediel/db'),{sendEdielMessageViaSmtp}=await import('@/lib/ediel/transport')
 try{
  await directOutbound(f);expect(provider).toHaveBeenCalledTimes(1)
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,environment_type,is_active,target_email) VALUES(${literal(newRoute)},${literal(f.companyId)},'Changed synthetic route','bilateral_test',true,'recipient@example.invalid');
  INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email,message_family,business_code)
  SELECT ${literal(newProfile)},company_id,${literal(newRoute)},'Changed synthetic profile',environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email,message_family,business_code FROM public.ediel_route_profiles WHERE communication_route_id=${literal(f.routeId)};
  UPDATE public.ediel_messages SET status='queued',message_sent_at=NULL,communication_route_id=${literal(newRoute)},route_profile_id=${literal(newProfile)} WHERE id=${literal(f.messageId)};`)
  const m=await getEdielMessageById(f.messageId,{companyId:f.companyId})
  await sendEdielMessageViaSmtp(m!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})
  expect(provider).toHaveBeenCalledTimes(1)
  expect(sql(`SELECT to_jsonb(status) FROM public.ediel_messages WHERE id=${literal(f.messageId)}`)).toBe('sent')
  expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toHaveLength(1)
 }finally{vi.unstubAllEnvs()}
})
it('outbound owner rejects same-transaction visibility witness',async()=>{
 const f=await outboundSeed(),first=await preparedOutbound(f)
 await dispatchCall({...first.identity,action:'release'})
 const identity={...first.identity,attemptId:randomUUID()}
 expect(()=>sql(`BEGIN; SET LOCAL ROLE service_role; WITH receipt AS (SELECT public.gridex_outbound_dispatch_v1(${literal({...identity,action:'prepare',owner:{kind:'direct'},binding:first.binding})}) r)
 SELECT public.gridex_outbound_dispatch_v1(${literal({...identity,action:'witness'})}::jsonb||jsonb_build_object('eventId',r->>'eventId')) FROM receipt; COMMIT;`)).toThrow(/outbound_dispatch_visibility_unproven/)
})
it('outbound owner counts scope before its original bound and names overflow',async()=>{
 const f=await outboundSeed()
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key FROM public.permissions WHERE key='communication.read';`)
 // Retain every real canonical trigger; bound seed statements independently of
 // the reader's unchanged 10-second budget and its exact 1001-row oracle.
 for(let batch=0;batch<20;batch++)sql(`INSERT INTO public.ediel_messages SELECT (jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'source_operation_id',gen_random_uuid()::text))).*
 FROM public.ediel_messages m CROSS JOIN generate_series(1,50) WHERE m.id=${literal(f.messageId)};`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='outbound'`)).toBe(1001)
 const read=(point:string)=>sql<Record<string,unknown>>(`SET ROLE service_role; SELECT gridex_outbound_dispatch.readset_v1(${literal(f.companyId)},'test',${literal(f.actorUserId)},${literal({point})});`)
 expect(read('735123456789012345')).toMatchObject({complete:false,originalCount:1001,reason:'scoped_original_count_overflow'})
 expect(read('735999999999999999')).toMatchObject({complete:false,originalCount:0,originals:[]})
})
it.each([{bytes:262145,count:1,reason:'scoped_original_bytes_overflow'},{bytes:200000,count:32,reason:'scoped_original_attempt_bytes_overflow'}])('outbound bounded reader reports $reason',async({bytes,count,reason})=>{
 const f=await outboundSeed()
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key FROM public.permissions WHERE key='communication.read';
 INSERT INTO public.ediel_messages SELECT (jsonb_populate_record(NULL::public.ediel_messages,to_jsonb(m)||jsonb_build_object('id',gen_random_uuid(),'source_operation_id',gen_random_uuid()::text,'raw_payload',repeat('X',${bytes})))).*
 FROM public.ediel_messages m CROSS JOIN generate_series(1,${count}) WHERE m.id=${literal(f.messageId)};`)
 expect(sql(`SET ROLE service_role; SELECT gridex_outbound_dispatch.readset_v1(${literal(f.companyId)},'test',${literal(f.actorUserId)},${literal({point:'735123456789012345'})});`))
  .toMatchObject({complete:false,originalCount:count+1,reason})
})

it('outbound genuinely claimed worker loses entry when its claim changes after preparation',async()=>{
 const f=await outboundSeed(),outboxId=randomUUID(),workerId='native-stale-worker';smtpFixture()
 sql(`INSERT INTO public.ediel_outbox(id,company_id,environment,ediel_message_id,status,lock_key) VALUES(${literal(outboxId)},${literal(f.companyId)},'test',${literal(f.messageId)},'queued',${literal(outboxId)});`)
 const {claimEdielOutboxItem}=await import('@/lib/ediel/outbox/claimOutboxItems'),{sendOutboxItem}=await import('@/lib/ediel/outbox/sendOutboxItem')
 const claimed=await claimEdielOutboxItem({outboxItemId:outboxId,actorUserId:f.actorUserId,workerId})
 expect(claimed?.current_send_attempt_id).toBeTruthy()
 const original=supabaseService.rpc.bind(supabaseService)
 let prepared=false,replaced=false,entryError:unknown
 const spy=vi.spyOn(supabaseService,'rpc').mockImplementation(((name:string,args:Record<string,unknown>)=>{
  const input=args.p_input as Record<string,unknown>|undefined
  if(name!=='gridex_outbound_dispatch_v1'||input?.messageId!==f.messageId)return original(name,args)
  return Promise.resolve(original(name,args)).then(async result=>{
   if(input.action==='prepare'){
    expect(result.error).toBeNull();expect(result.data).toMatchObject({scoped:true,proceed:true})
    expect(input.owner).toMatchObject({kind:'worker',outboxId,workerId,sendAttemptId:claimed!.current_send_attempt_id})
    prepared=true
    sql(`UPDATE public.ediel_outbox SET status='queued',locked_by=NULL,locked_at=NULL WHERE id=${literal(outboxId)};`)
    const replacement=await claimEdielOutboxItem({outboxItemId:outboxId,actorUserId:f.actorUserId,workerId:'native-replacement-worker'})
    expect(replacement?.current_send_attempt_id).toBeTruthy()
    expect(replacement!.current_send_attempt_id).not.toBe(claimed!.current_send_attempt_id)
    replaced=true
   }
   if(input.action==='enter')entryError=result.error
   return result
  })
 }) as typeof supabaseService.rpc)
 try{
  const result=await sendOutboxItem({outboxItemId:outboxId,actorUserId:f.actorUserId,workerId,sendAttemptId:claimed!.current_send_attempt_id,alreadyClaimed:true})
  expect(prepared&&replaced).toBe(true)
  expect(entryError).toMatchObject({message:'outbound_dispatch_worker_fence_lost'})
  expect(result.status).toBe('delivery_uncertain')
  expect(provider).not.toHaveBeenCalled()
  expect(outboundFacts(f).filter(e=>e.kind==='prepared')).toEqual([expect.objectContaining({witnessed:true})])
  expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toHaveLength(0)
 }finally{spy.mockRestore();vi.unstubAllEnvs()}
})

it('outbound result witness failure retains the accepted event and reader gap without resending',async()=>{
 const f=await outboundSeed(),suffix=randomUUID().replaceAll('-','');smtpFixture()
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,key FROM public.permissions WHERE key='communication.read';
 CREATE FUNCTION public.native_witness_fail_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT FROM gridex_outbound_dispatch.events e WHERE e.id=NEW.event_id AND e.message_id=${literal(f.messageId)}::uuid AND e.kind='provider_result') THEN RAISE EXCEPTION 'synthetic_result_witness_failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER native_witness_fail_${suffix} BEFORE INSERT ON gridex_outbound_dispatch.witnesses FOR EACH ROW EXECUTE FUNCTION public.native_witness_fail_${suffix}();`)
 let installed=true
 try{
  await expect(directOutbound(f)).rejects.toMatchObject({name:'SmtpDeliveryUncertainError'})
  expect(provider).toHaveBeenCalledTimes(1)
  expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toEqual([expect.objectContaining({witnessed:true})])
  expect(outboundFacts(f).filter(e=>e.kind==='provider_result')).toEqual([expect.objectContaining({witnessed:false,facts:expect.objectContaining({classification:'accepted'})})])
  sql(`DROP TRIGGER native_witness_fail_${suffix} ON gridex_outbound_dispatch.witnesses; DROP FUNCTION public.native_witness_fail_${suffix}();`);installed=false
  sql(`UPDATE public.ediel_messages SET status='queued',message_sent_at=NULL WHERE id=${literal(f.messageId)};`)
  await expect(directOutbound(f)).rejects.toMatchObject({name:'SmtpDeliveryUncertainError'})
  expect(provider).toHaveBeenCalledTimes(1)
  expect(outboundFacts(f).filter(e=>e.kind==='provider_result')).toEqual([expect.objectContaining({witnessed:false})])
  expect(sql(`SET ROLE service_role; SELECT gridex_outbound_dispatch.readset_v1(${literal(f.companyId)},'test',${literal(f.actorUserId)},${literal({point:'735123456789012345'})});`))
   .toMatchObject({complete:false,originalCount:1,gaps:expect.arrayContaining([expect.objectContaining({messageId:f.messageId,reason:'unwitnessed_event'})])})
 }finally{
  if(installed)sql(`DROP TRIGGER native_witness_fail_${suffix} ON gridex_outbound_dispatch.witnesses; DROP FUNCTION public.native_witness_fail_${suffix}();`)
  vi.unstubAllEnvs()
 }
})

it.each(['inactive_membership','inactive_company','denied_permission'] as const)('outbound valid scope with %s denies actual sends and SQL entry',async denial=>{
 const f=await outboundSeed(),prepared=await preparedOutbound(f);smtpFixture()
 if(denial==='inactive_membership'){
  // Keep a functioning administrator; exercise deactivation through the real
  // tenant guard instead of disabling it to arrange the authorization case.
  const backup=await seed()
  sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
  VALUES(${literal(f.companyId)},${literal(backup.actorUserId)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
  INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active)
  SELECT ${literal(backup.actorUserId)},id,'company_admin',${literal(f.companyId)},'active',true FROM public.roles WHERE key='company_admin';
  UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)};`)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.company_memberships m JOIN auth.users u ON u.id=m.user_id JOIN public.user_profiles p ON p.id=u.id
   WHERE m.company_id=${literal(f.companyId)} AND m.user_id=${literal(backup.actorUserId)} AND m.is_active AND m.status='active' AND m.membership_role='company_admin'
    AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()) AND u.email_confirmed_at IS NOT NULL AND p.user_status='active'`)).toBe(1)
  expect(sql(`SELECT to_jsonb(is_active) FROM public.company_memberships WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)}`)).toBe(false)
 }
 if(denial==='inactive_company')sql(`UPDATE public.companies SET status='paused' WHERE id=${literal(f.companyId)};`)
 if(denial==='denied_permission'){
  sql(`DELETE FROM public.user_roles WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)};
  UPDATE public.user_permissions SET effect='deny' WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)} AND permission_key='communication.send';`)
  expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(f.actorUserId)},${literal(f.companyId)},'communication.send'))`)).toBe(false)
 }
 try{
  const denied=await dispatchCall({...prepared.identity,action:'enter'})
  expect(denied.error).toMatchObject({message:'outbound_dispatch_actor_unavailable'})
  await expect(directOutbound(f)).rejects.toBeDefined()
  expect(provider).not.toHaveBeenCalled()
  expect(outboundFacts(f).filter(e=>e.kind==='provider_call_entered')).toHaveLength(0)
 }finally{vi.unstubAllEnvs()}
})
