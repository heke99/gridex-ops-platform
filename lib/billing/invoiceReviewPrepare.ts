import { createHash, randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import {
  calculateUnderlayPricingWithCore,
  loadLockedUnderlayPricingWithCore,
  type UnderlayCorePricingResult,
} from '@/lib/pricing/underlayPricingAdapter'
import { lockPricingPreview } from '@/lib/pricing/engine'
import { emitDomainEvent } from '@/lib/events/domainEvents'

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

function hash(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function monthParts(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim())
  if (!match) throw new Error('Ogiltig fakturamånad. Förväntat format YYYY-MM.')
  return { billingMonth: value.trim(), year: Number(match[1]), month: Number(match[2]) }
}

async function loadUnderlays(companyId: string, billingMonth: string) {
  const { year, month } = monthParts(billingMonth)
  const rows: Row[] = []
  for (let from = 0; ; from += 1_000) {
    const result = await supabaseService
      .from('billing_underlays')
      .select('id,company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_id,customer_contract_id,underlay_year,underlay_month,status,readiness_status,total_kwh,currency,billing_period_start,billing_period_end,missing_values_count,source_meter_value_count,price_area,pricing_snapshot_id,contract_price_snapshot_id,price_plan_id,price_plan_version_id,billing_block_reason,billing_configuration_snapshot_sha256,portfolio_id,portfolio_monthly_settlement_id,portfolio_settlement_revision,portfolio_settlement_sha256,vat_rate,energy_direction,settlement_type')
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

async function loadExistingUnderlayIds(companyId: string, underlayIds: string[]) {
  const ids = new Set<string>()
  for (let offset = 0; offset < underlayIds.length; offset += 200) {
    const chunk = underlayIds.slice(offset, offset + 200)
    if (chunk.length === 0) continue
    const result = await supabaseService
      .from('invoice_export_items')
      .select('billing_underlay_id')
      .eq('company_id', companyId)
      .in('billing_underlay_id', chunk)
    if (result.error) throw result.error
    for (const row of (result.data ?? []) as Row[]) {
      const id = text(row.billing_underlay_id)
      if (id) ids.add(id)
    }
  }
  return ids
}

async function loadContracts(companyId: string, contractIds: string[]) {
  const map = new Map<string, Row>()
  for (let offset = 0; offset < contractIds.length; offset += 200) {
    const chunk = contractIds.slice(offset, offset + 200)
    if (chunk.length === 0) continue
    const result = await supabaseService
      .from('customer_contracts')
      .select('id,company_id,customer_id,contract_number,contract_name,contract_type,status,price_area_used,contract_price_snapshot_id,price_plan_id,price_plan_version_id,contract_product_version_id,snapshot_hash,invoice_recipient,invoice_email,invoice_reference,billing_street,billing_postal_code,billing_city,billing_country,billing_level,consolidated_invoice,vat_rate')
      .eq('company_id', companyId)
      .in('id', chunk)
    if (result.error) throw result.error
    for (const row of (result.data ?? []) as Row[]) {
      const id = text(row.id)
      if (id) map.set(id, row)
    }
  }
  return map
}

async function loadCustomerNumber(companyId: string, customerId: string) {
  const result = await supabaseService
    .from('customers')
    .select('customer_number')
    .eq('company_id', companyId)
    .eq('id', customerId)
    .maybeSingle()
  if (result.error) throw result.error
  return text(result.data?.customer_number)
}

async function loadPriceSnapshot(companyId: string, snapshotId: string | null) {
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
    throw new Error('Fakturan saknar entydigt elområde SE1–SE4.')
  }
  const contractId = text(input.contract.id)
  const snapshotContractId = text(input.priceSnapshot?.contract_id)
  if (snapshotContractId && contractId && snapshotContractId !== contractId) {
    throw new Error('Prissnapshoten tillhör inte samma kundavtal.')
  }
  return {
    schema: 'gridex_invoice_calculation_v1',
    billing_month: input.billingMonth,
    billing_underlay_id: text(input.underlay.id),
    customer_contract_id: contractId,
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
    portfolio_settlement_revision: num(input.underlay.portfolio_settlement_revision),
    portfolio_settlement_sha256: text(input.underlay.portfolio_settlement_sha256),
    period_start: text(input.underlay.billing_period_start),
    period_end: text(input.underlay.billing_period_end),
    total_kwh: num(input.underlay.total_kwh),
    pricing_run_id: input.pricing.pricingRunId,
    pricing_engine: input.pricing.engine,
    pricing_lines: input.pricing.lines,
    interval_evidence: input.pricing.intervalEvidence,
    subtotal_sek_ex_vat: input.pricing.subtotalSekExVat,
    vat_sek: input.pricing.vatSek,
    total_sek_inc_vat: input.pricing.totalSekIncVat,
    vat_rate: num(input.underlay.vat_rate) ?? num(input.contract.vat_rate) ?? 0.25,
  }
}

async function createDraft(input: {
  companyId: string
  billingMonth: string
  environment: 'test' | 'production'
  actorUserId: string | null
  underlay: Row
  contract: Row
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
  if (!priceSnapshot && !snapshotId) throw new Error('Exakt kontraktsprissnapshot saknas.')
  const calculationSnapshot = buildCalculationSnapshot({ underlay: input.underlay, contract: input.contract, priceSnapshot, pricing, billingMonth: input.billingMonth })
  const calculationHash = hash(calculationSnapshot)
  const customerNumber = await loadCustomerNumber(input.companyId, customerId)
  const runId = randomUUID()
  const itemId = randomUUID()
  const now = new Date().toISOString()
  const canonicalKey = `invoice-review:capway_aptic:${input.companyId}:${underlayId}:${pricing.pricingRunId}`
  const runKey = `invoice-review-run:${canonicalKey}`
  const approval = { status: 'pending_review', prepared_at: now, prepared_by: input.actorUserId, calculation_snapshot_sha256: calculationHash }
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
    idempotency_key: `legacy:${canonicalKey}`,
    payload_snapshot: {
      underlay: input.underlay,
      contract: input.contract,
      pricing: { ...pricing, pricingRunId: pricing.pricingRunId },
      calculation: calculationSnapshot,
      calculation_snapshot_sha256: calculationHash,
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
    idempotency_key: runKey,
    metadata: { source: 'invoice_review_v1', approval_required: true, calculation_snapshot_sha256: calculationHash },
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
    total_kwh: num(input.underlay.total_kwh) ?? 0,
    currency: text(input.underlay.currency) ?? 'SEK',
    provider: 'capway_aptic',
    environment: input.environment,
    financing_mode: 'invoice_service',
    amount_ex_vat: pricing.subtotalSekExVat,
    vat_amount: pricing.vatSek,
    amount_inc_vat: pricing.totalSekIncVat,
    idempotency_key: canonicalKey,
    metadata: { billing_month: input.billingMonth, customer_number: customerNumber, approval, calculation_snapshot_sha256: calculationHash, contract_type: text(input.contract.contract_type), price_area: calculationSnapshot.price_area },
  }
  const canonicalInvoice = {
    invoice_export_item_id: itemId,
    customer_id: customerId,
    customer_contract_id: contractId,
    period_start: text(input.underlay.billing_period_start),
    period_end: text(input.underlay.billing_period_end),
    total_kwh: num(input.underlay.total_kwh) ?? 0,
    currency: text(input.underlay.currency) ?? 'SEK',
    amount_ex_vat: pricing.subtotalSekExVat,
    vat_amount: pricing.vatSek,
    amount_inc_vat: pricing.totalSekIncVat,
    metadata: { source: 'invoice_review_v1', approval, calculation_snapshot_sha256: calculationHash, customer_number: customerNumber },
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
      metadata: { source: 'invoice_review_v1', approval_required: true, calculation_snapshot_sha256: calculationHash },
      requested_by: input.actorUserId,
      idempotency_key: runKey,
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
      consumption_kwh: num(input.underlay.total_kwh),
      vat_rate: calculationSnapshot.vat_rate,
      calculation_snapshot: calculationSnapshot,
      calculation_snapshot_sha256: calculationHash,
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
    idempotencyKey: `invoice-review-created:${canonicalKey}`,
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
  const underlays = await loadUnderlays(input.companyId, input.billingMonth)
  const underlayIds = underlays.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const reservedUnderlays = await loadExistingUnderlayIds(input.companyId, underlayIds)
  const ready = underlays.filter((row) => row.status === 'validated' && row.readiness_status === 'ready' && !reservedUnderlays.has(String(row.id)))
  const contractIds = Array.from(new Set(ready.map((row) => text(row.customer_contract_id) ?? text(row.contract_id)).filter((value): value is string => Boolean(value))))
  const contracts = await loadContracts(input.companyId, contractIds)
  let created = 0
  let failed = 0
  const errors: Array<{ billingUnderlayId: string; error: string }> = []
  const jobs = ready.map((underlay) => async () => {
    const underlayId = text(underlay.id) ?? 'unknown'
    try {
      const contractId = text(underlay.customer_contract_id) ?? text(underlay.contract_id)
      const contract = contractId ? contracts.get(contractId) : null
      if (!contract) throw new Error('Exakt kundavtal saknas eller ligger utanför tenant.')
      await createDraft({
        companyId: input.companyId,
        billingMonth: input.billingMonth,
        environment: input.environment ?? 'test',
        actorUserId: input.actorUserId ?? null,
        underlay,
        contract,
      })
      created += 1
    } catch (error) {
      failed += 1
      errors.push({ billingUnderlayId: underlayId, error: error instanceof Error ? error.message : 'Draftfakturan kunde inte skapas.' })
    }
  })
  for (let offset = 0; offset < jobs.length; offset += 10) {
    await Promise.all(jobs.slice(offset, offset + 10).map((run) => run()))
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
