import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Test Center raw EDIFACT import contract', () => {
  it('validates and routes before writes, then materializes and runs the normal inbound processor/runtime', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain('parseInboundEmailContent')
    expect(source).toContain('runUtiltsRuntimeForMessage')
    expect(source).toContain('assertInboundTenantMatchesSelection')
    expect(source).toContain('materializeInvoiceTestEdifactMasterdata')
    expect(source).toContain('processInboundEmailMessage')
    expect(source).toContain('runTestCenterMeteringToInvoiceChain')

    const parseAt = source.indexOf('assertRawTestEdifactPreflight(rawEdifact, billingMonth)')
    const routingAt = source.indexOf('await assertInboundTenantMatchesSelection')
    const materializeAt = source.indexOf('await materializeInvoiceTestEdifactMasterdata')
    const inboundAt = source.indexOf('await processInboundEmailMessage')
    const runtimeAt = source.indexOf('await runTestCenterMeteringToInvoiceChain')
    expect(parseAt).toBeGreaterThanOrEqual(0)
    expect(routingAt).toBeGreaterThan(parseAt)
    expect(materializeAt).toBeGreaterThan(routingAt)
    expect(inboundAt).toBeGreaterThan(materializeAt)
    expect(runtimeAt).toBeGreaterThan(inboundAt)
  })

  it('fails closed to a canonical accepted UTILTS E66 for exactly the selected billing month', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain("parsed.messageFamily !== 'UTILTS' || String(parsed.messageCode ?? '').toUpperCase() !== 'E66'")
    expect(source).toContain("preflightRuntime.validation.classification !== 'accepted'")
    expect(source).toContain('transactions.length !== 1')
    expect(source).toContain("String(quantity.qualifier ?? '').trim() === '136'")
    expect(source).toContain('totalEnergy <= 0')
    expect(source).toContain('periodStart !== bounds.startDate || periodEnd !== bounds.endDateExclusive')
    expect(source).toContain('stoppades i canonical preflight före masterdataändring')
  })

  it('requires canonical inbound routing to resolve to the selected tenant before masterdata/signing', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    const processor = read('lib/inbound-mail/edielInboundProcessor.ts')
    const resolver = read('lib/inbound-mail/inboundTenantResolver.ts')

    expect(source).toContain('assertInboundTenantMatchesSelection')
    expect(source).toContain("environment: 'test'")
    expect(source).toContain("resolution.status !== 'resolved' || !resolution.companyId")
    expect(source).toContain('resolution.companyId !== input.companyId')
    expect(source).toContain('testCenterTenantBinding: { companyId, customerId }')

    expect(processor).toContain('testCenterTenantBinding?: TestCenterTenantBinding | null')
    expect(processor).toContain("input.environment !== 'test'")
    expect(processor).toContain("text(input.row.match_status) !== 'test_center_raw_import'")
    expect(processor).toContain("text(payload.source) !== 'test_center_raw_edifact_import_v1'")
    expect(processor).toContain('payload.external_side_effects_allowed !== false')
    expect(processor).toContain('existingCompanyId: trustedExistingCompanyId')

    expect(resolver).toContain('existingCompanyId?: string | null')
    expect(resolver).toContain('existingCompanyId: input.existingCompanyId ?? outbound.companyId')
  })

  it('verifies selected test-customer ownership after EDIFACT masterdata materialization', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain(".eq('company_id', input.companyId)")
    expect(source).toContain(".eq('customer_id', input.customerId)")
    expect(source).toContain(".eq('is_test_data', true)")
    expect(source).toContain('EDIFACT-identiteten kunde inte verifieras mot vald testkund')
    expect(source).toContain("row.environment !== 'test'")
    expect(source).toContain("row.message_code !== 'E66'")
    expect(source).toContain("row.customer_id !== input.customerId")
  })

  it('contains no fixed EDIFACT masterdata identity in the invoice-test harness', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    const materialization = read('lib/ediel/testing/invoiceTestEdifactMaterialization.ts')
    const form = read('app/admin/ediel/test-center/invoice-test/InvoiceTestCustomerForm.tsx')
    for (const value of ['735999888777777778', 'GRIDEX-TEST-001']) {
      expect(source).not.toContain(value)
      expect(materialization).not.toContain(value)
      expect(form).not.toContain(value)
    }
  })

  it('persists only a test-scoped inbound envelope and records side effects as disabled', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain("environment: 'test'")
    expect(source).toContain("match_status: 'test_center_raw_import'")
    expect(source).toContain('test_center_customer_id: input.customerId')
    expect(source).toContain('external_side_effects_allowed: false')
    expect(source).not.toContain('invoiceApprovedDispatch')
    expect(source).not.toContain('dispatchApproved')
  })

  it('deduplicates identical test uploads only within the same selected test customer', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain('findExistingTestInboundEnvelope')
    expect(source).toContain(".eq('raw_edifact_payload', input.rawEdifact)")
    expect(source).toContain(".eq('environment', 'test')")
    expect(source).toContain(".contains('match_payload', { test_center_customer_id: input.customerId })")
    expect(source).toContain('if (existing) return { id: existing, reused: true }')
    expect(source.indexOf('findExistingTestInboundEnvelope')).toBeLessThan(source.indexOf(".from('inbound_email_messages').insert"))
  })

  it('accepts file or pasted EDIFACT in the superadmin server action and caps files at 2 MB', () => {
    const actions = read('app/admin/ediel/test-center/actions.ts')
    const page = read('app/admin/ediel/test-center/metering-to-invoice/page.tsx')
    expect(actions).toContain('requirePlatformAdminActionAccess()')
    expect(actions).toContain("formData.get('edifactFile')")
    expect(actions).toContain('2 * 1024 * 1024')
    expect(actions).toContain('importRawEdifactAndRunTestCenterChain')
    expect(page).toContain('type="file"')
    expect(page).toContain('name="rawEdifact"')
    expect(page).toContain('name="testScenario"')
    expect(page).toContain('Importera, kör och öppna trace')
  })
})
