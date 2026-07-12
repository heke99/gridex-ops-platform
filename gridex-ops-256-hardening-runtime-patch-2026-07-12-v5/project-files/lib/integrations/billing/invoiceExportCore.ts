import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { evaluateBillingMonthInvoiceReadiness, lockBillingPeriodForInvoiceExport } from '@/lib/billing/invoiceReadiness'
import { resolveCapwayConnectionConfig } from '@/lib/integrations/billing/capway/auth'
import { CapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { buildCapwayInvoicePayload } from '@/lib/integrations/billing/capway/payloadBuilder'
import { buildPurchasePayload } from '@/lib/integrations/billing/capway/purchase'
import { shouldRequestPurchaseAfterCreate } from '@/lib/integrations/billing/capway/statusMapper'
import type { CapwayEnvironment, CapwayFinancingMode } from '@/lib/integrations/billing/capway/types'
import { emitDomainEvent } from '@/lib/events/domainEvents'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { assertOutboundAllowed } from '@/lib/platform/outboundFreeze'
import { withAutomationLock } from '@/lib/automation/locks'
import {
  classifyInvoiceExportError,
  computeNextRetryAt,
  INVOICE_EXPORT_MAX_ATTEMPTS,
} from '@/lib/integrations/billing/exportErrorClassification'

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function missingRelation(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(maybe && (maybe.code === '42P01' || maybe.code === 'PGRST205' || /does not exist|schema cache/i.test(maybe.message ?? '')))
}

export async function createInvoiceExportRun(input: {
  companyId: string
  billingMonth: string
  provider?: 'capway_aptic'
  environment?: CapwayEnvironment
  financingMode?: CapwayFinancingMode
  actorUserId?: string | null
}) {
  await assertPlatformSchemaReady()
  const provider = input.provider ?? 'capway_aptic'
  const environment = input.environment ?? 'test'
  const readiness = await evaluateBillingMonthInvoiceReadiness({ companyId: input.companyId, billingMonth: input.billingMonth })
  if (readiness.status !== 'ready') {
    throw new Error(`Fakturaperioden är inte exportklar: ${readiness.issues.map((issue) => issue.message).join(' ')}`)
  }

  const { data: run, error } = await supabaseService
    .from('invoice_export_runs')
    .insert({
      company_id: input.companyId,
      provider,
      environment,
      billing_month: input.billingMonth,
      financing_mode: input.financingMode ?? 'invoice_service',
      status: 'draft',
      total_items: readiness.readyUnderlayCount,
      requested_by: input.actorUserId ?? null,
      readiness_snapshot: readiness,
      metadata: { source: 'gridex_invoice_export_core' },
    })
    .select('id')
    .single()
  if (error) throw error
  const runId = (run as { id: string }).id

  const readyUnderlayIds = readiness.readyUnderlayIds
  if (readyUnderlayIds.length !== readiness.readyUnderlayCount) {
    throw new Error('Readiness-urvalet saknar entydiga underlags-ID:n.')
  }
  const pricingRuns: Record<string, unknown>[] = []
  for (let offset = 0; offset < readyUnderlayIds.length; offset += 200) {
    const ids = readyUnderlayIds.slice(offset, offset + 200)
    if (ids.length === 0) continue
    const pricingResult = await supabaseService
      .from('pricing_runs')
      .select('id,billing_underlay_id,customer_id,total_ex_vat,vat_amount,total_inc_vat,status,billing_period_start,billing_period_end')
      .eq('company_id', input.companyId)
      .in('billing_underlay_id', ids)
      .in('status', ['success', 'locked'])
      .order('billing_underlay_id', { ascending: true })
      .order('created_at', { ascending: false })
    if (pricingResult.error) throw pricingResult.error
    pricingRuns.push(...((pricingResult.data ?? []) as Record<string, unknown>[]))
  }
  const byUnderlay = new Map<string, Record<string, unknown>[]>()
  for (const run of pricingRuns) {
    const underlayId = stringValue(run.billing_underlay_id)
    if (!underlayId) throw new Error('Prisberäkning saknar fakturaunderlag.')
    byUnderlay.set(underlayId, [...(byUnderlay.get(underlayId) ?? []), run])
  }
  for (const underlayId of readyUnderlayIds) {
    const runs = byUnderlay.get(underlayId) ?? []
    if (runs.length !== 1) throw new Error(`Fakturaunderlag ${underlayId} måste ha exakt en låst eller lyckad prisberäkning.`)
  }

  const customerIds = Array.from(new Set(pricingRuns.map((pricingRun) => stringValue(pricingRun.customer_id)).filter(Boolean))) as string[]
  const customerNumbers = new Map<string, string>()
  if (customerIds.length > 0) {
    const { data: customerRows, error: customerNumberError } = await supabaseService
      .from('customers')
      .select('id,customer_number')
      .eq('company_id', input.companyId)
      .in('id', customerIds)
    if (customerNumberError && !missingRelation(customerNumberError)) throw customerNumberError
    for (const row of (customerRows ?? []) as Record<string, unknown>[]) {
      const id = stringValue(row.id)
      const number = stringValue(row.customer_number)
      if (id && number) customerNumbers.set(id, number)
    }
  }

  const candidateRows = pricingRuns.map((pricingRun) => {
    const customerId = stringValue(pricingRun.customer_id)
    return {
      company_id: input.companyId,
      export_run_id: runId,
      customer_id: customerId,
      customer_number: customerId ? customerNumbers.get(customerId) ?? null : null,
      billing_underlay_id: stringValue(pricingRun.billing_underlay_id),
      pricing_run_id: stringValue(pricingRun.id),
      provider,
      environment,
      status: 'pending',
      financing_mode: input.financingMode ?? 'invoice_service',
      amount_ex_vat: numberValue(pricingRun.total_ex_vat),
      vat_amount: numberValue(pricingRun.vat_amount),
      amount_inc_vat: numberValue(pricingRun.total_inc_vat),
      idempotency_key: `${provider}:${input.companyId}:${input.billingMonth}:${stringValue(pricingRun.id)}`,
      metadata: { billing_month: input.billingMonth, customer_number: customerId ? customerNumbers.get(customerId) ?? null : null },
    }
  })

  // Never reset items that already left the sendable pipeline (sent/credited/
  // cancelled/rejected). Re-billing them requires an explicit credit path.
  const alreadyExportedKeys = new Set<string>()
  if (candidateRows.length > 0) {
    const { data: existingItems, error: existingError } = await supabaseService
      .from('invoice_export_items')
      .select('idempotency_key,status')
      .eq('company_id', input.companyId)
      .eq('provider', provider)
      .in('idempotency_key', candidateRows.map((row) => row.idempotency_key))
    if (existingError && !missingRelation(existingError)) throw existingError
    for (const row of (existingItems ?? []) as Record<string, unknown>[]) {
      const key = stringValue(row.idempotency_key)
      const status = String(row.status ?? '')
      if (key && !['pending', 'failed', 'failed_retryable'].includes(status)) alreadyExportedKeys.add(key)
    }
  }
  const itemRows = candidateRows.filter((row) => !alreadyExportedKeys.has(row.idempotency_key))

  if (itemRows.length > 0) {
    const { error: itemError } = await supabaseService
      .from('invoice_export_items')
      .upsert(itemRows, { onConflict: 'company_id,provider,idempotency_key' })
    if (itemError) throw itemError

    await Promise.all(itemRows.map((row) => row.customer_id ? emitDomainEvent({
      companyId: input.companyId,
      eventType: 'invoice.created',
      aggregateType: 'invoice_export_item',
      aggregateId: row.idempotency_key,
      subjectCustomerId: row.customer_id,
      actorUserId: input.actorUserId ?? null,
      source: 'billing_invoice_export',
      payload: {
        billing_month: input.billingMonth,
        customer_number: row.customer_number,
        billing_underlay_id: row.billing_underlay_id,
        pricing_run_id: row.pricing_run_id,
        amount_ex_vat: row.amount_ex_vat,
        amount_inc_vat: row.amount_inc_vat,
        status: 'created',
      },
      idempotencyKey: `invoice-created:${row.idempotency_key}`,
    }).catch(() => null) : Promise.resolve(null)))
  }

  await supabaseService
    .from('invoice_export_runs')
    .update({
      total_items: itemRows.length,
      metadata: { source: 'gridex_invoice_export_core', skipped_already_exported: alreadyExportedKeys.size },
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('id', runId)

  return { runId, itemCount: itemRows.length, skippedAlreadyExported: alreadyExportedKeys.size, readiness }
}

async function loadItemContext(companyId: string, item: Record<string, unknown>) {
  const pricingRunId = stringValue(item.pricing_run_id)
  const customerId = stringValue(item.customer_id)
  const underlayId = stringValue(item.billing_underlay_id)
  if (!pricingRunId || !customerId) throw new Error('Exportpost saknar prisberäkning eller kund.')

  const [pricingRun, lines, customer, underlay, company] = await Promise.all([
    supabaseService.from('pricing_runs').select('*').eq('company_id', companyId).eq('id', pricingRunId).single(),
    supabaseService.from('pricing_preview_lines').select('*').eq('company_id', companyId).eq('pricing_run_id', pricingRunId).order('sort_order', { ascending: true }),
    supabaseService.from('customers').select('*').eq('company_id', companyId).eq('id', customerId).single(),
    underlayId ? supabaseService.from('billing_underlays').select('*').eq('company_id', companyId).eq('id', underlayId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabaseService.from('companies').select('*').eq('id', companyId).maybeSingle(),
  ])

  for (const result of [pricingRun, lines, customer, underlay, company]) {
    if (result.error && !missingRelation(result.error)) throw result.error
  }

  return {
    pricingRun: pricingRun.data as Record<string, unknown>,
    lines: (lines.data ?? []) as Record<string, unknown>[],
    customer: customer.data as Record<string, unknown>,
    underlay: (underlay.data as Record<string, unknown> | null) ?? null,
    company: (company.data as Record<string, unknown> | null) ?? null,
  }
}

function requestHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? {})).digest('hex')
}

// Attempts audit is best-effort: tolerate the table missing until Migration C
// (20260702130000) has been applied.
async function recordExportAttempt(input: {
  companyId: string
  itemId: string
  exportRunId: string | null
  attemptNo: number
  idempotencyKey: string | null
  requestHash: string | null
  httpStatus: number | null
  outcome: string
  errorCode: string | null
  responseExcerpt: string | null
  startedAt: string
}) {
  const { error } = await supabaseService.from('invoice_export_attempts').insert({
    company_id: input.companyId,
    invoice_export_item_id: input.itemId,
    export_run_id: input.exportRunId,
    attempt_no: input.attemptNo,
    idempotency_key: input.idempotencyKey,
    request_hash: input.requestHash,
    http_status: input.httpStatus,
    outcome: input.outcome,
    error_code: input.errorCode,
    response_excerpt: input.responseExcerpt,
    started_at: input.startedAt,
    finished_at: new Date().toISOString(),
  })
  if (error && !missingRelation(error)) {
    console.error('[invoice-export] failed to record export attempt', { itemId: input.itemId, error })
  }
}

// Statuses that may still be sent (initially or via retry). Terminal statuses
// (sent, credited, cancelled, rejected, disputed) must never be re-sent.
const SENDABLE_ITEM_STATUSES = ['pending', 'failed', 'failed_retryable']

async function updateExportItemStrict(companyId: string, itemId: string, payload: Record<string, unknown>) {
  const response = await supabaseService
    .from('invoice_export_items')
    .update(payload)
    .eq('company_id', companyId)
    .eq('id', itemId)
    .select('id')
    .maybeSingle()
  if (response.error) throw response.error
  if (!response.data) throw new Error('Fakturaexportposten kunde inte uppdateras tenant-säkert.')
}

type SendItemResult = {
  itemId: string
  status: string
  invoiceGuid?: string | null
  errorCode?: string | null
  error?: string | null
}

// Attempted re-export of an already sent/credited invoice: refuse and raise a
// work-queue task so an operator routes it through the credit/correction path.
async function raiseInvoiceCorrectionTask(input: {
  companyId: string
  itemId: string
  exportRunId: string
  currentStatus: string
  actorUserId?: string | null
}) {
  const { count, error: existingError } = await supabaseService
    .from('customer_operation_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', input.companyId)
    .eq('task_type', 'invoice_resend_blocked')
    .eq('status', 'open')
    .contains('metadata', { invoice_export_item_id: input.itemId })
  if (!existingError && (count ?? 0) > 0) return

  const { error } = await supabaseService.from('customer_operation_tasks').insert({
    company_id: input.companyId,
    task_type: 'invoice_resend_blocked',
    status: 'open',
    priority: 'high',
    title: 'Omexport av skickad faktura blockerad',
    description: `Fakturaexportpost ${input.itemId} är redan ${input.currentStatus} och kan inte skickas om. Skapa kredit eller korrigering om fakturan behöver göras om.`,
    metadata: {
      invoice_export_item_id: input.itemId,
      export_run_id: input.exportRunId,
      current_status: input.currentStatus,
    },
    created_by: input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
  })
  if (error) console.warn('[invoice-export] kunde inte skapa korrigeringstask', { itemId: input.itemId, error })
}

async function sendSingleInvoiceExportItem(input: {
  companyId: string
  exportRunId: string
  billingMonth: string
  item: Record<string, unknown>
  config: Awaited<ReturnType<typeof resolveCapwayConnectionConfig>>
  client: CapwayApticClient
  financingMode: CapwayFinancingMode
  actorUserId?: string | null
}): Promise<SendItemResult> {
  const item = input.item
  const itemId = stringValue(item.id)
  if (!itemId) throw new Error('Exportposten saknar id.')

  // Defense in depth: never re-send an already sent/credited invoice, even if
  // a stale row slips past the status filter (races, manual calls).
  const currentItemStatus = String(item.status ?? '')
  if (!SENDABLE_ITEM_STATUSES.includes(currentItemStatus)) {
    await raiseInvoiceCorrectionTask({
      companyId: input.companyId,
      itemId,
      exportRunId: input.exportRunId,
      currentStatus: currentItemStatus,
      actorUserId: input.actorUserId,
    })
    return { itemId, status: currentItemStatus, errorCode: 'resend_blocked', error: 'Fakturan är redan skickad. Skapa kredit/korrigering för omexport.' }
  }

  const idempotencyKey = stringValue(item.idempotency_key)
  const attemptNo = Math.max(0, Math.trunc(numberValue(item.attempt_count))) + 1
  const startedAt = new Date().toISOString()
  let payloadHash: string | null = null

  try {
    const context = await loadItemContext(input.companyId, item)
    const payload = buildCapwayInvoicePayload({
      config: input.config,
      company: context.company,
      customer: context.customer,
      pricingRun: context.pricingRun,
      pricingLines: context.lines,
      underlay: context.underlay,
      financingMode: input.financingMode,
    })
    payloadHash = requestHash(payload)
    const providerRequestId = stringValue(item.provider_request_id) ?? idempotencyKey
    if (!providerRequestId) throw new Error('Fakturaexportposten saknar provider-idempotensnyckel.')
    let invoiceGuid = stringValue(item.provider_invoice_guid)
    let response: Record<string, unknown> = objectValue(item.response_payload)?.create_invoice as Record<string, unknown> ?? {}
    if (!invoiceGuid) {
      const createResponse = await input.client.createInvoices([payload], providerRequestId)
      const invoiceGuids = Array.isArray(createResponse.invoiceGuids) ? createResponse.invoiceGuids.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())) : []
      if (invoiceGuids.length !== 1) throw new Error('Capway/Aptic bekräftade inte exakt en skapad faktura.')
      invoiceGuid = invoiceGuids[0]
      response = createResponse as unknown as Record<string, unknown>
      await updateExportItemStrict(input.companyId, itemId, {
        provider_request_id: providerRequestId,
        provider_invoice_guid: invoiceGuid,
        provider_imp_stock_id: createResponse.impStockId ?? null,
        provider_confirmed_at: new Date().toISOString(),
        request_payload: payload,
        response_payload: { create_invoice: createResponse },
        attempt_count: attemptNo,
        last_attempt_at: startedAt,
        updated_at: new Date().toISOString(),
      })
    }

    let purchaseResponse: Record<string, unknown> | null = null
    if (shouldRequestPurchaseAfterCreate(input.financingMode)) {
      purchaseResponse = await input.client.postPurchase(invoiceGuid, buildPurchasePayload({ financingMode: input.financingMode, note: `Gridex export ${input.exportRunId}` }))
      const purchaseEvent = await supabaseService.from('invoice_purchase_events').insert({
        company_id: input.companyId,
        invoice_export_item_id: itemId,
        event_type: 'purchase_requested',
        purchase_status: 'requested',
        finance_status: input.financingMode,
        payload: purchaseResponse,
        created_by: input.actorUserId ?? null,
      })
      if (purchaseEvent.error) throw purchaseEvent.error
    }

    await updateExportItemStrict(input.companyId, itemId, {
      status: 'sent',
      provider_request_id: providerRequestId,
      customer_number: stringValue(context.customer.customer_number),
      provider_customer_id: stringValue(payload.customer.customerReference),
      provider_debtor_id: stringValue(payload.customer.customerReference),
      provider_invoice_guid: invoiceGuid,
      provider_imp_stock_id: response.impStockId ?? null,
      request_payload: payload,
      response_payload: { create_invoice: response, purchase: purchaseResponse },
      sent_at: new Date().toISOString(),
      attempt_count: attemptNo,
      last_attempt_at: startedAt,
      next_retry_at: null,
      error_code: null,
      error_payload: {},
      updated_at: new Date().toISOString(),
    })

    await recordExportAttempt({
      companyId: input.companyId,
      itemId,
      exportRunId: input.exportRunId,
      attemptNo,
      idempotencyKey,
      requestHash: payloadHash,
      httpStatus: 200,
      outcome: 'sent',
      errorCode: null,
      responseExcerpt: null,
      startedAt,
    })

    await emitDomainEvent({
      companyId: input.companyId,
      eventType: 'invoice.sent',
      aggregateType: 'invoice_export_item',
      aggregateId: itemId,
      subjectCustomerId: stringValue(context.customer.id),
      actorUserId: input.actorUserId ?? null,
      source: 'billing_invoice_export',
      payload: {
        customer_number: stringValue(context.customer.customer_number),
        invoice_guid: invoiceGuid,
        export_run_id: input.exportRunId,
        billing_month: input.billingMonth,
        amount_ex_vat: numberValue(item.amount_ex_vat),
        amount_inc_vat: numberValue(item.amount_inc_vat),
        status: 'sent',
      },
      idempotencyKey: `invoice-sent:${itemId}:${invoiceGuid}`,
    }).catch(() => null)

    return { itemId, status: 'sent', invoiceGuid }
  } catch (error) {
    const classification = classifyInvoiceExportError(error)
    let status: string = classification.outcome
    let errorCode = classification.errorCode
    let nextRetryAt: string | null = null

    // 409 conflict: if a previous attempt already produced a provider invoice
    // (same idempotency key), the invoice exists at the provider - treat as sent.
    if (classification.errorCode === 'provider_conflict' && stringValue(item.provider_invoice_guid)) {
      status = 'sent'
      errorCode = 'provider_conflict_resolved_as_sent'
    }

    if (status === 'failed_retryable') {
      if (attemptNo >= INVOICE_EXPORT_MAX_ATTEMPTS) {
        status = 'failed'
        errorCode = 'retry_exhausted'
      } else {
        nextRetryAt = computeNextRetryAt(attemptNo)
      }
    }

    await updateExportItemStrict(input.companyId, itemId, {
      status,
      error_code: errorCode,
      error_payload: {
        message: classification.message,
        error_code: errorCode,
        http_status: classification.httpStatus,
        attempt_no: attemptNo,
      },
      attempt_count: attemptNo,
      last_attempt_at: startedAt,
      next_retry_at: nextRetryAt,
      ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })

    await recordExportAttempt({
      companyId: input.companyId,
      itemId,
      exportRunId: input.exportRunId,
      attemptNo,
      idempotencyKey,
      requestHash: payloadHash,
      httpStatus: classification.httpStatus,
      // The attempt records the raw classification; the item's final status may
      // differ (retry exhausted -> failed, resolved 409 -> sent).
      outcome: classification.outcome === 'failed_retryable' && status === 'failed' ? 'failed' : classification.outcome,
      errorCode,
      responseExcerpt: classification.responseExcerpt,
      startedAt,
    })

    // Only dead-letter terminal failures; retryable items stay in the retry queue.
    if (status !== 'failed_retryable' && status !== 'sent') {
      await supabaseService.from('invoice_dead_letters').insert({
        company_id: input.companyId,
        provider: 'capway_aptic',
        export_run_id: input.exportRunId,
        export_item_id: itemId,
        error_message: classification.message,
        payload: { item, error_code: errorCode, http_status: classification.httpStatus },
      })
    }

    return { itemId, status, errorCode, error: classification.message }
  }
}

async function finalizeExportRunStatus(input: {
  companyId: string
  exportRunId: string
  billingMonth: string
  actorUserId?: string | null
}) {
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1_000) {
    const pageResult = await supabaseService
      .from('invoice_export_items')
      .select('id,status')
      .eq('company_id', input.companyId)
      .eq('export_run_id', input.exportRunId)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (pageResult.error) throw pageResult.error
    const page = (pageResult.data ?? []) as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < 1_000) break
  }
  const sent = rows.filter((row) => ['sent', 'credited'].includes(String(row.status))).length
  const retryable = rows.filter((row) => String(row.status) === 'failed_retryable').length
  const failedFinal = rows.filter((row) => ['failed', 'rejected', 'configuration_error', 'needs_review'].includes(String(row.status))).length
  const pending = rows.filter((row) => String(row.status) === 'pending').length
  const unresolved = retryable + failedFinal + pending

  const finalStatus = unresolved > 0 ? (sent > 0 ? 'partial_failed' : 'failed') : 'sent'
  const runUpdate = await supabaseService.from('invoice_export_runs').update({
    status: finalStatus,
    sent_items: sent,
    failed_items: retryable + failedFinal,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('company_id', input.companyId).eq('id', input.exportRunId).select('id').maybeSingle()
  if (runUpdate.error) throw runUpdate.error
  if (!runUpdate.data) throw new Error('Fakturaexportkörningen kunde inte slutföras tenant-säkert.')

  if (sent > 0 && unresolved === 0) {
    await lockBillingPeriodForInvoiceExport({ companyId: input.companyId, billingMonth: input.billingMonth, exportRunId: input.exportRunId, actorUserId: input.actorUserId })
  }

  return { finalStatus, sent, failed: retryable + failedFinal }
}

async function sendInvoiceExportRunUnlocked(input: {
  companyId: string
  exportRunId: string
  actorUserId?: string | null
}) {
  const { data: run, error: runError } = await supabaseService
    .from('invoice_export_runs')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('id', input.exportRunId)
    .single()
  if (runError) throw runError
  const runRow = run as Record<string, unknown>
  const environment = (stringValue(runRow.environment) as CapwayEnvironment) ?? 'test'
  const financingMode = (stringValue(runRow.financing_mode) as CapwayFinancingMode) ?? 'invoice_service'
  const billingMonth = stringValue(runRow.billing_month)
  if (!billingMonth) throw new Error('Exportkörningen saknar fakturamånad.')

  const config = await resolveCapwayConnectionConfig({ companyId: input.companyId, environment })
  const client = new CapwayApticClient(config)

  const items: Record<string, unknown>[] = []
  for (let from = 0; ; from += 500) {
    const pageResult = await supabaseService
      .from('invoice_export_items')
      .select('*')
      .eq('company_id', input.companyId)
      .eq('export_run_id', input.exportRunId)
      .in('status', SENDABLE_ITEM_STATUSES)
      .order('id', { ascending: true })
      .range(from, from + 499)
    if (pageResult.error) throw pageResult.error
    const page = (pageResult.data ?? []) as Record<string, unknown>[]
    items.push(...page)
    if (page.length < 500) break
  }

  const results: SendItemResult[] = []
  await supabaseService.from('invoice_export_runs').update({ status: 'processing', started_at: new Date().toISOString() }).eq('company_id', input.companyId).eq('id', input.exportRunId)

  for (const item of items) {
    if (!stringValue(item.id)) continue
    results.push(await sendSingleInvoiceExportItem({
      companyId: input.companyId,
      exportRunId: input.exportRunId,
      billingMonth,
      item,
      config,
      client,
      financingMode,
      actorUserId: input.actorUserId,
    }))
  }

  const summary = await finalizeExportRunStatus({
    companyId: input.companyId,
    exportRunId: input.exportRunId,
    billingMonth,
    actorUserId: input.actorUserId,
  })

  return { exportRunId: input.exportRunId, status: summary.finalStatus, sent: summary.sent, failed: summary.failed, results }
}

export async function sendInvoiceExportRun(input: {
  companyId: string
  exportRunId: string
  actorUserId?: string | null
}) {
  await assertPlatformSchemaReady()
  await assertOutboundAllowed({ companyId: input.companyId, channel: 'invoice_export' })
  return withAutomationLock({
    lockKey: `invoice-export:${input.companyId}:${input.exportRunId}`,
    companyId: input.companyId,
    ttlSeconds: 7_200,
    metadata: { domain: 'invoice_export', exportRunId: input.exportRunId },
    run: () => sendInvoiceExportRunUnlocked(input),
  })
}

// Retry worker: re-sends failed_retryable items whose backoff window has
// elapsed, reusing the SAME idempotency key persisted on each item so the
// provider-side dedupe holds across attempts.
export async function processDueInvoiceExportRetries(input: {
  companyId?: string | null
  limit?: number
} = {}) {
  await assertPlatformSchemaReady()
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  let query = supabaseService
    .from('invoice_export_items')
    .select('*')
    .eq('status', 'failed_retryable')
    .lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(limit)
  if (input.companyId) query = query.eq('company_id', input.companyId)

  const { data: dueItems, error } = await query
  if (error) {
    if (missingRelation(error)) return { processed: 0, sent: 0, failed: 0, results: [] as SendItemResult[] }
    throw error
  }

  const items = (dueItems ?? []) as Record<string, unknown>[]
  if (items.length === 0) return { processed: 0, sent: 0, failed: 0, results: [] as SendItemResult[] }

  // Group by (company, run) so config/client resolution happens once per run.
  const groups = new Map<string, { companyId: string; exportRunId: string; items: Record<string, unknown>[] }>()
  for (const item of items) {
    const companyId = stringValue(item.company_id)
    const exportRunId = stringValue(item.export_run_id)
    if (!companyId || !exportRunId) continue
    const key = `${companyId}:${exportRunId}`
    const group = groups.get(key) ?? { companyId, exportRunId, items: [] }
    group.items.push(item)
    groups.set(key, group)
  }

  const results: SendItemResult[] = []
  for (const group of groups.values()) {
    await assertOutboundAllowed({ companyId: group.companyId, channel: 'invoice_export' })
    const { data: run, error: runError } = await supabaseService
      .from('invoice_export_runs')
      .select('environment,financing_mode,billing_month')
      .eq('company_id', group.companyId)
      .eq('id', group.exportRunId)
      .maybeSingle()
    if (runError || !run) {
      console.error('[invoice-export-retry] export run missing', { exportRunId: group.exportRunId, error: runError })
      continue
    }
    const runRow = run as Record<string, unknown>
    const environment = (stringValue(runRow.environment) as CapwayEnvironment) ?? 'test'
    const financingMode = (stringValue(runRow.financing_mode) as CapwayFinancingMode) ?? 'invoice_service'
    const billingMonth = stringValue(runRow.billing_month)
    if (!billingMonth) continue

    let config: Awaited<ReturnType<typeof resolveCapwayConnectionConfig>>
    try {
      config = await resolveCapwayConnectionConfig({ companyId: group.companyId, environment })
    } catch (configError) {
      // Connection no longer configured: mark items so they stop being retried.
      const classification = classifyInvoiceExportError(configError)
      for (const item of group.items) {
        const itemId = stringValue(item.id)
        if (!itemId) continue
        await updateExportItemStrict(group.companyId, itemId, {
          status: 'configuration_error',
          error_code: classification.errorCode,
          error_payload: { message: classification.message, error_code: classification.errorCode },
          next_retry_at: null,
          updated_at: new Date().toISOString(),
        })
        results.push({ itemId, status: 'configuration_error', errorCode: classification.errorCode, error: classification.message })
      }
      continue
    }
    const client = new CapwayApticClient(config)

    for (const item of group.items) {
      results.push(await sendSingleInvoiceExportItem({
        companyId: group.companyId,
        exportRunId: group.exportRunId,
        billingMonth,
        item,
        config,
        client,
        financingMode,
        actorUserId: null,
      }))
    }

    await finalizeExportRunStatus({
      companyId: group.companyId,
      exportRunId: group.exportRunId,
      billingMonth,
      actorUserId: null,
    })
  }

  return {
    processed: results.length,
    sent: results.filter((row) => row.status === 'sent').length,
    failed: results.filter((row) => row.status !== 'sent').length,
    results,
  }
}

export async function getInvoiceExportRun(input: { companyId: string; exportRunId: string }) {
  const [run, items] = await Promise.all([
    supabaseService.from('invoice_export_runs').select('*').eq('company_id', input.companyId).eq('id', input.exportRunId).single(),
    supabaseService.from('invoice_export_items').select('*').eq('company_id', input.companyId).eq('export_run_id', input.exportRunId).order('created_at', { ascending: true }),
  ])
  if (run.error) throw run.error
  if (items.error) throw items.error
  return { run: run.data, items: items.data ?? [] }
}

export async function resetFailedInvoiceExportItems(input: { companyId: string; exportRunId: string }) {
  const { error } = await supabaseService
    .from('invoice_export_items')
    .update({
      status: 'pending',
      error_payload: {},
      error_code: null,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('export_run_id', input.exportRunId)
    .in('status', ['failed', 'failed_retryable', 'configuration_error', 'needs_review'])
  if (!error) return
  if (!missingRelation(error)) throw error

  const { error: legacyError } = await supabaseService
    .from('invoice_export_items')
    .update({ status: 'pending', error_payload: {}, updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId)
    .eq('export_run_id', input.exportRunId)
    .eq('status', 'failed')
  if (legacyError) throw legacyError
}
