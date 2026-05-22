import type { SupabaseClient } from '@supabase/supabase-js'
import type { CustomerCaseRow, CustomerCaseType } from '@/lib/customer-cases/types'
import type { SupplierSwitchRequestRow, SupplierSwitchRequestStatus } from '@/lib/operations/types'

export type SwitchLifecycleBlock = {
  source: 'customer_lifecycle_decision' | 'customer_case'
  id: string
  companyId: string | null
  customerId: string
  siteId: string | null
  meteringPointId: string | null
  decisionType: 'withdrawal' | 'rejected'
  title: string
  reason: string
  createdAt: string | null
}

const BLOCKING_CASE_TYPES = new Set<CustomerCaseType>([
  'withdrawal',
  'rejected_customer',
  'onboarding_aborted',
  'supplier_switch_aborted',
  'binding_period_too_long',
  'incorrect_identity',
  'incorrect_site_data',
  'missing_authorization',
  'credit_risk',
  'technical_blocker',
])

export const OPEN_SUPPLIER_SWITCH_STATUSES: SupplierSwitchRequestStatus[] = [
  'draft',
  'queued',
  'submitted',
  'accepted',
  'cancellation_requested',
  'cancellation_sent',
  'manual_followup_required',
]

const TERMINAL_SUPPLIER_SWITCH_STATUSES = new Set<string>([
  'completed',
  'rejected',
  'failed',
  'cancelled_before_start',
])

function databaseShapeMissing(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return Boolean(
    maybe &&
      (maybe.code === '42P01' ||
        maybe.code === '42703' ||
        maybe.code === 'PGRST205' ||
        /does not exist|schema cache|relation .* does not exist|column .* does not exist/i.test(
          maybe.message ?? ''
        ))
  )
}

function scopeMatches(block: Pick<SwitchLifecycleBlock, 'siteId' | 'meteringPointId'>, params: { siteId?: string | null; meteringPointId?: string | null }) {
  if (block.meteringPointId) return block.meteringPointId === (params.meteringPointId ?? null)
  if (block.siteId) return block.siteId === (params.siteId ?? null)
  return true
}

function statusAfterLifecycleBlock(params: {
  requestStatus: string
  block: Pick<SwitchLifecycleBlock, 'decisionType'>
}): SupplierSwitchRequestStatus {
  if (TERMINAL_SUPPLIER_SWITCH_STATUSES.has(params.requestStatus)) {
    return params.requestStatus as SupplierSwitchRequestStatus
  }

  if (params.requestStatus === 'draft' || params.requestStatus === 'queued') {
    return 'cancelled_before_start'
  }

  if (params.block.decisionType === 'withdrawal') {
    return 'cancellation_requested'
  }

  return 'manual_followup_required'
}

export function isSwitchBlockingCaseType(caseType: string | null | undefined): boolean {
  return BLOCKING_CASE_TYPES.has(String(caseType ?? '') as CustomerCaseType)
}

export function lifecycleDecisionTypeForCase(caseType: string | null | undefined): 'withdrawal' | 'rejected' | null {
  if (caseType === 'withdrawal') return 'withdrawal'
  if (isSwitchBlockingCaseType(caseType)) return 'rejected'
  return null
}

export async function createLifecycleDecisionFromCase(
  supabase: SupabaseClient,
  caseRow: CustomerCaseRow,
  actorUserId: string | null
): Promise<string | null> {
  const decisionType = lifecycleDecisionTypeForCase(caseRow.case_type)
  if (!decisionType) return null

  const scopeType = caseRow.metering_point_id
    ? 'metering_point'
    : caseRow.site_id
      ? 'site'
      : caseRow.customer_contract_id
        ? 'contract'
        : 'customer'
  const scopeId =
    caseRow.metering_point_id ??
    caseRow.site_id ??
    caseRow.customer_contract_id ??
    null

  const { data: existing, error: existingError } = await supabase
    .from('customer_lifecycle_decisions')
    .select('id')
    .eq('company_id', caseRow.company_id)
    .eq('customer_id', caseRow.customer_id)
    .eq('decision_type', decisionType)
    .eq('scope_type', scopeType)
    .eq('reason', `Kundärende ${caseRow.id}: ${caseRow.title}`)
    .limit(1)
    .maybeSingle()

  if (existingError) {
    if (databaseShapeMissing(existingError)) return null
    throw existingError
  }

  if (existing?.id) return String(existing.id)

  const { data, error } = await supabase
    .from('customer_lifecycle_decisions')
    .insert({
      company_id: caseRow.company_id,
      customer_id: caseRow.customer_id,
      decision_type: decisionType,
      scope_type: scopeType,
      scope_id: scopeId,
      reason: `Kundärende ${caseRow.id}: ${caseRow.title}`,
      billing_blocked: true,
      created_by: actorUserId,
    })
    .select('id')
    .single()

  if (error) {
    if (databaseShapeMissing(error)) return null
    throw error
  }

  return data?.id ? String(data.id) : null
}

export async function findActiveSwitchLifecycleBlock(
  supabase: SupabaseClient,
  params: {
    companyId?: string | null
    customerId: string
    siteId?: string | null
    meteringPointId?: string | null
  }
): Promise<SwitchLifecycleBlock | null> {
  try {
    let decisionQuery = supabase
      .from('customer_lifecycle_decisions')
      .select('id, company_id, customer_id, decision_type, scope_type, scope_id, reason, created_at')
      .eq('customer_id', params.customerId)
      .in('decision_type', ['withdrawal', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(20)

    if (params.companyId) decisionQuery = decisionQuery.eq('company_id', params.companyId)

    const { data: decisions, error } = await decisionQuery
    if (error) {
      if (!databaseShapeMissing(error)) throw error
    } else {
      for (const row of decisions ?? []) {
        const scopeType = String(row.scope_type ?? 'customer')
        const scopeId = row.scope_id ? String(row.scope_id) : null
        const block: SwitchLifecycleBlock = {
          source: 'customer_lifecycle_decision',
          id: String(row.id),
          companyId: row.company_id ? String(row.company_id) : null,
          customerId: String(row.customer_id),
          siteId: scopeType === 'site' ? scopeId : null,
          meteringPointId: scopeType === 'metering_point' ? scopeId : null,
          decisionType: row.decision_type === 'withdrawal' ? 'withdrawal' : 'rejected',
          title: row.decision_type === 'withdrawal' ? 'Ånger registrerad' : 'Kund nekad/blockerad',
          reason: String(row.reason ?? 'Kundens livscykel blockerar leverantörsbyte.'),
          createdAt: row.created_at ? String(row.created_at) : null,
        }

        if (scopeMatches(block, params)) return block
      }
    }
  } catch (error) {
    if (!databaseShapeMissing(error)) throw error
  }

  try {
    let caseQuery = supabase
      .from('customer_cases')
      .select('id, company_id, customer_id, site_id, metering_point_id, case_type, title, reason_category, description, created_at')
      .eq('customer_id', params.customerId)
      .in('case_type', Array.from(BLOCKING_CASE_TYPES))
      .not('status', 'in', '(resolved,cancelled,closed)')
      .order('created_at', { ascending: false })
      .limit(20)

    if (params.companyId) caseQuery = caseQuery.eq('company_id', params.companyId)

    const { data: cases, error } = await caseQuery
    if (error) {
      if (!databaseShapeMissing(error)) throw error
      return null
    }

    for (const row of cases ?? []) {
      const block: SwitchLifecycleBlock = {
        source: 'customer_case',
        id: String(row.id),
        companyId: row.company_id ? String(row.company_id) : null,
        customerId: String(row.customer_id),
        siteId: row.site_id ? String(row.site_id) : null,
        meteringPointId: row.metering_point_id ? String(row.metering_point_id) : null,
        decisionType: row.case_type === 'withdrawal' ? 'withdrawal' : 'rejected',
        title: String(row.title ?? 'Kundärende blockerar leverantörsbyte'),
        reason:
          String(row.reason_category ?? '').trim() ||
          String(row.description ?? '').trim() ||
          'Öppet kundärende blockerar leverantörsbyte.',
        createdAt: row.created_at ? String(row.created_at) : null,
      }

      if (scopeMatches(block, params)) return block
    }
  } catch (error) {
    if (!databaseShapeMissing(error)) throw error
  }

  return null
}

export async function assertNoActiveSwitchLifecycleBlock(
  supabase: SupabaseClient,
  params: {
    companyId?: string | null
    customerId: string
    siteId?: string | null
    meteringPointId?: string | null
  }
): Promise<void> {
  const block = await findActiveSwitchLifecycleBlock(supabase, params)
  if (!block) return

  throw new Error(
    `Leverantörsbyte är blockerat/pausat: ${block.title}. Orsak: ${block.reason}`
  )
}

export async function pauseOpenSupplierSwitchesForLifecycleBlock(
  supabase: SupabaseClient,
  params: {
    block: SwitchLifecycleBlock
    actorUserId: string | null
    customerCaseId?: string | null
  }
): Promise<{ paused: number; requestIds: string[] }> {
  let query = supabase
    .from('supplier_switch_requests')
    .select('*')
    .eq('customer_id', params.block.customerId)
    .in('status', OPEN_SUPPLIER_SWITCH_STATUSES)

  if (params.block.companyId) query = query.eq('company_id', params.block.companyId)
  if (params.block.siteId) query = query.eq('site_id', params.block.siteId)
  if (params.block.meteringPointId) query = query.eq('metering_point_id', params.block.meteringPointId)

  const { data, error } = await query
  if (error) {
    if (databaseShapeMissing(error)) return { paused: 0, requestIds: [] }
    throw error
  }

  const rows = (data ?? []) as SupplierSwitchRequestRow[]
  const now = new Date().toISOString()
  const pausedRequestIds: string[] = []

  for (const request of rows) {
    const nextStatus = statusAfterLifecycleBlock({
      requestStatus: request.status,
      block: params.block,
    })

    const patch: Record<string, unknown> = {
      status: nextStatus,
      failure_reason: `${params.block.title}: ${params.block.reason}`,
      pause_reason: `${params.block.title}: ${params.block.reason}`,
      paused_at: now,
      paused_by: params.actorUserId,
      lifecycle_block_source: params.block.source,
      lifecycle_block_id: params.block.id,
      lifecycle_blocked: true,
      updated_by: params.actorUserId,
      updated_at: now,
    }

    if (nextStatus === 'cancelled_before_start' || nextStatus === 'manual_followup_required') {
      patch.failed_at = now
    }

    const { error: updateError } = await supabase
      .from('supplier_switch_requests')
      .update(patch)
      .eq('id', request.id)

    if (updateError) {
      if (!databaseShapeMissing(updateError) && updateError.code !== '23514') throw updateError
      const fallbackPatch = {
        status: nextStatus,
        failure_reason: `${params.block.title}: ${params.block.reason}`,
        updated_by: params.actorUserId,
        updated_at: now,
      }
      const { error: fallbackError } = await supabase
        .from('supplier_switch_requests')
        .update(fallbackPatch)
        .eq('id', request.id)
      if (fallbackError && !databaseShapeMissing(fallbackError)) throw fallbackError
    }

    pausedRequestIds.push(request.id)

    await supabase.from('supplier_switch_events').insert({
      switch_request_id: request.id,
      company_id: params.block.companyId,
      event_type: 'lifecycle_blocked',
      event_status: nextStatus,
      message:
        nextStatus === 'cancellation_requested'
          ? 'Leverantörsbytet är pausat och behöver annullering mot nätägare.'
          : 'Leverantörsbytet är stoppat innan fortsatt handläggning.',
      payload: {
        lifecycleBlock: params.block,
        customerCaseId: params.customerCaseId ?? null,
        previousStatus: request.status,
        nextStatus,
      },
      created_by: params.actorUserId,
    })
  }

  return { paused: pausedRequestIds.length, requestIds: pausedRequestIds }
}

export function switchLifecycleBlockFromCase(caseRow: CustomerCaseRow): SwitchLifecycleBlock | null {
  const decisionType = lifecycleDecisionTypeForCase(caseRow.case_type)
  if (!decisionType) return null

  return {
    source: 'customer_case',
    id: caseRow.id,
    companyId: caseRow.company_id,
    customerId: caseRow.customer_id,
    siteId: caseRow.site_id,
    meteringPointId: caseRow.metering_point_id,
    decisionType,
    title: caseRow.case_type === 'withdrawal' ? 'Ånger registrerad' : 'Kund nekad/blockerad',
    reason: caseRow.reason_category ?? caseRow.description ?? caseRow.title,
    createdAt: caseRow.created_at,
  }
}
