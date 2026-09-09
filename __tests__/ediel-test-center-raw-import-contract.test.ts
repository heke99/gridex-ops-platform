import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Test Center raw EDIFACT import contract', () => {
  it('validates and routes before writes, then object-validates before signing and normal inbound runtime', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain('parseInboundEmailContent')
    expect(source).toContain('runUtiltsRuntimeForMessage')
    expect(source).toContain('assertInboundTenantMatchesSelection')
    expect(source).toContain('materializeInvoiceTestEdifactObjectMasterdata')
    expect(source).toContain('assertObjectAwareCanonicalPreflight')
    expect(source).toContain('finalizeInvoiceTestEdifactBillingBinding')
    expect(source).toContain('processInboundEmailMessage')
    expect(source).toContain('runTestCenterMeteringToInvoiceChain')

    const parseAt = source.indexOf('assertRawTestEdifactPreflight(rawEdifact, billingMonth)')
    const routingAt = source.indexOf('await assertInboundTenantMatchesSelection')
    const objectMaterializeAt = source.indexOf('await materializeInvoiceTestEdifactObjectMasterdata')
    const objectPreflightCallAt = source.lastIndexOf('assertObjectAwareCanonicalPreflight({')
    const finalizeAt = source.indexOf('await finalizeInvoiceTestEdifactBillingBinding')
    const inboundAt = source.indexOf('await processInboundEmailMessage')
    const runtimeAt = source.indexOf('await runTestCenterMeteringToInvoiceChain')
    expect(parseAt).toBeGreaterThanOrEqual(0)
    expect(routingAt).toBeGreaterThan(parseAt)
    expect(objectMaterializeAt).toBeGreaterThan(routingAt)
    expect(objectPreflightCallAt).toBeGreaterThan(objectMaterializeAt)
    expect(finalizeAt).toBeGreaterThan(objectPreflightCallAt)
    expect(inboundAt).toBeGreaterThan(finalizeAt)
    expect(runtimeAt).toBeGreaterThan(inboundAt)
  })

  it('defers only unknown E66 object identity before materialization and blocks every other canonical error', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain("'UTILTS_E66_UNKNOWN_METERING_POINT'")
    expect(source).toContain('DEFERRED_PRE_MATERIALIZATION_ISSUE_CODES')
    expect(source).toContain('blockingIssues = errorIssues.filter((issue) => !isDeferredPreMaterializationIssue(issue.code))')
    expect(source).toContain("preflightRuntime.validation.classification !== 'accepted' && deferredIssues.length === 0")
    expect(source).toContain('stoppades i canonical preflight före masterdataändring')
    expect(source).not.toContain("'UTILTS_E66_UNKNOWN_GRID_AREA'")
  })

  it('requires the deferred object check to disappear before canonical test-signing', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain("business_match_status: input.objectResolved ? 'matched' : null")
    expect(source).toContain('meteringPointId: input.materialized.meteringPointId')
    expect(source).toContain("runtime.validation.classification !== 'accepted'")
    expect(source).toContain('objektkontroll kvarstod efter materialisering')
    expect(source).toContain('före avtalssignering')
  })

  it('fails closed to one E66 transaction, positive QTY+136 and exactly selected billing month', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain("parsed.messageFamily !== 'UTILTS' || String(parsed.messageCode ?? '').toUpperCase() !== 'E66'")
    expect(source).toContain('transactions.length !== 1')
    expect(source).toContain("String(quantity.qualifier ?? '').trim() === '136'")
    expect(source).toContain('totalEnergy <= 0')
    expect(source).toContain('periodStart !== bounds.startDate || periodEnd !== bounds.endDateExclusive')
  })

  it('requires canonical inbound routing to resolve to the selected tenant before object materialization', () => {
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

    expect(resolver).toContain('resolveInboundTenantFromIdentifiers')
    expect(resolver).toContain('applicationReference: null')
    expect(resolver).toContain("actorIdentityResolution.source === 'ediel_actor_settings'")
    expect(resolver).toContain('Application Reference')
  })

  it('keeps actor ownership fallback fail-closed and separate from canonical Application Reference validation', () => {
    const resolver = read('lib/inbound-mail/inboundTenantResolver.ts')
    expect(resolver).toContain("strictResolution.status !== 'unresolved'")
    expect(resolver).toContain("actorIdentityResolution.status === 'resolved'")
    expect(resolver).toContain("actorIdentityResolution.source === 'ediel_actor_settings'")
    expect(resolver).toContain('Canonical family/Application Reference policy')
    expect(resolver).not.toContain('mailboxCompanyId: input.mailboxCompanyId ??')
  })

  it('verifies selected test-customer ownership after EDIFACT object materialization', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain(".eq('company_id', input.companyId)")
    expect(source).toContain(".eq('customer_id', input.customerId)")
    expect(source).toContain(".eq('is_test_data', true)")
    expect(source).toContain('EDIFACT-identiteten kunde inte verifieras mot vald testkund')
    expect(source).toContain("row.environment !== 'test'")
    expect(source).toContain("row.message_code !== 'E66'")
    expect(source).toContain("row.customer_id !== input.customerId")
  })

  it('splits object creation from contract/signature/supply activation', () => {
    const materialization = read('lib/ediel/testing/invoiceTestEdifactMaterialization.ts')
    const objectStart = materialization.indexOf('export async function materializeInvoiceTestEdifactObjectMasterdata')
    const finalizeStart = materialization.indexOf('export async function finalizeInvoiceTestEdifactBillingBinding')
    expect(objectStart).toBeGreaterThanOrEqual(0)
    expect(finalizeStart).toBeGreaterThan(objectStart)
    const objectBody = materialization.slice(objectStart, finalizeStart)
    expect(objectBody).not.toContain('signInvoiceTestContractCanonically({')
    expect(objectBody).not.toContain(".from('customer_supply_periods')")
    expect(materialization.slice(finalizeStart)).toContain('bindInvoiceTestContractAndSupply(input)')
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
