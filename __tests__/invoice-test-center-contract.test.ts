import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Fakturatest workspace contract', () => {
  it('exposes Fakturatest as a first-class Test Center tab', () => {
    const layout = read('app/admin/ediel/test-center/layout.tsx')
    expect(layout).toContain('Fakturatest')
    expect(layout).toContain('/admin/ediel/test-center/invoice-test')
  })

  it('creates test customers through canonical customer intake before marking them test-only', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    expect(actions).toContain('buildCreateCustomerParams')
    expect(actions).toContain('createCustomerGraph')
    expect(actions).toContain('resolveSingleInvoiceTestContractId')
    expect(actions).toContain('markInvoiceTestCustomerGraph')
  })

  it('only exposes active non-archived tenants in Fakturatest', () => {
    const service = read('lib/ediel/testing/invoiceTestCenterWorkspace.ts')
    expect(service).toContain(".eq('status', 'active')")
    expect(service).toContain(".eq('lifecycle_status', 'active')")
    expect(service).toContain(".eq('is_active', true)")
    expect(service).toContain(".is('archived_at', null)")
  })

  it('uses internal publication readiness rather than website/current sellability for billing tests', () => {
    const service = read('lib/ediel/testing/invoiceTestCenterWorkspace.ts')
    expect(service).toContain(".eq('internal_publication_ready', true)")
    expect(service).toContain(".eq('lifecycle_status', 'published')")
    expect(service).not.toContain(".eq('currently_sellable', true)")
  })

  it('validates tenant and contract pairing before canonical customer creation', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    const guardIndex = actions.indexOf('await assertInvoiceTestCompanyAndOffer')
    const createIndex = actions.indexOf('const customer = await createCustomerGraph')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(createIndex).toBeGreaterThan(guardIndex)

    const service = read('lib/ediel/testing/invoiceTestCenterWorkspace.ts')
    expect(service).toContain(".eq('company_id', input.companyId)")
    expect(service).toContain("offer.internal_publication_ready !== true")
    expect(service).toContain("text(offer.lifecycle_status) !== 'published'")
  })

  it('keeps double-submit idempotent but changes onboarding generation after archived tests', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    const creation = read('lib/ediel/testing/invoiceTestCenterCreation.ts')
    expect(actions).toContain('getInvoiceTestOnboardingGeneration')
    expect(actions).toContain('generation ${generation + 1}')
    expect(creation).toContain(".not('archived_at', 'is', null)")
    expect(creation).toContain(".eq('source', INVOICE_TEST_CUSTOMER_SOURCE)")
  })

  it('quarantines a newly created graph fail-closed and releases reusable identifiers if test marking fails', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    const quarantine = read('lib/ediel/testing/invoiceTestCenterQuarantine.ts')
    expect(actions).toContain('quarantineCreatedInvoiceTestGraph')
    expect(quarantine).toContain('Fakturatest-markering misslyckades')
    expect(quarantine).toContain('is_test_data: true')
    expect(quarantine).toContain('archived_at: now')
    expect(quarantine).toContain("source: INVOICE_TEST_CUSTOMER_SOURCE")
    expect(quarantine).toContain('ARCHIVED-FAKTURATEST-MP-')
    expect(quarantine).toContain('ARCHIVED-FAKTURATEST-SITE-')
    expect(quarantine).toContain('archived_original_identifiers')
  })

  it('does not turn successful Next redirects into error redirects', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    expect(actions).toContain("digest.startsWith('NEXT_REDIRECT')")
    expect(actions.match(/rethrowNextRedirect\(error\)/g)?.length).toBeGreaterThanOrEqual(6)
  })

  it('hard-identifies invoice-test customers with both is_test_data and source/metadata marker', () => {
    const service = read('lib/ediel/testing/invoiceTestCenterWorkspace.ts')
    expect(service).toContain("row.is_test_data === true")
    expect(service).toContain("INVOICE_TEST_CUSTOMER_SOURCE = 'invoice_test_center'")
    expect(service).toContain("INVOICE_TEST_CUSTOMER_KIND = 'invoice_test_customer'")
    expect(service).toContain('assertInvoiceTestCustomer')
  })

  it('archives the whole test graph fail-closed and releases reusable test identifiers', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    const archive = read('lib/ediel/testing/invoiceTestCenterArchive.ts')
    expect(actions).toContain('archiveInvoiceTestCustomerSafely')
    expect(archive).toContain('contracts.length !== 1')
    expect(archive).toContain("status: 'cancelled'")
    expect(archive).toContain('ARCHIVED-FAKTURATEST-SITE-')
    expect(archive).toContain('ARCHIVED-FAKTURATEST-MP-')
    expect(archive).toContain('archived_original_identifiers')
    expect(archive).toContain("status: 'closed'")
    expect(archive).toContain("status: 'ended'")
    expect(archive).toContain(".eq('source', INVOICE_TEST_CUSTOMER_SOURCE)")
  })

  it('runs uploaded EDIFACT through the existing canonical test-center chain', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    expect(actions).toContain('importRawEdifactAndRunTestCenterChain')
    expect(actions).toContain('materializeTestCenterScenario')
    expect(actions).toContain('runTestCenterMeteringToInvoiceChain')
  })

  it('preserves audit/provider history on reset and safe customer removal', () => {
    const service = read('lib/ediel/testing/invoiceTestCenterWorkspace.ts')
    const archive = read('lib/ediel/testing/invoiceTestCenterArchive.ts')
    expect(service).toContain("!['sent', 'credited'].includes")
    expect(archive).toContain('Provider-/auditspår bevaras')
  })
})
