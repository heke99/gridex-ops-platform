import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { getEdielMessageById } from '@/lib/ediel/db'
import { processInboundUtiltsMessageByCanonicalPolicy } from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'
import { supabaseService } from '@/lib/supabase/service'
import {
  assertTestCenterRuntimeMessage,
  normalizeTestCenterBillingMonth,
} from '@/lib/ediel/testing/testCenterRuntimePolicy'

export type TestCenterRuntimeInput = {
  actorUserId: string
  companyId: string
  customerId: string
  edielMessageId: string
  billingMonth: string
}

export type TestCenterRuntimeResult = {
  edielMessageId: string
  customerId: string
  meteringPointId: string
  meteringValueIds: string[]
  billingUnderlayId: string
  invoicePreparation: Awaited<ReturnType<typeof prepareInvoiceDraftsForReview>>
  invoiceExportItemId: string
  customerInvoiceId: string
  pricingRunId: string
  totalKwh: number
  invoiceAmountIncVat: number
  externalSideEffectsAllowed: false
  environment: 'test'
}

type Row = Record<string, unknown>

function required(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Test Center saknar ${name}.`)
  return normalized
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

function sameNumber(a: number | null, b: number | null, tolerance: number) {
  return a !== null && b !== null && Math.abs(a - b) <= tolerance
}

async function verifyMeterValues(input: {
  companyId: string
  customerId: string
  meteringPointId: string
  edielMessageId: string
  meteringValueIds: string[]
}) {
  if (input.meteringValueIds.length === 0) {
    throw new Error('Fakturatest blockerad: UTILTS skapade eller återanvände inga normaliserbara mätvärden.')
  }

  const result = await supabaseService
    .from('metering_values')
    .select('id,company_id,customer_id,metering_point_id,source_ediel_message_id,period_start,period_end,quantity,quantity_kwh,unit,billing_status,billing_gate_status')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('metering_point_id', input.meteringPointId)
    .in('id', input.meteringValueIds)
  if (result.error) throw result.error
  const rows = (result.data ?? []) as Row[]
  if (rows.length !== input.meteringValueIds.length) {
    throw new Error('Fakturatest blockerad: inte alla ingesterade/återanvända mätvärden kunde verifieras mot exakt tenant, kund och mätpunkt.')
  }

  const directSourceIds = new Set(
    rows
      .filter((row) => text(row.source_ediel_message_id) === input.edielMessageId)
      .map((row) => String(row.id)),
  )
  const missingProvenanceIds = input.meteringValueIds.filter((id) => !directSourceIds.has(id))

  if (missingProvenanceIds.length > 0) {
    const provenanceResult = await supabaseService
      .from('metering_value_sources')
      .select('metering_value_id')
      .eq('company_id', input.companyId)
      .eq('source_ediel_message_id', input.edielMessageId)
      .in('metering_value_id', missingProvenanceIds)
    if (provenanceResult.error) throw provenanceResult.error
    const linkedIds = new Set(
      ((provenanceResult.data ?? []) as Row[]).map((row) => String(row.metering_value_id)),
    )
    const unlinked = missingProvenanceIds.filter((id) => !linkedIds.has(id))
    if (unlinked.length > 0) {
      throw new Error('Fakturatest blockerad: återanvänt canonical mätvärde saknar provenance-länk till aktuell Ediel-källa.')
    }
  }

  const notBillable = rows.filter((row) => text(row.billing_status) !== 'billable' || text(row.billing_gate_status) !== 'eligible')
  if (notBillable.length > 0) {
    throw new Error('Fakturatest blockerad: ett eller flera mätvärden är inte billable/eligible efter canonical billing gate.')
  }
}

async function verifyReadyUnderlay(input: {
  companyId: string
  customerId: string
  meteringPointId: string
  billingMonth: string
  underlayId: string
}) {
  const [yearRaw, monthRaw] = input.billingMonth.split('-')
  const result = await supabaseService
    .from('billing_underlays')
    .select('id,company_id,customer_id,metering_point_id,status,readiness_status,total_kwh,underlay_year,underlay_month,missing_values_count,source_meter_value_count,price_area,contract_id,customer_contract_id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('metering_point_id', input.meteringPointId)
    .eq('id', input.underlayId)
    .maybeSingle()
  if (result.error) throw result.error
  const row = result.data as Row | null
  if (!row) throw new Error('Fakturatest blockerad: exakt billing-underlag kunde inte återläsas.')
  if (text(row.status) !== 'validated' || text(row.readiness_status) !== 'ready') {
    throw new Error('Fakturatest blockerad: billing-underlaget är inte validated/ready.')
  }
  if ((num(row.missing_values_count) ?? 0) !== 0) {
    throw new Error('Fakturatest blockerad: billing-underlaget innehåller mätvärdesluckor.')
  }
  if ((num(row.source_meter_value_count) ?? 0) <= 0) {
    throw new Error('Fakturatest blockerad: billing-underlaget saknar källmätvärden.')
  }
  if (num(row.underlay_year) !== Number(yearRaw) || num(row.underlay_month) !== Number(monthRaw)) {
    throw new Error('Fakturatest blockerad: billing-underlaget ligger i fel fakturamånad.')
  }
  const totalKwh = num(row.total_kwh)
  if (totalKwh === null || totalKwh <= 0) {
    throw new Error('Fakturatest blockerad: billing-underlagets totala kWh är ogiltigt.')
  }
  if (!['SE1', 'SE2', 'SE3', 'SE4'].includes(text(row.price_area) ?? '')) {
    throw new Error('Fakturatest blockerad: billing-underlaget saknar giltigt elområde.')
  }
  if (!text(row.customer_contract_id) && !text(row.contract_id)) {
    throw new Error('Fakturatest blockerad: billing-underlaget saknar canonical kundavtal.')
  }
  return { row, totalKwh }
}

async function verifyInvoiceGraph(input: {
  companyId: string
  customerId: string
  billingUnderlayId: string
  totalKwh: number
}) {
  const itemResult = await supabaseService
    .from('invoice_export_items')
    .select('id,company_id,customer_id,billing_underlay_id,pricing_run_id,environment,provider,status,total_kwh,amount_inc_vat')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('billing_underlay_id', input.billingUnderlayId)
    .eq('environment', 'test')
    .eq('provider', 'capway_aptic')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(2)
  if (itemResult.error) throw itemResult.error
  const items = (itemResult.data ?? []) as Row[]
  if (items.length !== 1) {
    throw new Error(items.length === 0
      ? 'Fakturatest blockerad: inget fakturautkast skapades för exakt billing-underlag.'
      : 'Fakturatest blockerad: flera aktiva fakturautkast finns för samma billing-underlag.')
  }
  const item = items[0]
  const itemId = String(item.id)
  const pricingRunId = text(item.pricing_run_id)
  if (!pricingRunId) throw new Error('Fakturatest blockerad: fakturautkastet saknar pricing-run.')

  const [invoiceResult, pricingResult] = await Promise.all([
    supabaseService
      .from('customer_invoices')
      .select('id,status,total_kwh,consumption_kwh,amount_inc_vat,price_area_code,calculation_snapshot_sha256')
      .eq('company_id', input.companyId)
      .eq('customer_id', input.customerId)
      .eq('invoice_export_item_id', itemId)
      .maybeSingle(),
    supabaseService
      .from('pricing_runs')
      .select('id,billing_underlay_id,status,locked_at,total_inc_vat')
      .eq('company_id', input.companyId)
      .eq('id', pricingRunId)
      .eq('billing_underlay_id', input.billingUnderlayId)
      .maybeSingle(),
  ])
  if (invoiceResult.error) throw invoiceResult.error
  if (pricingResult.error) throw pricingResult.error
  const invoice = invoiceResult.data as Row | null
  const pricing = pricingResult.data as Row | null
  if (!invoice || !pricing) throw new Error('Fakturatest blockerad: hela faktura-/pricing-grafen kunde inte verifieras.')
  if (!['draft', 'sent'].includes(text(invoice.status) ?? '')) {
    throw new Error('Fakturatest blockerad: kundfakturan har oväntad status.')
  }
  if (text(pricing.status) !== 'locked' || !text(pricing.locked_at)) {
    throw new Error('Fakturatest blockerad: pricing-run är inte låst.')
  }
  if (!text(invoice.calculation_snapshot_sha256)) {
    throw new Error('Fakturatest blockerad: fakturans juridiska beräkningssnapshot saknas.')
  }
  const invoiceKwh = num(invoice.total_kwh) ?? num(invoice.consumption_kwh)
  const itemKwh = num(item.total_kwh)
  if (!sameNumber(itemKwh, input.totalKwh, 0.001) || !sameNumber(invoiceKwh, input.totalKwh, 0.001)) {
    throw new Error('Fakturatest blockerad: kWh skiljer sig mellan mätunderlag, exportpost och kundfaktura.')
  }
  const itemTotal = num(item.amount_inc_vat)
  const invoiceTotal = num(invoice.amount_inc_vat)
  const pricingTotal = num(pricing.total_inc_vat)
  if (!sameNumber(itemTotal, pricingTotal, 0.01) || !sameNumber(invoiceTotal, pricingTotal, 0.01)) {
    throw new Error('Fakturatest blockerad: fakturabeloppet skiljer sig från låst pricing-run.')
  }
  if (!['SE1', 'SE2', 'SE3', 'SE4'].includes(text(invoice.price_area_code) ?? '')) {
    throw new Error('Fakturatest blockerad: kundfakturan saknar giltigt elområde.')
  }
  return {
    invoiceExportItemId: itemId,
    customerInvoiceId: String(invoice.id),
    pricingRunId,
    invoiceAmountIncVat: invoiceTotal as number,
  }
}

/**
 * Runs the real canonical UTILTS -> normalized metering -> production billing
 * underlay -> locked pricing -> invoice preparation chain. Every stage is
 * scoped to the selected test customer/metering point and verified fail-closed.
 * External provider dispatch is deliberately excluded from this step.
 */
export async function runTestCenterMeteringToInvoiceChain(
  input: TestCenterRuntimeInput,
): Promise<TestCenterRuntimeResult> {
  const actorUserId = required(input.actorUserId, 'actorUserId')
  const companyId = required(input.companyId, 'companyId')
  const customerId = required(input.customerId, 'customerId')
  const edielMessageId = required(input.edielMessageId, 'edielMessageId')
  const billingMonth = normalizeTestCenterBillingMonth(input.billingMonth)

  const before = await getEdielMessageById(edielMessageId)
  if (!before) throw new Error('Test Center hittade inte valt Ediel-meddelande.')
  assertTestCenterRuntimeMessage({ message: before, companyId, customerId })

  const processed = await processInboundUtiltsMessageByCanonicalPolicy({
    actorUserId,
    edielMessageId,
  })

  const after = await getEdielMessageById(edielMessageId)
  if (!after) throw new Error('Test Center kunde inte återläsa behandlat Ediel-meddelande.')
  assertTestCenterRuntimeMessage({ message: after, companyId, customerId })

  const meteringPointId = required(String(after.metering_point_id ?? ''), 'meteringPointId på behandlat Ediel-meddelande')
  const meteringValueIds = Array.from(new Set(processed.ingestedMeterValueIds ?? []))
  await verifyMeterValues({
    companyId,
    customerId,
    meteringPointId,
    edielMessageId,
    meteringValueIds,
  })

  const underlayGeneration = await generateBillingUnderlaysForMonth({
    companyId,
    billingMonth,
    createdBy: actorUserId,
    customerId,
    meteringPointId,
  })
  const readyResults = underlayGeneration.results.filter((row) => row.status === 'ready_for_pricing' && row.underlayId)
  if (readyResults.length !== 1) {
    const warnings = underlayGeneration.results.flatMap((row) => row.warnings).filter(Boolean)
    throw new Error(`Fakturatest blockerad: exakt ett ready billing-underlag krävs, fick ${readyResults.length}. ${warnings.join(' | ')}`.trim())
  }
  const billingUnderlayId = String(readyResults[0].underlayId)
  const underlay = await verifyReadyUnderlay({
    companyId,
    customerId,
    meteringPointId,
    billingMonth,
    underlayId: billingUnderlayId,
  })

  const invoicePreparation = await prepareInvoiceDraftsForReview({
    companyId,
    billingMonth,
    environment: 'test',
    actorUserId,
    customerId,
    billingUnderlayId,
  })
  if (invoicePreparation.failed > 0) {
    throw new Error(`Fakturatest blockerad: fakturaförberedelsen misslyckades. ${invoicePreparation.errors.map((row) => row.error).join(' | ')}`)
  }
  if (invoicePreparation.created === 0 && invoicePreparation.alreadyPrepared === 0) {
    throw new Error('Fakturatest blockerad: fakturaförberedelsen skapade eller återanvände inget fakturautkast.')
  }

  const invoice = await verifyInvoiceGraph({
    companyId,
    customerId,
    billingUnderlayId,
    totalKwh: underlay.totalKwh,
  })

  return {
    edielMessageId,
    customerId,
    meteringPointId,
    meteringValueIds,
    billingUnderlayId,
    invoicePreparation,
    invoiceExportItemId: invoice.invoiceExportItemId,
    customerInvoiceId: invoice.customerInvoiceId,
    pricingRunId: invoice.pricingRunId,
    totalKwh: underlay.totalKwh,
    invoiceAmountIncVat: invoice.invoiceAmountIncVat,
    externalSideEffectsAllowed: false,
    environment: 'test',
  }
}
