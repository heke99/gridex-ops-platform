import { supabaseService } from '@/lib/supabase/service'
import type { BillingUnderlayRow, MeteringValueRow, PartnerExportRow } from '@/lib/cis/types'
import { buildBillingReadinessMap } from '@/lib/cis/billingReadiness'
import { listAllBillingUnderlays, listAllMeteringValues, listAllPartnerExports } from '@/lib/cis/db'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'

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

  const [underlays, meterValues, partnerExports] = await Promise.all([
    listAllBillingUnderlays({ companyId: input.companyId, status: 'all' }),
    listAllMeteringValues({ companyId: input.companyId }),
    listAllPartnerExports({ companyId: input.companyId, status: 'all' }),
  ])

  const [year, month] = input.periodMonth.split('-').map((part) => Number(part))
  const periodUnderlays = underlays.filter((underlay) => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) return true
    return underlay.underlay_year === year && underlay.underlay_month === month
  })

  const readiness = buildBillingReadinessMap({ underlays: periodUnderlays, meterValues, partnerExports })
  const items = periodUnderlays.map((underlay) => {
    const result = readiness.get(underlay.id)
    return {
      company_id: input.companyId,
      billing_underlay_id: underlay.id,
      customer_id: underlay.customer_id,
      site_id: underlay.site_id,
      metering_point_id: underlay.metering_point_id,
      status: result?.isExportable ? 'ready' : 'blocked',
      readiness_status: result?.status ?? 'blocked',
      blocker_reasons: result?.issues ?? [],
      payload_snapshot: {
        underlay,
        readiness: result,
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
