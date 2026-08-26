import { randomUUID } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { generateBillingUnderlaysForMonth } from '@/lib/billing/underlayEngine'
import { evaluateBillingMonthInvoiceReadiness } from '@/lib/billing/invoiceReadiness'
import {
  createInvoiceExportRun,
  sendInvoiceExportRun,
} from '@/lib/integrations/billing/invoiceExportCore'
import {
  calculateUnderlayPricingWithCore,
  loadLockedUnderlayPricingWithCore,
} from '@/lib/pricing/underlayPricingAdapter'
import { lockPricingPreview } from '@/lib/pricing/engine'
import { withAutomationLock } from '@/lib/automation/locks'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { assertOutboundAllowed } from '@/lib/platform/outboundFreeze'
import { parseBillingMonth, previousStockholmBillingMonth } from '@/lib/time/stockholm'

type JsonRecord = Record<string, unknown>
type MonthlyBillingAutomationStatus = 'running' | 'completed' | 'completed_with_blockers' | 'failed'

type PricingPreparationResult = {
  candidates: number
  alreadyLocked: number
  newlyLocked: number
  failed: number
  errors: Array<{ billingUnderlayId: string; error: string }>
}

export type MonthlyBillingAutomationCompanyResult = {
  companyId: string
  billingMonth: string
  status: MonthlyBillingAutomationStatus
  automationRunId: string | null
  underlayResult?: Awaited<ReturnType<typeof generateBillingUnderlaysForMonth>> | null
  pricingPreparation?: PricingPreparationResult | null
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

async function prepareLockedPricingForMonth(input: {
  companyId: string
  billingMonth: string
  actorUserId: string | null
}): Promise<PricingPreparationResult> {
  const [year, month] = input.billingMonth.split('-').map(Number)
  const { data, error } = await supabaseService
    .from('billing_underlays')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('underlay_year', year)
    .eq('underlay_month', month)
    .eq('status', 'validated')
    .eq('readiness_status', 'ready')
    .order('id', { ascending: true })

  if (error) throw error

  const result: PricingPreparationResult = {
    candidates: (data ?? []).length,
    alreadyLocked: 0,
    newlyLocked: 0,
    failed: 0,
    errors: [],
  }

  for (const row of data ?? []) {
    const billingUnderlayId = String(row.id)
    try {
      const existing = await loadLockedUnderlayPricingWithCore({
        companyId: input.companyId,
        billingUnderlayId,
      })
      if (existing?.locked) {
        result.alreadyLocked += 1
        continue
      }

      const pricing = await calculateUnderlayPricingWithCore({
        companyId: input.companyId,
        billingUnderlayId,
        persist: true,
      })
      if (pricing.status !== 'success' || !pricing.pricingRunId) {
        throw new Error(
          pricing.errors.join(' ') ||
            pricing.warnings.join(' ') ||
            'Prisberäkningen blev inte exportklar.',
        )
      }

      await lockPricingPreview({
        companyId: input.companyId,
        pricingRunId: pricing.pricingRunId,
        actorUserId: input.actorUserId,
      })

      const verified = await loadLockedUnderlayPricingWithCore({
        companyId: input.companyId,
        billingUnderlayId,
      })
      if (!verified?.locked) {
        throw new Error('Prisberäkningen kunde inte verifieras som låst.')
      }
      result.newlyLocked += 1
    } catch (pricingError) {
      result.failed += 1
      result.errors.push({
        billingUnderlayId,
        error:
          pricingError instanceof Error
            ? pricingError.message
            : 'Okänt fel vid canonical prisberäkning.',
      })
    }
  }

  return result
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
      .select('id,status,is_active,billing_automation_enabled,invoice_export_enabled,invoice_export_target_system,invoice_export_format,billing_provider_environment')
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
      .select('id,status,is_active,billing_automation_enabled,invoice_export_enabled,invoice_export_target_system,invoice_export_format,billing_provider_environment')
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
  sendToPartner?: boolean
  companyConfig?: JsonRecord | null
}): Promise<MonthlyBillingAutomationCompanyResult> {
  await assertPlatformSchemaReady()
  const periodMonth = billingMonth(input.billingMonth)
  const actorUserId = text(input.actorUserId) ?? text(process.env.GRIDEX_AUTOMATION_USER_ID)
  const company = input.companyConfig ?? (await listBillingAutomationCompanies(input.companyId))[0]
  validateCompany(company, input.sendToPartner === true)
  const targetSystem = text(company.invoice_export_target_system)
  if (!targetSystem) throw new Error('Tenant saknar canonical fakturaexportprovider.')
  const providerEnvironment = text(company.billing_provider_environment)
  if (!providerEnvironment || !['test', 'production'].includes(providerEnvironment)) {
    throw new Error('Tenant saknar canonical fakturaprovidermiljö.')
  }
  const exportFormat = text(company.invoice_export_format) ?? 'json'
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
        const pricingPreparation = await prepareLockedPricingForMonth({
          companyId: input.companyId,
          billingMonth: periodMonth,
          actorUserId,
        })
        const readiness = await evaluateBillingMonthInvoiceReadiness({
          companyId: input.companyId,
          billingMonth: periodMonth,
        })

        if (targetSystem !== 'capway_aptic') {
          throw new Error(`Fakturaexportprovidern ${targetSystem} saknar canonical invoice_export_items-adapter.`)
        }

        if (readiness.readyUnderlayCount === 0) {
          const status: MonthlyBillingAutomationStatus = 'completed_with_blockers'
          await updateAutomationRun({
            automationRunId,
            companyId: input.companyId,
            actorUserId,
            status,
            totalUnderlays: readiness.underlayCount,
            totalBlocked: readiness.underlayCount,
            totalExported: 0,
            metadata: {
              ...metadataBase,
              underlayResult,
              pricingPreparation,
              readiness,
              exportRunId: null,
              sent: false,
            },
          })
          return {
            companyId: input.companyId,
            billingMonth: periodMonth,
            status,
            automationRunId,
            underlayResult,
            pricingPreparation,
            exportRunId: null,
            queued: 0,
            blocked: readiness.underlayCount,
            skipped: 0,
            sent: false,
          }
        }

        const exportRun = await createInvoiceExportRun({
          companyId: input.companyId,
          actorUserId,
          billingMonth: periodMonth,
          provider: 'capway_aptic',
          environment: providerEnvironment as 'test' | 'production',
        })
        const queuedResult = {
          queued: exportRun.itemCount,
          blocked: exportRun.readiness.underlayCount - exportRun.readiness.readyUnderlayCount,
          skipped: exportRun.skippedAlreadyExported,
        }

        let sent: boolean | null = null
        if (input.sendToPartner === true) {
          await assertOutboundAllowed({ companyId: input.companyId, channel: 'invoice_export' })
          if ((queuedResult.blocked ?? 0) > 0 || pricingPreparation.failed > 0) {
            throw new Error('Fakturaexport blockerad eftersom fakturaunderlag eller prisberäkning kräver granskning.')
          }
          const sendResult = await sendInvoiceExportRun({
            companyId: input.companyId,
            actorUserId,
            exportRunId: exportRun.runId,
          })
          sent = sendResult.status === 'sent'
          if (!sent) throw new Error('Faktureringsportalen bekräftade inte hela exportkörningen.')
        }

        const status: MonthlyBillingAutomationStatus =
          (queuedResult.blocked ?? 0) > 0 || pricingPreparation.failed > 0
            ? 'completed_with_blockers'
            : 'completed'
        await updateAutomationRun({
          automationRunId,
          companyId: input.companyId,
          actorUserId,
          status,
          totalUnderlays: underlayResult.underlays,
          totalBlocked: queuedResult.blocked ?? 0,
          totalExported: queuedResult.queued ?? 0,
          exportConfirmed: sent === true,
          metadata: {
            ...metadataBase,
            underlayResult,
            pricingPreparation,
            readiness: exportRun.readiness,
            queuedResult,
            exportRunId: exportRun.runId,
            sent,
          },
        })
        return {
          companyId: input.companyId,
          billingMonth: periodMonth,
          status,
          automationRunId,
          underlayResult,
          pricingPreparation,
          exportRunId: exportRun.runId,
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
