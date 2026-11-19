/** Stored preferences over every contract for one company/customer, regardless of
 * status or dates. This is a list summary, never an effective invoice policy. */
export const CONTRACT_BILLING_SELECTION = 'all_stored_customer_contracts'
export type ContractBillingPreferenceRow = {
  id: string
  company_id: string
  customer_id: string | null
  consolidated_invoice: unknown
  billing_level: unknown
}

export type PreferenceSummary<T extends boolean | string> = {
  state: 'unavailable' | 'no_contract' | 'uniform' | 'mixed' | 'unknown'
  values: readonly T[]
  unknownCount: number
}

export type SelectedContractRead =
  | { kind: 'unavailable'; selection: string }
  | { kind: 'complete'; selection: string; rows: readonly ContractBillingPreferenceRow[] }

export type ContractBillingSummary = {
  companyId: string
  customerId: string
  selection: string
  invoiceEffectivePolicy: false
  contractCount: number | null
  consolidatedInvoice: PreferenceSummary<boolean>
  billingLevel: PreferenceSummary<string>
}

function summarize<T extends boolean | string>(
  values: readonly (T | null)[],
  compare: (a: T, b: T) => number,
): PreferenceSummary<T> {
  if (values.length === 0) return { state: 'no_contract', values: [], unknownCount: 0 }
  const known = [...new Set(values.filter((value): value is T => value !== null))].sort(compare)
  const unknownCount = values.filter((value) => value === null).length
  return {
    state: known.length > 1 ? 'mixed' : unknownCount > 0 ? 'unknown' : 'uniform',
    values: known,
    unknownCount,
  }
}

/** Ownership mismatches are errors, never silently filtered into no-contract. */
export function summarizeSelectedContractBillingPreferences(params: {
  companyId: string
  customerId: string
  read: SelectedContractRead
}): ContractBillingSummary {
  const { companyId, customerId, read } = params
  if (!companyId || companyId.trim() !== companyId || !customerId || customerId.trim() !== customerId) {
    throw new Error('contract_billing_summary_scope_required')
  }
  if (!read.selection.trim()) throw new Error('contract_billing_summary_selection_required')
  const base = { companyId, customerId, selection: read.selection, invoiceEffectivePolicy: false as const }
  if (read.kind === 'unavailable') {
    return {
      ...base,
      contractCount: null,
      consolidatedInvoice: { state: 'unavailable', values: [], unknownCount: 0 },
      billingLevel: { state: 'unavailable', values: [], unknownCount: 0 },
    }
  }
  const ids = new Set<string>()
  for (const row of read.rows) {
    if (row.company_id !== companyId || row.customer_id !== customerId) {
      throw new Error('contract_billing_summary_ownership_mismatch')
    }
    if (!row.id || row.id.trim() !== row.id || ids.has(row.id)) {
      throw new Error('contract_billing_summary_invalid_or_duplicate_contract')
    }
    if (!Object.hasOwn(row, 'consolidated_invoice') || !Object.hasOwn(row, 'billing_level')) {
      throw new Error('contract_billing_summary_columns_not_projected')
    }
    ids.add(row.id)
  }
  return {
    ...base,
    contractCount: read.rows.length,
    consolidatedInvoice: summarize(
      read.rows.map((row) => typeof row.consolidated_invoice === 'boolean' ? row.consolidated_invoice : null),
      (a, b) => Number(a) - Number(b),
    ),
    billingLevel: summarize(
      read.rows.map((row) => typeof row.billing_level === 'string' && row.billing_level.trim() ? row.billing_level : null),
      (a, b) => a < b ? -1 : a > b ? 1 : 0,
    ),
  }
}


/** A uniform positive preference is the only meaning of the list flag. */
export function hasUniformConsolidatedInvoice(summary?: ContractBillingSummary): boolean {
  const preference = summary?.consolidatedInvoice
  return preference?.state === 'uniform' && preference.unknownCount === 0 &&
    preference.values.length === 1 && preference.values[0] === true
}

function preferenceLabel<T extends boolean | string>(summary: PreferenceSummary<T>, format: (value: T) => string): string {
  const known = summary.values.map(format).join(', ')
  if (summary.state === 'unavailable') return 'Kan inte hämtas'
  if (summary.state === 'no_contract') return 'Inget avtal'
  if (summary.state === 'mixed') return `Blandat: ${known}${summary.unknownCount ? ' (även okänt)' : ''}`
  if (summary.state === 'unknown') return known ? `${known} samt okänt` : 'Okänt'
  return known
}

export function contractBillingSummaryLabel(summary?: ContractBillingSummary): string {
  if (!summary) return 'Avtalens fakturainställningar: kan inte hämtas'
  const consolidated = preferenceLabel(summary.consolidatedInvoice, value => value ? 'Ja' : 'Nej')
  const level = preferenceLabel(summary.billingLevel, value => value)
  return `Alla avtal · Samlingsfaktura: ${consolidated} · Faktureringsnivå: ${level}`
}

export type CompletePage<Row> = { data: readonly Row[] | null; error: unknown; count: number | null }
export type CompleteRead<Row> =
  | { kind: 'complete'; rows: Row[] }
  | { kind: 'unavailable'; reason: 'query_failed' | 'invalid_result' | 'count_changed' | 'read_limit' | 'truncated' | 'duplicate_id' }

/** Fail closed on caps, errors, count drift or repeated rows. Callers supply a
 * deterministic unique ordering and a fresh query for each inclusive range.
 * This is a bounded read window, not a transactional snapshot across requests. */
export async function readCompletePages<Row extends { id: string }>(
  fetchPage: (from: number, to: number) => PromiseLike<CompletePage<Row>>,
  limits: { pageSize: number; maxRows: number; maxPages: number } = { pageSize: 250, maxRows: 20000, maxPages: 200 },
): Promise<CompleteRead<Row>> {
  if (![limits.pageSize, limits.maxRows, limits.maxPages].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('complete_read_limits_invalid')
  }
  const rows: Row[] = []
  const ids = new Set<string>()
  let count: number | null = null
  for (let page = 0; page < limits.maxPages; page += 1) {
    let result: CompletePage<Row>
    try { result = await fetchPage(rows.length, rows.length + limits.pageSize - 1) }
    catch { return { kind: 'unavailable', reason: 'query_failed' } }
    if (result.error) return { kind: 'unavailable', reason: 'query_failed' }
    if (!Array.isArray(result.data) || !Number.isSafeInteger(result.count) || Number(result.count) < 0) {
      return { kind: 'unavailable', reason: 'invalid_result' }
    }
    if (count !== null && count !== result.count) return { kind: 'unavailable', reason: 'count_changed' }
    count = result.count
    if (Number(count) > limits.maxRows) return { kind: 'unavailable', reason: 'read_limit' }
    if (result.data.length > limits.pageSize || rows.length + result.data.length > Number(count)) {
      return { kind: 'unavailable', reason: 'invalid_result' }
    }
    for (const row of result.data) {
      if (!row || typeof row.id !== 'string' || !row.id || row.id.trim() !== row.id) {
        return { kind: 'unavailable', reason: 'invalid_result' }
      }
      if (ids.has(row.id)) return { kind: 'unavailable', reason: 'duplicate_id' }
      ids.add(row.id)
      rows.push(row)
    }
    if (rows.length === count) return { kind: 'complete', rows }
    if (result.data.length === 0) return { kind: 'unavailable', reason: 'truncated' }
  }
  return { kind: 'unavailable', reason: 'read_limit' }
}
