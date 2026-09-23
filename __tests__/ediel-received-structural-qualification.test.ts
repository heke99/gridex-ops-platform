import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {observationHandoffMessage,energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {ownerId} from './helpers/sourceOwnerFixtures'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {qualifyReceivedUtiltsStructure} from '@/lib/ediel/utilts/qualifyReceivedStructure'
import {createUtiltsRuntimeAcks} from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import {buildUtiltsTransactionPersistencePayload} from '@/lib/ediel/utilts/transactionPersistence'
const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),ack:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async()=>null}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:io.ack}))
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-02T09:00:00Z'))
 io.ack.mockResolvedValue({id:'synthetic-contrl'})
 io.rpc.mockImplementation(()=>({abortSignal:async()=>({data:null,error:{message:'private unavailable'}})}))
})
afterEach(()=>vi.useRealTimers())
function input(energy=false){
 const message=energy?energyHandoffMessage('2026-10-01',ownerId(2)):observationHandoffMessage('2026-10-01',ownerId(2))
 message.id=ownerId(1);message.sender_ediel_id='91100';message.receiver_ediel_id='21660'
 const canonicalPolicy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate:message.message_received_at!,applicationReference:message.application_reference,mode:'parse'})
 const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy})
 expect(runtime.transactionDispositions,JSON.stringify(runtime.validation.issues)).toMatchObject([{disposition:'accepted'}])
 return {message,runtime,canonicalPolicy}
}
it('activated original monthly readings without approved structure are held, not nationally rejected or accepted',async()=>{
 const args=input(),result=await qualifyReceivedUtiltsStructure(args)
 expect(result).toMatchObject({hasInternalReview:true,hasNationalMismatch:false,runtime:{validation:{ok:false,classification:'internal_review'},transactionDispositions:[{disposition:'internal_review',responseType:'none'}]}})
 expect(result.runtime.ackPlan.utiltsErrCodes).toEqual([])
 expect(JSON.stringify(result.evidence)).not.toContain('private unavailable')
 expect(io.rpc).toHaveBeenCalledWith('gridex_source_object_snapshot_v1',{p_company_id:ownerId(2),p_environment:'test',p_cutoff:'2026-10-02T09:00:00.000Z'})
})
it('held transactions cannot fall through to positive APERAK even with original BGM AB',async()=>{
 const args=input(),result=await qualifyReceivedUtiltsStructure(args)
 expect(await createUtiltsRuntimeAcks({actorUserId:ownerId(9),sourceMessage:args.message,ackPlan:result.runtime.ackPlan,transactionDispositions:result.runtime.transactionDispositions})).toEqual(['synthetic-contrl'])
 expect(io.ack.mock.calls.map(([call])=>call.ackFamily)).toEqual(['CONTRL'])
})
it('held transactions cannot carry energy quantities into the persistence RPC',async()=>{
 const args=input(),result=await qualifyReceivedUtiltsStructure(args)
 const items=buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:result.runtime.facts.transactions,dispositions:result.runtime.transactionDispositions,matches:[]})
 expect(items).toMatchObject([{disposition:'internal_review',responseType:'none',quantities:[]}])
})
it('holds an unproved reading while preserving an exempt energy sibling in the same physical message',async()=>{
 const args=input()
 const lines=args.message.raw_payload!.split('\n')
 const close=lines.findIndex(line=>line.startsWith('UNT+'))
 const second=[
  "IDE+24+GRIDEX2607E66002'", "LOC+172+735999260731000007::9'", "LOC+239+TES:SVK:260'",
  "LIN+++8716867000030:::9'", "DTM+324:202607010000202607010015:719'",
  "DTM+597:202607010020:203'", "DTM+354:15:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
  "SEQ++1'", "QTY+136:500'", "DTM+597:202607010000:203'", "STS+7++21::260'",
 ]
 lines.splice(close,0,...second)
 lines[close+second.length]=`UNT+${lines.length-2}+1'`
 args.message.raw_payload=lines.join('\n')
 args.runtime=runUtiltsRuntimeForMessage(args.message,{canonicalPolicy:args.canonicalPolicy})
 expect(args.runtime.transactionDispositions,JSON.stringify(args.runtime.validation.issues)).toMatchObject([
  {transactionId:'GRIDEX2607E66001',disposition:'accepted'},
  {transactionId:'GRIDEX2607E66002',disposition:'accepted'},
 ])
 const result=await qualifyReceivedUtiltsStructure(args)
 expect(result.runtime.transactionDispositions).toMatchObject([
  {transactionId:'GRIDEX2607E66001',disposition:'internal_review',responseType:'none'},
  {transactionId:'GRIDEX2607E66002',disposition:'accepted',responseType:'positive_aperak'},
 ])
 const items=buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:result.runtime.facts.transactions,
  dispositions:result.runtime.transactionDispositions,matches:[]})
 expect(items[0].quantities).toEqual([])
 expect(items[1].quantities.length).toBeGreaterThan(0)
})
it('applicable comparison queries fresh processing knowledge on every retry, never a cached original-receipt proof',async()=>{
 const args=input();args.message.parsed_payload={structuralQualification:{status:'matched'},normalizedMeteringPayload:{structuralQualification:{status:'matched'}}}
 await qualifyReceivedUtiltsStructure(args);vi.setSystemTime(new Date('2026-10-03T09:00:00Z'));await qualifyReceivedUtiltsStructure(args)
 expect(io.rpc.mock.calls.map(([,parameters])=>parameters.p_cutoff)).toEqual(['2026-10-02T09:00:00.000Z','2026-10-03T09:00:00.000Z'])
})
it('ordinary high-resolution energy without meter/register observations needs no source-authority IO',async()=>{
 const args=input(true),result=await qualifyReceivedUtiltsStructure(args)
 expect(result).toMatchObject({hasInternalReview:false,hasNationalMismatch:false,evidence:{status:'not_applicable'}})
 expect(result.runtime).toBe(args.runtime);expect(io.rpc).not.toHaveBeenCalled()
})
it('an incomplete, corrupt or cross-tenant snapshot cannot release applicable readings',async()=>{
 const args=input()
 for(const data of [null,{}, {companyId:ownerId(99),complete:true}, {status:'accepted',sources:[]}]){
  io.rpc.mockImplementation(()=>({abortSignal:async()=>({data,error:null})}))
  expect(await qualifyReceivedUtiltsStructure(args)).toMatchObject({hasInternalReview:true,hasNationalMismatch:false})
 }
})
