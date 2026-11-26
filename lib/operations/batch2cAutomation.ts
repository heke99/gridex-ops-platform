import { scanMeteringPeriodPoints } from '@/lib/operations/meteringPeriodScan'
import { ensureBillingExportBlockerTask } from '@/lib/billing/exportBlockerTasks'
import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { updatePartnerExportStatus } from '@/lib/cis/db-data'

type MaybeDbError = { code?: string; message?: string }

export type Batch2CRlsPolicyReportRow = {
  table_name: string
  expected_scope: string
  schema_name: string | null
  rls_enabled: boolean | null
  rls_forced: boolean | null
  has_company_id: boolean | null
  policy_count: number | null
  policies: Array<Record<string, unknown>> | null
  verification_status: 'ok' | 'missing_table' | 'rls_disabled' | 'missing_policy' | 'missing_company_scope' | string
}

export type Batch2CDriftQueueRow = {
  queue_type: string
  company_id: string
  source_id: string
  customer_id: string | null
  site_id: string | null
  metering_point_id: string | null
  severity: 'info' | 'warning' | 'critical' | string
  status: string
  title: string
  description: string | null
  created_at: string
  updated_at: string
  payload: Record<string, unknown>
}

export type Batch2CSummaryRow = {
  company_id: string
  company_name: string | null
  open_queue_count: number | null
  critical_queue_count: number | null
  open_metering_gap_count: number | null
  blocked_export_row_count: number | null
  open_external_intake_count: number | null
  open_portal_completion_count: number | null
  production_status: string | null
  live_ediel_enabled: boolean | null
  updated_at: string | null
}

export type Batch2CPeriodMotorResult = {
  companyId: string
  periodsChecked: string[]
  meteringPointsScanned: number
  gapsCreated: number
  outboundRequestsCreated: number
  casesCreated: number
  notes: string[]
}

export function isMissingRelationError(error: unknown): boolean {
  const maybe = error as MaybeDbError | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        maybe.code === 'PGRST204' ||
        /does not exist|schema cache|relation .* does not exist|could not find/i.test(maybe.message ?? ''))
  )
}

function monthStart(value: string): Date {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value)
  if (!match || Number(match[1]) === 0 || value === '9999-12') {
    throw new Error('Ogiltig månad för periodmotorn. Ange en månad i formatet ÅÅÅÅ-MM.')
  }
  return new Date(`${value}-01T00:00:00.000Z`)
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime())
  result.setUTCMonth(result.getUTCMonth() + months)
  return result
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function defaultPeriodRange(): { startMonth: string; endMonth: string } {
  const now = new Date()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const start = addMonths(end, -11)
  return { startMonth: monthKey(start), endMonth: monthKey(end) }
}

function enumeratePeriods(input?: { startMonth?: string | null; endMonth?: string | null; periodMonths?: string[] | null }): Array<{ month: string; start: string; end: string }> {
  if (input?.periodMonths?.length) {
    const months = Array.from(new Set(input.periodMonths.map((month) => month.trim()))).sort()
    if (months.length > 36) throw new Error('Periodmotorn kan köra högst 36 månader åt gången.')
    return months.map((month) => {
      const start = monthStart(month)
      return { month, start: isoDate(start), end: isoDate(addMonths(start, 1)) }
    })
  }

  const defaults = defaultPeriodRange()
  const start = monthStart(input?.startMonth?.trim() ?? defaults.startMonth)
  const end = monthStart(input?.endMonth?.trim() ?? defaults.endMonth)
  if (start > end) throw new Error('Periodmotorns slutmånad får inte ligga före startmånaden.')
  if (addMonths(start, 36) <= end) throw new Error('Periodmotorn kan köra högst 36 månader åt gången.')
  const periods: Array<{ month: string; start: string; end: string }> = []
  let cursor = start
  while (cursor <= end) {
    periods.push({ month: monthKey(cursor), start: isoDate(cursor), end: isoDate(addMonths(cursor, 1)) })
    cursor = addMonths(cursor, 1)
  }
  return periods
}

async function insertAutomationRun(input: {
  companyId: string
  actorUserId: string
  runType: string
  status: string
  metadata: Record<string, unknown>
  customersScanned?: number
  tasksCreated?: number
  requestsCreated?: number
  casesCreated?: number
  exportsCreated?: number
  blockersFound?: number
}) {
  const { error } = await supabaseService.from('operations_automation_runs').insert({
    company_id: input.companyId,
    run_type: input.runType,
    status: input.status,
    customers_scanned: input.customersScanned ?? 0,
    tasks_created: input.tasksCreated ?? 0,
    requests_created: input.requestsCreated ?? 0,
    cases_created: input.casesCreated ?? 0,
    exports_created: input.exportsCreated ?? 0,
    blockers_found: input.blockersFound ?? 0,
    metadata: input.metadata,
    created_by: input.actorUserId,
  })
  if (error) throw new Error('Körhistoriken kunde inte sparas.', { cause: error })
}

async function reconcileMeteringPeriodGap(
  input: { companyId: string; actorUserId: string },
  gapId: string,
  mode: 'motor' | 'case_only',
): Promise<{ requestCreated: boolean; caseCreated: boolean }> {
  const db = supabaseService as unknown as {
    rpc(
      name: 'gridex_reconcile_metering_period_gap_v1',
      args: { p_company_id: string; p_gap_id: string; p_actor_user_id: string; p_mode: 'motor' | 'case_only' },
    ): PromiseLike<{
      data: { outcome?: unknown; gapId?: unknown; requestCreated?: unknown; caseCreated?: unknown } | null
      error: unknown
    }>
  }
  const { data, error } = await db.rpc('gridex_reconcile_metering_period_gap_v1', {
    p_company_id: input.companyId,
    p_gap_id: gapId,
    p_actor_user_id: input.actorUserId,
    p_mode: mode,
  })
  if (error) throw new Error('Mätvärdesluckans begäran och ärende kunde inte hanteras.', { cause: error })
  if (!data || data.gapId !== gapId || typeof data.requestCreated !== 'boolean' || typeof data.caseCreated !== 'boolean'
    || (data.outcome !== 'linked' && data.outcome !== 'held' && data.outcome !== 'case_closed')
    || (mode === 'case_only' && data.requestCreated)) {
    throw new Error('Mätvärdesluckans körkvitto är ogiltigt.')
  }
  return { requestCreated: data.requestCreated, caseCreated: data.caseCreated }
}

async function reconcilePartnerExportCase(
  input: { companyId: string; actorUserId: string },
  exportId: string,
): Promise<boolean> {
  const db = supabaseService as unknown as {
    rpc(
      name: 'gridex_reconcile_partner_export_case_v1',
      args: { p_company_id: string; p_export_id: string; p_actor_user_id: string },
    ): PromiseLike<{ data: { outcome?: unknown; partnerExportId?: unknown; caseCreated?: unknown } | null; error: unknown }>
  }
  const { data, error } = await db.rpc('gridex_reconcile_partner_export_case_v1', {
    p_company_id: input.companyId,
    p_export_id: exportId,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw new Error('Partnerexportens uppföljning kunde inte hanteras.', { cause: error })
  if (!data || data.partnerExportId !== exportId || typeof data.caseCreated !== 'boolean'
    || (data.outcome !== 'linked' && data.outcome !== 'held')
    || (data.outcome === 'held' && data.caseCreated)) {
    throw new Error('Partnerexportens körkvitto är ogiltigt.')
  }
  return data.caseCreated
}

export async function listBatch2CRlsPolicyReport(): Promise<Batch2CRlsPolicyReportRow[]> {
  const { data, error } = await supabaseService
    .from('gridex_batch_2c_rls_policy_report_v')
    .select('*')
    .order('verification_status', { ascending: true })
    .order('table_name', { ascending: true })

  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }

  return (data ?? []) as Batch2CRlsPolicyReportRow[]
}

export async function listBatch2CDriftQueue(companyId?: string | null): Promise<Batch2CDriftQueueRow[]> {
  let query = supabaseService
    .from('gridex_batch_2c_drift_queue_v')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(200)

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
  return (data ?? []) as Batch2CDriftQueueRow[]
}

export async function listBatch2CControlTowerSummary(companyId?: string | null): Promise<Batch2CSummaryRow[]> {
  let query = supabaseService
    .from('gridex_batch_2c_control_tower_summary_v')
    .select('*')
    .order('critical_queue_count', { ascending: false })
    .order('open_queue_count', { ascending: false })

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
  return (data ?? []) as Batch2CSummaryRow[]
}

export async function runBatch2CPeriodMotor(input: {
  companyId: string
  actorUserId: string
  startMonth?: string | null
  endMonth?: string | null
  periodMonths?: string[] | null
}): Promise<Batch2CPeriodMotorResult> {
  await requireCompanyOperationalForWrites(input.companyId)

  const periods = enumeratePeriods(input)
  const { pointsWithGaps, meteringPointsScanned } = await scanMeteringPeriodPoints({
    companyId: input.companyId,
    monthStarts: periods.map((period) => period.start),
    includeUnlinked: false,
  })

  let gapsCreated = 0
  let outboundRequestsCreated = 0
  let casesCreated = 0

  for (const point of pointsWithGaps) {
    const customerId = point.customer_id
    if (!customerId || !point.site_id) continue

    const missingMonths = new Set(point.missing_months)
    for (const period of periods) {
      if (!missingMonths.has(period.start)) continue

      const { data: newGap, error: gapError } = await supabaseService
        .from('metering_period_gaps')
        .upsert({
          company_id: input.companyId,
          customer_id: customerId,
          site_id: point.site_id,
          metering_point_id: point.point_id,
          grid_owner_id: point.grid_owner_id,
          period_month: period.month,
          period_start: period.start,
          period_end: period.end,
          status: 'open',
          severity: 'warning',
          metadata: {
            meterPointId: point.meter_point_id,
            siteFacilityId: point.facility_id,
            detectedBy: 'batch_2c_period_motor',
          },
          created_by: input.actorUserId,
        }, { onConflict: 'company_id,metering_point_id,period_month', ignoreDuplicates: true })
        .select('id')
        .maybeSingle()

      if (gapError) throw gapError
      if (newGap) gapsCreated += 1

      let gapId = newGap?.id
      if (!gapId) {
        const { data, error } = await supabaseService
          .from('metering_period_gaps')
          .select('id')
          .eq('company_id', input.companyId)
          .eq('metering_point_id', point.point_id)
          .eq('period_month', period.month)
          .single()
        if (error) throw error
        gapId = data?.id
      }
      if (!gapId) throw new Error('Mätvärdesluckan kunde inte läsas tillbaka.')

      const effect = await reconcileMeteringPeriodGap(input, gapId, 'motor')
      if (effect.requestCreated) outboundRequestsCreated += 1
      if (effect.caseCreated) casesCreated += 1
    }
  }

  const result: Batch2CPeriodMotorResult = {
    companyId: input.companyId,
    periodsChecked: periods.map((period) => period.month),
    meteringPointsScanned,
    gapsCreated,
    outboundRequestsCreated,
    casesCreated,
    notes: [],
  }

  await insertAutomationRun({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    runType: 'batch_2c_period_motor',
    status: gapsCreated > 0 ? 'completed_with_flags' : 'completed',
    requestsCreated: outboundRequestsCreated,
    casesCreated,
    blockersFound: gapsCreated,
    metadata: result,
  })

  return result
}

export async function createCasesForBatch2CQueues(input: {
  companyId: string
  actorUserId: string
}): Promise<{ casesCreated: number; queuesScanned: number }> {
  await requireCompanyOperationalForWrites(input.companyId)

  const queue = await listBatch2CDriftQueue(input.companyId)
  let casesCreated = 0

  for (const row of queue) {
    if (!row.customer_id) continue
    if (row.queue_type === 'metering_period_gap') {
      const effect = await reconcileMeteringPeriodGap(input, row.source_id, 'case_only')
      if (effect.caseCreated) casesCreated += 1
    } else if (row.queue_type === 'billing_export_item') {
      if (await ensureBillingExportBlockerTask(input, row.source_id)) casesCreated += 1
    } else if (row.queue_type === 'partner_export') {
      if (await reconcilePartnerExportCase(input, row.source_id)) casesCreated += 1
    }
  }

  await insertAutomationRun({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    runType: 'batch_2c_queue_cases',
    status: casesCreated > 0 ? 'completed_with_flags' : 'completed',
    casesCreated,
    blockersFound: queue.length,
    metadata: { queuesScanned: queue.length },
  })

  return { casesCreated, queuesScanned: queue.length }
}

export async function resolveBatch2CQueueItem(input: {
  companyId: string
  actorUserId: string
  queueType: string
  sourceId: string
}): Promise<void> {
  await requireCompanyOperationalForWrites(input.companyId)
  const now = new Date().toISOString()

  if (input.queueType === 'metering_period_gap') {
    const { data, error } = await supabaseService
      .from('metering_period_gaps')
      .update({ status: 'resolved', resolved_at: now, resolved_by: input.actorUserId, updated_at: now })
      .eq('company_id', input.companyId)
      .eq('id', input.sourceId)
      .in('status', ['open', 'request_queued', 'waiting_for_data', 'failed'])
      .select('id')
      .maybeSingle()
    if (error) throw new Error('Mätvärdesluckan kunde inte markeras som hanterad.', { cause: error })
    if (!data) throw new Error('Mätvärdesluckan är inte längre tillgänglig för åtgärden.')
  } else if (input.queueType === 'billing_export_item') {
    throw new Error('Öppna fakturaunderlaget för att hantera blockeringen. Exportens status följer fakturaflödet.')
  } else if (input.queueType === 'partner_export') {
    const { data, error } = await supabaseService
      .from('partner_exports')
      .select('customer_id,status')
      .eq('company_id', input.companyId)
      .eq('id', input.sourceId)
      .maybeSingle()
    if (error) throw error
    if (!data?.customer_id) throw new Error('Partnerexporten hittades inte för valt bolag.')
    if (data.status === 'queued') throw new Error('Partnerexporten är redan köad.')
    await updatePartnerExportStatus({
      actorUserId: input.actorUserId, companyId: input.companyId, customerId: data.customer_id,
      exportId: input.sourceId, originalStatus: data.status, changes: { status: 'queued', failure_reason: null },
    })
  } else if (input.queueType === 'external_contract_intake') {
    await supabaseService
      .from('external_contract_intakes')
      .update({ status: 'needs_review', updated_at: now })
      .eq('company_id', input.companyId)
      .eq('id', input.sourceId)
  } else if (input.queueType === 'customer_case') {
    await supabaseService
      .from('customer_cases')
      .update({ status: 'resolved', resolved_at: now, updated_at: now, updated_by: input.actorUserId })
      .eq('company_id', input.companyId)
      .eq('id', input.sourceId)
  }

  await insertAutomationRun({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    runType: 'batch_2c_resolve_queue_item',
    status: 'completed',
    metadata: { queueType: input.queueType, sourceId: input.sourceId },
  })
}
