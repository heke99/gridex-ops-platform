// Supporting fix (no masterplan ID): UTILTS_ERR own functional facet for received-structure E61/E62 refusals
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {observationHandoffMessage} from './helpers/utiltsObservationHandoff'
import {ownerId} from './helpers/sourceOwnerFixtures'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {qualifyReceivedUtiltsStructure} from '@/lib/ediel/utilts/qualifyReceivedStructure'
import {buildReceivedUtiltsFunctionalValidation} from '@/lib/ediel/core/receivedUtiltsFunctionalValidation'
import {buildUtiltsTransactionPersistencePayload} from '@/lib/ediel/utilts/transactionPersistence'
import type {StructuralComparison} from '@/lib/ediel/utilts/structuralComparison'

const io=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),ack:vi.fn(),compare:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:io.from}}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async()=>null}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:io.ack}))
// Only the pure comparison verdict is substituted (its own suite proves E61/E62
// derivation against approved PRODAT versions). Qualification, runtime rebuild,
// functional facet projection and ACK creation all execute for real.
vi.mock('@/lib/ediel/utilts/structuralComparison',()=>({compareUtiltsStructure:io.compare}))

const TX='GRIDEX2607E66001'
beforeEach(()=>{
  vi.clearAllMocks();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-02T09:00:00Z'))
  io.rpc.mockImplementation(()=>({abortSignal:async()=>({data:null,error:{message:'private unavailable'}})}))
})
afterEach(()=>vi.useRealTimers())

function input(){
  const message=observationHandoffMessage('2026-10-01',ownerId(2))
  message.id=ownerId(1);message.sender_ediel_id='91100';message.receiver_ediel_id='21660'
  const canonicalPolicy=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate:'2026-10-01',
    applicationReference:message.application_reference,mode:'parse'})
  const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy})
  expect(runtime.transactionDispositions,JSON.stringify(runtime.validation.issues)).toMatchObject([{disposition:'accepted',transactionId:TX}])
  return {message,runtime,canonicalPolicy}
}
const verdict=(status:StructuralComparison['status'],codes:StructuralComparison['codes']):StructuralComparison=>
  ({transactionId:TX,status,reason:null,codes,selected:[]})

it.each([[['E61']],[['E62']],[['E61','E62']]] as const)('structural %j refusal yields an own TN functional facet and a UTILTS_ERR, never persistence or positive APERAK',async codes=>{
  io.compare.mockReturnValue(verdict('mismatch',[...codes]))
  const args=input(),result=await qualifyReceivedUtiltsStructure(args)
  expect(result.hasNationalMismatch).toBe(true)
  expect(result.runtime.transactionDispositions).toMatchObject([{transactionId:TX,disposition:'processability_rejected',responseType:'utilts_err'}])
  expect(result.runtime.ackPlan).toMatchObject({shouldSendUtiltsErr:true})
  expect(result.runtime.ackPlan.utiltsErrCodes).toEqual([...codes])
  // The DB authority (require_utilts_err_source_v1) demands own errors with
  // referenceQualifier TN and the exact transaction reference.
  const facet=buildReceivedUtiltsFunctionalValidation({source:args.message,runtime:result.runtime})
  expect(facet).toMatchObject({transactions:[{transactionId:TX,errors:codes.map(code=>expect.objectContaining({code,referenceQualifier:'TN',referenceNumber:TX}))}]})
  // No business effect: the refused transaction is never handed over as accepted.
  const items=buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:result.runtime.facts.transactions,dispositions:result.runtime.transactionDispositions,matches:[]})
  expect(items).toMatchObject([{disposition:'processability_rejected',responseType:'utilts_err'}])
  // The planned national reply is exactly the UTILTS_ERR for this IDE (ERC E61/E62,
  // RFF+TN), never a positive APERAK; createUtiltsRuntimeAcks renders it from these details.
  expect(result.runtime.ackPlan.utiltsErrDetails).toEqual(codes.map(code=>expect.objectContaining({code,referenceQualifier:'TN',referenceNumber:TX,lineItemReference:TX})))
  expect(result.runtime.ackPlan.aperakOutcome).not.toBe('positive')
})

it('without a genuine own functional refusal there is no UTILTS_ERR facet (guard input stays absent)',async()=>{
  io.compare.mockReturnValue(verdict('unavailable',[]))
  const args=input(),result=await qualifyReceivedUtiltsStructure(args)
  expect(result.hasNationalMismatch).toBe(false)
  expect(result.runtime.transactionDispositions).toMatchObject([{disposition:'internal_review',responseType:'none'}])
  expect(buildReceivedUtiltsFunctionalValidation({source:args.message,runtime:result.runtime})).toBeNull()
  expect(buildReceivedUtiltsFunctionalValidation({source:args.message,runtime:args.runtime})).toBeNull()
})

it('a matching reading stays accepted with positive APERAK and persisted quantities',async()=>{
  io.compare.mockReturnValue(verdict('matched',[]))
  const args=input(),result=await qualifyReceivedUtiltsStructure(args)
  expect(result).toMatchObject({hasNationalMismatch:false,hasInternalReview:false})
  expect(result.runtime.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
  expect(result.runtime.ackPlan.utiltsErrCodes).toEqual([])
  expect(buildReceivedUtiltsFunctionalValidation({source:args.message,runtime:result.runtime})).toBeNull()
  const items=buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:result.runtime.facts.transactions,dispositions:result.runtime.transactionDispositions,matches:[]})
  expect(items[0].quantities.length).toBeGreaterThan(0)
})
