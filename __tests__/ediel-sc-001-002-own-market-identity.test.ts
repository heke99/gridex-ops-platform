// masterplan: SC-001, SC-002
// Actual public callers, gateways, intent validation, source-result guards,
// PRODAT engines and envelope codec. Named DB/auth/source/route/persistence
// ports below are finite synthetic facts, not native issuer or market approval.
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {prepareAndQueueServicePermissionZ13} from '@/lib/ediel/flows/prodatServicePermission'
import {evaluateIntentValidation} from '@/lib/ediel/intent/intentEngine'
import {parseProdatMessage} from '@/lib/ediel/prodat/parser'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
import type {CreateEdielMessageIntentInput,EdielMessageIntent} from '@/lib/ediel/intent/types'
import type {ServicePermissionOriginBasis} from '@/lib/ediel/services/permissionOrigin'
import {selectedInvoiceeFact} from './fixtures/prodat-ud'

const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),context:vi.fn(),switch:vi.fn(),site:vi.fn(),point:vi.fn(),owner:vi.fn(),event:vi.fn(),routeSwitch:vi.fn(),routeService:vi.fn(),rule:vi.fn(),createIntent:vi.fn(),getIntent:vi.fn(),lifecycle:vi.fn(),finalize:vi.fn(),queue:vi.fn(),outboundSwitch:vi.fn(),outboundService:vi.fn(),link:vi.fn(),message:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/cis/db-shared',async original=>({...await original<typeof import('@/lib/cis/db-shared')>(),getCustomerExportContext:io.context}))
vi.mock('@/lib/cis/db',()=>({createOutboundRequest:io.outboundService}))
vi.mock('@/lib/operations/db',()=>({getSupplierSwitchRequestById:io.switch,createSupplierSwitchEvent:io.event}))
vi.mock('@/lib/masterdata/db',()=>({getCustomerSiteById:io.site,getMeteringPointById:io.point,getGridOwnerById:io.owner}))
vi.mock('@/lib/ediel/flows/routeDecisionContext',()=>({resolveDecisionBackedOutboundContext:io.routeSwitch}))
vi.mock('@/lib/ediel/core/kernel',()=>({resolveCanonicalOutboundContext:io.routeService}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.rule}))
vi.mock('@/lib/ediel/intent/intentEngine',async original=>({...await original<typeof import('@/lib/ediel/intent/intentEngine')>(),createEdielMessageIntent:io.createIntent,getEdielMessageIntentById:io.getIntent,updateIntentLifecycle:io.lifecycle}))
vi.mock('@/lib/ediel/flows/shared',()=>({ensureActorUserId:(id:string)=>{if(!id)throw Error('actor_required');return id},makeServerClient:async()=>({}),findOrCreateSwitchOutbound:io.outboundSwitch,finalizeOutboundDraft:io.finalize,queuePreparedEdielMessage:io.queue}))
vi.mock('@/lib/ediel/db',()=>({linkEdielMessage:io.link,getEdielMessageById:io.message}))

const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const A=uid(1),B=uid(2),K=uid(3),actor=uid(4),point='735999888000000017',foreignPoint='735999888000000024'
const legalA='12345',legalB='21660',dso='54321',gridexTransport='99111',customerA=uid(11),customerB=uid(21)
const intents=new Map<string,EdielMessageIntent>(),drafts:CreateEdielMessageInput[]=[]
let persisted:EdielMessageRow|null=null,permission=uid(26),allowed=true,sourceContext:Record<string,unknown>,basis:ServicePermissionOriginBasis
const invoicee=selectedInvoiceeFact(point,A,'9','199001011234',['A Street'],'SE2','12345','A Town')
const site={id:uid(12),company_id:A,customer_id:customerA,facility_id:point,grid_owner_id:uid(15),move_in_date:'2026-10-20',street:'Installation Street',postal_code:'12345',city:'A Town',country:'SE'}
const meter={id:uid(13),company_id:A,site_id:site.id,customer_id:customerA,meter_point_id:point,grid_owner_id:uid(15),grid_area_code:'TES'}
const switchRow={id:uid(10),customer_contract_id:uid(14),company_id:A,customer_id:customerA,site_id:site.id,metering_point_id:meter.id,grid_owner_id:uid(15),requested_start_date:'2026-10-20',request_type:'supplier_switch',status:'draft',power_of_attorney_id:uid(16),authorization_document_id:uid(17),prodat_variant:'L',prodat_reason:'Z22',validation_snapshot:{portalData:{facilityId:point,customerId:'SAVED-PREVIEW',customerIdAgency:'89',customerName:'Saved Preview',customerCountry:'SE',customerAddress:'A Street',customerPostalCode:'12345',customerCity:'A Town',siteAddress:'Installation Street',siteCountry:'SE',gridAreaId:'TES',powerOfAttorneyReference:'A-POA',agreementStartDateTime:'202610200000',validityDateTime:'202610200000',reasonForTransaction:'Z22',observationLength:'15',observationLengthFormat:'806',registers:[],meteringMethod:'Z03',reportingFrequency:'D',productCode:'8716867000030',settlementMethod:'D',installationStatus:'E22',dependentConditionFacts:{market:'electricity',invoiceeObjects:[invoicee]}}}}
const contractBasis={status:'authorized',declarationId:uid(18),companyId:A,environment:'test',contractId:uid(14),contractRevision:'1',protectedContractHash:'a'.repeat(64),agreementSha256:'b'.repeat(64),customerId:customerA,siteId:site.id,meteringPointId:meter.id,pointId:point,identityAgency:'9',legalActorId:uid(19),legalSenderId:legalA,legalReceiverId:dso,gridArea:'TES',requestedMethod:'Z04',sourceReference:'synthetic signed A declaration',sourceVersion:'1',sourceDigest:'c'.repeat(64)}
function route(company:string,legal:string,app:string,role:string){return {companyId:company,environment:'test',actor:{tenantIdentity:{legalActorId:company===A?uid(19):uid(29)},legalActorEdielId:legal,marketRoles:[role]},senderEdielId:company===A?legalA:gridexTransport,senderName:company===A?'A own transport':'Shared transport',receiverEdielId:dso,receiverName:'DSO',receiverEmail:'dso@example.invalid',senderSubAddress:company===A?'DDQ':null,receiverSubAddress:company===A?'DDQ':null,receiverMessageSubAddress:null,applicationReference:app,route:{id:uid(company===A?31:32)},routeDecision:{edielRouteProfileId:uid(33)},routeRuntime:{route_profile_id:uid(34)},defaultMessageVersion:'26.A',mailbox:null}}

beforeEach(()=>{
 vi.resetAllMocks();intents.clear();drafts.length=0;persisted=null;allowed=true;permission=uid(26)
 sourceContext={companyId:A,tenantIssues:[],customer:{id:customerA,company_id:A,personal_number:'199001011234',full_name:'A Legal Customer'},site,meteringPoint:meter,contacts:[],contract:null,customerLifeEvent:{status:'authorized',companyId:A,customerId:customerA,sourceMessageId:uid(50),customerVersion:1,effectiveVersionCount:1,customerFields:{},endUserMasterdata:{street:['A Street'],postCode:'12345',city:'A Town',country:'SE'}}}
 basis={status:'authorized',companyId:B,assignmentId:uid(22),assignmentVersion:1,scopeBasisVersion:1,permissionId:permission,permissionStateVersion:0,code:'Z13',environment:'test',providerActorId:uid(29),dsoActorId:uid(30),legalSenderId:legalB,legalReceiverId:dso,customerId:customerB,customer:{id:customerB,company_id:B,org_number:'5560160680',company_name:'B Legal Customer',billing_country:'SE',billing_street:'B Street',billing_postal_code:'54321',billing_city:'B Town'},mode:'V',agreementReference:'B-DSO-CUSTOMER-AGREEMENT',requestedMethod:'Z04',purposeCode:'B72',frequency:'D',reportingTerm:'bounded',customerClassification:'nonprivate',terminationReason:null,evidenceId:uid(27),evidenceSha256:'d'.repeat(64),evidenceVersion:'declared synthetic source port',li:null,requestTiming:{version:1,evidenceId:uid(27),sourceHash:'d'.repeat(64),sourceReference:'synthetic DSO customer contract',sourceVersion:'1',networkStart:'2026-01-01',networkEnd:'2027-01-01',reviewId:uid(28),reviewerUserId:actor,reviewSequence:1,scopeBasisVersion:1,requestDay:'2026-10-05'},objects:[{point:null,permissionId:null,product:'8716867000030',gridArea:'TES',reportStart:'2026-10-05T00:00:00+01:00',reportEnd:'2027-01-01T00:00:00+01:00'}]}
 io.switch.mockResolvedValue(switchRow);io.site.mockResolvedValue(site);io.point.mockResolvedValue(meter);io.owner.mockResolvedValue({id:uid(15),ediel_id:dso,owner_code:'TES'});io.context.mockImplementation(async()=>sourceContext)
 io.routeSwitch.mockResolvedValue(route(A,legalA,'23-DDQ-PRODAT','supplier'));io.routeService.mockResolvedValue(route(B,legalB,'23-DGI-PRODAT','energy_service_company'))
 io.rule.mockResolvedValue({rulePackId:uid(35),messageProfileId:uid(36),profileKey:'PRODAT-Z03-L',originalVersion:'26.A',fieldMatrixVersion:'26.A'})
 io.outboundSwitch.mockResolvedValue({id:uid(37)});io.outboundService.mockResolvedValue({id:uid(38)})
 io.createIntent.mockImplementation(async(input:CreateEdielMessageIntentInput)=>{const validation=evaluateIntentValidation(input);const intent={...input,id:input.companyId===A?uid(41):uid(42),direction:'outbound',validationStatus:validation.status,blockingReasons:validation.blockingReasons,renderStatus:'not_rendered',outboxStatus:'not_queued'} as EdielMessageIntent;intents.set(intent.id,intent);return intent})
 io.getIntent.mockImplementation(async(id:string)=>intents.get(id)??null)
 io.finalize.mockImplementation(async({draft}:{draft:CreateEdielMessageInput})=>{drafts.push(draft);persisted={id:uid(43),company_id:draft.companyId,intent_id:draft.intentId,outbound_request_id:draft.outboundRequestId,source_operation_id:draft.sourceOperationId,direction:'outbound',message_family:draft.messageFamily,message_code:draft.messageCode,message_version:draft.messageVersion,status:'draft',raw_payload:draft.rawPayload,parsed_payload:draft.parsedPayload,external_reference:draft.externalReference,customer_id:draft.customerId} as EdielMessageRow;return persisted})
 io.from.mockImplementation((table:string)=>{const filters:Record<string,unknown>={};const query={select:()=>query,eq:(key:string,value:unknown)=>{filters[key]=value;return query},not:()=>query,contains:()=>query,order:()=>query,limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:table==='company_memberships'?{company_id:filters.company_id,user_id:actor,status:'active',is_active:true,accepted_at:'2026-01-01'}:table==='user_profiles'?{id:actor,user_status:'active'}:null,error:null})};if(!['company_memberships','user_profiles','outbound_requests'].includes(table))throw Error(`undeclared_table:${table}`);return query})
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const result=(data:unknown)=>({data,error:null})
  if(name==='gridex_actor_has_company_permission')return result(allowed)
  if(name==='gridex_assert_supplier_switch_ready')return result(null)
  if(name==='ediel_contract_metering_request_source_v1')return result(contractBasis)
  if(name==='ediel_brp_field_source_v1')return result({...contractBasis,sourceKind:'signed_contract_brp_declaration',at:args.p_at,supplyPeriodId:null,brpEdielId:'11111'})
  if(name==='ediel_bind_switch_original_v1')return result({status:'bound',messageId:persisted?.id})
  if(name==='ediel_coordinate_service_permission_v1')return result({status:'permission_required',permissionId:permission})
  if(name==='ediel_resolve_service_permission_command_v1')return result({status:'permission_required',permissionId:permission})
  if(name==='ediel_service_permission_origin_v1')return result(basis)
  if(name==='ediel_reserve_service_permission_origin_v1')return result({status:'reserved',messageId:persisted?.id??null})
  throw Error(`undeclared_rpc:${name}`)
 })
})
const orderA=()=>prepareAndQueueEdielZ03({actorUserId:actor,switchRequestId:switchRow.id,environment:'test'})
const orderB=()=>prepareAndQueueServicePermissionZ13({providerCompanyId:B,assignmentId:uid(22),actorUserId:actor,expectedVersion:1})
const segments=(raw:string)=>tokenizeEdifact(raw).segments.map(segment=>segment.raw)

describe('SC001 own legal supplier public Z03L order',()=>{
 it('queues A DDQ, legal A/customer/object and L/Z22 through the real switch gateway; no B or Gridex substitution',async()=>{
  const message=await orderA(),draft=drafts[0],wire=segments(draft.rawPayload!),intent=[...intents.values()][0]
  expect(message.company_id).toBe(A);expect(evaluateIntentValidation(intent).ok).toBe(true)
  expect(wire[0]).toContain(`UNB+UNOC:3+${legalA}:ZZ:DDQ+${dso}:ZZ:DDQ`);expect(wire[0]).toContain('23-DDQ-PRODAT')
  expect(wire).toEqual(expect.arrayContaining([expect.stringContaining(`NAD+FR+${legalA}:160:SVK`),expect.stringContaining(`NAD+DO+${dso}:160:SVK`)]))
  expect(draft.rawPayload).toContain('NAD+UD+199001011234:SE2:260++A Legal Customer')
  expect(parseProdatMessage(draft.rawPayload!).lineItems.map(object=>object.meteringPointId)).toEqual([point])
  expect(intent.payload).toMatchObject({transactionSubtype:'L',reasonForTransaction:'Z22',actorRole:'supplier'})
  expect(draft.rawPayload).toContain('CAV+Z22');expect(draft.parsedPayload).toMatchObject({prodatVariant:'L',reasonForTransaction:'Z22'})
  for(const forbidden of [legalB,gridexTransport,foreignPoint,'B FOREIGN SENTINEL',customerB])expect(draft.rawPayload).not.toContain(forbidden)
  expect(io.rpc).toHaveBeenCalledWith('gridex_assert_supplier_switch_ready',{p_company_id:A,p_contract_id:uid(14)})
  expect(io.context).toHaveBeenCalledWith(expect.objectContaining({companyId:A,customerId:customerA,siteId:site.id,meteringPointId:meter.id,actorUserId:actor}))
  expect(io.rpc).toHaveBeenCalledWith('ediel_bind_switch_original_v1',{p_company_id:A,p_switch_id:switchRow.id,p_message_id:message.id,p_actor_user_id:actor})
  const bound=io.rpc.mock.calls.findIndex(([name])=>name==='ediel_bind_switch_original_v1')
  expect(io.rpc.mock.invocationCallOrder[bound]).toBeLessThan(io.queue.mock.invocationCallOrder[0])
  expect(io.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({messageId:message.id,intentId:intent.id,outboundRequestId:uid(37),actorUserId:actor}))
  expect(io.outboundService).not.toHaveBeenCalled();expect(io.routeService).not.toHaveBeenCalled()
 })
 it('holds a selected B customer/point source before persistence or queue',async()=>{
  sourceContext={...sourceContext,companyId:B,customer:{id:customerB,company_id:B,full_name:'B FOREIGN SENTINEL'},meteringPoint:{...meter,meter_point_id:foreignPoint}}
  await expect(orderA()).rejects.toThrow('prodat_selected_customer_site_point_scope_mismatch');expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it('holds current actor denial before protected customer source or physical persistence',async()=>{
  allowed=false;await expect(orderA()).rejects.toThrow('ediel_tenant_permission_forbidden');expect(io.context).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
})
describe('SC002 own legal ESCO public Z13V order',()=>{
 it('coordinates a distinct internal permission and queues B DGI/actual customer, never a Z03 or Gridex legal actor',async()=>{
  const result=await orderB(),draft=drafts[0],wire=segments(draft.rawPayload!),intent=[...intents.values()][0]
  if(result.status!=='queued')throw Error(`unexpected_permission_result:${JSON.stringify(result)}`)
  expect(result.status).toBe('queued');expect(evaluateIntentValidation(intent).ok).toBe(true)
  expect(wire[0]).toContain(`UNB+UNOC:3+${gridexTransport}:ZZ+${dso}:ZZ`);expect(wire[0]).toContain('23-DGI-PRODAT')
  expect(wire).toEqual(expect.arrayContaining([expect.stringContaining(`NAD+FR+${legalB}:160:SVK`),expect.stringContaining(`NAD+DO+${dso}:160:SVK`)]))
  expect(draft.rawPayload).toContain('B Legal Customer');expect(draft.rawPayload).toContain('CAV+S17');expect(draft.rawPayload).toContain('RFF+ANJ:B-DSO-CUSTOMER-AGREEMENT')
  expect(draft).toMatchObject({companyId:B,customerId:customerB,sourceOperationId:permission,messageCode:'Z13',processType:'metering_access'})
  expect(intent).toMatchObject({companyId:B,customerId:customerB,operationId:permission,businessProcess:'metering_permission',payload:{actorRole:'esco'}})
  expect(io.rpc).toHaveBeenCalledWith('ediel_coordinate_service_permission_v1',{p_provider_company_id:B,p_assignment_id:uid(22),p_actor_user_id:actor,p_expected_version:1,p_command:'request_access'})
  expect(io.rpc).toHaveBeenCalledWith('ediel_service_permission_origin_v1',{p_company_id:B,p_assignment_id:uid(22),p_actor_user_id:actor,p_expected_version:1,p_permission_id:permission,p_code:'Z13'})
  expect(io.outboundService).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({customerId:customerB,operationId:permission,payload:expect.objectContaining({serviceAssignmentId:uid(22),permissionId:permission,messageCode:'Z13'})}))
  expect(io.rpc.mock.calls.filter(([name])=>name==='ediel_reserve_service_permission_origin_v1')).toHaveLength(2)
  expect(io.rpc).toHaveBeenCalledWith('ediel_reserve_service_permission_origin_v1',{p_company_id:B,p_assignment_id:uid(22),p_actor_user_id:actor,p_expected_version:1,p_permission_id:permission,p_code:'Z13',p_intent_id:intent.id})
  const reserved=io.rpc.mock.calls.findLastIndex(([name])=>name==='ediel_reserve_service_permission_origin_v1')
  expect(io.rpc.mock.invocationCallOrder[reserved]).toBeLessThan(io.queue.mock.invocationCallOrder[0])
  expect(io.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({messageId:result.message?.id,intentId:intent.id,outboundRequestId:uid(38)}))
  for(const forbidden of [A,K,permission,customerA,point,'A Legal Customer',`NAD+FR+${gridexTransport}`,`NAD+FR+${legalA}`,'23-DDQ-PRODAT'])expect(draft.rawPayload).not.toContain(forbidden)
  expect(io.switch).not.toHaveBeenCalled();expect(io.outboundSwitch).not.toHaveBeenCalled();expect(drafts.map(row=>row.messageCode)).toEqual(['Z13'])
 })
 it('holds substituted platform legal identity before intent or permission wire',async()=>{
  io.routeService.mockResolvedValue({...route(B,legalB,'23-DGI-PRODAT','energy_service_company'),actor:{tenantIdentity:{legalActorId:uid(99)},legalActorEdielId:gridexTransport,marketRoles:['energy_service_company']}})
  await expect(orderB()).rejects.toThrow('ediel_permission_canonical_legal_esco_required');expect(io.createIntent).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it('holds missing assessed source instead of inventing representation from a customer contract',async()=>{
  const original=io.rpc.getMockImplementation()!;io.rpc.mockImplementation((name,args)=>name==='ediel_service_permission_origin_v1'?Promise.resolve({data:{status:'held',missing:['assessed_network_customer_source_required']},error:null}):original(name,args))
  expect(await orderB()).toEqual({status:'held',missing:['assessed_network_customer_source_required']});expect(io.createIntent).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it('holds current tenant permission before permission coordination or source access',async()=>{
  allowed=false;await expect(orderB()).rejects.toThrow('ediel_tenant_permission_forbidden');expect(io.rpc.mock.calls.some(([name])=>name==='ediel_coordinate_service_permission_v1')).toBe(false);expect(io.createIntent).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it('does not queue a permission when the current original reservation is held',async()=>{
  const original=io.rpc.getMockImplementation()!;io.rpc.mockImplementation((name,args)=>name==='ediel_reserve_service_permission_origin_v1'?Promise.resolve({data:{status:'held',missing:['current_permission_scope_changed']},error:null}):original(name,args))
  expect(await orderB()).toMatchObject({status:'blocked',message:null,blockingReasons:[{code:'current_permission_scope_changed'}]})
  expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(io.switch).not.toHaveBeenCalled()
 })
})
