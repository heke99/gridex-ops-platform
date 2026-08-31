import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { sendApprovedInvoiceExportRun } from '@/lib/billing/invoiceApprovedDispatch'
import { assertInvoiceTestCustomer } from '@/lib/ediel/testing/invoiceTestCenterWorkspace'

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

export async function approveAndSendInvoiceTestItem(input: {
  companyId: string
  itemId: string
  actorUserId: string
}) {
  const itemResult = await supabaseService
    .from('invoice_export_items')
    .select('id,company_id,export_run_id,customer_id,billing_underlay_id,pricing_run_id,environment,provider,status,total_kwh,amount_inc_vat,metadata')
    .eq('company_id', input.companyId)
    .eq('id', input.itemId)
    .maybeSingle()
  if (itemResult.error) throw itemResult.error
  if (!itemResult.data) throw new Error('Fakturatest hittade inte valt fakturautkast.')
  const item = itemResult.data as Row
  const customerId = text(item.customer_id)
  const runId = text(item.export_run_id)
  const underlayId = text(item.billing_underlay_id)
  const pricingRunId = text(item.pricing_run_id)
  if (!customerId || !runId || !underlayId || !pricingRunId) {
    throw new Error('Fakturatest blockerad: fakturan saknar canonical kund-/run-/underlags-/pricing-identitet.')
  }
  if (text(item.environment) !== 'test' || text(item.provider) !== 'capway_aptic') {
    throw new Error('Fakturatest blockerad: endast Capway/Aptic-fakturor i environment=test får skickas härifrån.')
  }
  if (text(item.status) !== 'pending') {
    throw new Error('Fakturatest skickar endast ett oskickat pending-utkast. Skickade fakturor kan inte skickas igen från denna knapp.')
  }
  await assertInvoiceTestCustomer({ companyId: input.companyId, customerId })

  const [runResult, invoiceResult, underlayResult, pricingResult, runItemsResult] = await Promise.all([
    supabaseService
      .from('invoice_export_runs')
      .select('id,company_id,environment,provider,status,billing_month')
      .eq('company_id', input.companyId)
      .eq('id', runId)
      .maybeSingle(),
    supabaseService
      .from('customer_invoices')
      .select('id,status,metadata,calculation_snapshot_sha256,amount_inc_vat,price_area_code,total_kwh,consumption_kwh')
      .eq('company_id', input.companyId)
      .eq('invoice_export_item_id', input.itemId)
      .maybeSingle(),
    supabaseService
      .from('billing_underlays')
      .select('id,customer_id,total_kwh,price_area,status,readiness_status,missing_values_count,customer_contract_id,contract_id')
      .eq('company_id', input.companyId)
      .eq('id', underlayId)
      .maybeSingle(),
    supabaseService
      .from('pricing_runs')
      .select('id,billing_underlay_id,status,locked_at,total_inc_vat')
      .eq('company_id', input.companyId)
      .eq('id', pricingRunId)
      .maybeSingle(),
    supabaseService
      .from('invoice_export_items')
      .select('id,customer_id,environment,provider')
      .eq('company_id', input.companyId)
      .eq('export_run_id', runId),
  ])
  for (const result of [runResult, invoiceResult, underlayResult, pricingResult, runItemsResult]) {
    if (result.error) throw result.error
  }
  const run = runResult.data as Row | null
  const invoice = invoiceResult.data as Row | null
  const underlay = underlayResult.data as Row | null
  const pricing = pricingResult.data as Row | null
  if (!run || !invoice || !underlay || !pricing) throw new Error('Fakturatest kunde inte verifiera hela fakturagrafen.')
  if (text(run.environment) !== 'test' || text(run.provider) !== 'capway_aptic') {
    throw new Error('Fakturatest blockerad: export-run är inte Capway/Aptic TEST.')
  }
  const runItems = (runItemsResult.data ?? []) as Row[]
  if (runItems.length !== 1 || text(runItems[0]?.id) !== input.itemId) {
    throw new Error('Fakturatest blockerad: test-run måste innehålla exakt den valda testfakturan.')
  }
  if (runItems.some((row) => text(row.environment) !== 'test' || text(row.provider) !== 'capway_aptic' || text(row.customer_id) !== customerId)) {
    throw new Error('Fakturatest blockerad: export-run innehåller data utanför vald testkund eller testmiljö.')
  }
  if (text(invoice.status) !== 'draft') throw new Error('Fakturatest kräver en draftfaktura före leverantörsskick.')
  if (text(underlay.status) !== 'validated' || text(underlay.readiness_status) !== 'ready' || (num(underlay.missing_values_count) ?? 0) > 0) {
    throw new Error('Fakturatest blockerad: billing-underlaget är inte längre komplett och ready.')
  }
  if (text(pricing.status) !== 'locked' || !text(pricing.locked_at) || text(pricing.billing_underlay_id) !== underlayId) {
    throw new Error('Fakturatest blockerad: pricing-run är inte låst mot samma billing-underlag.')
  }
  if (text(underlay.customer_id) !== customerId) throw new Error('Fakturatest blockerad: billing-underlaget tillhör en annan kund.')
  const calculationHash = text(invoice.calculation_snapshot_sha256)
  if (!calculationHash) throw new Error('Fakturatest blockerad: juridisk beräkningssnapshot saknas.')
  const itemKwh = num(item.total_kwh)
  const underlayKwh = num(underlay.total_kwh)
  const invoiceKwh = num(invoice.total_kwh) ?? num(invoice.consumption_kwh)
  if (itemKwh === null || underlayKwh === null || Math.abs(itemKwh - underlayKwh) > 0.001 || (invoiceKwh !== null && Math.abs(invoiceKwh - underlayKwh) > 0.001)) {
    throw new Error('Fakturatest blockerad: kWh skiljer sig mellan underlag, exportpost och fakturaspegel.')
  }
  const itemTotal = num(item.amount_inc_vat)
  const pricingTotal = num(pricing.total_inc_vat)
  const invoiceTotal = num(invoice.amount_inc_vat)
  if (itemTotal === null || pricingTotal === null || invoiceTotal === null || Math.abs(itemTotal - pricingTotal) > 0.01 || Math.abs(invoiceTotal - pricingTotal) > 0.01) {
    throw new Error('Fakturatest blockerad: fakturabeloppet skiljer sig från låst pricing-run.')
  }
  const priceArea = text(invoice.price_area_code) ?? text(underlay.price_area)
  if (!priceArea || !['SE1', 'SE2', 'SE3', 'SE4'].includes(priceArea)) throw new Error('Fakturatest blockerad: giltigt elområde saknas.')

  const approvedAt = new Date().toISOString()
  const reviewHash = sha256({
    invoice_export_item_id: input.itemId,
    billing_underlay_id: underlayId,
    pricing_run_id: pricingRunId,
    calculation_snapshot_sha256: calculationHash,
    total_kwh: underlayKwh,
    total_inc_vat: invoiceTotal,
    price_area: priceArea,
    test_center: INVOICE_TEST_APPROVAL_VERSION,
  })
  const approval = {
    status: 'approved',
    approved_at: approvedAt,
    approved_by: input.actorUserId,
    review_hash: reviewHash,
    calculation_snapshot_sha256: calculationHash,
    approval_source: 'invoice_test_center',
  }
  const itemUpdate = await supabaseService
    .from('invoice_export_items')
    .update({ metadata: { ...objectValue(item.metadata), approval }, updated_at: approvedAt })
    .eq('company_id', input.companyId)
    .eq('id', input.itemId)
    .eq('environment', 'test')
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()
  if (itemUpdate.error) throw itemUpdate.error
  if (!itemUpdate.data) throw new Error('Fakturatest kunde inte godkänna exportposten atomärt.')
  const invoiceUpdate = await supabaseService
    .from('customer_invoices')
    .update({ metadata: { ...objectValue(invoice.metadata), approval }, updated_at: approvedAt })
    .eq('company_id', input.companyId)
    .eq('invoice_export_item_id', input.itemId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()
  if (invoiceUpdate.error) throw invoiceUpdate.error
  if (!invoiceUpdate.data) throw new Error('Fakturatest kunde inte godkänna fakturaspegeln.')

  const sent = await sendApprovedInvoiceExportRun({
    companyId: input.companyId,
    exportRunId: runId,
    actorUserId: input.actorUserId,
  })
  const result = sent.results.find((row) => row.itemId === input.itemId)
  if (!result) throw new Error('Capway/Aptic TEST returnerade inget resultat för vald faktura.')
  return { ...result, exportRunId: runId, billingMonth: text(run.billing_month) }
}

const INVOICE_TEST_APPROVAL_VERSION = 'invoice_test_center_approval_v1'
