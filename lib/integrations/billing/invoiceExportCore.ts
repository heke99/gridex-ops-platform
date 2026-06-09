import { supabaseService } from '@/lib/supabase/service'
import { evaluateBillingMonthInvoiceReadiness, lockBillingPeriodForInvoiceExport } from '@/lib/billing/invoiceReadiness'
import { resolveCapwayConnectionConfig } from '@/lib/integrations/billing/capway/auth'
import { CapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { buildCapwayInvoicePayload } from '@/lib/integrations/billing/capway/payloadBuilder'
import { buildPurchasePayload } from '@/lib/integrations/billing/capway/purchase'
import { shouldRequestPurchaseAfterCreate } from '@/lib/integrations/billing/capway/statusMapper'
import type { CapwayEnvironment, CapwayFinancingMode } from '@/lib/integrations/billing/capway/types'

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

  const { data: pricingRuns, error: pricingError } = await supabaseService
    .from('pricing_runs')
    .select('id,billing_underlay_id,customer_id,total_ex_vat,vat_amount,total_inc_vat,status,billing_period_start,billing_period_end')
    .eq('company_id', input.companyId)
    .gte('billing_period_start', `${input.billingMonth}-01`)
    .lt('billing_period_start', new Date(Date.UTC(Number(input.billingMonth.slice(0, 4)), Number(input.billingMonth.slice(5, 7)), 1)).toISOString().slice(0, 10))
    .in('status', ['success', 'locked'])
    .limit(10_000)
  if (pricingError) throw pricingError

  const customerIds = Array.from(new Set(((pricingRuns ?? []) as Record<string, unknown>[]).map((pricingRun) => stringValue(pricingRun.customer_id)).filter(Boolean))) as string[]
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

  const itemRows = ((pricingRuns ?? []) as Record<string, unknown>[]).map((pricingRun) => {
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

  if (itemRows.length > 0) {
    const { error: itemError } = await supabaseService
      .from('invoice_export_items')
      .upsert(itemRows, { onConflict: 'company_id,provider,idempotency_key' })
    if (itemError) throw itemError
  }

  await supabaseService
    .from('invoice_export_runs')
    .update({ total_items: itemRows.length, updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId)
    .eq('id', runId)

  return { runId, itemCount: itemRows.length, readiness }
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

export async function sendInvoiceExportRun(input: {
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

  const { data: items, error: itemError } = await supabaseService
    .from('invoice_export_items')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('export_run_id', input.exportRunId)
    .in('status', ['pending', 'failed'])
    .limit(1000)
  if (itemError) throw itemError

  let sent = 0
  let failed = 0
  const results: Array<Record<string, unknown>> = []
  await supabaseService.from('invoice_export_runs').update({ status: 'processing', started_at: new Date().toISOString() }).eq('company_id', input.companyId).eq('id', input.exportRunId)

  for (const item of (items ?? []) as Record<string, unknown>[]) {
    const itemId = stringValue(item.id)
    if (!itemId) continue
    try {
      const context = await loadItemContext(input.companyId, item)
      const payload = buildCapwayInvoicePayload({
        config,
        company: context.company,
        customer: context.customer,
        pricingRun: context.pricingRun,
        pricingLines: context.lines,
        underlay: context.underlay,
        financingMode,
      })
      const response = await client.createInvoices([payload])
      const invoiceGuid = response.invoiceGuids?.[0] ?? null
      let purchaseResponse: Record<string, unknown> | null = null
      if (invoiceGuid && shouldRequestPurchaseAfterCreate(financingMode)) {
        purchaseResponse = await client.postPurchase(invoiceGuid, buildPurchasePayload({ financingMode, note: `Gridex export ${input.exportRunId}` }))
        await supabaseService.from('invoice_purchase_events').insert({
          company_id: input.companyId,
          invoice_export_item_id: itemId,
          event_type: 'purchase_requested',
          purchase_status: 'requested',
          finance_status: financingMode,
          payload: purchaseResponse,
          created_by: input.actorUserId ?? null,
        })
      }

      await supabaseService.from('invoice_export_items').update({
        status: 'sent',
        customer_number: stringValue(context.customer.customer_number),
        provider_customer_id: stringValue(payload.customer.customerReference),
        provider_debtor_id: stringValue(payload.customer.customerReference),
        provider_invoice_guid: invoiceGuid,
        provider_imp_stock_id: response.impStockId ?? null,
        request_payload: payload,
        response_payload: { create_invoice: response, purchase: purchaseResponse },
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('company_id', input.companyId).eq('id', itemId)
      sent += 1
      results.push({ itemId, status: 'sent', invoiceGuid })
    } catch (error) {
      failed += 1
      const message = error instanceof Error ? error.message : 'Okänt Capway-fel'
      await supabaseService.from('invoice_export_items').update({
        status: 'failed',
        error_payload: { message },
        updated_at: new Date().toISOString(),
      }).eq('company_id', input.companyId).eq('id', itemId)
      await supabaseService.from('invoice_dead_letters').insert({
        company_id: input.companyId,
        provider: 'capway_aptic',
        export_run_id: input.exportRunId,
        export_item_id: itemId,
        error_message: message,
        payload: item,
      })
      results.push({ itemId, status: 'failed', error: message })
    }
  }

  const finalStatus = failed > 0 ? (sent > 0 ? 'partial_failed' : 'failed') : 'sent'
  await supabaseService.from('invoice_export_runs').update({
    status: finalStatus,
    sent_items: sent,
    failed_items: failed,
    finished_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('company_id', input.companyId).eq('id', input.exportRunId)

  if (sent > 0 && failed === 0) {
    await lockBillingPeriodForInvoiceExport({ companyId: input.companyId, billingMonth, exportRunId: input.exportRunId, actorUserId: input.actorUserId })
  }

  return { exportRunId: input.exportRunId, status: finalStatus, sent, failed, results }
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
    .update({ status: 'pending', error_payload: {}, updated_at: new Date().toISOString() })
    .eq('company_id', input.companyId)
    .eq('export_run_id', input.exportRunId)
    .eq('status', 'failed')
  if (error) throw error
}
