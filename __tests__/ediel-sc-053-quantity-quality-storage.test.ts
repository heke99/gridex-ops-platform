// masterplan: SC-053
// The real runtime, contract preparation, payload builder and persistence
// adapter forward each quantity's own source STS+8 quality to PostgreSQL, so a
// missing (NULL, 46) energy value and a verified zero (0, 21) are stored with
// distinct value and quality. Only the database RPC is a test double; the SQL
// storage/validation effects and the authorized interval read are proven by
// the companion PGlite regressions.
import {describe,expect,it,vi} from 'vitest'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {prepareUtiltsConsumptionContracts} from '@/lib/ediel/utilts/consumptionPreparation'
import {buildUtiltsTransactionPersistencePayload,persistUtiltsTransactionResults} from '@/lib/ediel/utilts/transactionPersistence'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

const native=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:native}))
// Business matching is outside SC-053: no tenant point match is supplied.
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointIdByIdentifier:vi.fn().mockResolvedValue(null),matchSiteAndCustomerForMeteringPoint:vi.fn().mockResolvedValue(null)}))

// Two quarters of one E66 series: the first is missing, the second is zero.
function nullAndZeroMessage(){
 const message=energyHandoffMessage('2026-10-15')
 message.company_id='11111111-1111-4111-8111-111111111111';message.id='22222222-2222-4222-8222-222222222222'
 const lines=message.raw_payload!.split('\n'),at=lines.findIndex(line=>line.startsWith('SEQ+'))
 const head=lines.slice(0,at).map(line=>line.replace('202607010000202607010015:719','202607010000202607010030:719'))
 const observations=["SEQ++1'","QTY+136:NULL'","DTM+597:202607010000:203'","STS+8+46'",
  "SEQ++2'","QTY+136:0'","DTM+597:202607010015:203'","STS+8+21'"]
 message.raw_payload=recountEdifactUnt([...head,...observations,"UNT+0+1'",lines[lines.length-1]].join('\n'))
 return message
}

async function captured(){
 const message=nullAndZeroMessage(),runtime=runUtiltsRuntimeForMessage(message),policy=resolveCanonicalMessagePolicy(message)!
 const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,fallback:{customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null},allowConsumption:true})
 const transactions=buildUtiltsTransactionPersistencePayload({messageCode:'E66',transactions:runtime.facts.transactions,dispositions:runtime.transactionDispositions,matches:[]})
 let sent:{p_transactions:Array<{quantities:Array<{qualifier:string|null;value:string|null;quality?:string|null;readingAt?:string}>}>}|null=null
 native.rpc.mockReset();native.rpc.mockImplementation(async(_name:string,args:typeof sent)=>{sent=args;return {data:null,error:{message:'captured'}}})
 await expect(persistUtiltsTransactionResults({actorUserId:'77777777-7777-4777-8777-777777777777',companyId:message.company_id!,environment:'test',
  sourceMessageId:message.id!,messageCode:'E66',rawPayload:message.raw_payload!,contracts,transactions})).rejects.toThrow('captured')
 return {runtime,contracts,sent:sent!}
}

describe('SC-053 NULL is not zero in stored UTILTS values',()=>{
 it('accepts the source and forwards NULL/46 and 0/21 as separate value and quality',async()=>{
  const {runtime,contracts,sent}=await captured()
  expect(runtime.transactionDispositions).toMatchObject([{disposition:'accepted',responseType:'positive_aperak'}])
  expect(contracts[0].version).toBe(2)
  expect(native.rpc).toHaveBeenCalledWith('gridex_persist_utilts_consumption_v1',expect.anything())
  expect(sent.p_transactions[0].quantities.map(q=>[q.qualifier,q.value,q.quality,q.readingAt])).toEqual([['136',null,'46','2026-06-30T22:00:00.000Z'],['136','0','21','2026-06-30T22:15:00.000Z']])
  // The missing quarter keeps its own declared interval, distinct from the zero's.
  expect(contracts[0].observations.map(o=>[o.sourceOrdinal,o.periodStart])).toEqual([[1,'2026-06-30T22:15:00.000Z']])
 })
 it('never zero-fills the missing quarter or reuses the zero quality for it',async()=>{
  const {sent}=await captured()
  const [missing,zero]=sent.p_transactions[0].quantities
  expect(missing.value).toBeNull();expect(missing.quality).not.toBe(zero.quality)
  expect(zero.value).toBe('0')
 })
 it('returns the missing value as NULL/46 through the real authorized interval read (PGlite)',()=>{
  const root=process.cwd(),require=createRequire(path.join(root,'package.json'))
  const result=spawnSync(process.execPath,[path.join(root,'scripts/ediel-sc-053-authorized-interval-sql-regression.mjs')],{cwd:root,encoding:'utf8',timeout:120_000,
   env:{...process.env,EDIEL_SQL_REPOSITORY:root,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
  expect(result.error,result.stderr).toBeUndefined()
  expect(result.status,result.stdout+result.stderr).toBe(0)
  const line=result.stdout.split('\n').find(l=>l.startsWith('SC053_AUTHORIZED_INTERVAL_RESULT '))
  expect(JSON.parse(line!.slice('SC053_AUTHORIZED_INTERVAL_RESULT '.length)).checks).toBe(3)
 })
 it('stores the forwarded qualities through the real SQL owners (PGlite)',()=>{
  const root=process.cwd(),require=createRequire(path.join(root,'package.json'))
  const result=spawnSync(process.execPath,[path.join(root,'scripts/ediel-sc-053-quantity-quality-sql-regression.mjs')],{cwd:root,encoding:'utf8',timeout:120_000,
   env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
  expect(result.error,result.stderr).toBeUndefined()
  expect(result.status,result.stdout+result.stderr).toBe(0)
  const line=result.stdout.split('\n').find(l=>l.startsWith('SC053_QUANTITY_QUALITY_RESULT '))
  expect(JSON.parse(line!.slice('SC053_QUANTITY_QUALITY_RESULT '.length)).checks).toBe(14)
 })
})
