import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'

const scriptUrl = pathToFileURL(resolve(process.cwd(), 'scripts/gridex-tenant-runtime-e2e.mjs')).href
const productionRef = 'piidsfebjqjmnepdpnas'
const stagingRef = 'abcdefghijklmnopqrst'

function probe(url: string, expectedRef: string) {
  // Exit before any network request if the staging target guard is missing.
  const code = `globalThis.fetch=async()=>{process.exit(70)};await import(${JSON.stringify(scriptUrl)})`
  return spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10000,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'test',
      GRIDEX_E2E_SUPABASE_URL: url,
      GRIDEX_E2E_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only',
      GRIDEX_E2E_ACTOR_USER_ID: '00000000-0000-4000-8000-000000000001',
      GRIDEX_E2E_CONFIRM_STAGING: 'YES',
      GRIDEX_E2E_ALLOW_MUTATION: 'YES',
      GRIDEX_E2E_TARGET: 'staging',
      GRIDEX_E2E_STAGING_PROJECT_REF: expectedRef,
    },
  })
}

it('rejects the known production Supabase project before any runtime mutation', () => {
  const result = probe(`https://${productionRef}.supabase.co`, productionRef)
  expect(result.status).toBe(2)
  expect(result.stderr).toContain('Runtime tenant E2E refuses the production Supabase project')
})

it('rejects a staging URL that differs from the explicitly approved project', () => {
  const result = probe(`https://${stagingRef}.supabase.co`, 'zyxwvutsrqponmlkjihg')
  expect(result.status).toBe(2)
  expect(result.stderr).toContain('Runtime tenant E2E requires the approved staging project URL')
})

it('permits the exact synthetic staging target to reach the mocked transport boundary', () => {
  const result = probe(`https://${stagingRef}.supabase.co`, stagingRef)
  expect(result.status).toBe(70)
})
