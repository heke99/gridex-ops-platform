import {describe,it,expect,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:vi.fn()}}))
import {supabaseService} from '@/lib/supabase/service'
import {readRequestedChangeSource,isRequestedChangeBasisQualified} from '@/lib/ediel/production/requestedChangeSource'
import {deathStatusSendIssue} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {validateRulebookMessage} from '@/lib/ediel/rulebook/validator'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {createProdatRegisterEvidence} from '@/lib/ediel/prodat/prodatRegisterEvidence'
import {requestedChangeRegisterFacts} from '@/lib/ediel/production/requestedChangeSource'
import {renderProdat} from '@/lib/ediel/prodat/engine'
import {requestedChangeRenderInput} from '@/lib/ediel/intent/renderers/lifeEvent'
import type {RequestedChangeBasis} from '@/lib/ediel/production/requestedChangeSource'
const address={lines:['TEST ROAD 1','',''] as const,city:'TEST',postalCode:'12345',country:'SE',representation:{convention:'SOURCE',reference:'SYNTHETIC',mode:1 as const}}
const identity={id:'199001019999',qualifier:'SE1' as const,agency:'260' as const}
const basis=(variant:'E'|'F'|'G'):RequestedChangeBasis=>({status:'authorized',companyId:'company',environment:'production',eventId:'event',variant,eventKind:variant==='E'?'death':variant==='F'?'quarter_contract':'method_contract',supplyPeriodId:'supply',supplySourceMessageId:'source',supplyStateVersion:1,customerId:'customer',meteringPointId:'point',legalActorId:'actor',legalSenderId:'12345',legalReceiverId:'54321',pointId:'735999123456789012',identityAgency:'9',gridArea:'TES',brpEdielId:'99999',effectiveAt:'2026-10-01T12:00:00Z',sourceReference:'SYNTHETIC-EVENT',sourceVersion:'1',sourceDigest:'a'.repeat(64),invoiceeProfile:{meteringPointId:'735999123456789012',identityAgency:'9',endUser:{identity,address},invoicee:{identity,nameLines:['SYNTHETIC CUSTOMER'],address,availability:'available'},event:{state:'none',reference:'SYNTHETIC'},source:{kind:'caller_selection',companyId:'company',reference:'SYNTHETIC'}},customerIdentity:{id:'199001019999',qualifier:'SE1',agency:'260',name:'SYNTHETIC CUSTOMER',addressLines:['TEST ROAD 1'],city:'TEST',postalCode:'12345',country:'SE'}})
const wire=(v:'E'|'F'|'G')=>renderProdat(requestedChangeRenderInput({basis:basis(v),senderEdielId:'12345',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',interchangeReference:'DOC',transactionReference:'LI',messageVersion:'26A',generatedAt:new Date('2026-09-30T12:00Z')})).segments.join("'")
describe('literal source Z09 requested change wire',()=>{
 it('SC030 / Z09E preserves ownUD and deathstatus without inventing a supply switch',()=>{const w=wire('E');expect(w).toContain('NAD+UD+199001019999:SE1:260');expect(w).toContain('CCI++Z17\'CAV+Z41');expect(w).toContain('CAV+E34');expect(w).toContain('DTM+157:202610011300:203');expect(w).not.toContain('DTM+92:');expect(w).not.toContain('DTM+93:')})
 it.each([['F','E64','Z04'],['G','E32','Z03']] as const)('Z09%s carries literal reason/method157 and noUD', (v,reason,method)=>{const w=wire(v);expect(w).toContain(`CAV+${reason}`);expect(w).toContain(`CCI++Z04'CAV+${method}`);expect(w).toContain('DTM+157:202610011300:203');expect(w).not.toContain('NAD+UD');expect(w).not.toContain('CAV+Z41');expect(w).not.toContain('DTM+92:')})
 it('death producer rejects bankruptcy masquerading as E34',()=>{expect(()=>requestedChangeRenderInput({basis:{...basis('E'),eventKind:'bankruptcy' as never},senderEdielId:'12345',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',interchangeReference:'DOC',transactionReference:'LI',messageVersion:'26A'})).toThrow('requested_change_variant_event_mismatch')})
 it('source-only death hold accepts the actual RPC capability and rejects copied, mutated and foreign-scope objects',async()=>{
  vi.mocked(supabaseService.rpc).mockResolvedValueOnce({data:basis('E'),error:null} as never)
  const b=await readRequestedChangeSource({companyId:'company',eventId:'event',actorUserId:'executor'});if(b.status!=='authorized')throw Error('fixture')
  const row={company_id:'company',environment:'production',direction:'outbound',message_family:'PRODAT',message_code:'Z09',source_operation_id:'event',customer_id:'customer',metering_point_id:'point',raw_payload:wire('E'),parsed_payload:{reasonForTransaction:'E34'}}
  expect(isRequestedChangeBasisQualified(b,row)).toBe(true)
  expect(deathStatusSendIssue(row,b)).toBeNull()
  expect(deathStatusSendIssue(row,{...b})).toMatchObject({code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED'})
  for(const changed of [{...row,company_id:'other'},{...row,environment:'test'},{...row,customer_id:'other'},{...row,metering_point_id:'other'},{...row,source_operation_id:'other'}])expect(deathStatusSendIssue(changed,b)).toMatchObject({code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED'})
  b.sourceVersion='forged';expect(isRequestedChangeBasisQualified(b,row)).toBe(false);expect(deathStatusSendIssue(row,b)).toMatchObject({code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED'})
 })
 it.each(['E','F','G'] as const)('production Z09%s retains actual own-wire date/party validation through the shared canonical validator',async variant=>{
  vi.mocked(supabaseService.rpc).mockResolvedValueOnce({data:basis(variant),error:null} as never)
  const b=await readRequestedChangeSource({companyId:'company',eventId:'event',actorUserId:'executor'});if(b.status!=='authorized')throw Error('fixture')
  const rendered=renderProdat(requestedChangeRenderInput({basis:b,senderEdielId:'12345',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',interchangeReference:'DOC',transactionReference:'LI',messageVersion:'26A',generatedAt:new Date('2026-09-30T12:00Z')}))
  const rawPayload=EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',interchangeReference:'DOC',applicationReference:'23-DDQ-PRODAT',environment:'production',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:96A:UN:E2SE6A',businessSegments:rendered.segments}]})
  const parsedPayload={prodatEngine:{...rendered.diagnostics,registerEvidence:createProdatRegisterEvidence({code:'Z09',rawSegments:rendered.segments,facts:requestedChangeRegisterFacts(b)})}}
  const row={companyId:'company',actorUserId:'executor',messageStandard:'edifact',environment:'production',direction:'outbound',messageFamily:'PRODAT',messageCode:'Z09',sourceOperationId:'event',customerId:'customer',meteringPointId:'point',rawPayload} as const
  const input={companyId:'company',environment:'production',direction:'outbound',family:'PRODAT',code:'Z09',applicationReference:'23-DDQ-PRODAT',version:'26A',rawPayload,parsedPayload,mode:'send',requestedChangeBasis:b,requestedChangeRow:row,admissionAt:'2026-09-30T12:00Z'} as Parameters<typeof validateRulebookMessage>[0]
  const valid=validateRulebookMessage(input);expect(valid.issues).toEqual([]);expect(valid.ok).toBe(true)
  const altered=rendered.segments.flatMap(s=>s.startsWith('DTM+157:')?['DTM+92:202610011300:203',s]:[s])
  const forbiddenRaw=EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',interchangeReference:'DOC',applicationReference:'23-DDQ-PRODAT',environment:'production',acknowledgementRequest:true,messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:96A:UN:E2SE6A',businessSegments:altered}]})
  const forbidden=validateRulebookMessage({...input,rawPayload:forbiddenRaw,parsedPayload:{prodatEngine:{...rendered.diagnostics,registerEvidence:createProdatRegisterEvidence({code:'Z09',rawSegments:altered,facts:requestedChangeRegisterFacts(b)})}}})
  expect(forbidden.ok).toBe(false);expect(forbidden.issues.some(i=>i.code==='PRODAT_DATE_EVENT_FORBIDDEN'),JSON.stringify(forbidden.issues)).toBe(true)
 })
})
