// masterplan: TR-10, AT-TR-10, SC-063
// Actual native normal-switch/H source generation, archive, claim, journals,
// owner receipts and scoped reader. Synthetic tenants/contract/legal inputs,
// a declared public clock and scoped DB faults are explicit fixture boundaries.
// Only external SMTP and the browser-cookie client factory are replaced;
// sourceSession still uses actual local GoTrue/JWT. No private attempt, ready
// source, entry, acceptance, case or witness is inserted by these tests.
import {randomUUID} from 'node:crypto'
import type {SupabaseClient} from '@supabase/supabase-js'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const smtp=vi.hoisted(()=>vi.fn())
const sourceSession=vi.hoisted(()=>({client:null as SupabaseClient|null}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:smtp})}}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{if(!sourceSession.client)throw Error('native_actual_source_session_required');return sourceSession.client}}))
import {seedNormalSwitchNativeFixture,futureNativeSupplyDate,nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {nationalRescissionNativeChain} from './helpers/nationalRescissionNative'
import {sendOutboxItem} from '@/lib/ediel/outbox/sendOutboxItem'
import {claimEdielOutboxItem} from '@/lib/ediel/outbox/claimOutboxItems'
import {processEdielOutbox} from '@/lib/ediel/outbox/processEdielOutbox'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {readEdielTransportCopies} from '@/lib/ediel/transport/copy'
import {getEdielMessageById} from '@/lib/ediel/db'
import {prepareAndQueueProdatRecovery} from '@/lib/ediel/recovery/prodatRecovery'

type Scope={companyId:string;actorUserId:string;messageId:string}
type Attempt={id:string;entered_at:string;observed_at:string|null;classification:string|null;binding:Record<string,string>;owner:Record<string,string>}
const rescission=nationalRescissionNativeChain({provider:smtp,sourceSession})
afterEach(()=>{smtp.mockReset();sourceSession.client=null;vi.unstubAllEnvs();vi.restoreAllMocks()})
function configureSmtp(){for(const [key,value] of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(key,value)}
async function seed(){configureSmtp();const f=await seedNormalSwitchNativeFixture({requestedStartDate:futureNativeSupplyDate()});return{...f,messageId:f.originalZ03.id}}
function queueId(f:Scope){return sql<string>(`SELECT to_jsonb(id) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(f.messageId)}`)}
function attempt(f:Scope){return sql<Attempt>(`SELECT to_jsonb(a) FROM gridex_ediel_transport.attempts a WHERE company_id=${literal(f.companyId)} AND message_id=${literal(f.messageId)}`)}
function frozenCases(f:Scope){return sql(`SELECT jsonb_build_object('cases',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM gridex_ediel_transport.reconciliation_cases c WHERE company_id=${literal(f.companyId)} AND message_id=${literal(f.messageId)}),'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM gridex_ediel_transport.reconciliation_case_events e JOIN gridex_ediel_transport.reconciliation_cases c ON c.id=e.case_id WHERE c.company_id=${literal(f.companyId)} AND c.message_id=${literal(f.messageId)}))`)}
function caseCount(f:Scope){return sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_ediel_transport.reconciliation_cases WHERE company_id=${literal(f.companyId)} AND message_id=${literal(f.messageId)}`)}
function rawOriginal(f:Scope){return sql(`SELECT jsonb_build_object('raw',raw_payload,'hash',immutable_payload_hash,'rendered',immutable_rendered_at,'archives',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.ediel_message_payloads p WHERE p.ediel_message_id=m.id)) FROM public.ediel_messages m WHERE id=${literal(f.messageId)}`)}
function businessCounts(f:Scope){return sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)}),'outboxes',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)}),'businessCases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${literal(f.companyId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),'recovery',(SELECT count(*) FROM gridex_received_sources.prodat_recovery_operations WHERE company_id=${literal(f.companyId)}))`)}
function protectedSources(f:Scope){return sql(`SELECT jsonb_build_object('consumptions',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.witness_id),'[]') FROM gridex_ediel_outbound_owner.consumptions c WHERE c.source_message_id=${literal(f.messageId)}),'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]') FROM public.customer_supply_periods p WHERE p.company_id=${literal(f.companyId)}),'mandates',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM gridex_supply_rescission.mandates m WHERE m.company_id=${literal(f.companyId)}),'originalReceipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.message_id),'[]') FROM gridex_supply_rescission.outbound_receipts r WHERE r.message_id=${literal(f.messageId)}))`)}
function expireClaim(id:string){sql(`UPDATE public.ediel_outbox SET locked_at=now()-interval '1 hour' WHERE id=${literal(id)}; SELECT to_jsonb(true)`)}
async function assertNoResend(f:Scope,id:string){
 expect(await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})).toMatchObject({processed:0})
 expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})).toMatchObject({status:'blocked'})
 expect(smtp).toHaveBeenCalledTimes(1)
}
it('actual after-DATA unknown publishes exactly one technical case atomically with the immutable observed attempt',async()=>{
 const f=await seed(),id=queueId(f),before=businessCounts(f)
 smtp.mockRejectedValue(Object.assign(Error('synthetic loss after DATA'),{code:'ETIMEDOUT',command:'DATA'}))
 expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})).toMatchObject({status:'delivery_uncertain'})
 const a=attempt(f);expect(a).toMatchObject({entered_at:expect.any(String),observed_at:expect.any(String),classification:'unknown'})
 const read=await readEdielTransportCopies(f),row=read.reconciliationCases[0]
 expect(read.reconciliationCases).toHaveLength(1)
 expect(row).toMatchObject({companyId:f.companyId,messageId:f.messageId,environment:'test',lane:'generic_journal',attemptId:a.id,originalHash:a.binding.originalHash,mimeSha256:a.binding.mimeSha256,reason:'provider_outcome_unknown',status:'needs_tracking',observedClassification:'unknown',authorizesResend:false,deliveryProven:false})
 const retained=sql<Record<string,unknown>>(`SELECT to_jsonb(c) FROM gridex_ediel_transport.reconciliation_cases c WHERE attempt_id=${literal(a.id)}`)
 expect(retained).toMatchObject({actor_user_id:f.actorUserId,mime_archive_ref:a.binding.mimeArchiveRef,rfc_message_id:a.binding.rfcMessageId,mime_sha256:a.binding.mimeSha256,binding_hash:expect.stringMatching(/^[a-f0-9]{64}$/)})
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_payloads p WHERE p.id=${literal(String(retained.mime_payload_snapshot_id))} AND p.company_id=${literal(f.companyId)} AND p.ediel_message_id=${literal(f.messageId)} AND p.encrypted_payload_ref=${literal(a.binding.mimeArchiveRef)} AND p.metadata->>'archived_mime_sha256'=${literal(a.binding.mimeSha256)}`)).toBe(1)
 expect(sql(`SELECT jsonb_build_object('n',count(*),'origin',min(origin),'actor',min(actor_user_id::text)) FROM gridex_ediel_transport.reconciliation_case_events WHERE case_id=${literal(row.caseId)}`)).toEqual({n:1,origin:'generic_observation',actor:f.actorUserId})
 const history=frozenCases(f),original=rawOriginal(f)
 await assertNoResend(f,id)
 expect(await prepareAndQueueProdatRecovery({companyId:f.companyId,actorUserId:f.actorUserId,originalMessageId:f.messageId,previousAttemptId:a.id,operationId:randomUUID()})).toMatchObject({status:'held',reason:'verified_transfer_loss_required'})
 expect(frozenCases(f)).toEqual(history);expect(rawOriginal(f)).toEqual(original);expect(businessCounts(f)).toEqual(before)
},120000)

it('real lease sweep while SMTP is pending opens one unresolved-entry case; late acceptance derives current outcome and preserves opening',async()=>{
 const f=await seed(),id=queueId(f)
 let release!:(value:{accepted:string[];rejected:string[];messageId:string;response:string})=>void,entered!:()=>void
 const entry=new Promise<void>(resolve=>{entered=resolve}),pending=new Promise<{accepted:string[];rejected:string[];messageId:string;response:string}>(resolve=>{release=resolve})
 smtp.mockImplementation(()=>{entered();return pending})
 const sending=sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})
 let opening:unknown
 try{
  await Promise.race([entry,sending.then(()=>{throw Error('provider_not_entered')})])
  expect(attempt(f)).toMatchObject({entered_at:expect.any(String),classification:null,observed_at:null})
  expireClaim(id);expect(await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})).toMatchObject({processed:0})
  const read=await readEdielTransportCopies(f);expect(read.reconciliationCases).toHaveLength(1)
  expect(read.reconciliationCases[0]).toMatchObject({reason:'entry_unresolved_after_lease',status:'needs_tracking',observedClassification:null,observedAt:null})
  opening=frozenCases(f);await assertNoResend(f,id)
 }finally{release({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic late acceptance'});await sending}
 expect(attempt(f)).toMatchObject({classification:'accepted',observed_at:expect.any(String)})
 expect((await readEdielTransportCopies(f)).reconciliationCases[0]).toMatchObject({reason:'entry_unresolved_after_lease',status:'outcome_observed',observedClassification:'accepted',observedAt:expect.any(String),authorizesResend:false,deliveryProven:false})
 expect(frozenCases(f)).toEqual(opening);expect(smtp).toHaveBeenCalledTimes(1)
},120000)

it('expired genuine pre-entry claim does not create a submission-unknown case',async()=>{
 const f=await seed(),id=queueId(f),workerId=`tr10-preentry-${randomUUID()}`
 expect(await claimEdielOutboxItem({actorUserId:f.actorUserId,outboxItemId:id,workerId})).toMatchObject({status:'sending'})
 expireClaim(id);expect(await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})).toMatchObject({processed:0})
 expect(caseCount(f)).toBe(0);expect((await readEdielTransportCopies(f)).reconciliationCases).toEqual([])
 expect(smtp).not.toHaveBeenCalled()
},120000)

it('known accepted journal with a public projection fault does not manufacture SMTP uncertainty',async()=>{
 const f=await seed(),id=queueId(f),constraint=`tr10_case_projection_${randomUUID().replaceAll('-','')}`
 smtp.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})
 sql(`ALTER TABLE public.ediel_messages ADD CONSTRAINT ${constraint} CHECK(id<>${literal(f.messageId)}::uuid OR message_sent_at IS NULL); SELECT to_jsonb(true)`)
 try{expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})).toMatchObject({status:'delivery_uncertain'});expect(attempt(f)).toMatchObject({classification:'accepted',observed_at:expect.any(String)});expect(caseCount(f)).toBe(0)}
 finally{sql(`ALTER TABLE public.ediel_messages DROP CONSTRAINT ${constraint}; SELECT to_jsonb(true)`)}
 expect((await readEdielTransportCopies(f)).reconciliationCases).toEqual([]);expect(smtp).toHaveBeenCalledTimes(1)
},120000)

it('publisher failure rolls back the actual observation and opening but keeps the committed no-resend entry; sweep can later publish',async()=>{
 const f=await seed(),id=queueId(f),constraint=`tr10_case_opening_${randomUUID().replaceAll('-','')}`
 sql(`ALTER TABLE gridex_ediel_transport.reconciliation_case_events ADD CONSTRAINT ${constraint} CHECK(company_id<>${literal(f.companyId)}::uuid) NOT VALID; SELECT to_jsonb(true)`)
 smtp.mockRejectedValue(Object.assign(Error('synthetic connection lost after DATA'),{code:'ETIMEDOUT',command:'DATA'}))
 try{
  expect(await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})).toMatchObject({status:'delivery_uncertain'})
  expect(attempt(f)).toMatchObject({entered_at:expect.any(String),observed_at:null,classification:null});expect(caseCount(f)).toBe(0)
  expect(sql(`SELECT to_jsonb(r.state) FROM gridex_ediel_transport.reservations r WHERE message_id=${literal(f.messageId)}`)).toBe('entered')
 }finally{sql(`ALTER TABLE gridex_ediel_transport.reconciliation_case_events DROP CONSTRAINT ${constraint}; SELECT to_jsonb(true)`)}
 expireClaim(id);await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})
 expect((await readEdielTransportCopies(f)).reconciliationCases[0]).toMatchObject({reason:'entry_unresolved_after_lease',status:'needs_tracking'})
 await assertNoResend(f,id)
},120000)

it('held archive still projects the immutable case, while revoked and foreign scoped readers get no case or bytes',async()=>{
 const f=await seed(),id=queueId(f)
 smtp.mockRejectedValue(Object.assign(Error('synthetic DATA outcome unknown'),{code:'ETIMEDOUT',command:'DATA'}))
 await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id})
 const cases=(await readEdielTransportCopies(f)).reconciliationCases,history=frozenCases(f),a=attempt(f),snapshot=sql<string>(`SELECT to_jsonb(mime_payload_snapshot_id) FROM gridex_ediel_transport.reconciliation_cases WHERE attempt_id=${literal(a.id)}`)
 // Declared archive-metadata fault, not fabricated archive bytes/acceptance.
 sql(`BEGIN; UPDATE public.ediel_message_payloads SET metadata=metadata-'archive_verified' WHERE id=${literal(snapshot)}; SELECT to_jsonb(true); COMMIT;`)
 expect(await readEdielTransportCopies(f)).toMatchObject({status:'held',reconciliationCases:cases})
 await expect(readEdielTransportCopies({...f,companyId:randomUUID()})).rejects.toThrow()
 sql(`UPDATE public.company_memberships SET status='revoked',is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(f.actorUserId)}; SELECT to_jsonb(true)`)
 await expect(readEdielTransportCopies(f)).rejects.toThrow()
 expect(frozenCases(f)).toEqual(history);expect(smtp).toHaveBeenCalledTimes(1)
},120000)

it('native private cases/opening logs have RLS, no application DML/helper authority and immutable owner history',async()=>{
 const f=await seed()
 smtp.mockRejectedValue(Object.assign(Error('synthetic DATA uncertainty for ACL probe'),{code:'ETIMEDOUT',command:'DATA'}))
 await sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:queueId(f)})
 expect(caseCount(f)).toBe(1);const frozen=frozenCases(f)
 for(const table of ['reconciliation_cases','reconciliation_case_events']){
  expect(sql(`SELECT jsonb_build_object('rls',relrowsecurity,'forced',relforcerowsecurity) FROM pg_class WHERE oid=${literal('gridex_ediel_transport.'+table)}::regclass`)).toEqual({rls:true,forced:true})
  for(const role of ['anon','authenticated','service_role']){
   expect(sql(`SELECT to_jsonb(has_table_privilege(${literal(role)},${literal('gridex_ediel_transport.'+table)},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))`)).toBe(false)
   expect(()=>sql(`BEGIN; SET LOCAL ROLE ${role}; SELECT count(*) FROM gridex_ediel_transport.${table}; ROLLBACK`)).toThrow(/permission denied/)
  }
  expect(()=>sql(`BEGIN; UPDATE gridex_ediel_transport.${table} SET environment='production' WHERE company_id=${literal(f.companyId)}; ROLLBACK`)).toThrow(/append_only/)
  expect(()=>sql(`BEGIN; DELETE FROM gridex_ediel_transport.${table} WHERE company_id=${literal(f.companyId)}; ROLLBACK`)).toThrow(/append_only/)
 }
 expect(()=>sql('BEGIN; TRUNCATE gridex_ediel_transport.reconciliation_cases,gridex_ediel_transport.reconciliation_case_events; ROLLBACK')).toThrow(/append_only/)
 expect(frozenCases(f)).toEqual(frozen)
 for(const role of ['anon','authenticated','service_role'])for(const signature of ['gridex_ediel_transport.open_reconciliation_case_v1(text,uuid,text,text,uuid)','gridex_ediel_transport.read_reconciliation_cases_v1(uuid,text,uuid)'])expect(sql(`SELECT to_jsonb(has_function_privilege(${literal(role)},${literal(signature)},'EXECUTE'))`)).toBe(false)
 expect(sql(`SELECT jsonb_build_object('definer',prosecdef,'config',proconfig,'service',has_function_privilege('service_role',oid,'EXECUTE'),'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE')) FROM pg_proc WHERE oid='public.gridex_ediel_transport_copy_v1(uuid,uuid,uuid)'::regprocedure`)).toEqual({definer:true,config:['search_path=""'],service:true,anon:false,authenticated:false})
},120000)

it('genuine H sealed unknown result opens before its result witness and preserves every protected source',async()=>{
 configureSmtp();const n=await rescission.nationalRescissionOperation(),f={companyId:n.companyId,actorUserId:n.actorUserId,messageId:n.original.id}
 sourceSession.client=null;smtp.mockReset();smtp.mockRejectedValue(Object.assign(Error('synthetic sealed DATA loss'),{code:'ETIMEDOUT',command:'DATA'}))
 const before=businessCounts(f),sources=protectedSources(f)
 await expect(sendEdielMessageViaSmtp((await getEdielMessageById(f.messageId))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow()
 const a=sql<{id:string;binding:Record<string,string>}>(`SELECT to_jsonb(a) FROM gridex_outbound_dispatch.attempts a WHERE message_id=${literal(f.messageId)}`)
 expect((await readEdielTransportCopies(f)).reconciliationCases).toEqual([expect.objectContaining({lane:'sealed_z08',attemptId:a.id,originalHash:a.binding.originalHash,mimeSha256:a.binding.mimeSha256,reason:'provider_outcome_unknown',status:'needs_tracking',observedClassification:'uncertain'})])
 expect(sql(`SELECT jsonb_build_object('entryWitness',(SELECT count(*) FROM gridex_outbound_dispatch.events e JOIN gridex_outbound_dispatch.witnesses w ON w.event_id=e.id WHERE e.attempt_id=${literal(a.id)} AND e.kind='provider_call_entered'),'resultWitness',(SELECT count(*) FROM gridex_outbound_dispatch.events e JOIN gridex_outbound_dispatch.witnesses w ON w.event_id=e.id WHERE e.attempt_id=${literal(a.id)} AND e.kind='provider_result'),'openings',(SELECT count(*) FROM gridex_ediel_transport.reconciliation_case_events e JOIN gridex_ediel_transport.reconciliation_cases c ON c.id=e.case_id WHERE c.attempt_id=${literal(a.id)} AND e.origin='sealed_result'))`)).toEqual({entryWitness:1,resultWitness:1,openings:1})
 expect(sql(`SELECT to_jsonb(c.opened_at<=w.available_at) FROM gridex_ediel_transport.reconciliation_cases c JOIN gridex_outbound_dispatch.events e ON e.attempt_id=c.attempt_id AND e.kind='provider_result' JOIN gridex_outbound_dispatch.witnesses w ON w.event_id=e.id WHERE c.attempt_id=${literal(a.id)}`)).toBe(true)
 const history=frozenCases(f),original=rawOriginal(f)
 await expect(sendEdielMessageViaSmtp((await getEdielMessageById(f.messageId))!,{actorUserId:f.actorUserId,smtpMimeMode:'nodemailer-attachment'})).rejects.toThrow()
 expect(frozenCases(f)).toEqual(history);expect(rawOriginal(f)).toEqual(original);expect(businessCounts(f)).toEqual(before);expect(protectedSources(f)).toEqual(sources);expect(smtp).toHaveBeenCalledTimes(1)
},180000)

it('actual sealed worker entry/witness supports crash tracking and a later witnessed outcome without mutating the opening',async()=>{
 configureSmtp();const n=await rescission.nationalRescissionOperation(),f={companyId:n.companyId,actorUserId:n.actorUserId,messageId:n.original.id}
 sql(`UPDATE public.ediel_route_profiles SET business_code='Z08' WHERE company_id=${literal(f.companyId)} AND communication_route_id=${literal(n.routeId)};
  UPDATE public.ediel_outbox SET status='superseded' WHERE company_id=${literal(f.companyId)} AND status='queued' AND ediel_message_id<>${literal(f.messageId)}; SELECT to_jsonb(true)`)
 sourceSession.client=null;smtp.mockReset();const id=queueId(f),sources=protectedSources(f)
 let release!:(value:{accepted:string[];rejected:string[];messageId:string;response:string})=>void,entered!:()=>void
 const entry=new Promise<void>(resolve=>{entered=resolve}),pending=new Promise<{accepted:string[];rejected:string[];messageId:string;response:string}>(resolve=>{release=resolve})
 smtp.mockImplementation(()=>{entered();return pending})
 const sending=sendOutboxItem({actorUserId:f.actorUserId,outboxItemId:id,smtpMimeMode:'nodemailer-attachment'})
 let opening:unknown
 try{
  await Promise.race([entry,sending.then(()=>{throw Error('sealed_provider_not_entered')})])
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_outbound_dispatch.events WHERE message_id=${literal(f.messageId)} AND kind='provider_result'`)).toBe(0)
  expireClaim(id);expect(await processEdielOutbox({actorUserId:f.actorUserId,companyId:f.companyId,environment:'test'})).toMatchObject({processed:0})
  expect((await readEdielTransportCopies(f)).reconciliationCases).toEqual([expect.objectContaining({lane:'sealed_z08',reason:'entry_unresolved_after_lease',status:'needs_tracking',observedClassification:null})])
  opening=frozenCases(f);await assertNoResend(f,id)
 }finally{release({accepted:['recipient@example.invalid'],rejected:[],messageId:randomUUID(),response:'250 synthetic late sealed acceptance'});await sending}
 expect((await readEdielTransportCopies(f)).reconciliationCases).toEqual([expect.objectContaining({lane:'sealed_z08',reason:'entry_unresolved_after_lease',status:'outcome_observed',observedClassification:'accepted',authorizesResend:false,deliveryProven:false})])
 expect(frozenCases(f)).toEqual(opening);expect(protectedSources(f)).toEqual(sources);expect(smtp).toHaveBeenCalledTimes(1)
},180000)
