import {createHash,createHmac,randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {seedNativeEscoFixture,nativeEscoSql as sql,nativeEscoLiteral as lit,nativeEscoExternal} from '../fixtures/ediel-service-evidence-native'
import {seedOriginalMailboxNative,recordOriginalMailboxNativeReception} from './originalMailboxNative'
import {omitPermissionField,permissionRequiredFields} from './ediel-permission-field-omissions'
import {archiveEdielServiceEvidence,readEdielServiceEvidenceArchive,readEdielServiceEvidenceBytes,reviewEdielServiceEvidence} from '@/lib/ediel/services/evidenceReview'
import {readEdielServiceAdministration} from '@/lib/ediel/services/administration'
import {reviewPeriodicDgiE66Reason} from '@/lib/ediel/services/periodicReason'
import {renderProdat} from '@/lib/ediel/prodatEngine'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {serializeUna} from '@/lib/ediel/core/una'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import {edielSmtpConfig} from '@/lib/ediel/mailReadiness'
import {getEdielMessageById} from '@/lib/ediel/db'
import type {EdielMessageRow} from '@/lib/ediel/types'

// Synthetic external issuer/representation, prospective tenant/mail inputs,
// and the declared SMTP provider port only. No accepted source, review,
// permission, grant, validation facet or effect receipt is seeded.
export type Z14Fixture=Awaited<ReturnType<typeof seedNativeEscoFixture>>
export type PendingZ14={f:Z14Fixture;permissionId:string;z13:EdielMessageRow;bounded:boolean}
export async function currentAssignment(f:Z14Fixture){
 const read=await readEdielServiceAdministration({companyId:f.ids.company,actorUserId:f.ids.actor,assignmentId:f.assignment})
 const entries=read.assignments as {assignment:{id:string;version:number;scope_basis_version:number}}[]
 expect(entries).toHaveLength(1);expect(entries[0].assignment.id).toBe(f.assignment)
 return entries[0].assignment
}
export function setOwnAckApplication(f:Z14Fixture,application:string){
 const smtp=edielSmtpConfig()
 expect(sql(`UPDATE public.ediel_route_profiles SET application_reference=${lit(application)},mailbox=${lit(smtp.from)},smtp_host=${lit(smtp.host)},smtp_port=${lit(smtp.port)} WHERE id=${lit(f.ids.ackProfile)} AND company_id=${lit(f.ids.company)} AND communication_route_id=${lit(f.ids.ackRoute)} RETURNING to_jsonb(id)`)).toBe(f.ids.ackProfile)
}
export async function pendingZ14(bounded=false):Promise<PendingZ14>{
 let f=await seedNativeEscoFixture('V')
 if(bounded){
  // A second public prospective assignment, never an unsupported update action.
  const fields={...f.fields,data_end:'2027-06-01T00:00:00Z'}
  const created=await f.command({action:'create_assignment',commandId:randomUUID(),fields})
  expect(created.status).toBe('held');f={...f,fields,assignment:String(created.assignmentId)}
 }
 setOwnAckApplication(f,f.app)
 const pdf=Buffer.from('%PDF-1.7\nSYNTHETIC CODE FIXTURE ONLY. NO EXTERNAL MARKET OR LEGAL APPROVAL.\n%%EOF')
 const hash=createHash('sha256').update(pdf).digest('hex'),key=Buffer.alloc(32,0x65)
 sql(`INSERT INTO gridex_ediel_services.issuer_keys(id,company_id,environment,issuer_code,legal_issuer_reference,legal_authority_source_hash,receipt_signing_key,valid_from,valid_to) VALUES(${lit(f.ids.key)},${lit(f.ids.company)},'test','synthetic-native-issuer','SYNTHETIC EXTERNAL REGISTRY INPUT ONLY',${lit(hash)},decode(${lit(key.toString('hex'))},'hex'),'2000-01-01','2099-01-01')`)
 for(const kind of ['end_user_contract','dso_contract','service_contract','downstream_use','privacy_roles'] as const){
  const a=await currentAssignment(f),representation=randomUUID(),reference='z14-final-'+kind+'-'+randomUUID()
  const terms={valid_from:f.fields.valid_from,valid_to:f.fields.valid_to,
   permission_purpose_code:'B72' as const,permission_reporting_frequency:'D',permission_request_grid_area:'TES',
   permission_reporting_term_kind:bounded?'bounded' as const:'indefinite' as const,permission_customer_classification:'private' as const,
   permission_agreement_reference:kind==='end_user_contract'?'SYN-'+f.ids.customer.slice(0,20):null,
   permission_requested_method:kind==='end_user_contract'?'Z04' as const:null,
   permission_network_contract_start:kind==='dso_contract'?'2026-05-01':null,permission_network_contract_end:null}
  const bootstrap=await archiveEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.actor,submission:{assignmentId:f.assignment,scopeBasisVersion:a.scope_basis_version,kind,terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference:'z14-bootstrap-'+randomUUID(),version:'synthetic-v1'}}})
  expect(bootstrap.missing).toContain('authentic_current_issuer_and_representation_receipt')
  const canonical=await readEdielServiceEvidenceArchive({companyId:f.ids.company,actorUserId:f.ids.actor,artifactId:bootstrap.artifactId})
  expect(canonical.scopeBasisVersion).toBe(a.scope_basis_version);expect(canonical.issuerCurrent).toBe(false)
  // The real public reader owns canonical scope and normalized terms. The
  // synthetic signer consumes them; this fixture copies no private algorithm.
  sql(`INSERT INTO gridex_ediel_services.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,beneficiary_company_id,customer_id,dso_actor_id,evidence_kind,scope_hash,legal_representation_reference,legal_authority_source_hash,valid_from,valid_to) VALUES(${lit(representation)},${lit(f.ids.company)},'test',${lit(f.ids.key)},${lit(f.ids.legal)},${lit(f.ids.beneficiary)},${lit(f.ids.customer)},${lit(f.ids.dso)},${lit(kind)},${lit(canonical.scopeHash)},'SYNTHETIC EXTERNAL REPRESENTATION INPUT ONLY',${lit(hash)},'2000-01-01','2099-01-01')`)
  const payload={format:'ediel_service_evidence_receipt_v1',issuerCode:'synthetic-native-issuer',receiptId:randomUUID(),companyId:f.ids.company,environment:'test',assignmentId:f.assignment,scopeBasisVersion:canonical.scopeBasisVersion,scope:canonical.scope,evidenceKind:kind,evidenceTerms:canonical.evidenceTerms,
   ...(kind==='dso_contract'||kind==='service_contract'?{periodicE66Reason:{version:1,reasonCode:'E23',applicationReference:'23-DGI-E66-T',senderEdielId:f.receiver,receiverEdielId:f.sender}}:{}),
   sourceHash:hash,sourceReference:reference,sourceVersion:'synthetic-v1',transportRelationId:null,transportActorId:null,issuedAt:new Date().toISOString(),expiresAt:'2090-01-01T00:00:00Z'}
  const wire=Buffer.from(JSON.stringify(payload))
  const artifact=await archiveEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.actor,submission:{assignmentId:f.assignment,scopeBasisVersion:a.scope_basis_version,kind,terms,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version:'synthetic-v1'},issuerReceipt:{keyId:f.ids.key,representationId:representation,payloadBase64:wire.toString('base64'),signatureHex:createHmac('sha256',key).update(wire).digest('hex')}}})
  expect(artifact.missing).toEqual(['separate_qualified_reviewer_required'])
  const staged=await f.command({action:'stage_evidence',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,fields:{kind,source_reference:reference,source_sha256:hash,source_version:'synthetic-v1',...terms}})
  expect(staged).toMatchObject({status:'pending',approvalGranted:false})
  const review={decision:'approve',reason:'Separate synthetic CODE review of public canonical scope, signed archive and exact bytes',sourceHash:artifact.sourceHash,scopeHash:artifact.scopeHash}
  expect(await reviewEdielServiceEvidence({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId,evidenceId:String(staged.evidenceId),review})).toMatchObject({status:'verified',missing:[],marketActivationGranted:false})
  if(kind==='dso_contract'||kind==='service_contract')expect(await reviewPeriodicDgiE66Reason({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId,evidenceId:String(staged.evidenceId),review:{...review,reason:'Separate review of synthetic signed DGI E23 clause'}})).toMatchObject({status:'approved',reasonCode:'E23',marketActivationGranted:false})
  expect(Buffer.from((await readEdielServiceEvidenceBytes({companyId:f.ids.company,actorUserId:f.ids.reviewer,artifactId:artifact.artifactId})).bytes)).toEqual(pdf)
 }
 expect(await f.command({action:'approve_assignment',commandId:randomUUID(),assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version})).toMatchObject({status:'approved_waiting_permission'})
 const prepared=await f.command({action:'request_access',assignmentId:f.assignment,expectedVersion:(await currentAssignment(f)).version,preferredRouteId:f.ids.route})
 expect(prepared,JSON.stringify(prepared)).toMatchObject({status:'queued',message:{message_code:'Z13'},blockingReasons:[]})
 const queued=prepared.message as EdielMessageRow,sends=nativeEscoExternal.send.mock.calls.length
 await sendEdielMessageViaSmtp(queued,{actorUserId:f.ids.actor,smtpMimeMode:'nodemailer-attachment'})
 expect(nativeEscoExternal.send).toHaveBeenCalledTimes(sends+1)
 const z13=(await getEdielMessageById(queued.id))!;expect(z13.status).toBe('sent')
 const permissionId=sql<string>(`SELECT to_jsonb(id) FROM public.metering_permissions WHERE company_id=${lit(f.ids.company)} AND source_z13_message_id=${lit(z13.id)}`)
 expect(permissionId).toMatch(/^[0-9a-f-]{36}$/)
 const state=z14Market({f,permissionId})
 expect(state.permission.status).not.toBe('active');expect(state.permission.source_z14_message_id).toBeNull()
 expect(state.sites.filter(s=>['active','approved'].includes(String(s.status)))).toEqual([])
 expect(state.grants).toEqual([]);expect(state.receipts).toEqual([])
 return {f,permissionId,z13,bounded}
}
export function z14Market(p:Pick<PendingZ14,'f'|'permissionId'>){
 const c=lit(p.f.ids.company)
 return sql<{permission:Record<string,unknown>;sites:Record<string,unknown>[];grants:Record<string,unknown>[];receipts:Record<string,unknown>[];transitions:Record<string,unknown>[];supply:Record<string,unknown>[];assignments:Record<string,unknown>[];links:Record<string,unknown>[]}>(`SELECT jsonb_build_object(
 'permission',(SELECT to_jsonb(x) FROM public.metering_permissions x WHERE company_id=${c} AND id=${lit(p.permissionId)}),
 'sites',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.metering_permission_sites x WHERE company_id=${c}),
 'grants',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.ediel_data_access_grants x WHERE company_id=${c}),
 'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM gridex_received_sources.permission_effect_receipts x WHERE company_id=${c}),
 'transitions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.source_message_id,x.permission_id),'[]') FROM gridex_received_sources.permission_effect_transitions_v1 x WHERE company_id=${c}),
 'supply',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.customer_supply_periods x WHERE company_id=${c}),
 'assignments',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.ediel_service_assignments x WHERE company_id=${c}),
 'links',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM public.ediel_assignment_permission_links x WHERE company_id=${c}))`)
}
export function z14Wire(p:PendingZ14,change:Record<string,unknown>={}){
 const {f}=p,permission=z14Market(p).permission
 const rendered=renderProdat({code:'Z14',variant:'V',mode:'test',actor:{senderEdielId:f.receiver,receiverEdielId:f.sender},route:{applicationReference:f.app},version:{selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'},context:{code:'Z14',bgmReference:randomUUID().replaceAll('-','').slice(0,20),transactionReference:String(permission.rff_li_reference),senderEdielId:f.receiver,receiverEdielId:f.sender,legalSenderId:f.receiver,legalReceiverId:f.sender,customerName:'Synthetic Customer',customerId:'199001011234',customerIdCodeListQualifier:'SE2',customerIdAgency:'260',customerCountry:'SE',meterPointId:f.point,gridAreaId:'TES',reasonForTransaction:'S17',permissionStatus:'A74',permissionPurpose:'B72',permissionId:'SYNTHETIC-PERMISSION-'+p.permissionId.slice(0,8),permissionTimestamp:new Date().toISOString(),reportStartDate:f.fields.data_start,reportEndDate:f.fields.data_end,reportingFrequency:'D',energyProductId:f.product,observationLength:'60',observationLengthFormat:'806',meteringMethod:'Z04',installationDirection:'E19',siteAddress:'Synthetic Street 1',siteCity:'Teststad',sitePostalCode:'12345',siteCountry:'SE',siteIdAgency:'9',...change}})
 expect(rendered.issues.filter(x=>x.severity==='error'&&!/_UNDETERMINED$/.test(x.code)),JSON.stringify(rendered.issues)).toEqual([])
 return EdifactEnvelopeCodec.encode({sender:f.receiver,receiver:f.sender,applicationReference:f.app,interchangeReference:randomUUID().replaceAll('-','').slice(0,20),environment:'test',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:rendered.segments}]})
}
export async function receiveZ14(p:PendingZ14,raw=z14Wire(p)){
 const {f}=p
 const mail=await seedOriginalMailboxNative(sql,lit,{companyId:f.ids.company,environment:'test',raw,smtpFrom:edielSmtpConfig().from,senderEmail:'dso-native@example.invalid'})
 const observedCode=mail.parsed.messageCode??'PRODAT_UNKNOWN'
 const wire=tokenizeEdifact(raw),reasonIndex=wire.segments.findIndex(s=>s.tag==='CCI'&&segmentComposite(s,2,wire.una)[0]==='Z13')
 const physicalReason=segmentComposite(wire.segments[reasonIndex+1],1,wire.una)[0]
 const profile=observedCode==='Z14'?`PRODAT:Z14:${physicalReason==='S18'?'VH':'V'}:26.A:r3`:undefined
 const source=await f.insert(raw,'PRODAT',observedCode,profile,mail)
 await recordOriginalMailboxNativeReception({companyId:f.ids.company,sourceMessageId:source.id,actorUserId:f.ids.actor,inboundEmailMessageId:mail.inboundEmailMessageId,parseResultId:mail.parseResultId,sourcePayloadHash:mail.sourcePayloadHash})
 return source
}
// Frozen P26.A field locators, independently enumerated; no runtime matrix
// determines the expected requirement or omission. Private V/S17, indefinite.
export const z14RequiredFields=['311','312','202','203','313','205','206','207','208','314','223','322','226','316','233','234','209','302','508','326','217','222','506','513','260','325','227','228','323'] as const
export type Z14Field=typeof z14RequiredFields[number]|'321'
export function omitZ14Field(raw:string,field:Z14Field){
 if((permissionRequiredFields as readonly string[]).includes(field))return omitPermissionField(raw,field as typeof permissionRequiredFields[number])
 const wire=tokenizeEdifact(raw),u=wire.una,e=u.dataElementSeparator,c=u.componentDataElementSeparator
 const dates:Partial<Record<Z14Field,string>>={'302':'90','508':'354','326':'693','321':'91'}
 const chars:Partial<Record<Z14Field,string>>={'217':'Z04','222':'Z12','506':'Z14','513':'Z22','323':'Z24'}
 let removed=false,removeCav=false
 const segments:string[]=[]
 for(const segment of wire.segments){
  const p=segment.raw.split(e)
  if(dates[field]&&p[0]==='DTM'&&p[1]?.split(c)[0]===dates[field]){removed=true;continue}
  if(chars[field]&&p[0]==='CCI')removeCav=p[2]===chars[field]
  if(chars[field]&&removeCav&&(p[0]==='CCI'||p[0]==='CAV')){removed=true;continue}
  if(p[0]==='NAD'&&p[1]==='IT'&&['233','234'].includes(field)){
   if(field==='233'){const identity=p[2].split(c);identity[0]='';p[2]=identity.join(c)}
   else p[5]=''
   removed=true
  }
  segments.push(p.join(e))
 }
 if(!removed)throw Error('z14_omission_baseline_field_absent_'+field)
 const start=segments.findIndex(s=>s.startsWith('UNH'+e)),end=segments.findIndex(s=>s.startsWith('UNT'+e))
 if(start<0||end<start)throw Error('z14_omission_single_message_required')
 const trailer=segments[end].split(e);trailer[1]=String(end-start+1);segments[end]=trailer.join(e)
 return serializeUna(u)+segments.join(u.segmentTerminator)+u.segmentTerminator
}
