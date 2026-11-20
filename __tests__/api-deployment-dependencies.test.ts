/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles for Supabase/PostgREST ports */
// ops-api-review: F29 (deployment dependency preflight)
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { FEATURES, evaluateDeploymentContract } = require('../scripts/check-ops-api-deployment-contract.cjs')

function complete() {
  const tables: string[] = []; const triggers: Array<{ table: string; name: string }> = []
  const functions: Array<{ signature: string; execute_roles: string[]; body: string }> = []
  for (const feature of Object.values(FEATURES) as any[]) {
    tables.push(...(feature.tables ?? [])); triggers.push(...(feature.triggers ?? []))
    for (const fn of feature.functions ?? []) functions.push({ signature: fn.signature, execute_roles: ['service_role'], body: fn.body_contains ?? '' })
  }
  return { tables, triggers, functions }
}

describe('OPS API deployment contract', () => {
  it('reports every feature ready when all objects exist with service-only ACL', () => {
    expect(Object.values(evaluateDeploymentContract(complete())).every((f: any) => f.ready)).toBe(true)
  })
  it('missing Staff external RPC blocks only that feature (live state 2026-10-07/09)', () => {
    const catalog = complete()
    catalog.tables = catalog.tables.filter((t) => !t.startsWith('tenant_staff_identity_') && t !== 'tenant_staff_actor_anchors')
    catalog.functions = catalog.functions.filter((f) => !/staff_identity|external_staff/.test(f.signature))
    const result = evaluateDeploymentContract(catalog)
    expect(result.staff_external_identity.ready).toBe(false)
    expect(result.staff_external_identity.missing).toContain('function gridex_resolve_staff_identity_v1(jsonb)')
    expect(result.staff_core.ready).toBe(true)
    expect(result.website_poa_exact_document.ready).toBe(true)
  })
  it('service-only RPC executable by anon or authenticated is a blocking ACL defect', () => {
    const catalog = complete()
    catalog.functions[0].execute_roles.push('authenticated')
    const result = evaluateDeploymentContract(catalog)
    expect(result.staff_core.missing).toContain('acl gridex_staff_active_membership_v1(uuid,uuid) executable by authenticated')
  })
  it('session guard without the Auth revocation check is not ready', () => {
    const catalog = complete()
    catalog.functions = catalog.functions.map((f) => f.signature === 'gridex_is_current_session_allowed()' ? { ...f, body: 'profile only' } : f)
    expect(evaluateDeploymentContract(catalog).staff_session_revocation.ready).toBe(false)
  })
})


describe('OPS API deployment contract command', () => {
  function runPreflight(args: string[]) {
    const root = mkdtempSync(join(tmpdir(), 'gridex-deployment-preflight-'))
    const scripts = join(root, 'scripts')
    const migrations = join(root, 'supabase', 'migrations')
    const fakeBin = join(root, 'bin')
    const calls = join(root, 'psql-calls')
    const script = join(scripts, 'check-ops-api-deployment-contract.cjs')
    try {
      mkdirSync(scripts)
      mkdirSync(migrations, { recursive: true })
      mkdirSync(fakeBin)
      copyFileSync(new URL('../scripts/check-ops-api-deployment-contract.cjs', import.meta.url), script)
      writeFileSync(join(migrations, '20261120000000_synthetic.sql'), `
create function public.gridex_is_current_session_allowed() returns boolean
language sql as $$ select true; $$; -- banned_until is part of the expected catalog fixture
`)
      // This shim substitutes for psql even if the argument checks regress.
      writeFileSync(join(fakeBin, 'psql'), '#!/bin/sh\nprintf "call\\n" >> "$GRIDEX_SYNTHETIC_PSQL_CALLS"\nprintf "[]\\n"\n', { mode: 0o700 })
      const result = spawnSync(process.execPath, [script, ...args], {
        cwd: root, encoding: 'utf8', timeout: 5_000,
        env: { PATH: fakeBin, GRIDEX_SYNTHETIC_PSQL_CALLS: calls },
      })
      expect(result.error).toBeUndefined()
      return { ...result, psqlCalls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').length : 0 }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it('preserves the default check of every configured feature', () => {
    const result = runPreflight(['--static'])
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('READY   staff_session_revocation')
    expect(result.stdout.match(/^BLOCKED/gm)).toHaveLength(4)
    expect(result.psqlCalls).toBe(0)
  })

  it('preserves a known feature selection and comma-separated selections', () => {
    const ready = runPreflight(['--static', '--require', 'staff_session_revocation'])
    expect(ready.status).toBe(0)
    expect(ready.stdout.match(/^READY/gm)).toHaveLength(1)
    expect(ready.stdout.match(/^SKIPPED/gm)).toHaveLength(4)
    const multiple = runPreflight(['--static', '--require', 'staff_session_revocation,staff_core'])
    expect(multiple.status).toBe(1)
    expect(multiple.stdout).toContain('BLOCKED staff_core')
    expect(multiple.psqlCalls).toBe(0)
  })

  const syntheticCatalogUrl = 'postgresql://fixture.invalid/deployment'
  it.each([
    { title: 'missing', args: ['--require'] },
    { title: 'empty', args: ['--require', ''] },
    { title: 'only separators', args: ['--require', ','] },
    { title: 'empty comma-separated item', args: ['--require', 'staff_core,'] },
  ])('rejects a $title feature selector before the catalog is read', ({ args }) => {
    const result = runPreflight(['--url', syntheticCatalogUrl, ...args])
    expect(result.psqlCalls).toBe(0)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('non-empty feature list')
    expect(result.stdout).toBe('')
  })

  it.each(['nonexistent_feature', 'constructor', 'toString'])(
    'rejects unknown feature %s before the catalog is read',
    feature => {
      const result = runPreflight(['--url', syntheticCatalogUrl, '--require', feature])
      expect(result.psqlCalls).toBe(0)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain(`Unknown feature(s): ${feature}`)
      expect(result.stdout).toBe('')
    },
  )

  it('keeps a valid catalog request blocked when the selected objects are missing', () => {
    const result = runPreflight(['--url', syntheticCatalogUrl, '--require', 'staff_core'])
    expect(result.psqlCalls).toBe(3)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('BLOCKED staff_core')
  })
})
