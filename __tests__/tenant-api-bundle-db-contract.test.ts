import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260822223013_tenant_api_bundle_operation_entitlement.sql'),
  'utf8',
)

describe('tenant API bundle database entitlement', () => {
  it('uses the active tenant_website API client as the integration entitlement', () => {
    expect(migration).toContain("c.status = 'active'")
    expect(migration).toContain("c.profile_key = 'tenant_website'")
    expect(migration).toContain("'allowed_by_tenant_api_bundle'")
    expect(migration).toContain("'api_bundle'")
  })

  it.each([
    'api_client.execute',
    'contract_channel.sell',
    'customer_automation.execute',
    'facility_lookup.execute',
    'email.send',
    'webhook.deliver',
  ])('includes %s in the API integration bundle', (operation) => {
    const bundleStart = migration.indexOf("if p_operation in (\n    'api_client.execute'")
    const bundleEnd = migration.indexOf(') then', bundleStart)
    expect(bundleStart).toBeGreaterThanOrEqual(0)
    expect(migration.slice(bundleStart, bundleEnd)).toContain(`'${operation}'`)
  })

  it('keeps Ediel production outside the API entitlement bundle', () => {
    const bundleStart = migration.indexOf("if p_operation in (\n    'api_client.execute'")
    const bundleEnd = migration.indexOf(') then', bundleStart)
    expect(migration.slice(bundleStart, bundleEnd)).not.toContain("'ediel.production.send'")
  })

  it('keeps lifecycle, live-production and Ediel evidence gates fail-closed', () => {
    expect(migration).toContain('if not v_base_allowed then')
    expect(migration).toContain("p_operation in ('contract_channel.sell', 'ediel.production.send')")
    expect(migration).toContain("v_production_status <> 'live'")
    expect(migration).toContain('canonical_ediel_production_evidence_readiness(p_company_id)')
    expect(migration).toContain("'tenant_production_evidence_not_ready_for_sales'")
    expect(migration).toContain("'ediel_production_evidence_not_ready'")
  })
})
