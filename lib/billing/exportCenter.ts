import { supabaseService } from '@/lib/supabase/service'
import type { BillingUnderlayRow, MeteringValueRow, PartnerExportRow } from '@/lib/cis/types'
import { buildBillingReadinessMap } from '@/lib/cis/billingReadiness'
import { listAllBillingUnderlays, listAllMeteringValues, listAllPartnerExports } from '@/lib/cis/db'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { createPartnerExport } from '@/lib/cis/db-data'
import { calculatePricingForBillingUnderlay, listPricingComponentRules } from '@/lib/billing/pricingEngine'

export type BillingExportRunRow = {
  id: string
  company_id: string
  period_month: string
  target_system: string
  export_format: string
  status: string
  rows_total: number
  rows_ready: number
  rows_blocked: number
  rows_exported: number
  blocker_summary: Array<Record<string, unknown>>
  created_at: string
  created_by: string | null
}

export type BillingExportCenterData = {
  underlays: BillingUnderlayRow[]
  meterValues: MeteringValueRow[]
  partnerExports: PartnerExportRow[]
  exportRuns: BillingExportRunRow[]
}

function isMissingRelationError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? ''))
  )
}

export async function listBillingExportRuns(companyId: string): Promise<BillingExportRunRow[]> {
  try {
    const { data, error } = await supabaseService
      .from('billing_export_runs')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(40)

    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }

    return (data ?? []) as BillingExportRunRow[]
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

export async function getBillingExportCenterData(companyId: string): Promise<BillingExportCenterData> {
  const [underlays, meterValues, partnerExports, exportRuns] = await Promise.all([
    listAllBillingUnderlays({ companyId, status: 'all' }),
    listAllMeteringValues({ companyId }),
    listAllPartnerExports({ companyId, status: 'all' }),
    listBillingExportRuns(companyId),
  ])

  return { underlays, meterValues, partnerExports, exportRuns }
}

export async function createBillingExportRun(input: {
  companyId: string
  actorUserId: string
  periodMonth: string
  targetSystem: string
  exportFormat: string
}) {
  await requireCompanyOperationalForWrites(input.companyId)

  const [underlays, meterValues, partnerExports, pricingRules] = await Promise.all([
    listAllBillingUnderlays({ companyId: input.companyId, status: 'all' }),
    listAllMeteringValues({ companyId: input.companyId }),
    listAllPartnerExports({ companyId: input.companyId, status: 'all' }),
    listPricingComponentRules(input.companyId),
  ])

  const [year, month] = input.periodMonth.split('-').map((part) => Number(part))
  const periodUnderlays = underlays.filter((underlay) => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) return true
    return underlay.underlay_year === year && underlay.underlay_month === month
  })

  const readiness = buildBillingReadinessMap({ underlays: periodUnderlays, meterValues, partnerExports })
  const items = periodUnderlays.map((underlay) => {
    const result = readiness.get(underlay.id)
    const pricing = calculatePricingForBillingUnderlay({ underlay, rules: pricingRules })
    const pricingWarnings = pricing.warnings.map((warning) => ({
      code: 'pricing_warning',
      severity: 'warning',
      title: 'Prismotor behöver granskning',
      description: warning,
    }))
    const blockerReasons = [...(result?.issues ?? []), ...pricingWarnings]

    return {
      company_id: input.companyId,
      billing_underlay_id: underlay.id,
      customer_id: underlay.customer_id,
      site_id: underlay.site_id,
      metering_point_id: underlay.metering_point_id,
      status: result?.isExportable ? 'ready' : 'blocked',
      readiness_status: result?.status ?? 'blocked',
      blocker_reasons: blockerReasons,
      payload_snapshot: {
        underlay,
        readiness: result,
        pricing,
        exportContract: {
          version: 'billing_export_v2',
          periodMonth: input.periodMonth,
          targetSystem: input.targetSystem,
          exportFormat: input.exportFormat,
        },
      },
    }
  })

  const rowsReady = items.filter((item) => item.status === 'ready').length
  const rowsBlocked = items.filter((item) => item.status === 'blocked').length
  const blockerSummary = items
    .filter((item) => item.status === 'blocked')
    .slice(0, 40)
    .map((item) => ({ billing_underlay_id: item.billing_underlay_id, issues: item.blocker_reasons }))

  const { data: run, error } = await supabaseService
    .from('billing_export_runs')
    .insert({
      company_id: input.companyId,
      period_month: input.periodMonth,
      target_system: input.targetSystem,
      export_format: input.exportFormat,
      status: rowsReady > 0 ? 'ready_with_flags' : 'blocked',
      rows_total: items.length,
      rows_ready: rowsReady,
      rows_blocked: rowsBlocked,
      rows_exported: 0,
      blocker_summary: blockerSummary,
      created_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error

  if (items.length > 0) {
    const { error: itemError } = await supabaseService
      .from('billing_export_run_items')
      .insert(items.map((item) => ({ ...item, billing_export_run_id: run.id })))

    if (itemError) throw itemError
  }

  return run as BillingExportRunRow
}


export async function queueReadyBillingExportRunItems(input: {
  companyId: string
  actorUserId: string
  exportRunId: string
}): Promise<{ queued: number; blocked: number }> {
  await requireCompanyOperationalForWrites(input.companyId)

  const { data: run, error: runError } = await supabaseService
    .from('billing_export_runs')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('id', input.exportRunId)
    .maybeSingle()

  if (runError) throw runError
  if (!run) throw new Error('Exportkörningen hittades inte för valt bolag.')

  const { data: items, error: itemError } = await supabaseService
    .from('billing_export_run_items')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('billing_export_run_id', input.exportRunId)
    .eq('status', 'ready')

  if (itemError) throw itemError

  const readyItems = (items ?? []) as Array<{
    id: string
    customer_id: string | null
    site_id: string | null
    metering_point_id: string | null
    billing_underlay_id: string | null
    payload_snapshot: Record<string, unknown>
  }>

  let queued = 0

  for (const item of readyItems) {
    if (!item.customer_id) continue

    await createPartnerExport({
      actorUserId: input.actorUserId,
      customerId: item.customer_id,
      siteId: item.site_id,
      meteringPointId: item.metering_point_id,
      billingUnderlayId: item.billing_underlay_id,
      exportKind: 'billing_underlay',
      targetSystem: String((run as BillingExportRunRow).target_system ?? 'billing_partner'),
      exportBatchKey: input.exportRunId,
      externalReference: `BILLING-${input.exportRunId.slice(0, 8).toUpperCase()}-${queued + 1}`,
      payload: {
        exportRunId: input.exportRunId,
        exportRunItemId: item.id,
        ...(item.payload_snapshot ?? {}),
      },
    })

    queued += 1
  }

  const blocked = Math.max(0, Number((run as BillingExportRunRow).rows_blocked ?? 0))

  const { error: updateError } = await supabaseService
    .from('billing_export_runs')
    .update({
      status: queued > 0 ? 'sent' : 'blocked',
      rows_exported: queued,
      updated_at: new Date().toISOString(),
      metadata: {
        ...(((run as { metadata?: Record<string, unknown> }).metadata) ?? {}),
        queuedPartnerExportsAt: new Date().toISOString(),
        queuedPartnerExportsCount: queued,
      },
    })
    .eq('company_id', input.companyId)
    .eq('id', input.exportRunId)

  if (updateError) throw updateError

  return { queued, blocked }
}
