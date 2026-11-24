import { requireInvoiceSourceCopiesAvailable } from '@/lib/ediel/retention/financeCopyRetention'
import { InvoiceProviderConfigError, isFileProvider, loadTenantInvoiceProviderSelection, requireTenantInvoiceProvider } from '@/lib/billing/providers/registry'
import { tenantUpdate } from '@/lib/supabase/tenantQuery'
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
import { emitDomainEvent } from '@/lib/events/domainEvents'
import type { CapwayEnvironment, CapwayFinancingMode } from '@/lib/integrations/billing/capway/types'

type Row = Record<string, unknown>
const PURCHASE_RECONCILIATION_KEY = 'automatic_purchase_reconciliation'

class CapwayEntryUnavailable extends Error {
  constructor(readonly code: string) {
    super(code)
  }
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

export function approval(metadata: unknown): Row {
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

export async function loadItemContext(companyId: string, itemId: string) {
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

export async function assertItemStillReady(context: Awaited<ReturnType<typeof loadItemContext>>) {
  await requireInvoiceSourceCopiesAvailable({ companyId: String(context.item.company_id), underlayId: text(context.underlay.id), invoiceId: text(context.invoice.id), exportItemId: text(context.item.id) })
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
  // The database re-reads this context under locks and commits both approval
  // copies and their event together. A stale list or a competing caller cannot
  // overwrite the original reviewer or count an existing approval as new.
  const result = await supabaseService.rpc('gridex_approve_invoice_export_item_v1', {
    p_company_id: companyId,
    p_export_item_id: itemId,
    p_actor_user_id: actorUserId,
    p_expected_context: {
      item: context.item,
      invoice: context.invoice,
      underlay: context.underlay,
      pricing_run: context.pricingRun,
    },
    p_review_hash: reviewHash,
  })
  if (result.error?.code === '23514' && result.error.message === 'invoice_file_contract_case_hold') {
    throw new Error('Ett aktivt kundärende blockerar fakturering för det valda avtalet.')
  }
  if (result.error?.code === '23514' && [
    'billing_finalized_supply_basis_changed',
    'billing_finalized_source_basis_required',
    'ended_supply_pricing_basis_changed',
  ].includes(result.error.message)) {
    throw new Error('Fakturaunderlagets leveranskälla har ändrats. Kontrollera det aktuella underlaget innan du godkänner fakturan.')
  }
  if (result.error) throw result.error
  const receipt = objectValue(result.data)
  const storedApproval = objectValue(receipt.approval)
  if (typeof receipt.approved_now !== 'boolean'
    || storedApproval.status !== 'approved'
    || storedApproval.review_hash !== reviewHash
    || storedApproval.calculation_snapshot_sha256 !== calculationHash
    || !text(storedApproval.approved_by)
    || !Number.isFinite(Date.parse(text(storedApproval.approved_at) ?? ''))
    || (receipt.approved_now && (storedApproval.approved_by !== actorUserId
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(receipt.event_id) ?? '')))) {
    throw new Error('Fakturans godkännandekvitto saknas eller är ogiltigt.')
  }
  return receipt.approved_now
}

export async function updateLegacyProjection(input: { companyId: string; runId: string; itemId: string; status: 'sent' | 'failed'; error?: string | null }) {
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
  const { error } = await supabaseService.from('invoice_export_attempts').insert({
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
  })
  return !error
}

// A provider/selection mismatch is not transient: retrying cannot fix it, so the item leaves the
// retry queue until an operator corrects the setup and resets it.
async function parkConfigurationError(companyId: string, itemId: string, error: InvoiceProviderConfigError) {
  await tenantUpdate(companyId, 'invoice_export_items', {
    status: 'configuration_error',
    error_code: error.code,
    error_payload: { message: error.message, error_code: error.code },
    next_retry_at: null,
    updated_at: new Date().toISOString(),
  }).eq('id', itemId).eq('status', 'failed_retryable')
}

async function directDispatchSent(input: {
  companyId: string; itemId: string; actorUserId: string; runId: string;
  environment: CapwayEnvironment; billingMonth: string; invoiceGuid: string; attemptSaved: boolean;
}) {
  let monthReconciliation: 'locked' | 'not_locked' | 'failed' = 'not_locked'
  try {
    if (!input.attemptSaved) throw new Error('invoice_dispatch_attempt_not_recorded')
    if (input.environment === 'production') {
      const { reconcileVerifiedInvoiceDispatch } = await import('@/lib/billing/invoiceDispatchPeriodReconciliation')
      monthReconciliation = await reconcileVerifiedInvoiceDispatch(input)
    }
  } catch {
    monthReconciliation = 'failed'
    try {
      console.warn('[invoice-approved-dispatch] month reconciliation failed', {
        companyId: input.companyId, billingMonth: input.billingMonth, exportRunId: input.runId,
      })
    } catch {
      // Diagnostic failure cannot change a completed send.
    }
  }
  return { itemId: input.itemId, runId: input.runId, status: 'sent' as const, invoiceGuid: input.invoiceGuid, monthReconciliation }
}

async function projectDirectCapwayAcknowledgement(input: {
  companyId: string; itemId: string; actorUserId: string; runId: string; environment: CapwayEnvironment; billingMonth: string;
}) {
  const { data, error } = await supabaseService.rpc('gridex_project_direct_capway_ack_v1', {
    p_company: input.companyId, p_item: input.itemId, p_actor: input.actorUserId,
    p_run: input.runId, p_environment: input.environment,
  })
  if (error) throw new CapwayEntryUnavailable('capway_direct_invoice_projection_unconfirmed')
  if (data === null) return null
  const receipt = objectValue(data)
  if (receipt.id !== input.itemId) throw new CapwayEntryUnavailable('capway_direct_invoice_projection_unconfirmed')
  if (receipt.status === 'needs_review' && typeof receipt.reason === 'string') {
    return { itemId: input.itemId, runId: input.runId, status: 'needs_review' as const,
      errorCode: receipt.reason, error: 'Det sparade partnersvaret behöver stämmas av före publicering.' }
  }
  const invoiceGuid = text(receipt.invoiceGuid)
  if (receipt.status !== 'sent' || !invoiceGuid) throw new CapwayEntryUnavailable('capway_direct_invoice_projection_unconfirmed')
  return directDispatchSent({ ...input, invoiceGuid, attemptSaved: true })
}

async function sendApprovedItem(input: { companyId: string; itemId: string; actorUserId: string }) {
  await requireCompanyOperationalForWrites(input.companyId)
  return withAutomationLock({
    lockKey: `approved-invoice:${input.companyId}:${input.itemId}`,
    companyId: input.companyId,
    ttlSeconds: 7_200,
    metadata: { domain: 'invoice_approved_dispatch', itemId: input.itemId },
    run: async ({ lockToken }) => {
      const context = await loadItemContext(input.companyId, input.itemId)
      const itemApproval = approval(context.item.metadata)
      const invoiceApproval = approval(context.invoice.metadata)
      if (itemApproval.status !== 'approved' || invoiceApproval.status !== 'approved') throw new Error('Fakturaexport blockerad: explicit godkännande saknas.')
      const previousResponse = objectValue(context.item.response_payload)
      const direct = context.item.provider === 'capway_aptic' && !Object.hasOwn(previousResponse, PURCHASE_RECONCILIATION_KEY)
        && !shouldRequestPurchaseAfterCreate(text(context.run.financing_mode))
      const existingRunId = text(context.run.id)
      const existingMonth = text(context.run.billing_month)
      const existingEnvironment = text(context.run.environment)
      if (direct && existingRunId && existingMonth && (existingEnvironment === 'test' || existingEnvironment === 'production')) {
        const projected = await projectDirectCapwayAcknowledgement({ ...input, runId: existingRunId,
          environment: existingEnvironment, billingMonth: existingMonth })
        if (projected) return projected
      }
      await assertOutboundAllowed({ companyId: input.companyId, channel: 'invoice_export' })
      if (!['pending', 'failed', 'failed_retryable'].includes(String(context.item.status))) throw new Error('Fakturan är inte i ett skick som får skickas.')
      await assertItemStillReady(context)
      // Send only through the provider and environment the tenant has selected and enabled; a run
      // prepared for another provider or environment is never re-routed.
      const selected = requireTenantInvoiceProvider(context.company ?? {})
      if (context.company?.invoice_export_enabled !== true) throw new InvoiceProviderConfigError('invoice_dispatch_disabled', 'Utskick via fakturaleverantör är inte aktiverat för bolaget.')
      if ((text(context.run.provider) ?? 'capway_aptic') !== selected.provider) throw new InvoiceProviderConfigError('invoice_provider_mismatch', 'Exportkörningen gäller en annan fakturaleverantör än den bolaget har valt.')
      if (selected.provider !== 'capway_aptic') throw new InvoiceProviderConfigError('invoice_provider_file_export', 'Fakturor via fil skickas genom att skapa en fakturafil under Fakturering.')
      const environment = (text(context.run.environment) as CapwayEnvironment) ?? 'test'
      if (environment !== selected.environment) throw new InvoiceProviderConfigError('invoice_environment_mismatch', 'Exportkörningen gäller en annan miljö än den bolaget har valt.')
      const financingMode = (text(context.run.financing_mode) as CapwayFinancingMode) ?? 'invoice_service'
      const billingMonth = text(context.run.billing_month)
      const runId = text(context.run.id)
      if (!billingMonth || !runId) throw new Error('Exportkörningen saknar fakturamånad eller ID.')
      const purchaseAfterCreate = shouldRequestPurchaseAfterCreate(financingMode)
      if (purchaseAfterCreate && (context.item.provider !== selected.provider || context.item.environment !== environment)) {
        throw new InvoiceProviderConfigError('invoice_purchase_scope_mismatch', 'Fakturaköpet har en annan leverantör eller miljö än exportkörningen.')
      }
      const purchaseReview = {
        itemId: input.itemId,
        runId,
        status: 'needs_review' as const,
        errorCode: 'provider_purchase_reconciliation_required',
        error: 'Fakturaköpet behöver avstämmas innan körningen kan fortsätta.',
      }
      const reservePurchaseReview = (receipt: Row = {}) => supabaseService.from('invoice_export_items').update({
        ...receipt,
        status: purchaseReview.status,
        next_retry_at: null,
        error_code: purchaseReview.errorCode,
        error_payload: { message: purchaseReview.error, error_code: purchaseReview.errorCode },
        updated_at: new Date().toISOString(),
      }).eq('company_id', input.companyId).eq('id', input.itemId).eq('export_run_id', runId)
        .eq('provider', String(context.item.provider)).eq('environment', String(context.item.environment))
        .eq('status', String(context.item.status))
        .eq('updated_at', String(context.item.updated_at)).select('id,updated_at').maybeSingle()

      // A reset can clear the queue status, but it cannot authorize a second purchase.
      const existingProviderInvoice = text(context.item.provider_invoice_guid) ?? text(context.item.provider_invoice_id)
      if (Object.hasOwn(previousResponse, PURCHASE_RECONCILIATION_KEY) || (purchaseAfterCreate && existingProviderInvoice)) {
        const parked = await reservePurchaseReview()
        if (parked.error) throw parked.error
        if (!parked.data) throw new Error('Fakturapostens avstämningskrav kunde inte sparas.')
        return purchaseReview
      }
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
      const createReview = {
        itemId: input.itemId,
        runId,
        status: 'needs_review' as const,
        errorCode: 'provider_create_acceptance_unconfirmed',
        error: 'Fakturans skickstatus behöver avstämmas hos leverantören innan ett nytt utskick kan göras.',
      }
      const getEntry = async (options: { phase: 'create' | 'purchase'; updatedAt: string | null; requestHash: string; targetGuid?: string; wireBody?: string }) => {
        const required = {
          p_company: input.companyId,
          p_item: input.itemId,
          p_invoice: text(context.invoice.id),
          p_run: runId,
          p_actor: input.actorUserId,
          p_lease: lockToken,
          p_environment: environment,
          p_updated_at: options.updatedAt,
          p_review_hash: text(itemApproval.review_hash),
          p_external_reference: text(payload.externalReferenceCode),
          p_provider_key: providerKey,
          p_request_hash: options.requestHash,
        }
        const requiresWireBody = options.phase === 'create' && !purchaseAfterCreate
        const wireBody = options.wireBody
        if (requiresWireBody && !wireBody) throw new CapwayEntryUnavailable('capway_direct_invoice_request_unconfirmed')
        const { data, error } = requiresWireBody && wireBody
          ? await supabaseService.rpc('gridex_reserve_direct_capway_invoice_v1', { ...required, p_wire_body: wireBody })
          : await supabaseService.rpc('gridex_reserve_capway_dispatch_entry_v1', {
            ...required, p_phase: options.phase, p_target_guid: options.targetGuid ?? null,
          })
        if (error?.code === '23514' && error.message === 'invoice_file_contract_case_hold') {
          throw new CapwayEntryUnavailable('invoice_contract_case_hold')
        }
        if (error || !text(data)) throw new CapwayEntryUnavailable('capway_dispatch_entry_unconfirmed')
        return String(data)
      }
      const recordAcknowledgement = async (entryId: string, acknowledgement: Record<string, unknown>, directHttpStatus?: number) => {
        const receipt = {
          p_company: input.companyId,
          p_item: input.itemId,
          p_entry: entryId,
          p_lease: lockToken,
          p_ack: acknowledgement,
        }
        const { data, error } = directHttpStatus === undefined
          ? await supabaseService.rpc('gridex_record_capway_dispatch_ack_v1', receipt)
          : await supabaseService.rpc('gridex_record_direct_capway_ack_v1', { ...receipt, p_http_status: directHttpStatus })
        if (error || data !== entryId) throw new CapwayEntryUnavailable('capway_dispatch_ack_unconfirmed')
      }

      let invoiceGuid: string
      let createEntry: string | undefined
      let purchaseEntry: string | undefined
      let purchaseReserved = false
      try {
        let directHttpStatus: number | undefined
        const response = await client.createInvoices([payload], providerKey, async wireBody => {
          const wireHash = wireBody ? createHash('sha256').update(wireBody, 'utf8').digest('hex') : null
          createEntry = await getEntry({ phase: 'create', updatedAt: text(context.item.updated_at),
            requestHash: !purchaseAfterCreate && wireHash ? wireHash : payloadHash, wireBody })
        }, status => { directHttpStatus = status })
        // Filtered GET is an observation, not a direct acknowledgement for
        // this reserved operation. It must not begin an automatic purchase.
        if (!createEntry || response.reconciled === true) return createReview
        if (!purchaseAfterCreate && directHttpStatus === undefined) return createReview
        await recordAcknowledgement(createEntry, response, purchaseAfterCreate ? undefined : directHttpStatus)
        const guids = Array.isArray(response.invoiceGuids) ? response.invoiceGuids.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())) : []
        if (guids.length !== 1) throw new Error('Fakturapartnern returnerade inte exakt ett faktura-ID.')
        invoiceGuid = guids[0]
        if (!purchaseAfterCreate) {
          return (await projectDirectCapwayAcknowledgement({ ...input, runId, environment, billingMonth })) ?? createReview
        }
        let purchaseResponse: Record<string, unknown> | null = null
        if (purchaseAfterCreate) {
          // Persist the create receipt and reserve review before contacting the purchase endpoint.
          // Provider identity remains internal until the purchase path can complete as sent.
          const reservation = await reservePurchaseReview({
            response_payload: {
              ...previousResponse,
              create_invoice: response,
              [PURCHASE_RECONCILIATION_KEY]: {
                company_id: input.companyId,
                export_run_id: runId,
                invoice_export_item_id: input.itemId,
                provider: selected.provider,
                environment,
                financing_mode: financingMode,
                invoice_guid: invoiceGuid,
                attempt_no: attemptNo,
                provider_idempotency_key: providerKey,
              },
            },
            attempt_count: attemptNo,
            last_attempt_at: startedAt,
          })
          if (reservation.error) throw reservation.error
          if (!reservation.data) throw new Error('Skapandekvittot kunde inte sparas före fakturaköpet.')
          purchaseReserved = true
          const purchasePayload = buildPurchasePayload({ financingMode })
          purchaseResponse = await client.postPurchase(invoiceGuid, purchasePayload, async () => {
            purchaseEntry = await getEntry({
              phase: 'purchase',
              updatedAt: text(reservation.data?.updated_at),
              requestHash: sha256(purchasePayload),
              targetGuid: invoiceGuid,
            })
          })
          if (!purchaseEntry) return purchaseReview
          await recordAcknowledgement(purchaseEntry, purchaseResponse)
        }
        const now = new Date().toISOString()
        if (purchaseReserved) {
          const receipt = await supabaseService.rpc('gridex_finalize_automatic_invoice_purchase_ack_v1', {
            p_company_id: input.companyId,
            p_invoice_export_item_id: input.itemId,
            p_export_run_id: runId,
            p_environment: environment,
            p_invoice_guid: invoiceGuid,
            p_provider_key: providerKey,
            p_attempt_no: attemptNo,
            p_started_at: startedAt,
            p_request_payload: payload,
            p_purchase_ack: purchaseResponse,
            p_customer_invoice_id: text(context.invoice.id),
            p_issued_at: invoiceDate,
            p_due_date: dueDate.slice(0, 10),
          })
          if (receipt.error) throw receipt.error
          if (receipt.data?.id === input.itemId && receipt.data.status === 'needs_review') {
            return { ...purchaseReview, errorCode: 'signed_cancellation_before_automatic_ack' }
          }
          if (receipt.data?.id !== input.itemId || receipt.data.status !== 'sent') {
            throw new Error('Det automatiska fakturaköpet saknar verifierat slutkvitto.')
          }
        }
        purchaseReserved = false
        await supabaseService.from('invoice_export_runs').update({ status: 'sent', sent_items: 1, failed_items: 0, total_ex_vat: num(context.item.amount_ex_vat) ?? 0, vat_amount: num(context.item.vat_amount) ?? 0, total_inc_vat: num(context.item.amount_inc_vat) ?? 0, started_at: startedAt, finished_at: now, updated_at: now }).eq('company_id', input.companyId).eq('id', runId)
        await updateLegacyProjection({ companyId: input.companyId, runId, itemId: input.itemId, status: 'sent' })
        await emitDomainEvent({ companyId: input.companyId, eventType: 'invoice.sent', aggregateType: 'invoice_export_item', aggregateId: input.itemId, subjectCustomerId: text(context.customer.id), actorUserId: input.actorUserId, source: 'invoice_approved_dispatch_v1', payload: { invoice_guid: invoiceGuid, billing_month: billingMonth, amount_inc_vat: num(context.item.amount_inc_vat), due_date: dueDate.slice(0, 10) }, idempotencyKey: `invoice-sent:${input.itemId}:${invoiceGuid}` }).catch(() => null)
      } catch (error) {
        // A reserved partner effect can only be reconciled, never retried
        // automatically after an ambiguous network or database response.
        if (error instanceof CapwayEntryUnavailable && error.code === 'invoice_contract_case_hold') {
          return {
            ...(purchaseReserved ? purchaseReview : createReview),
            errorCode: error.code,
            error: 'Ett aktivt kundärende blockerar utskicket för det valda avtalet.',
          }
        }
        if (purchaseReserved) return purchaseReview
        if (createEntry || error instanceof CapwayEntryUnavailable) return createReview
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

      // Period reconciliation runs after the provider receipt and invoice states have been saved.
      const attemptSaved = await recordAttempt({ companyId: input.companyId, itemId: input.itemId, runId, attemptNo,
        idempotencyKey: providerKey, requestHash: payloadHash, httpStatus: 200, outcome: 'sent', errorCode: null, startedAt }).catch(() => false)
      return directDispatchSent({ ...input, runId, environment, billingMonth, invoiceGuid, attemptSaved })
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
    if (!itemId) continue
    try {
      results.push(await sendApprovedItem({ companyId: input.companyId, itemId, actorUserId: input.actorUserId }))
    } catch (error) {
      if (!(error instanceof InvoiceProviderConfigError)) throw error
      results.push({ itemId, runId: input.exportRunId, status: 'configuration_error' as const, error: error.message, errorCode: error.code })
    }
  }
  return { exportRunId: input.exportRunId, results, sent: results.filter((row) => row.status === 'sent').length, failed: results.filter((row) => row.status !== 'sent').length }
}

export async function approveAndSendReadyInvoicesForMonth(input: { companyId: string; billingMonth: string; actorUserId: string }) {
  await requireCompanyOperationalForWrites(input.companyId)
  // A file provider receives approved invoices through an invoice file, not per-invoice sends.
  const approveOnly = isFileProvider(requireTenantInvoiceProvider((await loadTenantInvoiceProviderSelection(input.companyId)) ?? {}).provider)
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
        if (await approveItem(input.companyId, itemId, input.actorUserId)) approved += 1
      }
      if (approveOnly) continue
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
  return { approved, sent, failed, errors, approveOnly }
}

export async function processDueApprovedInvoiceRetries(input: { companyId?: string | null; limit?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const cutoff = new Date().toISOString()
  const approvalStatus = 'metadata->approval->>status'
  const approvedBy = 'metadata->approval->>approved_by'
  // Auth user IDs are UUIDs. Allow the surrounding whitespace accepted by the dispatch read.
  const actorPattern = '^[[:space:]]*[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[[:space:]]*$'
  function dueQuery(diagnostic = false) {
    const query = supabaseService.from('invoice_export_items')
      .select('id,company_id,metadata', diagnostic ? { count: 'exact', head: true } : undefined)
      .eq('status', 'failed_retryable')
      .lte('next_retry_at', cutoff)
    return input.companyId ? query.eq('company_id', input.companyId) : query
  }
  const result = await dueQuery()
    .eq(approvalStatus, 'approved')
    .regexMatch(approvedBy, actorPattern)
    .order('next_retry_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
  if (result.error) throw result.error
  let sent = 0
  let failed = 0
  for (const item of (result.data ?? []) as Row[]) {
    const companyId = text(item.company_id)
    const itemId = text(item.id)
    if (!companyId || !itemId || approval(item.metadata).status !== 'approved') continue
    const actor = text(approval(item.metadata).approved_by)
    if (!actor) continue
    try {
      const outcome = await sendApprovedItem({ companyId, itemId, actorUserId: actor })
      if (outcome.status === 'sent') sent += 1
      else failed += 1
    } catch (error) {
      failed += 1
      if (error instanceof InvoiceProviderConfigError) await parkConfigurationError(companyId, itemId, error)
    }
  }

  // A timed-out diagnostic count must not discard dispatch results or delay the next cron step indefinitely.
  let needsApproval: number | null = null
  try {
    const { count, error } = await dueQuery(true)
      .or([`${approvalStatus}.neq.approved`, `${approvalStatus}.is.null`, `${approvedBy}.is.null`, `${approvedBy}.not.match.${actorPattern}`].join(','))
      .abortSignal(AbortSignal.timeout(2_000))
    if (error || count === null) throw new Error('invoice_retry_approval_count_unavailable')
    needsApproval = count
  } catch {
    console.warn('[invoice-approved-retries] approval diagnostics unavailable')
  }
  return { processed: sent + failed, sent, failed, needsApproval }
}
