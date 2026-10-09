// Constructed native tests. This suite requires the ordinary disposable local
// Supabase stack; it never seeds accepted facets, approvals or private receipts.
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {describe,expect,it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {getEdielMessageById} from '@/lib/ediel/db'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {approveEdielInboundCase,createOrUpdateInboundProdatCase} from '@/lib/ediel/inboundCases'
import {seedNormalSwitchNativeFixture,nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string}|null}>
const rpc=(name:string,args:Record<string,unknown>)=>(supabaseService.rpc.bind(supabaseService) as unknown as Rpc)(name,args)
const sourceArgs=(f:Fixture)=>({p_company_id:f.companyId,p_source_message_id:f.sourceId,p_actor_user_id:f.actorUserId})
async function fixture(){
 const base=await seedNormalSwitchNativeFixture({deferOriginal:true}),sourceId=randomUUID(),doc='B'+randomUUID().replaceAll('-','').slice(0,13).toUpperCase() // UNH 0062 an..14
 const points=['A','B'].map(prefix=>prefix+randomUUID().replaceAll('-','').slice(0,23).toUpperCase())
 // Literal D97A ordering and independent distributor namespace. Each first
 // register has actual source-only customer/site data, every repeated register
 // is represented by the real parser and same canonical invocation.
 const segments=[`UNH+${doc}+PRODAT:D:97A:UN:E2SE6A`,`BGM+Z04+${doc}+9+AB`,'DTM+137:202610011200:203','DTM+ZZZ:1:805',`NAD+FR+${base.receiver}:160:SVK+++++++SE`,`NAD+DO+${base.sender}:160:SVK+++++++SE`,
  ...points.flatMap((point,i)=>[`LIN+${i+1}++${point}:::89`,'DTM+92:202611010000:203','DTM+354:15:806',`QTY+31:${i+1}00:KWH`,'CCI++Z13','CAV+Z22','CCI++Z04','CAV+Z03','CCI++Z07','CAV+Z12','CCI++Z12','CAV+:::W','CCI++Z15','CAV+D','CCI++Z14','CAV+:::L917:8716867000030',`RFF+MG:METER-${i}`,`RFF+Z05:TES`,`RFF+LI:CASE-${i}`,`NAD+UD+CUSTOMER${i}::89++Synthetic ${i}+Testgatan+Teststad++12345+SE`,`NAD+IT+${point}::89+++Testgatan+Teststad++12345+SE`,`NAD+Z02+${base.brpEdielId}:160:SVK`])]
 const wire=`UNA:+.? 'UNB+UNOC:3+${base.receiver}:14+${base.sender}:14+261001:1200+${doc}++23-DDQ-PRODAT++1++1'${segments.join("'")}'UNT+${segments.length+1}+${doc}'UNZ+1+${doc}'`
 sql(`INSERT INTO public.permissions(key,name,is_active) VALUES('communication.write','Synthetic batch communication',true),('customers.write','Synthetic batch customer',true) ON CONFLICT(key) DO NOTHING;
 INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,status,is_active) SELECT ${literal(base.actorUserId)},${literal(base.companyId)},p.id,p.key,'allow','active',true FROM public.permissions p WHERE p.key IN('communication.write','customers.write');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,parsed_payload,status,message_received_at,sender_ediel_id,receiver_ediel_id,application_reference,test_flag,
  canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
 SELECT ${literal(sourceId)},${literal(base.companyId)},'test','inbound','edifact','PRODAT','Z04',${literal(wire)},'{"subtype":"L","prodatDependentFacts":{"market":"electricity","meterReadingsSentInUtilts":false}}','received',clock_timestamp(),${literal(base.receiver)},${literal(base.sender)},'23-DDQ-PRODAT',1,
  pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
 FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled;`)
 const message=await getEdielMessageById(sourceId);expect(message).not.toBeNull()
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message!)
 expect({syntax:decision.syntaxDecision,application:decision.applicationDecision,functional:decision.functionalDecision},JSON.stringify(decision.issues)).toEqual({syntax:'accepted',application:'accepted',functional:'accepted'})
 const recorded=await recordReceivedSourceValidation({original:message!,validated:message!,resolvedCompanyId:base.companyId,decision});expect(recorded.status).toBe('recorded')
 await captureFreshEdielSourceRulePackEvidence(base.companyId,sourceId) // production order (inboundProcessing.ts)
 const inboundCase=await createOrUpdateInboundProdatCase({actorUserId:base.actorUserId,message:message!});expect(inboundCase?.status).toBe('pending_review')
 return {...base,sourceId,caseId:inboundCase!.id,wire,points,assessmentId:recorded.status==='recorded'?recorded.assessmentId:null}
}
type Fixture=Awaited<ReturnType<typeof fixture>>
const approve=(f:Fixture)=>approveEdielInboundCase({companyId:f.companyId,caseId:f.caseId,actorUserId:f.actorUserId,objectDecisions:f.points.map(meteringPointId=>({meteringPointId,identityAgency:'89',mode:'create_new_customer' as const}))})
function counts(f:Fixture){return sql<Record<string,unknown>>(`SELECT jsonb_build_object('caseStatus',(SELECT status FROM public.ediel_inbound_cases WHERE id=${literal(f.caseId)}),'graphs',(SELECT count(*) FROM public.customer_onboarding_operations WHERE company_id=${literal(f.companyId)} AND channel='ediel_inbound'),'receipts',(SELECT count(*) FROM gridex_prodat_object_batch.graph_receipts WHERE case_id=${literal(f.caseId)}),'audit',(SELECT count(*) FROM public.audit_logs WHERE company_id=${literal(f.companyId)} AND action='ediel_inbound_objects_applied'),'events',(SELECT count(*) FROM public.ediel_message_events WHERE ediel_message_id=${literal(f.sourceId)} AND event_type='validated'),'ack',(SELECT count(*) FROM public.ediel_messages WHERE direction='outbound' AND related_message_id=${literal(f.sourceId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE source_message_id=${literal(f.sourceId)}))`)}
const deny=(f:Fixture)=>sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from) VALUES(${literal(f.actorUserId)},${literal(f.companyId)},'customers.write','deny',true,clock_timestamp())`)
function tripwire(f:Fixture,table:string,predicate:string){const fn='batch_trip_'+randomUUID().replaceAll('-',''),trigger=fn+'_t';sql(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF ${predicate} THEN RAISE EXCEPTION 'batch_native_last_effect_failure';END IF;RETURN NEW;END$$;CREATE TRIGGER ${trigger} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION public.${fn}();`);return()=>sql(`DROP TRIGGER ${trigger} ON ${table};DROP FUNCTION public.${fn}();`)}
describe('actual PRODAT object batch original/current actor and atomic native first effects',()=>{
 it('writes two actual separate graphs, all native receipts and one final audit/event',async()=>{const f=await fixture();expect((await rpc('ediel_read_prodat_object_batch_source_v1',sourceArgs(f))).error).toBeNull();expect((await approve(f)).status).toBe('applied');expect(counts(f)).toEqual({caseStatus:'applied',graphs:2,receipts:2,audit:1,events:1,ack:0,outbox:0})})
 it('identical completed retry attempts no insert and preserves the full original',async()=>{const f=await fixture();await approve(f);const before=counts(f),remove=tripwire(f,'public.audit_logs',`NEW.company_id=${literal(f.companyId)}::uuid`);try{expect((await approve(f)).status).toBe('applied');expect(counts(f)).toEqual(before);expect((await getEdielMessageById(f.sourceId))?.raw_payload).toBe(f.wire)}finally{remove()}})
 it('retained completed result is current read-scoped after write revocation with no new effects',async()=>{const f=await fixture();await approve(f);const before=counts(f);sql(`INSERT INTO public.permissions(key,name,is_active) VALUES('customers.read','Synthetic retained customer read',true) ON CONFLICT(key) DO NOTHING;INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,status,is_active) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},p.id,p.key,'allow','active',true FROM public.permissions p WHERE p.key IN('communication.read','customers.read');INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from) SELECT ${literal(f.actorUserId)},${literal(f.companyId)},p,'deny',true,clock_timestamp() FROM unnest(ARRAY['communication.write','customers.write'])p;`);expect((await approve(f)).status).toBe('applied');expect(counts(f)).toEqual(before);expect((await rpc('ediel_read_prodat_object_batch_source_v1',sourceArgs(f))).error).not.toBeNull()})
 it('current DENY before approval creates no approval/graph/final effects',async()=>{const f=await fixture(),before=counts(f);deny(f);await expect(approve(f)).rejects.toThrow(/current_actor/);expect(counts(f)).toEqual(before)})
 it('revoked membership cannot borrow stored full facets',async()=>{const f=await fixture(),before=counts(f),admin=randomUUID()
  // The tenant keeps another functioning admin, so the revocation itself is allowed.
  sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(admin)},'authenticated','authenticated',${literal(`${admin}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
   INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(admin)},${literal(`${admin}@example.invalid`)},'Synthetic remaining admin','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
   INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(f.companyId)},${literal(admin)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');`)
  sql(`UPDATE public.company_memberships SET status='revoked',is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)}`);await expect(approve(f)).rejects.toThrow(/current_actor/);expect(counts(f)).toEqual(before)})
 it('banned Auth actor has no native first-effect authority',async()=>{const f=await fixture(),before=counts(f);sql(`UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day' WHERE id=${literal(f.actorUserId)}`);await expect(approve(f)).rejects.toThrow(/current_actor/);expect(counts(f)).toEqual(before)})
 it('current receiver role revocation holds before an accepted graph',async()=>{const f=await fixture(),before=counts(f);sql(`UPDATE public.tenant_actor_roles SET valid_to=clock_timestamp() WHERE company_id=${literal(f.companyId)} AND actor_id=${literal(f.actorUserId)} AND role_code='electricity_supplier'`);await expect(approve(f)).rejects.toThrow(/captured_role/);expect(counts(f)).toEqual(before)})
 it('a final private graph-receipt failure rolls back that actual graph transaction',async()=>{const f=await fixture(),remove=tripwire(f,'gridex_prodat_object_batch.graph_receipts',`NEW.case_id=${literal(f.caseId)}::uuid`);try{await expect(approve(f)).rejects.toThrow(/batch_native_last_effect_failure/);expect(counts(f)).toMatchObject({graphs:0,receipts:0,audit:0,events:0,ack:0,outbox:0})}finally{remove()}})
 it('final event failure rolls back audit/applied CAS, keeps real per-object receipts, resumes without graphs',async()=>{const f=await fixture(),remove=tripwire(f,'public.ediel_message_events',`NEW.ediel_message_id=${literal(f.sourceId)}::uuid AND NEW.event_type='validated'`);try{await expect(approve(f)).rejects.toThrow(/batch_native_last_effect_failure/);expect(counts(f)).toMatchObject({graphs:2,receipts:2,audit:0,events:0})}finally{remove()}expect((await approve(f)).status).toBe('applied');expect(counts(f)).toMatchObject({graphs:2,receipts:2,audit:1,events:1})})
 it('foreign source/current actor cannot read or conditionally approve an own case',async()=>{const f=await fixture(),other=await fixture(),before=counts(f);const read=await rpc('ediel_read_prodat_object_batch_source_v1',{...sourceArgs(f),p_company_id:other.companyId,p_actor_user_id:other.actorUserId});expect(read.error).not.toBeNull();expect(counts(f)).toEqual(before)})
 it('DENY INSERT phantom fence waits before any source/case/graph lock, then denies zero effects',async()=>{
  const f=await fixture(),before=counts(f),application='batch_deny_'+randomUUID(),writer=spawn('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let output='',errors='';writer.stdout.on('data',x=>{output+=String(x)});writer.stderr.on('data',x=>{errors+=String(x)})
  const done=new Promise<void>((resolve,reject)=>{writer.on('error',reject);writer.on('close',code=>code===0?resolve():reject(Error(errors)))})
  let worker:Promise<{stdout:string;stderr:string}>|undefined
  try{
   writer.stdin.write(`BEGIN;INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from) VALUES(${literal(f.actorUserId)},${literal(f.companyId)},'customers.write','deny',true,clock_timestamp());SELECT 'DENY_LOCKED';\n`)
   for(let i=0;i<250&&!output.includes('DENY_LOCKED');i++)await new Promise(resolve=>setTimeout(resolve,20));expect(output,errors).toContain('DENY_LOCKED')
   worker=promisify(execFile)('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1','-c',`SET ROLE service_role;SELECT public.ediel_read_prodat_object_batch_source_v1(${literal(f.companyId)},${literal(f.sourceId)},${literal(f.actorUserId)});`],{encoding:'utf8',env:{...process.env,PGAPPNAME:application},timeout:15000})
   // Attach a handler while observing its blocking lock, so rejection is not unhandled.
   worker.catch(()=>undefined)
   let blocked=false;for(let i=0;i<250&&!blocked;i++){blocked=sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${literal(application)} AND l.relation='public.user_permission_overrides'::regclass AND l.mode='ShareLock' AND NOT l.granted))`);if(!blocked)await new Promise(resolve=>setTimeout(resolve,20))}
   expect(blocked).toBe(true);expect(sql(`SELECT to_jsonb(NOT EXISTS(SELECT FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name=${literal(application)} AND l.relation IN('public.ediel_messages'::regclass,'public.ediel_inbound_cases'::regclass)))`)).toBe(true);expect(counts(f)).toEqual(before)
   writer.stdin.end('COMMIT;\n');await done;await expect(worker).rejects.toThrow(/current_actor/);expect(counts(f)).toEqual(before)
  }finally{if(!writer.stdin.destroyed)writer.stdin.end('ROLLBACK;\n');await done.catch(()=>undefined);if(worker)await worker.catch(()=>undefined)}
 })
})
