import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'

export type Batch2BRunResult = {
  companyId: string
  customersScanned: number
  tasksCreated: number
  requestsCreated: number
  casesCreated: number
  exportsCreated: number
  blockersFound: number
  notes: string[]
}

export type Batch2BControlTowerRow = {
  company_id: string
  company_name: string | null
  company_status: string | null
  production_status: string | null
  live_ediel_enabled: boolean | null
  open_outbound_count: number | null
  open_case_count: number | null
  blocked_export_rows: number | null
  failed_import_rows: number | null
  automation_run_count: number | null
  last_automation_run_at: string | null
  updated_at: string | null
}

type CustomerContractRow = {
  id: string
  company_id: string
  customer_id: string
  site_id: string | null
  status: string | null
  starts_at: string | null
}

type CustomerSiteRow = {
  id: string
  company_id: string
  customer_id: string
  grid_owner_id: string | null
  move_in_date: string | null
}

type MeteringPointRow = {
  id: string
  company_id: string
  site_id: string | null
  meter_point_id: string | null
  grid_owner_id: string | null
  status: string | null
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

function previousMonthPeriod(): { periodMonth: string; periodStart: string; periodEnd: string; year: number; month: number } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth() + 1
  return {
    periodMonth: `${year}-${String(month).padStart(2, '0')}`,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    year,
    month,
  }
}

async function recordAutomationRun(input: Batch2BRunResult & { actorUserId: string; status?: string; metadata?: Record<string, unknown> }) {
  try {
    await supabaseService.from('operations_automation_runs').insert({
      company_id: input.companyId,
      run_type: 'batch_2b_operations',
      status: input.status ?? (input.blockersFound > 0 ? 'completed_with_flags' : 'completed'),
      customers_scanned: input.customersScanned,
      tasks_created: input.tasksCreated,
      requests_created: input.requestsCreated,
      cases_created: input.casesCreated,
      exports_created: input.exportsCreated,
      blockers_found: input.blockersFound,
      metadata: { notes: input.notes, ...(input.metadata ?? {}) },
      created_by: input.actorUserId,
    })
  } catch (error) {
    if (!isMissingRelationError(error)) throw error
  }
}

async function ensureCustomerInfoRequest(input: {
  actorUserId: string
  companyId: string
  customerId: string
  siteId: string | null
  meteringPointId?: string | null
  requestType: string
  automationKey: string
  targetPartyType?: string
  requestedDataCategories: string[]
}): Promise<boolean> {
  const { data: existing, error: existingError } = await supabaseService
    .from('customer_info_requests')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('automation_key', input.automationKey)
    .limit(1)

  if (existingError) {
    if (isMissingRelationError(existingError)) return false
    throw existingError
  }

  if ((existing ?? []).length > 0) return false

  const { error } = await supabaseService.from('customer_info_requests').insert({
    company_id: input.companyId,
    customer_id: input.customerId,
    site_id: input.siteId,
    metering_point_id: input.meteringPointId ?? null,
    request_type: input.requestType,
    target_party_type: input.targetPartyType ?? 'grid_owner',
    status: 'draft',
    requested_data_categories: input.requestedDataCategories,
    verified_payload: {},
    notes: 'Skapad av Batch 2B automationsmotor. Granska och skicka när fullmakt/rutt är klar.',
    automation_origin: 'batch_2b_operations',
    automation_key: input.automationKey,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  })

  if (error) {
    if (isMissingRelationError(error)) return false
    throw error
  }

  return true
}

async function ensureOutboundRequest(input: {
  actorUserId: string
  companyId: string
  customerId: string
  siteId: string | null
  meteringPointId: string | null
  gridOwnerId: string | null
  requestType: 'meter_values' | 'billing_underlay'
  automationKey: string
  periodStart: string
  periodEnd: string
  payload: Record<string, unknown>
}): Promise<boolean> {
  const { data: existing, error: existingError } = await supabaseService
    .from('outbound_requests')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('automation_key', input.automationKey)
    .limit(1)

  if (existingError) {
    if (isMissingRelationError(existingError)) return false
    throw existingError
  }

  if ((existing ?? []).length > 0) return false

  const { error } = await supabaseService.from('outbound_requests').insert({
    company_id: input.companyId,
    customer_id: input.customerId,
    site_id: input.siteId,
    metering_point_id: input.meteringPointId,
    grid_owner_id: input.gridOwnerId,
    request_type: input.requestType,
    source_type: 'bulk_generation',
    source_id: null,
    status: 'queued',
    channel_type: 'unresolved',
    payload: {
      ...input.payload,
      automation: 'batch_2b_operations',
      exportMode: 'row_level_not_whole_period_blocking',
    },
    response_payload: {},
    period_start: input.periodStart,
    period_end: input.periodEnd,
    automation_origin: 'batch_2b_operations',
    automation_key: input.automationKey,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  })

  if (error) {
    if (isMissingRelationError(error)) return false
    throw error
  }

  return true
}

async function createCustomerCaseForBlocker(input: {
  actorUserId: string
  companyId: string
  customerId: string
  siteId?: string | null
  meteringPointId?: string | null
  title: string
  description: string
  reasonCategory: string
  metadata: Record<string, unknown>
}): Promise<boolean> {
  const { data: existing, error: existingError } = await supabaseService
    .from('customer_cases')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('case_type', 'technical_blocker')
    .eq('status', 'billing_blocked')
    .contains('metadata', { automationKey: input.metadata.automationKey })
    .limit(1)

  if (existingError && !isMissingRelationError(existingError)) throw existingError
  if ((existing ?? []).length > 0) return false

  const { error } = await supabaseService.from('customer_cases').insert({
    company_id: input.companyId,
    customer_id: input.customerId,
    site_id: input.siteId ?? null,
    metering_point_id: input.meteringPointId ?? null,
    case_type: 'technical_blocker',
    status: 'billing_blocked',
    priority: 'high',
    title: input.title,
    description: input.description,
    reason_category: input.reasonCategory,
    billing_blocked: true,
    billing_manual_review: true,
    next_action: 'Granska blockeraren, komplettera saknad data och kör exporten igen för endast berörd rad.',
    source: 'batch_2b_operations',
    metadata: input.metadata,
    created_by: input.actorUserId,
    updated_by: input.actorUserId,
  })

  if (error) {
    if (isMissingRelationError(error)) return false
    throw error
  }

  return true
}

export async function listBatch2BControlTower(companyId?: string | null): Promise<Batch2BControlTowerRow[]> {
  let query = supabaseService
    .from('gridex_batch_2b_live_control_tower_v')
    .select('*')
    .order('updated_at', { ascending: false })

  if (companyId) query = query.eq('company_id', companyId)

  const { data, error } = await query
  if (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }

  return (data ?? []) as Batch2BControlTowerRow[]
}

export async function runBatch2BAutomation(input: {
  companyId: string
  actorUserId: string
  periodMonth?: string | null
}): Promise<Batch2BRunResult> {
  await requireCompanyOperationalForWrites(input.companyId)

  const period = previousMonthPeriod()
  const notes: string[] = []
  let customersScanned = 0
  let tasksCreated = 0
  let requestsCreated = 0
  let casesCreated = 0
  let exportsCreated = 0
  let blockersFound = 0

  const { data: contracts, error: contractsError } = await supabaseService
    .from('customer_contracts')
    .select('id, company_id, customer_id, site_id, status, starts_at')
    .eq('company_id', input.companyId)
    .in('status', ['signed', 'active', 'pending_signature'])
    .limit(250)

  if (contractsError) throw contractsError
  const contractRows = (contracts ?? []) as CustomerContractRow[]
  customersScanned = new Set(contractRows.map((row) => row.customer_id)).size

  for (const contract of contractRows) {
    const key = `contract-onboarding:${contract.id}`
    const created = await ensureCustomerInfoRequest({
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      customerId: contract.customer_id,
      siteId: contract.site_id,
      requestType: 'customer_onboarding',
      automationKey: key,
      targetPartyType: 'grid_owner',
      requestedDataCategories: ['grid_owner_data', 'metering_data', 'current_supplier_contract'],
    })
    if (created) {
      requestsCreated += 1
      tasksCreated += 1
    }
  }

  const { data: sitesData, error: sitesError } = await supabaseService
    .from('customer_sites')
    .select('id, company_id, customer_id, grid_owner_id, move_in_date')
    .eq('company_id', input.companyId)
    .limit(500)
  if (sitesError) throw sitesError

  const sites = (sitesData ?? []) as CustomerSiteRow[]
  const sitesById = new Map(sites.map((site) => [site.id, site]))
  const { data: pointsData, error: pointsError } = await supabaseService
    .from('metering_points')
    .select('id, company_id, site_id, meter_point_id, grid_owner_id, status')
    .eq('company_id', input.companyId)
    .limit(1000)
  if (pointsError) throw pointsError

  const meteringPoints = (pointsData ?? []) as MeteringPointRow[]
  const pointIds = meteringPoints.map((point) => point.id).filter(Boolean)

  let existingMeteringPointIds = new Set<string>()
  if (pointIds.length > 0) {
    const { data: valuesData, error: valuesError } = await supabaseService
      .from('metering_values')
      .select('metering_point_id')
      .eq('company_id', input.companyId)
      .gte('period_start', period.periodStart)
      .lt('period_start', period.periodEnd)
      .in('metering_point_id', pointIds)

    if (valuesError && !isMissingRelationError(valuesError)) throw valuesError
    existingMeteringPointIds = new Set(((valuesData ?? []) as Array<{ metering_point_id: string | null }>).map((row) => row.metering_point_id).filter((value): value is string => Boolean(value)))
  }

  for (const point of meteringPoints) {
    if (existingMeteringPointIds.has(point.id)) continue
    const site = point.site_id ? sitesById.get(point.site_id) : null
    if (!site) {
      blockersFound += 1
      continue
    }

    const created = await ensureOutboundRequest({
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      customerId: site.customer_id,
      siteId: site.id,
      meteringPointId: point.id,
      gridOwnerId: point.grid_owner_id ?? site.grid_owner_id ?? null,
      requestType: 'meter_values',
      automationKey: `missing-meter-values:${point.id}:${period.periodMonth}`,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      payload: {
        periodMonth: period.periodMonth,
        meterPointId: point.meter_point_id,
      },
    })
    if (created) requestsCreated += 1
  }

  const { data: blockedItems, error: blockedItemsError } = await supabaseService
    .from('billing_export_run_items')
    .select('id, company_id, billing_underlay_id, customer_id, site_id, metering_point_id, blocker_reasons')
    .eq('company_id', input.companyId)
    .eq('status', 'blocked')
    .limit(200)

  if (blockedItemsError && !isMissingRelationError(blockedItemsError)) throw blockedItemsError

  for (const item of (blockedItems ?? []) as Array<{ id: string; customer_id: string | null; site_id: string | null; metering_point_id: string | null; billing_underlay_id: string | null; blocker_reasons?: unknown }>) {
    if (!item.customer_id) continue
    blockersFound += 1
    const created = await createCustomerCaseForBlocker({
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      customerId: item.customer_id,
      siteId: item.site_id,
      meteringPointId: item.metering_point_id,
      title: 'Faktureringsrad blockerad',
      description: 'En faktureringsrad är blockerad. Raden stoppar inte hela exporten, men behöver åtgärdas innan den kan skickas vidare.',
      reasonCategory: 'billing_export_blocker',
      metadata: {
        automationKey: `billing-export-blocker:${item.id}`,
        billingExportRunItemId: item.id,
        billingUnderlayId: item.billing_underlay_id,
        blockerReasons: item.blocker_reasons ?? [],
      },
    })
    if (created) casesCreated += 1
  }

  if (requestsCreated === 0 && casesCreated === 0) {
    notes.push('Inga nya automationsrader skapades. Befintliga requests/cases eller komplett data kan redan finnas.')
  }

  const result: Batch2BRunResult = {
    companyId: input.companyId,
    customersScanned,
    tasksCreated,
    requestsCreated,
    casesCreated,
    exportsCreated,
    blockersFound,
    notes,
  }

  await recordAutomationRun({ ...result, actorUserId: input.actorUserId })
  return result
}

export async function createBillingBlockerCasesForCompany(input: {
  companyId: string
  actorUserId: string
}): Promise<{ casesCreated: number; blockersFound: number }> {
  const result = await runBatch2BAutomation(input)
  return { casesCreated: result.casesCreated, blockersFound: result.blockersFound }
}
