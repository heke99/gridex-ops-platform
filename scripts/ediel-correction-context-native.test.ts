import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
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
function grantDirect(actor:string,company:string|null,options:{effect?:string;status?:string;active?:boolean}={}){
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,status,is_active)
  SELECT ${literal(actor)},${company===null?'NULL':literal(company)},id,key,${literal(options.effect??'allow')},${literal(options.status??'active')},${options.active??true}
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
 const a=await seed(),b=await seed(),actor=limitedActor([a.companyId,b.companyId]);grantDirect(actor,null)
 expect(await effective(actor,a.companyId)).toBe(true);expect(await effective(actor,b.companyId)).toBe(true)
 expect(sql(`SELECT to_jsonb('communication.send'=ANY(public.gridex_get_user_permissions_in_company(${literal(actor)},NULL)))`)).toBe(true)
 expect(await captureCorrectionContext({...b,actorUserId:actor})).toMatchObject({status:'recorded',disposition:'unreviewed'})
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
