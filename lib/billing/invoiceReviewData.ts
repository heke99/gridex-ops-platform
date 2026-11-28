import { readBillingRows } from '@/lib/pricing/adminData'
import { isDispatchImplemented, loadTenantInvoiceProviderSelection, type DispatchProvider, type InvoiceProviderEnvironment } from '@/lib/billing/providers/registry'
import { supabaseService } from '@/lib/supabase/service'

export type InvoiceReviewStatus =
  | 'missing_meter_values'
  | 'blocked'
  | 'preparing'
  | 'ready_for_review'
  | 'approved'
  | 'file_created'
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
  hasApprovedCalculation: boolean
  statusLabel: string
  blocker: string | null
  edielSourceNeedsReview?: boolean
  reservationReview?: boolean
}

export type InvoiceReviewLifecycleStage =
  | 'awaiting_invoice_projection'
  | 'invoice_projected'
  | 'approved'
  | 'file_created'
  | 'dispatched'

type Row = Record<string, unknown>
type InvoicePath = { provider: DispatchProvider; environment: InvoiceProviderEnvironment }

export function invoiceReviewActivePath(selection: { invoice_export_target_system?: unknown; billing_provider_environment?: unknown } | null): InvoicePath | null {
  const provider = selection?.invoice_export_target_system
  const environment = selection?.billing_provider_environment
  return isDispatchImplemented(provider) && (environment === 'test' || environment === 'production')
    ? { provider, environment }
    : null
}

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

function isOpenInvoiceReservation(item: Row | null, invoice: Row | null) {
  return item?.status === 'pending' && (!invoice || invoice.status === 'draft') && !text(item.export_file_id)
}

function isEarlierInvoiceReservation(item: Row | null, run: Row | null, activePath: InvoicePath | null) {
  if (!activePath) return false
  return [item, run].some(row => {
    const provider = text(row?.provider)
    const environment = text(row?.environment)
    return (provider !== null && provider !== activePath.provider) ||
      (environment !== null && environment !== activePath.environment)
  })
}

function readFileExportStatus(item: Row | null, invoice: Row | null) {
  const id = text(item?.export_file_id)
  if (id) return { id, label: 'Fil skapad', needsAction: false }

  // A legacy marker identifies the file path without proving a saved file.
  if (item?.provider_status === 'exported_to_file' || text(invoice?.partner_invoice_reference)?.startsWith('file:')) {
    return { id: null, label: 'Filstatus behöver kontrolleras', needsAction: true }
  }
  return null
}

function deriveStatus(input: {
  underlay: Row
  item: Row | null
  invoice: Row | null
  run: Row | null
  activePath: InvoicePath | null
  blockReason: string | null
}): {
  status: InvoiceReviewStatus
  label: string
  blocker: string | null
  reservationReview?: boolean
} {
  const itemStatus = text(input.item?.status)
  const invoiceStatus = text(input.invoice?.status)
  const fileExport = readFileExportStatus(input.item, input.invoice)
  if (input.invoice && fileExport) {
    return fileExport.id
      ? { status: 'file_created', label: fileExport.label, blocker: null }
      : { status: 'failed', label: fileExport.label, blocker: 'Kontrollera den sparade fakturafilen.' }
  }
  // The export item records the attempt before the invoice mirror is updated.
  const exportStatus = invoiceExportStatus(itemStatus)
  if (exportStatus.needsAction) {
    return {
      status: 'failed',
      label: exportStatus.label,
      blocker: 'Kontrollera överföringen till fakturapartnern.',
    }
  }
  if (input.invoice && (itemStatus === 'sent' || invoiceStatus === 'sent')) {
    return { status: 'sent', label: 'Skickad', blocker: null }
  }
  const { blockReason } = input
  if ((num(input.underlay.missing_values_count) ?? 0) > 0 || blockReason === 'missing_meter_values') {
    return { status: 'missing_meter_values', label: 'Saknar mätvärden', blocker: 'Kompletta mätvärden saknas för fakturaperioden.' }
  }
  if (input.underlay.status !== 'validated' || input.underlay.readiness_status !== 'ready') {
    return { status: 'blocked', label: 'Flaggad', blocker: blockReason ?? 'Faktureringsunderlaget är inte klart.' }
  }
  if (isOpenInvoiceReservation(input.item, input.invoice) && isEarlierInvoiceReservation(input.item, input.run, input.activePath)) {
    return {
      status: 'blocked',
      label: 'Tidigare reservation',
      blocker: 'En reservation från en annan fakturaleverantör eller miljö måste stämmas av innan underlaget kan beredas på nytt.',
      reservationReview: true,
    }
  }
  if (input.item && !input.invoice) {
    return { status: 'preparing', label: 'Faktura projiceras', blocker: null }
  }
  if (input.invoice && approvalStatus(input.item?.metadata) === 'approved') {
    return { status: 'approved', label: 'Godkänd', blocker: null }
  }
  if (input.invoice && itemStatus === 'pending') {
    return { status: 'ready_for_review', label: 'Klar för granskning', blocker: null }
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

function activeInvoiceItemByUnderlay(items: Row[]): Map<string, Row> {
  const active = items
    .filter((row) => text(row.status) !== 'cancelled')
    .sort((a, b) => (text(a.created_at) ?? '').localeCompare(text(b.created_at) ?? ''))
  return new Map(active.map((row) => [text(row.billing_underlay_id) ?? '', row]))
}

export async function listInvoiceReviewRows(input: {
  companyId: string
  billingMonth: string
  activePath?: InvoicePath | null
}): Promise<InvoiceReviewRow[]> {
  const underlays = await loadUnderlays(input.companyId, input.billingMonth)
  const underlayIds = underlays.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const items = await loadByIds({
    table: 'invoice_export_items',
    select: 'id,billing_underlay_id,customer_id,status,total_kwh,amount_inc_vat,metadata,export_run_id,export_file_id,provider_status,provider,environment,created_at',
    companyId: input.companyId,
    column: 'billing_underlay_id',
    ids: underlayIds,
  })
  const itemByUnderlay = activeInvoiceItemByUnderlay(items)
  const activeItems = Array.from(itemByUnderlay.values())
  const itemIds = activeItems.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const invoices = await loadByIds({
    table: 'customer_invoices',
    select: 'id,invoice_export_item_id,status,total_kwh,consumption_kwh,amount_inc_vat,partner_invoice_reference',
    companyId: input.companyId,
    column: 'invoice_export_item_id',
    ids: itemIds,
  })
  const invoiceByItem = new Map(invoices.map((row) => [text(row.invoice_export_item_id) ?? '', row]))
  const customerIds = Array.from(new Set(underlays.map((row) => text(row.customer_id)).filter((value): value is string => Boolean(value))))
  const contractIds = Array.from(new Set(underlays.map((row) => text(row.customer_contract_id) ?? text(row.contract_id)).filter((value): value is string => Boolean(value))))
  const runIds = input.activePath ? [...new Set(activeItems
    .filter(item => item.status === 'pending' && !text(item.export_file_id))
    .map(item => text(item.export_run_id)).filter((id): id is string => id !== null))] : []
  const [customers, contracts, runs] = await Promise.all([
    loadByIds({ table: 'customers', select: 'id,customer_number,first_name,last_name,company_name,name', companyId: input.companyId, column: 'id', ids: customerIds }),
    loadByIds({ table: 'customer_contracts', select: 'id,contract_name,contract_type,price_area_used', companyId: input.companyId, column: 'id', ids: contractIds }),
    loadByIds({ table: 'invoice_export_runs', select: 'id,provider,environment', companyId: input.companyId, column: 'id', ids: runIds }),
  ])
  const runById = new Map(runs.map(run => [text(run.id), run]))
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
    const rawBlockReason = text(underlay.billing_block_reason)
    const reasons = rawBlockReason?.split(';').map(reason => reason.trim()) ?? []
    const sourceReason = (reason: string) => /^source_basis_unqualified(?::|$)/.test(reason)
    const hasSourceIssue = reasons.some(sourceReason)
    const blockReason = hasSourceIssue ? reasons.filter(reason => !sourceReason(reason)).join('; ') || null : rawBlockReason
    const state = deriveStatus({
      underlay, item, invoice, blockReason,
      run: runById.get(text(item?.export_run_id)) ?? null,
      activePath: input.activePath ?? null,
    })
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
      hasApprovedCalculation: Boolean(invoice) && approvalStatus(item?.metadata) === 'approved',
      statusLabel: state.label,
      blocker: state.blocker,
      ...(hasSourceIssue && ['blocked', 'missing_meter_values', 'failed'].includes(state.status)
        ? { edielSourceNeedsReview: true } : {}),
      ...(state.reservationReview ? { reservationReview: true } : {}),
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
  if (!underlayId || !customerId || !contractId || !pricingRunId) throw new Error('Fakturan saknar uppgifter som behövs för att granska underlag, kund, avtal och pris.')

  const [underlay, customer, contract, invoice, pricingRun, pricingLines] = await Promise.all([
    supabaseService.from('billing_underlays').select('*').eq('company_id', input.companyId).eq('id', underlayId).single(),
    supabaseService.from('customers').select('*').eq('company_id', input.companyId).eq('id', customerId).single(),
    supabaseService.from('customer_contracts').select('*').eq('company_id', input.companyId).eq('id', contractId).single(),
    supabaseService.from('customer_invoices').select('*').eq('company_id', input.companyId).eq('invoice_export_item_id', input.invoiceExportItemId).maybeSingle(),
    supabaseService.from('pricing_runs').select('*').eq('company_id', input.companyId).eq('id', pricingRunId).single(),
    readBillingRows('pricing_preview_lines', input.companyId, { pricing_run_id: pricingRunId }, 'sort_order').then(data => ({ data, error: null })),
  ])
  for (const result of [underlay, customer, contract, invoice, pricingRun, pricingLines]) if (result.error) throw result.error
  const underlayRow = underlay.data as Row
  const invoiceRow = (invoice.data as Row | null) ?? null
  const approval = objectValue(objectValue(item.metadata).approval)
  const notCompared = { reservation: null, reservationReadFailed: false }
  const reservationResult = isOpenInvoiceReservation(item, invoiceRow)
    ? await readReservationReview(input.companyId, item, invoiceRow).then(
      (reservation) => ({ reservation, reservationReadFailed: false }),
      () => ({ ...notCompared, reservationReadFailed: true }),
    )
    : notCompared
  const fileExport = readFileExportStatus(item, invoiceRow)
  const exportStatus = fileExport ?? invoiceExportStatus(item.status)
  const lifecycleStage: InvoiceReviewLifecycleStage = !invoiceRow
    ? 'awaiting_invoice_projection'
    : fileExport?.id
      ? 'file_created'
      : !exportStatus.needsAction && (text(item.status) === 'sent' || text(invoiceRow.status) === 'sent')
        ? 'dispatched'
        : text(approval.status) === 'approved'
          ? 'approved'
          : 'invoice_projected'
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
    invoice: invoiceRow,
    lifecycleStage,
    fileExport,
    exportStatus,
    ...reservationResult,
    pricingRun: pricingRun.data as Row,
    pricingLines: (pricingLines.data ?? []) as Row[],
    priceSnapshot,
    approval,
  }
}

async function readReservationReview(companyId: string, item: Row, invoice: Row | null) {
  const activePath = invoiceReviewActivePath(await loadTenantInvoiceProviderSelection(companyId))
  if (!activePath) return null

  const runId = text(item.export_run_id)
  const runResult = runId ? await supabaseService.from('invoice_export_runs')
    .select('id,provider,environment,status').eq('company_id', companyId).eq('id', runId).maybeSingle() : null
  if (runResult?.error) throw runResult.error
  const run = runResult?.data ?? null
  if (!isEarlierInvoiceReservation(item, run, activePath)) return null

  return {
    activePath,
    itemPath: { provider: text(item.provider), environment: text(item.environment) },
    runPath: run ? { provider: text(run.provider), environment: text(run.environment) } : null,
    runId: text(run?.id),
    runStatus: text(run?.status),
    attemptCount: num(item.attempt_count),
    providerConfirmedAt: text(item.provider_confirmed_at),
    deliveryUncertain: item.provider_delivery_uncertain === true,
    hasPartnerReference: Boolean(text(item.provider_invoice_number) || text(item.provider_invoice_guid) ||
      text(item.provider_invoice_id) || text(invoice?.partner_invoice_reference)),
    hasInvoiceNumber: Boolean(text(invoice?.invoice_number)),
  }
}

/** Transfer is a separate axis from the human approval recorded in metadata. */
export function invoiceExportStatus(status: unknown): { label: string; needsAction: boolean } {
  if (status === 'sent') return { label: 'Överförd till fakturapartner', needsAction: false }
  if (['failed', 'rejected', 'configuration_error', 'needs_review', 'failed_retryable'].includes(String(status))) return { label: 'Överföringen kräver åtgärd', needsAction: true }
  if (['pending', 'queued', 'ready', 'approved', 'draft', 'prepared', 'exporting', 'processing'].includes(String(status))) return { label: 'Väntar på överföring', needsAction: false }
  return { label: 'Överföringsstatus behöver kontrolleras', needsAction: false }
}
