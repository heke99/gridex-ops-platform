// PGlite relational component only; no native PG17/Supabase/crypto qualification.
import {expect,it} from 'vitest'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {runIssuerSourceSqlRegression} from '../scripts/ediel-utilts-issuer-source-sql-regression.mjs'
it('executes actual two-stage intake SQL through protected ordinary TEST RPCs',async()=>{
 const result=await runIssuerSourceSqlRegression({
  sourceRoot:fileURLToPath(new URL('..',import.meta.url)),
  pgliteModule:createRequire(import.meta.url).resolve('@electric-sql/pglite'),
 })
 expect(result.nativePg17).toBe(false)
 expect(result.nativeCrypto).toBe(false)
 expect(result.checks).toContain('stage2 grounds actual tuple and excludes only current issuance, not equal hashes')
 expect(result.checks.length).toBeGreaterThanOrEqual(14)
},60000)
