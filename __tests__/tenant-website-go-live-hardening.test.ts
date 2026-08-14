import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260814125600_tenant_website_go_live_hardening.sql'
const migration = readFileSync(migrationPath, 'utf8')
const docs = readFileSync('docs/gridex-customer-portal-api.md', 'utf8')
const docsLayout = readFileSync('app/developers/customer-portal-api/layout.tsx', 'utf8')

describe('tenant website canonical go-live hardening', () => {
  it('keeps normal API traffic fail-closed while allowing bounded provisioning smoke', () => {
    expect(migration).toContain("p_route like 'provisioning-smoke:%'")
    expect(migration).toContain("receipt.id::text = nullif(auth.metadata->>'provisioning_receipt_id','')")
    expect(migration).toContain("receipt.api_client_id=auth.client_id")
    expect(migration).toContain("receipt.company_id=auth.company_id")
    expect(migration).toContain("when not readiness.client_ready then 'api_client_not_launch_ready'")
    expect(migration).toContain("when not readiness.receipt_ready then 'integration_receipt_not_verified'")
    expect(migration).toContain("when not readiness.capability_ready then 'integration_capability_not_ready'")
  })

  it('adopts only canonical-readiness-paused primary clients without credential rotation', () => {
    expect(migration).toContain("existing.status = 'paused'")
    expect(migration).toContain("'canonical_readiness_required'")
    expect(migration).toContain("'canonical_readiness_revalidation_required'")
    expect(migration).toContain("'canonical_readiness_revalidation_pending'")
    expect(migration).toContain('TENANT_WEBSITE_PAUSED_CLIENT_REQUIRES_OPERATOR_REVIEW')
    expect(migration).toContain("'credential_rotated',false")
    expect(migration).toContain("v_client.revoked_at is not null")
    expect(migration).toContain("existing.deleted_at is null")
  })

  it('forces a fresh receipt proof on every explicit revalidation', () => {
    expect(migration).toContain("state = 'company_ready'")
    expect(migration).toContain('receipt_sha256 = null')
    expect(migration).toContain('completed_at = null')
    expect(migration).toContain("launch_ready = false")
    expect(migration).toContain("'provisioning_preflight_pending'")
  })

  it('keeps tenant setup generic and free from the previously leaked concrete examples', () => {
    for (const forbidden of [
      'heke99@live.se',
      'DX-100023',
      'GRIDEX-WEB-20260616-8191257d-88d3-4929-ab02-1d3ca5ed986f',
      'Hekmat Hourani',
    ]) {
      expect(docs).not.toContain(forbidden)
    }
    expect(docs).toContain('GRIDEX_API_KEY')
    expect(docs).toContain('customer@example.com')
    expect(docs).toContain('tenant-customer-001234')
    expect(docs).toContain('aldrig skicka ett fritt `company_id`')
  })

  it('documents every readiness denial emitted by normal atomic authentication', () => {
    for (const code of [
      'api_client_not_launch_ready',
      'integration_receipt_not_verified',
      'integration_capability_not_ready',
    ]) {
      expect(docs).toContain(code)
      expect(docsLayout).toContain(code)
    }
  })
})
