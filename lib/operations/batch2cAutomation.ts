import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'

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

type SiteRow = {
  id: string
  company_id: string
  customer_id: string
  grid_owner_id: string | null
  facility_id?: string | null
  status?: string | null
}

type MeteringPointRow = {
  id: string
  company_id: string
  site_id: string | null
  meter_point_id: string | null
  grid_owner_id: string | null
  status: string | null
}

export function isMissingRelationError(error: unknown): boolean {
  const maybe = error as MaybeDbError | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist/i.test(maybe.message ?? ''))
  )
}

function monthStart(value: string): Date | null {
  if (!/^\d{4}-\d{2}$/.test(value)) return null
  const [year, month] = value.split('-').map(Number)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  return new Date(Date.UTC(year, month - 1, 1))
}

function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1))
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
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
    return Array.from(new Set(input.periodMonths))
      .map((raw) => raw.trim())
      .filter((raw) => /^\d{4}-\d{2}$/.test(raw))
      .map((raw) => {
        const start = monthStart(raw) as Date
        return { month: raw, start: isoDate(start), end: isoDate(addMonths(start, 1)) }
      })
  }

  const defaults = defaultPeriodRange()
  const start = monthStart(input?.startMonth ?? defaults.startMonth) ?? (monthStart(defaults.startMonth) as Date)
  const end = monthStart(input?.endMonth ?? defaults.endMonth) ?? (monthStart(defaults.endMonth) as Date)
  const periods: Array<{ month: string; start: string; end: string }> = []
  let cursor = start
  let guard = 0
  while (cursor <= end && guard < 36) {
    periods.push({ month: monthKey(cursor), start: isoDate(cursor), end: isoDate(addMonths(cursor, 1)) })
    cursor = addMonths(cursor, 1)
    guard += 1
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
  try {
    await supabaseService.from('operations_automation_runs').insert({
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
  } catch (error) {
    if (!isMissingRelationError(error)) throw error
  }
}

async function ensureOutboundForGap(input: {
  actorUserId: string
  companyId: string
  customerId: string
  siteId: string | null
  meteringPointId: string
  gridOwnerId: string | null
  periodMonth: string
  periodStart: string
  periodEnd: string
  meterPointId: string | null
}): Promise<string | null> {
  const automationKey = `batch2c:meter-values:${input.meteringPointId}:${input.periodMonth}`
  const { data: existing, error: existingError } = await supabaseService
    .from('outbound_requests')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('automation_key', automationKey)
    .limit(1)

  if (existingError) {
    if (isMissingRelationError(existingError)) return null
    throw existingError
  }

  const existingId = (existing?.[0] as { id?: string } | undefined)?.id
  if (existingId) return existingId

  const { data, error } = await supabaseService
    .from('outbound_requests')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: input.siteId,
      metering_point_id: input.meteringPointId,
      grid_owner_id: input.gridOwnerId,
      request_type: 'meter_values',
      source_type: 'bulk_generation',
      source_id: null,
      status: 'queued',
      channel_type: 'unresolved',
      payload: {
        automation: 'batch_2c_period_motor',
        periodMonth: input.periodMonth,
        meterPointId: input.meterPointId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      },
      response_payload: {},
      period_start: input.periodStart,
      period_end: input.periodEnd,
      automation_origin: 'batch_2c_period_motor',
      automation_key: automationKey,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }

  return (data as { id: string }).id
}

async function ensureCase(input: {
  actorUserId: string
  companyId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  title: string
  description: string
  reasonCategory: string
  sourceTable: string
  sourceId: string
  metadata?: Record<string, unknown>
  linkedOutboundRequestId?: string | null
  linkedPartnerExportId?: string | null
  linkedMeteringGapId?: string | null
  linkedExternalIntakeId?: string | null
}): Promise<string | null> {
  const { data: existing, error: existingError } = await supabaseService
    .from('customer_cases')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('blocker_source_table', input.sourceTable)
    .eq('blocker_source_id', input.sourceId)
    .in('status', ['open', 'action_required', 'awaiting_external_response', 'billing_blocked', 'manual_follow_up'])
    .limit(1)

  if (existingError && !isMissingRelationError(existingError)) throw existingError
  const existingId = (existing?.[0] as { id?: string } | undefined)?.id
  if (existingId) return existingId

  const { data, error } = await supabaseService
    .from('customer_cases')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId,
      site_id: input.siteId ?? null,
      metering_point_id: input.meteringPointId ?? null,
      case_type: 'technical_blocker',
      status: 'action_required',
      priority: 'high',
      title: input.title,
      description: input.description,
      reason_category: input.reasonCategory,
      billing_blocked: input.reasonCategory.includes('billing') || input.sourceTable === 'billing_export_run_items',
      billing_manual_review: true,
      next_action: 'Granska underlaget, komplettera saknad data och kör om automation/export för berörd rad.',
      source: 'batch_2c_operations',
      blocker_source_table: input.sourceTable,
      blocker_source_id: input.sourceId,
      linked_outbound_request_id: input.linkedOutboundRequestId ?? null,
      linked_partner_export_id: input.linkedPartnerExportId ?? null,
      linked_metering_gap_id: input.linkedMeteringGapId ?? null,
      linked_external_intake_id: input.linkedExternalIntakeId ?? null,
      metadata: input.metadata ?? {},
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }

  return (data as { id: string }).id
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
  const notes: string[] = []
  if (periods.length === 0) notes.push('Ingen giltig period angavs.')

  const { data: sitesData, error: sitesError } = await supabaseService
    .from('customer_sites')
    .select('id, company_id, customer_id, grid_owner_id, facility_id, status')
    .eq('company_id', input.companyId)
    .limit(5000)

  if (sitesError) throw sitesError
  const sites = (sitesData ?? []) as SiteRow[]
  const sitesById = new Map(sites.map((site) => [site.id, site]))

  const { data: pointsData, error: pointsError } = await supabaseService
    .from('metering_points')
    .select('id, company_id, site_id, meter_point_id, grid_owner_id, status')
    .eq('company_id', input.companyId)
    .limit(5000)

  if (pointsError) throw pointsError
  const meteringPoints = ((pointsData ?? []) as MeteringPointRow[]).filter((point) => point.site_id && sitesById.has(point.site_id))
  const pointIds = meteringPoints.map((point) => point.id)
  const valueKeys = new Set<string>()

  if (pointIds.length > 0 && periods.length > 0) {
    const minStart = periods[0].start
    const maxEnd = periods[periods.length - 1].end
    const { data: values, error: valuesError } = await supabaseService
      .from('metering_values')
      .select('metering_point_id, period_start, read_at')
      .eq('company_id', input.companyId)
      .gte('period_start', minStart)
      .lt('period_start', maxEnd)
      .in('metering_point_id', pointIds)
      .limit(10000)

    if (valuesError && !isMissingRelationError(valuesError)) throw valuesError

    for (const row of (values ?? []) as Array<{ metering_point_id: string | null; period_start: string | null; read_at: string | null }>) {
      if (!row.metering_point_id) continue
      const source = row.period_start ?? row.read_at
      if (!source) continue
      const date = new Date(source)
      if (Number.isNaN(date.getTime())) continue
      valueKeys.add(`${row.metering_point_id}:${monthKey(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)))}`)
    }
  }

  let gapsCreated = 0
  let outboundRequestsCreated = 0
  let casesCreated = 0

  for (const point of meteringPoints) {
    const site = point.site_id ? sitesById.get(point.site_id) : null
    if (!site?.customer_id) continue

    for (const period of periods) {
      if (valueKeys.has(`${point.id}:${period.month}`)) continue

      const { data: gap, error: gapError } = await supabaseService
        .from('metering_period_gaps')
        .upsert({
          company_id: input.companyId,
          customer_id: site.customer_id,
          site_id: site.id,
          metering_point_id: point.id,
          grid_owner_id: point.grid_owner_id ?? site.grid_owner_id ?? null,
          period_month: period.month,
          period_start: period.start,
          period_end: period.end,
          status: 'open',
          severity: 'warning',
          metadata: {
            meterPointId: point.meter_point_id,
            siteFacilityId: site.facility_id ?? null,
            detectedBy: 'batch_2c_period_motor',
          },
          created_by: input.actorUserId,
        }, { onConflict: 'company_id,metering_point_id,period_month' })
        .select('id, outbound_request_id, customer_case_id')
        .single()

      if (gapError) throw gapError
      gapsCreated += 1

      const outboundRequestId = await ensureOutboundForGap({
        actorUserId: input.actorUserId,
        companyId: input.companyId,
        customerId: site.customer_id,
        siteId: site.id,
        meteringPointId: point.id,
        gridOwnerId: point.grid_owner_id ?? site.grid_owner_id ?? null,
        periodMonth: period.month,
        periodStart: period.start,
        periodEnd: period.end,
        meterPointId: point.meter_point_id,
      })

      if (outboundRequestId && !(gap as { outbound_request_id?: string | null }).outbound_request_id) {
        outboundRequestsCreated += 1
        await supabaseService
          .from('metering_period_gaps')
          .update({ status: 'request_queued', outbound_request_id: outboundRequestId, updated_at: new Date().toISOString() })
          .eq('company_id', input.companyId)
          .eq('id', (gap as { id: string }).id)
      }

      const caseId = await ensureCase({
        actorUserId: input.actorUserId,
        companyId: input.companyId,
        customerId: site.customer_id,
        siteId: site.id,
        meteringPointId: point.id,
        title: 'Saknade mätvärden',
        description: `Mätvärden saknas för ${period.month}. Perioden ska begäras eller kompletteras innan underlaget kan faktureras.`,
        reasonCategory: 'missing_meter_values',
        sourceTable: 'metering_period_gaps',
        sourceId: (gap as { id: string }).id,
        linkedOutboundRequestId: outboundRequestId,
        linkedMeteringGapId: (gap as { id: string }).id,
        metadata: { periodMonth: period.month, meterPointId: point.meter_point_id },
      })

      if (caseId && !(gap as { customer_case_id?: string | null }).customer_case_id) {
        casesCreated += 1
        await supabaseService
          .from('metering_period_gaps')
          .update({ customer_case_id: caseId, updated_at: new Date().toISOString() })
          .eq('company_id', input.companyId)
          .eq('id', (gap as { id: string }).id)
      }
    }
  }

  const result: Batch2CPeriodMotorResult = {
    companyId: input.companyId,
    periodsChecked: periods.map((period) => period.month),
    meteringPointsScanned: meteringPoints.length,
    gapsCreated,
    outboundRequestsCreated,
    casesCreated,
    notes,
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
    const caseId = await ensureCase({
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      customerId: row.customer_id,
      siteId: row.site_id,
      meteringPointId: row.metering_point_id,
      title: row.title,
      description: row.description ?? 'Blockeraren behöver granskas.',
      reasonCategory: row.queue_type,
      sourceTable: row.queue_type === 'billing_export_item' ? 'billing_export_run_items' : row.queue_type,
      sourceId: row.source_id,
      linkedMeteringGapId: row.queue_type === 'metering_period_gap' ? row.source_id : null,
      linkedPartnerExportId: row.queue_type === 'partner_export' ? row.source_id : null,
      linkedExternalIntakeId: row.queue_type === 'external_contract_intake' ? row.source_id : null,
      metadata: { queueType: row.queue_type, queuePayload: row.payload },
    })
    if (caseId) casesCreated += 1
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
    await supabaseService
      .from('metering_period_gaps')
      .update({ status: 'resolved', resolved_at: now, resolved_by: input.actorUserId, updated_at: now })
      .eq('company_id', input.companyId)
      .eq('id', input.sourceId)
  } else if (input.queueType === 'billing_export_item') {
    await supabaseService
      .from('billing_export_run_items')
      .update({ status: 'ready', export_status: 'not_queued', blocker_reasons: [], updated_at: now })
      .eq('company_id', input.companyId)
      .eq('id', input.sourceId)
  } else if (input.queueType === 'partner_export') {
    await supabaseService
      .from('partner_exports')
      .update({ status: 'queued', failure_reason: null, failed_at: null, updated_at: now, updated_by: input.actorUserId })
      .eq('company_id', input.companyId)
      .eq('id', input.sourceId)
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
