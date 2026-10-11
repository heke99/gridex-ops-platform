/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles for Supabase/PostgREST ports */
// ops-api-review: F29 (deployment dependency preflight)
import { createRequire } from 'node:module'
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
