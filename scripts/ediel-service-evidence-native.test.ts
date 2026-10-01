import {execFileSync,spawn} from 'node:child_process'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
import {coordinateEdielServicePermission} from '@/lib/ediel/services/commands'
import {projectEdielSeriesToBeneficiary} from '@/lib/ediel/services/projection'
import {executeEdielServiceAdministration} from '@/lib/ediel/services/administration'
import {archiveEdielServiceEvidence,reviewEdielServiceEvidence,readEdielServiceEvidenceBytes} from '@/lib/ediel/services/evidenceReview'
import {reviewPeriodicDgiE66Reason} from '@/lib/ediel/services/periodicReason'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {getEdielMessageById} from '@/lib/ediel/db'
import {renderProdat} from '@/lib/ediel/prodatEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {resolveCanonicalRuntimeDecisionWithRegistry,readCanonicalPeriodicReasonAuthority,readCanonicalUtiltsIssuerIdentityAuthority} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {captureFreshEdielSourceRulePackEvidence} from '@/lib/ediel/core/sourceRulePackEvidence'
import {applyPermissionMarketSource} from '@/lib/ediel/permissions/permissionMarketTransition'
import {initialCanonicalUtiltsDecision,recordFinalCanonicalUtiltsDecision} from '@/lib/ediel/flows/utiltsCanonicalValidation'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {qualifyReceivedUtiltsStructure} from '@/lib/ediel/utilts/qualifyReceivedStructure'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
import {buildUtiltsTransactionPersistencePayload,persistUtiltsTransactionResults,finalizeUtiltsTransactionAck} from '@/lib/ediel/utilts/transactionPersistence'
import {assertUtiltsPositiveAckAuthorityForSend} from '@/lib/ediel/utilts/positiveAckAuthority'
import {buildAperakDraft,buildUtiltsErrDraft} from '@/lib/ediel/ack'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import {utiltsErrGatewayFixture} from '../__tests__/helpers/utiltsErrGatewayFixture'
import {utiltsNativeSourceFixture} from '../__tests__/helpers/utiltsNativeSourceFixture'
import type {EdielMessageRow} from '@/lib/ediel/types'

// All domain commands, private native owners, canonical registry, raw parsers,
// storage, permission transitions and ACK RPCs are real. The ONLY replacement
// is external SMTP: no socket/customer/counterparty traffic is permitted.
// Unseeded external issuer keys and representation facts are explicitly
// synthetic disposable-test inputs, never actual legal or national approval.
const external=vi.hoisted(()=>({send:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:external.send})}}))
const DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const lit=(v:unknown)=>v===null?'NULL':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'"
function sql<T>(statement:string):T{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('synthetic_local_native_only')
 const out=execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',timeout:10000,maxBuffer:4_000_000}).trim()
 return out?JSON.parse(out) as T:undefined as T
}
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('EDIEL_SMTP_FROM','esco-native@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','esco-native@example.invalid');vi.stubEnv('EDIEL_SMTP_PASS','SYNTHETIC ONLY');vi.stubEnv('EDIEL_SMTP_HOST','smtp.example.invalid');vi.stubEnv('EDIEL_SMTP_PORT','587');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato');vi.stubEnv('EDIEL_APP_DKIM_ENABLED','false')
 external.send.mockResolvedValue({accepted:['dso-native@example.invalid'],rejected:[],messageId:'synthetic-provider-receipt',response:'250 synthetic external acceptance'})
})
async function seed(mode:'V'|'VH'='V',period?:{start?:string;end?:string|null}){
 const ids={company:randomUUID(),beneficiary:randomUUID(),actor:randomUUID(),reviewer:randomUUID(),legal:randomUUID(),dso:randomUUID(),profile:randomUUID(),customer:randomUUID(),site:randomUUID(),point:randomUUID(),grid:randomUUID(),route:randomUUID(),routeProfile:randomUUID(),ackRoute:randomUUID(),ackProfile:randomUUID(),key:randomUUID()}
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(ids.company)},'Synthetic native ESCO provider','active'),(${lit(ids.beneficiary)},'Synthetic isolated beneficiary','active');`)
 for(const actor of [ids.actor,ids.reviewer])sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${lit(actor)},'authenticated','authenticated',${lit(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${lit(actor)},${lit(actor+'@example.invalid')},'Synthetic scoped ESCO actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${lit(ids.company)},${lit(actor)},'operations','active',now(),'{}','member',true,now(),'operations');`)
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(ids.actor)},${lit(ids.company)},id,key FROM public.permissions WHERE key IN('metering.write','metering.read','communication.write','communication.send','communication.read','customers.read','customers.write');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(ids.reviewer)},${lit(ids.company)},id,key FROM public.permissions WHERE key IN('ediel.service_evidence.review','metering.read');UPDATE public.company_capabilities SET enabled=true,readiness_status='ready' WHERE company_id=${lit(ids.company)} AND capability_code='ediel_test';INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants) VALUES(${lit(ids.legal)},${lit('SYNTHETIC ESCO legal actor '+ids.legal)},'active','verified',true),(${lit(ids.dso)},${lit('SYNTHETIC DSO legal actor '+ids.dso)},'active','verified',true);`)
 const sender=sql<string>(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_legal_actor_identifier',0));WITH available AS(SELECT candidate::text value FROM generate_series(40000,49999) candidate WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) AND NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1),allocated AS(INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) SELECT ${lit(ids.company)},'test',${lit(ids.legal)},'EdielId',value,clock_timestamp()-interval '1 day' FROM available RETURNING identifier_value) SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
 const receiver=sql<string>(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_dispatch_actor_identifier',0));WITH available AS(SELECT candidate::text value FROM generate_series(60000,89999) candidate WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1),allocated AS(INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified) SELECT ${lit(ids.dso)},'EdielId',value,true FROM available RETURNING identifier_value) SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
 const point='735999260731000007',product='8716867000030',app='23-DGI-PRODAT'
 sql(`INSERT INTO public.tenant_ediel_profiles(id,company_id,environment,market,is_enabled,valid_from) VALUES(${lit(ids.profile)},${lit(ids.company)},'test','electricity',true,clock_timestamp()-interval '1 day');INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${lit(ids.company)},'test',${lit(ids.legal)},'energy_service_company',clock_timestamp()-interval '1 day');INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id) VALUES(${lit(ids.company)},'test','Synthetic local ESCO',${lit(sender)},${lit(sender)});INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) VALUES(${lit(ids.dso)},'grid_owner',true);INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,owner_code) VALUES(${lit(ids.grid)},${lit(ids.company)},'Synthetic DSO',${lit(receiver)},'test',true,'active','TES');INSERT INTO public.customers(id,company_id,customer_number,first_name,last_name,name,customer_type,personal_number,email,billing_country,billing_street,billing_postal_code,billing_city) VALUES(${lit(ids.customer)},${lit(ids.company)},${lit(ids.customer)},'Synthetic','Customer','Synthetic Customer','private','199001011234','synthetic@example.invalid','SE','Synthetic street 1','12345','Synthetic city');INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id,grid_area_code) VALUES(${lit(ids.site)},${lit(ids.company)},${lit(ids.customer)},'Synthetic ESCO point','consumption','active','SE',${lit(point)},${lit(ids.grid)},'TES');INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,ediel_metering_point_id,grid_owner_id,grid_owner_ediel_id,grid_area_code,status) VALUES(${lit(ids.point)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},${lit(point)},${lit(point)},${lit(point)},${lit(ids.grid)},${lit(receiver)},'TES','active');
 INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${lit(ids.route)},${lit(ids.company)},'Synthetic ESCO permission route','metering_access',${lit(ids.grid)},'bilateral_test',true,'dso-native@example.invalid'),(${lit(ids.ackRoute)},${lit(ids.company)},'Synthetic own ACK route','ediel_ack',${lit(ids.grid)},'bilateral_test',true,'dso-native@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,mailbox,smtp_host,smtp_port,smtp_to,receiver_email) VALUES(${lit(ids.routeProfile)},${lit(ids.company)},${lit(ids.route)},'Synthetic ESCO PRODAT','test','edifact','edifact',${lit(sender)},${lit(receiver)},${lit(app)},true,true,'esco-native@example.invalid','smtp.example.invalid',587,'dso-native@example.invalid','dso-native@example.invalid'),(${lit(ids.ackProfile)},${lit(ids.company)},${lit(ids.ackRoute)},'Synthetic ESCO E66 own ACK','test','edifact','edifact',${lit(sender)},${lit(receiver)},'23-DGI-E66-T',true,true,'esco-native@example.invalid','smtp.example.invalid',587,'dso-native@example.invalid','dso-native@example.invalid');`)
 const fields={beneficiary_company_id:ids.beneficiary,provider_actor_id:ids.legal,actor_profile_id:ids.profile,customer_id:ids.customer,dso_actor_id:ids.dso,environment:'test',mode,purpose:'Synthetic scoped analysis',object_ids:[point],product_ids:[product],field_sets:['reading_at','quantity','unit','quality','qualifier','registration_date','resolution','product_id'],data_start:period?.start??'2026-06-01T00:00:00Z',data_end:period?.end!==undefined?period.end:mode==='VH'?'2026-09-30T00:00:00Z':null,valid_from:'2000-01-01T00:00:00Z',valid_to:'2099-01-01T00:00:00Z'}
 const command=(command:unknown)=>executeEdielServiceAdministration({companyId:ids.company,actorUserId:ids.actor,command}) as Promise<Record<string,unknown>>
 const created=await command({action:'create_assignment',commandId:randomUUID(),fields});expect(created.status).toBe('held');const assignment=String(created.assignmentId)
 const current=()=>sql<{version:number;basis:number;scope:Record<string,unknown>;hash:string}>(`SELECT jsonb_build_object('version',version,'basis',scope_basis_version,'scope',gridex_service_administration.scope_v1(a),'hash',encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex')) FROM public.ediel_service_assignments a WHERE company_id=${lit(ids.company)} AND id=${lit(assignment)}`)
 const insert=async(raw:string,family:'PRODAT'|'UTILTS',code:string)=>{
  const envelope=EdifactEnvelopeCodec.decode(raw),id=randomUUID()
  sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,validation_report,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference) VALUES(${lit(id)},${lit(ids.company)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(ids.grid)},'test','inbound','edifact',${lit(family)},${lit(code)},'received',${lit(raw)},'{}','{}',clock_timestamp(),'{}',${lit(envelope.applicationReference)},${lit(envelope.sender)},${lit(envelope.receiver)},${lit(envelope.interchangeReference)})`)
  const source=await getEdielMessageById(id);expect(source).not.toBeNull();return source!
 }
 const utilts=async(outcome:'accepted'|'processability_rejected',reference:string,expected:'internal_review'|typeof outcome=outcome)=>{
  const physical=utiltsErrGatewayFixture({company:ids.company,receiver:sender,transactions:[{reference,outcome}]}),fresh=utiltsNativeSourceFixture(physical.raw_payload!.replaceAll('91100',receiver).replaceAll('23-DDQ-E66-T','23-DGI-E66-T').replace("NAD+DDQ'","NAD+DGI'").replace("STS+7++E88::260'","STS+7++E23::260'"),randomUUID()),source=await insert(fresh.raw,'UTILTS','E66')
  const initial=await initialCanonicalUtiltsDecision(source),issuerIdentityAuthority=readCanonicalUtiltsIssuerIdentityAuthority({decision:initial,message:source})??undefined,periodicReasonAuthority=readCanonicalPeriodicReasonAuthority({decision:initial,message:source})??undefined,qualified=await qualifyReceivedUtiltsStructure({message:source,canonicalPolicy:initial.policy,issuerIdentityAuthority,periodicReasonAuthority,runtime:runUtiltsRuntimeForMessage(source,{canonicalPolicy:initial.policy,issuerIdentityAuthority,periodicReasonAuthority})})
  expect(qualified.runtime.transactionDispositions.map(x=>x.disposition)).toEqual([expected])
  await recordFinalCanonicalUtiltsDecision({original:source,validated:source,initialDecision:initial,runtime:qualified.runtime})
  const matches=qualified.runtime.facts.transactions.map(t=>({transactionReference:t.transactionId,meteringPointId:ids.point,customerId:ids.customer,siteId:ids.site,gridOwnerId:ids.grid,externalMeteringPointId:point,externalGridAreaId:'TES',matchStatus:'matched' as const}))
  const contracts=await prepareUtiltsConsumptionContracts({message:source,runtime:qualified.runtime,policy:initial.policy,matches,dataRequest:null,fallback:{customerId:ids.customer,siteId:ids.site,meteringPointId:ids.point,gridOwnerId:ids.grid},allowConsumption:expected==='accepted'})
  const input={companyId:ids.company,environment:source.environment,sourceMessageId:source.id,messageCode:'E66',rawPayload:source.raw_payload!,contracts,transactions:buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:qualified.runtime.facts.transactions,rawSegments:qualified.runtime.facts.rawSegments,dispositions:qualified.runtime.transactionDispositions,matches})}
  return {source,input,runtime:qualified.runtime,persist:()=>persistUtiltsTransactionResults(input),ack:()=>createCanonicalAckMessage({actorUserId:ids.actor,sourceMessage:source,ackFamily:outcome==='accepted'?'APERAK':'UTILTS_ERR',outcome:outcome==='accepted'?'positive':'negative',draft:outcome==='accepted'?buildAperakDraft({actorUserId:ids.actor,sourceMessage:source,outcome:'positive',relatedTransactionReference:reference,ackScope:'transaction'}):buildUtiltsErrDraft({actorUserId:ids.actor,sourceMessage:source,messageText:'E87',relatedTransactionReference:reference})}),finalize:(ack:EdielMessageRow)=>finalizeUtiltsTransactionAck({companyId:ids.company,environment:'test',sourceMessageId:source.id,transactionId:reference,responseType:outcome==='accepted'?'positive_aperak':'utilts_err',responseMessageId:ack.id})}
 }
 const effects=()=>sql<Record<string,number>>(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${lit(ids.company)}),'businessReferences',(SELECT count(*) FROM public.ediel_business_references WHERE company_id=${lit(ids.company)}),'creationReceipts',(SELECT count(*) FROM gridex_ediel_ack_replay.creation_receipts WHERE company_id=${lit(ids.company)}),'consumptions',(SELECT count(*) FROM gridex_ediel_outbound_owner.consumptions WHERE company_id=${lit(ids.company)}),'namespace',(SELECT count(*) FROM gridex_ediel_wire_namespace.coverage WHERE company_id=${lit(ids.company)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${lit(ids.company)}),'intents',(SELECT count(*) FROM public.ediel_message_intents WHERE company_id=${lit(ids.company)}),'series',(SELECT count(*) FROM public.meter_reading_series WHERE company_id=${lit(ids.company)}),'values',(SELECT count(*) FROM public.meter_reading_values WHERE company_id=${lit(ids.company)}),'contracts',(SELECT count(*) FROM gridex_utilts_binding.contracts WHERE company_id=${lit(ids.company)}),'bindings',(SELECT count(*) FROM gridex_utilts_binding.receipts WHERE company_id=${lit(ids.company)}),'reservations',(SELECT count(*) FROM public.ediel_ack_transaction_results WHERE company_id=${lit(ids.company)}),'acks',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${lit(ids.company)} AND direction='outbound' AND related_message_id IS NOT NULL),'witnesses',(SELECT count(*) FROM gridex_ediel_outbound_owner.witnesses WHERE company_id=${lit(ids.company)}),'scopeReceipts',(SELECT count(*) FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE company_id=${lit(ids.company)}),'requestTimings',(SELECT count(*) FROM gridex_service_permission.request_timing_receipts WHERE company_id=${lit(ids.company)}),'events',(SELECT count(*) FROM public.ediel_message_events WHERE company_id=${lit(ids.company)}),'attempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${lit(ids.company)}))`)
 return {ids,sender,receiver,point,product,app,mode,fields,assignment,command,current,insert,utilts,effects}
}
type NativeTermMismatch='legacy_nine_terms'|'legacy_eleven_terms'|'staged_agreement'|'staged_method'|'staged_network_period'
async function archiveReviewEvidence(f:Awaited<ReturnType<typeof seed>>,mismatch?:NativeTermMismatch,networkStart='2026-05-01',networkEnd:string|null=null){
 const pdf=Buffer.from('%PDF-1.7\nSYNTHETIC DISPOSABLE ESCO EVIDENCE. NOT EXTERNAL LEGAL APPROVAL.\n%%EOF'),hash=createHash('sha256').update(pdf).digest('hex'),key=Buffer.alloc(32,0x59),receiptIds:string[]=[],artifacts:string[]=[]
 sql(`INSERT INTO gridex_ediel_services.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to) VALUES(${lit(f.ids.key)},${lit(f.ids.company)},'test','synthetic-native-issuer','SYNTHETIC EXTERNAL REGISTRY INPUT ONLY',${lit(hash)},decode(${lit(key.toString('hex'))},'hex'),'2000-01-01','2099-01-01')`)
 const baseTerms={valid_from:'2000-01-01T00:00:00Z',valid_to:'2099-01-01T00:00:00Z',permission_purpose_code:'B72',permission_reporting_frequency:'D',permission_request_grid_area:'TES',permission_reporting_term_kind:f.mode==='V'?'indefinite':'bounded',permission_customer_classification:'private'}
 const termsFor=(kind:string)=>({...baseTerms,permission_agreement_reference:kind==='end_user_contract'?'SYN-'+f.ids.customer.slice(0,20):null,permission_requested_method:kind==='end_user_contract'?'Z04' as const:null,permission_network_contract_start:kind==='dso_contract'?networkStart:null,permission_network_contract_end:kind==='dso_contract'?networkEnd:null})
 const terms=termsFor('end_user_contract')
 // Raw claims alone hold; a real staged command plus separate native review is
 // needed, and absence of issuer authority never creates verified evidence.
 const missing=await archiveEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.actor,submission:{assignmentId:f.assignment,scopeBasisVersion:f.current().basis,kind:'end_user_contract',terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:'untrusted native claim',version:'synthetic-v1'}}})
 expect(missing.missing).toContain('authentic_current_issuer_and_representation_receipt')
 for(const kind of ['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'] as const){
  const native=f.current(),representation=randomUUID(),reference='native-'+kind,version='synthetic-v1',terms=termsFor(kind)
  const normalized=sql<Record<string,unknown>>(`SELECT gridex_ediel_services.evidence_terms_v1(jsonb_populate_record(NULL::public.ediel_service_evidence,${lit(terms)}::jsonb))`)
  const activeMismatch=mismatch==='legacy_eleven_terms'||mismatch==='staged_network_period'?kind==='dso_contract'?mismatch:undefined:mismatch
  expect(Object.keys(normalized).sort()).toEqual(['valid_from','valid_to','permission_agreement_reference','permission_requested_method','permission_purpose_code','permission_reporting_frequency','permission_request_grid_area','permission_reporting_term_kind','permission_customer_classification','permission_termination_reason','permission_termination_at',...(kind==='dso_contract'?['permission_network_contract_start','permission_network_contract_end']:[])].sort())
  expect(normalized.permission_agreement_reference).toBe(terms.permission_agreement_reference);expect(normalized.permission_requested_method).toBe(terms.permission_requested_method)
  const signedTerms={...normalized}
  if(activeMismatch==='legacy_nine_terms'){delete signedTerms.permission_agreement_reference;delete signedTerms.permission_requested_method}
  if(activeMismatch==='legacy_nine_terms'||activeMismatch==='legacy_eleven_terms'){delete signedTerms.permission_network_contract_start;delete signedTerms.permission_network_contract_end}
  receiptIds.push(representation)
  sql(`INSERT INTO gridex_ediel_services.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,beneficiary_company_id,customer_id,dso_actor_id,evidence_kind,scope_hash,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES(${lit(representation)},${lit(f.ids.company)},'test',${lit(f.ids.key)},${lit(f.ids.legal)},${lit(f.ids.beneficiary)},${lit(f.ids.customer)},${lit(f.ids.dso)},${lit(kind)},${lit(native.hash)},'SYNTHETIC EXTERNAL LEGAL REPRESENTATION INPUT ONLY',${lit(hash)},'2000-01-01','2099-01-01')`)
  const payload={format:'ediel_service_evidence_receipt_v1',issuerCode:'synthetic-native-issuer',receiptId:randomUUID(),companyId:f.ids.company,environment:'test',assignmentId:f.assignment,scopeBasisVersion:native.basis,scope:native.scope,evidenceKind:kind,evidenceTerms:signedTerms,...(kind==='dso_contract'||kind==='service_contract'?{periodicE66Reason:{version:1,reasonCode:'E23',applicationReference:'23-DGI-E66-T',senderEdielId:f.receiver,receiverEdielId:f.sender}}:{}),sourceHash:hash,sourceReference:reference,sourceVersion:version,transportRelationId:null,transportActorId:null,issuedAt:new Date().toISOString(),expiresAt:'2090-01-01T00:00:00Z'},wire=Buffer.from(JSON.stringify(payload))
  const artifact=await archiveEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.actor,submission:{assignmentId:f.assignment,scopeBasisVersion:native.basis,kind,terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version},issuerReceipt:{keyId:f.ids.key,representationId:representation,payloadBase64:wire.toString('base64'),signatureHex:createHmac('sha256',key).update(wire).digest('hex')}}})
  expect(artifact.missing).toEqual(activeMismatch?.startsWith('legacy_')?['separate_qualified_reviewer_required','authentic_current_issuer_and_representation_receipt']:['separate_qualified_reviewer_required'])
  const stagedTerms={...terms,...(mismatch==='staged_agreement'?{permission_agreement_reference:'SYN-UNSIGNED-AGREEMENT'}:mismatch==='staged_method'?{permission_requested_method:'Z03' as const}:mismatch==='staged_network_period'&&kind==='dso_contract'?{permission_network_contract_start:'2026-06-02'}:{})}
  const staged=await f.command({action:'stage_evidence',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,fields:{kind,source_reference:reference,source_sha256:hash,source_version:version,...stagedTerms}})
  expect(staged).toMatchObject({status:'pending',approvalGranted:false})
  const review={decision:'approve',reason:'Separate synthetic fixture review of exact native archive and scope',sourceHash:artifact.sourceHash,scopeHash:artifact.scopeHash}
  const result=await reviewEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId,evidenceId:String(staged.evidenceId),review})
  if(activeMismatch){
   expect(result).toMatchObject({status:'held',marketActivationGranted:false})
   expect(result.missing).toContain(activeMismatch.startsWith('legacy_')?'authentic_current_issuer_and_representation_receipt':'current_exact_assignment_evidence_scope')
   expect(sql(`SELECT jsonb_build_object('status',status,'approved',approved_by) FROM public.ediel_service_evidence WHERE company_id=${lit(f.ids.company)} AND id=${lit(staged.evidenceId)}`)).toEqual({status:'pending',approved:null})
   break
  }
  expect(result).toMatchObject({status:'verified',marketActivationGranted:false,missing:[]});artifacts.push(artifact.artifactId)
  if(kind==='dso_contract'||kind==='service_contract')expect(await reviewPeriodicDgiE66Reason({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId,evidenceId:String(staged.evidenceId),review:{...review,reason:'Separate explicit native review of the authenticated DGI E23 contract clause'}})).toMatchObject({status:'approved',reasonCode:'E23',marketActivationGranted:false})
  expect(Buffer.from((await readEdielServiceEvidenceBytes({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId})).bytes)).toEqual(pdf)
 }
 return {hash,receiptIds,artifacts}
}
async function qualify(f:Awaited<ReturnType<typeof seed>>,shared?:{permissionId:string;z13:EdielMessageRow;z14:EdielMessageRow},evidence?:Awaited<ReturnType<typeof archiveReviewEvidence>>){
 const {hash,receiptIds,artifacts}=evidence??await archiveReviewEvidence(f)
 expect(sql(`SELECT public.ediel_service_assignment_assessment_v1(${lit(f.ids.company)},${lit(f.assignment)})`)).toMatchObject({status:'authorized'})
 expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'approved_waiting_permission'})
 let permission:{id:string;li:string},z13:EdielMessageRow,z14:EdielMessageRow
 if(shared){
  expect(await coordinateEdielServicePermission({providerCompanyId:f.ids.company,assignmentId:f.assignment,actorUserId:f.ids.actor,expectedVersion:f.current().version,command:'request_access'})).toMatchObject({status:'reuse_permission',permissionId:shared.permissionId})
  permission=sql<{id:string;li:string}>(`SELECT jsonb_build_object('id',id,'li',rff_li) FROM public.metering_permissions WHERE company_id=${lit(f.ids.company)} AND id=${lit(shared.permissionId)}`)
  z13=shared.z13;z14=shared.z14
 }else{
 const prepared=await f.command({action:'request_access',assignmentId:f.assignment,expectedVersion:f.current().version,preferredRouteId:f.ids.route})
 expect(prepared,JSON.stringify(prepared)).toMatchObject({status:'queued',message:{message_code:'Z13'},blockingReasons:[]})
 const queued=prepared.message as EdielMessageRow;expect(queued.raw_payload).toBeTruthy()
 const sendsBefore=external.send.mock.calls.length
 await sendEdielMessageViaSmtp(queued,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'});expect(external.send).toHaveBeenCalledTimes(sendsBefore+1)
 z13=(await getEdielMessageById(queued.id))!;expect(z13.status).toBe('sent');expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${lit(z13.id)}`)).toBe(true)
 permission=sql<{id:string;li:string}>(`SELECT jsonb_build_object('id',id,'li',rff_li) FROM public.metering_permissions WHERE company_id=${lit(f.ids.company)} AND source_z13_message_id=${lit(z13.id)}`)
 expect(permission.id).toMatch(/^[0-9a-f-]{36}$/)
 const rendered=renderProdat({code:'Z14',variant:f.mode,mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version:{selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'},context:{code:'Z14',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:permission.li,senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,customerName:'Synthetic Customer',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerCountry:'SE',meterPointId:f.point,gridAreaId:'TES',reasonForTransaction:f.mode==='V'?'S17':'S18',permissionStatus:'A74',permissionPurpose:'B72',permissionId:'SYNTHETIC-PERMISSION-'+permission.id.slice(0,8),permissionTimestamp:new Date().toISOString(),reportStartDate:f.fields.data_start,reportEndDate:f.fields.data_end,reportingFrequency:'D',energyProductId:f.product}})
 expect(rendered.issues.filter(x=>x.severity==='error'),JSON.stringify(rendered.issues)).toEqual([])
 const raw=EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,20),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:rendered.segments}]});z14=await f.insert(raw,'PRODAT','Z14');const decision=await resolveCanonicalRuntimeDecisionWithRegistry(z14)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision],JSON.stringify(decision.issues)).toEqual(['accepted','accepted','accepted'])
 expect(await recordReceivedSourceValidation({original:z14,validated:z14,resolvedCompanyId:f.ids.company,decision})).toMatchObject({status:'recorded'})
 await captureFreshEdielSourceRulePackEvidence(f.ids.company,z14.id)
 expect(await applyPermissionMarketSource({actorUserId:f.ids.actor,message:z14,expectedPermissionId:permission.id})).toMatchObject({applied:true,permissionId:permission.id,status:'active'})
 }
 const link=sql<string>(`SELECT to_jsonb(id) FROM public.ediel_assignment_permission_links WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)} AND permission_id=${lit(permission.id)}`)
 const grant=await f.command({action:'create_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,fields:{permission_link_id:link,object_ids:[f.point],product_ids:[f.product],fields:f.fields.field_sets,data_start:f.fields.data_start,data_end:f.fields.data_end,valid_from:f.fields.valid_from,valid_to:f.fields.valid_to}})
 expect(grant).toMatchObject({status:'held',accessGranted:false})
 expect(await f.command({action:'publish_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,grantId:grant.grantId,expectedGrantVersion:grant.grantVersion})).toMatchObject({status:'active'})
 return {grantId:String(grant.grantId),permissionId:permission.id,z13,z14,representationIds:receiptIds,artifacts,hash}
}
it('ESCO02 native archive refuses DSO network-period terms on another actual contract kind before any artifact or business effect',async()=>{
 const f=await seed(),before=f.effects(),pdf=Buffer.from('%PDF-1.7\nSYNTHETIC WRONG CONTRACT KIND ONLY\n%%EOF')
 await expect(archiveEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.actor,submission:{assignmentId:f.assignment,scopeBasisVersion:f.current().basis,kind:'service_contract',terms:{valid_from:'2000-01-01T00:00:00Z',valid_to:null,permission_network_contract_start:'2026-05-01',permission_network_contract_end:null},source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:'Declared wrong original contract kind',version:'synthetic-v1'}}})).rejects.toMatchObject({message:expect.stringContaining('ediel_service_archive_network_period_kind_invalid')})
 expect(f.effects()).toEqual(before);expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_ediel_services.artifacts WHERE company_id=${lit(f.ids.company)}`)).toBe(0);expect(external.send).not.toHaveBeenCalled()
})
it.each(['legacy_nine_terms','legacy_eleven_terms','staged_agreement','staged_method','staged_network_period'] as const)('native issuer archive and separate review reject %s without source/request/grant/storage/ACK effects',async mismatch=>{
 const f=await seed(),before=f.effects()
 await archiveReviewEvidence(f,mismatch)
 expect(sql(`SELECT public.ediel_service_assignment_assessment_v1(${lit(f.ids.company)},${lit(f.assignment)})`)).toMatchObject({status:'held'})
 expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'held'})
 expect(f.effects()).toEqual(before)
 expect(sql(`SELECT jsonb_build_object('verified',(SELECT count(*) FROM public.ediel_service_evidence WHERE company_id=${lit(f.ids.company)} AND status='verified'),'grants',(SELECT count(*) FROM public.ediel_data_access_grants WHERE company_id=${lit(f.ids.company)}),'origins',(SELECT count(*) FROM gridex_service_permission.origins WHERE company_id=${lit(f.ids.company)}))`)).toEqual({verified:mismatch==='staged_network_period'||mismatch==='legacy_eleven_terms'?1:0,grants:0,origins:0})
 expect(external.send).not.toHaveBeenCalled()
})
it.each(['before_three_years','before_network_start','historical_today','continuous_past_end'] as const)('ESCO02 native current archive/review holds %s before any permission/request/source/storage/ACK effects',async violation=>{
 const today=sql<string>(`SELECT to_jsonb((clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date)`),historical=violation==='historical_today'
 const f=await seed(historical?'VH':'V',{start:violation==='before_three_years'?'2020-01-01T00:00:00Z':violation==='before_network_start'?'2026-04-30T00:00:00Z':'2026-06-01T00:00:00Z',end:historical?today+'T00:00:00+01:00':violation==='continuous_past_end'?'2026-09-30T00:00:00+01:00':null})
 await archiveReviewEvidence(f,undefined,violation==='before_three_years'?'2000-01-01':'2026-05-01')
 expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'approved_waiting_permission'})
 const before=f.effects(),result=await coordinateEdielServicePermission({providerCompanyId:f.ids.company,assignmentId:f.assignment,actorUserId:f.ids.actor,expectedVersion:f.current().version,command:'request_access'})
 expect(result.status).toBe('held');expect(result.missing?.length).toBeGreaterThan(0);expect(f.effects()).toEqual(before)
 expect(sql(`SELECT jsonb_build_object('permissions',(SELECT count(*) FROM public.metering_permissions WHERE company_id=${lit(f.ids.company)}),'links',(SELECT count(*) FROM public.ediel_assignment_permission_links WHERE company_id=${lit(f.ids.company)}),'timing',(SELECT count(*) FROM gridex_service_permission.request_timing_receipts WHERE company_id=${lit(f.ids.company)}))`)).toEqual({permissions:0,links:0,timing:0});expect(external.send).not.toHaveBeenCalled()
})
it('ESCO02 native first request captures the actual server day and DSO period once; current replay attempts no permission/link/receipt insert',async()=>{
 const f=await seed();await archiveReviewEvidence(f)
 expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'approved_waiting_permission'})
 const request=()=>coordinateEdielServicePermission({providerCompanyId:f.ids.company,assignmentId:f.assignment,actorUserId:f.ids.actor,expectedVersion:f.current().version,command:'request_access'}),raced=await Promise.all([request(),request()]),first=raced[0]
 expect(raced[1]).toEqual(first);expect(first).toMatchObject({status:'permission_required'});expect(first.permissionId).toMatch(/^[0-9a-f-]{36}$/)
 const proof=sql<{requestDay:string;networkStart:string;networkEnd:null;sourceHash:string;reviewerUserId:string}>(`SELECT proof FROM gridex_service_permission.request_timing_receipts WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)}`)
 expect(proof.requestDay).toBe(sql<string>(`SELECT to_jsonb((clock_timestamp() AT TIME ZONE 'Europe/Stockholm')::date)`));expect(proof.networkStart).toBe('2026-05-01');expect(proof.networkEnd).toBeNull();expect(proof.reviewerUserId).toBe(f.ids.reviewer)
 const stable=f.effects(),suffix=randomUUID().replaceAll('-',''),fn='native_request_timing_tripwire_'+suffix
 sql(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id=${lit(f.ids.company)}::uuid THEN RAISE EXCEPTION 'native_request_timing_insert_attempt';END IF;RETURN NEW;END $$;CREATE TRIGGER ${fn} BEFORE INSERT ON public.metering_permissions FOR EACH ROW EXECUTE FUNCTION public.${fn}();CREATE TRIGGER ${fn} BEFORE INSERT ON public.ediel_assignment_permission_links FOR EACH ROW EXECUTE FUNCTION public.${fn}();CREATE TRIGGER ${fn} BEFORE INSERT ON gridex_service_permission.request_timing_receipts FOR EACH ROW EXECUTE FUNCTION public.${fn}()`)
 try{expect(await request()).toEqual(first);expect(sql(`SELECT proof FROM gridex_service_permission.request_timing_receipts WHERE company_id=${lit(f.ids.company)} AND assignment_id=${lit(f.assignment)}`)).toEqual(proof);expect(f.effects()).toEqual(stable)
  sql(`UPDATE public.user_profiles SET user_status='inactive' WHERE id=${lit(f.ids.reviewer)}`)
  expect(await request()).toMatchObject({status:'held'});expect(f.effects()).toEqual(stable)
 }finally{for(const table of ['public.metering_permissions','public.ediel_assignment_permission_links','gridex_service_permission.request_timing_receipts'])sql(`DROP TRIGGER ${fn} ON ${table}`);sql(`DROP FUNCTION public.${fn}()`)}
 expect(external.send).not.toHaveBeenCalled()
})
it('ESCO02 native pending metering actor DENY wins before the fresh timing/permission transaction',async()=>{
 const f=await seed();await archiveReviewEvidence(f);expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'approved_waiting_permission'});const before=f.effects()
 const blocker=spawn('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 const ready=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('native_request_deny_lock_timeout')),10000);blocker.stdout.on('data',chunk=>{if(String(chunk).includes('request-deny-locked')){clearTimeout(timeout);resolve()}});blocker.on('error',reject)})
 blocker.stdin.write(`BEGIN;LOCK TABLE public.user_permission_overrides IN SHARE ROW EXCLUSIVE MODE;INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from,valid_to) VALUES(${lit(f.ids.actor)},${lit(f.ids.company)},'metering.write','deny',true,now()-interval '1 minute',NULL);SELECT 'request-deny-locked';\n`)
 await ready;const pending=coordinateEdielServicePermission({providerCompanyId:f.ids.company,assignmentId:f.assignment,actorUserId:f.ids.actor,expectedVersion:f.current().version,command:'request_access'}).then(value=>({value,error:null}),error=>({value:null,error}))
 try{let observed=false;for(let n=0;n<100;n++){observed=sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.wait_event_type='Lock' AND a.query LIKE '%ediel_coordinate_service_permission_v1%' AND l.relation='public.user_permission_overrides'::regclass AND l.mode='ShareLock' AND NOT l.granted AND a.pid<>pg_backend_pid()))`);if(observed)break;await new Promise(resolve=>setTimeout(resolve,25))}expect(observed,'actual HTTP native request waits for current DENY before any service writer locks/effects').toBe(true)}finally{blocker.stdin.end('COMMIT;\n')}
 expect((await pending).error).toMatchObject({message:expect.stringContaining('ediel_service_manual_actor_forbidden')});expect(f.effects()).toEqual(before)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_service_permission.request_timing_receipts WHERE company_id=${lit(f.ids.company)}`)).toBe(0);expect(external.send).not.toHaveBeenCalled()
})
it('ESCO02 native last timing receipt failure rolls back permission/link/request-owner creation',async()=>{
 const f=await seed();await archiveReviewEvidence(f);expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version})).toMatchObject({status:'approved_waiting_permission'});const before=f.effects(),fn='native_timing_last_write_'+randomUUID().replaceAll('-','')
 sql(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id=${lit(f.ids.company)}::uuid THEN RAISE EXCEPTION 'native_timing_last_write_failure';END IF;RETURN NEW;END $$;CREATE TRIGGER ${fn} BEFORE INSERT ON gridex_service_permission.request_timing_receipts FOR EACH ROW EXECUTE FUNCTION public.${fn}()`)
 try{await expect(coordinateEdielServicePermission({providerCompanyId:f.ids.company,assignmentId:f.assignment,actorUserId:f.ids.actor,expectedVersion:f.current().version,command:'request_access'})).rejects.toMatchObject({message:expect.stringContaining('native_timing_last_write_failure')});expect(f.effects()).toEqual(before)
  expect(sql(`SELECT jsonb_build_object('permissions',(SELECT count(*) FROM public.metering_permissions WHERE company_id=${lit(f.ids.company)}),'links',(SELECT count(*) FROM public.ediel_assignment_permission_links WHERE company_id=${lit(f.ids.company)}),'owners',(SELECT count(*) FROM gridex_service_administration.permission_request_owners WHERE company_id=${lit(f.ids.company)}),'timing',(SELECT count(*) FROM gridex_service_permission.request_timing_receipts WHERE company_id=${lit(f.ids.company)}))`)).toEqual({permissions:0,links:0,owners:0,timing:0})
 }finally{sql(`DROP TRIGGER ${fn} ON gridex_service_permission.request_timing_receipts;DROP FUNCTION public.${fn}()`)}
 expect(external.send).not.toHaveBeenCalled()
})
it.each(['V','VH'] as const)('genuine archived/reviewed %s scope, sent Z13, native Z14, published grant, accepted storage and atomic ACK; missing approval has zero effects',async mode=>{
 const f=await seed(mode),unqualified=await f.utilts('accepted','NATIVE-ESCO-UNQUALIFIED-'+mode,'internal_review'),initial=f.effects()
 expect(unqualified.runtime.ackPlan).toMatchObject({shouldSendAperak:false,shouldSendUtiltsErr:false});expect(f.effects()).toEqual(initial)
 // A genuine current communication contract is required separately from data
 // permission. No absent agreement is turned into a national error or E87.
 const evidence=await archiveReviewEvidence(f)
 // Protocol-defined E87 negative is allowed without positive data approval.
 const negative=await f.utilts('processability_rejected','NATIVE-ESCO-NEGATIVE-'+mode)
 expect(await negative.persist()).toMatchObject([{disposition:'processability_rejected',persistenceStatus:'not_applicable'}]);const negativeAck=await negative.ack();expect(negativeAck.message_family).toBe('UTILTS_ERR');expect(f.effects().series).toBe(0);expect(f.effects().contracts).toBe(0)
 const authority=await qualify(f,undefined,evidence),positive=await f.utilts('accepted','NATIVE-ESCO-'+mode),before=f.effects()
 const retained=await positive.persist();expect(retained).toMatchObject([{disposition:'accepted',persistenceStatus:'persisted',contractVersion:2}]);expect(f.effects().series).toBe(before.series+1);expect(f.effects().contracts).toBe(before.contracts+1)
 const raced=await Promise.all([positive.ack(),positive.ack()]);expect(new Set(raced.map(x=>x.id)).size).toBe(1);expect(raced[0]).toMatchObject({message_family:'APERAK',ack_outcome:'positive'});expect(f.effects().scopeReceipts).toBe(before.scopeReceipts+1)
 const own=raced[0];await positive.finalize(own);await expect(assertUtiltsPositiveAckAuthorityForSend(own)).resolves.toBeUndefined();const stable=f.effects()
 sql(`UPDATE public.communication_routes SET is_active=false,target_email='changed@example.invalid' WHERE id=${lit(f.ids.ackRoute)};UPDATE public.ediel_route_profiles SET is_enabled=false WHERE id=${lit(f.ids.ackProfile)}`)
 expect((await positive.ack()).id).toBe(own.id);expect(f.effects()).toEqual(stable)
 // Actual revocation is irreversible; no active/verified flag is restored.
 expect(await f.command({action:'revoke_grant',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:f.current().version,grantId:authority.grantId,expectedGrantVersion:sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(authority.grantId)}`)})).toMatchObject({status:'revoked'})
 await expect(positive.ack()).rejects.toMatchObject({message:expect.stringMatching(/ediel_ack_service_scope_(?:current_grant_required|captured_grant_not_current)/)});expect(f.effects()).toEqual(stable)
 await expect(positive.persist()).rejects.toMatchObject({message:expect.stringMatching(/ediel_ack_service_scope_(?:current_grant_required|captured_grant_not_current)/)});expect(f.effects()).toEqual(stable)
 await expect(assertUtiltsPositiveAckAuthorityForSend(own)).rejects.toThrow('utilts_positive_ack_storage_unavailable');expect(f.effects()).toEqual(stable)
 await expect(sendEdielMessageViaSmtp(own,{actorUserId:f.ids.actor})).rejects.toThrow('utilts_positive_ack_storage_unavailable');expect(f.effects()).toEqual(stable)
 expect(external.send).toHaveBeenCalledTimes(1)
})
it('real pending grant revocation wins before accepted storage and causes zero business/binding/reservation/audit effects',async()=>{
 const f=await seed(),authority=await qualify(f),positive=await f.utilts('accepted','NATIVE-ESCO-PREWRITE-RACE'),before=f.effects()
 const blocker=spawn('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 const ready=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('native_esco_grant_lock_timeout')),10000);blocker.stdout.on('data',chunk=>{if(String(chunk).includes('grant-locked')){clearTimeout(timeout);resolve()}});blocker.on('error',reject)})
 blocker.stdin.write(`BEGIN;LOCK TABLE public.ediel_data_access_grants IN SHARE ROW EXCLUSIVE MODE;UPDATE public.ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id=${lit(authority.grantId)};SELECT 'grant-locked';\n`)
 await ready;const pending=positive.persist().then(value=>({value,error:null}),error=>({value:null,error}))
 try{let observed=false;for(let n=0;n<100;n++){observed=sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%gridex_persist_utilts_consumption_v1%' AND pid<>pg_backend_pid()))`);if(observed)break;await new Promise(resolve=>setTimeout(resolve,25))}expect(observed,'actual HTTP storage command is waiting behind genuine revocation').toBe(true)}finally{blocker.stdin.end('COMMIT;\n')}
 expect((await pending).error).toMatchObject({message:expect.stringContaining('ediel_ack_service_scope_current_grant_required')});expect(f.effects()).toEqual(before);expect(external.send).toHaveBeenCalledTimes(1)
})

it.each(['reviewer','role','issuer_representation','issuer_key'] as const)('retained actual ESCO ACK and storage deny current %s revocation without effects',async revoked=>{
 const f=await seed(),authority=await qualify(f),positive=await f.utilts('accepted','NATIVE-ESCO-REV-'+revoked.slice(0,12))
 await positive.persist();const ack=await positive.ack();await positive.finalize(ack);await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).resolves.toBeUndefined();const stable=f.effects()
 if(revoked==='reviewer')sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${lit(f.ids.company)} AND user_id=${lit(f.ids.reviewer)}`)
 if(revoked==='role')sql(`UPDATE public.tenant_actor_roles SET valid_to=now() WHERE company_id=${lit(f.ids.company)}`)
 if(revoked==='issuer_representation'||revoked==='issuer_key')sql(`INSERT INTO gridex_ediel_services.issuer_revocations(target_kind,target_id,source_reference,source_hash) VALUES(${lit(revoked==='issuer_key'?'key':'representation')},${lit(revoked==='issuer_key'?f.ids.key:authority.representationIds[0])},'SYNTHETIC DISPOSABLE EXTERNAL REVOCATION',${lit(authority.hash)})`)
 const pattern=revoked==='role'?/current_captured_role_unavailable/:/ediel_ack_service_scope_(?:current_grant_required|captured_grant_not_current)/
 await expect(positive.ack()).rejects.toMatchObject({message:expect.stringMatching(pattern)});expect(f.effects()).toEqual(stable)
 await expect(positive.persist()).rejects.toMatchObject({message:expect.stringMatching(pattern)});expect(f.effects()).toEqual(stable);expect(external.send).toHaveBeenCalledTimes(1)
 await expect(assertUtiltsPositiveAckAuthorityForSend(ack)).rejects.toThrow('utilts_positive_ack_storage_unavailable');expect(f.effects()).toEqual(stable)
 await expect(sendEdielMessageViaSmtp(ack,{actorUserId:f.ids.actor})).rejects.toThrow('utilts_positive_ack_storage_unavailable');expect(f.effects()).toEqual(stable);expect(external.send).toHaveBeenCalledTimes(1)
})
it.each(['own_actor','global_reviewer'] as const)('pending real %s DENY insertion wins before any ACK/storage effects under the same graph order',async target=>{
 const f=await seed();await qualify(f);const positive=await f.utilts('accepted','NATIVE-ESCO-DENY-'+target)
 if(target==='own_actor')await positive.persist()
 const before=f.effects(),actor=target==='own_actor'?f.ids.actor:f.ids.reviewer,company=target==='own_actor'?lit(f.ids.company):'NULL',permission=target==='own_actor'?'communication.write':'ediel.service_evidence.review'
 const blocker=spawn('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 const ready=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('native_current_deny_lock_timeout')),10000);blocker.stdout.on('data',chunk=>{if(String(chunk).includes('deny-locked')){clearTimeout(timeout);resolve()}});blocker.on('error',reject)})
 blocker.stdin.write(`BEGIN;LOCK TABLE public.user_permission_overrides IN SHARE ROW EXCLUSIVE MODE;INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from,valid_to) VALUES(${lit(actor)},${company},${lit(permission)},'deny',true,now()-interval '1 minute',NULL);SELECT 'deny-locked';\n`)
 await ready
 const pending=(target==='own_actor'?positive.ack():positive.persist()).then(value=>({value,error:null}),error=>({value:null,error}))
 try{let observed=false;for(let n=0;n<100;n++){observed=sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity WHERE wait_event_type='Lock' AND (query LIKE '%ediel_read_outbound_ack_replay_v1%' OR query LIKE '%gridex_persist_utilts_consumption_v1%') AND pid<>pg_backend_pid()))`);if(observed)break;await new Promise(resolve=>setTimeout(resolve,25))}expect(observed,'genuine HTTP operation waits behind deny insertion before source/business locks').toBe(true)}finally{blocker.stdin.end('COMMIT;\n')}
 expect((await pending).error).toMatchObject({message:expect.stringMatching(target==='own_actor'?/actor_not_authorized/:/ediel_ack_service_scope_(?:current_grant_required|captured_grant_not_current)/)});expect(f.effects()).toEqual(before);expect(external.send).toHaveBeenCalledTimes(1)
})
it('a genuine already accepted ACK transport journal replays after issuer revocation without a second SMTP call or fresh scope approval',async()=>{
 const f=await seed(),authority=await qualify(f),positive=await f.utilts('accepted','NATIVE-ESCO-SENT-ACK')
 await positive.persist();const ack=await positive.ack();await positive.finalize(ack)
 const first=await sendEdielMessageViaSmtp(ack,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})
 expect(first.accepted).toEqual(['dso-native@example.invalid']);expect(external.send).toHaveBeenCalledTimes(2)
 const sent=(await getEdielMessageById(ack.id))!;expect(sent.status).toBe('sent');const stable=f.effects()
 sql(`INSERT INTO gridex_ediel_services.issuer_revocations(target_kind,target_id,source_reference,source_hash) VALUES('key',${lit(f.ids.key)},'SYNTHETIC DISPOSABLE EXTERNAL REVOCATION',${lit(authority.hash)})`)
 await expect(assertUtiltsPositiveAckAuthorityForSend(sent)).rejects.toThrow('utilts_positive_ack_storage_unavailable')
 const replay=await sendEdielMessageViaSmtp(sent,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})
 expect(replay).toEqual(first);expect(external.send).toHaveBeenCalledTimes(2);expect(f.effects()).toEqual(stable)
})
it('actual native resolver preserves positive rights and exact OID/ACL while current own/global direct/override denies remain tenant/time scoped',async()=>{
 const f=await seed(),allows=()=>sql<boolean>(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${lit(f.ids.actor)},${lit(f.ids.company)},'communication.write'))`)
 expect(allows()).toBe(true)
 const row=randomUUID(),foreign=f.ids.beneficiary
 sql(`INSERT INTO public.user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active,valid_from,valid_to) VALUES(${lit(row)},${lit(f.ids.actor)},${lit(foreign)},'communication.write','deny',true,NULL,NULL)`);expect(allows()).toBe(true)
 sql(`UPDATE public.user_permission_overrides SET company_id=${lit(f.ids.company)},valid_to=now()-interval '1 day' WHERE id=${lit(row)}`);expect(allows()).toBe(true)
 sql(`UPDATE public.user_permission_overrides SET valid_to=NULL,valid_from=now()+interval '1 day' WHERE id=${lit(row)}`);expect(allows()).toBe(true)
 sql(`UPDATE public.user_permission_overrides SET valid_from=NULL,is_active=false WHERE id=${lit(row)}`);expect(allows()).toBe(true)
 sql(`UPDATE public.user_permission_overrides SET is_active=true WHERE id=${lit(row)}`);expect(allows()).toBe(false)
 sql(`UPDATE public.user_permission_overrides SET company_id=NULL WHERE id=${lit(row)}`);expect(allows()).toBe(false)
 sql(`UPDATE public.user_permission_overrides SET is_active=false WHERE id=${lit(row)};INSERT INTO public.user_permissions(user_id,company_id,permission_id,effect,status,is_active) SELECT ${lit(f.ids.actor)},${lit(f.ids.company)},id,'deny','active',true FROM public.permissions WHERE key='communication.write'`);expect(allows()).toBe(false)
 // Bound only disposable current direct authority; private review/source/ACK
 // receipts are neither inserted nor rewritten by any native fixture.
 expect(f.effects().acks).toBe(0);expect(f.effects().series).toBe(0);expect(external.send).not.toHaveBeenCalled()
})

async function secondMission(f:Awaited<ReturnType<typeof seed>>,samePurpose=false){
 const beneficiary=randomUUID(),key=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${lit(beneficiary)},'Synthetic independently scoped second beneficiary','active')`)
 const fields={...f.fields,beneficiary_company_id:beneficiary,purpose:samePurpose?f.fields.purpose:'Synthetic separate second-purpose projection',field_sets:['reading_at','quantity','unit']}
 const made=await f.command({action:'create_assignment',commandId:randomUUID(),fields});expect(made.status).toBe('held')
 const assignment=String(made.assignmentId),current=()=>sql<ReturnType<typeof f.current>>(`SELECT jsonb_build_object('version',version,'basis',scope_basis_version,'scope',gridex_service_administration.scope_v1(a),'hash',encode(sha256(convert_to(gridex_service_administration.scope_v1(a)::text,'UTF8')),'hex')) FROM public.ediel_service_assignments a WHERE company_id=${lit(f.ids.company)} AND id=${lit(assignment)}`)
 // This is another real assignment and real five-evidence archive/review chain.
 // Only external issuer/legal facts are disposable synthetic bootstrap inputs.
 return {...f,ids:{...f.ids,beneficiary,key},fields,assignment,current}
}
function beneficiaryActor(company:string){
 const actor=randomUUID()
 sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${lit(actor)},'authenticated','authenticated',${lit(actor+'@example.invalid')},now(),'{}','{}',now(),now(),false,false);INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${lit(actor)},${lit(actor+'@example.invalid')},'Synthetic isolated beneficiary reader','active') ON CONFLICT(id) DO UPDATE SET user_status='active';INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${lit(company)},${lit(actor)},'operations','active',now(),'{}','member',true,now(),'operations');INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${lit(actor)},${lit(company)},id,key FROM public.permissions WHERE key='metering.read'`)
 return actor
}
function projection(f:Awaited<ReturnType<typeof seed>>,authority:Awaited<ReturnType<typeof qualify>>,sourceId:string){
 const actor=beneficiaryActor(f.ids.beneficiary),series=sql<{id:string;start:string;end:string}>(`SELECT jsonb_build_object('id',id,'start',period_start,'end',period_end) FROM public.meter_reading_series WHERE company_id=${lit(f.ids.company)} AND source_ediel_message_id=${lit(sourceId)}`)
 const request={beneficiaryCompanyId:f.ids.beneficiary,actorUserId:actor,grantId:authority.grantId,expectedGrantVersion:sql<number>(`SELECT to_jsonb(version) FROM public.ediel_data_access_grants WHERE id=${lit(authority.grantId)}`),purpose:f.fields.purpose,seriesId:series.id,fields:['reading_at','quantity'] as const,startInclusive:series.start,endExclusive:series.end,limit:100}
 return {actor,request,read:()=>projectEdielSeriesToBeneficiary(request)}
}
function sealedScopes(company:string,ack:EdielMessageRow){return sql<{version:number;transactions:{scopes:{grant:{id:string};assignment:{beneficiary_company_id:string;purpose:string}}[]}[]}>(`SELECT projection FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE company_id=${lit(company)} AND ack_raw_hash=encode(sha256(convert_to(${lit(ack.raw_payload)},'UTF8')),'hex')`)}
it('SC005/006 one actual upstream storage/ACK serves two independently archived and approved missions, with original replay and filtered isolated beneficiaries',async()=>{
 const f=await seed(),firstAuthority=await qualify(f),first=await f.utilts('accepted','NATIVE-ESCO-FIRST-SEALED')
 await first.persist();const original=await first.ack();await first.finalize(original)
 const originalSeal=sealedScopes(f.ids.company,original);expect(originalSeal.version).toBe(2);expect(originalSeal.transactions[0].scopes.map(x=>x.grant.id)).toEqual([firstAuthority.grantId])
 const second=await secondMission(f),secondAuthority=await qualify(second),afterMission=f.effects()
 expect((await first.ack()).id).toBe(original.id);expect(sealedScopes(f.ids.company,original)).toEqual(originalSeal);expect(f.effects()).toEqual(afterMission)
 const incoming=await f.utilts('accepted','NATIVE-ESCO-BOTH-MISSIONS'),before=f.effects()
 await incoming.persist();const ack=await incoming.ack();await incoming.finalize(ack)
 const nativeSeal=sealedScopes(f.ids.company,ack),grants=nativeSeal.transactions[0].scopes.map(x=>x.grant.id).sort()
 expect(grants).toEqual([firstAuthority.grantId,secondAuthority.grantId].sort());expect(new Set(nativeSeal.transactions[0].scopes.map(x=>x.assignment.beneficiary_company_id))).toEqual(new Set([f.ids.beneficiary,second.ids.beneficiary]))
 expect(f.effects().series).toBe(before.series+1);expect(f.effects().contracts).toBe(before.contracts+1)
 expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND related_message_id=${lit(incoming.source.id)} AND message_family='APERAK' AND ack_outcome='positive'`)).toBe(1)
 const one=projection(f,firstAuthority,incoming.source.id),two=projection(second,secondAuthority,incoming.source.id),stable=f.effects()
 for(const p of [one,two]){const page=await p.read();expect(page.rows.length).toBeGreaterThan(0);expect(page.grantId).toBe(p.request.grantId);expect(page.seriesId).toBe(p.request.seriesId);for(const row of page.rows)expect(Object.keys(row).sort()).toEqual(['quantity','reading_at'])}
 expect(f.effects()).toEqual(stable)
 await expect(projectEdielSeriesToBeneficiary({...one.request,grantId:secondAuthority.grantId,expectedGrantVersion:two.request.expectedGrantVersion})).rejects.toBeDefined()
 await expect(projectEdielSeriesToBeneficiary({...two.request,purpose:f.fields.purpose})).rejects.toMatchObject({message:expect.stringContaining('ediel_projection_outside_grant')})
 await expect(projectEdielSeriesToBeneficiary({...two.request,fields:['quality']})).rejects.toMatchObject({message:expect.stringContaining('ediel_projection_outside_grant')})
 expect(f.effects()).toEqual(stable);expect((await incoming.ack()).id).toBe(ack.id);expect(f.effects()).toEqual(stable)
 // Revoking second mission must not make the first mission's original receipt
 // depend on a fresh beneficiary choice. The two-scope original does deny.
 expect(await second.command({action:'revoke_grant',commandId:randomUUID(),assignmentId:second.assignment,expectedVersion:second.current().version,grantId:secondAuthority.grantId,expectedGrantVersion:two.request.expectedGrantVersion})).toMatchObject({status:'revoked'})
 expect((await first.ack()).id).toBe(original.id);expect(sealedScopes(f.ids.company,original)).toEqual(originalSeal)
 expect((await one.read()).rows.length).toBeGreaterThan(0);await expect(two.read()).rejects.toMatchObject({message:expect.stringContaining('ediel_grant_not_current')})
 await expect(incoming.ack()).rejects.toMatchObject({message:expect.stringContaining('ediel_ack_service_scope_captured_grant_not_current')});expect(f.effects()).toEqual(stable);expect(external.send).toHaveBeenCalledTimes(2)
})
it.each(['company','global'] as const)('SC071 pending %s beneficiary DENY wins before real projection and leaks zero rows/effects',async scope=>{
 const f=await seed(),authority=await qualify(f),positive=await f.utilts('accepted','NATIVE-ESCO-PROJECTION-DENY-'+scope)
 await positive.persist();const p=projection(f,authority,positive.source.id);expect((await p.read()).rows.length).toBeGreaterThan(0);const before=f.effects()
 const blocker=spawn('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']})
 const ready=new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('native_projection_deny_lock_timeout')),10000);blocker.stdout.on('data',chunk=>{if(String(chunk).includes('projection-deny-locked')){clearTimeout(timeout);resolve()}});blocker.on('error',reject)})
 blocker.stdin.write(`BEGIN;LOCK TABLE public.user_permission_overrides IN SHARE ROW EXCLUSIVE MODE;INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from,valid_to) VALUES(${lit(p.actor)},${scope==='company'?lit(f.ids.beneficiary):'NULL'},'metering.read','deny',true,now()-interval '1 minute',NULL);SELECT 'projection-deny-locked';\n`)
 await ready;const pending=p.read().then(value=>({value,error:null}),error=>({value:null,error}))
 try{let observed=false;for(let n=0;n<100;n++){observed=sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.wait_event_type='Lock' AND a.query LIKE '%ediel_beneficiary_series_page_v1%' AND l.relation='public.user_permission_overrides'::regclass AND l.mode='ShareLock' AND NOT l.granted AND a.pid<>pg_backend_pid()))`);if(observed)break;await new Promise(resolve=>setTimeout(resolve,25))}expect(observed,'real HTTP beneficiary read waits behind DENY fence before source/series').toBe(true)}finally{blocker.stdin.end('COMMIT;\n')}
 const result=await pending;expect(result.value).toBeNull();expect(result.error).toMatchObject({message:expect.stringContaining('ediel_beneficiary_forbidden')});expect(f.effects()).toEqual(before);expect(external.send).toHaveBeenCalledTimes(1)
})

it('literal SC005/006 same actual market permission reused by independent reviewed mission; ending one keeps the other and originates no Z18',async()=>{
 const f=await seed(),first=await qualify(f),second=await secondMission(f,true),beforeShare=f.effects(),other=await qualify(second,first)
 expect(other.permissionId).toBe(first.permissionId);expect(other.z13.id).toBe(first.z13.id);expect(other.z14.id).toBe(first.z14.id)
 expect(f.effects().messages).toBe(beforeShare.messages);expect(external.send).toHaveBeenCalledTimes(1)
 const positive=await f.utilts('accepted','NATIVE-ESCO-SHARED-PERMISSION'),before=f.effects()
 await positive.persist();const ack=await positive.ack();await positive.finalize(ack)
 expect(sealedScopes(f.ids.company,ack).transactions[0].scopes.map(x=>x.grant.id).sort()).toEqual([first.grantId,other.grantId].sort())
 expect(f.effects().series).toBe(before.series+1);expect(f.effects().contracts).toBe(before.contracts+1)
 const one=projection(f,first,positive.source.id),two=projection(second,other,positive.source.id)
 expect((await one.read()).rows.length).toBeGreaterThan(0);expect((await two.read()).rows.length).toBeGreaterThan(0)
 const stable=f.effects(),permissionBefore=sql<Record<string,unknown>>(`SELECT to_jsonb(p) FROM public.metering_permissions p WHERE company_id=${lit(f.ids.company)} AND id=${lit(first.permissionId)}`)
 expect(await second.command({action:'end_assignment',assignmentId:second.assignment,expectedVersion:second.current().version})).toMatchObject({status:'assignment_ended',permissionId:first.permissionId})
 await expect(two.read()).rejects.toMatchObject({message:expect.stringContaining('ediel_grant_not_current')});expect((await one.read()).rows.length).toBeGreaterThan(0)
 expect(sql<Record<string,unknown>>(`SELECT to_jsonb(p) FROM public.metering_permissions p WHERE company_id=${lit(f.ids.company)} AND id=${lit(first.permissionId)}`)).toEqual(permissionBefore)
 expect(f.effects()).toEqual(stable);expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${lit(f.ids.company)} AND message_code='Z18'`)).toBe(0);expect(external.send).toHaveBeenCalledTimes(1)
})


function projectionReceiptCount(company:string){
 return sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_ediel_services.projection_receipts WHERE company_id=${lit(company)}`)
}
it('ESCO11 native filtered derivatives retain the original DGI source and private contract across separate missions; exact current replay attempts no insert',async()=>{
 const f=await seed(),first=await qualify(f),second=await secondMission(f),other=await qualify(second)
 const incoming=await f.utilts('accepted','NATIVE-ESCO-PROVENANCE')
 await incoming.persist()
 const one=projection(f,first,incoming.source.id),two=projection(second,other,incoming.source.id),stable=f.effects()
 expect(projectionReceiptCount(f.ids.company)).toBe(0)
 const pages=await Promise.all([one.read(),two.read()])
 const native=sql<{version:number;hash:string}>(`SELECT jsonb_build_object('version',contract_version,'hash',contract_hash) FROM gridex_utilts_binding.contracts WHERE company_id=${lit(f.ids.company)} AND source_message_id=${lit(incoming.source.id)} AND series_id=${lit(one.request.seriesId)}`)
 const sourceEnvelope=EdifactEnvelopeCodec.decode(incoming.source.raw_payload!),sourceHash=createHash('sha256').update(incoming.source.raw_payload!,'utf8').digest('hex')
 expect(sourceEnvelope.applicationReference).toBe('23-DGI-E66-T')
 expect(pages[0].consumerReceiptId).not.toBe(pages[1].consumerReceiptId)
 for(const [index,page] of pages.entries()){
  const p=index===0?one:two
  expect(page.provenance).toEqual({version:1,sourceMessageId:incoming.source.id,sourceRawHash:sourceHash,sourceFamily:'UTILTS',sourceCode:'E66',sourceEnvironment:'test',sourceRole:'DGI',sourceApplicationReference:sourceEnvelope.applicationReference,sourceSenderEdielId:f.receiver,receiverActorId:f.ids.legal,receiverRole:'energy_service_company',contractVersion:native.version,contractHash:native.hash,purpose:p.request.purpose,fields:[...p.request.fields],qualityOrigin:null})
  expect(page.rows.length).toBeGreaterThan(0)
  for(const row of page.rows)expect(Object.keys(row).sort()).toEqual(['quantity','reading_at'])
  expect(Object.keys(page).sort()).toEqual(['consumerReceiptId','grantId','grantVersion','next','provenance','rows','seriesId'])
  expect(sql(`SELECT proof->'origin' FROM gridex_ediel_services.projection_receipts WHERE company_id=${lit(f.ids.company)} AND id=${lit(page.consumerReceiptId)}`)).toEqual(page.provenance)
  expect(JSON.stringify(page)).not.toContain('raw_payload');expect(JSON.stringify(page)).not.toContain('observations')
 }
 expect(projectionReceiptCount(f.ids.company)).toBe(2);expect(f.effects()).toEqual(stable)
 const quality=await projectEdielSeriesToBeneficiary({...one.request,fields:['reading_at','quality']})
 expect(quality.provenance.qualityOrigin).toEqual({sourceMessageId:incoming.source.id,seriesId:one.request.seriesId,column:'meter_reading_values.quality'})
 expect(quality.provenance.sourceRawHash).toBe(sourceHash);expect(quality.provenance.contractHash).toBe(native.hash)
 for(const row of quality.rows)expect(Object.keys(row).sort()).toEqual(['quality','reading_at'])
 expect(quality.consumerReceiptId).not.toBe(pages[0].consumerReceiptId);expect(projectionReceiptCount(f.ids.company)).toBe(3)
 // Same fresh proof is serialized inside the real PostgreSQL owner: one receipt
 // despite concurrent HTTP requests, then an exact retained read without INSERT.
 const request={...one.request,limit:99},raced=await Promise.all([projectEdielSeriesToBeneficiary(request),projectEdielSeriesToBeneficiary(request)])
 expect(raced[0]).toEqual(raced[1]);expect(projectionReceiptCount(f.ids.company)).toBe(4)
 const suffix=randomUUID().replaceAll('-',''),fn='native_projection_no_insert_'+suffix,trigger=fn
 sql(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id=${lit(f.ids.company)}::uuid THEN RAISE EXCEPTION 'native_projection_insert_attempt'; END IF; RETURN NEW; END $$;CREATE TRIGGER ${trigger} BEFORE INSERT ON gridex_ediel_services.projection_receipts FOR EACH ROW EXECUTE FUNCTION public.${fn}()`)
 try{
  expect(await one.read()).toEqual(pages[0]);expect(await two.read()).toEqual(pages[1]);expect(await projectEdielSeriesToBeneficiary(request)).toEqual(raced[0])
  await expect(projectEdielSeriesToBeneficiary({...one.request,limit:98})).rejects.toMatchObject({message:expect.stringContaining('native_projection_insert_attempt')})
  await expect(projectEdielSeriesToBeneficiary({...two.request,purpose:one.request.purpose})).rejects.toMatchObject({message:expect.stringContaining('ediel_projection_outside_grant')})
  await expect(projectEdielSeriesToBeneficiary({...two.request,fields:['quality']})).rejects.toMatchObject({message:expect.stringContaining('ediel_projection_outside_grant')})
  await expect(projectEdielSeriesToBeneficiary({...one.request,grantId:other.grantId,expectedGrantVersion:two.request.expectedGrantVersion})).rejects.toBeDefined()
  sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active,valid_from,valid_to) VALUES(${lit(one.actor)},${lit(f.ids.beneficiary)},'metering.read','deny',true,now()-interval '1 minute',NULL)`)
  await expect(one.read()).rejects.toMatchObject({message:expect.stringContaining('ediel_beneficiary_forbidden')})
  expect(await two.read()).toEqual(pages[1]);expect(projectionReceiptCount(f.ids.company)).toBe(4);expect(f.effects()).toEqual(stable)
 }finally{sql(`DROP TRIGGER ${trigger} ON gridex_ediel_services.projection_receipts;DROP FUNCTION public.${fn}()`)}
 expect(sql(`SELECT jsonb_build_object('read',has_table_privilege('service_role','gridex_ediel_services.projection_receipts','SELECT'),'write',has_table_privilege('service_role','gridex_ediel_services.projection_receipts','INSERT'))`)).toEqual({read:false,write:false})
 expect(external.send).toHaveBeenCalledTimes(2)
})
