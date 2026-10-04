import {beforeEach,describe,expect,it,vi} from 'vitest'
import {prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'
import {emptySourceDecisionTimeline} from '@/lib/ediel/sources/receivedSourceDecisionTimeline'
import type {StructuralVersion} from '@/lib/ediel/sources/structuralSourceSelection'
const mocks=vi.hoisted(()=>({read:vi.fn(),rpc:vi.fn(),owned:vi.fn()}))
vi.mock('@/lib/ediel/sources/datedSourceMeasurements',()=>({readDatedSourceMeasurements:mocks.read}))
vi.mock('@/lib/ediel/sources/structuralSourceReadset',()=>({reviewedBusinessFor:mocks.owned}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(...args:unknown[])=>({abortSignal:()=>mocks.rpc(...args)})}}))
import {readQualifiedCustomerStructure} from '@/lib/ediel/sources/qualifiedCustomerStructure'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,at=(day:string)=>prodatMarketMinuteToUtc(`${day}0000`)!
const input={companyId:id(1),customerId:id(2),siteId:id(3),meteringPointId:id(4),actorUserId:id(5),environment:'test' as const,periodStart:'2026-10-04',periodEnd:'2026-10-05'}
// These are declared service-read stand-ins; source/native markers are checked
// independently. The sole real structural chronology owner runs in this test.
function version():StructuralVersion{return {sourceMessageId:id(6),payloadHash:'a'.repeat(64),assessmentId:id(7),factsHash:'b'.repeat(64),availableAt:at('20261003'),disposition:'accepted',replaces:null,
 coverage:{kind:'post_ledger_supply',baselineSourceMessageId:id(6),baselineAssessmentId:id(7),baselineFactsHash:'b'.repeat(64),supplyPeriodId:id(8),switchRequestId:id(9),switchCreatedAt:at('20260930'),outboundSourceMessageId:id(10),outboundCreatedAt:at('20260930'),validFrom:at('20261002'),validTo:null},
 wire:{object:{messageIndex:0,messageReference:'M',objectId:'735123456789012345',identityAgency:'9',registers:[]},messageCode:'Z04',businessCase:'supply_baseline',functionCode:'9',documentReference:'D',caseReference:'LI',effectiveFrom:{fieldNumber:'210',marketMinute:'202610020000',utc:at('20261002')},contractStartMinute:'202610020000',legalSender:'54321',legalReceiver:'12345',transportSender:'54321',transportReceiver:'12345',meterNumber:'ACTUAL',oldMeterNumber:null,registers:[{position:1,registerId:'1'}]},measurements:{measurementMethod:'Z04',reportingFrequency:'D',productCode:'L639Q',settlementMethod:'Z32'}}}
function data(versions=[version()]){return {timeline:{...emptySourceDecisionTimeline(),status:'inspected',boundedReadComplete:true,ledgerStartedAt:at('20260901'),snapshotId:id(11),readsetHash:'c'.repeat(64)},versions,closures:[],closureBlockers:[],correctionContextBlockers:[],unresolvedSources:false,sources:[]}}
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));mocks.read.mockResolvedValue(data());mocks.owned.mockReturnValue({...input});mocks.rpc.mockImplementation(async name=>({data:name==='ediel_read_structural_effect_scope_v1'?{applied:true}:{qualified:true,...input,initialSourceMessageId:id(6)},error:null}))})
describe('actual owned dated customer structure consumer',()=>{
 function inheritedMeterAndRegisters(inheritMeter:boolean,inheritRegisters:boolean){
  const baseline=version()
  const exchange=structuredClone(baseline)
  exchange.sourceMessageId=id(12);exchange.assessmentId=id(13)
  exchange.wire.messageCode='Z10';exchange.wire.businessCase='meter_exchange';exchange.wire.documentReference='METER-EXCHANGE'
  exchange.wire.effectiveFrom={fieldNumber:'216',marketMinute:'202610030000',utc:at('20261003')}
  exchange.wire.meterNumber='NEW';exchange.wire.oldMeterNumber='ACTUAL';exchange.wire.registers=[{position:1,registerId:'NEWREG'}]
  exchange.measurements={measurementMethod:'Z04',reportingFrequency:'D',productCode:'L639Q',settlementMethod:'Z32',balanceResponsibleId:'11111'}
  const change=structuredClone(exchange)
  change.sourceMessageId=id(14);change.assessmentId=id(15)
  change.wire.messageCode='Z06';change.wire.businessCase='change_without_reading';change.wire.documentReference='LATER-METHOD-CHANGE'
  change.wire.effectiveFrom={fieldNumber:'216',marketMinute:'202610040000',utc:at('20261004')}
  change.wire.meterNumber=inheritMeter?null:'NEW';change.wire.oldMeterNumber=null
  change.wire.registers=[{position:1,registerId:inheritRegisters?null:'NEWREG'}]
  // Every measurement has its own later source, so none can accidentally
  // bring the earlier meter/register source into the applied-receipt check.
  change.measurements={measurementMethod:'Z02',reportingFrequency:'D',productCode:'L639Q',settlementMethod:'Z32',balanceResponsibleId:'22222'}
  return [baseline,exchange,change]
 }
 it.each([
  {label:'meter',inheritMeter:true,inheritRegisters:false},
  {label:'registers',inheritMeter:false,inheritRegisters:true},
  {label:'meter and registers',inheritMeter:true,inheritRegisters:true},
 ])('does not expose inherited $label from an unapplied earlier source',async({inheritMeter,inheritRegisters})=>{
  mocks.read.mockResolvedValue(data(inheritedMeterAndRegisters(inheritMeter,inheritRegisters)))
  mocks.rpc.mockImplementation(async(name,args)=>({data:name==='ediel_read_structural_effect_scope_v1'
   ?{applied:args.p_source_message_id===id(14)}
   :{qualified:true,...input,initialSourceMessageId:id(6)},error:null}))
  expect(await readQualifiedCustomerStructure(input)).toEqual({status:'unavailable',reason:'dated_structure_applied_source_missing'})
  expect(mocks.rpc).toHaveBeenCalledWith('ediel_read_structural_effect_scope_v1',expect.objectContaining({
   p_source_message_id:id(12),p_assessment_id:id(13),p_snapshot_id:id(11),p_readset_hash:'c'.repeat(64),
   p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_customer_id:input.customerId,
   p_site_id:input.siteId,p_point_id:input.meteringPointId,p_period_id:id(8),p_at:at('20261004'),
   p_object_id:'735123456789012345',p_identity_agency:'9',
  }))
 })
 it('keeps qualified inherited meter and registers when both actual source receipts are applied',async()=>{
  mocks.read.mockResolvedValue(data(inheritedMeterAndRegisters(true,true)))
  expect(await readQualifiedCustomerStructure(input)).toMatchObject({status:'selected',fields:{measurementMethod:'Z02',balanceResponsibleId:'22222'},
   selection:{states:[{sourceMessageId:id(14),meterNumber:'NEW',registerIds:['NEWREG'],meterSourceMessageId:id(12),registerSourceMessageId:id(12)}]}})
  const sourceIds=mocks.rpc.mock.calls.filter(([name])=>name==='ediel_read_structural_effect_scope_v1').map(([,args])=>args.p_source_message_id)
  expect(sourceIds).toEqual([id(14),id(12)])
 })
 it('does not expose inherited source values when their actual receipt read fails',async()=>{
  mocks.read.mockResolvedValue(data(inheritedMeterAndRegisters(true,true)))
  mocks.rpc.mockImplementation(async(name,args)=>name==='ediel_read_structural_effect_scope_v1'&&args.p_source_message_id===id(12)
   ?{data:null,error:{message:'source receipt unavailable'}}
   :{data:name==='ediel_read_structural_effect_scope_v1'?{applied:true}:{qualified:true,...input,initialSourceMessageId:id(6)},error:null})
  await expect(readQualifiedCustomerStructure(input)).rejects.toThrow('dated_structure_applied_source_unconfirmed')
 })
 it('keeps quarter method and daily reporting distinct and rechecks the exact native owned period',async()=>{
  const result=await readQualifiedCustomerStructure(input)
  expect(result).toMatchObject({status:'selected',fields:{measurementMethod:'Z04',reportingFrequency:'D',productCode:'L639Q'}})
  expect(mocks.rpc).toHaveBeenCalledWith('ediel_read_source_supply_basis_v1',expect.objectContaining({p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_period_id:id(8),p_start:at('20261004'),p_end:at('20261005')}))
 })
 it('holds missing original facets and different source resolution across the requested interval',async()=>{
  const baseline=version();delete baseline.measurements;mocks.read.mockResolvedValue(data([baseline]))
  expect(await readQualifiedCustomerStructure(input)).toMatchObject({status:'selected',fields:{measurementMethod:null}})
  const change=version();change.sourceMessageId=id(12);change.assessmentId=id(13);change.wire.messageCode='Z06';change.wire.businessCase='change_with_reading';change.wire.documentReference='CHANGE';change.wire.effectiveFrom={fieldNumber:'216',marketMinute:'202610040000',utc:at('20261004')};change.measurements={...change.measurements!,measurementMethod:'Z02'}
  mocks.read.mockResolvedValue(data([version(),change]))
  expect(await readQualifiedCustomerStructure({...input,periodStart:'2026-10-03'})).toMatchObject({status:'selected',fields:{measurementMethod:null}})
 })
 it('never substitutes current scalar rows when owner scope or native continuity is unavailable',async()=>{
  mocks.rpc.mockResolvedValue({data:{qualified:true,...input,siteId:id(99),initialSourceMessageId:id(6)},error:null})
  expect(await readQualifiedCustomerStructure(input)).toEqual({status:'unavailable',reason:'dated_structure_owned_period_missing'})
  mocks.rpc.mockResolvedValue({data:null,error:{message:'unconfirmed'}})
  await expect(readQualifiedCustomerStructure(input)).rejects.toThrow('dated_structure_current_supply_basis_unconfirmed')
 })
 it('requires the actual applied own source receipt, not just an accepted dated proposal',async()=>{
  const change=version();change.sourceMessageId=id(12);change.assessmentId=id(13);change.wire.messageCode='Z06';change.wire.businessCase='change_with_reading';change.wire.documentReference='CHANGE';change.wire.effectiveFrom={fieldNumber:'216',marketMinute:'202610040000',utc:at('20261004')};change.measurements={...change.measurements!,balanceResponsibleId:'22222'}
  mocks.read.mockResolvedValue(data([version(),change]));mocks.rpc.mockImplementation(async name=>({data:name==='ediel_read_structural_effect_scope_v1'?{applied:false}:{qualified:true,...input,initialSourceMessageId:id(6)},error:null}))
  expect(await readQualifiedCustomerStructure(input)).toEqual({status:'unavailable',reason:'dated_structure_applied_source_missing'})
  expect(mocks.rpc).toHaveBeenCalledWith('ediel_read_structural_effect_scope_v1',expect.objectContaining({p_snapshot_id:id(11),p_readset_hash:'c'.repeat(64),p_source_message_id:id(12),p_assessment_id:id(13),p_object_id:change.wire.object.objectId,p_identity_agency:'9',p_company_id:input.companyId,p_customer_id:input.customerId,p_period_id:id(8)}))
 })
 it('preserves the separate field source when a later own structural change leaves BRP unchanged',async()=>{
  const baseline=version();baseline.measurements={...baseline.measurements!,balanceResponsibleId:'11111'}
  const change=structuredClone(baseline);change.sourceMessageId=id(12);change.assessmentId=id(13);change.wire.messageCode='Z06';change.wire.businessCase='change_with_reading';change.wire.documentReference='CHANGE';change.wire.effectiveFrom={fieldNumber:'216',marketMinute:'202610040000',utc:at('20261004')};change.measurements={...change.measurements!,balanceResponsibleId:null}
  mocks.read.mockResolvedValue(data([baseline,change]))
  expect(await readQualifiedCustomerStructure(input)).toMatchObject({status:'selected',fields:{balanceResponsibleId:'11111'},selection:{states:[{sourceMessageId:id(12),measurements:{balanceResponsibleId:{sourceMessageId:id(6),value:'11111'}}}]}})
 })
})

it('uses the protected point port rather than a zero-length native interval',async()=>{
 const point={...input,periodEnd:input.periodStart}
 expect((await readQualifiedCustomerStructure(point)).status).toBe('selected')
 expect(mocks.rpc).toHaveBeenCalledWith('ediel_read_source_supply_at_v1',expect.objectContaining({p_at:at('20261004')}))
 const args=mocks.rpc.mock.calls.at(-1)![1]
 expect(args).not.toHaveProperty('p_start');expect(args).not.toHaveProperty('p_end')
})
