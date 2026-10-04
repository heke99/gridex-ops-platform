import {describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
import {validateUtiltsConsumptionContract} from '@/lib/ediel/utilts/consumptionContract'
import {buildUtiltsTransactionPersistencePayload,persistUtiltsTransactionResults,storedUtiltsConsumption} from '@/lib/ediel/utilts/transactionPersistence'

// Only native IO is modeled. Own UNSM syntax and national505 remain separate.
const native=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:native}))
function source(reference:string){
 const message=energyHandoffMessage('2026-10-15')
 message.raw_payload=message.raw_payload!.replace('GRIDEX2607E66001',reference)
 return message
}
const invalidNationalReference='X'.repeat(34)+' '
describe('U505 admission follows original UNSM syntax before national FUNCTION',()=>{
 it('keeps the actual 35-character own IDE admitted',()=>{
  const runtime=runUtiltsRuntimeForMessage(source('X'.repeat(35)))
  expect(runtime.transactionDispositions).toMatchObject([{transactionId:'X'.repeat(35),disposition:'accepted',responseType:'positive_aperak'}])
  expect(runtime.validation.issues.some(issue=>issue.code==='UTILTS_TRANSACTION_ID_INVALID')).toBe(false)
 })
 it.each([36,70])('keeps the original an..35 syntax priority for %i characters',length=>{
  const message=source('X'.repeat(length)),runtime=runUtiltsRuntimeForMessage(message)
  expect(runtime.transactionDispositions).toMatchObject([{transactionId:'X'.repeat(length),disposition:'syntax_rejected',responseType:'negative_contrl',issueCodes:expect.arrayContaining(['UNSM_ELEMENT_LENGTH_INVALID'])}])
  expect(runtime.validation.issues.filter(issue=>issue.kind==='functional')).toEqual([])
  expect(runtime.ackPlan.shouldSendAperak).toBe(false)
  const canonical=resolveCanonicalRuntimeDecision(message)
  expect(canonical.syntaxDecision).toBe('rejected')
  expect(canonical.responsePlan.some(plan=>plan.family==='APERAK')).toBe(false)
 })
 it('preserves a syntax-valid national505 rejection with the exact trailing-space source reference',()=>{
  const runtime=runUtiltsRuntimeForMessage(source(invalidNationalReference))
  expect(runtime.transactionDispositions).toMatchObject([{transactionId:invalidNationalReference,disposition:'guide_rejected',responseType:'negative_aperak',issueCodes:expect.arrayContaining(['UTILTS_TRANSACTION_ID_INVALID'])}])
  expect(runtime.validation.issues.filter(issue=>issue.kind==='functional')).toEqual([])
 })
 it('prepares only a zero-effect diagnostic for an own syntax-valid national rejection',async()=>{
  const message=source(invalidNationalReference),runtime=runUtiltsRuntimeForMessage(message),policy=resolveCanonicalMessagePolicy(message)!
  const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,fallback:{customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null},allowConsumption:true})
  expect(contracts).toMatchObject([{version:3,projectionVersion:'utilts-rejected-diagnostic-v3',transactionId:invalidNationalReference,observations:[],metering:{capability:'skip'},billing:{capability:'skip'},billingContributionOrdinals:[],interpretation:{timestampPolicy:'no-consumption-v1'}}])
  expect(()=>validateUtiltsConsumptionContract({...contracts[0],version:2,projectionVersion:'utilts-consumption-v2'})).toThrow('transaction_reference')
  expect(()=>validateUtiltsConsumptionContract({...contracts[0],transactionId:'OWN'})).toThrow('transaction_reference')
  expect(()=>validateUtiltsConsumptionContract({...contracts[0],interpretation:{...contracts[0].interpretation,timestampPolicy:'explicit-offset-v1'}})).toThrow('rejected_diagnostic_effect_forbidden')
  expect(()=>validateUtiltsConsumptionContract({...contracts[0],observations:[{}]})).toThrow('rejected_diagnostic_effect_forbidden')
 })
 it('transcribes only the exact rejected source and current operator to the real RPC adapter',async()=>{
  const message=source(invalidNationalReference);message.company_id='11111111-1111-4111-8111-111111111111';message.id='22222222-2222-4222-8222-222222222222'
  const runtime=runUtiltsRuntimeForMessage(message),policy=resolveCanonicalMessagePolicy(message)!
  const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,fallback:{customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null},allowConsumption:true})
  const transactions=buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:runtime.facts.transactions,dispositions:runtime.transactionDispositions,matches:[]})
  const input={actorUserId:'77777777-7777-4777-8777-777777777777',companyId:message.company_id,environment:message.environment,sourceMessageId:message.id,messageCode:'E66',rawPayload:message.raw_payload!,contracts,transactions}
  native.rpc.mockReset();native.rpc.mockImplementation(async(name,args)=>{
   expect(name).toBe('gridex_persist_utilts_consumption_v1')
   expect(args).toMatchObject({p_actor_user_id:input.actorUserId,p_company_id:message.company_id,p_source_message_id:message.id,p_environment:'test',p_raw_payload:message.raw_payload,p_transactions:[{transactionId:invalidNationalReference,disposition:'guide_rejected',responseType:'negative_aperak',consumptionContract:{version:3,observations:[],metering:{capability:'skip'},billing:{capability:'skip'}}}]})
   return {data:[{transactionId:transactions[0].transactionId,disposition:'guide_rejected',responseType:'negative_aperak',persistenceStatus:'not_applicable',sourceBinding:{sourceMessageId:message.id,rawHash:createHash('sha256').update(message.raw_payload!).digest('hex'),boundAt:'2026-10-15T20:00:00Z'}}],error:null}
  })
  const result=await persistUtiltsTransactionResults(input)
  expect(storedUtiltsConsumption(result[0],message.id)).toBeNull()
  native.rpc.mockReset()
  await expect(persistUtiltsTransactionResults({...input,transactions:[{...transactions[0],disposition:'accepted',responseType:'positive_aperak'}]})).rejects.toThrow('rejected_diagnostic_outcome')
  expect(native.rpc).not.toHaveBeenCalled()
 })
})
