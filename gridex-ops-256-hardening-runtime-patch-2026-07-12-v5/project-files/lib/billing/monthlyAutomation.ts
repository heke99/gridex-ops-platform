import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import {
  createBillingExportRun,
  queueReadyBillingExportRunItems,
  sendBillingExportRunToPartnerApi,
} from '@/lib/billing/exportCenter'
import { withAutomationLock } from '@/lib/automation/locks'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { assertOutboundAllowed } from '@/lib/platform/outboundFreeze'
import { parseBillingMonth, previousStockholmBillingMonth } from '@/lib/time/stockholm'

type JsonRecord = Record<string, unknown>
type MonthlyBillingAutomationStatus = 'running' | 'completed' | 'completed_with_blockers' | 'failed'

export type MonthlyBillingAutomationCompanyResult = {
  companyId: string
  billingMonth: string
  status: MonthlyBillingAutomationStatus
  automationRunId: string | null
  underlayResult?: Awaited<ReturnType<typeof generateBillingUnderlaysForMonth>> | null
  exportRunId?: string | null
  queued?: number
  blocked?: number
  skipped?: number
  sent?: boolean | null
  error?: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function billingMonth(value: unknown): string {
  const month = text(value) ?? previousStockholmBillingMonth()
  return parseBillingMonth(month).value
}

async function insertAutomationRun(input: {
  companyId: string
  billingMonth: string
  actorUserId: string | null
  lockKey: string
  lockToken: string
  metadata?: JsonRecord
}) {
  const [year, month] = input.billingMonth.split('-').map(Number)
  const response = await supabaseService
    .from('billing_automation_runs')
    .insert({
      company_id: input.companyId,
      billing_year: year,
      billing_month: month,
      period_month: input.billingMonth,
      status: 'running',
      started_at: new Date().toISOString(),
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      lock_key: input.lockKey,
      lock_token: input.lockToken,
      export_requested: input.metadata?.sendToPartner === true,
      export_confirmed: false,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()
  if (response.error) throw response.error
  return String(response.data.id)
}

async function updateAutomationRun(input: {
  automationRunId: string
  companyId: string
  status: MonthlyBillingAutomationStatus
  actorUserId: string | null
  totalUnderlays?: number
  totalBlocked?: number
  totalExported?: number
  exportConfirmed?: boolean
  failureReason?: string | null
  metadata?: JsonRecord
}) {
  const response = await supabaseService
    .from('billing_automation_runs')
    .update({
      status: input.status,
      finished_at: new Date().toISOString(),
      total_underlays: input.totalUnderlays ?? null,
      total_blocked: input.totalBlocked ?? null,
      total_exported: input.totalExported ?? null,
      export_confirmed: input.exportConfirmed === true,
      failure_reason: input.failureReason ?? null,
      metadata: input.metadata ?? {},
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('id', input.automationRunId)
    .eq('status', 'running')
    .select('id')
    .maybeSingle()
  if (response.error) throw response.error
  if (!response.data) throw new Error('Faktureringskörningen kunde inte slutföras atomiskt.')
}

async function listBillingAutomationCompanies(companyId?: string | null): Promise<JsonRecord[]> {
  if (companyId) {
    const response = await supabaseService
      .from('companies')
      .select('id,status,is_active,billing_automation_enabled,invoice_export_enabled,invoice_export_target_system,invoice_export_format')
      .eq('id', companyId)
      .maybeSingle()
    if (response.error) throw response.error
    if (!response.data) throw new Error('Tenant saknas.')
    return [response.data as JsonRecord]
  }

  const all: JsonRecord[] = []
  const pageSize = 200
  for (let from = 0; ; from += pageSize) {
    const response = await supabaseService
      .from('companies')
      .select('id,status,is_active,billing_automation_enabled,invoice_export_enabled,invoice_export_target_system,invoice_export_format')
      .eq('billing_automation_enabled', true)
      .eq('is_active', true)
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (response.error) throw response.error
    const page = (response.data ?? []) as JsonRecord[]
    all.push(...page)
    if (page.length < pageSize) return all
  }
}

function validateCompany(company: JsonRecord, requestSend: boolean) {
  if (company.is_active !== true || String(company.status) !== 'active') throw new Error('Tenant är inte aktiv.')
  if (company.billing_automation_enabled !== true) throw new Error('Faktureringsautomation är inte aktiverad för tenant.')
  if (requestSend && company.invoice_export_enabled !== true) throw new Error('Fakturaexport är inte aktiverad för tenant.')
}

export async function runMonthlyBillingAutomationForCompany(input: {
  companyId: string
  billingMonth?: string | null
  actorUserId?: string | null
  targetSystem?: string | null
  exportFormat?: string | null
  sendToPartner?: boolean
  companyConfig?: JsonRecord | null
}): Promise<MonthlyBillingAutomationCompanyResult> {
  await assertPlatformSchemaReady()
  const periodMonth = billingMonth(input.billingMonth)
  const actorUserId = text(input.actorUserId) ?? text(process.env.GRIDEX_AUTOMATION_USER_ID)
  const company = input.companyConfig ?? (await listBillingAutomationCompanies(input.companyId))[0]
  validateCompany(company, input.sendToPartner === true)
  const targetSystem = text(input.targetSystem) ?? text(company.invoice_export_target_system) ?? 'billing_partner'
  const exportFormat = text(input.exportFormat) ?? text(company.invoice_export_format) ?? 'json'
  const lockKey = `billing-monthly:${input.companyId}:${periodMonth}`

  return withAutomationLock({
    lockKey,
    companyId: input.companyId,
    ttlSeconds: 21_600,
    metadata: { domain: 'monthly_billing', billingMonth: periodMonth },
    run: async (lock) => {
      const metadataBase = {
        source: 'monthly_billing_automation',
        runId: randomUUID(),
        targetSystem,
        exportFormat,
        sendToPartner: input.sendToPartner === true,
      }
      const automationRunId = await insertAutomationRun({
        companyId: input.companyId,
        billingMonth: periodMonth,
        actorUserId,
        lockKey: lock.lockKey,
        lockToken: lock.lockToken,
        metadata: metadataBase,
      })

      try {
        const underlayResult = await generateBillingUnderlaysForMonth({
          companyId: input.companyId,
          billingMonth: periodMonth,
          createdBy: actorUserId,
        })
        const exportRun = await createBillingExportRun({
          companyId: input.companyId,
          actorUserId,
          periodMonth,
          targetSystem,
          exportFormat,
          idempotencyKey: `monthly-billing:${input.companyId}:${periodMonth}:${targetSystem}:${exportFormat}`,
        })
        const queuedResult = await queueReadyBillingExportRunItems({
          companyId: input.companyId,
          actorUserId,
          exportRunId: exportRun.id,
        })

        let sent: boolean | null = null
        if (input.sendToPartner === true) {
          await assertOutboundAllowed({ companyId: input.companyId, channel: 'invoice_export' })
          if ((queuedResult.blocked ?? 0) > 0 || underlayResult.needsReview > 0) {
            throw new Error('Fakturaexport blockerad eftersom fakturaunderlag eller exportposter kräver granskning.')
          }
          const sendResult = await sendBillingExportRunToPartnerApi({
            companyId: input.companyId,
            actorUserId,
            exportRunId: exportRun.id,
          })
          sent = sendResult.sent
          if (!sent) throw new Error('Faktureringsportalen bekräftade inte hela exportkörningen.')
        }

        const status: MonthlyBillingAutomationStatus =
          (queuedResult.blocked ?? 0) > 0 || underlayResult.needsReview > 0 ? 'completed_with_blockers' : 'completed'
        await updateAutomationRun({
          automationRunId,
          companyId: input.companyId,
          actorUserId,
          status,
          totalUnderlays: underlayResult.underlays,
          totalBlocked: (queuedResult.blocked ?? 0) + underlayResult.needsReview,
          totalExported: queuedResult.queued ?? 0,
          exportConfirmed: sent === true,
          metadata: { ...metadataBase, underlayResult, queuedResult, exportRunId: exportRun.id, sent },
        })
        return {
          companyId: input.companyId,
          billingMonth: periodMonth,
          status,
          automationRunId,
          underlayResult,
          exportRunId: exportRun.id,
          queued: queuedResult.queued,
          blocked: queuedResult.blocked,
          skipped: queuedResult.skipped,
          sent,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Okänt fel i månatlig faktureringsautomation.'
        await updateAutomationRun({
          automationRunId,
          companyId: input.companyId,
          actorUserId,
          status: 'failed',
          failureReason: message,
          metadata: { ...metadataBase, error: message },
        })
        return { companyId: input.companyId, billingMonth: periodMonth, status: 'failed', automationRunId, error: message }
      }
    },
  })
}

export async function runMonthlyBillingAutomation(input: {
  companyId?: string | null
  billingMonth?: string | null
  actorUserId?: string | null
  targetSystem?: string | null
  exportFormat?: string | null
  sendToPartner?: boolean
} = {}) {
  await assertPlatformSchemaReady()
  const companies = await listBillingAutomationCompanies(input.companyId)
  const results: MonthlyBillingAutomationCompanyResult[] = []
  for (const company of companies) {
    const companyId = text(company.id)
    if (!companyId) continue
    results.push(await runMonthlyBillingAutomationForCompany({
      companyId,
      billingMonth: input.billingMonth,
      actorUserId: input.actorUserId,
      targetSystem: input.targetSystem,
      exportFormat: input.exportFormat,
      sendToPartner: input.sendToPartner,
      companyConfig: company,
    }))
  }
  const periodMonth = billingMonth(input.billingMonth)
  return {
    ok: results.every((result) => result.status !== 'failed'),
    billingMonth: periodMonth,
    companies: companies.length,
    results,
  }
}
