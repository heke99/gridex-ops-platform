// masterplan: SC-053
// The real runtime, contract preparation, payload builder and persistence
// adapter forward each quantity's own source STS+8 quality to PostgreSQL, so a
// missing (NULL, 46) energy value and a verified zero (0, 21) are stored with
// distinct value and quality. Only the database RPC is a test double; the SQL
// storage/validation effects and the authorized interval read are proven by
// the embedded PGlite regressions below, which extend the existing U-04/U-14
// and grant-set SQL harnesses in a temporary runner (preserving every
// original assertion) without adding new committed scripts.
import {describe,expect,it,vi} from 'vitest'
import {spawnSync} from 'node:child_process'
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
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


// Runs an existing SQL harness with an SC-053 extension inserted at a unique
// seam. The temporary runner lives beside the harness (it resolves relative
// migration URLs) and is always removed.
function runExtendedHarness(base:string,seam:string,after:boolean,extension:string,env:Record<string,string>,rename:Array<[string,string]>=[]){
 const root=process.cwd(),require=createRequire(path.join(root,'package.json'))
 const source=readFileSync(path.join(root,'scripts',base),'utf8')
 if(source.split(seam).length!==2) throw new Error(`harness seam must be unique in ${base}`)
 let text=source.replace(seam,()=>after ? seam+extension : extension+seam)
 for(const [from,to] of rename) text=text.replaceAll(from,to)
 const temp=path.join(root,'scripts',`.ediel-sc053-${process.pid}-${base.replace(/\.mjs$/,'')}.tmp.mjs`)
 writeFileSync(temp,text)
 try {
  return spawnSync(process.execPath,[temp],{cwd:root,encoding:'utf8',timeout:120_000,
   env:{...process.env,...env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
 } finally { unlinkSync(temp) }
}

const QUALITY_EXTENSION=String.raw`
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930161718_ediel_utilts_e30_energy_source_and_null_quality.sql','utf8'))
 // Series committed BEFORE SC-053 is applied carry no quantity quality key.
 await message(uid(32),'PREFIX')
 const committed={...item('PREFIX','2026-10-05T08:00:00Z','4'),productId:null,periodStart:null,periodEnd:null}
 await persist(uid(32),committed)
 await message(uid(33),'PRENULL')
 const nullCommitted={...committed,transactionId:'PRENULL',quantities:[{value:null,qualifier:'136',raw:'QTY+136:NULL'},{...committed.quantities[0]}]}
 const nullPersisted=await persist(uid(33),nullCommitted)
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261012120000_ediel_utilts_source_quantity_quality_v2.sql','utf8'))
 let sc053=0
 const raw="UNH+1+UTILTS'BGM+E66+DOC+9'IDE+24+SC053'MEA+AAZ++KWH'SEQ++1'QTY+136:NULL'STS+8+46'SEQ++2'QTY+136:0'STS+8+21'SEQ++3'QTY+220:123'UNT+11+1'"
 const tokens=(await db.query('SELECT gridex_utilts_binding.wire_tokens_v1($1) t',[raw])).rows[0].t
 const quantities=[{qualifier:'136',value:null,quality:'46',raw:'QTY+136:NULL'},{qualifier:'136',value:'0',quality:'21',raw:'QTY+136:0',readingAt:'2026-09-01T00:15:00Z'},{qualifier:'220',value:'123',quality:null,raw:'QTY+220:123'}]
 const contract={observations:[{sourceOrdinal:1,quantity:'0'}]}
 const valid=async item=>(await db.query('SELECT gridex_utilts_binding.validate_decimal_source_v2($1::jsonb,$2::jsonb,$3) v',[JSON.stringify(tokens),JSON.stringify(item),'.'])).rows[0].v
 const source={transactionId:'SC053',disposition:'accepted',unit:'KWH',quantities,consumptionContract:contract}
 // Expected: each supplied quality equals that QTY's own STS+8 (or none).
 assert.equal(await valid(source),true);sc053++
 // Prohibited: swapping, inventing or dropping a source quality is refused.
 assert.equal(await valid({...source,quantities:[{...quantities[0],quality:'21'},{...quantities[1],quality:'46'},quantities[2]]}),false);sc053++
 assert.equal(await valid({...source,quantities:[quantities[0],quantities[1],{...quantities[2],quality:'21'}]}),false);sc053++
 assert.equal(await valid({...source,quantities:[{...quantities[0],quality:null},quantities[1],quantities[2]]}),false);sc053++
 // A zero is never a missing value: 0 with quality 46 is refused.
 assert.equal(await valid({...source,quantities:[quantities[0],{...quantities[1],quality:'46'},quantities[2]]}),false);sc053++
 // The validator alone still accepts an absent key: it also re-checks
 // committed pre-SC-053 rows. New rows are guarded before storage (below).
 assert.equal(await valid({...source,quantities:quantities.map(({quality,...q})=>q)}),true);sc053++

 const stored=async tx=>(await db.query("SELECT v.quantity::text q,v.quality,v.qualifier,v.source_order FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.source_transaction_reference=$1 ORDER BY v.source_order",[tx])).rows
 await message(uid(31),'SC053')
 const [result]=await persist(uid(31),{...item('SC053','2026-10-04T08:00:00Z','0'),quantities})
 assert.equal(result.persistenceStatus,'persisted');sc053++
 // Expected: separate value and quality representations, no zero-filling.
 assert.deepEqual(await stored('SC053'),[
  {q:null,quality:'46',qualifier:'136',source_order:1},
  {q:'0',quality:'21',qualifier:'136',source_order:2},
  {q:'123',quality:'unknown',qualifier:'220',source_order:3}]);sc053++
 // Prohibited: the missing observation is not stored as 0 and the QTY 220
 // reading is not counted among energy (QTY 136) values.
 assert.equal((await db.query("SELECT count(*)::int n FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.source_transaction_reference='SC053' AND v.quantity IS NOT DISTINCT FROM 0")).rows[0].n,1);sc053++
 assert.equal((await db.query("SELECT count(*)::int n FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.source_transaction_reference='SC053' AND v.qualifier='136'")).rows[0].n,2);sc053++

 // A series committed before SC-053 carries no quantity quality. Its retry,
 // now supplied with qualities, is compared without that key and keeps the
 // committed immutable item; any other difference is not adapted.
 const preserve=async(id,items)=>(await db.query("SELECT gridex_utilts_binding.preserve_committed_projection_v1($1,'test',$2,$3::jsonb) r",[company,id,JSON.stringify(items)])).rows[0].r
 const original=(await db.query("SELECT raw_transaction r FROM public.meter_reading_series WHERE source_transaction_reference='PREFIX'")).rows[0].r
 const retry={...committed,quantities:committed.quantities.map(q=>({...q,quality:'21'}))}
 assert.deepEqual(await preserve(uid(32),[retry]),[original]);sc053++
 const changed={...retry,quantities:retry.quantities.map(q=>({...q,value:'5'}))}
 assert.deepEqual(await preserve(uid(32),[changed]),[changed]);sc053++
 // A pre-SC-053 NULL quantity committed without readingAt: the retry now
 // supplies its quality and readingAt; only those added keys are ignored.
 assert.equal(nullPersisted[0].persistenceStatus,'persisted',JSON.stringify(nullPersisted));sc053++
 const nullOriginal=(await db.query("SELECT raw_transaction r FROM public.meter_reading_series WHERE source_transaction_reference='PRENULL'")).rows[0].r
 const nullRetry={...nullCommitted,quantities:[{...nullCommitted.quantities[0],quality:'46',readingAt:'2026-09-01T00:00:00Z'},{...nullCommitted.quantities[1],quality:'21'}]}
 assert.deepEqual(await preserve(uid(33),[nullRetry]),[nullOriginal]);sc053++
 // Prohibited: a changed readingAt on a valued quantity, or any other change,
 // is never adapted.
 const movedReading={...nullRetry,quantities:[nullRetry.quantities[0],{...nullRetry.quantities[1],readingAt:'2026-09-01T00:30:00Z'}]}
 assert.deepEqual(await preserve(uid(33),[movedReading]),[movedReading]);sc053++
 const nullChanged={...nullRetry,quantities:[{...nullRetry.quantities[0],raw:'QTY+136:NULLX'},nullRetry.quantities[1]]}
 assert.deepEqual(await preserve(uid(33),[nullChanged]),[nullChanged]);sc053++
 // A series stored after SC-053 already has its qualities: no stripping.
 const after=(await db.query("SELECT raw_transaction r FROM public.meter_reading_series WHERE source_transaction_reference='SC053'")).rows[0].r
 assert.deepEqual(await preserve(uid(31),[after]),[after]);sc053++
 // A V2 row with quality but a NULL 136 quantity lacking readingAt: the retry
 // adding readingAt there returns the committed item.
 assert.equal(after.quantities[0].value,null);assert.equal(after.quantities[0].quality,'46');assert.equal('readingAt' in after.quantities[0],false)
 const timed={...after,quantities:[{...after.quantities[0],readingAt:'2026-09-01T00:00:00Z'},...after.quantities.slice(1)]}
 assert.deepEqual(await preserve(uid(31),[timed]),[after]);sc053++
 // Prohibited: a different existing quality, or a moved readingAt on a valued
 // quantity, is never adapted.
 const requality={...timed,quantities:[{...timed.quantities[0],quality:'21'},...timed.quantities.slice(1)]}
 assert.deepEqual(await preserve(uid(31),[requality]),[requality]);sc053++
 const moved={...timed,quantities:[timed.quantities[0],{...timed.quantities[1],readingAt:'2026-09-01T00:30:00Z'},timed.quantities[2]]}
 assert.deepEqual(await preserve(uid(31),[moved]),[moved]);sc053++
 // Prohibited: a NEW accepted v2 transaction that drops a quality key is
 // refused by preserve_committed_projection_v1, the first step of the live
 // RPC chain (gridex_persist_utilts_consumption_v1 -> before_actor ->
 // preserve -> persist_series_v1), so a sourced 46/21 never becomes 'unknown'.
 // This harness's persist() calls the inner persist_series_v1 directly.
 await message(uid(34),'SC053')
 const dropped={...item('SC053','2026-10-04T08:00:00Z','0'),consumptionContract:{version:2,observations:[]},quantities:quantities.map((q,i)=>{if(i!==0)return q;const {quality,...rest}=q;return rest})}
 await assert.rejects(()=>preserve(uid(34),[dropped]),/utilts_quantity_quality_required/);sc053++
 const notObject={...dropped,quantities:[null,...quantities.slice(1)]}
 await assert.rejects(()=>preserve(uid(34),[notObject]),/utilts_quantity_quality_required/);sc053++
 assert.deepEqual(await preserve(uid(34),[{...dropped,quantities}]),[{...dropped,quantities}]);sc053++
 // A non-accepted item and a committed legacy retry are not affected.
 const notAccepted={...dropped,disposition:'rejected'}
 const versionOne={...dropped,consumptionContract:{version:1,observations:[]}}
 assert.deepEqual(await preserve(uid(34),[versionOne]),[versionOne]);sc053++
 assert.deepEqual(await preserve(uid(34),[notAccepted]),[notAccepted]);sc053++
 assert.deepEqual(await preserve(uid(32),[committed]),[original]);sc053++
 // Both replaced functions stay private.
 for(const role of ['anon','authenticated','service_role'])for(const fn of ['gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)','gridex_utilts_binding.preserve_committed_projection_v1(uuid,text,uuid,jsonb)'])
  assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) a',[role,fn,'EXECUTE'])).rows[0].a,false)
 sc053++
 console.log('SC053_QUANTITY_QUALITY_RESULT '+JSON.stringify({checks:sc053,boundary:'focused PGlite over real persist/validator/replay functions',native:'NOT_EXERCISED'}))
`

const INTERVAL_EXTENSION=String.raw`
 // SC-053 rows in the same granted series, inserted before any receipt.
 await db.query("INSERT INTO meter_reading_values VALUES($1,$2,$3,'2026-01-03',NULL,'KWH','46','136'),($4,$2,$3,'2026-01-04',0,'KWH','21','136'),($5,$2,$3,NULL,NULL,'KWH','46','136')",[uid(541),uid(1),uid(211),uid(542),uid(543)])
 {
  const read=async fields=>(await db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,2,$4,$5,$6,$7,$8) p',[uid(3),uid(20),grant2.grantId,'quality-monitoring',uid(211),fields,'2026-01-01','2026-02-01'])).rows[0].p.rows
  // Expected: separate value and quality representations, no zero-filling.
  assert.deepEqual(await read(['quality']),[{quality:'56'},{quality:'46'},{quality:'21'}])
  const values=(await db.query("SELECT id,quantity::text q,quality,reading_at FROM meter_reading_values WHERE series_id=$1 ORDER BY reading_at NULLS LAST,id",[uid(211)])).rows
  assert.deepEqual(values.map(v=>[v.q,v.quality]),[['17.250','56'],[null,'46'],['0','21'],[null,'46']])
  // The interval-less missing value is not returned by the authorized read.
  assert.equal((await read(['quality'])).length,3)
  console.log('SC053_AUTHORIZED_INTERVAL_RESULT '+JSON.stringify({checks:3,boundary:'real ediel_beneficiary_series_page_v1 over the existing grant-set fixture',native:'NOT_EXERCISED'}))
 }
 // Restore the original single-row fixture for every retained assertion.
 await db.query('DELETE FROM meter_reading_values WHERE id=ANY($1::uuid[])',[[uid(541),uid(542),uid(543)]])
`

// Two quarters of one E66 series: the first is missing, the second is zero.
function nullAndZeroMessage(nullStatuses:string[]=["STS+8+46'"]){
 const message=energyHandoffMessage('2026-10-15')
 message.company_id='11111111-1111-4111-8111-111111111111';message.id='22222222-2222-4222-8222-222222222222'
 const lines=message.raw_payload!.split('\n'),at=lines.findIndex(line=>line.startsWith('SEQ+'))
 const head=lines.slice(0,at).map(line=>line.replace('202607010000202607010015:719','202607010000202607010030:719'))
 const observations=["SEQ++1'","QTY+136:NULL'","DTM+597:202607010000:203'",...nullStatuses,
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
  const result=runExtendedHarness('ediel-service-grant-set-sql-regression.mjs',` await db.query("INSERT INTO meter_reading_values VALUES($1,$2,$3,'2026-01-02',17.250,'KWH','56','220')",[uid(540),uid(1),uid(211)])`,true,INTERVAL_EXTENSION,
   {EDIEL_SQL_REPOSITORY:process.cwd()},[['.ediel-grant-set-runner.tmp.mjs','.ediel-sc053-grant-set-runner.tmp.mjs'],['.ediel-grant-set-consumer.tmp.mjs','.ediel-sc053-grant-set-consumer.tmp.mjs']])
  expect(result.error,result.stderr).toBeUndefined()
  expect(result.status,result.stdout+result.stderr).toBe(0)
  const line=result.stdout.split('\n').find(l=>l.startsWith('SC053_AUTHORIZED_INTERVAL_RESULT '))
  expect(JSON.parse(line!.slice('SC053_AUTHORIZED_INTERVAL_RESULT '.length)).checks).toBe(3)

 },125_000)
 it('stores the forwarded qualities through the real SQL owners (PGlite)',()=>{
  const result=runExtendedHarness('ediel-utilts-u04-u14-effects-sql-regression.mjs',' console.log(`PASS ${checks} U-04/U-14',false,QUALITY_EXTENSION,{})
  expect(result.error,result.stderr).toBeUndefined()
  expect(result.status,result.stdout+result.stderr).toBe(0)
  const line=result.stdout.split('\n').find(l=>l.startsWith('SC053_QUANTITY_QUALITY_RESULT '))
  expect(JSON.parse(line!.slice('SC053_QUANTITY_QUALITY_RESULT '.length)).checks).toBe(27)

 },125_000)

 // Ediel-anvisning UTILTS & APERAK 25-A-5 p97 §3.9: SG11 QTY has `STS Status 1 D`
 // (max one repetition). Bilaga 1 p121: an Anvisningskontroll failure rejects the
 // transaction in a negative APERAK; no functional check and no persistence.
 for(const [label,statuses] of [['identical',["STS+8+46'","STS+8+46'"]],['differing',["STS+8+46'","STS+8+21'"]]] as const){
  it(`rejects a QTY with two ${label} STS by guide check ERC 42 field 520, without RPC`,async()=>{
   native.rpc.mockReset()
   const message=nullAndZeroMessage([...statuses]),runtime=runUtiltsRuntimeForMessage(message)
   expect(runtime.transactionDispositions).toMatchObject([{disposition:'guide_rejected',responseType:'negative_aperak'}])
   const issue=runtime.validation.issues.find(i=>i.code==='UTILTS_QUANTITY_STATUS_REPEATED')
   expect(issue).toMatchObject({kind:'application',aperakErcCode:'42',aperakFieldCode:'520',aperakText:'INCORRECT DATA',referenceQualifier:'ACW'})
   expect(runtime.transactionDispositions[0].issueCodes).toContain('UTILTS_QUANTITY_STATUS_REPEATED')
   const policy=resolveCanonicalMessagePolicy(message)!
   const contracts=await prepareUtiltsConsumptionContracts({message,runtime,policy,matches:[],dataRequest:null,fallback:{customerId:null,siteId:null,meteringPointId:null,gridOwnerId:null},allowConsumption:true})
   expect(contracts.every(c=>c.observations.length===0)).toBe(true)
   expect(native.rpc).not.toHaveBeenCalled()
  })
 }
})
