import {createHash,createHmac,randomUUID} from 'node:crypto'
import {z} from 'zod'
import {INVOICE_FILE_CLASSES} from '@/lib/ediel/retention/invoiceFiles.catalog'
import {createCustomerRecordRetentionNativeUser} from './helpers/ediel-customer-record-retention-native-fixture'
import {type SupabaseClient} from '@supabase/supabase-js'
import {NextRequest} from 'next/server'
import {afterEach,expect,it,vi} from 'vitest'
const current=vi.hoisted(()=>({client:null as SupabaseClient|null,company:''}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{if(!current.client)throw Error('actual_local_gotrue_client_required');return current.client}}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:current.company})})}))
import {supabaseService} from '@/lib/supabase/service'
import {POST} from '@/app/api/ediel/invoice-file-retention/route'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {seedInvoiceFileRetentionNativeFixture} from './helpers/ediel-invoice-file-retention-native-fixture'
const http=(body:unknown)=>POST(new NextRequest('http://localhost/api/ediel/invoice-file-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))
afterEach(()=>{current.client=null;current.company=''})
it('actual signed PDF/Storage and GoTrue/current archived grants feed a server-owned exact source capture, while absent native billing authority remains held without policy or deletion effects',async()=>{
 const f=await seedInvoiceFileRetentionNativeFixture();current.client=f.writer.client;current.company=f.companyId
 const chosen={retentionClass:'customer_invoice_document_pdf_bytes',targetId:f.documentId}
 const captured=await http({action:'capture',...chosen});expect(captured.status,await captured.clone().text()).toBe(200);expect((await captured.json()).data).toMatchObject({sourceHash:f.sourceHash,byteLength:f.byteLength,authority:'none'})
 const held=await http({action:'basis',...chosen});expect(held.status).toBe(403)
 expect(sql(`SELECT jsonb_build_object('sources',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_sources WHERE company_id=${literal(f.companyId)}),'decisions',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_decisions WHERE company_id=${literal(f.companyId)}),'tombstones',(SELECT count(*) FROM gridex_ediel_retention.invoice_file_tombstones WHERE company_id=${literal(f.companyId)}),'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}))`)).toEqual({sources:1,decisions:0,tombstones:0,originals:0})
 current.client=f.readonly.client;expect((await http({action:'source',...chosen})).status).toBe(200);expect((await http({action:'capture',...chosen})).status).toBe(403)
 current.client=f.foreign.client;current.company=f.foreignCompanyId;expect((await http({action:'source',...chosen})).status).toBe(403)
 const bytes=await supabaseService.storage.from('billing-exports').download(f.path);expect(bytes.error).toBeNull();expect(Buffer.from(await bytes.data!.arrayBuffer())).toEqual(f.pdf)
 for(const role of ['anon','authenticated','service_role'])expect(sql(`SELECT to_jsonb(has_table_privilege(${literal(role)},'gridex_ediel_retention.invoice_file_sources','SELECT'))`)).toBe(false)
},240000)
it('current operative membership does not bypass an explicit retention-class DENY and hostile company/body selectors write no source rows',async()=>{
 const f=await seedInvoiceFileRetentionNativeFixture();current.client=f.writer.client;current.company=f.companyId;const chosen={retentionClass:'customer_invoice_document_pdf_bytes',targetId:f.documentId}
 expect((await http({action:'capture',...chosen,companyId:f.foreignCompanyId})).status).toBe(400)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES(${literal(f.writer.id)},${literal(f.companyId)},'ediel.retention.invoice_copy_evidence','deny',true)`)
 expect((await http({action:'capture',...chosen})).status).toBe(403)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.invoice_file_sources WHERE company_id=${literal(f.companyId)}`)).toBe(0)
},240000)

// Installed retention/HTTP/GoTrue/Storage integration over explicit SYNTHETIC
// billing/pricing/issuer/policy GIVEN. This is not a billing, UTILTS, provider,
// lawful production retention or complete DB-05 producer proof.
const invoicePdfHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
const invoicePdfUuid=z.string().uuid(),invoicePdfDigest=z.string().regex(/^[a-f0-9]{64}$/)
const invoicePdfCapture=z.object({sourceId:invoicePdfUuid,sourceHash:invoicePdfDigest,byteLength:z.number().int().positive(),retentionClass:z.enum(INVOICE_FILE_CLASSES),targetId:invoicePdfUuid,authority:z.literal('none')})
const invoicePdfBasis=z.object({retentionClass:z.enum(INVOICE_FILE_CLASSES),targetId:invoicePdfUuid,sourceId:invoicePdfUuid,sourceHash:invoicePdfDigest,targetHash:invoicePdfDigest,scopeHash:invoicePdfDigest,storageBucket:z.literal('billing-exports'),storagePath:z.string(),byteLength:z.number().int().positive(),periodStart:z.string(),periodEnd:z.string(),allIncludedScopesClosed:z.literal(true),complete:z.literal(false),authority:z.literal('none')})
const invoicePdfSubmitted=z.object({status:z.literal('submitted'),decisionId:invoicePdfUuid,sourceId:invoicePdfUuid,documentHash:invoicePdfDigest,issuerQualified:z.literal(true)})
const invoicePdfCompleted=z.object({status:z.literal('purged'),sourceId:invoicePdfUuid,sourceHash:invoicePdfDigest,byteLength:z.number().int().positive(),bytesAvailable:z.literal(false),replay:z.boolean()})
async function invoicePdfHttp<T>(body:unknown,schema:z.ZodType<T>){
 const response=await http(body)
 expect(response.status,await response.clone().text()).toBe(200)
 return schema.parse(z.object({data:z.unknown()}).parse(await response.json()).data)
}
type InvoicePdfFixture=Awaited<ReturnType<typeof seedInvoiceFileRetentionNativeFixture>>

async function seedQualifiedSyntheticInvoicePdfGiven(){
 const f=await seedInvoiceFileRetentionNativeFixture()
 const reviewer=await createCustomerRecordRetentionNativeUser(f.companyId,['ediel.retention.invoice_copy_evidence','ediel.retention.read','ediel.retention.review'])
 const underlayId=randomUUID(),pricingRunId=randomUUID(),exportRunId=randomUUID(),exportItemId=randomUUID(),exportDocumentId=randomUUID(),issuerId=randomUUID()
 const sourceBasis={kind:'SYNTHETIC_STORAGE_RETENTION_GIVEN',companyId:f.companyId,customerId:f.customerId,periodStart:'2020-01-01',periodEnd:'2020-02-01',totalKwh:100,provenance:'Explicit data GIVEN; no canonical billing/UTILTS/pricing/provider execution claimed'}
 // Real installed INSERT/UPDATE/FK/immutable/finance guards all remain enabled.
 // The export INSERT owner requires an actual own locked pricing_runs row.
 // Inserting that labelled fixture row is not execution of a pricing producer.
 sql(`BEGIN;
 INSERT INTO public.billing_underlays(id,company_id,customer_id,underlay_year,underlay_month,billing_period_start,billing_period_end,status,readiness_status,total_kwh,total_sek_ex_vat,currency,source_system,payload,pricing_snapshot,metadata,created_by)
 VALUES(${literal(underlayId)},${literal(f.companyId)},${literal(f.customerId)},2020,1,'2020-01-01','2020-02-01','validated','ready',100,100,'SEK','SYNTHETIC_STORAGE_RETENTION_GIVEN',${literal(sourceBasis)}::jsonb,'{}',${literal({synthetic:true,purpose:'invoice PDF physical-mechanism integration only'})}::jsonb,${literal(f.writer.id)});
 INSERT INTO gridex_billing_source.underlay_bindings(underlay_id,company_id,source_basis,source_basis_hash,exact_total_kwh,actor_user_id)
 VALUES(${literal(underlayId)},${literal(f.companyId)},${literal(sourceBasis)}::jsonb,encode(sha256(convert_to((${literal(sourceBasis)}::jsonb)::text,'UTF8')),'hex'),100,${literal(f.writer.id)});
 INSERT INTO public.pricing_runs(id,company_id,billing_underlay_id,customer_id,billing_period_start,billing_period_end,status,total_ex_vat,vat_amount,total_inc_vat,locked_at,metadata,created_by)
 VALUES(${literal(pricingRunId)},${literal(f.companyId)},${literal(underlayId)},${literal(f.customerId)},'2020-01-01','2020-02-01','locked',100,25,125,clock_timestamp(),${literal({synthetic:true,purpose:'locked pricing data GIVEN, not pricing-producer proof'})}::jsonb,${literal(f.writer.id)});
 INSERT INTO public.invoice_export_runs(id,company_id,provider,environment,billing_month,financing_mode,status,total_items,sent_items,total_ex_vat,vat_amount,total_inc_vat,requested_by,finished_at,metadata)
 VALUES(${literal(exportRunId)},${literal(f.companyId)},'manual','test','2020-01','manual','sent',1,1,100,25,125,${literal(f.writer.id)},clock_timestamp(),${literal({synthetic:true,providerExecuted:false})}::jsonb);
 INSERT INTO public.invoice_export_items(id,company_id,export_run_id,customer_id,billing_underlay_id,pricing_run_id,provider,environment,financing_mode,status,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,currency,period_start,period_end,metadata)
 VALUES(${literal(exportItemId)},${literal(f.companyId)},${literal(exportRunId)},${literal(f.customerId)},${literal(underlayId)},${literal(pricingRunId)},'manual','test','manual','credited',100,25,125,100,'SEK','2020-01-01','2020-02-01',${literal({synthetic:true,providerExecuted:false})}::jsonb);
 INSERT INTO public.invoice_documents(id,company_id,invoice_export_item_id,document_type,storage_path,provider_payload)
 VALUES(${literal(exportDocumentId)},${literal(f.companyId)},${literal(exportItemId)},'invoice_pdf',${literal('billing-exports/'+f.path)},${literal({synthetic:true,providerExecuted:false})}::jsonb);
 UPDATE public.customer_invoices SET billing_underlay_id=${literal(underlayId)},status='paid',amount_ex_vat=100,vat_amount=25,amount_inc_vat=125,total_kwh=100,currency='SEK' WHERE id=${literal(f.invoiceId)} AND company_id=${literal(f.companyId)};
 COMMIT;`)
 // A real HMAC checked by the installed owner, over synthetic competence only.
 const key=Buffer.from('SYNTHETIC invoice PDF competence only '+randomUUID()),legal=Buffer.from('SYNTHETIC invoice PDF CODE policy competence; no actual legal issuer or fiscal year asserted')
 sql(`BEGIN;SET LOCAL ROLE gridex_ediel_retention_owner;
 INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to)
 VALUES(${literal(issuerId)},${literal(f.companyId)},'SYNTHETIC invoice PDF competence only',decode(${literal(legal.toString('hex'))},'hex'),${literal(invoicePdfHash(legal))},decode(${literal(key.toString('hex'))},'hex'),clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day');COMMIT;`)
 const siblingPath=`companies/${f.companyId}/invoices/sibling-${randomUUID()}.pdf`
 const siblingUpload=await supabaseService.storage.from('billing-exports').upload(siblingPath,f.pdf,{contentType:'application/pdf',upsert:false})
 expect(siblingUpload.error).toBeNull()
 const original=sql<{path:string}>(`SELECT jsonb_build_object('path',storage_path) FROM public.customer_contract_documents WHERE company_id=${literal(f.companyId)} AND customer_contract_id=${literal(f.contractId)} AND document_sha256=${literal(f.documentSha256)} ORDER BY created_at LIMIT 1`)
 const targets=[{retentionClass:'customer_invoice_document_pdf_bytes',targetId:f.documentId},{retentionClass:'invoice_export_document_pdf_bytes',targetId:exportDocumentId},{retentionClass:'customer_invoice_pdf_bytes',targetId:f.invoiceId}] satisfies {retentionClass:typeof INVOICE_FILE_CLASSES[number];targetId:string}[]
 const policy=(basis:z.infer<typeof invoicePdfBasis>,document:Buffer)=>{
  // Actual database clock, not an assumed wall clock or legal duration rule.
  const times=sql<{issuedAt:string;expiresAt:string;retainUntil:string;journalRetainUntil:string}>(`SELECT jsonb_build_object('issuedAt',clock_timestamp()-interval '1 minute','expiresAt',clock_timestamp()+interval '1 hour','retainUntil',clock_timestamp()-interval '1 minute','journalRetainUntil',clock_timestamp()+interval '1 hour')`)
  const payload=Buffer.from(JSON.stringify({format:'ediel_invoice_file_retention_policy_v1',...basis,companyId:f.companyId,operation:'delete_storage_pdf',documentHash:invoicePdfHash(document),issuerLegalReference:'SYNTHETIC invoice PDF competence only',legalBasisReference:'SYNTHETIC exact copy CODE workflow',journalPurposeReference:'SYNTHETIC finite continuity of exact source hash',accessRevocationRequired:true,...times}))
  return {issuerId,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}
 }
 return {...f,reviewer,underlayId,pricingRunId,exportRunId,exportItemId,exportDocumentId,siblingPath,originalPath:original.path,targets,policy}
}

function invoicePdfCore(f:Awaited<ReturnType<typeof seedQualifiedSyntheticInvoicePdfGiven>>){
 // Full rows, including locators, amounts, periods, statuses and immutable hashes.
 // All setup precedes capture, so later target/scope hashes must remain exact.
 return sql<Record<string,unknown>>(`SELECT jsonb_build_object(
 'company',(SELECT to_jsonb(x) FROM public.companies x WHERE id=${literal(f.companyId)}),
 'customer',(SELECT to_jsonb(x) FROM public.customers x WHERE id=${literal(f.customerId)} AND company_id=${literal(f.companyId)}),
 'contract',(SELECT to_jsonb(x) FROM public.customer_contracts x WHERE id=${literal(f.contractId)} AND company_id=${literal(f.companyId)}),
 'contractDocuments',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_contract_documents x WHERE company_id=${literal(f.companyId)} AND customer_contract_id=${literal(f.contractId)}),
 'invoice',(SELECT to_jsonb(x) FROM public.customer_invoices x WHERE id=${literal(f.invoiceId)} AND company_id=${literal(f.companyId)}),
 'customerDocument',(SELECT to_jsonb(x) FROM public.customer_invoice_documents x WHERE id=${literal(f.documentId)} AND company_id=${literal(f.companyId)}),
 'underlay',(SELECT to_jsonb(x) FROM public.billing_underlays x WHERE id=${literal(f.underlayId)} AND company_id=${literal(f.companyId)}),
 'binding',(SELECT to_jsonb(x) FROM gridex_billing_source.underlay_bindings x WHERE underlay_id=${literal(f.underlayId)} AND company_id=${literal(f.companyId)}),
 'pricing',(SELECT to_jsonb(x) FROM public.pricing_runs x WHERE id=${literal(f.pricingRunId)} AND company_id=${literal(f.companyId)}),
 'exportRun',(SELECT to_jsonb(x) FROM public.invoice_export_runs x WHERE id=${literal(f.exportRunId)} AND company_id=${literal(f.companyId)}),
 'exportItem',(SELECT to_jsonb(x) FROM public.invoice_export_items x WHERE id=${literal(f.exportItemId)} AND company_id=${literal(f.companyId)}),
 'exportDocument',(SELECT to_jsonb(x) FROM public.invoice_documents x WHERE id=${literal(f.exportDocumentId)} AND company_id=${literal(f.companyId)}),
 'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.invoice_export_attempts x WHERE company_id=${literal(f.companyId)}),
 'supplies',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.customer_supply_periods x WHERE company_id=${literal(f.companyId)} AND customer_id=${literal(f.customerId)}),
 'edielMessages',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM public.ediel_messages x WHERE company_id=${literal(f.companyId)}))`)
}
function invoicePdfEffects(f:InvoicePdfFixture){
 return sql<{tombstones:{sourceId:string;decisionId:string;actorId:string}[];events:{sourceId:string;kind:string;actorId:string}[]}>(`SELECT jsonb_build_object(
 'tombstones',(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',source_id,'decisionId',decision_id,'actorId',actor_user_id) ORDER BY source_id),'[]') FROM gridex_ediel_retention.invoice_file_tombstones WHERE company_id=${literal(f.companyId)}),
 'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',e.source_id,'kind',e.kind,'actorId',e.actor_user_id) ORDER BY e.source_id,e.kind),'[]') FROM gridex_ediel_retention.invoice_file_events e JOIN gridex_ediel_retention.invoice_file_sources s ON s.id=e.source_id WHERE s.company_id=${literal(f.companyId)}))`)
}
async function invoicePdfExactBytes(path:string,expected:Buffer,bucket='billing-exports'){
 const read=await supabaseService.storage.from(bucket).download(path)
 expect(read.error).toBeNull();expect(read.data).not.toBeNull()
 const bytes=Buffer.from(await read.data!.arrayBuffer())
 expect(bytes).toEqual(expected);expect(invoicePdfHash(bytes)).toBe(invoicePdfHash(expected))
}
async function invoicePdfPhysical404(path:string){
 const read=await supabaseService.storage.from('billing-exports').download(path)
 expect(read.data).toBeNull();expect(read.error).not.toBeNull()
 expect(read.error!==null&&'statusCode' in read.error&&String(read.error.statusCode)).toBe('404')
}

it('three independently qualified synthetic invoice-PDF class decisions require all shared reviews and real HTTP Storage absence before finish while financial core stays exact',async()=>{
 const f=await seedQualifiedSyntheticInvoicePdfGiven();current.client=f.writer.client;current.company=f.companyId
 const sources:z.infer<typeof invoicePdfCapture>[]=[],decisions:z.infer<typeof invoicePdfSubmitted>[]=[]
 for(const chosen of f.targets){
  const source=await invoicePdfHttp({action:'capture',...chosen},invoicePdfCapture)
  expect(source).toMatchObject({...chosen,sourceHash:f.sourceHash,byteLength:f.byteLength,authority:'none'});sources.push(source)
 }
 expect(new Set(sources.map(s=>s.sourceId)).size).toBe(3)
 for(const [index,chosen] of f.targets.entries()){
  const basis=await invoicePdfHttp({action:'basis',...chosen},invoicePdfBasis)
  expect(basis).toMatchObject({...chosen,sourceId:sources[index].sourceId,sourceHash:f.sourceHash,byteLength:f.byteLength,storageBucket:'billing-exports',storagePath:f.path,allIncludedScopesClosed:true})
  const document=Buffer.from('SYNTHETIC independent exact invoice PDF CODE policy '+chosen.retentionClass)
  const decision=await invoicePdfHttp({action:'submit',...chosen,documentBase64:document.toString('base64'),issuerReceipt:f.policy(basis,document)},invoicePdfSubmitted)
  expect(decision).toMatchObject({sourceId:sources[index].sourceId,documentHash:invoicePdfHash(document),issuerQualified:true});decisions.push(decision)
 }
 expect(new Set(decisions.map(d=>d.decisionId)).size).toBe(3)
 expect(new Set(decisions.map(d=>d.documentHash)).size).toBe(3)
 const core=invoicePdfCore(f)
 for(const name of ['company','customer','contract','invoice','customerDocument','underlay','binding','pricing','exportRun','exportItem','exportDocument'])expect(core[name],name).not.toBeNull()
 expect(core.invoice).toMatchObject({amount_ex_vat:100,vat_amount:25,amount_inc_vat:125,currency:'SEK',status:'paid',billing_underlay_id:f.underlayId})
 expect(core.pricing).toMatchObject({status:'locked',total_ex_vat:100,vat_amount:25,total_inc_vat:125})
 expect(core.exportItem).toMatchObject({status:'credited',pricing_run_id:f.pricingRunId,amount_ex_vat:100,vat_amount:25,amount_inc_vat:125})
 expect(core.attempts).toEqual([]);expect(core.supplies).toEqual([])
 const review=async(decisionId:string)=>{
  current.client=f.reviewer.client
  const result=await invoicePdfHttp({action:'review',decisionId,outcome:'approve',reason:'SYNTHETIC independent exact-copy CODE review'},z.object({status:z.literal('approved'),decisionId:invoicePdfUuid,reviewId:invoicePdfUuid}))
  expect(result.decisionId).toBe(decisionId);current.client=f.writer.client
 }
 await review(decisions[0].decisionId);await review(decisions[1].decisionId)
 const args={p_company_id:f.companyId,p_actor_user_id:f.writer.id,p_decision_id:decisions[0].decisionId}
 const unreviewed=await f.writer.client.rpc('ediel_begin_invoice_file_purge_v1',args)
 expect(unreviewed.data).toBeNull();expect(unreviewed.error?.message).toContain('invoice_file_each_copy_current_legal_review_required')
 expect(invoicePdfEffects(f)).toEqual({tombstones:[],events:[]});expect(invoicePdfCore(f)).toEqual(core)
 await invoicePdfExactBytes(f.path,f.pdf)
 await review(decisions[2].decisionId)
 const begin=await f.writer.client.rpc('ediel_begin_invoice_file_purge_v1',args)
 expect(begin.error).toBeNull();expect(begin.data).toMatchObject({status:'storage_purge_pending',sourceId:sources[0].sourceId,sourceHash:f.sourceHash,byteLength:f.byteLength,storageBucket:'billing-exports',storagePath:f.path})
 const expectedTombstones=decisions.map(d=>({sourceId:d.sourceId,decisionId:d.decisionId,actorId:f.writer.id})).sort((a,b)=>a.sourceId.localeCompare(b.sourceId))
 expect(invoicePdfEffects(f)).toEqual({tombstones:expectedTombstones,events:[]})
 await invoicePdfExactBytes(f.path,f.pdf)
 const premature=await f.writer.client.rpc('ediel_finish_invoice_file_purge_v1',args)
 expect(premature.data).toBeNull();expect(premature.error?.message).toContain('invoice_file_native_storage_object_still_present')
 expect(invoicePdfEffects(f)).toEqual({tombstones:expectedTombstones,events:[]});expect(invoicePdfCore(f)).toEqual(core)
 await invoicePdfExactBytes(f.path,f.pdf)

 // Observe/forward the genuine builder. No fabricated RPC data, Storage mock,
 // DELETE metadata shortcut, auth spoof or privilege/owner substitution.
 // The awaited gate must see real HTTP404 before the original finish executes.
 let preFinishAbsenceObservations=0
 const rpc=f.writer.client.rpc.bind(f.writer.client)
 const observer=vi.spyOn(f.writer.client,'rpc').mockImplementation((...params)=>{
  const command=rpc(...params)
  if(params[0]!=='ediel_finish_invoice_file_purge_v1')return command
  const observed:typeof command.then=(fulfilled,rejected)=>invoicePdfPhysical404(f.path).then(()=>{
   preFinishAbsenceObservations+=1
   return command.then()
  }).then(fulfilled,rejected)
  return new Proxy(command,{get(target,key,receiver){return key==='then'?observed:Reflect.get(target,key,receiver)}})
 })
 try{
  const purged=await invoicePdfHttp({action:'purge',decisionId:decisions[0].decisionId},invoicePdfCompleted)
  expect(purged).toEqual({status:'purged',sourceId:sources[0].sourceId,sourceHash:f.sourceHash,byteLength:f.byteLength,bytesAvailable:false,replay:false})
  expect(preFinishAbsenceObservations).toBe(1)
  await invoicePdfPhysical404(f.path)
  expect(sql(`SELECT to_jsonb(count(*)) FROM storage.objects WHERE bucket_id='billing-exports' AND name=${literal(f.path)}`)).toBe(0)
  const expectedEvents=sources.flatMap(s=>['storage_delete_authorized','storage_object_absent'].map(kind=>({sourceId:s.sourceId,kind,actorId:f.writer.id}))).sort((a,b)=>a.sourceId.localeCompare(b.sourceId)||a.kind.localeCompare(b.kind))
  const completedEffects={tombstones:expectedTombstones,events:expectedEvents}
  expect(invoicePdfEffects(f)).toEqual(completedEffects)
  for(const [index,decision] of decisions.entries()){
   if(index>0){
    const replay=await invoicePdfHttp({action:'purge',decisionId:decision.decisionId},invoicePdfCompleted)
    expect(replay).toEqual({status:'purged',sourceId:sources[index].sourceId,sourceHash:f.sourceHash,byteLength:f.byteLength,bytesAvailable:false,replay:true})
   }
   const unavailable=await supabaseService.rpc('ediel_require_invoice_file_copy_available_v1',{p_company_id:f.companyId,p_retention_class:f.targets[index].retentionClass,p_target_id:f.targets[index].targetId})
   expect(unavailable.data).toBeNull();expect(unavailable.error).toMatchObject({code:'23514',message:'invoice_file_copy_retention_tombstoned'})
   const source=await invoicePdfHttp({action:'source',...f.targets[index]},z.object({sourceId:invoicePdfUuid,sourceHash:invoicePdfDigest,byteLength:z.number().int().positive(),bytesAvailable:z.literal(false)}))
   expect(source).toMatchObject({sourceId:sources[index].sourceId,sourceHash:f.sourceHash,byteLength:f.byteLength,bytesAvailable:false})
  }
  expect(preFinishAbsenceObservations).toBe(1);expect(invoicePdfEffects(f)).toEqual(completedEffects)
  expect(invoicePdfCore(f)).toEqual(core)
  await invoicePdfExactBytes(f.siblingPath,f.pdf)
  await invoicePdfExactBytes(f.originalPath,f.pdf,'customer-contract-documents')
 }finally{observer.mockRestore()}
},360000)
