// masterplan: SC-053
// SC-053 through the actual authorized beneficiary interval read: in the same
// granted series, a missing value stored with its own interval is returned as
// NULL with quality 46, distinct from a verified zero (0, 21) and from the
// existing reading. A missing value stored without its interval (the earlier
// adapter output) is omitted by the [start,end) filter, which is why the
// adapter now binds the declared interval. Every original grant-set assertion
// is retained. Focused PGlite mechanics, not native replay or legal approval.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = readFileSync(new URL('./ediel-service-grant-set-sql-regression.mjs', import.meta.url), 'utf8')
const seed = ` await db.query("INSERT INTO meter_reading_values VALUES($1,$2,$3,'2026-01-02',17.250,'KWH','56','220')",[uid(540),uid(1),uid(211)])`
assert.equal(base.split(seed).length, 2, 'existing grant-set seed insertion seam must be unique')

const extension = String.raw`
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

const source = base.replace(seed, () => seed + extension)
  .replaceAll('.ediel-grant-set-runner.tmp.mjs', '.ediel-sc053-grant-set-runner.tmp.mjs')
  .replaceAll('.ediel-grant-set-consumer.tmp.mjs', '.ediel-sc053-grant-set-consumer.tmp.mjs')
const temp = fileURLToPath(new URL('./.ediel-sc053-authorized-interval.tmp.mjs', import.meta.url))
writeFileSync(temp, source)
try {
  const result = spawnSync(process.execPath, [temp], { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  unlinkSync(temp)
}
