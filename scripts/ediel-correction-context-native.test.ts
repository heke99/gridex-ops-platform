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
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'Synthetic correction capture','active');
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
 VALUES(${literal(actorUserId)},'authenticated','authenticated',${literal(`${actorUserId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actorUserId)},${literal(`${actorUserId}@example.invalid`)},'Synthetic capture actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
 VALUES(${literal(companyId)},${literal(actorUserId)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
 INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active)
 SELECT ${literal(actorUserId)},id,'company_admin',${literal(companyId)},'active',true FROM public.roles WHERE key='company_admin' ON CONFLICT DO NOTHING;
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(actorUserId)},${literal(companyId)},id,'communication.write' FROM public.permissions WHERE key='communication.write';
 -- Pin the actual enabled C registry profile like the retained closure fixture.
 -- Code/date-only inference sees L, LK and C as three Z05 candidates; it cannot
 -- use parsed subtype to choose one. Preserve the real receive/commit clock.
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceMessageId)},${literal(companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{"subtype":"C"}',clock_timestamp(),'23-DDQ-PRODAT','12345','54321',pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
 WHERE profile.profile_key='PRODAT:Z05:C:26.A:r3' AND profile.is_enabled;`)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.sources WHERE source_message_id=${literal(sourceMessageId)}`)).toBe(1)
 return {companyId,actorUserId,sourceMessageId,environment:'test' as const}
}
const call=(f:Awaited<ReturnType<typeof seed>>)=>`public.gridex_capture_correction_concern_v1(${literal(f.companyId)},'test',${literal(f.sourceMessageId)},${literal(f.actorUserId)})`
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
 for(const input of [{...f,companyId:other.companyId},{...f,environment:'production' as const},{...f,actorUserId:other.actorUserId}])
  expect(await captureCorrectionContext(input)).toEqual({status:'unconfirmed',disposition:'unreviewed'})
 sql(`UPDATE public.user_profiles SET user_status='disabled' WHERE id=${literal(f.actorUserId)}`)
 expect(await captureCorrectionContext(f)).toEqual({status:'unconfirmed',disposition:'unreviewed'})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.correction_concerns WHERE source_message_id=${literal(f.sourceMessageId)}`)).toBe(0)
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
it('communication permission is required even if another test-only capability exists',async()=>{
 const f=await seed()
 sql(`DELETE FROM public.user_roles WHERE user_id=${literal(f.actorUserId)};
 DELETE FROM public.user_permissions WHERE user_id=${literal(f.actorUserId)};
 UPDATE public.company_memberships SET membership_role='viewer',role='viewer',role_key='viewer' WHERE user_id=${literal(f.actorUserId)};
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(f.actorUserId)},${literal(f.companyId)},id,'ediel_testing.write' FROM public.permissions WHERE key='ediel_testing.write';`)
 expect(await captureCorrectionContext(f)).toEqual({status:'unconfirmed',disposition:'unreviewed'})
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
