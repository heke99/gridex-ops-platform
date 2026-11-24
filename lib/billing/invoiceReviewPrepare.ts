import { requireInvoiceSourceCopiesAvailable } from '@/lib/ediel/retention/financeCopyRetention'
import type { DispatchProvider } from '@/lib/billing/providers/registry'
import { invoiceDeliveryMode, resolveInvoiceDeliveryFor, type InvoiceDeliveryContract, type InvoiceDeliveryCustomer } from '@/lib/billing/effectiveInvoiceDelivery'
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
      .neq('status', 'cancelled')
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
      .select('id,company_id,customer_id,contract_number,contract_name,contract_type,status,price_area_used,contract_price_snapshot_id,price_plan_id,price_plan_version_id,contract_product_version_id,snapshot_hash,customer_site_id,site_id,metering_point_id,billing_address_same_as_site,invoice_recipient,invoice_email,invoice_reference,billing_street,billing_postal_code,billing_city,billing_country,billing_level,consolidated_invoice,vat_rate,updated_at')
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

async function loadInvoiceCustomer(companyId: string, customerId: string) {
  const result = await supabaseService
    .from('customers')
    .select('customer_number,full_name,company_name,invoice_email,billing_street,billing_postal_code,billing_city,billing_country')
    .eq('company_id', companyId)
    .eq('id', customerId)
    .maybeSingle()
  if (result.error) throw result.error
  return (result.data ?? null) as (InvoiceDeliveryCustomer & { customer_number?: string | null }) | null
}

/** All supplied aliases must name the same exact entity; never choose a first site. */
function requireMatchingIdentity(row: Row, keys: string[], expected: string) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && text(row[key]) !== expected) {
      throw new Error('Faktureringsunderlagets kund-/avtals-/anläggningsidentitet är motstridig.')
    }
  }
}

async function loadSharedDraftDelivery(input: {
  companyId: string
  customerId: string
  contractId: string
  underlay: Row
  contract: Row
}) {
  const { companyId, customerId, contractId, underlay, contract } = input
  if (text(contract.company_id) !== companyId || text(contract.customer_id) !== customerId ||
      text(underlay.company_id) !== companyId) {
    throw new Error('Kundavtalet tillhör inte faktureringsunderlagets bolag och kund.')
  }
  requireMatchingIdentity(underlay, ['customer_contract_id', 'contract_id'], contractId)
  const customer = await loadInvoiceCustomer(companyId, customerId)
  const confirmedEmail = text(contract.invoice_email) ?? text(customer?.invoice_email)
  const hasSiteIdentity = [underlay.customer_site_id, underlay.site_id, underlay.metering_point_id,
    contract.customer_site_id, contract.site_id, contract.metering_point_id].some((value) => value !== undefined && value !== null)
  let siteAddress: { street: string | null; postalCode: string | null; city: string | null; country: string | null } | null = null
  const completeContractAddress = Boolean(text(contract.billing_street) && text(contract.billing_postal_code) && text(contract.billing_city))
  if (!completeContractAddress && contract.billing_address_same_as_site === true && (hasSiteIdentity || !confirmedEmail)) {
    const siteId = text(underlay.customer_site_id) ?? text(underlay.site_id)
    const meteringPointId = text(underlay.metering_point_id)
    if (!siteId || !meteringPointId) throw new Error('Exakt anläggnings- och mätpunktsidentitet saknas.')
    requireMatchingIdentity(underlay, ['customer_site_id', 'site_id'], siteId)
    requireMatchingIdentity(contract, ['customer_site_id', 'site_id'], siteId)
    requireMatchingIdentity(contract, ['metering_point_id'], meteringPointId)
    const [siteResult, meterResult] = await Promise.all([
      supabaseService.from('customer_sites')
        .select('id,company_id,customer_id,street,postal_code,city,country')
        .eq('company_id', companyId).eq('customer_id', customerId).eq('id', siteId).maybeSingle(),
      supabaseService.from('metering_points')
        .select('id,company_id,customer_id,customer_site_id,site_id')
        .eq('company_id', companyId).eq('customer_id', customerId).eq('id', meteringPointId).maybeSingle(),
    ])
    if (siteResult.error) throw siteResult.error
    if (meterResult.error) throw meterResult.error
    const site = siteResult.data as Row | null
    const meter = meterResult.data as Row | null
    if (!site || !meter || text(site.id) !== siteId || text(meter.id) !== meteringPointId ||
        text(site.company_id) !== companyId || text(meter.company_id) !== companyId ||
        text(site.customer_id) !== customerId || text(meter.customer_id) !== customerId ||
        !(text(meter.customer_site_id) ?? text(meter.site_id))) {
      throw new Error('Exakt anläggning eller mätpunkt saknas inom samma bolag och kund.')
    }
    requireMatchingIdentity(meter, ['customer_site_id', 'site_id'], siteId)
    siteAddress = { street: text(site.street), postalCode: text(site.postal_code), city: text(site.city), country: text(site.country) }
  }
  const delivery = resolveInvoiceDeliveryFor('document', {
    contract: contract as InvoiceDeliveryContract,
    customer,
    siteAddress,
  }, 'shared')
  if (!delivery.recipient) throw new Error('Fakturamottagare saknas på avtalet och kunden.')
  if (!delivery.email && !delivery.postalAddress) {
    throw new Error('Fakturan saknar bekräftad faktura-e-post eller komplett fakturaadress.')
  }
  return { customer, delivery }
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
  provider: DispatchProvider
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
  const mode = invoiceDeliveryMode()
  // Validate identities and shared delivery before pricing locks or the atomic draft write.
  const shared = mode === 'shared' ? await loadSharedDraftDelivery({
    companyId: input.companyId, customerId, contractId, underlay: input.underlay, contract: input.contract,
  }) : null
  await requireInvoiceSourceCopiesAvailable({ companyId: input.companyId, underlayId })
  const pricing = await ensureLockedPricing({
    companyId: input.companyId,
    billingUnderlayId: underlayId,
    actorUserId: input.actorUserId,
  })
  if (!pricing.pricingRunId) throw new Error('Låst pricing_run saknas.')
  const snapshotId = text(input.underlay.contract_price_snapshot_id) ?? text(input.underlay.pricing_snapshot_id) ?? text(input.contract.contract_price_snapshot_id)
  const priceSnapshot = await loadPriceSnapshot(input.companyId, snapshotId)
  if (!priceSnapshot) throw new Error('Exakt kontraktsprissnapshot saknas.')
  const calculationSnapshot = buildCalculationSnapshot({ underlay: input.underlay, contract: input.contract, priceSnapshot, pricing, billingMonth: input.billingMonth })
  const calculationHash = hash(calculationSnapshot)
  const invoiceCustomer = shared ? shared.customer : await loadInvoiceCustomer(input.companyId, customerId)
  const customerNumber = text(invoiceCustomer?.customer_number)
  // Same effective recipient/delivery as billing readiness and export.
  const delivery = shared?.delivery ?? resolveInvoiceDeliveryFor('document', { contract: input.contract as InvoiceDeliveryContract, customer: invoiceCustomer }, mode)
  const runId = randomUUID()
  const itemId = randomUUID()
  const now = new Date().toISOString()
  const canonicalKey = `invoice-review:${input.provider}:${input.companyId}:${underlayId}:${pricing.pricingRunId}`
  const runKey = `invoice-review-run:${canonicalKey}`
  const approval = { status: 'pending_review', prepared_at: now, prepared_by: input.actorUserId, calculation_snapshot_sha256: calculationHash }
  const invoiceAddress = {
    recipient: delivery.recipient,
    email: delivery.email,
    reference: delivery.reference,
    street: delivery.postalAddress?.street ?? null,
    postal_code: delivery.postalAddress?.postalCode ?? null,
    city: delivery.postalAddress?.city ?? null,
    country: delivery.postalAddress?.country ?? text(input.contract.billing_country) ?? 'SE',
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
    target_system: input.provider,
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
    provider: input.provider,
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
  // Export graph and calculation snapshot are written in one transaction; a failure leaves no reservation.
  const draftRpc = input.provider === 'capway_aptic'
    ? 'gridex_create_capway_invoice_review_draft_v1'
    : 'gridex_create_invoice_review_draft_v1'
  const created = await supabaseService.rpc(draftRpc, {
    p_company_id: input.companyId,
    p_run: {
      id: runId,
      company_id: input.companyId,
      provider: input.provider,
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
    p_enrichment: {
      invoice_export_item_id: itemId,
      price_plan_version_id: text(input.underlay.price_plan_version_id) ?? text(input.contract.price_plan_version_id),
      price_area_code: calculationSnapshot.price_area,
      consumption_kwh: num(input.underlay.total_kwh),
      vat_rate: calculationSnapshot.vat_rate,
      calculation_snapshot: calculationSnapshot,
      calculation_snapshot_sha256: calculationHash,
      metadata: canonicalInvoice.metadata,
    },
  })
  if (created.error?.code === '23514' && created.error.message === 'billing_underlay_contract_case_hold') {
    throw new Error('Ett aktivt kundärende blockerar fakturering för det valda avtalet.')
  }
  if (created.error) throw created.error
  if (created.data?.existing === true) return 'existing' as const

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
  return 'created' as const
}

const groupedDraftMessages: Record<string, string> = {
  invoice_group_issuer_series_missing: 'En godkänd nummerserie för samlingsfakturor saknas för bolaget och fakturamiljön.',
  invoice_group_issuer_terms_missing: 'Bekräftade betalvillkor saknas för samlingsfakturan.',
  invoice_group_terms_conflict: "Samlingsfakturan kan inte skapas eftersom betalvillkoren skiljer sig.",
  invoice_group_selection_changed: 'De valda faktureringsunderlagen eller faktureringscykeln har ändrats. Läs om urvalet.',
  invoice_group_source_not_ready: 'Alla valda anläggningar behöver färdiga faktureringsunderlag.',
  invoice_group_customer_choice_changed: 'Kundens val eller fakturauppgifter har ändrats. Kontrollera de berörda avtalen.',
  invoice_group_site_mismatch: 'Kund, anläggning och mätpunkt stämmer inte för alla underlag.',
  invoice_group_price_not_locked: 'Låst prissättning saknas för en vald anläggning.',
  invoice_group_delivery_missing: 'Bekräftad fakturamottagare eller leveransväg saknas på en vald anläggning.',
  invoice_group_recipient_conflict: 'Samlingsfakturan kan inte skapas eftersom fakturamottagarna skiljer sig.',
  invoice_group_locked_currency_mismatch: 'Underlagets valuta kan inte bekräftas av den låsta prissättningen.',
  invoice_group_currency_conflict: 'Samlingsfakturan kan inte skapas eftersom valutorna skiljer sig.',
  invoice_group_channel_conflict: 'Samlingsfakturan kan inte skapas eftersom leveranskanalerna eller fakturaadresserna skiljer sig.',
  invoice_group_source_already_reserved: 'Ett valt underlag har redan beretts på en annan faktura.',
  invoice_group_distinct_sites_required: 'Samlingsfakturan behöver underlag för minst två anläggningar.',
  invoice_group_changed_replay: 'En samlingsfaktura finns redan för ett annat urval under faktureringscykeln.',
  invoice_group_source_busy: 'Ett valt underlag bereds redan. Läs om urvalet och försök igen.',
}

async function createGroupedDraft(input: {
  companyId: string
  customerId: string
  billingMonth: string
  provider: DispatchProvider
  environment: 'test' | 'production'
  actorUserId: string | null
  underlays: Row[]
  contracts: Map<string, Row>
}) {
  if (!input.actorUserId) throw new Error('Välj en behörig fakturaberedare för samlingsfakturan.')
  if (input.underlays.length < 2) throw new Error(groupedDraftMessages.invoice_group_distinct_sites_required)
  const profile = await supabaseService.from('customers')
    .select('billing_profile_revision').eq('company_id', input.companyId).eq('id', input.customerId).single()
  if (profile.error || !profile.data) throw new Error('Kundens aktuella fakturauppgifter kunde inte bekräftas.')

  const sources = []
  for (const underlay of input.underlays) {
    const underlayId = text(underlay.id)
    const contractId = text(underlay.customer_contract_id) ?? text(underlay.contract_id)
    const contract = contractId ? input.contracts.get(contractId) : null
    const siteId = text(underlay.customer_site_id) ?? text(underlay.site_id)
    if (!underlayId || !contractId || !contract || !siteId ||
      underlay.status !== 'validated' || underlay.readiness_status !== 'ready') {
      throw new Error(groupedDraftMessages.invoice_group_source_not_ready)
    }
    const site = await supabaseService.from('customer_sites').select('updated_at')
      .eq('company_id', input.companyId).eq('customer_id', input.customerId).eq('id', siteId).single()
    if (site.error || !site.data) throw new Error(groupedDraftMessages.invoice_group_site_mismatch)
    const { delivery } = await loadSharedDraftDelivery({
      companyId: input.companyId, customerId: input.customerId, contractId, underlay, contract,
    })
    const pricing = await loadLockedUnderlayPricingWithCore({ companyId: input.companyId, billingUnderlayId: underlayId })
    if (!pricing?.locked || !pricing.pricingRunId) throw new Error(groupedDraftMessages.invoice_group_price_not_locked)
    const priceSnapshot = await loadPriceSnapshot(input.companyId,
      text(underlay.contract_price_snapshot_id) ?? text(underlay.pricing_snapshot_id) ?? text(contract.contract_price_snapshot_id))
    if (!priceSnapshot) throw new Error('En vald anläggning saknar bekräftade pris- och leveransvillkor.')
    const channel = text(priceSnapshot.invoice_delivery_method)
    sources.push({
      underlayId,
      pricingRunId: pricing.pricingRunId,
      contractUpdatedAt: text(contract.updated_at),
      customerBillingProfileRevision: profile.data.billing_profile_revision,
      siteUpdatedAt: site.data.updated_at,
      delivery: { recipient: delivery.recipient, reference: delivery.reference,
        ...(channel === 'email' ? { email: delivery.email } : { postalAddress: delivery.postalAddress }) },
      calculation: buildCalculationSnapshot({ underlay, contract, priceSnapshot, pricing, billingMonth: input.billingMonth }),
    })
  }

  // A generated ABI follows the native migration. Supabase already supports
  // additive RPC names in this source's handwritten runtime boundary.
  const saved = await supabaseService.rpc('gridex_prepare_consolidated_invoice_v1', {
    p_company_id: input.companyId,
    p_customer_id: input.customerId,
    p_billing_month: input.billingMonth,
    p_provider: input.provider,
    p_environment: input.environment,
    p_actor_user_id: input.actorUserId,
    p_sources: sources,
  })
  if (saved.error) throw new Error(groupedDraftMessages[saved.error.message] ?? 'Samlingsfakturan kunde inte beredas. Kontrollera valda underlag.')
  const receipt = saved.data as { invoice_id?: string; existing?: boolean } | null
  if (!receipt?.invoice_id || typeof receipt.existing !== 'boolean') {
    throw new Error('Samlingsfakturans kvitto kunde inte bekräftas. Läs om beredningen.')
  }
  return receipt.existing
}

export async function prepareInvoiceDraftsForReview(input: {
  companyId: string
  billingMonth: string
  environment?: 'test' | 'production'
  /** The tenant's selected invoice provider; the run is prepared for exactly this provider. */
  provider?: DispatchProvider
  actorUserId?: string | null
  customerId?: string | null
  billingUnderlayId?: string | null
}) {
  await requireCompanyOperationalForWrites(input.companyId)
  monthParts(input.billingMonth)

  const customerScope = input.customerId === undefined || input.customerId === null ? null : text(input.customerId)
  const underlayScope = input.billingUnderlayId === undefined || input.billingUnderlayId === null
    ? null
    : text(input.billingUnderlayId)
  if (input.customerId !== undefined && input.customerId !== null && !customerScope) {
    throw new Error('Fakturaförberedelse fick ett tomt customerId-scope.')
  }
  if (input.billingUnderlayId !== undefined && input.billingUnderlayId !== null && !underlayScope) {
    throw new Error('Fakturaförberedelse fick ett tomt billingUnderlayId-scope.')
  }

  const allUnderlays = await loadUnderlays(input.companyId, input.billingMonth)
  const underlays = allUnderlays.filter((row) =>
    (!customerScope || text(row.customer_id) === customerScope) &&
    (!underlayScope || text(row.id) === underlayScope),
  )
  if (underlayScope && underlays.length !== 1) {
    throw new Error('Exakt faktureringsunderlag kunde inte hittas inom valt bolag, kund och månad.')
  }

  const underlayIds = underlays.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const reservedUnderlays = await loadExistingUnderlayIds(input.companyId, underlayIds)
  const invoiceReviewHolds = new Set(underlays.filter(
    row => row.billing_block_reason === 'price_timeline_invoice_review_required',
  ).map(row => String(row.id)))
  const contractIds = Array.from(new Set(underlays.map((row) => text(row.customer_contract_id) ?? text(row.contract_id))
    .filter((value): value is string => Boolean(value))))
  const contracts = await loadContracts(input.companyId, contractIds)
  const groupedByCustomer = new Map<string, Row[]>()
  const groupUnderlayIds = new Set<string>()
  for (const underlay of underlays) {
    const contractId = text(underlay.customer_contract_id) ?? text(underlay.contract_id)
    const customerId = text(underlay.customer_id)
    const underlayId = text(underlay.id)
    if (!contractId || !customerId || !underlayId || contracts.get(contractId)?.consolidated_invoice !== true ||
      (text(underlay.energy_direction) ?? 'consumption') !== 'consumption' ||
      (text(underlay.settlement_type) ?? 'invoice') !== 'invoice') continue
    const grouped = groupedByCustomer.get(customerId) ?? []
    grouped.push(underlay)
    groupedByCustomer.set(customerId, grouped)
    groupUnderlayIds.add(underlayId)
  }

  for (const group of groupedByCustomer.values()) {
    // Explicit grouping must keep every selected member together.
    if (group.some(underlay => invoiceReviewHolds.has(String(underlay.id)))) {
      for (const underlay of group) invoiceReviewHolds.add(String(underlay.id))
    }
  }
  const ready = underlays.filter(row => row.status === 'validated' && row.readiness_status === 'ready' &&
    !invoiceReviewHolds.has(String(row.id)) && !reservedUnderlays.has(String(row.id)))

  let created = 0
  let alreadyPrepared = reservedUnderlays.size
  let failed = 0
  const errors: Array<{ billingUnderlayId: string; error: string }> = []
  for (const [customerId, group] of groupedByCustomer) {
    // A held member is part of the selected scope. Do not prepare only the other sites.
    if (group.some(underlay => invoiceReviewHolds.has(String(underlay.id)))) continue
    try {
      const existing = await createGroupedDraft({
        companyId: input.companyId, customerId, billingMonth: input.billingMonth,
        provider: input.provider ?? 'capway_aptic', environment: input.environment ?? 'test',
        actorUserId: input.actorUserId ?? null, underlays: group, contracts,
      })
      if (existing) alreadyPrepared += group.filter(underlay => !reservedUnderlays.has(String(underlay.id))).length
      else created += 1
    } catch (error) {
      failed += 1
      errors.push({ billingUnderlayId: String(group[0].id), error: error instanceof Error ? error.message : 'Samlingsfakturan kunde inte beredas.' })
    }
  }
  const jobs = ready.filter(underlay => !groupUnderlayIds.has(String(underlay.id))).map((underlay) => async () => {
    const underlayId = text(underlay.id) ?? 'unknown'
    try {
      const contractId = text(underlay.customer_contract_id) ?? text(underlay.contract_id)
      const contract = contractId ? contracts.get(contractId) : null
      if (!contract) throw new Error('Exakt kundavtal saknas eller ligger utanför tenant.')
      const outcome = await createDraft({
        companyId: input.companyId,
        billingMonth: input.billingMonth,
        environment: input.environment ?? 'test',
        provider: input.provider ?? 'capway_aptic',
        actorUserId: input.actorUserId ?? null,
        underlay,
        contract,
      })
      if (outcome === 'existing') alreadyPrepared += 1
      else created += 1
    } catch (error) {
      failed += 1
      errors.push({ billingUnderlayId: underlayId, error: error instanceof Error ? error.message : 'Draftfakturan kunde inte skapas.' })
    }
  })
  for (let offset = 0; offset < jobs.length; offset += 10) {
    await Promise.all(jobs.slice(offset, offset + 10).map((run) => run()))
  }
  const blocked = underlays.filter(row => row.status !== 'validated' || row.readiness_status !== 'ready' ||
    invoiceReviewHolds.has(String(row.id))).length
  return {
    billingMonth: input.billingMonth,
    scope: {
      customerId: customerScope,
      billingUnderlayId: underlayScope,
    },
    underlays: underlays.length,
    alreadyPrepared,
    candidates: ready.length,
    created,
    blocked,
    failed,
    errors,
  }
}
