import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import {
  createBillingExportRun,
  queueReadyBillingExportRunItems,
  sendBillingExportRunToPartnerApi,
} from '@/lib/billing/exportCenter'

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

function currentBillingMonth(now = new Date()) {
  // Normal monthly run invoices the previous complete month.
  const firstDayThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const previous = new Date(Date.UTC(firstDayThisMonth.getUTCFullYear(), firstDayThisMonth.getUTCMonth() - 1, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`
}

async function insertAutomationRun(input: {
  companyId: string
  billingMonth: string
  actorUserId: string | null
  metadata?: JsonRecord
}) {
  const [year, month] = input.billingMonth.split('-').map(Number)
  const { data, error } = await supabaseService
    .from('billing_automation_runs')
    .insert({
      company_id: input.companyId,
      billing_year: Number.isFinite(year) ? year : null,
      billing_month: Number.isFinite(month) ? month : null,
      period_month: input.billingMonth,
      status: 'running',
      started_at: new Date().toISOString(),
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .maybeSingle()

  if (error) {
    const code = String((error as { code?: string }).code ?? '')
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) return null
    throw error
  }
  return text((data as { id?: string } | null)?.id)
}

async function updateAutomationRun(input: {
  automationRunId: string | null
  companyId: string
  status: MonthlyBillingAutomationStatus
  actorUserId: string | null
  totalUnderlays?: number
  totalBlocked?: number
  totalExported?: number
  failureReason?: string | null
  metadata?: JsonRecord
}) {
  if (!input.automationRunId) return
  const { error } = await supabaseService
    .from('billing_automation_runs')
    .update({
      status: input.status,
      finished_at: new Date().toISOString(),
      total_underlays: input.totalUnderlays ?? null,
      total_blocked: input.totalBlocked ?? null,
      total_exported: input.totalExported ?? null,
      failure_reason: input.failureReason ?? null,
      metadata: input.metadata ?? {},
      updated_by: input.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('id', input.automationRunId)

  if (error) {
    const code = String((error as { code?: string }).code ?? '')
    if (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code)) return
    throw error
  }
}

async function listBillingAutomationCompanyIds(companyId?: string | null): Promise<string[]> {
  if (companyId) return [companyId]
  const { data, error } = await supabaseService
    .from('companies')
    .select('id, status, ediel_production_enabled, live_ediel_enabled')
    .or('ediel_production_enabled.eq.true,live_ediel_enabled.eq.true')
    .limit(200)

  if (error) throw error
  return ((data ?? []) as Array<{ id?: string | null }>).map((row) => row.id).filter((id): id is string => Boolean(id))
}

export async function runMonthlyBillingAutomationForCompany(input: {
  companyId: string
  billingMonth?: string | null
  actorUserId?: string | null
  targetSystem?: string | null
  exportFormat?: string | null
  sendToPartner?: boolean
}): Promise<MonthlyBillingAutomationCompanyResult> {
  const billingMonth = text(input.billingMonth) ?? currentBillingMonth()
  const actorUserId = text(input.actorUserId) ?? text(process.env.GRIDEX_AUTOMATION_USER_ID)
  const metadataBase = {
    source: 'monthly_billing_automation',
    runId: randomUUID(),
    targetSystem: input.targetSystem ?? 'billing_partner',
    exportFormat: input.exportFormat ?? 'json',
    sendToPartner: input.sendToPartner === true,
  }
  const automationRunId = await insertAutomationRun({
    companyId: input.companyId,
    billingMonth,
    actorUserId,
    metadata: metadataBase,
  })

  try {
    const underlayResult = await generateBillingUnderlaysForMonth({
      companyId: input.companyId,
      billingMonth,
      createdBy: actorUserId,
    })

    const exportRun = await createBillingExportRun({
      companyId: input.companyId,
      actorUserId,
      periodMonth: billingMonth,
      targetSystem: input.targetSystem ?? 'billing_partner',
      exportFormat: input.exportFormat ?? 'json',
      // Run-level idempotency: a re-fired monthly cron reuses the month's run
      // instead of creating a duplicate.
      idempotencyKey: `monthly-billing:${input.companyId}:${billingMonth}:${input.targetSystem ?? 'billing_partner'}:${input.exportFormat ?? 'json'}`,
    })

    const queuedResult = await queueReadyBillingExportRunItems({
      companyId: input.companyId,
      actorUserId,
      exportRunId: exportRun.id,
    })

    let sent: boolean | null = null
    if (input.sendToPartner === true) {
      const sendResult = await sendBillingExportRunToPartnerApi({
        companyId: input.companyId,
        actorUserId,
        exportRunId: exportRun.id,
      })
      sent = sendResult.sent
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
      metadata: { ...metadataBase, underlayResult, queuedResult, exportRunId: exportRun.id, sent },
    })

    return {
      companyId: input.companyId,
      billingMonth,
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
    return { companyId: input.companyId, billingMonth, status: 'failed', automationRunId, error: message }
  }
}

export async function runMonthlyBillingAutomation(input: {
  companyId?: string | null
  billingMonth?: string | null
  actorUserId?: string | null
  targetSystem?: string | null
  exportFormat?: string | null
  sendToPartner?: boolean
} = {}) {
  const companyIds = await listBillingAutomationCompanyIds(input.companyId)
  const results: MonthlyBillingAutomationCompanyResult[] = []
  for (const companyId of companyIds) {
    results.push(await runMonthlyBillingAutomationForCompany({
      companyId,
      billingMonth: input.billingMonth,
      actorUserId: input.actorUserId,
      targetSystem: input.targetSystem,
      exportFormat: input.exportFormat,
      sendToPartner: input.sendToPartner,
    }))
  }

  return {
    ok: results.every((result) => result.status !== 'failed'),
    billingMonth: text(input.billingMonth) ?? currentBillingMonth(),
    companies: companyIds.length,
    results,
  }
}
