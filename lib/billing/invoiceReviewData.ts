import { supabaseService } from '@/lib/supabase/service'

export type InvoiceReviewStatus =
  | 'missing_meter_values'
  | 'blocked'
  | 'preparing'
  | 'ready_for_review'
  | 'approved'
  | 'sent'
  | 'failed'

export type InvoiceReviewRow = {
  underlayId: string
  invoiceExportItemId: string | null
  customerInvoiceId: string | null
  customerId: string
  customerNumber: string | null
  customerName: string
  billingMonth: string
  periodStart: string | null
  periodEnd: string | null
  totalKwh: number | null
  amountIncVat: number | null
  priceArea: string | null
  contractType: string | null
  contractName: string | null
  status: InvoiceReviewStatus
  statusLabel: string
  blocker: string | null
}

type Row = Record<string, unknown>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function objectValue(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function monthParts(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim())
  if (!match) throw new Error('Ogiltig fakturamånad. Förväntat format YYYY-MM.')
  return { year: Number(match[1]), month: Number(match[2]) }
}

function customerName(customer: Row | null) {
  if (!customer) return 'Okänd kund'
  const company = text(customer.company_name)
  if (company) return company
  const personal = [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(' ')
  return personal || text(customer.name) || text(customer.customer_number) || 'Okänd kund'
}

function approvalStatus(metadata: unknown) {
  return text(objectValue(objectValue(metadata).approval).status)
}

function deriveStatus(input: { underlay: Row; item: Row | null; invoice: Row | null }): {
  status: InvoiceReviewStatus
  label: string
  blocker: string | null
} {
  const itemStatus = text(input.item?.status)
  const invoiceStatus = text(input.invoice?.status)
  if (itemStatus === 'sent' || invoiceStatus === 'sent') return { status: 'sent', label: 'Skickad', blocker: null }
  if (['failed', 'rejected', 'configuration_error', 'needs_review', 'failed_retryable'].includes(itemStatus ?? '')) {
    return {
      status: 'failed',
      label: 'Kräver åtgärd',
      blocker: text(objectValue(input.item?.error_payload).message) ?? text(input.underlay.billing_block_reason) ?? 'Fakturaexporten kräver åtgärd.',
    }
  }
  if (approvalStatus(input.item?.metadata) === 'approved') return { status: 'approved', label: 'Godkänd', blocker: null }
  if (itemStatus === 'pending') return { status: 'ready_for_review', label: 'Klar för granskning', blocker: null }
  const blockReason = text(input.underlay.billing_block_reason)
  if ((num(input.underlay.missing_values_count) ?? 0) > 0 || blockReason === 'missing_meter_values') {
    return { status: 'missing_meter_values', label: 'Saknar mätvärden', blocker: 'Kompletta mätvärden saknas för fakturaperioden.' }
  }
  if (input.underlay.status !== 'validated' || input.underlay.readiness_status !== 'ready') {
    return { status: 'blocked', label: 'Flaggad', blocker: blockReason ?? 'Faktureringsunderlaget är inte klart.' }
  }
  return { status: 'preparing', label: 'Förbereds', blocker: null }
}

async function loadUnderlays(companyId: string, billingMonth: string): Promise<Row[]> {
  const { year, month } = monthParts(billingMonth)
  const rows: Row[] = []
  for (let from = 0; ; from += 1_000) {
    const result = await supabaseService
      .from('billing_underlays')
      .select('id,customer_id,contract_id,customer_contract_id,status,readiness_status,total_kwh,billing_period_start,billing_period_end,missing_values_count,price_area,billing_block_reason')
      .eq('company_id', companyId)
      .eq('underlay_year', year)
      .eq('underlay_month', month)
      .order('customer_id', { ascending: true })
      .range(from, from + 999)
    if (result.error) throw result.error
    const page = (result.data ?? []) as Row[]
    rows.push(...page)
    if (page.length < 1_000) break
  }
  return rows
}

async function loadByIds(input: {
  table: string
  select: string
  companyId: string
  column: string
  ids: string[]
}): Promise<Row[]> {
  const rows: Row[] = []
  for (let offset = 0; offset < input.ids.length; offset += 200) {
    const chunk = input.ids.slice(offset, offset + 200)
    if (chunk.length === 0) continue
    const result = await supabaseService
      .from(input.table)
      .select(input.select)
      .eq('company_id', input.companyId)
      .in(input.column, chunk)
    if (result.error) throw result.error
    rows.push(...((result.data ?? []) as unknown as Row[]))
  }
  return rows
}

export async function listInvoiceReviewRows(input: {
  companyId: string
  billingMonth: string
}): Promise<InvoiceReviewRow[]> {
  const underlays = await loadUnderlays(input.companyId, input.billingMonth)
  const underlayIds = underlays.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const items = await loadByIds({
    table: 'invoice_export_items',
    select: 'id,billing_underlay_id,customer_id,status,amount_inc_vat,metadata,error_payload,export_run_id',
    companyId: input.companyId,
    column: 'billing_underlay_id',
    ids: underlayIds,
  })
  const itemByUnderlay = new Map(items.map((row) => [text(row.billing_underlay_id) ?? '', row]))
  const itemIds = items.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const invoices = await loadByIds({
    table: 'customer_invoices',
    select: 'id,invoice_export_item_id,status,amount_inc_vat',
    companyId: input.companyId,
    column: 'invoice_export_item_id',
    ids: itemIds,
  })
  const invoiceByItem = new Map(invoices.map((row) => [text(row.invoice_export_item_id) ?? '', row]))
  const customerIds = Array.from(new Set(underlays.map((row) => text(row.customer_id)).filter((value): value is string => Boolean(value))))
  const contractIds = Array.from(new Set(underlays.map((row) => text(row.customer_contract_id) ?? text(row.contract_id)).filter((value): value is string => Boolean(value))))
  const [customers, contracts] = await Promise.all([
    loadByIds({ table: 'customers', select: 'id,customer_number,first_name,last_name,company_name,name', companyId: input.companyId, column: 'id', ids: customerIds }),
    loadByIds({ table: 'customer_contracts', select: 'id,contract_name,contract_type,price_area_used', companyId: input.companyId, column: 'id', ids: contractIds }),
  ])
  const customerById = new Map(customers.map((row) => [text(row.id) ?? '', row]))
  const contractById = new Map(contracts.map((row) => [text(row.id) ?? '', row]))

  return underlays.map((underlay) => {
    const underlayId = text(underlay.id) ?? ''
    const item = itemByUnderlay.get(underlayId) ?? null
    const invoice = item ? invoiceByItem.get(text(item.id) ?? '') ?? null : null
    const customerId = text(underlay.customer_id) ?? ''
    const customer = customerById.get(customerId) ?? null
    const contractId = text(underlay.customer_contract_id) ?? text(underlay.contract_id)
    const contract = contractId ? contractById.get(contractId) ?? null : null
    const state = deriveStatus({ underlay, item, invoice })
    return {
      underlayId,
      invoiceExportItemId: text(item?.id),
      customerInvoiceId: text(invoice?.id),
      customerId,
      customerNumber: text(customer?.customer_number),
      customerName: customerName(customer),
      billingMonth: input.billingMonth,
      periodStart: text(underlay.billing_period_start),
      periodEnd: text(underlay.billing_period_end),
      totalKwh: num(item?.total_kwh) ?? num(invoice?.total_kwh) ?? num(invoice?.consumption_kwh) ?? num(underlay.total_kwh),
      amountIncVat: num(invoice?.amount_inc_vat) ?? num(item?.amount_inc_vat),
      priceArea: text(underlay.price_area) ?? text(contract?.price_area_used),
      contractType: text(contract?.contract_type),
      contractName: text(contract?.contract_name),
      status: state.status,
      statusLabel: state.label,
      blocker: state.blocker,
    }
  }).sort((a, b) => a.customerName.localeCompare(b.customerName, 'sv'))
}

export async function getInvoiceReviewDetail(input: {
  companyId: string
  invoiceExportItemId: string
}) {
  const itemResult = await supabaseService
    .from('invoice_export_items')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('id', input.invoiceExportItemId)
    .single()
  if (itemResult.error) throw itemResult.error
  const item = itemResult.data as Row
  const underlayId = text(item.billing_underlay_id)
  const customerId = text(item.customer_id)
  const contractId = text(item.customer_contract_id)
  const pricingRunId = text(item.pricing_run_id)
  if (!underlayId || !customerId || !contractId || !pricingRunId) throw new Error('Fakturan saknar canonical identitet.')

  const [underlay, customer, contract, invoice, pricingRun, pricingLines] = await Promise.all([
    supabaseService.from('billing_underlays').select('*').eq('company_id', input.companyId).eq('id', underlayId).single(),
    supabaseService.from('customers').select('*').eq('company_id', input.companyId).eq('id', customerId).single(),
    supabaseService.from('customer_contracts').select('*').eq('company_id', input.companyId).eq('id', contractId).single(),
    supabaseService.from('customer_invoices').select('*').eq('company_id', input.companyId).eq('invoice_export_item_id', input.invoiceExportItemId).single(),
    supabaseService.from('pricing_runs').select('*').eq('company_id', input.companyId).eq('id', pricingRunId).single(),
    supabaseService.from('pricing_preview_lines').select('*').eq('company_id', input.companyId).eq('pricing_run_id', pricingRunId).order('sort_order', { ascending: true }),
  ])
  for (const result of [underlay, customer, contract, invoice, pricingRun, pricingLines]) if (result.error) throw result.error
  const underlayRow = underlay.data as Row
  const snapshotId = text(underlayRow.contract_price_snapshot_id) ?? text(underlayRow.pricing_snapshot_id)
  let priceSnapshot: Row | null = null
  if (snapshotId) {
    const result = await supabaseService.from('contract_price_snapshots').select('*').eq('company_id', input.companyId).eq('id', snapshotId).maybeSingle()
    if (result.error) throw result.error
    priceSnapshot = (result.data as Row | null) ?? null
  }
  return {
    item,
    underlay: underlayRow,
    customer: customer.data as Row,
    contract: contract.data as Row,
    invoice: invoice.data as Row,
    pricingRun: pricingRun.data as Row,
    pricingLines: (pricingLines.data ?? []) as Row[],
    priceSnapshot,
    approval: objectValue(objectValue(item.metadata).approval),
  }
}
