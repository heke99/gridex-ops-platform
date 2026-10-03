import {randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {expect,it,vi} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
vi.mock('server-only',()=>({}))
const provider=vi.hoisted(()=>vi.fn())
const sourceSession=vi.hoisted(()=>({client:null as SupabaseClient|null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{if(!sourceSession.client)throw Error('native_actual_source_session_required');return sourceSession.client}}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:provider})}}))
vi.mock('@/lib/ediel/core/messageBuilder',async importOriginal=>(await import('../__tests__/helpers/p16bHold')).captureP16bPreflight(importOriginal))
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {nationalRescissionNativeChain} from './helpers/nationalRescissionNative'
import {closureFixture} from '../__tests__/helpers/closureWireFixtures'
import {supabaseService} from '@/lib/supabase/service'
import {captureCorrectionContext} from '@/lib/ediel/sources/correctionContextCapture'
import {archiveSignedCustomerContractPdf} from '@/lib/customer-contracts/documents'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'

const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const {nationalRescissionOperation}=nationalRescissionNativeChain({provider,sourceSession})

/** The outbound dispatch fence only admits a genuine national Z08/Z25 original,
 * which the atomic supply-rescission owner alone can create (20261001115000).
 * The correction source and signed document are seeded in that same tenant, for
 * the same physical object and legal parties, so one combined cutoff covers both. */
it('one cutoff observes outbound entry and document attempt after a concurrent owner commit',async()=>{
 const r=await nationalRescissionOperation(),messageId=r.original.id
 const sourceMessageId=randomUUID()
 // An inbound grid-owner Z05 closure for the rescinded object (grid -> supplier).
 const wire=closureFixture({reason:'Z24',document:`D${sourceMessageId.replaceAll('-','').slice(0,16)}`}).wire
  .replaceAll('735123456789012345',r.external).replace('12345:14+54321:14',`${r.receiver}:14+${r.sender}:14`)
  .replace('NAD+FR+12345',`NAD+FR+${r.receiver}`).replace('NAD+DO+54321',`NAD+DO+${r.sender}`)
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,message_received_at,application_reference,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
  SELECT ${literal(sourceMessageId)},${literal(r.companyId)},'test','inbound','edifact','PRODAT','Z05','received',${literal(wire)},'{"subtype":"C"}',clock_timestamp(),'23-DDQ-PRODAT',${literal(r.receiver)},${literal(r.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
  FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z05:C:26.A:r3' AND profile.is_enabled;
  INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(r.actorUserId)},${literal(r.companyId)},id,key FROM public.permissions p WHERE key IN('documents.read','customers.read','communication.send','communication.read')
   AND NOT EXISTS(SELECT FROM public.user_permissions u WHERE u.user_id=${literal(r.actorUserId)} AND u.company_id=${literal(r.companyId)} AND u.permission_key=p.key);`)
 const f={companyId:r.companyId,actorUserId:r.actorUserId,sourceMessageId,environment:'test' as const}
 expect(await captureCorrectionContext(f)).toMatchObject({status:'recorded'})
 const document=await archiveSignedCustomerContractPdf({companyId:r.companyId,customerContractId:r.contractId,pdfBuffer:Buffer.from('%PDF-1.4\nsynthetic signed context\n%%EOF'),generationSnapshot:{schema:'gridex_signed_contract_document_v1',synthetic:true}})
 // The actual SMTP transport prepares the dispatch attempt with every own plan
 // and evidence binding; its provider entry is captured (not performed) so the
 // entry can commit concurrently with the document attempt below.
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 provider.mockReset();provider.mockResolvedValue({accepted:['recipient@example.invalid'],rejected:[],messageId:'synthetic-never-called',response:'250 synthetic'})
 const originalRpc=supabaseService.rpc.bind(supabaseService);let identity:Record<string,unknown>|null=null
 const spy=vi.spyOn(supabaseService,'rpc').mockImplementation(((name:string,args:{p_input?:Record<string,unknown>})=>{
  if(name==='gridex_outbound_dispatch_v1'&&args?.p_input?.action==='enter'){identity=args.p_input;throw Error('native_entry_captured')}
  return (originalRpc as unknown as (n:string,a:unknown)=>unknown)(name,args)}) as never)
 try{await sendEdielMessageViaSmtp((await getEdielMessageById(messageId))!,{actorUserId:r.actorUserId,smtpMimeMode:'nodemailer-attachment'}).catch(()=>null)}finally{spy.mockRestore()}
 expect(identity).toMatchObject({action:'enter',messageId,companyId:r.companyId});expect(provider).not.toHaveBeenCalled()
 const lock=1_000_000+Math.floor(Math.random()*1_000_000)
 const writer=promisify(execFile)('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1','-c',`BEGIN;
  SET LOCAL ROLE service_role;
  SELECT public.gridex_outbound_dispatch_v1(${literal(identity)}::jsonb);
  SELECT public.gridex_begin_document_reference_v1(${literal(f.companyId)},'test',
   ${literal(f.sourceMessageId)},${literal(document.id)},${literal(f.actorUserId)});
  SELECT pg_advisory_xact_lock(${lock}); SELECT pg_sleep(5); COMMIT;`],{timeout:12000})
 let acquired=false
 for(let i=0;i<40;i++){
  if(sql(`SELECT to_jsonb(EXISTS(SELECT FROM pg_locks WHERE locktype='advisory'
   AND objid=${lock} AND granted))`)){acquired=true;break}
  await new Promise(resolve=>setTimeout(resolve,50))
 }
 expect(acquired).toBe(true)
 const cutoff=sql<string>('SELECT to_jsonb(clock_timestamp())')
 const open=()=>sql<{snapshotId:string;readsetText:string;readsetHash:string}>(`SET ROLE service_role;
  SELECT public.gridex_correction_combined_snapshot_v1(${literal(f.companyId)},'test',
   ${literal(f.sourceMessageId)},${literal(cutoff)})`)
 type Body={visibilitySnapshot:string;outbound:{visibilitySnapshot:string;originals:{messageId:string;
  events:{kind:string}[]}[]};document:{visibilitySnapshot:string;attempts:{documentId:string}[]}}
 const before=open(),prior=JSON.parse(before.readsetText) as Body
 expect(prior.outbound.originals.map(o=>o.messageId)).toContain(messageId)
 expect(prior.outbound.originals.find(o=>o.messageId===messageId)?.events
  .some(e=>e.kind==='provider_call_entered')).toBe(false)
 expect(prior.document.attempts).toEqual([])
 await writer
 const after=open(),later=JSON.parse(after.readsetText) as Body
 expect(later.outbound.originals.find(o=>o.messageId===messageId)?.events)
  .toContainEqual(expect.objectContaining({kind:'provider_call_entered'}))
 expect(later.document.attempts).toContainEqual(expect.objectContaining({documentId:document.id}))
 expect(later.outbound.visibilitySnapshot).toBe(later.visibilitySnapshot)
 expect(later.document.visibilitySnapshot).toBe(later.visibilitySnapshot)
 expect(JSON.parse(before.readsetText)).toEqual(prior)
 expect(sql(`SELECT to_jsonb(readset_text=${literal(before.readsetText)}
  AND readset_hash=${literal(before.readsetHash)})
  FROM gridex_correction_process.combined_snapshots WHERE id=${literal(before.snapshotId)}`)).toBe(true)
})
