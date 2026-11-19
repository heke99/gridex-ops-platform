import { deepEqual, equal, rejects, throws } from 'node:assert/strict'
import { describe, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'
import * as billing from '@/lib/customers/contractBillingSummary'
import {
  CONTRACT_BILLING_SELECTION, contractBillingSummaryLabel, hasUniformConsolidatedInvoice,
  readCompletePages, summarizeSelectedContractBillingPreferences,
  type ContractBillingPreferenceRow, type CompletePage,
} from '@/lib/customers/contractBillingSummary'

const companyId = 'company-a'
const customerId = 'customer-a'
const row = (id: string, invoice: unknown = true, level: unknown = 'customer'): ContractBillingPreferenceRow =>
  ({ id, company_id: companyId, customer_id: customerId, consolidated_invoice: invoice, billing_level: level })
const summary = (rows: ContractBillingPreferenceRow[]) => summarizeSelectedContractBillingPreferences({
  companyId, customerId, read: { kind: 'complete', selection: CONTRACT_BILLING_SELECTION, rows },
})
const page = <Row>(data: Row[], count = data.length): CompletePage<Row> => ({ data, count, error: null })

describe('stored all-contract preferences, without defining effective invoice policy', () => {
  it('distinguishes no contracts from false and unknown', () => {
    const result = summary([])
    equal(result.contractCount, 0)
    equal(result.consolidatedInvoice.state, 'no_contract')
    equal(result.billingLevel.state, 'no_contract')
    equal(result.invoiceEffectivePolicy, false)
    equal(hasUniformConsolidatedInvoice(result), false)
  })
  it('retains uniform true and an explicit billing level', () => {
    const result = summary([row('1'), row('2')])
    equal(result.contractCount, 2)
    deepEqual(result.consolidatedInvoice, { state: 'uniform', values: [true], unknownCount: 0 })
    deepEqual(result.billingLevel.values, ['customer'])
    equal(hasUniformConsolidatedInvoice(result), true)
  })
  it('retains uniform false rather than turning it into unknown', () => {
    const result = summary([row('1', false)])
    deepEqual(result.consolidatedInvoice, { state: 'uniform', values: [false], unknownCount: 0 })
    equal(hasUniformConsolidatedInvoice(result), false)
  })
  it('retains mixed known values and any unknown count', () => {
    const result = summary([row('1', true, 'site'), row('2', false, 'customer'), row('3', null, null)])
    deepEqual(result.consolidatedInvoice, { state: 'mixed', values: [false, true], unknownCount: 1 })
    deepEqual(result.billingLevel, { state: 'mixed', values: ['customer', 'site'], unknownCount: 1 })
    equal(hasUniformConsolidatedInvoice(result), false)
  })
  it('true plus NULL is unknown and cannot match the uniform flag', () => {
    const result = summary([row('1'), row('2', null, null)])
    deepEqual(result.consolidatedInvoice, { state: 'unknown', values: [true], unknownCount: 1 })
    equal(hasUniformConsolidatedInvoice(result), false)
  })
  it('does not normalize malformed values or blank levels to defaults', () => {
    const result = summary([row('1', 'true', ''), row('2', 1, '   ')])
    deepEqual(result.consolidatedInvoice, { state: 'unknown', values: [], unknownCount: 2 })
    deepEqual(result.billingLevel, { state: 'unknown', values: [], unknownCount: 2 })
  })
  it('preserves nonblank unknown billing enum and Unicode exactly', () => {
    deepEqual(summary([row('1', true, 'custom-Å')]).billingLevel.values, ['custom-Å'])
  })
  it('unavailable has nullable count and is never no-contract or uniform', () => {
    const result = summarizeSelectedContractBillingPreferences({ companyId, customerId,
      read: { kind: 'unavailable', selection: CONTRACT_BILLING_SELECTION } })
    equal(result.contractCount, null)
    equal(result.consolidatedInvoice.state, 'unavailable')
    equal(hasUniformConsolidatedInvoice(result), false)
    equal(contractBillingSummaryLabel(result).includes('Kan inte hämtas'), true)
  })
  it('rejects wrong tenant and wrong customer rather than filtering them out', () => {
    throws(() => summary([{ ...row('1'), company_id: 'company-b' }]), /ownership_mismatch/)
    throws(() => summary([{ ...row('1'), customer_id: 'customer-b' }]), /ownership_mismatch/)
  })
  it('rejects duplicate IDs and unprojected preference columns', () => {
    throws(() => summary([row('1'), row('1')]), /duplicate_contract/)
    const incomplete = row('1'); delete (incomplete as Partial<ContractBillingPreferenceRow>).billing_level
    throws(() => summary([incomplete]), /columns_not_projected/)
  })
  it('is independent of row order and preserves all stored statuses without an effective-period rule', () => {
    const stored = [
      { ...row('1', true, 'site'), status: 'terminated', starts_at: '2020-01-01' },
      { ...row('2', false, 'customer'), status: 'draft', starts_at: '2099-01-01' },
      { ...row('3', null, null), status: 'active', starts_at: '2026-01-01' },
    ]
    const expected = summary(stored)
    equal(expected.contractCount, 3)
    equal(expected.selection, 'all_stored_customer_contracts')
    deepEqual(summary([...stored].reverse()), expected)
    deepEqual(summary([stored[1], stored[2], stored[0]]), expected)
  })
  it('requires exact scope and explicit selection', () => {
    throws(() => summarizeSelectedContractBillingPreferences({ companyId: ' ', customerId,
      read: { kind: 'complete', selection: CONTRACT_BILLING_SELECTION, rows: [] } }), /scope_required/)
    throws(() => summarizeSelectedContractBillingPreferences({ companyId, customerId,
      read: { kind: 'complete', selection: '', rows: [] } }), /selection_required/)
  })
  it('renders mixed, unknown, no-contract and absent summaries explicitly', () => {
    equal(contractBillingSummaryLabel(summary([row('1'), row('2', false)])).includes('Blandat'), true)
    equal(contractBillingSummaryLabel(summary([row('1', null)])).includes('Okänt'), true)
    equal(contractBillingSummaryLabel(summary([])).includes('Inget avtal'), true)
    equal(contractBillingSummaryLabel(undefined).includes('kan inte hämtas'), true)
  })
  it('presents the four known billing levels in Swedish independently of the consolidated preference', () => {
    const labels = [
      ['customer', 'Per kund'],
      ['contract', 'Per avtal'],
      ['site', 'Per anläggning'],
      ['metering_point', 'Per mätpunkt'],
    ]
    for (const [value, label] of labels) {
      const result = summary([row('1', false, value)])
      deepEqual(result.billingLevel.values, [value])
      equal(contractBillingSummaryLabel(result), `Alla avtal · Samlingsfaktura: Nej · Faktureringsnivå: ${label}`)
    }
  })
  it('keeps mixed known levels distinct from unrecognized or missing levels', () => {
    const result = summary([
      row('1', true, 'site'), row('2', true, 'customer'), row('3', true, 'custom-Å'), row('4', true, null),
    ])
    deepEqual(result.billingLevel, { state: 'mixed', values: ['custom-Å', 'customer', 'site'], unknownCount: 1 })
    equal(contractBillingSummaryLabel(result), 'Alla avtal · Samlingsfaktura: Ja · Faktureringsnivå: Blandat: Per kund, Per anläggning (även okänt)')
    equal(contractBillingSummaryLabel(summary([row('1', true, 'site'), row('2', true, 'custom-Å')])), 'Alla avtal · Samlingsfaktura: Ja · Faktureringsnivå: Per anläggning samt okänt')
    equal(contractBillingSummaryLabel(summary([row('1', true, 'custom-Å'), row('2', true, '__proto__')])), 'Alla avtal · Samlingsfaktura: Ja · Faktureringsnivå: Okänt')
  })
})

describe('bounded complete pagination never summarizes a partial prefix', () => {
  it('reads past 1000 and includes a late different contract', async () => {
    const data = Array.from({ length: 1001 }, (_, i) => row(String(i), i < 1000))
    const ranges: number[][] = []
    const result = await readCompletePages(async (from, to) => {
      ranges.push([from, to]); return page(data.slice(from, to + 1), data.length)
    })
    equal(result.kind, 'complete')
    if (result.kind !== 'complete') throw Error('complete required')
    equal(result.rows.length, 1001)
    equal(summary(result.rows).consolidatedInvoice.state, 'mixed')
    equal(hasUniformConsolidatedInvoice(summary(result.rows)), false)
    deepEqual(ranges, [[0, 249], [250, 499], [500, 749], [750, 999], [1000, 1249]])
  })
  it('continues when the server returns fewer rows than requested', async () => {
    const data = Array.from({ length: 7 }, (_, i) => ({ id: String(i) }))
    const result = await readCompletePages(async from => page(data.slice(from, from + 2), 7))
    deepEqual(result, { kind: 'complete', rows: data })
  })
  it('accepts an exact empty set', async () => {
    deepEqual(await readCompletePages(async () => page([])), { kind: 'complete', rows: [] })
  })
  it('rejects a missing exact count', async () => {
    deepEqual(await readCompletePages(async () => ({ data: [row('1')], count: null, error: null })),
      { kind: 'unavailable', reason: 'invalid_result' })
  })
  it('rejects count drift between pages', async () => {
    deepEqual(await readCompletePages(async from => page([row(String(from))], from ? 3 : 2)),
      { kind: 'unavailable', reason: 'count_changed' })
  })
  it('rejects duplicate page rows', async () => {
    deepEqual(await readCompletePages(async () => page([row('1')], 2)),
      { kind: 'unavailable', reason: 'duplicate_id' })
  })
  it('rejects a truncated nonempty set instead of declaring no contracts', async () => {
    deepEqual(await readCompletePages(async () => page([], 1)), { kind: 'unavailable', reason: 'truncated' })
  })
  it('does not expose a successful prefix after a later query error', async () => {
    deepEqual(await readCompletePages(async from => from ? { data: null, count: null, error: { code: '42703' } } : page([row('1')], 2)),
      { kind: 'unavailable', reason: 'query_failed' })
  })
  it('does not expose a successful prefix after a thrown transport error', async () => {
    deepEqual(await readCompletePages(async () => { throw Error('unavailable') }),
      { kind: 'unavailable', reason: 'query_failed' })
  })
  it('bounds total rows and page attempts with no partial complete result', async () => {
    deepEqual(await readCompletePages(async () => page([row('1')], 20001)),
      { kind: 'unavailable', reason: 'read_limit' })
    let calls = 0
    deepEqual(await readCompletePages(async () => page([row(String(calls++))], 3), { pageSize: 1, maxRows: 3, maxPages: 2 }),
      { kind: 'unavailable', reason: 'read_limit' })
    equal(calls, 2)
  })
  it('rejects rows beyond count and invalid IDs', async () => {
    deepEqual(await readCompletePages(async () => page([row('1')], 0)),
      { kind: 'unavailable', reason: 'invalid_result' })
    deepEqual(await readCompletePages(async () => page([row(' ')])),
      { kind: 'unavailable', reason: 'invalid_result' })
  })
  it('refuses invalid limits before issuing a request', async () => {
    let called = false
    await rejects(readCompletePages(async () => { called = true; return page([]) }, { pageSize: 0, maxRows: 1, maxPages: 1 }), /limits_invalid/)
    equal(called, false)
  })
})


describe('contract-dependent list filters require a complete read', () => {
  it('keeps unavailable visible without a contract filter, rejects false-empty filtering, and accepts complete unknown', async () => {
    let unavailable = true
    type TestQuery = {
      select: () => TestQuery; eq: () => TestQuery; not: () => TestQuery; or: () => TestQuery
      order: () => TestQuery; range: () => TestQuery; in: () => TestQuery
      then: (resolve: (result: unknown) => unknown) => Promise<unknown>
    }
    const service = { from: (table: string) => {
      const query: TestQuery = {
        select: () => query, eq: () => query, not: () => query, or: () => query,
        order: () => query, range: () => query, in: () => query,
        then: (resolve: (result: unknown) => unknown) => Promise.resolve(resolve(
          table === 'customers'
            ? { data: [{ id: customerId, company_id: companyId, full_name: 'Customer A', created_at: '2026-11-15T00:00:00Z' }], count: 1, error: null }
            : table === 'customer_contracts'
              ? unavailable ? { data: null, count: null, error: { code: '42501' } }
                : { data: [row('1', null, null)], count: 1, error: null }
              : { data: [], count: 0, error: null }
        )),
      }
      return query
    } }
    const source = readFileSync(join(process.env.GRIDEX_CUSTOMER_SUMMARY_COMPONENT_ROOT ?? process.cwd(), 'lib/customers/getCustomers.ts'), 'utf8')
    const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText
    const fixtureModule = { exports: {} }
    new Function('require', 'module', 'exports', compiled)((name: string) => {
      if (name === '@/lib/customers/contractBillingSummary') return billing
      if (name === '@/lib/supabase/service') return { supabaseService: service }
      if (name === '@/lib/supabase/tenantQuery') return { tenantSelect: (_company: string, table: string) => service.from(table) }
      if (name === '@/lib/supabase/tenantDb') return { tenantDb: () => ({ unscoped: () => service }) }
      if (name === '@/lib/tenant/scope') return { isMissingRelationError: () => false }
      throw Error('unexpected_component_dependency')
    }, fixtureModule, fixtureModule.exports)
    const api = fixtureModule.exports as { listCustomersPage: (options: Record<string, unknown>) => Promise<{ rows: Array<{ contract_count: number | null }>; total: number }> }
    const unfiltered = await api.listCustomersPage({ query: 'Customer', companyId })
    equal(unfiltered.rows.length, 1)
    equal(unfiltered.rows[0].contract_count, null)
    for (const flag of ['multi_contract', 'consolidated_invoice', 'billing_ready']) {
      await rejects(api.listCustomersPage({ query: 'Customer', companyId, flag }), /customer_list_contract_filter_complete_read_required/)
    }
    await rejects(api.listCustomersPage({ query: 'Customer', companyId, contractFilter: 'none' }), /customer_list_contract_filter_complete_read_required/)
    unavailable = false
    equal((await api.listCustomersPage({ query: 'Customer', companyId, flag: 'consolidated_invoice' })).total, 0)
  })
})
