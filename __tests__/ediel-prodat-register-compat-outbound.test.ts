import { selectedAddressFact } from './fixtures/prodat-ud'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProdatZ03FromSwitch, buildProdatZ04FromSwitch, buildProdatZ06FromSwitch, buildProdatZ10FromSwitch,
  validateProdatSwitchContext, type ProdatSwitchCode,
} from '@/lib/ediel/prodat/compatAdapter'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'

const io=vi.hoisted(()=>({from:vi.fn(()=>{throw new Error('unexpected database access')})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from}}))
type Input=Parameters<typeof buildProdatZ04FromSwitch>[0]
const id='735999888000000017'
const facts={market:'electricity',registerObjects:[{meteringPointId:id,identityAgency:'9',expectedRegisterCount:2,meterReadingsSentInUtilts:false}]}
const registers=[{annualEnergyKwh:'10'},{annualEnergyKwh:'20'}]
const source=()=>({facilityId:id,customerId:'USER',customerIdAgency:'89',powerOfAttorneyReference:'POA',customerName:'Synthetic',customerAddress:'Street',customerPostalCode:'12345',customerCity:'Town',customerCountry:'SE',siteAddress:'Street',siteCountry:'SE',gridAreaId:'TES',agreementStartDateTime:'202610010000',validityDateTime:'202610010000',reasonForTransaction:'Z22',observationLength:'15',observationLengthFormat:'806',registers,dependentConditionFacts:facts,meteringMethod:'Z03',reportingFrequency:'D',meterNumber:'NEW',oldMeterNumber:'OLD',productCode:'8716867000030',settlementMethod:'D',installationStatus:'E22',balanceResponsibleId:'12345'})
const input=():Input=>({actorUserId:'actor',senderEdielId:'12345',receiverEdielId:'54321',senderSubAddress:'DDQ',receiverSubAddress:'DDQ',applicationReference:'23-DDQ-PRODAT',environment:'test',
 switchRequest:{id:'switch',company_id:'company',customer_id:'customer',site_id:'site',metering_point_id:'meter',grid_owner_id:'owner',requested_start_date:'2026-10-01',request_type:'supplier_switch',status:'draft',current_supplier_name:'Existing',power_of_attorney_id:'poa',validation_snapshot:{portalData:source()}},
 site:{id:'site',company_id:'company',customer_id:'customer',facility_id:id,grid_owner_id:'owner',move_in_date:'2026-10-01',street:'Street',postal_code:'12345',city:'Town'},
 meteringPoint:{id:'meter',company_id:'company',site_id:'site',customer_id:'customer',meter_point_id:id,grid_owner_id:'owner'},gridOwner:{id:'owner',ediel_id:'54321',owner_code:'TES'},
// Synthetic partial database rows: fields unused by this adapter are omitted.
} as unknown as Input)
beforeEach(()=>{vi.clearAllMocks()})

// Saved switch context is a distinct real caller of the shared renderer. Only
// external database access is disabled; engine, envelope and preflight are real.
describe('saved switch compatibility respects operational direction',()=>{
 it.each([['Z04',buildProdatZ04FromSwitch],['Z06',buildProdatZ06FromSwitch],['Z10',buildProdatZ10FromSwitch]] as const)('keeps supplier outbound %s blocked instead of confusing catalog/TGT support with production capability',async(code,build)=>{
  await expect(build(input())).rejects.toThrow(`prodat_outbound_direction_not_allowed:${code}`)
  expect(io.from).not.toHaveBeenCalled()
 })
 it('retains the supported single-object Z03 flow while the shared renderer handles registers elsewhere',async()=>{
  const p=input();p.switchRequest.validation_snapshot={portalData:{...source(),registers:[],dependentConditionFacts:{market:'electricity',endUserAddressObjects:[selectedAddressFact(id,'company','9','USER',['Street'])]}}}
  const draft=await buildProdatZ03FromSwitch(p)
  const parsed=parseProdatMessage(draft.rawPayload!)
  expect(parsed.lineItems.map(line=>[line.meteringPointId,line.lineSequenceNumber,line.registerIndex])).toEqual([[id,'1',null]])
  expect(draft).toMatchObject({direction:'outbound',messageCode:'Z03',environment:'test',status:'draft',testFlag:1,switchRequestId:'switch',customerId:'customer',siteId:'site',meteringPointId:'meter'})
  expect(io.from).not.toHaveBeenCalled()
 })
 it('does not permit a multi-register snapshot on the supplier Z03 path',async()=>{
  await expect(buildProdatZ03FromSwitch(input())).rejects.toThrow(/register/)
  expect(io.from).not.toHaveBeenCalled()
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
