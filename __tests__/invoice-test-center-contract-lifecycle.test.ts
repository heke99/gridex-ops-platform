import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Fakturatest canonical contract lifecycle', () => {
  it('never inserts an active/signed contract through normal customer onboarding', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    expect(actions).toContain("contractStatus: 'pending_signature'")
    expect(actions).not.toContain("contractStatus: 'active'")
    expect(actions).toContain('actualStartDate: null')
  })

  it('keeps the contract unsigned until canonical EDIFACT identity is bound', () => {
    const actions = read('app/admin/ediel/test-center/invoice-test/actions.ts')
    const materialization = read('lib/ediel/testing/invoiceTestEdifactMaterialization.ts')
    const lifecycle = read('lib/ediel/testing/invoiceTestContractLifecycle.ts')
    expect(actions).not.toContain('signInvoiceTestContractCanonically')
    const bindAt = materialization.indexOf('metering_point_id: input.meteringPointId')
    const signAt = materialization.indexOf('await signInvoiceTestContractCanonically')
    expect(bindAt).toBeGreaterThan(-1)
    expect(signAt).toBeGreaterThan(bindAt)
    expect(materialization).toContain(".in('status', ['draft', 'pending_signature'])")
    expect(lifecycle).toContain('assertInvoiceTestCustomer')
    expect(lifecycle).toContain("gridex_prepare_customer_contract_signature_request_v1")
    expect(lifecycle).toContain("gridex_finalize_customer_contract_signature_v1")
    expect(lifecycle).toContain('Gridex Fakturatest synthetic acceptance · TEST ONLY')
  })

  it('creates an active test supply period only after the signed contract matches the EDIFACT meter point', () => {
    const materialization = read('lib/ediel/testing/invoiceTestEdifactMaterialization.ts')
    const signedCheck = materialization.indexOf("if (text(contract.metering_point_id) !== input.meteringPointId)")
    const supplyInsert = materialization.indexOf(".from('customer_supply_periods')")
    expect(signedCheck).toBeGreaterThan(-1)
    expect(supplyInsert).toBeGreaterThan(signedCheck)
    expect(materialization).toContain("source: 'invoice_test_center_edifact'")
    expect(materialization).toContain("status: 'active'")
  })

  it('verifies locked signature and pricing evidence after synthetic test acceptance', () => {
    const lifecycle = read('lib/ediel/testing/invoiceTestContractLifecycle.ts')
    expect(lifecycle).toContain("text(row.status) !== 'signed'")
    expect(lifecycle).toContain('signature_snapshot_sha256')
    expect(lifecycle).toContain('contract_price_snapshot_id')
    expect(lifecycle).toContain('contract_product_version_id')
    expect(lifecycle).toContain('contract_publication_version_id')
    expect(lifecycle).toContain('legal_bundle_version_id')
  })

  it('uses terminal lifecycle evidence when quarantining a failed test signing', () => {
    const quarantine = read('lib/ediel/testing/invoiceTestCenterQuarantine.ts')
    expect(quarantine).toContain("status: 'cancelled'")
    expect(quarantine).toContain('ended_at: now')
    expect(quarantine).toContain("status_reason_code: 'invoice_test_quarantine'")
    expect(quarantine).not.toContain('ends_at: now')
  })
})
