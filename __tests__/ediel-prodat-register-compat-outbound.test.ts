import { selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProdatZ03FromSwitch, buildProdatZ09FromSwitch, buildProdatZ04FromSwitch, buildProdatZ06FromSwitch, buildProdatZ10FromSwitch,
  validateProdatSwitchContext, type ProdatSwitchCode,
} from '@/lib/ediel/prodat/compatAdapter'
import {prepareCustomerMasterdataSource} from '@/lib/ediel/production/customerMasterdataSource'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'

const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(()=>{throw new Error('unexpected database access')}),getCustomerExportContext:vi.fn(),assertEdielTenantActor:vi.fn(),readContractRequestedMethodSource:vi.fn(),prepareQualifiedBrpSource:vi.fn()}))
vi.mock('@/lib/cis/db-shared',async importOriginal=>({...await importOriginal<typeof import('@/lib/cis/db-shared')>(),getCustomerExportContext:io.getCustomerExportContext}))
vi.mock('@/lib/ediel/production/contractRequestedMethodSource',async importOriginal=>({...await importOriginal<typeof import('@/lib/ediel/production/contractRequestedMethodSource')>(),readContractRequestedMethodSource:io.readContractRequestedMethodSource}))
vi.mock('@/lib/ediel/production/brpFieldSource',()=>({prepareQualifiedBrpSource:io.prepareQualifiedBrpSource}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.assertEdielTenantActor}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
type Input=Parameters<typeof buildProdatZ04FromSwitch>[0]
const id='735999888000000017'
const facts={market:'electricity',registerObjects:[{meteringPointId:id,identityAgency:'9',expectedRegisterCount:2,meterReadingsSentInUtilts:false}]}
const registers=[{annualEnergyKwh:'10'},{annualEnergyKwh:'20'}]
const source=()=>({facilityId:id,customerId:'USER',customerIdAgency:'89',powerOfAttorneyReference:'POA',customerName:'Synthetic',customerAddress:'Street',customerPostalCode:'12345',customerCity:'Town',customerCountry:'SE',siteAddress:'Street',siteCountry:'SE',gridAreaId:'TES',agreementStartDateTime:'202610010000',validityDateTime:'202610010000',reasonForTransaction:'Z22',observationLength:'15',observationLengthFormat:'806',registers,dependentConditionFacts:facts,meteringMethod:'Z03',reportingFrequency:'D',meterNumber:'NEW',oldMeterNumber:'OLD',productCode:'8716867000030',settlementMethod:'D',installationStatus:'E22',balanceResponsibleId:'12345'})
const input=():Input=>({actorUserId:'actor',senderEdielId:'12345',receiverEdielId:'54321',senderSubAddress:'DDQ',receiverSubAddress:'DDQ',applicationReference:'23-DDQ-PRODAT',environment:'test',
 switchRequest:{id:'switch',customer_contract_id:'contract',company_id:'company',customer_id:'customer',site_id:'site',metering_point_id:'meter',grid_owner_id:'owner',requested_start_date:'2026-10-01',request_type:'supplier_switch',status:'draft',current_supplier_name:'Existing',power_of_attorney_id:'poa',validation_snapshot:{portalData:source()}},
 site:{id:'site',company_id:'company',customer_id:'customer',facility_id:id,grid_owner_id:'owner',move_in_date:'2026-10-01',street:'Street',postal_code:'12345',city:'Town'},
 meteringPoint:{id:'meter',company_id:'company',site_id:'site',customer_id:'customer',meter_point_id:id,grid_owner_id:'owner'},gridOwner:{id:'owner',ediel_id:'54321',owner_code:'TES'},
// Synthetic partial database rows: fields unused by this adapter are omitted.
} as unknown as Input)
beforeEach(()=>{vi.clearAllMocks();io.assertEdielTenantActor.mockResolvedValue(undefined);io.readContractRequestedMethodSource.mockResolvedValue({status:'authorized',companyId:'company',environment:'test',contractId:'contract',customerId:'customer',siteId:'site',meteringPointId:'meter',pointId:id,identityAgency:'9',legalSenderId:'12345',legalReceiverId:'54321',legalActorId:'legal',requestedMethod:'Z04'});io.prepareQualifiedBrpSource.mockResolvedValue({status:'authorized',sourceKind:'signed_contract_brp_declaration',companyId:'company',environment:'test',contractId:'contract',customerId:'customer',siteId:'site',meteringPointId:'meter',pointId:id,identityAgency:'9',legalSenderId:'12345',legalReceiverId:'54321',legalActorId:'legal',brpEdielId:'11111'});const p=input();io.getCustomerExportContext.mockResolvedValue({companyId:'company',tenantIssues:[],customer:{id:'customer',company_id:'company',personal_number:'199001011234',full_name:'Source Customer'},site:{...p.site,country:'SE'},meteringPoint:{...p.meteringPoint,grid_area_code:'TES'},contacts:[],contract:null,customerLifeEvent:{status:'authorized',companyId:'company',customerId:'customer',sourceMessageId:'source',customerVersion:1,effectiveVersionCount:1,customerFields:{},endUserMasterdata:{street:['Street'],postCode:'12345',city:'Town',country:'SE'}}})})

// Saved switch context is a distinct real caller of the shared renderer. Only
// external database access is disabled; engine, envelope and preflight are real.
describe('saved switch compatibility respects operational direction',()=>{
 it.each([['Z04',buildProdatZ04FromSwitch],['Z06',buildProdatZ06FromSwitch],['Z10',buildProdatZ10FromSwitch]] as const)('keeps supplier outbound %s blocked instead of confusing catalog/TGT support with production capability',async(code,build)=>{
  await expect(build(input())).rejects.toThrow(`prodat_outbound_direction_not_allowed:${code}`)
  expect(io.from).not.toHaveBeenCalled()
 })
 it('retains the supported single-object Z03 flow while the shared renderer handles registers elsewhere',async()=>{
  const p=input();p.switchRequest.validation_snapshot={portalData:{...source(),registers:[],dependentConditionFacts:{market:'electricity',endUserAddressObjects:[selectedAddressFact(id,'company','9','USER',['Street'])],invoiceeObjects:[{...selectedInvoiceeFact(id,'company','9','199001011234',['Street'],'','12345','Town'),endUser:{identity:{id:'199001011234',qualifier:'SE2',agency:'260'},address:selectedInvoiceeFact(id,'company','9','199001011234',['Street'],'','12345','Town').endUser.address}}]}}}
  const draft=await buildProdatZ03FromSwitch(p)
  const parsed=parseProdatMessage(draft.rawPayload!)
  expect(parsed.lineItems.map(line=>[line.meteringPointId,line.lineSequenceNumber,line.registerIndex])).toEqual([[id,'1',null]])
  expect(draft).toMatchObject({direction:'outbound',messageCode:'Z03',environment:'test',status:'draft',testFlag:1,switchRequestId:'switch',customerId:'customer',siteId:'site',meteringPointId:'meter'})
  expect(io.getCustomerExportContext).toHaveBeenCalledWith({companyId:'company',customerId:'customer',siteId:'site',meteringPointId:'meter',actorUserId:'actor',environment:'test',requireCustomerMasterdata:true,asOf:'2026-09-30T23:00:00.000Z'})
  expect(draft.rawPayload).toContain('NAD+UD+199001011234:SE2:260++Source Customer')
  expect(draft.rawPayload).not.toContain('USER:')
  expect(draft.rawPayload).toContain("CCI++Z04'CAV+Z04'")
  expect(draft.rawPayload).toContain('NAD+Z02+11111:160:SVK')
  expect(io.readContractRequestedMethodSource).toHaveBeenCalledWith({companyId:'company',contractId:'contract',actorUserId:'actor',environment:'test'})
  expect(io.assertEdielTenantActor).toHaveBeenCalledWith({companyId:'company',actorUserId:'actor',permissionAnyOf:['communication.write','ediel_testing.write']})
  const own=(draft.parsedPayload?.prodatEngine as {registerEvidence?:{facts?:{endUserAddressObjects?:unknown[]}}})?.registerEvidence?.facts?.endUserAddressObjects
  expect(own).toEqual([expect.objectContaining({meteringPointId:id,endUser:{id:'199001011234',qualifier:'SE2',agency:'260'},source:expect.objectContaining({companyId:'company',kind:'caller_selection'})})])
  expect(io.from).not.toHaveBeenCalled()
 })
 it('uses protected literal end-user name and address components separately from the installation address',async()=>{
  const p=input(),lines=['End-user street','','Box 12'],invoicee=selectedInvoiceeFact(id,'company','9','199001011234',lines,'SE2','45678','Owned Town','FI')
  p.switchRequest.validation_snapshot={portalData:{...source(),registers:[],dependentConditionFacts:{market:'electricity',invoiceeObjects:[invoicee]}}}
  io.getCustomerExportContext.mockResolvedValue({companyId:'company',tenantIssues:[],customer:{id:'customer',company_id:'company',personal_number:'199001011234',full_name:'Source Legal Customer'},site:{...p.site,country:'SE'},meteringPoint:{...p.meteringPoint,grid_area_code:'TES'},contacts:[],contract:null,
   customerLifeEvent:{status:'authorized',companyId:'company',customerId:'customer',sourceMessageId:'source',customerVersion:2,effectiveVersionCount:1,customerFields:{},endUserMasterdata:{name:['Source','Legal Customer'],street:lines,postCode:'45678',city:'Owned Town',country:'FI'}}})
  const draft=await buildProdatZ03FromSwitch(p)
  expect(draft.rawPayload).toContain('NAD+UD+199001011234:SE2:260++Source:Legal Customer+End-user street::Box 12+Owned Town++45678+FI')
  expect(draft.rawPayload).not.toContain('Source:Legal Customer+Street')
 })
 it('holds absent own UD source despite complete installation and saved customer previews',async()=>{
  const p=input();p.switchRequest.validation_snapshot={portalData:{...source(),registers:[],dependentConditionFacts:{market:'electricity'}}}
  io.getCustomerExportContext.mockResolvedValue({companyId:'company',tenantIssues:[],customer:{id:'customer',company_id:'company',personal_number:'199001011234',full_name:'Source Customer'},site:{...p.site,country:'SE'},meteringPoint:{...p.meteringPoint,grid_area_code:'TES'},contacts:[],contract:null,customerLifeEvent:null})
  await expect(buildProdatZ03FromSwitch(p)).rejects.toThrow('prodat_render_blocked:Z03')
  expect(io.from).not.toHaveBeenCalled()
 })
 it('does not request unrelated customer address authority for a source-forbidden Z09F end-user group',async()=>{
  const p=input();p.switchRequest.validation_snapshot={portalData:{...source(),reasonForTransaction:'E64',registers:[]}}
  const context=await io.getCustomerExportContext();io.getCustomerExportContext.mockResolvedValue({...context,customer:{id:'customer',company_id:'company'},customerLifeEvent:null})
  // The actual legacy path may still hold missing independent structural/event
  // authority; it must not turn a forbidden UD group into a new legal-ID need.
  const outcome=await buildProdatZ09FromSwitch(p).then(()=>null,(error:Error)=>error)
  expect(outcome?.message).not.toContain('prodat_customer_legal_identity_required')
  expect(io.getCustomerExportContext).toHaveBeenLastCalledWith(expect.objectContaining({requireCustomerMasterdata:false}))
 })
 it('passes the selected protected registered customer context into the real ordinary draft',async()=>{
  const p=input(),invoicee=selectedInvoiceeFact(id,'company','9','199001011234',['Street'],'SE2','12345','Town','SE')
  p.switchRequest.validation_snapshot={portalData:{...source(),registers:[],dependentConditionFacts:{market:'electricity',invoiceeObjects:[invoicee]}}}
  io.rpc.mockResolvedValueOnce({error:null,data:{status:'authorized',companyId:'company',customerId:'customer',environment:'test',asOf:'2026-10-01T00:00:00Z',sourceKind:'registered_customer_address',sourceReference:'source',sourceDigest:'d'.repeat(64),sourceContextId:'00000000-0000-4000-8000-000000000111',customerIdentity:{id:'199001011234',qualifier:'SE2',agency:'260'},endUserMasterdata:{nameParts:['Registered','Own name'],streetParts:['Street'],postalCode:'12345',city:'Town',country:'SE'}}})
  io.getCustomerExportContext.mockResolvedValue({companyId:'company',tenantIssues:[],customer:{id:'customer',company_id:'company',personal_number:'MUTABLE',full_name:'Mutable name'},site:{...p.site,country:'SE'},meteringPoint:{...p.meteringPoint,grid_area_code:'TES'},contacts:[],contract:null,customerLifeEvent:null,
   customerMasterdata:await prepareCustomerMasterdataSource({companyId:'company',customerId:'customer',actorUserId:'actor',environment:'test',asOf:'2026-10-01T00:00:00Z'})})
  const draft=await buildProdatZ03FromSwitch(p)
  expect(draft.rawPayload).toContain('NAD+UD+199001011234:SE2:260++Registered:Own name+Street+Town++12345+SE')
  expect(draft.rawPayload).not.toContain('MUTABLE')
  expect(draft.parsedPayload?.customerMasterdataSourceContextId).toBe('00000000-0000-4000-8000-000000000111')
 })
 it('holds missing new-agreement declaration even when portal and prior DSO method look usable',async()=>{
  io.readContractRequestedMethodSource.mockResolvedValue({status:'held',missing:['unique_authentic_new_agreement_requested_method_declaration']})
  await expect(buildProdatZ03FromSwitch(input())).rejects.toThrow('prodat_new_agreement_requested_method_held')
 })
 it('holds missing actual new-agreement BRP declaration despite a saved BRP preview',async()=>{
  io.prepareQualifiedBrpSource.mockResolvedValue({status:'held',missing:['unique_authentic_signed_contract_brp_declaration']})
  await expect(buildProdatZ03FromSwitch(input())).rejects.toThrow('prodat_new_agreement_brp_held')
 })
 it('rejects unrelated signed-declaration scope rather than substituting its method',async()=>{
  io.readContractRequestedMethodSource.mockResolvedValue({status:'authorized',companyId:'company',environment:'test',contractId:'contract',customerId:'other',siteId:'site',meteringPointId:'meter',requestedMethod:'Z04'})
  await expect(buildProdatZ03FromSwitch(input())).rejects.toThrow('contract_requested_method_selected_scope_mismatch')
 })
 it('does not permit a multi-register snapshot on the supplier Z03 path',async()=>{
  await expect(buildProdatZ03FromSwitch(input())).rejects.toThrow(/register/)
  expect(io.getCustomerExportContext).toHaveBeenCalledTimes(1)
  expect(io.from).not.toHaveBeenCalled()
 })
 it('defers own-wire phase but holds missing invoicee source facts before draft persistence',async()=>{
  const p=input();p.switchRequest.validation_snapshot={portalData:{...source(),registers:[],dependentConditionFacts:{market:'electricity',invoiceeAddressDiffersFromEndUser:false}}}
  await expect(buildProdatZ03FromSwitch(p)).rejects.toMatchObject({issues:expect.arrayContaining([expect.objectContaining({code:'PRODAT_DEPENDENT_CONDITION_UNDETERMINED',description:expect.stringContaining('oberoende valt underlag saknas')})])})
  expect(io.from).not.toHaveBeenCalled()
 })
 it('denies the actual tenant actor before any source read',async()=>{
  io.assertEdielTenantActor.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
  await expect(buildProdatZ03FromSwitch(input())).rejects.toThrow('ediel_tenant_actor_forbidden')
  expect(io.getCustomerExportContext).not.toHaveBeenCalled()
 })
 it('holds a foreign or unrelated selected source before rendering',async()=>{
  io.getCustomerExportContext.mockResolvedValue({companyId:'other',tenantIssues:[],customer:{id:'customer'},site:input().site,meteringPoint:input().meteringPoint})
  await expect(buildProdatZ03FromSwitch(input())).rejects.toThrow('prodat_selected_customer_site_point_scope_mismatch')
 })
 it('holds an actual customer with no legal identity despite a plausible saved preview',async()=>{
  const p=input();p.switchRequest.validation_snapshot={portalData:{...source(),registers:[]}}
  io.getCustomerExportContext.mockResolvedValue({companyId:'company',tenantIssues:[],customer:{id:'customer',customer_number:'INTERNAL',full_name:'Customer'},site:{...p.site,country:'SE'},meteringPoint:p.meteringPoint})
  await expect(buildProdatZ03FromSwitch(p)).rejects.toThrow('prodat_customer_legal_identity_required')
 })
})

describe('compatibility prerequisites before register rendering',()=>{
 it('rejects a real draft before rendering when sender and receiver prerequisites are missing',async()=>{
  const p=input();p.senderEdielId='';p.receiverEdielId=''
  await expect(buildProdatZ03FromSwitch(p)).rejects.toThrow('PRODAT Z03 kan inte byggas säkert ännu')
  await expect(buildProdatZ03FromSwitch(p)).rejects.toThrow('Mottagarens Ediel-id saknas')
  expect(io.from).not.toHaveBeenCalled()
 })

 const validate=(p:Input,code:ProdatSwitchCode='Z04')=>validateProdatSwitchContext({...p,code})
 it('accepts a complete context without touching the database',()=>{expect(validate(input())).toMatchObject({isReady:true,issues:[]});expect(io.from).not.toHaveBeenCalled()})
 it.each(['senderEdielId','receiverEdielId'] as const)('blocks absent %s',key=>{
  const p=input();p[key]='';expect(validate(p).issues.some(i=>i.code===(key==='senderEdielId'?'sender_ediel_id_missing':'receiver_ediel_id_missing') && i.severity==='error')).toBe(true)
 })
 it('reports every independent prerequisite instead of short-circuiting on the first missing field',()=>{
  const p=input();p.senderEdielId='';p.receiverEdielId='';p.meteringPoint.meter_point_id='';p.switchRequest.requested_start_date=null;p.site.move_in_date=null;p.switchRequest.grid_owner_id=null;p.site.grid_owner_id=null;p.meteringPoint.grid_owner_id=null;p.gridOwner=null;p.switchRequest.current_supplier_name=null;p.switchRequest.power_of_attorney_id=null
  const result=validate(p,'Z03')
  expect(result.isReady).toBe(false)
  expect(result.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['sender_ediel_id_missing','receiver_ediel_id_missing','meter_point_id_missing','start_date_missing','grid_owner_missing','grid_owner_ediel_identity_missing','current_supplier_missing','authorization_missing']))
 })
 it.each(['Z03','Z04','Z05','Z06','Z09','Z10','Z13','Z14','Z15','Z18'] as const)('keeps existing response-vs-request prerequisite severity for %s',code=>{
  const p=input();p.switchRequest.requested_start_date=null;p.site.move_in_date=null;p.switchRequest.power_of_attorney_id=null
  const result=validate(p,code)
  const severity=code==='Z04'||code==='Z14'?'warning':'error'
  expect(result.issues.filter(i=>['start_date_missing','authorization_missing'].includes(i.code))).toEqual([expect.objectContaining({code:'start_date_missing',severity}),expect.objectContaining({code:'authorization_missing',severity})])
 })
 it('warns on a mismatched move-in request without silently altering its message function',()=>{
  const p=input();p.switchRequest.request_type='move_in'
  expect(validate(p).issues).toContainEqual(expect.objectContaining({code:'message_code_request_type_mismatch',severity:'warning'}))
  expect(validate(p,'Z06').issues.some(i=>i.code==='message_code_request_type_mismatch')).toBe(false)
 })
})
