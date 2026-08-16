import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migrationPath = 'supabase/migrations/20260814125600_tenant_website_go_live_hardening.sql'
const activationGuardPath = 'supabase/migrations/20260814133500_tenant_website_activation_guard.sql'
const receiptBindingPath =
  'supabase/migrations/20260814170000_tenant_website_receipt_ready_binding.sql'
const migration = readFileSync(migrationPath, 'utf8')
const activationGuard = readFileSync(activationGuardPath, 'utf8')
const receiptBinding = readFileSync(receiptBindingPath, 'utf8')
const docs = readFileSync('docs/gridex-customer-portal-api.md', 'utf8')
const apiClientsPage = readFileSync('app/admin/platform/api-clients/page.tsx', 'utf8')
const apiClientsActions = readFileSync('app/admin/platform/api-clients/actions.ts', 'utf8')
const createApiClientForm = readFileSync(
  'app/admin/platform/api-clients/CreateApiClientForm.tsx',
  'utf8',
)

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

  it('binds normal-traffic receipt_ready to the client metadata receipt, not any historical completed receipt', () => {
    // Revalidation with a new idempotency key leaves prior completed receipts
    // attached to the same api_client_id. Once metadata.provisioning_receipt_id
    // is present, normal auth must require that exact completed receipt.
    // Legacy clients without the metadata key keep the previous fallback.
    expect(receiptBinding).toContain('authenticate_integration_request_v1')
    expect(receiptBinding).toContain('as receipt_ready')
    expect(receiptBinding).toContain(
      "receipt.id::text = nullif(auth.metadata->>'provisioning_receipt_id','')",
    )
    expect(receiptBinding).toContain(
      "nullif(auth.metadata->>'provisioning_receipt_id','') is null",
    )
    expect(receiptBinding).toContain("receipt.state='completed'")
    expect(receiptBinding).toContain("nullif(receipt.receipt_sha256,'') is not null")
    const receiptReadyBlock = receiptBinding.slice(
      receiptBinding.indexOf('as receipt_ready') - 700,
      receiptBinding.indexOf('as receipt_ready'),
    )
    expect(receiptReadyBlock).toContain("receipt.id::text = nullif(auth.metadata->>'provisioning_receipt_id','')")
    expect(receiptReadyBlock).toContain(
      "nullif(auth.metadata->>'provisioning_receipt_id','') is null",
    )
    expect(receiptReadyBlock).toContain('receipt.api_client_id=auth.client_id')
    expect(receiptReadyBlock).toContain('receipt.company_id=auth.company_id')
  })

  it('adopts only canonical-readiness-paused primary clients without credential rotation', () => {
    expect(apiClientsActions).toContain('adoptExistingApiClientForTenantWebsite')
    expect(apiClientsActions).toContain('canonical_readiness_paused')
    expect(apiClientsActions).toContain('provisioning_preflight_pending')
    expect(apiClientsActions).toContain('profile_key')
    expect(apiClientsActions).toContain('tenant_website')
  })

  it('forces a fresh receipt proof on every explicit revalidation', () => {
    expect(apiClientsActions).toContain('revalidateTenantWebsiteApiClientAction')
    expect(apiClientsActions).toContain('provisioning_receipt_id')
    expect(apiClientsActions).toContain('launch_ready')
  })

  it('prevents generic status activation from bypassing canonical go-live', () => {
    expect(activationGuard).toContain('gridex_guard_tenant_website_activation_v1')
    expect(activationGuard).toContain('TENANT_WEBSITE_ACTIVATION_REQUIRES_CANONICAL_GO_LIVE')
  })

  it('keeps admin UX aligned with canonical go-live instead of a generic Aktivera path', () => {
    expect(apiClientsPage).toContain('Sätt live')
    expect(apiClientsPage).toContain('Revalidera')
    expect(apiClientsPage).toContain('launch_ready')
  })

  it('preserves tenant website go-live metadata when rotating credentials', () => {
    expect(apiClientsActions).toContain('rotateApiClientKeyAction')
    expect(apiClientsActions).toContain('metadata')
  })

  it('does not promote an already-active non-canonical client into tenant_website without pausing', () => {
    expect(apiClientsActions).toContain('canonical_readiness_paused')
    expect(apiClientsActions).toContain('tenant_website')
  })

  it('shares one tenant-website client classifier between UI and server actions', () => {
    expect(apiClientsActions).toContain('isTenantWebsiteApiClient')
    expect(apiClientsPage).toContain('isTenantWebsiteApiClient')
  })

  it('lets lifecycle resume re-activate launch-ready tenant website clients paused by offboarding', () => {
    const lifecycleResumeGuard = readFileSync(
      'supabase/migrations/20260814180000_tenant_website_activation_lifecycle_resume.sql',
      'utf8',
    )
    expect(lifecycleResumeGuard).toContain('gridex_guard_tenant_website_activation_v2')
    expect(lifecycleResumeGuard).toContain('lifecycle_paused_by_tenant')
    expect(lifecycleResumeGuard).toContain("old.status = 'paused'")
    expect(lifecycleResumeGuard).toContain('new.launch_ready is true')
    expect(lifecycleResumeGuard).toContain('canonical_tenant_website_v2')
    // Generic Aktivera must still require preflight / receipt proof.
    expect(lifecycleResumeGuard).toContain('provisioning_preflight_pending')
    expect(lifecycleResumeGuard).toContain('TENANT_WEBSITE_ACTIVATION_REQUIRES_CANONICAL_GO_LIVE')
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

  it('documents every readiness denial in operator/technical integration docs', () => {
    for (const code of [
      'api_client_not_launch_ready',
      'integration_receipt_not_verified',
      'integration_capability_not_ready',
    ]) {
      expect(docs).toContain(code)
    }
  })

  it('keeps the tenant website setup form explicit about canonical provisioning', () => {
    expect(createApiClientForm).toContain('tenant_website')
  })
})
