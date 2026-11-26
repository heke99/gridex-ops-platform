import { scanMeteringPeriodPoints } from '@/lib/operations/meteringPeriodScan'
import { createBillingExportBlockerTasks } from '@/lib/billing/exportBlockerTasks'
import { createCustomerInfoRequestWithReceipt } from '@/lib/onboarding/infoRequests'
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
  customer_id: string | null
  site_id: string | null
}

async function readOnboardingContracts(companyId: string): Promise<CustomerContractRow[]> {
  const contracts: CustomerContractRow[] = []
  let after: string | undefined

  for (;;) {
    let query = supabaseService
      .from('customer_contracts')
      .select('id, customer_id, site_id')
      .eq('company_id', companyId)
      .in('status', ['signed', 'active', 'pending_signature'])
      .order('id')
      .limit(250)
    if (after) query = query.gt('id', after)

    const { data, error } = await query
    if (error) throw error
    if (!data?.length) return contracts
    for (const contract of data) {
      if (!contract.id || (after && contract.id <= after)) {
        throw new Error('Avtalsurvalet för grundautomation har ogiltig sortering.')
      }
      contracts.push(contract)
      after = contract.id
    }
  }
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

function previousMonthStart(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
}

async function recordAutomationRun(input: Batch2BRunResult & { actorUserId: string; status?: string; runType?: string; metadata?: Record<string, unknown> }) {
  const { error } = await supabaseService.from('operations_automation_runs').insert({
    company_id: input.companyId,
    run_type: input.runType ?? 'batch_2b_operations',
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
  if (error) throw new Error('Körhistoriken kunde inte sparas.', { cause: error })
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
  // Same entry point as every other caller: tenant anchors are validated and
  // the automation key makes repeated runs return the existing request.
  const before = await supabaseService
    .from('customer_info_requests')
    .select('id')
    .eq('company_id', input.companyId)
    .eq('automation_key', input.automationKey)
    .limit(1)
  if (before.error) throw before.error
  if ((before.data ?? []).length > 0) return false
  const receipt = await createCustomerInfoRequestWithReceipt({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    customerId: input.customerId,
    siteId: input.siteId,
    meteringPointId: input.meteringPointId ?? null,
    requestType: input.requestType,
    targetPartyType: input.targetPartyType ?? 'grid_owner',
    requestedDataCategories: input.requestedDataCategories,
    notes: 'Skapad av Batch 2B automationsmotor. Granska och skicka när fullmakt/rutt är klar.',
    automationKey: input.automationKey,
    automationOrigin: 'batch_2b_operations',
  })
  return receipt.created
}

async function prepareMeteringRequest(
  input: { companyId: string; actorUserId: string },
  pointId: string,
  monthStart: string,
): Promise<{ created: boolean; scopeMissing: boolean }> {
  const db = supabaseService as unknown as {
    rpc(
      name: 'gridex_prepare_batch2b_metering_request_v1',
      args: { p_company_id: string; p_point_id: string; p_month_start: string; p_actor_user_id: string },
    ): PromiseLike<{ data: {
      pointId?: unknown; periodMonth?: unknown; outcome?: unknown; reason?: unknown;
      requestCreated?: unknown; caseCreated?: unknown; caseRequestLinked?: unknown;
    } | null; error: unknown }>
  }
  const { data, error } = await db.rpc('gridex_prepare_batch2b_metering_request_v1', {
    p_company_id: input.companyId,
    p_point_id: pointId,
    p_month_start: monthStart,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw new Error('Begäran om mätvärden kunde inte förberedas.', { cause: error })
  if (!data || data.pointId !== pointId || data.periodMonth !== monthStart.slice(0, 7)
    || data.caseCreated !== false || data.caseRequestLinked !== false || typeof data.requestCreated !== 'boolean'
    || (data.outcome !== 'linked' && data.outcome !== 'held' && data.outcome !== 'case_closed')
    || (data.outcome !== 'linked' && data.requestCreated)) {
    throw new Error('Körkvittot för mätvärdesbegäran är ogiltigt.')
  }
  return { created: data.requestCreated, scopeMissing: data.reason === 'metering_scope_unavailable' }
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

  const monthStart = previousMonthStart()
  const notes: string[] = []
  let tasksCreated = 0
  let requestsCreated = 0
  let meteringBlockersFound = 0
  const exportsCreated = 0

  const { data: canPrepareOnboarding, error: onboardingAccessError } = await supabaseService.rpc(
    'gridex_actor_has_company_permission',
    { p_actor_user_id: input.actorUserId, p_company_id: input.companyId, p_permission: 'customers.write' },
  )
  if (onboardingAccessError) throw onboardingAccessError
  const contractRows = canPrepareOnboarding === true ? await readOnboardingContracts(input.companyId) : []
  const customersScanned = new Set(contractRows.flatMap((row) => row.customer_id ? [row.customer_id] : [])).size
  let unboundContractsFound = 0

  for (const contract of contractRows) {
    if (!contract.customer_id) {
      unboundContractsFound += 1
      continue
    }
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

  const { pointsWithGaps } = await scanMeteringPeriodPoints({
    companyId: input.companyId,
    monthStarts: [monthStart],
    includeUnlinked: true,
  })
  for (const point of pointsWithGaps) {
    if (!point.site_id || !point.customer_id) {
      meteringBlockersFound += 1
      continue
    }
    const effect = await prepareMeteringRequest(input, point.point_id, monthStart)
    if (effect.created) requestsCreated += 1
    if (effect.scopeMissing) meteringBlockersFound += 1
  }

  const { casesCreated, blockersFound: billingBlockersFound } = await createBillingExportBlockerTasks(input)
  const blockersFound = unboundContractsFound + meteringBlockersFound + billingBlockersFound

  if (requestsCreated === 0 && casesCreated === 0) {
    notes.push('Inga nya automationsrader skapades. Befintliga befintliga requests/uppgifter eller komplett data kan redan finnas.')
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
  await requireCompanyOperationalForWrites(input.companyId)
  const result = await createBillingExportBlockerTasks(input)
  await recordAutomationRun({
    ...input,
    ...result,
    runType: 'batch_2b_billing_blocker_cases',
    customersScanned: 0,
    tasksCreated: 0,
    requestsCreated: 0,
    exportsCreated: 0,
    notes: [],
  })
  return result
}
