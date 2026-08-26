import { createHash, randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import {
  calculateUnderlayPricingWithCore,
  loadLockedUnderlayPricingWithCore,
  type UnderlayCorePricingResult,
} from '@/lib/pricing/underlayPricingAdapter'
import { lockPricingPreview } from '@/lib/pricing/engine'
import { sendInvoiceExportRun } from '@/lib/integrations/billing/invoiceExportCore'
import { emitDomainEvent } from '@/lib/events/domainEvents'

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

function numberValue(value: unknown): number | null {
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
  return { billingMonth: value.trim(), year: Number(match[1]), month: Number(match[2]) }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Row)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function sha256(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function customerName(customer: Row | null): string {
  if (!customer) return 'Okänd kund'
  const company = text(customer.company_name)
  if (company) return company
  const full = [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(' ')
  return full || text(customer.name) || text(customer.customer_number) || 'Okänd kund'
}

function approvalMetadata(value: unknown): Row {
  return objectValue(objectValue(value).approval)
}

async function loadUnderlays(companyId: string, billingMonth: string): Promise<Row[]> {
  const { year, month } = monthParts(billingMonth)
  const rows: Row[] = []
  for (let from = 0; ; from += 1_000) {
    const result = await supabaseService
      .from('billing_underlays')
      .select('id,company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_id,customer_contract_id,underlay_year,underlay_month,status,readiness_status,total_kwh,currency,billing_period_start,billing_period_end,missing_values_count,source_meter_value_count,price_area,pricing_snapshot_id,contract_price_snapshot_id,price_plan_id,price_plan_version_id,billing_block_reason,invoice_readiness_status,invoice_readiness_issues,billing_configuration_snapshot_sha256,portfolio_id,portfolio_monthly_settlement_id,portfolio_settlement_revision,portfolio_settlement_sha256,vat_rate,energy_direction,settlement_type')
      .eq('company_id', companyId)
      .eq('underlay_year', year)
      .eq('underlay_month', month)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (result.error) throw result.error
    const page = (result.data ?? []) as Row[]
    rows.push(...page)
    if (page.length < 1_000) break
  }
  return rows
}

async function loadExistingItems(companyId: string, underlayIds: string[]): Promise<Row[]> {
  if (underlayIds.length === 0) return []
  const rows: Row[] = []
  for (let offset = 0; offset < underlayIds.length; offset += 200) {
    const result = await supabaseService
      .from('invoice_export_items')
      .select('*')
      .eq('company_id', companyId)
      .in('billing_underlay_id', underlayIds.slice(offset, offset + 200))
    if (result.error) throw result.error
    rows.push(...((result.data ?? []) as Row[]))
  }
  return rows
}

async function loadContracts(companyId: string, contractIds: string[]): Promise<Map<string, Row>> {
  const map = new Map<string, Row>()
  if (contractIds.length === 0) return map
  for (let offset = 0; offset < contractIds.length; offset += 200) {
    const result = await supabaseService
      .from('customer_contracts')
      .select('id,company_id,customer_id,contract_number,contract_name,contract_type,status,price_area_used,contract_price_snapshot_id,price_plan_id,price_plan_version_id,contract_product_version_id,snapshot_hash,invoice_recipient,invoice_email,invoice_reference,billing_street,billing_postal_code,billing_city,billing_country,billing_level,consolidated_invoice,fixed_price_ore_per_kwh,vat_rate')
      .eq('company_id', companyId)
      .in('id', contractIds.slice(offset, offset + 200))
    if (result.error) throw result.error
    for (const row of (result.data ?? []) as Row[]) {
      const id = text(row.id)
      if (id) map.set(id, row)
    }
  }
  return map
}

async function loadCustomers(companyId: string, customerIds: string[]): Promise<Map<string, Row>> {
  const map = new Map<string, Row>()
  if (customerIds.length === 0) return map
  for (let offset = 0; offset < customerIds.length; offset += 200) {
    const result = await supabaseService
      .from('customers')
      .select('id,customer_number,customer_type,first_name,last_name,company_name,name,email')
      .eq('company_id', companyId)
      .in('id', customerIds.slice(offset, offset + 200))
    if (result.error) throw result.error
    for (const row of (result.data ?? []) as Row[]) {
      const id = text(row.id)
      if (id) map.set(id, row)
    }
  }
  return map
}

async function loadPriceSnapshot(companyId: string, snapshotId: string | null): Promise<Row | null> {
  if (!snapshotId) return null
  const result = await supabaseService
    .from('contract_price_snapshots')
    .select('id,contract_id,pricing_model,snapshot_hash,snapshot_schema_version,price_option_reference,area_price_reference,price_plan_version_id,price_plan_id,spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,invoice_delivery_method,valid_from,valid_to')
    .eq('company_id', companyId)
    .eq('id', snapshotId)
    .maybeSingle()
  if (result.error) throw result.error
  return (result.data as Row | null) ?? null
}

async function ensureLockedPricing(input: {
  companyId: string
  billingUnderlayId: string
  actorUserId: string | null
}): Promise<UnderlayCorePricingResult> {
  const existing = await loadLockedUnderlayPricingWithCore(input)
  if (existing?.locked) return existing

  const calculated = await calculateUnderlayPricingWithCore({
    companyId: input.companyId,
    billingUnderlayId: input.billingUnderlayId,
    persist: true,
  })
  if (calculated.status !== 'success' || !calculated.pricingRunId) {
    throw new Error(calculated.errors.join(' ') || 'Prisberäkningen blev inte klar.')
  }
  await lockPricingPreview({
    companyId: input.companyId,
    pricingRunId: calculated.pricingRunId,
    actorUserId: input.actorUserId,
  })
  const locked = await loadLockedUnderlayPricingWithCore(input)
  if (!locked?.locked) throw new Error('Prisberäkningen kunde inte verifieras som låst.')
  return locked
}

function buildCalculationSnapshot(input: {
  underlay: Row
  contract: Row
  priceSnapshot: Row | null
  pricing: UnderlayCorePricingResult
  billingMonth: string
}) {
  const priceArea = text(input.underlay.price_area) ?? text(input.contract.price_area_used)
  if (!priceArea || !['SE1', 'SE2', 'SE3', 'SE4'].includes(priceArea)) {
    throw new Error('Fakturan saknar entydigt svenskt elområde SE1–SE4.')
  }
  return {
    schema: 'gridex_invoice_calculation_v1',
    billing_month: input.billingMonth,
    billing_underlay_id: text(input.underlay.id),
    customer_contract_id: text(input.contract.id),
    contract_number: text(input.contract.contract_number),
    contract_type: text(input.contract.contract_type),
    contract_name: text(input.contract.contract_name),
    contract_product_version_id: text(input.contract.contract_product_version_id),
    price_area: priceArea,
    contract_price_snapshot_id: text(input.priceSnapshot?.id) ?? text(input.underlay.contract_price_snapshot_id) ?? text(input.underlay.pricing_snapshot_id),
    contract_price_snapshot_hash: text(input.priceSnapshot?.snapshot_hash) ?? text(input.contract.snapshot_hash),
    pricing_snapshot_schema_version: text(input.priceSnapshot?.snapshot_schema_version),
    pricing_model: text(input.priceSnapshot?.pricing_model),
    price_option_reference: text(input.priceSnapshot?.price_option_reference),
    area_price_reference: text(input.priceSnapshot?.area_price_reference),
    price_plan_id: text(input.underlay.price_plan_id) ?? text(input.contract.price_plan_id),
    price_plan_version_id: text(input.underlay.price_plan_version_id) ?? text(input.contract.price_plan_version_id),
    billing_configuration_snapshot_sha256: text(input.underlay.billing_configuration_snapshot_sha256),
    portfolio_id: text(input.underlay.portfolio_id),
    portfolio_monthly_settlement_id: text(input.underlay.portfolio_monthly_settlement_id),
    portfolio_settlement_revision: numberValue(input.underlay.portfolio_settlement_revision),
    portfolio_settlement_sha256: text(input.underlay.portfolio_settlement_sha256),
    period_start: text(input.underlay.billing_period_start),
    period_end: text(input.underlay.billing_period_end),
    total_kwh: numberValue(input.underlay.total_kwh),
    pricing_run_id: input.pricing.pricingRunId,
    pricing_engine: input.pricing.engine,
    pricing_lines: input.pricing.lines,
    interval_evidence: input.pricing.intervalEvidence,
    subtotal_sek_ex_vat: input.pricing.subtotalSekExVat,
    vat_sek: input.pricing.vatSek,
    total_sek_inc_vat: input.pricing.totalSekIncVat,
    vat_rate: numberValue(input.underlay.vat_rate) ?? numberValue(input.contract.vat_rate) ?? 0.25,
  }
}

async function createDraftForUnderlay(input: {
  companyId: string
  billingMonth: string
  environment: 'test' | 'production'
  actorUserId: string | null
  underlay: Row
  contract: Row
  customer: Row | null
}) {
  const underlayId = text(input.underlay.id)
  const customerId = text(input.underlay.customer_id)
  const contractId = text(input.underlay.customer_contract_id) ?? text(input.underlay.contract_id)
  if (!underlayId || !customerId || !contractId || contractId !== text(input.contract.id)) {
    throw new Error('Faktureringsunderlagets kund-/avtalsidentitet är ofullständig.')
  }
  const pricing = await ensureLockedPricing({
    companyId: input.companyId,
    billingUnderlayId: underlayId,
    actorUserId: input.actorUserId,
  })
  if (!pricing.pricingRunId) throw new Error('Låst pricing_run saknas.')

  const snapshotId = text(input.underlay.contract_price_snapshot_id) ?? text(input.underlay.pricing_snapshot_id) ?? text(input.contract.contract_price_snapshot_id)
  const priceSnapshot = await loadPriceSnapshot(input.companyId, snapshotId)
  const calculationSnapshot = buildCalculationSnapshot({
    underlay: input.underlay,
    contract: input.contract,
    priceSnapshot,
    pricing,
    billingMonth: input.billingMonth,
  })
  const calculationSnapshotSha256 = sha256(calculationSnapshot)
  const runId = randomUUID()
  const itemId = randomUUID()
  const now = new Date().toISOString()
  const itemIdempotencyKey = `invoice-review:capway_aptic:${input.companyId}:${underlayId}:${pricing.pricingRunId}`
  const runIdempotencyKey = `invoice-review-run:${itemIdempotencyKey}`
  const approval = {
    status: 'pending_review',
    prepared_at: now,
    prepared_by: input.actorUserId,
    calculation_snapshot_sha256: calculationSnapshotSha256,
  }
  const invoiceAddress = {
    recipient: text(input.contract.invoice_recipient),
    email: text(input.contract.invoice_email),
    reference: text(input.contract.invoice_reference),
    street: text(input.contract.billing_street),
    postal_code: text(input.contract.billing_postal_code),
    city: text(input.contract.billing_city),
    country: text(input.contract.billing_country) ?? 'SE',
  }

  const legacyItem = {
    id: itemId,
    company_id: input.companyId,
    billing_underlay_id: underlayId,
    contract_id: contractId,
    customer_id: customerId,
    site_id: text(input.underlay.customer_site_id) ?? text(input.underlay.site_id),
    metering_point_id: text(input.underlay.metering_point_id),
    status: 'ready',
    readiness_status: 'ready',
    blocker_reasons: [],
    pricing_line_items: pricing.lines,
    invoice_recipient: invoiceAddress.recipient,
    invoice_email: invoiceAddress.email,
    invoice_reference: invoiceAddress.reference,
    billing_level: text(input.contract.billing_level) ?? 'customer',
    consolidated_invoice: input.contract.consolidated_invoice === true,
    invoice_address_snapshot: invoiceAddress,
    site_address_snapshot: {},
    consolidated_invoice_group_key: input.contract.consolidated_invoice === true ? `customer:${customerId}` : `underlay:${underlayId}`,
    adapter_key: 'gridex_billing_partner_v1',
    payload_version: 'billing_export_item_v4c',
    adapter_payload_snapshot: {},
    external_reference: `BILLING-${input.billingMonth}-${underlayId.slice(0, 8).toUpperCase()}`,
    export_status: 'not_queued',
    idempotency_key: `legacy:${itemIdempotencyKey}`,
    payload_snapshot: {
      underlay: input.underlay,
      contract: input.contract,
      pricing: { ...pricing, pricingRunId: pricing.pricingRunId },
      calculation: calculationSnapshot,
      calculation_snapshot_sha256: calculationSnapshotSha256,
      approval,
    },
    created_at: now,
    updated_at: now,
  }
  const legacyRun = {
    id: runId,
    company_id: input.companyId,
    period_month: input.billingMonth,
    target_system: 'capway_aptic',
    export_format: 'json',
    status: 'ready',
    rows_total: 1,
    rows_ready: 1,
    rows_blocked: 0,
    rows_exported: 0,
    blocker_summary: [],
    created_by: input.actorUserId,
    created_at: now,
    updated_at: now,
    adapter_key: 'gridex_billing_partner_v1',
    payload_version: 'billing_export_v4c',
    retry_policy: { maxAttempts: 3, strategy: 'manual_retry' },
    idempotency_key: runIdempotencyKey,
    metadata: { source: 'invoice_review_v1', approval_required: true, calculation_snapshot_sha256: calculationSnapshotSha256 },
  }
  const canonicalItem = {
    id: itemId,
    company_id: input.companyId,
    billing_underlay_id: underlayId,
    pricing_run_id: pricing.pricingRunId,
    customer_contract_id: contractId,
    customer_id: customerId,
    metering_point_id: text(input.underlay.metering_point_id),
    period_start: text(input.underlay.billing_period_start),
    period_end: text(input.underlay.billing_period_end),
    total_kwh: numberValue(input.underlay.total_kwh) ?? 0,
    currency: text(input.underlay.currency) ?? 'SEK',
    provider: 'capway_aptic',
    environment: input.environment,
    financing_mode: 'invoice_service',
    amount_ex_vat: pricing.subtotalSekExVat,
    vat_amount: pricing.vatSek,
    amount_inc_vat: pricing.totalSekIncVat,
    idempotency_key: itemIdempotencyKey,
    metadata: {
      billing_month: input.billingMonth,
      customer_number: text(input.customer?.customer_number),
      approval,
      calculation_snapshot_sha256: calculationSnapshotSha256,
      contract_type: text(input.contract.contract_type),
      price_area: calculationSnapshot.price_area,
    },
  }
  const canonicalInvoice = {
    invoice_export_item_id: itemId,
    customer_id: customerId,
    customer_contract_id: contractId,
    period_start: text(input.underlay.billing_period_start),
    period_end: text(input.underlay.billing_period_end),
    total_kwh: numberValue(input.underlay.total_kwh) ?? 0,
    currency: text(input.underlay.currency) ?? 'SEK',
    amount_ex_vat: pricing.subtotalSekExVat,
    vat_amount: pricing.vatSek,
    amount_inc_vat: pricing.totalSekIncVat,
    metadata: {
      source: 'invoice_review_v1',
      approval,
      calculation_snapshot_sha256: calculationSnapshotSha256,
      customer_number: text(input.customer?.customer_number),
    },
  }

  const created = await supabaseService.rpc('gridex_create_invoice_export_graph_v1', {
    p_run: {
      id: runId,
      company_id: input.companyId,
      provider: 'capway_aptic',
      environment: input.environment,
      billing_month: input.billingMonth,
      financing_mode: 'invoice_service',
      readiness_snapshot: { underlay_id: underlayId, status: 'ready', approval_required: true },
      metadata: { source: 'invoice_review_v1', approval_required: true, calculation_snapshot_sha256: calculationSnapshotSha256 },
      requested_by: input.actorUserId,
      idempotency_key: runIdempotencyKey,
      legacy_run: legacyRun,
      legacy_items: [legacyItem],
    },
    p_items: [canonicalItem],
    p_invoices: [canonicalInvoice],
  })
  if (created.error) throw created.error

  const invoiceUpdate = await supabaseService
    .from('customer_invoices')
    .update({
      price_plan_version_id: text(input.underlay.price_plan_version_id) ?? text(input.contract.price_plan_version_id),
      price_area_code: calculationSnapshot.price_area,
      consumption_kwh: numberValue(input.underlay.total_kwh),
      vat_rate: calculationSnapshot.vat_rate,
      calculation_snapshot: calculationSnapshot,
      calculation_snapshot_sha256: calculationSnapshotSha256,
      metadata: canonicalInvoice.metadata,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('invoice_export_item_id', itemId)
    .select('id')
    .maybeSingle()
  if (invoiceUpdate.error) throw invoiceUpdate.error
  if (!invoiceUpdate.data) throw new Error('Draftfakturan kunde inte verifieras efter skapande.')

  await emitDomainEvent({
    companyId: input.companyId,
    eventType: 'invoice.created',
    aggregateType: 'invoice_export_item',
    aggregateId: itemId,
    subjectCustomerId: customerId,
    actorUserId: input.actorUserId,
    source: 'invoice_review_v1',
    payload: { billing_month: input.billingMonth, billing_underlay_id: underlayId, pricing_run_id: pricing.pricingRunId, approval_status: 'pending_review' },
    idempotencyKey: `invoice-review-created:${itemIdempotencyKey}`,
  }).catch(() => null)

  return { runId, itemId }
}

export async function prepareInvoiceDraftsForReview(input: {
  companyId: string
  billingMonth: string
  environment?: 'test' | 'production'
  actorUserId?: string | null
}) {
  await requireCompanyOperationalForWrites(input.companyId)
  monthParts(input.billingMonth)
  const environment = input.environment ?? 'test'
  const underlays = await loadUnderlays(input.companyId, input.billingMonth)
  const underlayIds = underlays.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const existingItems = await loadExistingItems(input.companyId, underlayIds)
  const reservedUnderlays = new Set(existingItems.map((row) => text(row.billing_underlay_id)).filter((value): value is string => Boolean(value)))
  const ready = underlays.filter((row) => row.status === 'validated' && row.readiness_status === 'ready' && !reservedUnderlays.has(String(row.id)))

  const contractIds = Array.from(new Set(ready.map((row) => text(row.customer_contract_id) ?? text(row.contract_id)).filter((value): value is string => Boolean(value))))
  const customerIds = Array.from(new Set(ready.map((row) => text(row.customer_id)).filter((value): value is string => Boolean(value))))
  const [contracts, customers] = await Promise.all([
    loadContracts(input.companyId, contractIds),
    loadCustomers(input.companyId, customerIds),
  ])

  let created = 0
  let failed = 0
  const errors: Array<{ billingUnderlayId: string; error: string }> = []
  const candidates = ready.map((underlay) => async () => {
    const underlayId = text(underlay.id) ?? 'unknown'
    try {
      const contractId = text(underlay.customer_contract_id) ?? text(underlay.contract_id)
      const contract = contractId ? contracts.get(contractId) : null
      if (!contract) throw new Error('Exakt kundavtal saknas eller ligger utanför tenant.')
      const customerId = text(underlay.customer_id)
      await createDraftForUnderlay({
        companyId: input.companyId,
        billingMonth: input.billingMonth,
        environment,
        actorUserId: input.actorUserId ?? null,
        underlay,
        contract,
        customer: customerId ? customers.get(customerId) ?? null : null,
      })
      created += 1
    } catch (error) {
      failed += 1
      errors.push({ billingUnderlayId: underlayId, error: error instanceof Error ? error.message : 'Draftfakturan kunde inte skapas.' })
    }
  })

  for (let offset = 0; offset < candidates.length; offset += 10) {
    await Promise.all(candidates.slice(offset, offset + 10).map((run) => run()))
  }

  const blocked = underlays.filter((row) => row.status !== 'validated' || row.readiness_status !== 'ready').length
  return {
    billingMonth: input.billingMonth,
    underlays: underlays.length,
    alreadyPrepared: reservedUnderlays.size,
    candidates: ready.length,
    created,
    blocked,
    failed,
    errors,
  }
}

function reviewStatus(input: { underlay: Row; item: Row | null; invoice: Row | null }): { status: InvoiceReviewStatus; label: string; blocker: string | null } {
  const itemStatus = text(input.item?.status)
  const invoiceStatus = text(input.invoice?.status)
  const approval = approvalMetadata(input.item?.metadata)
  if (itemStatus === 'sent' || invoiceStatus === 'sent') return { status: 'sent', label: 'Skickad', blocker: null }
  if (['failed', 'rejected', 'configuration_error', 'needs_review'].includes(itemStatus ?? '')) {
    return { status: 'failed', label: 'Kräver åtgärd', blocker: text(objectValue(input.item?.error_payload).message) ?? 'Fakturaexporten kräver åtgärd.' }
  }
  if (approval.status === 'approved') return { status: 'approved', label: 'Godkänd', blocker: null }
  if (itemStatus === 'pending') return { status: 'ready_for_review', label: 'Klar för granskning', blocker: null }
  const blockReason = text(input.underlay.billing_block_reason)
  if ((numberValue(input.underlay.missing_values_count) ?? 0) > 0 || blockReason === 'missing_meter_values') {
    return { status: 'missing_meter_values', label: 'Saknar mätvärden', blocker: 'Kompletta mätvärden saknas för fakturaperioden.' }
  }
  if (input.underlay.status !== 'validated' || input.underlay.readiness_status !== 'ready') {
    return { status: 'blocked', label: 'Flaggad', blocker: blockReason ?? 'Faktureringsunderlaget är inte klart.' }
  }
  return { status: 'preparing', label: 'Förbereds', blocker: null }
}

export async function listInvoiceReviewRows(input: { companyId: string; billingMonth: string }): Promise<InvoiceReviewRow[]> {
  const underlays = await loadUnderlays(input.companyId, input.billingMonth)
  const underlayIds = underlays.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const items = await loadExistingItems(input.companyId, underlayIds)
  const itemByUnderlay = new Map(items.map((row) => [text(row.billing_underlay_id) ?? '', row]))
  const itemIds = items.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const invoices: Row[] = []
  for (let offset = 0; offset < itemIds.length; offset += 200) {
    const result = await supabaseService.from('customer_invoices').select('*').eq('company_id', input.companyId).in('invoice_export_item_id', itemIds.slice(offset, offset + 200))
    if (result.error) throw result.error
    invoices.push(...((result.data ?? []) as Row[]))
  }
  const invoiceByItem = new Map(invoices.map((row) => [text(row.invoice_export_item_id) ?? '', row]))
  const contractIds = Array.from(new Set(underlays.map((row) => text(row.customer_contract_id) ?? text(row.contract_id)).filter((value): value is string => Boolean(value))))
  const customerIds = Array.from(new Set(underlays.map((row) => text(row.customer_id)).filter((value): value is string => Boolean(value))))
  const [contracts, customers] = await Promise.all([loadContracts(input.companyId, contractIds), loadCustomers(input.companyId, customerIds)])

  return underlays.map((underlay) => {
    const underlayId = text(underlay.id) ?? ''
    const item = itemByUnderlay.get(underlayId) ?? null
    const invoice = item ? invoiceByItem.get(text(item.id) ?? '') ?? null : null
    const contractId = text(underlay.customer_contract_id) ?? text(underlay.contract_id)
    const contract = contractId ? contracts.get(contractId) ?? null : null
    const customerId = text(underlay.customer_id) ?? ''
    const customer = customers.get(customerId) ?? null
    const state = reviewStatus({ underlay, item, invoice })
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
      totalKwh: numberValue(underlay.total_kwh),
      amountIncVat: numberValue(invoice?.amount_inc_vat) ?? numberValue(item?.amount_inc_vat),
      priceArea: text(underlay.price_area) ?? text(contract?.price_area_used),
      contractType: text(contract?.contract_type),
      contractName: text(contract?.contract_name),
      status: state.status,
      statusLabel: state.label,
      blocker: state.blocker,
    }
  }).sort((a, b) => a.customerName.localeCompare(b.customerName, 'sv'))
}

export async function getInvoiceReviewDetail(input: { companyId: string; invoiceExportItemId: string }) {
  const itemResult = await supabaseService.from('invoice_export_items').select('*').eq('company_id', input.companyId).eq('id', input.invoiceExportItemId).single()
  if (itemResult.error) throw itemResult.error
  const item = itemResult.data as Row
  const underlayId = text(item.billing_underlay_id)
  const customerId = text(item.customer_id)
  const contractId = text(item.customer_contract_id)
  const pricingRunId = text(item.pricing_run_id)
  if (!underlayId || !customerId || !contractId || !pricingRunId) throw new Error('Fakturan saknar canonical identitet.')
  const [underlay, customer, contract, invoice, pricingRun, lines] = await Promise.all([
    supabaseService.from('billing_underlays').select('*').eq('company_id', input.companyId).eq('id', underlayId).single(),
    supabaseService.from('customers').select('*').eq('company_id', input.companyId).eq('id', customerId).single(),
    supabaseService.from('customer_contracts').select('*').eq('company_id', input.companyId).eq('id', contractId).single(),
    supabaseService.from('customer_invoices').select('*').eq('company_id', input.companyId).eq('invoice_export_item_id', input.invoiceExportItemId).single(),
    supabaseService.from('pricing_runs').select('*').eq('company_id', input.companyId).eq('id', pricingRunId).single(),
    supabaseService.from('pricing_preview_lines').select('*').eq('company_id', input.companyId).eq('pricing_run_id', pricingRunId).order('sort_order', { ascending: true }),
  ])
  for (const result of [underlay, customer, contract, invoice, pricingRun, lines]) if (result.error) throw result.error
  const priceSnapshotId = text((underlay.data as Row).contract_price_snapshot_id) ?? text((underlay.data as Row).pricing_snapshot_id)
  const priceSnapshot = await loadPriceSnapshot(input.companyId, priceSnapshotId)
  return {
    item,
    underlay: underlay.data as Row,
    customer: customer.data as Row,
    contract: contract.data as Row,
    invoice: invoice.data as Row,
    pricingRun: pricingRun.data as Row,
    pricingLines: (lines.data ?? []) as Row[],
    priceSnapshot,
    approval: approvalMetadata(item.metadata),
  }
}

async function approveInvoiceItem(input: { companyId: string; item: Row; actorUserId: string }) {
  const itemId = text(input.item.id)
  const underlayId = text(input.item.billing_underlay_id)
  const pricingRunId = text(input.item.pricing_run_id)
  if (!itemId || !underlayId || !pricingRunId) throw new Error('Fakturan saknar underlags- eller pricing-identitet.')
  const [underlay, pricing, invoice] = await Promise.all([
    supabaseService.from('billing_underlays').select('id,status,readiness_status,customer_id,customer_contract_id,contract_id,metering_point_id,price_area,total_kwh,billing_period_start,billing_period_end,missing_values_count').eq('company_id', input.companyId).eq('id', underlayId).single(),
    supabaseService.from('pricing_runs').select('id,status,billing_underlay_id,customer_id,total_ex_vat,vat_amount,total_inc_vat,locked_at').eq('company_id', input.companyId).eq('id', pricingRunId).single(),
    supabaseService.from('customer_invoices').select('*').eq('company_id', input.companyId).eq('invoice_export_item_id', itemId).single(),
  ])
  for (const result of [underlay, pricing, invoice]) if (result.error) throw result.error
  const u = underlay.data as Row
  const p = pricing.data as Row
  const inv = invoice.data as Row
  if (u.status !== 'validated' || u.readiness_status !== 'ready' || (numberValue(u.missing_values_count) ?? 0) > 0) throw new Error('Kunden är inte längre faktureringsklar.')
  if (p.status !== 'locked' || text(p.billing_underlay_id) !== underlayId || !p.locked_at) throw new Error('Prisberäkningen är inte låst mot samma underlag.')
  if (text(u.customer_id) !== text(input.item.customer_id) || (text(u.customer_contract_id) ?? text(u.contract_id)) !== text(input.item.customer_contract_id)) throw new Error('Kund-/avtalskedjan har ändrats efter draftskapandet.')
  const amountPairs = [
    [numberValue(p.total_ex_vat), numberValue(inv.amount_ex_vat)],
    [numberValue(p.vat_amount), numberValue(inv.vat_amount)],
    [numberValue(p.total_inc_vat), numberValue(inv.amount_inc_vat)],
  ]
  if (amountPairs.some(([a, b]) => a === null || b === null || Math.abs(a - b) > 0.01)) throw new Error('Fakturabeloppet matchar inte den låsta prisberäkningen.')
  const calculationHash = text(inv.calculation_snapshot_sha256)
  if (!calculationHash) throw new Error('Juridisk beräkningssnapshot saknas på fakturan.')
  const reviewHash = sha256({ item_id: itemId, underlay_id: underlayId, pricing_run_id: pricingRunId, calculation_snapshot_sha256: calculationHash, total_inc_vat: numberValue(inv.amount_inc_vat), price_area: text(u.price_area), total_kwh: numberValue(u.total_kwh) })
  const approvedAt = new Date().toISOString()
  const itemMetadata = { ...objectValue(input.item.metadata), approval: { status: 'approved', approved_at: approvedAt, approved_by: input.actorUserId, review_hash: reviewHash, calculation_snapshot_sha256: calculationHash } }
  const invoiceMetadata = { ...objectValue(inv.metadata), approval: itemMetadata.approval }
  const itemUpdate = await supabaseService.from('invoice_export_items').update({ metadata: itemMetadata, updated_at: approvedAt }).eq('company_id', input.companyId).eq('id', itemId).eq('status', 'pending').select('id').maybeSingle()
  if (itemUpdate.error) throw itemUpdate.error
  if (!itemUpdate.data) throw new Error('Fakturan kunde inte godkännas atomiskt; status har ändrats.')
  const invoiceUpdate = await supabaseService.from('customer_invoices').update({ metadata: invoiceMetadata, updated_at: approvedAt }).eq('company_id', input.companyId).eq('invoice_export_item_id', itemId).eq('status', 'draft').select('id').maybeSingle()
  if (invoiceUpdate.error) throw invoiceUpdate.error
  if (!invoiceUpdate.data) throw new Error('Fakturaspegeln kunde inte markeras som godkänd.')
  await emitDomainEvent({ companyId: input.companyId, eventType: 'invoice.approved', aggregateType: 'invoice_export_item', aggregateId: itemId, subjectCustomerId: text(input.item.customer_id), actorUserId: input.actorUserId, source: 'invoice_review_v1', payload: { review_hash: reviewHash, approved_at: approvedAt }, idempotencyKey: `invoice-approved:${itemId}:${reviewHash}` }).catch(() => null)
}

export async function sendApprovedInvoiceExportRun(input: { companyId: string; exportRunId: string; actorUserId: string }) {
  const itemsResult = await supabaseService.from('invoice_export_items').select('id,status,metadata').eq('company_id', input.companyId).eq('export_run_id', input.exportRunId).in('status', ['pending', 'failed', 'failed_retryable'])
  if (itemsResult.error) throw itemsResult.error
  const items = (itemsResult.data ?? []) as Row[]
  if (items.length === 0) throw new Error('Exportkörningen saknar skickbara fakturor.')
  const unapproved = items.filter((item) => approvalMetadata(item.metadata).status !== 'approved')
  if (unapproved.length > 0) throw new Error('Fakturaexport blockerad: en eller flera fakturor saknar explicit godkännande.')
  return sendInvoiceExportRun({ companyId: input.companyId, exportRunId: input.exportRunId, actorUserId: input.actorUserId })
}

export async function approveAndSendReadyInvoicesForMonth(input: { companyId: string; billingMonth: string; actorUserId: string }) {
  await requireCompanyOperationalForWrites(input.companyId)
  monthParts(input.billingMonth)
  const runs = await supabaseService.from('invoice_export_runs').select('id').eq('company_id', input.companyId).eq('billing_month', input.billingMonth).order('created_at', { ascending: true })
  if (runs.error) throw runs.error
  const runIds = (runs.data ?? []).map((row) => String(row.id))
  if (runIds.length === 0) return { approved: 0, sent: 0, failed: 0, errors: [] as Array<{ invoiceExportItemId: string; error: string }> }
  const items: Row[] = []
  for (let offset = 0; offset < runIds.length; offset += 200) {
    const result = await supabaseService.from('invoice_export_items').select('*').eq('company_id', input.companyId).in('export_run_id', runIds.slice(offset, offset + 200)).eq('status', 'pending').order('created_at', { ascending: true })
    if (result.error) throw result.error
    items.push(...((result.data ?? []) as Row[]))
  }
  let approved = 0
  let sent = 0
  let failed = 0
  const errors: Array<{ invoiceExportItemId: string; error: string }> = []
  for (const item of items) {
    const itemId = text(item.id) ?? 'unknown'
    try {
      if (approvalMetadata(item.metadata).status !== 'approved') {
        await approveInvoiceItem({ companyId: input.companyId, item, actorUserId: input.actorUserId })
        approved += 1
      }
      const runId = text(item.export_run_id)
      if (!runId) throw new Error('Fakturan saknar exportkörning.')
      const result = await sendApprovedInvoiceExportRun({ companyId: input.companyId, exportRunId: runId, actorUserId: input.actorUserId })
      if (result.status === 'sent') sent += 1
      else throw new Error(`Fakturapartnern bekräftade inte utskick (${result.status}).`)
    } catch (error) {
      failed += 1
      errors.push({ invoiceExportItemId: itemId, error: error instanceof Error ? error.message : 'Fakturan kunde inte godkännas/skickas.' })
    }
  }
  return { approved, sent, failed, errors }
}
