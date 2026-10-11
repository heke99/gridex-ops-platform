// masterplan: SC-037
// Runs the SC-037 PGlite regression over the latest schema.sql canonical
// activation, canonical sweep, legacy Stockholm-DATE sweep and Z04 completion
// trigger: before the start nothing is activated or completed (the legacy
// sweep's early pick-up is refused by the canonical market_start_at guard and
// rolled back), at the start exactly the still-valid period is activated,
// cancelled/replaced periods are not, and earlier SMTP 250 / CONTRL / APERAK
// rows do not move the start. Uses real now() and one real minute boundary.
import {describe,expect,it} from 'vitest'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'

describe('SC-037 future-start Z04 is activated only at its start',()=>{
 it('holds before the start and activates only the valid period at the start (PGlite)',()=>{
  const root=process.cwd(),require=createRequire(path.join(root,'package.json'))
  const result=spawnSync(process.execPath,[path.join(root,'scripts/ediel-sc-037-future-start-sql-regression.mjs')],{cwd:root,encoding:'utf8',timeout:120_000,
   env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
  expect(result.error,result.stderr).toBeUndefined()
  expect(result.status,result.stdout+result.stderr).toBe(0)
  const line=result.stdout.split('\n').find(l=>l.startsWith('SC037_FUTURE_START_RESULT '))
  const parsed=JSON.parse(line!.slice('SC037_FUTURE_START_RESULT '.length))
  expect(parsed.checks).toBeGreaterThanOrEqual(15)
  expect(parsed.gapCases.length).toBeGreaterThanOrEqual(1)
  expect(parsed.legacyFindingReproduced).toBe(false)
 },125_000)
})
