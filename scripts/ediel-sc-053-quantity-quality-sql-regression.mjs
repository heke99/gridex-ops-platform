// masterplan: SC-053
// SC-053 storage effects over the existing U-04/U-14 PGlite harness: the real
// persist_series_v1 keeps a missing value NULL with its own quality 46, a
// verified zero 0 with quality 21, and a meter reading under its own QTY 220
// qualifier. The forward validator refuses a quality that is not the source's
// own STS+8, and committed pre-fix series still replay idempotently.
// Focused embedded PostgreSQL mechanics, not native replay or market evidence.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = readFileSync(new URL('./ediel-utilts-u04-u14-effects-sql-regression.mjs', import.meta.url), 'utf8')
const marker = ' console.log(`PASS ${checks} U-04/U-14'
assert.equal(base.split(marker).length, 2, 'existing U-04/U-14 harness insertion seam must be unique')

const extension = String.raw`
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930161718_ediel_utilts_e30_energy_source_and_null_quality.sql','utf8'))
 await db.exec(fs.readFileSync(root+'/supabase/migrations/20261011020000_ediel_utilts_source_quantity_quality.sql','utf8'))
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
 // Callers that supply no quality key keep the prior validation result.
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
 await message(uid(32),'PREFIX')
 const committed={...item('PREFIX','2026-10-05T08:00:00Z','4'),productId:null,periodStart:null,periodEnd:null}
 await persist(uid(32),committed)
 const original=(await db.query("SELECT raw_transaction r FROM public.meter_reading_series WHERE source_transaction_reference='PREFIX'")).rows[0].r
 const retry={...committed,quantities:committed.quantities.map(q=>({...q,quality:'21'}))}
 assert.deepEqual(await preserve(uid(32),[retry]),[original]);sc053++
 const changed={...retry,quantities:retry.quantities.map(q=>({...q,value:'5'}))}
 assert.deepEqual(await preserve(uid(32),[changed]),[changed]);sc053++
 // A series stored after SC-053 already has its qualities: no stripping.
 const after=(await db.query("SELECT raw_transaction r FROM public.meter_reading_series WHERE source_transaction_reference='SC053'")).rows[0].r
 assert.deepEqual(await preserve(uid(31),[after]),[after]);sc053++
 // Both replaced functions stay private.
 for(const role of ['anon','authenticated','service_role'])for(const fn of ['gridex_utilts_binding.validate_decimal_source_v2(jsonb,jsonb,text)','gridex_utilts_binding.preserve_committed_projection_v1(uuid,text,uuid,jsonb)'])
  assert.equal((await db.query('SELECT has_function_privilege($1,$2,$3) a',[role,fn,'EXECUTE'])).rows[0].a,false)
 sc053++
 console.log('SC053_QUANTITY_QUALITY_RESULT '+JSON.stringify({checks:sc053,boundary:'focused PGlite over real persist/validator/replay functions',native:'NOT_EXERCISED'}))
`

// Preserve every existing assertion; a disjoint temporary filename isolates
// this runner from the original U-04/U-14 runner.
const source = base.replace(marker, () => extension + marker)
const temp = fileURLToPath(new URL('./.ediel-sc053-quantity-quality.tmp.mjs', import.meta.url))
writeFileSync(temp, source)
try {
  const result = spawnSync(process.execPath, [temp], { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(temp)
}
