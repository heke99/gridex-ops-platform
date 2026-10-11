// masterplan: SC-037
// Runs the PGlite regression for gridex_transition_supplier_switch_v2: the
// transition and event happen only when the locked status is expected; other
// statuses are a no-op with no event; the writer assertion is still enforced.
import {describe,expect,it} from 'vitest'
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'

describe('SC-037 supplier switch transition v2 expected-status predicate',()=>{
 it('applies only expected statuses and keeps the writer assertion (PGlite)',()=>{
  const root=process.cwd(),require=createRequire(path.join(root,'package.json'))
  const result=spawnSync(process.execPath,[path.join(root,'scripts/ediel-sc-037-transition-v2-sql-regression.mjs')],{cwd:root,encoding:'utf8',timeout:120_000,
   env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
  expect(result.error,result.stderr).toBeUndefined()
  expect(result.status,result.stdout+result.stderr).toBe(0)
  const line=result.stdout.split('\n').find(l=>l.startsWith('SC037_TRANSITION_V2_RESULT '))
  expect(JSON.parse(line!.slice('SC037_TRANSITION_V2_RESULT '.length)).checks).toBeGreaterThanOrEqual(12)
 },125_000)
})
