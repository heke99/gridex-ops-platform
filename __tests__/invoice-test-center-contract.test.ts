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
    expect(actions).toContain('markInvoiceTestCustomerGraph')
  })

  it('hard-identifies invoice-test customers with both is_test_data and source/metadata marker', () => {
    const service = read('lib/ediel/testing/invoiceTestCenterWorkspace.ts')
    expect(service).toContain("row.is_test_data === true")
    expect(service).toContain("INVOICE_TEST_CUSTOMER_SOURCE = 'invoice_test_center'")
    expect(service).toContain("INVOICE_TEST_CUSTOMER_KIND = 'invoice_test_customer'")
    expect(service).toContain('assertInvoiceTestCustomer')
  })

  it('runs uploaded EDIFACT through the existing canonical test-center chain', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    expect(actions).toContain('importRawEdifactAndRunTestCenterChain')
    expect(actions).toContain('materializeTestCenterScenario')
    expect(actions).toContain('runTestCenterMeteringToInvoiceChain')
  })

  it('preserves audit/provider history on reset and safe customer removal', () => {
    const service = read('lib/ediel/testing/invoiceTestCenterWorkspace.ts')
    expect(service).toContain("!['sent', 'credited'].includes")
    expect(service).toContain('archived_at')
    expect(service).toContain('Provider-/auditspår bevaras')
  })
})
