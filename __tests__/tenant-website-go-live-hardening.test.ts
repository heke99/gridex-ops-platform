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
const docsLayout = readFileSync('app/developers/customer-portal-api/layout.tsx', 'utf8')
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

  it('prevents generic status activation from bypassing canonical go-live', () => {
    expect(activationGuard).toContain('gridex_guard_tenant_website_activation_v2')
    expect(activationGuard).toContain('TENANT_WEBSITE_ACTIVATION_REQUIRES_CANONICAL_GO_LIVE')
    expect(activationGuard).toContain("coalesce(new.metadata->>'go_live_flow','') <> 'canonical_tenant_website_v2'")
    expect(activationGuard).toContain("receipt.id::text = v_receipt_id_text")
    expect(activationGuard).toContain("'provisioning_preflight_pending','provisioning_retry_in_progress'")
    expect(activationGuard).toContain('new.revoked_at is not null')
  })

  it('keeps admin UX aligned with canonical go-live instead of a generic Aktivera path', () => {
    // Single-path go-live copy after #134; tenant_website rows must route to
    // Sätt live / revalidera, and the server action must fail closed.
    expect(createApiClientForm).toContain('Sätt bolaget live')
    expect(createApiClientForm).toContain('Ingen separat aktivering behövs')
    expect(apiClientsPage).toContain('isTenantWebsiteClient')
    expect(apiClientsPage).toContain("profile_key === 'tenant_website'")
    expect(apiClientsPage).toContain('Sätt live / revalidera')
    expect(apiClientsPage).toContain('goLiveHref(client.company_id)')

    const goLiveAction = apiClientsPage.indexOf('Sätt live / revalidera')
    expect(goLiveAction).toBeGreaterThan(-1)
    const tenantActions = apiClientsPage.slice(Math.max(0, goLiveAction - 1200), goLiveAction + 200)
    expect(tenantActions).toContain('{tenantWebsite ? (')
    expect(tenantActions).toContain('goLiveHref(client.company_id)')
    expect(tenantActions).not.toContain('>Aktivera<')
    expect(tenantActions).not.toContain('value="active"')
    // Non-tenant clients may keep a generic Aktivera control after the tenant branch.
    const aktiveraAt = apiClientsPage.indexOf('>Aktivera<')
    expect(aktiveraAt).toBeGreaterThan(goLiveAction)
    const aroundAktivera = apiClientsPage.slice(aktiveraAt - 500, aktiveraAt + 40)
    expect(aroundAktivera).toContain('value="active"')
    expect(aroundAktivera).toContain('setIntegrationApiClientStatusAction')

    expect(apiClientsActions).toContain('isTenantWebsiteIntegrationClient')
    expect(apiClientsActions).toContain("profile_key === 'tenant_website'")
    expect(apiClientsActions).toContain('TENANT_WEBSITE_ACTIVATION_REQUIRES_CANONICAL_GO_LIVE')
    expect(apiClientsActions).toContain('canonicala go-live-flödet')
    expect(apiClientsActions).toMatch(
      /select\('id,company_id,status,profile_key,scopes'\)/,
    )
  })

  it('preserves tenant website go-live metadata when rotating credentials', () => {
    // Rotation must merge into existing metadata. Replacing the object would
    // drop provisioning_receipt_id / go_live_flow and reopen readiness gaps.
    expect(apiClientsActions).toContain('rotateIntegrationApiClientTokenAction')
    expect(apiClientsActions).toContain('rotated_from_prefix')
    expect(apiClientsActions).toMatch(
      /rotateIntegrationApiClientTokenAction[\s\S]*select\([\s\S]*metadata/,
    )
    expect(apiClientsActions).toMatch(
      /rotateIntegrationApiClientTokenAction[\s\S]*metadata:\s*\{[\s\S]*\.\.\.metadata[\s\S]*rotated_from_prefix/,
    )
    expect(apiClientsActions).not.toMatch(
      /rotateIntegrationApiClientTokenAction[\s\S]*metadata:\s*\{\s*rotated_from_prefix/,
    )
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
