import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { getBillingPeriodLock } from '@/lib/billing/invoiceReadiness'
import { prepareInvoiceDraftsForReview } from '@/lib/billing/invoiceReviewPrepare'
import { withAutomationLock } from '@/lib/automation/locks'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { parseBillingMonth, previousStockholmBillingMonth } from '@/lib/time/stockholm'
import { runMeteringMarketDataAutopilot, type MeteringAutopilotResult } from '@/lib/metering/monthlyAutopilot'

type JsonRecord = Record<string, unknown>
type MonthlyBillingAutomationStatus = 'running' | 'completed' | 'completed_with_blockers' | 'failed'

export type MonthlyBillingAutomationCompanyResult = {
  companyId: string
  billingMonth: string
  status: MonthlyBillingAutomationStatus
  automationRunId: string | null
  metering?: MeteringAutopilotResult | null
  underlayResult?: Awaited<ReturnType<typeof generateBillingUnderlaysForMonth>> | null
  preparation?: Awaited<ReturnType<typeof prepareInvoiceDraftsForReview>> | null
  prepared?: number
  blocked?: number
  failed?: number
  error?: string | null
}

function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }
function billingMonth(value: unknown): string { return parseBillingMonth(text(value) ?? previousStockholmBillingMonth()).value }
function automationErrorMessage(error: unknown): string {
  if (error instanceof Error) return text(error.message) ?? 'Okänt fel i månatlig fakturaförberedelse.'
  if (error && typeof error === 'object') return text((error as JsonRecord).message) ?? 'Okänt fel i månatlig fakturaförberedelse.'
  return text(error) ?? 'Okänt fel i månatlig fakturaförberedelse.'
}

async function listCompanies(companyId?: string | null): Promise<JsonRecord[]> {
  const select = 'id,status,is_active,billing_automation_enabled,invoice_export_enabled,invoice_export_target_system,billing_provider_environment'
  if (companyId) {
    const response = await supabaseService.from('companies').select(select).eq('id', companyId).maybeSingle()
    if (response.error) throw response.error
    if (!response.data) throw new Error('Tenant saknas.')
    return [response.data as JsonRecord]
  }
  const rows: JsonRecord[] = []
  for (let from = 0; ; from += 200) {
    const response = await supabaseService.from('companies').select(select).eq('billing_automation_enabled', true).eq('is_active', true).eq('status', 'active').order('id', { ascending: true }).range(from, from + 199)
    if (response.error) throw response.error
    const page = (response.data ?? []) as JsonRecord[]
    rows.push(...page)
    if (page.length < 200) return rows
  }
}

function validateCompany(company: JsonRecord) {
  if (company.is_active !== true || String(company.status) !== 'active') throw new Error('Tenant är inte aktiv.')
  if (company.billing_automation_enabled !== true) throw new Error('Faktureringsautomation är inte aktiverad för tenant.')
  if (company.invoice_export_enabled !== true) throw new Error('Fakturaförberedelse är inte aktiverad för tenant.')
  if (text(company.invoice_export_target_system) !== 'capway_aptic') throw new Error('Tenant saknar canonical Capway/Aptic-fakturapartner.')
  const environment = text(company.billing_provider_environment)
  if (environment !== 'test' && environment !== 'production') throw new Error('Tenant saknar canonical fakturaprovidermiljö.')
  return environment
}

async function insertRun(input: { companyId: string; periodMonth: string; actorUserId: string | null; lockKey: string; lockToken: string }) {
  const [year, month] = input.periodMonth.split('-').map(Number)
  const result = await supabaseService.from('billing_automation_runs').insert({ company_id: input.companyId, billing_year: year, billing_month: month, period_month: input.periodMonth, status: 'running', started_at: new Date().toISOString(), created_by: input.actorUserId, updated_by: input.actorUserId, lock_key: input.lockKey, lock_token: input.lockToken, export_requested: false, export_confirmed: false, metadata: { source: 'monthly_billing_prepare_only_v3', approval_required: true, metering_autopilot: true, run_id: randomUUID() } }).select('id').single()
  if (result.error) throw result.error
  return String(result.data.id)
}

async function finishRun(input: { companyId: string; automationRunId: string; actorUserId: string | null; status: MonthlyBillingAutomationStatus; totalUnderlays?: number; totalBlocked?: number; totalPrepared?: number; failureReason?: string | null; metadata?: JsonRecord }) {
  const result = await supabaseService.from('billing_automation_runs').update({ status: input.status, finished_at: new Date().toISOString(), total_underlays: input.totalUnderlays ?? null, total_blocked: input.totalBlocked ?? null, total_exported: input.totalPrepared ?? null, export_confirmed: false, failure_reason: input.failureReason ?? null, metadata: input.metadata ?? {}, updated_by: input.actorUserId, updated_at: new Date().toISOString() }).eq('company_id', input.companyId).eq('id', input.automationRunId).eq('status', 'running').select('id').maybeSingle()
  if (result.error) throw result.error
  if (!result.data) throw new Error('Faktureringskörningen kunde inte slutföras atomiskt.')
}

async function runPreparedMonthlyBillingAutomationForCompany(input: {
  companyId: string
  periodMonth: string
  actorUserId: string
  environment: 'test' | 'production'
}): Promise<MonthlyBillingAutomationCompanyResult> {
  const lockKey = `billing-monthly-prepare:${input.companyId}:${input.periodMonth}`

  return withAutomationLock({
    lockKey,
    companyId: input.companyId,
    ttlSeconds: 21_600,
    metadata: { domain: 'monthly_billing_prepare', billingMonth: input.periodMonth, meteringAutopilot: true },
    run: async (lock) => {
      const automationRunId = await insertRun({ companyId: input.companyId, periodMonth: input.periodMonth, actorUserId: input.actorUserId, lockKey: lock.lockKey, lockToken: lock.lockToken })
      try {
        const periodLock = await getBillingPeriodLock({ companyId: input.companyId, billingMonth: input.periodMonth })
        if (periodLock && ['locked', 'exported', 'closed'].includes(String(periodLock.status))) {
          await finishRun({ companyId: input.companyId, automationRunId, actorUserId: input.actorUserId, status: 'completed', totalPrepared: 0, metadata: { source: 'monthly_billing_prepare_only_v3', no_op: true, reason: 'billing_period_locked', period_lock_status: periodLock.status } })
          return { companyId: input.companyId, billingMonth: input.periodMonth, status: 'completed', automationRunId, prepared: 0, blocked: 0, failed: 0 }
        }

        const metering = await runMeteringMarketDataAutopilot({ companyId: input.companyId, billingMonth: input.periodMonth, actorUserId: input.actorUserId })
        const underlayResult = await generateBillingUnderlaysForMonth({ companyId: input.companyId, billingMonth: input.periodMonth, createdBy: input.actorUserId })
        const preparation = await prepareInvoiceDraftsForReview({ companyId: input.companyId, billingMonth: input.periodMonth, environment: input.environment, actorUserId: input.actorUserId })
        const meteringBlockers = metering.review + metering.stopped + metering.requested
        const status: MonthlyBillingAutomationStatus = meteringBlockers > 0 || preparation.blocked > 0 || preparation.failed > 0 ? 'completed_with_blockers' : 'completed'
        await finishRun({ companyId: input.companyId, automationRunId, actorUserId: input.actorUserId, status, totalUnderlays: preparation.underlays, totalBlocked: preparation.blocked + meteringBlockers, totalPrepared: preparation.created, metadata: { source: 'monthly_billing_prepare_only_v3', approval_required: true, metering_autopilot: metering, underlay_result: underlayResult, preparation } })
        return { companyId: input.companyId, billingMonth: input.periodMonth, status, automationRunId, metering, underlayResult, preparation, prepared: preparation.created, blocked: preparation.blocked + meteringBlockers, failed: preparation.failed }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Okänt fel i månatlig fakturaförberedelse.'
        await finishRun({ companyId: input.companyId, automationRunId, actorUserId: input.actorUserId, status: 'failed', failureReason: message, metadata: { source: 'monthly_billing_prepare_only_v3', error: message } })
        return { companyId: input.companyId, billingMonth: input.periodMonth, status: 'failed', automationRunId, error: message }
      }
    },
  })
}

export async function runMonthlyBillingAutomationForCompany(input: { companyId: string; billingMonth?: string | null; actorUserId?: string | null; companyConfig?: JsonRecord | null }): Promise<MonthlyBillingAutomationCompanyResult> {
  await assertPlatformSchemaReady()
  const periodMonth = billingMonth(input.billingMonth)
  const actorUserId = text(input.actorUserId) ?? text(process.env.GRIDEX_AUTOMATION_USER_ID)
  if (!actorUserId) throw new Error('GRIDEX_AUTOMATION_USER_ID krävs för mätvärdes- och faktureringsautopilot.')
  const company = input.companyConfig ?? (await listCompanies(input.companyId))[0]
  const environment = validateCompany(company)
  return runPreparedMonthlyBillingAutomationForCompany({ companyId: input.companyId, periodMonth, actorUserId, environment })
}

export async function runMonthlyBillingAutomation(input: { companyId?: string | null; billingMonth?: string | null; actorUserId?: string | null } = {}) {
  const periodMonth = billingMonth(input.billingMonth)
  await assertPlatformSchemaReady()
  const companies = await listCompanies(input.companyId)
  const results: MonthlyBillingAutomationCompanyResult[] = []
  for (const company of companies) {
    const companyId = text(company.id)
    if (!companyId) continue
    await assertPlatformSchemaReady()
    try {
      const actorUserId = text(input.actorUserId) ?? text(process.env.GRIDEX_AUTOMATION_USER_ID)
      if (!actorUserId) throw new Error('GRIDEX_AUTOMATION_USER_ID krävs för mätvärdes- och faktureringsautopilot.')
      const environment = validateCompany(company)
      results.push(await runPreparedMonthlyBillingAutomationForCompany({ companyId, periodMonth, actorUserId, environment }))
    } catch (error) {
      if (input.companyId) throw error
      results.push({ companyId, billingMonth: periodMonth, status: 'failed', automationRunId: null, error: automationErrorMessage(error) })
    }
  }
  return { billingMonth: periodMonth, processed: results.length, completed: results.filter((row) => row.status === 'completed').length, completedWithBlockers: results.filter((row) => row.status === 'completed_with_blockers').length, failed: results.filter((row) => row.status === 'failed').length, results }
}
