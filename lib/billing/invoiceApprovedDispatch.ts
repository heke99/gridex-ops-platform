import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { assertOutboundAllowed } from '@/lib/platform/outboundFreeze'
import { withAutomationLock } from '@/lib/automation/locks'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { resolveCapwayConnectionConfig } from '@/lib/integrations/billing/capway/auth'
import { CapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { buildCapwayInvoicePayload } from '@/lib/integrations/billing/capway/payloadBuilder'
import { buildPurchasePayload } from '@/lib/integrations/billing/capway/purchase'
import { shouldRequestPurchaseAfterCreate } from '@/lib/integrations/billing/capway/statusMapper'
import { classifyInvoiceExportError, computeNextRetryAt, INVOICE_EXPORT_MAX_ATTEMPTS } from '@/lib/integrations/billing/exportErrorClassification'
import { lockBillingPeriodForInvoiceExport } from '@/lib/billing/invoiceReadiness'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import type { CapwayEnvironment, CapwayFinancingMode } from '@/lib/integrations/billing/capway/types'

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
    return `{${Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function sha256(value: unknown) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function approval(metadata: unknown): Row {
  return objectValue(objectValue(metadata).approval)
}

function addDays(iso: string, days: number) {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function configuredPaymentDays(config: Awaited<ReturnType<typeof resolveCapwayConnectionConfig>>, customer: Row) {
  const raw = objectValue(config.rawSettings)
  const configured = num(raw.payment_condition_days) ?? num(raw.paymentConditionDays)
  const consumer = text(customer.customer_type) !== 'business'
  if (consumer) return Math.max(20, configured ?? 20)
  return Math.max(1, configured ?? 20)
}

async function loadItemContext(companyId: string, itemId: string) {
  const itemResult = await supabaseService.from('invoice_export_items').select('*').eq('company_id', companyId).eq('id', itemId).single()
  if (itemResult.error) throw itemResult.error
  const item = itemResult.data as Row
  const pricingRunId = text(item.pricing_run_id)
  const customerId = text(item.customer_id)
  const underlayId = text(item.billing_underlay_id)
  const runId = text(item.export_run_id)
  if (!pricingRunId || !customerId || !underlayId || !runId) throw new Error('Fakturan saknar canonical pricing-/kund-/underlags-/run-identitet.')
  const [run, pricingRun, lines, customer, underlay, company, invoice] = await Promise.all([
    supabaseService.from('invoice_export_runs').select('*').eq('company_id', companyId).eq('id', runId).single(),
    supabaseService.from('pricing_runs').select('*').eq('company_id', companyId).eq('id', pricingRunId).single(),
    supabaseService.from('pricing_preview_lines').select('*').eq('company_id', companyId).eq('pricing_run_id', pricingRunId).order('sort_order', { ascending: true }),
    supabaseService.from('customers').select('*').eq('company_id', companyId).eq('id', customerId).single(),
    supabaseService.from('billing_underlays').select('*').eq('company_id', companyId).eq('id', underlayId).single(),
    supabaseService.from('companies').select('*').eq('id', companyId).maybeSingle(),
    supabaseService.from('customer_invoices').select('*').eq('company_id', companyId).eq('invoice_export_item_id', itemId).single(),
  ])
  for (const result of [run, pricingRun, lines, customer, underlay, company, invoice]) if (result.error) throw result.error
  return {
    item,
    run: run.data as Row,
    pricingRun: pricingRun.data as Row,
    lines: (lines.data ?? []) as Row[],
    customer: customer.data as Row,
    underlay: underlay.data as Row,
    company: (company.data as Row | null) ?? null,
    invoice: invoice.data as Row,
  }
}

async function assertItemStillReady(context: Awaited<ReturnType<typeof loadItemContext>>) {
  if (context.underlay.status !== 'validated' || context.underlay.readiness_status !== 'ready') throw new Error('Faktureringsunderlaget är inte längre klart.')
  if ((num(context.underlay.missing_values_count) ?? 0) > 0) throw new Error('Mätvärden saknas fortfarande för kunden.')
  if (context.pricingRun.status !== 'locked' || !context.pricingRun.locked_at) throw new Error('Prisberäkningen är inte låst.')
  if (text(context.pricingRun.billing_underlay_id) !== text(context.underlay.id)) throw new Error('Prisberäkningen tillhör inte samma faktureringsunderlag.')
  if (text(context.item.customer_id) !== text(context.underlay.customer_id)) throw new Error('Fakturans kund matchar inte faktureringsunderlaget.')
  if (text(context.item.customer_contract_id) !== (text(context.underlay.customer_contract_id) ?? text(context.underlay.contract_id))) throw new Error('Fakturans avtal matchar inte faktureringsunderlaget.')
  const priceArea = text(context.invoice.price_area_code) ?? text(context.underlay.price_area)
  if (!priceArea || !['SE1', 'SE2', 'SE3', 'SE4'].includes(priceArea)) throw new Error('Fakturan saknar giltigt elområde SE1–SE4.')
  if (!text(context.invoice.calculation_snapshot_sha256)) throw new Error('Juridisk beräkningssnapshot saknas.')
  const underlayKwh = num(context.underlay.total_kwh)
  const itemKwh = num(context.item.total_kwh)
  const invoiceKwh = num(context.invoice.total_kwh) ?? num(context.invoice.consumption_kwh)
  if (underlayKwh === null || itemKwh === null || Math.abs(underlayKwh - itemKwh) > 0.001) {
    throw new Error('Förbrukningen i underlaget avviker från den reserverade fakturan. Omförbered fakturan.')
  }
  if (invoiceKwh !== null && Math.abs(underlayKwh - invoiceKwh) > 0.001) {
    throw new Error('Förbrukningen i underlaget avviker från fakturaspegeln. Omförbered fakturan.')
  }
  const pairs = [
    [num(context.item.amount_ex_vat), num(context.pricingRun.total_ex_vat)],
    [num(context.item.vat_amount), num(context.pricingRun.vat_amount)],
    [num(context.item.amount_inc_vat), num(context.pricingRun.total_inc_vat)],
    [num(context.invoice.amount_inc_vat), num(context.pricingRun.total_inc_vat)],
  ]
  if (pairs.some(([a, b]) => a === null || b === null || Math.abs(a - b) > 0.01)) throw new Error('Fakturabeloppet matchar inte den låsta prisberäkningen.')
}

async function approveItem(companyId: string, itemId: string, actorUserId: string) {
  const context = await loadItemContext(companyId, itemId)
  if (context.item.status !== 'pending' || context.invoice.status !== 'draft') throw new Error('Endast oskickade draftfakturor kan godkännas.')
  await assertItemStillReady(context)
  const existingApproval = approval(context.item.metadata)
  if (existingApproval.status === 'approved' && approval(context.invoice.metadata).status === 'approved') return context
  const calculationHash = text(context.invoice.calculation_snapshot_sha256)
  const reviewHash = sha256({
    invoice_export_item_id: itemId,
    billing_underlay_id: text(context.underlay.id),
    pricing_run_id: text(context.pricingRun.id),
    calculation_snapshot_sha256: calculationHash,
    total_kwh: num(context.underlay.total_kwh),
    total_inc_vat: num(context.invoice.amount_inc_vat),
    price_area: text(context.invoice.price_area_code) ?? text(context.underlay.price_area),
  })
  const approvedAt = new Date().toISOString()
  const approved = {
    status: 'approved',
    approved_at: approvedAt,
    approved_by: actorUserId,
    review_hash: reviewHash,
    calculation_snapshot_sha256: calculationHash,
  }
  const itemUpdate = await supabaseService.from('invoice_export_items').update({
    metadata: { ...objectValue(context.item.metadata), approval: approved },
    updated_at: approvedAt,
  }).eq('company_id', companyId).eq('id', itemId).eq('status', 'pending').select('id').maybeSingle()
  if (itemUpdate.error) throw itemUpdate.error
  if (!itemUpdate.data) throw new Error('Fakturan kunde inte godkännas; status ändrades under granskningen.')
  const invoiceUpdate = await supabaseService.from('customer_invoices').update({
    metadata: { ...objectValue(context.invoice.metadata), approval: approved },
    updated_at: approvedAt,
  }).eq('company_id', companyId).eq('invoice_export_item_id', itemId).eq('status', 'draft').select('id').maybeSingle()
  if (invoiceUpdate.error) throw invoiceUpdate.error
  if (!invoiceUpdate.data) throw new Error('Fakturaspegeln kunde inte godkännas.')
  await emitDomainEvent({
    companyId,
    eventType: 'invoice.approved',
    aggregateType: 'invoice_export_item',
    aggregateId: itemId,
    subjectCustomerId: text(context.item.customer_id),
    actorUserId,
    source: 'invoice_approved_dispatch_v1',
    payload: { approved_at: approvedAt, review_hash: reviewHash },
    idempotencyKey: `invoice-approved:${itemId}:${reviewHash}`,
  }).catch(() => null)
  return loadItemContext(companyId, itemId)
}

async function updateLegacyProjection(input: { companyId: string; runId: string; itemId: string; status: 'sent' | 'failed'; error?: string | null }) {
  const now = new Date().toISOString()
  await supabaseService.from('billing_export_run_items').update({
    status: input.status === 'sent' ? 'sent' : 'ready_for_retry',
    export_status: input.status,
    sent_at: input.status === 'sent' ? now : null,
    failed_at: input.status === 'failed' ? now : null,
    last_error: input.error ?? null,
    updated_at: now,
  }).eq('company_id', input.companyId).eq('id', input.itemId).then(() => null)
  await supabaseService.from('billing_export_runs').update({
    status: input.status,
    rows_exported: input.status === 'sent' ? 1 : 0,
    rows_sent: input.status === 'sent' ? 1 : 0,
    rows_failed: input.status === 'failed' ? 1 : 0,
    updated_at: now,
  }).eq('company_id', input.companyId).eq('id', input.runId).then(() => null)
}

async function recordAttempt(input: {
  companyId: string
  itemId: string
  runId: string
  attemptNo: number
  idempotencyKey: string
  requestHash: string | null
  httpStatus: number | null
  outcome: string
  errorCode: string | null
  responseExcerpt?: string | null
  startedAt: string
}) {
  await supabaseService.from('invoice_export_attempts').insert({
    company_id: input.companyId,
    invoice_export_item_id: input.itemId,
    export_run_id: input.runId,
    attempt_no: input.attemptNo,
    idempotency_key: input.idempotencyKey,
    request_hash: input.requestHash,
    http_status: input.httpStatus,
    outcome: input.outcome,
    error_code: input.errorCode,
    response_excerpt: input.responseExcerpt ?? null,
    started_at: input.startedAt,
    finished_at: new Date().toISOString(),
  }).then(() => null)
}

async function maybeLockCompleteMonth(input: { companyId: string; billingMonth: string; actorUserId: string; exportRunId: string }) {
  const [year, month] = input.billingMonth.split('-').map(Number)
  const underlays: Row[] = []
  for (let from = 0; ; from += 1_000) {
    const result = await supabaseService.from('billing_underlays').select('id,status,readiness_status').eq('company_id', input.companyId).eq('underlay_year', year).eq('underlay_month', month).order('id').range(from, from + 999)
    if (result.error) throw result.error
    const page = (result.data ?? []) as Row[]
    underlays.push(...page)
    if (page.length < 1_000) break
  }
  if (underlays.length === 0 || underlays.some((row) => row.status !== 'validated' || row.readiness_status !== 'ready')) return false
  const ids = underlays.map((row) => text(row.id)).filter((value): value is string => Boolean(value))
  const sentUnderlays = new Set<string>()
  for (let offset = 0; offset < ids.length; offset += 200) {
    const result = await supabaseService.from('invoice_export_items').select('billing_underlay_id,status').eq('company_id', input.companyId).in('billing_underlay_id', ids.slice(offset, offset + 200)).in('status', ['sent', 'credited'])
    if (result.error) throw result.error
    for (const row of (result.data ?? []) as Row[]) {
      const id = text(row.billing_underlay_id)
      if (id) sentUnderlays.add(id)
    }
  }
  if (ids.some((id) => !sentUnderlays.has(id))) return false
  await lockBillingPeriodForInvoiceExport({
    companyId: input.companyId,
    billingMonth: input.billingMonth,
    actorUserId: input.actorUserId,
    exportRunId: input.exportRunId,
    reason: 'Alla faktureringsunderlag är klara och samtliga fakturor är skickade eller krediterade.',
  })
  return true
}

async function sendApprovedItem(input: { companyId: string; itemId: string; actorUserId: string }) {
  await requireCompanyOperationalForWrites(input.companyId)
  await assertOutboundAllowed({ companyId: input.companyId, channel: 'invoice_export' })
  return withAutomationLock({
    lockKey: `approved-invoice:${input.companyId}:${input.itemId}`,
    companyId: input.companyId,
    ttlSeconds: 7_200,
    metadata: { domain: 'invoice_approved_dispatch', itemId: input.itemId },
    run: async () => {
      const context = await loadItemContext(input.companyId, input.itemId)
      const itemApproval = approval(context.item.metadata)
      const invoiceApproval = approval(context.invoice.metadata)
      if (itemApproval.status !== 'approved' || invoiceApproval.status !== 'approved') throw new Error('Fakturaexport blockerad: explicit godkännande saknas.')
      if (!['pending', 'failed', 'failed_retryable'].includes(String(context.item.status))) throw new Error('Fakturan är inte i ett skick som får skickas.')
      await assertItemStillReady(context)
      const environment = (text(context.run.environment) as CapwayEnvironment) ?? 'test'
      const financingMode = (text(context.run.financing_mode) as CapwayFinancingMode) ?? 'invoice_service'
      const billingMonth = text(context.run.billing_month)
      const runId = text(context.run.id)
      if (!billingMonth || !runId) throw new Error('Exportkörningen saknar fakturamånad eller ID.')
      const config = await resolveCapwayConnectionConfig({ companyId: input.companyId, environment })
      const client = new CapwayApticClient(config)
      const paymentDays = configuredPaymentDays(config, context.customer)
      const invoiceDate = new Date().toISOString()
      const dueDate = addDays(invoiceDate, paymentDays)
      const payload = buildCapwayInvoicePayload({
        config,
        company: context.company,
        customer: context.customer,
        pricingRun: context.pricingRun,
        pricingLines: context.lines,
        underlay: context.underlay,
        financingMode,
        invoiceDate,
        dueDate,
        paymentConditionDays: paymentDays,
      })
      const payloadHash = sha256(payload)
      const providerKey = text(context.item.provider_idempotency_key) ?? text(context.item.idempotency_key) ?? `invoice:${input.companyId}:${input.itemId}`
      const attemptNo = (num(context.item.attempt_count) ?? 0) + 1
      const startedAt = new Date().toISOString()
      try {
        const response = await client.createInvoices([payload], providerKey)
        const guids = Array.isArray(response.invoiceGuids) ? response.invoiceGuids.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())) : []
        if (guids.length !== 1) throw new Error('Fakturapartnern returnerade inte exakt ett faktura-ID.')
        const invoiceGuid = guids[0]
        let purchaseResponse: Record<string, unknown> | null = null
        if (shouldRequestPurchaseAfterCreate(financingMode)) {
          purchaseResponse = await client.postPurchase(invoiceGuid, buildPurchasePayload({ financingMode }))
        }
        const now = new Date().toISOString()
        const itemUpdate = await supabaseService.from('invoice_export_items').update({
          status: 'sent',
          provider_invoice_guid: invoiceGuid,
          provider_invoice_id: invoiceGuid,
          provider_idempotency_key: providerKey,
          provider_confirmed_at: now,
          provider_request_id: providerKey,
          request_payload: payload,
          response_payload: { create_invoice: response, purchase: purchaseResponse },
          attempt_count: attemptNo,
          last_attempt_at: startedAt,
          next_retry_at: null,
          error_code: null,
          error_payload: {},
          sent_at: now,
          updated_at: now,
        }).eq('company_id', input.companyId).eq('id', input.itemId).select('id').maybeSingle()
        if (itemUpdate.error) throw itemUpdate.error
        if (!itemUpdate.data) throw new Error('Providerresultatet kunde inte sparas på canonical exportpost.')
        const invoiceUpdate = await supabaseService.from('customer_invoices').update({
          partner_invoice_reference: invoiceGuid,
          issued_at: invoiceDate,
          due_date: dueDate.slice(0, 10),
          status: 'sent',
          raw_payload: { create_invoice: response, purchase: purchaseResponse },
          updated_at: now,
        }).eq('company_id', input.companyId).eq('invoice_export_item_id', input.itemId).select('id').maybeSingle()
        if (invoiceUpdate.error) throw invoiceUpdate.error
        if (!invoiceUpdate.data) throw new Error('Providerresultatet saknar canonical fakturaspegel.')
        await supabaseService.from('invoice_export_runs').update({ status: 'sent', sent_items: 1, failed_items: 0, total_ex_vat: num(context.item.amount_ex_vat) ?? 0, vat_amount: num(context.item.vat_amount) ?? 0, total_inc_vat: num(context.item.amount_inc_vat) ?? 0, started_at: startedAt, finished_at: now, updated_at: now }).eq('company_id', input.companyId).eq('id', runId)
        await updateLegacyProjection({ companyId: input.companyId, runId, itemId: input.itemId, status: 'sent' })
        await recordAttempt({ companyId: input.companyId, itemId: input.itemId, runId, attemptNo, idempotencyKey: providerKey, requestHash: payloadHash, httpStatus: 200, outcome: 'sent', errorCode: null, startedAt })
        await emitDomainEvent({ companyId: input.companyId, eventType: 'invoice.sent', aggregateType: 'invoice_export_item', aggregateId: input.itemId, subjectCustomerId: text(context.customer.id), actorUserId: input.actorUserId, source: 'invoice_approved_dispatch_v1', payload: { invoice_guid: invoiceGuid, billing_month: billingMonth, amount_inc_vat: num(context.item.amount_inc_vat), due_date: dueDate.slice(0, 10) }, idempotencyKey: `invoice-sent:${input.itemId}:${invoiceGuid}` }).catch(() => null)
        await maybeLockCompleteMonth({ companyId: input.companyId, billingMonth, actorUserId: input.actorUserId, exportRunId: runId })
        return { itemId: input.itemId, runId, status: 'sent' as const, invoiceGuid }
      } catch (error) {
        const classification = classifyInvoiceExportError(error)
        let status = classification.outcome
        let errorCode = classification.errorCode
        let nextRetryAt: string | null = null
        if (status === 'failed_retryable') {
          if (attemptNo >= INVOICE_EXPORT_MAX_ATTEMPTS) {
            status = 'failed'
            errorCode = 'retry_exhausted'
          } else {
            nextRetryAt = computeNextRetryAt(attemptNo)
          }
        }
        const now = new Date().toISOString()
        const finalStatus = ['failed_retryable', 'failed', 'rejected', 'configuration_error', 'needs_review'].includes(status) ? status : 'failed'
        await supabaseService.from('invoice_export_items').update({
          status: finalStatus,
          request_payload: payload,
          error_code: errorCode,
          error_payload: { message: classification.message, error_code: errorCode, http_status: classification.httpStatus, attempt_no: attemptNo },
          attempt_count: attemptNo,
          last_attempt_at: startedAt,
          next_retry_at: nextRetryAt,
          updated_at: now,
        }).eq('company_id', input.companyId).eq('id', input.itemId)
        await supabaseService.from('customer_invoices').update({
          status: finalStatus === 'failed_retryable' ? 'draft' : 'failed',
          raw_payload: { provider_error: classification.message, error_code: errorCode, http_status: classification.httpStatus, retry_at: nextRetryAt },
          updated_at: now,
        }).eq('company_id', input.companyId).eq('invoice_export_item_id', input.itemId)
        await supabaseService.from('invoice_export_runs').update({ status: 'failed', failed_items: 1, finished_at: now, updated_at: now }).eq('company_id', input.companyId).eq('id', runId)
        await updateLegacyProjection({ companyId: input.companyId, runId, itemId: input.itemId, status: 'failed', error: classification.message })
        await recordAttempt({ companyId: input.companyId, itemId: input.itemId, runId, attemptNo, idempotencyKey: providerKey, requestHash: payloadHash, httpStatus: classification.httpStatus, outcome: finalStatus, errorCode, responseExcerpt: classification.responseExcerpt, startedAt })
        if (finalStatus !== 'failed_retryable') {
          await supabaseService.from('invoice_dead_letters').insert({ company_id: input.companyId, provider: 'capway_aptic', export_run_id: runId, export_item_id: input.itemId, error_message: classification.message, payload: { error_code: errorCode, http_status: classification.httpStatus } }).then(() => null)
        }
        return { itemId: input.itemId, runId, status: finalStatus, error: classification.message, errorCode }
      }
    },
  })
}

export async function sendApprovedInvoiceExportRun(input: { companyId: string; exportRunId: string; actorUserId: string }) {
  const result = await supabaseService.from('invoice_export_items').select('id,metadata,status').eq('company_id', input.companyId).eq('export_run_id', input.exportRunId).in('status', ['pending', 'failed', 'failed_retryable'])
  if (result.error) throw result.error
  const items = (result.data ?? []) as Row[]
  if (items.length === 0) throw new Error('Exportkörningen saknar skickbara fakturor.')
  if (items.some((item) => approval(item.metadata).status !== 'approved')) throw new Error('Fakturaexport blockerad: explicit godkännande saknas.')
  const results = []
  for (const item of items) {
    const itemId = text(item.id)
    if (itemId) results.push(await sendApprovedItem({ companyId: input.companyId, itemId, actorUserId: input.actorUserId }))
  }
  return { exportRunId: input.exportRunId, results, sent: results.filter((row) => row.status === 'sent').length, failed: results.filter((row) => row.status !== 'sent').length }
}

export async function approveAndSendReadyInvoicesForMonth(input: { companyId: string; billingMonth: string; actorUserId: string }) {
  await requireCompanyOperationalForWrites(input.companyId)
  const runs = await supabaseService.from('invoice_export_runs').select('id').eq('company_id', input.companyId).eq('billing_month', input.billingMonth).order('created_at', { ascending: true })
  if (runs.error) throw runs.error
  const runIds = (runs.data ?? []).map((row) => String(row.id))
  const items: Row[] = []
  for (let offset = 0; offset < runIds.length; offset += 200) {
    const chunk = runIds.slice(offset, offset + 200)
    if (chunk.length === 0) continue
    const result = await supabaseService.from('invoice_export_items').select('id,status,metadata').eq('company_id', input.companyId).in('export_run_id', chunk).eq('status', 'pending').order('created_at', { ascending: true })
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
      if (approval(item.metadata).status !== 'approved') {
        await approveItem(input.companyId, itemId, input.actorUserId)
        approved += 1
      }
      const result = await sendApprovedItem({ companyId: input.companyId, itemId, actorUserId: input.actorUserId })
      if (result.status === 'sent') sent += 1
      else {
        failed += 1
        errors.push({ invoiceExportItemId: itemId, error: 'Fakturaexporten returnerade ett icke-skickat resultat.' })
      }
    } catch (error) {
      failed += 1
      errors.push({ invoiceExportItemId: itemId, error: error instanceof Error ? error.message : 'Fakturan kunde inte godkännas/skickas.' })
    }
  }
  return { approved, sent, failed, errors }
}

export async function processDueApprovedInvoiceRetries(input: { companyId?: string | null; limit?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  let query = supabaseService.from('invoice_export_items').select('id,company_id,metadata').eq('status', 'failed_retryable').lte('next_retry_at', new Date().toISOString()).order('next_retry_at', { ascending: true }).limit(limit)
  if (input.companyId) query = query.eq('company_id', input.companyId)
  const result = await query
  if (result.error) throw result.error
  let sent = 0
  let failed = 0
  for (const item of (result.data ?? []) as Row[]) {
    const companyId = text(item.company_id)
    const itemId = text(item.id)
    if (!companyId || !itemId || approval(item.metadata).status !== 'approved') continue
    const actor = text(approval(item.metadata).approved_by)
    if (!actor) continue
    const outcome = await sendApprovedItem({ companyId, itemId, actorUserId: actor })
    if (outcome.status === 'sent') sent += 1
    else failed += 1
  }
  return { processed: sent + failed, sent, failed }
}
