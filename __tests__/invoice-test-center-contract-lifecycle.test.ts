import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

function generatedTableBlock(types: string, table: string): string {
  const startNeedle = `      ${table}: {`
  const start = types.indexOf(startNeedle)
  if (start < 0) return ''
  const rest = types.slice(start + startNeedle.length)
  const next = rest.search(/\n      [a-z0-9_]+: \{/)
  return next < 0 ? types.slice(start) : types.slice(start, start + startNeedle.length + next)
}

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

  it('uses the generated customer_contracts schema for the contract start date', () => {
    const materialization = read('lib/ediel/testing/invoiceTestEdifactMaterialization.ts')
    const types = read('supabase/database.types.ts')
    const contractSchema = generatedTableBlock(types, 'customer_contracts')

    expect(contractSchema).not.toBe('')
    expect(contractSchema).toMatch(/\n\s+starts_at: string \| null/)
    expect(contractSchema).not.toMatch(/\n\s+start_date:/)

    expect(materialization).toContain(".select('id,status,starts_at,metering_point_id,site_id,customer_site_id,metadata')")
    expect(materialization).toContain('const startDate = text(contract.starts_at)?.slice(0, 10) ?? null')
    expect(materialization).not.toContain('start_date,starts_at')
    expect(materialization).not.toContain('contract.start_date')
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

  it('uses the same terminal evidence contract during normal Fakturatest archive', () => {
    const archive = read('lib/ediel/testing/invoiceTestCenterArchive.ts')
    expect(archive).toContain("status: 'cancelled'")
    expect(archive).toContain("status_reason_code: text(contract.status_reason_code) ?? 'invoice_test_archive'")
    expect(archive).toContain('ended_at: text(contract.ended_at) ?? now')
    expect(archive).toContain(".select('id,status,ended_at,status_reason_code')")
    expect(archive).toContain('terminal evidence')
    expect(archive).not.toContain('ends_at: text(contract.ends_at) ?? now')
  })
})
