import {describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
import {validateUtiltsConsumptionContract} from '@/lib/ediel/utilts/consumptionContract'
import {buildUtiltsTransactionPersistencePayload,persistUtiltsTransactionResults,storedUtiltsConsumption} from '@/lib/ediel/utilts/transactionPersistence'

// Only the external native RPC is declared here; real parser, own national
// guide, preparation, source transcription and returned authority checks run.
const native=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:native}))

function source(length:number){
 const message=energyHandoffMessage('2026-10-15')
 message.raw_payload=message.raw_payload!.replace('GRIDEX2607E66001','X'.repeat(length))
 return message
}
describe('U505 own source admission precedes FUNCTION and copied A505',()=>{
 it('keeps the actual 35-character own IDE admitted',()=>{
  const runtime=runUtiltsRuntimeForMessage(source(35))
  expect(runtime.transactionDispositions).toMatchObject([{transactionId:'X'.repeat(35),disposition:'accepted',responseType:'positive_aperak'}])
  expect(runtime.validation.issues.some(issue=>issue.code==='UTILTS_TRANSACTION_ID_INVALID')).toBe(false)
 })
 it.each([36,70])('projects the same own APP505 rejection in runtime and canonical invocation for %i characters',length=>{
  const message=source(length),reference='X'.repeat(length),runtime=runUtiltsRuntimeForMessage(message)
  expect(runtime.transactionDispositions).toMatchObject([{transactionId:reference,disposition:'guide_rejected',responseType:'negative_aperak',issueCodes:expect.arrayContaining(['UTILTS_TRANSACTION_ID_INVALID'])}])
  expect(runtime.validation.issues).toContainEqual(expect.objectContaining({code:'UTILTS_TRANSACTION_ID_INVALID',kind:'application',aperakErcCode:'42',aperakFieldCode:'505',referenceNumber:reference}))
  expect(runtime.validation.issues.filter(issue=>issue.kind==='functional')).toEqual([])
  expect(runtime.ackPlan.aperakApplicationErrors).toContainEqual(expect.objectContaining({ercCode:'42',fieldCode:'505',text:'INCORRECT DATA '+reference,referenceNumber:reference}))
  const canonical=resolveCanonicalRuntimeDecision(message)
  expect(canonical.utiltsTransactionValidation?.transactions).toMatchObject([{transactionId:reference,disposition:'guide_rejected',responseType:'negative_aperak',issueCodes:expect.arrayContaining(['UTILTS_TRANSACTION_ID_INVALID'])}])
 })
 it.each([36,70])('prepares only a zero-effect rejected diagnostic for the observed %i-character own source',async length=>{
  const message=source(length),runtime=runUtiltsRuntimeForMessage(message),policy=resolveCanonicalMessagePolicy(message)!
  const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,fallback:{customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null},allowConsumption:true})
  expect(contracts).toMatchObject([{version:3,projectionVersion:'utilts-rejected-diagnostic-v3',transactionId:'X'.repeat(length),observations:[],metering:{capability:'skip'},billing:{capability:'skip'},billingContributionOrdinals:[],interpretation:{timestampPolicy:'no-consumption-v1'}}])
  expect(()=>validateUtiltsConsumptionContract({...contracts[0],version:2,projectionVersion:'utilts-consumption-v2'})).toThrow('transaction_reference')
  expect(()=>validateUtiltsConsumptionContract({...contracts[0],transactionId:'OWN'})).toThrow('transaction_reference')
  expect(()=>validateUtiltsConsumptionContract({...contracts[0],interpretation:{...contracts[0].interpretation,timestampPolicy:'explicit-offset-v1'}})).toThrow('rejected_diagnostic_effect_forbidden')
  expect(()=>validateUtiltsConsumptionContract({...contracts[0],observations:[{}]})).toThrow('rejected_diagnostic_effect_forbidden')
 })
 it('transcribes the exact rejected source through the real RPC adapter without granting consumption',async()=>{
  const message=source(70);message.company_id='11111111-1111-4111-8111-111111111111';message.id='22222222-2222-4222-8222-222222222222'
  const runtime=runUtiltsRuntimeForMessage(message),policy=resolveCanonicalMessagePolicy(message)!
  const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,fallback:{customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null},allowConsumption:true})
  const transactions=buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:runtime.facts.transactions,dispositions:runtime.transactionDispositions,matches:[]})
  const input={companyId:message.company_id,environment:message.environment,sourceMessageId:message.id,messageCode:'E66',rawPayload:message.raw_payload!,contracts,transactions}
  native.rpc.mockReset();native.rpc.mockImplementation(async(name,args)=>{
   expect(name).toBe('gridex_persist_utilts_consumption_v1')
   expect(args).toMatchObject({p_company_id:message.company_id,p_source_message_id:message.id,p_environment:'test',p_raw_payload:message.raw_payload,p_transactions:[{transactionId:'X'.repeat(70),disposition:'guide_rejected',responseType:'negative_aperak',quantities:[{value:'500'}],consumptionContract:{version:3,observations:[],metering:{capability:'skip'},billing:{capability:'skip'}}}]})
   return {data:[{transactionId:transactions[0].transactionId,disposition:'guide_rejected',responseType:'negative_aperak',persistenceStatus:'not_applicable',sourceBinding:{sourceMessageId:message.id,rawHash:createHash('sha256').update(message.raw_payload!).digest('hex'),boundAt:'2026-10-15T20:00:00Z'}}],error:null}
  })
  const result=await persistUtiltsTransactionResults(input)
  expect(storedUtiltsConsumption(result[0],message.id)).toBeNull()
  native.rpc.mockReset()
  await expect(persistUtiltsTransactionResults({...input,transactions:[{...transactions[0],disposition:'accepted',responseType:'positive_aperak'}]})).rejects.toThrow('rejected_diagnostic_outcome')
  expect(native.rpc).not.toHaveBeenCalled()
 })
})
