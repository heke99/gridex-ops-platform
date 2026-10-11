// masterplan: SC-054
// A correct UTILTS transaction whose database transaction fails: the real
// runtime, contract preparation and persistence adapter refuse to continue, so
// no acknowledgement job can be created; the real transport journals the
// failure as a retryable internal failure (no external rejection); the stored
// ack_due_at keeps the pending APERAK under deadline surveillance; and the real
// SQL authority refuses a merely queued reservation as proof of storage.
// Only the RPC, dead-letter writer and exchange log are test doubles.
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'
import type {EdielMessageRow} from '@/lib/ediel/types'

const native=vi.hoisted(()=>({rpc:vi.fn(),journal:vi.fn(),log:vi.fn(),process:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:native.rpc}}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointIdByIdentifier:vi.fn().mockResolvedValue(null),matchSiteAndCustomerForMeteringPoint:vi.fn().mockResolvedValue(null)}))
vi.mock('@/lib/ediel/transport/deadLetter',()=>({createEdielDeadLetterItem:native.journal}))
vi.mock('@/lib/ediel/operations/exchangeLog',()=>({recordEdielExchangeLog:native.log}))
vi.mock('@/lib/ediel/flows/inboundProcessing',()=>({processInboundEdielMessage:native.process}))

import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
import {buildUtiltsTransactionPersistencePayload,persistUtiltsTransactionResults} from '@/lib/ediel/utilts/transactionPersistence'
import {processInboundEdifactMessage} from '@/lib/ediel/transport/inboundProcessor'
import {computeCanonicalAckDueAt,getCanonicalAckState} from '@/lib/ediel/core/ackPolicy'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

async function failingPersistence(){
 const message=energyHandoffMessage('2026-10-15')
 message.company_id='11111111-1111-4111-8111-111111111111';message.id='22222222-2222-4222-8222-222222222222'
 const runtime=runUtiltsRuntimeForMessage(message),policy=resolveCanonicalMessagePolicy(message)!
 const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,fallback:{customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null},allowConsumption:true})
 const transactions=buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:runtime.facts.transactions,dispositions:runtime.transactionDispositions,matches:[]})
 native.rpc.mockReset();native.rpc.mockResolvedValue({data:null,error:{message:'could not serialize access'}})
 const outcome=persistUtiltsTransactionResults({actorUserId:'77777777-7777-4777-8777-777777777777',companyId:message.company_id!,environment:'test',
  sourceMessageId:message.id!,messageCode:'E66',rawPayload:message.raw_payload!,contracts,transactions})
 return {message,runtime,outcome}
}

describe('SC-054 storage failure blocks the positive APERAK',()=>{
 beforeEach(()=>{vi.clearAllMocks();native.log.mockResolvedValue(undefined);native.journal.mockResolvedValue({id:'journal'})})

 it('a correct transaction whose database write fails yields no persisted result to acknowledge',async()=>{
  const {runtime,outcome}=await failingPersistence()
  // Given: the UTILTS transaction itself is correct.
  expect(runtime.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
  // Expected: the failure propagates; nothing is returned to build an ACK job from.
  await expect(outcome).rejects.toThrow('utilts_transaction_persistence_failed:could not serialize access')
  expect(native.rpc).toHaveBeenCalledTimes(1)
  expect(native.rpc).toHaveBeenCalledWith('gridex_persist_utilts_consumption_v1',expect.anything())
 })

 it('journals the failure as retryable internal work, not an external rejection',async()=>{
  const {message,outcome}=await failingPersistence()
  const failure=await outcome.catch((error:unknown)=>error)
  native.process.mockRejectedValue(failure)
  await expect(processInboundEdifactMessage({actorUserId:'actor',message:message as EdielMessageRow})).rejects.toBe(failure)
  expect(native.journal).toHaveBeenCalledTimes(1)
  expect(native.journal).toHaveBeenCalledWith(expect.objectContaining({companyId:message.company_id,edielMessageId:message.id,
   errorCode:'EDIEL_INTERNAL_EXECUTION_FAILURE',retryable:true,
   errorMessage:expect.stringContaining('utilts_transaction_persistence_failed'),
   metadata:expect.objectContaining({failureDisposition:{kind:'internal_failure',code:'EDIEL_INTERNAL_EXECUTION_FAILURE'}})}))
 })

 it('keeps the unacknowledged APERAK under its deadline and reports it overdue',()=>{
  const receivedAt='2026-10-11T08:00:00.000Z',due=computeCanonicalAckDueAt(receivedAt)
  expect(due).not.toBeNull();expect(Date.parse(due!)).toBeGreaterThan(Date.parse(receivedAt))
  const pending={requires_contrl:false,requires_aperak:true,contrl_status:'not_required',aperak_status:'pending',utilts_err_status:'not_required'} as const
  vi.useFakeTimers()
  try{
   vi.setSystemTime(new Date(receivedAt));expect(getCanonicalAckState({...pending,ack_due_at:due})).toBe('awaiting_aperak')
   vi.setSystemTime(new Date(Date.parse(due!)+1));expect(getCanonicalAckState({...pending,ack_due_at:due})).toBe('ack_overdue')
  }finally{vi.useRealTimers()}
 })

 it('the real SQL authority refuses received-only and queued reservations as storage (PGlite)',()=>{
  const root=process.cwd(),require=createRequire(path.join(root,'package.json'))
  const result=spawnSync(process.execPath,[path.join(root,'scripts/ediel-utilts-u04-u14-effects-sql-regression.mjs')],{cwd:root,encoding:'utf8',timeout:120_000,
   env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
  expect(result.error,result.stderr).toBeUndefined()
  expect(result.status,result.stdout+result.stderr).toBe(0)
  expect(result.stdout).toMatch(/PASS \d+ U-04\/U-14/)
 },125_000)
})
