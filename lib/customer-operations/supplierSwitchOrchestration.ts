import { supabaseService } from '@/lib/supabase/service'
import {
  createSupplierSwitchRequest,
  findCustomerSiteById,
  findOpenSupplierSwitchRequestForSite,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  syncOperationTasksFromReadiness,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type { SupplierSwitchRequestRow, SupplierSwitchRequestType, SwitchReadinessResult } from '@/lib/operations/types'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'
import { getMeteringPointIdentity } from '@/lib/customers/meteringIdentity'
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { enqueueSupplierSwitchAutomation } from '@/lib/customer-operations/automation'
import { normalizeUuidOrNull, requireUuid } from '@/lib/validation/uuid'
import { checkSupplierSwitchReadiness } from '@/lib/customer-operations/switchReadiness'
import { evaluateManualSupplierReadiness } from '@/lib/customer-operations/manualSupplierReadiness'
import { tenantSelect, tenantUpdate } from '@/lib/supabase/tenantQuery'
import { strictIsoDate } from '@/lib/time/stockholm'

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Recover the first normal request's start intent from its exact signed contract. */
async function readCanonicalNormalStartDate(input: {
  companyId: string
  customerId: string
  siteId: string
  contractId: string | null
}): Promise<string | null> {
  if (!input.contractId) return null
  const result = await tenantSelect(input.companyId, 'customer_contracts',
    'id,company_id,customer_id,customer_site_id,site_id,status,requested_start_mode,requested_start_date,expected_start_at,starts_at')
    .eq('id', input.contractId).eq('company_id', input.companyId).eq('customer_id', input.customerId)
    .eq('status', 'signed').or(`customer_site_id.eq.${input.siteId},site_id.eq.${input.siteId}`).maybeSingle()
  if (result.error || !result.data) return null
  const contract = result.data as JsonRecord
  if (contract.id !== input.contractId || contract.company_id !== input.companyId
    || contract.customer_id !== input.customerId || contract.status !== 'signed'
    || (contract.customer_site_id != null && contract.customer_site_id !== input.siteId)
    || (contract.site_id != null && contract.site_id !== input.siteId)
    || (contract.customer_site_id !== input.siteId && contract.site_id !== input.siteId)) return null
  const mode = contract.requested_start_mode
  if (mode !== 'earliest_possible' && mode !== 'specific_date') return null
  // A specific date must be the customer's explicit choice. For earliest start,
  // use the same date precedence as canonical contract lifecycle readiness.
  const date = mode === 'specific_date' ? contract.requested_start_date
    : contract.requested_start_date ?? contract.expected_start_at ?? contract.starts_at
  try { return strictIsoDate(date, 'customer_requested_start_date') }
  catch { return null }
}

function missingSchema(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(row?.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
}

/**
 * Readiness issues are not all equal. Some mean we cannot even create a
 * durable supplier_switch_requests row (missing legal/site/metering identity),
 * while others are business/review blockers that should stop dispatch only.
 *
 * current_supplier_missing is intentionally NOT in this set: the customer must
 * still appear in company_switch_queue_v so tenant/superadmin can complete the
 * missing supplier data from the switch queue.
 */
const MANAGED_SWITCH_REVIEW_BLOCKER_CODES = new Set<string>([
  'current_supplier_missing',
  'move_in_date_missing',
  'current_supplier_response_pending',
  'current_supplier_waiting_response',
  'current_supplier_manual_review',
  'current_supplier_binding_period',
  'current_supplier_termination_fee',
  'current_supplier_blocked',
  'supplier_commercial_start_too_early',
])

const SUPPLIER_SWITCH_CREATION_BLOCKER_CODES = new Set<string>([
  'power_of_attorney_missing',
  'power_of_attorney_not_signed',
  'metering_point_missing',
  'meter_point_id_missing',
  'grid_owner_missing',
  'grid_area_missing',
  'price_area_missing',
  'facility_or_metering_point_missing',
])

function currentSupplierResponseReviewBlockers(site: CustomerSiteRow): SupplierSwitchOrchestrationBlocker[] {
  const status = clean(site.current_supplier_response_status)?.toLowerCase()
  const blockers: SupplierSwitchOrchestrationBlocker[] = []
  if (status === 'waiting_response') {
    blockers.push({ code: 'current_supplier_response_pending', message: 'Svar från nuvarande leverantör inväntas.' })
  } else if (status === 'manual_review') {
    blockers.push({ code: 'current_supplier_manual_review', message: 'Nuvarande leverantör kräver manuell granskning före byte.' })
  } else if (status === 'binding_period') {
    blockers.push({ code: 'current_supplier_binding_period', message: 'Bindningstid måste kontrolleras innan leverantörsbytet skickas.' })
  } else if (status === 'termination_fee') {
    blockers.push({ code: 'current_supplier_termination_fee', message: 'Brytavgift måste hanteras innan leverantörsbytet skickas.' })
  } else if (status === 'blocked') {
    blockers.push({ code: 'current_supplier_blocked', message: 'Nuvarande leverantör har blockerat automatiskt leverantörsbyte.' })
  }
  if ((site.current_supplier_termination_fee ?? 0) > 0 && !blockers.some((blocker) => blocker.code === 'current_supplier_termination_fee')) {
    blockers.push({ code: 'current_supplier_termination_fee', message: 'Registrerad brytavgift måste hanteras innan leverantörsbytet skickas.' })
  }
  return blockers
}

function splitReadinessIssuesForSwitchRequestCreation(input: {
  readiness: SwitchReadinessResult
  requestedStartDate: string | null
}): {
  creationBlockers: SupplierSwitchOrchestrationBlocker[]
  reviewBlockers: SupplierSwitchOrchestrationBlocker[]
} {
  const creationBlockers: SupplierSwitchOrchestrationBlocker[] = []
  const reviewBlockers: SupplierSwitchOrchestrationBlocker[] = []

  for (const issue of input.readiness.issues) {
    const blocker = { code: issue.code, message: issue.title }

    // A requested start date supplied by the website payload/context is enough
    // to create the switch request. Dispatch can still block later if market
    // timing/preflight says it is not sendable yet.
    if (issue.code === 'move_in_date_missing' && input.requestedStartDate) {
      continue
    }

    if (SUPPLIER_SWITCH_CREATION_BLOCKER_CODES.has(issue.code)) {
      creationBlockers.push(blocker)
    } else {
      reviewBlockers.push(blocker)
    }
  }

  return { creationBlockers, reviewBlockers }
}

// Retain the exact request state across both the monotonic date correction and
// the later reconciliation patch. A concurrent binding, hold or date edit must
// be retried rather than overwritten by a stale orchestration snapshot.
function matchingExistingSwitchUpdate(input: {
  companyId: string
  customerId: string
  siteId: string
  existing: SupplierSwitchRequestRow
  payload: JsonRecord
}) {
  let query = tenantUpdate(input.companyId, 'supplier_switch_requests', input.payload)
    .eq('id', input.existing.id)
    .eq('customer_id', input.customerId)
    .eq('site_id', input.siteId)
  const state: JsonRecord = { ...input.existing }
  for (const column of [
    'customer_site_id', 'status', 'request_type', 'prodat_variant', 'prodat_reason',
    'requested_start_date', 'submitted_at', 'completed_at', 'outbound_z03_message_id',
    'lifecycle_blocked', 'lifecycle_block_source', 'lifecycle_block_id',
    'paused_at', 'paused_by', 'pause_reason', 'updated_at', 'metadata',
  ]) {
    const value = state[column]
    query = value == null ? query.is(column, null)
      : query.eq(column, column === 'metadata' ? JSON.stringify(value) : value)
  }
  return query
}

/** Raise only unsent normal dates; this is not permission to dispatch. */
async function normalizeExistingManualSupplierDate(input: {
  companyId: string
  customerId: string
  siteId: string
  existing: SupplierSwitchRequestRow
  site: CustomerSiteRow
}): Promise<SupplierSwitchRequestRow> {
  const { existing, site } = input
  const state: JsonRecord = { ...existing }
  if (existing.company_id !== input.companyId || existing.customer_id !== input.customerId
    || existing.site_id !== input.siteId || (existing.customer_site_id != null && existing.customer_site_id !== input.siteId)
    || existing.request_type !== 'switch' || !['queued', 'manual_followup_required'].includes(existing.status)
    || ['LK', 'C'].includes(existing.prodat_variant ?? '') || ['Z23', 'Z24'].includes(existing.prodat_reason ?? '')
    || existing.submitted_at != null || existing.completed_at != null || state.outbound_z03_message_id != null
    || existing.lifecycle_block_id != null || site.current_supplier_unknown !== false || !clean(site.current_supplier_id)
    || site.current_supplier_response_status !== 'free_to_switch' || site.current_supplier_termination_fee !== 0) return existing

  const metadata = existing.metadata ?? {}
  const previousBlockers = metadata.supplier_switch_blockers
  if (previousBlockers != null && !Array.isArray(previousBlockers)) return existing
  const pendingCodes = new Set(['current_supplier_response_pending', 'current_supplier_waiting_response', 'supplier_commercial_start_too_early'])
  const reasons = (Array.isArray(previousBlockers) ? previousBlockers : []).map(blocker => clean((blocker as JsonRecord | null)?.code))
  const pendingReason = clean(metadata.pending_review_reason)
  if (pendingReason) reasons.push(pendingReason)
  if (reasons.some(reason => !reason || !pendingCodes.has(reason))) return existing
  const blockSource = clean(existing.lifecycle_block_source)
  const managedPendingHold = existing.status === 'manual_followup_required' && reasons.length > 0
    && Boolean(blockSource && pendingCodes.has(blockSource))
  if ((existing.lifecycle_blocked || existing.paused_at || existing.pause_reason || blockSource) && !managedPendingHold) return existing
  if (existing.status === 'manual_followup_required' && !managedPendingHold) return existing

  const commercial = await evaluateManualSupplierReadiness({
    companyId: input.companyId, customerId: input.customerId, siteId: input.siteId, site,
    requestType: existing.request_type, requestStatus: existing.status,
    transactionSubtype: existing.prodat_variant ?? existing.prodat_reason ?? null,
    requestedStartDate: existing.requested_start_date, requireRequestedStartDate: true,
  })
  const floor = commercial.snapshot.earliestSupplierStartDate
  if (commercial.snapshot.sourceVerified !== true || !commercial.snapshot.applies || !floor
    || commercial.blockers.some(blocker => blocker.code !== 'supplier_commercial_start_too_early')
    || !existing.requested_start_date || existing.requested_start_date >= floor) return existing

  // The proof read and this request CAS are separate transactions. Only the
  // monotonic date changes here; canonical readiness rereads the durable row
  // and current source afterwards, and physical entry verifies it again.
  const { data, error } = await matchingExistingSwitchUpdate({ ...input,
    payload: { requested_start_date: floor, updated_at: new Date().toISOString() },
  }).select('*').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('supplier_switch_reconcile_changed')
  return data as SupplierSwitchRequestRow
}

/**
 * Business context carried from the website customer application (or another
 * intake source) into the supplier switch request metadata and the switch job
 * payload. All fields are optional; unknown values are simply omitted.
 */
export type SupplierSwitchOrchestrationContext = {
  applicationId?: string | null
  externalCustomerId?: string | null
  contractId?: string | null
  powerOfAttorneyId?: string | null
  requestedStartDate?: string | null
  requestedStartMode?: string | null
  moveInDate?: string | null
  facilityId?: string | null
  gridOwnerId?: string | null
  gridAreaCode?: string | null
  priceAreaCode?: string | null
  biddingZoneCode?: string | null
}

export type SupplierSwitchOrchestrationBlocker = {
  code: string
  message: string
}

export type SupplierSwitchOrchestrationResult = {
  ok: boolean
  /** True when a NEW supplier_switch_requests row was created by this call. */
  created: boolean
  /** True when an already-open switch request was reused (idempotent path). */
  reusedExisting: boolean
  supplierSwitchRequestId: string | null
  /** The enqueued (or deduplicated) start_supplier_switch job id, when a job was enqueued. */
  jobId: string | null
  jobDuplicate: boolean
  requestedStartDate: string | null
  blockers: SupplierSwitchOrchestrationBlocker[]
  blockedBeforeDispatch?: boolean
}

function blockedResult(blockers: SupplierSwitchOrchestrationBlocker[]): SupplierSwitchOrchestrationResult {
  return {
    ok: false,
    created: false,
    reusedExisting: false,
    supplierSwitchRequestId: null,
    jobId: null,
    jobDuplicate: false,
    requestedStartDate: null,
    blockers,
  }
}

function contextMetadata(input: {
  source: string
  context: SupplierSwitchOrchestrationContext
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow | null
  requestedStartDate: string | null
}): JsonRecord {
  const { context, site, meteringPoint } = input
  return {
    source: input.source,
    application_id: clean(context.applicationId),
    external_customer_id: clean(context.externalCustomerId),
    contract_id: clean(context.contractId),
    power_of_attorney_id: clean(context.powerOfAttorneyId),
    requested_start_mode: clean(context.requestedStartMode),
    requested_start_date: input.requestedStartDate,
    move_in_date: clean(context.moveInDate) ?? clean(site.move_in_date),
    facility_id: clean(context.facilityId) ?? clean(site.facility_id),
    grid_area_code: clean(context.gridAreaCode) ?? clean(site.grid_area_code),
    price_area_code: clean(context.priceAreaCode) ?? clean(meteringPoint?.price_area_code) ?? clean(site.price_area_code),
    bidding_zone_code: clean(context.biddingZoneCode) ?? clean((site as unknown as JsonRecord).bidding_zone_code),
    grid_owner_id: clean(context.gridOwnerId) ?? clean(meteringPoint?.grid_owner_id) ?? clean(site.grid_owner_id),
  }
}

export type EnsureSupplierSwitchRequestInput = {
  companyId: string
  customerId: string
  siteId: string
  meteringPointId?: string | null
  actorUserId?: string | null
  operationId?: string | null
  /** e.g. 'website_customer_application', 'customer_process_next_step_engine' */
  automationOrigin: string
  /** Stable idempotency key, e.g. `website_application_<applicationId>_supplier_switch`. */
  automationKey: string
  source: string
  requestedStartDate?: string | null
  externalReference?: string | null
  context?: SupplierSwitchOrchestrationContext
}

export type EnsureSupplierSwitchRequestResult = {
  ok: boolean
  created: boolean
  reusedExisting: boolean
  request: SupplierSwitchRequestRow | null
  site: CustomerSiteRow | null
  meteringPoint: MeteringPointRow | null
  readiness: SwitchReadinessResult | null
  requestedStartDate: string | null
  blockers: SupplierSwitchOrchestrationBlocker[]
  blockedBeforeDispatch?: boolean
}

/**
 * Shared find-or-create core for supplier switch requests.
 *
 * Used by the website application intake (complete facility) AND the
 * missing-facility completion path so both flows produce identical
 * supplier_switch_requests rows. Idempotency is layered:
 *  1. findOpenSupplierSwitchRequestForSite reuses any open switch for the site,
 *  2. the partial unique index on (company_id, site_id) for open statuses
 *     blocks concurrent duplicates at the database level,
 *  3. automation_key recovery in createSupplierSwitchRequest resolves 23505
 *     races back to the existing row.
 *
 * Never creates a switch request without facility/metering identity.
 */
export async function ensureSupplierSwitchRequestForReadySite(
  input: EnsureSupplierSwitchRequestInput,
): Promise<EnsureSupplierSwitchRequestResult> {
  const companyId = requireUuid(input.companyId, 'company_id')
  const customerId = requireUuid(input.customerId, 'customer_id')
  const siteId = requireUuid(input.siteId, 'customer_site_id')
  const preferredMeteringPointId = normalizeUuidOrNull(input.meteringPointId, 'metering_point_id')
  const context = input.context ?? {}

  const site = await findCustomerSiteById(supabaseService, siteId)
  if (!site || site.company_id !== companyId || site.customer_id !== customerId) {
    return {
      ok: false,
      created: false,
      reusedExisting: false,
      request: null,
      site: null,
      meteringPoint: null,
      readiness: null,
      requestedStartDate: null,
      blockers: [{ code: 'site_not_found_or_wrong_tenant', message: 'Anläggningen kunde inte hittas i rätt tenant.' }],
    }
  }

  const [meteringPoints, powers] = await Promise.all([
    listMeteringPointsForSite(supabaseService, siteId),
    listPowersOfAttorneyByCustomerId(supabaseService, customerId, { companyId }),
  ])
  const readiness = evaluateSiteSwitchReadiness({ site, meteringPoints, powersOfAttorney: powers })
  await syncOperationTasksFromReadiness(supabaseService, readiness).catch(() => undefined)

  const candidate =
    (preferredMeteringPointId ? meteringPoints.find((point) => point.id === preferredMeteringPointId) : null) ??
    meteringPoints.find((point) => point.id === readiness.candidateMeteringPointId) ??
    meteringPoints.find((point) => Boolean(getMeteringPointIdentity(point))) ??
    null

  const facilityReady = Boolean(clean(site.facility_id) || (candidate && getMeteringPointIdentity(candidate)))
  if (!facilityReady || !candidate) {
    return {
      ok: false,
      created: false,
      reusedExisting: false,
      request: null,
      site,
      meteringPoint: candidate,
      readiness,
      requestedStartDate: null,
      blockers: [{
        code: 'facility_or_metering_point_missing',
        message: 'Leverantörsbyte kan inte skapas utan anläggnings-ID/mätpunktsidentitet.',
      }],
    }
  }

  let requestedStartDate = clean(input.requestedStartDate) ?? clean(context.requestedStartDate) ?? clean(site.move_in_date) ?? null
  const { creationBlockers, reviewBlockers } = splitReadinessIssuesForSwitchRequestCreation({
    readiness,
    requestedStartDate,
  })
  for (const blocker of currentSupplierResponseReviewBlockers(site)) {
    if (!reviewBlockers.some((existingBlocker) => existingBlocker.code === blocker.code)) {
      reviewBlockers.push(blocker)
    }
  }

  const foundExisting = await findOpenSupplierSwitchRequestForSite(supabaseService, { companyId, customerId, siteId })
  const existing = foundExisting ? await normalizeExistingManualSupplierDate({ companyId, customerId, siteId, existing: foundExisting, site }) : null
  const canonicalReadiness = await checkSupplierSwitchReadiness({
    companyId,
    customerId,
    siteId,
    contractId: clean(context.contractId),
    switchRequestId: existing?.id ?? null,
    requestedStartDate,
    treatNormalIssuesAsBlockers: false,
  })
  const exactContractId = clean(canonicalReadiness.readinessSnapshot.contract_id)
  const commercial = canonicalReadiness.readinessSnapshot.manual_supplier_commercial
  if (!existing && !requestedStartDate && !site.move_in_date
    && commercial && typeof commercial === 'object' && !Array.isArray(commercial)
    && 'applies' in commercial && commercial.applies === true
    && 'sourceVerified' in commercial && commercial.sourceVerified === true) {
    requestedStartDate = await readCanonicalNormalStartDate({ companyId, customerId, siteId, contractId: exactContractId })
    if (!requestedStartDate) {
      return {
        ok: false, created: false, reusedExisting: false, request: null, site, meteringPoint: candidate, readiness,
        requestedStartDate: null,
        blockers: [
          ...canonicalReadiness.blockers.map(({ code, message }) => ({ code, message })),
          { code: 'customer_requested_start_intent_invalid', message: 'Kundens avtalade startdatum behöver verifieras innan bytet kan skapas.' },
        ],
      }
    }
    // The canonical creator still recalculates policy and verified supplier
    // floors. Only this stale site warning is resolved by the signed date.
    const missingDate = reviewBlockers.findIndex(blocker => blocker.code === 'move_in_date_missing')
    if (missingDate >= 0) reviewBlockers.splice(missingDate, 1)
  }
  for (const blocker of canonicalReadiness.blockers) {
    if (!reviewBlockers.some((item) => item.code === blocker.code)) {
      reviewBlockers.push({ code: blocker.code, message: blocker.message })
    }
  }

  if (creationBlockers.length > 0) {
    return {
      ok: false,
      created: false,
      reusedExisting: false,
      request: null,
      site,
      meteringPoint: candidate,
      readiness,
      requestedStartDate,
      blockers: creationBlockers,
    }
  }

  if (existing) {
    const existingMetadata = existing.metadata && typeof existing.metadata === 'object'
      ? existing.metadata
      : {}
    const previousBusinessBlockers = Array.isArray(existingMetadata.supplier_switch_blockers)
      ? existingMetadata.supplier_switch_blockers
      : []
    const previousBusinessBlockerCodes = new Set(
      previousBusinessBlockers
        .map((blocker) => clean((blocker as JsonRecord | null)?.code))
        .filter((code): code is string => Boolean(code)),
    )
    const previousPendingReviewReason = clean(existingMetadata.pending_review_reason)
    if (previousPendingReviewReason) previousBusinessBlockerCodes.add(previousPendingReviewReason)

    const lifecycleBlockSource = clean(existing.lifecycle_block_source)
    const previousManagedBusinessReview = Array.from(previousBusinessBlockerCodes)
      .some((code) => MANAGED_SWITCH_REVIEW_BLOCKER_CODES.has(code))
    const lifecycleManagedByBusinessRule = Boolean(
      (lifecycleBlockSource && MANAGED_SWITCH_REVIEW_BLOCKER_CODES.has(lifecycleBlockSource)) ||
      (!existing.lifecycle_blocked && previousManagedBusinessReview),
    )
    const lifecycleBlockedByManagedBusinessRule = Boolean(
      existing.lifecycle_blocked && lifecycleManagedByBusinessRule,
    )
    const unrelatedLifecycleBlock = Boolean(
      existing.lifecycle_blocked && !lifecycleBlockedByManagedBusinessRule,
    )
    const effectiveBlockers = [...reviewBlockers]
    if (unrelatedLifecycleBlock) {
      effectiveBlockers.push({
        code: lifecycleBlockSource ?? 'lifecycle_blocked',
        message: 'Leverantörsbytet har en separat livscykelblockering som måste hanteras innan utskick.',
      })
    }

    const shouldBlockForBusinessReview = reviewBlockers.length > 0
    const shouldClearManagedBusinessBlock = !shouldBlockForBusinessReview && !unrelatedLifecycleBlock && Boolean(
      lifecycleManagedByBusinessRule ||
      (existing.status === 'manual_followup_required' && previousManagedBusinessReview),
    )
    const nextStatus = unrelatedLifecycleBlock
      ? existing.status
      : shouldBlockForBusinessReview
        ? 'manual_followup_required'
        : shouldClearManagedBusinessBlock || existing.status === 'manual_followup_required'
          ? 'queued'
          : existing.status

    const nextMetadata: JsonRecord = {
      ...existingMetadata,
      ...contextMetadata({
        source: input.source,
        context,
        site,
        meteringPoint: candidate,
        requestedStartDate: existing.requested_start_date ?? requestedStartDate,
      }),
      contract_id: exactContractId,
      supplier_switch_blockers: reviewBlockers,
      pending_review_reason: reviewBlockers[0]?.code ?? null,
    }

    const updatePayload: JsonRecord = {
      status: nextStatus,
      contract_id: exactContractId,
      customer_contract_id: exactContractId,
      metering_point_id: candidate.id,
      customer_site_id: site.id,
      requested_start_date: existing.requested_start_date ?? requestedStartDate,
      current_supplier_id: site.current_supplier_id ?? null,
      current_supplier_name: site.current_supplier_name ?? null,
      current_supplier_org_number: site.current_supplier_org_number ?? null,
      current_supplier_ediel_id: site.current_supplier_ediel_id ?? null,
      current_supplier_unknown: Boolean(site.current_supplier_unknown),
      current_supplier_contract_status: site.current_supplier_contract_status ?? null,
      current_supplier_contract_end_date: site.current_supplier_contract_end_date ?? null,
      current_supplier_notice_period: site.current_supplier_notice_period ?? null,
      current_supplier_termination_fee: site.current_supplier_termination_fee ?? null,
      current_supplier_response_status: site.current_supplier_response_status ?? null,
      grid_owner_id: candidate.grid_owner_id ?? site.grid_owner_id ?? null,
      price_area_code: candidate.price_area_code ?? site.price_area_code ?? null,
      validation_snapshot: {
        ...(existing.validation_snapshot ?? {}),
        isReady: readiness.isReady && reviewBlockers.length === 0,
        issues: readiness.issues,
        candidateMeteringPointId: readiness.candidateMeteringPointId,
        latestPowerOfAttorneyId: readiness.latestPowerOfAttorneyId,
        businessBlockers: reviewBlockers,
        currentSupplier: {
          id: site.current_supplier_id ?? null,
          name: site.current_supplier_name ?? null,
          orgNumber: site.current_supplier_org_number ?? null,
          edielId: site.current_supplier_ediel_id ?? null,
          unknown: Boolean(site.current_supplier_unknown),
          contractStatus: site.current_supplier_contract_status ?? null,
          contractEndDate: site.current_supplier_contract_end_date ?? null,
          noticePeriod: site.current_supplier_notice_period ?? null,
          terminationFee: site.current_supplier_termination_fee ?? null,
          responseStatus: site.current_supplier_response_status ?? null,
        },
        reconciledAt: new Date().toISOString(),
      },
      metadata: nextMetadata,
      updated_at: new Date().toISOString(),
    }

    if (shouldBlockForBusinessReview && !unrelatedLifecycleBlock) {
      updatePayload.lifecycle_blocked = true
      updatePayload.lifecycle_block_source = reviewBlockers[0]?.code ?? null
      updatePayload.paused_at = existing.paused_at ?? new Date().toISOString()
      updatePayload.paused_by = input.actorUserId ?? existing.paused_by ?? null
      updatePayload.pause_reason = reviewBlockers[0]?.message ?? 'Komplettering krävs före leverantörsbyte.'
    } else if (shouldClearManagedBusinessBlock) {
      updatePayload.lifecycle_blocked = false
      updatePayload.lifecycle_block_source = null
      updatePayload.paused_at = null
      updatePayload.paused_by = null
      updatePayload.pause_reason = null
    }

    const { data: updatedData, error: updateError } = await matchingExistingSwitchUpdate({
      companyId, customerId, siteId, existing, payload: updatePayload,
    }).select('*').maybeSingle()
    if (updateError) throw updateError
    if (!updatedData) throw new Error('supplier_switch_reconcile_changed')
    const updated = updatedData as SupplierSwitchRequestRow

    if (shouldClearManagedBusinessBlock) {
      await emitCustomerOperationEvent({
        companyId,
        customerId,
        actorUserId: input.actorUserId ?? null,
        eventType: 'supplier_switch.unblocked',
        title: 'Leverantörsbyte återupptaget',
        message: 'Tidigare kompletteringsblockering är löst. Leverantörsbytet har lagts tillbaka i kön.',
        customerSiteId: siteId,
        meteringPointId: candidate.id,
        operationId: normalizeUuidOrNull(input.operationId, 'operation_id'),
        status: 'queued',
        severity: 'info',
        actionRequired: false,
        source: input.source,
        actionUrl: `/admin/customers/${customerId}?tab=supplier-switch`,
        payload: {
          supplier_switch_request_id: updated.id,
          resolved_block_source: lifecycleBlockSource,
          requested_start_date: updated.requested_start_date ?? requestedStartDate,
        },
        idempotencyKey: `supplier_switch.unblocked:${updated.id}:${lifecycleBlockSource ?? 'business_review'}`,
      })
    }

    return {
      ok: true,
      created: false,
      reusedExisting: true,
      request: updated,
      site,
      meteringPoint: candidate,
      readiness,
      requestedStartDate: updated.requested_start_date ?? requestedStartDate,
      blockers: effectiveBlockers,
    }
  }

  const requestType: SupplierSwitchRequestType = site.move_in_date ? 'move_in' : 'switch'
  const request = await createSupplierSwitchRequest(supabaseService, {
    readiness,
    site,
    meteringPoint: candidate,
    requestType,
    requestedStartDate,
    companyId,
    contractId: exactContractId,
    automationOrigin: input.automationOrigin,
    automationKey: input.automationKey,
    externalReference: clean(input.externalReference) ?? clean(context.externalCustomerId),
    initialStatus: reviewBlockers.length > 0 ? 'manual_followup_required' : 'queued',
    businessBlockers: reviewBlockers,
    lifecycleBlocked: reviewBlockers.length > 0,
    lifecycleBlockSource: reviewBlockers[0]?.code ?? null,
    metadata: contextMetadata({
      source: input.source,
      context,
      site,
      meteringPoint: candidate,
      requestedStartDate,
    }),
  })

  const operationId = normalizeUuidOrNull(input.operationId, 'operation_id')
  if (operationId) {
    const linked = await supabaseService
      .from('supplier_switch_requests')
      .update({ operation_id: operationId })
      .eq('id', request.id)
      .eq('company_id', companyId)
    if (linked.error && !missingSchema(linked.error)) {
      console.warn('[supplier-switch-orchestration] operation link skipped', linked.error)
    }
  }

  await emitCustomerOperationEvent({
    companyId,
    customerId,
    actorUserId: input.actorUserId ?? null,
    eventType: 'supplier_switch.request_created',
    title: 'Leverantörsbyte skapat',
    message: reviewBlockers.length > 0
      ? `Leverantörsbyte är skapat men väntar på komplettering: ${reviewBlockers.map((blocker) => blocker.message).join(', ')}.`
      : requestedStartDate
        ? `Leverantörsbyte är skapat och planeras utifrån önskat startdatum ${requestedStartDate}.`
        : 'Leverantörsbyte är skapat och planeras utifrån tidigast möjliga startdatum.',
    customerSiteId: siteId,
    meteringPointId: candidate.id,
    operationId,
    status: reviewBlockers.length > 0 ? 'needs_review' : 'queued',
    severity: reviewBlockers.length > 0 ? 'warning' : 'info',
    actionRequired: reviewBlockers.length > 0,
    source: input.source,
    actionUrl: `/admin/customers/${customerId}?tab=supplier-switch`,
    payload: {
      supplier_switch_request_id: request.id,
      blockers: reviewBlockers,
      automation_origin: input.automationOrigin,
      automation_key: input.automationKey,
      requested_start_date: requestedStartDate,
      application_id: clean(context.applicationId),
      external_customer_id: clean(context.externalCustomerId),
      site_id: siteId,
      metering_point_id: candidate.id,
    },
    idempotencyKey: `supplier_switch.request_created:${request.id}`,
  })

  return {
    ok: true,
    created: true,
    reusedExisting: false,
    request,
    site,
    meteringPoint: candidate,
    readiness,
    requestedStartDate: request.requested_start_date ?? requestedStartDate,
    blockers: reviewBlockers,
  }
}


export type ReconcileSupplierSwitchAfterCustomerDataChangeInput = {
  companyId: string
  customerId: string
  siteId: string
  meteringPointId?: string | null
  actorUserId?: string | null
  operationId?: string | null
  source: string
}

/**
 * Re-evaluates supplier-switch readiness after site, metering, POA or supplier
 * data changes. It resumes an open durable request, or creates the first
 * request once earlier creation blockers have been resolved.
 */
export async function reconcileSupplierSwitchAfterCustomerDataChange(
  input: ReconcileSupplierSwitchAfterCustomerDataChangeInput,
): Promise<SupplierSwitchOrchestrationResult> {
  const companyId = requireUuid(input.companyId, 'company_id')
  const customerId = requireUuid(input.customerId, 'customer_id')
  const siteId = requireUuid(input.siteId, 'customer_site_id')
  const existing = await findOpenSupplierSwitchRequestForSite(supabaseService, { companyId, customerId, siteId })

  const ensured = await ensureSupplierSwitchRequestForReadySite({
    companyId,
    customerId,
    siteId,
    meteringPointId: input.meteringPointId ?? existing?.metering_point_id ?? null,
    actorUserId: input.actorUserId ?? null,
    operationId: input.operationId ?? null,
    automationOrigin: 'customer_data_change_reconcile',
    automationKey: existing?.automation_key ?? `customer_site_${siteId}_supplier_switch`,
    source: input.source,
    requestedStartDate: existing?.requested_start_date ?? null,
    externalReference: existing?.external_reference ?? null,
    context: {
      requestedStartDate: existing?.requested_start_date ?? null,
      applicationId: clean(existing?.metadata?.application_id),
      externalCustomerId: clean(existing?.metadata?.external_customer_id),
      contractId: clean(existing?.metadata?.contract_id),
      powerOfAttorneyId: clean(existing?.metadata?.power_of_attorney_id),
    },
  })

  if (!ensured.ok || !ensured.request) return blockedResult(ensured.blockers)
  if (ensured.blockers.length > 0) {
    return {
      ok: true,
      created: ensured.created,
      reusedExisting: ensured.reusedExisting,
      supplierSwitchRequestId: ensured.request.id,
      jobId: null,
      jobDuplicate: false,
      requestedStartDate: ensured.requestedStartDate,
      blockers: ensured.blockers,
      blockedBeforeDispatch: true,
    }
  }

  const job = await enqueueSupplierSwitchAutomation({
    companyId,
    customerId,
    siteId,
    meteringPointId: ensured.meteringPoint?.id ?? input.meteringPointId ?? existing?.metering_point_id ?? null,
    actorUserId: input.actorUserId ?? null,
    operationId: input.operationId ?? null,
    source: input.source,
    payloadContext: {
      supplier_switch_request_id: ensured.request.id,
      customer_id: customerId,
      customer_site_id: siteId,
      site_id: siteId,
      metering_point_id: ensured.meteringPoint?.id ?? existing?.metering_point_id ?? null,
      requested_start_date: ensured.requestedStartDate,
      grid_owner_id: ensured.meteringPoint?.grid_owner_id ?? ensured.site?.grid_owner_id ?? null,
      grid_area_code: ensured.site?.grid_area_code ?? null,
      price_area_code: ensured.meteringPoint?.price_area_code ?? ensured.site?.price_area_code ?? null,
      source: input.source,
      idempotency_context: `supplier_switch_reconcile:${ensured.request.id}`,
    },
  })

  return {
    ok: true,
    created: ensured.created,
    reusedExisting: ensured.reusedExisting,
    supplierSwitchRequestId: ensured.request.id,
    jobId: job.id,
    jobDuplicate: Boolean(job.duplicate),
    requestedStartDate: ensured.requestedStartDate,
    blockers: [],
  }
}

export type EnsureSupplierSwitchForReadyCustomerInput = {
  companyId: string
  customerId: string
  siteId: string
  meteringPointId?: string | null
  actorUserId?: string | null
  operationId?: string | null
  applicationId: string
  source?: string | null
  requestedStartDate?: string | null
  externalReference?: string | null
  context?: SupplierSwitchOrchestrationContext
}

/**
 * Full supplier switch orchestration for a customer that intake declared
 * ready for switch (website application status = ready_for_switch and
 * can_start_switch = true, or missing-facility completion producing the same
 * readiness):
 *
 *  1. upsert supplier_switch_requests (customer appears in company_switch_queue_v),
 *  2. enqueue the canonical start_supplier_switch customer_operation_job which
 *     resolves route/preflight and prepares outbound/EDIEL or blocks with an
 *     exact blocker.
 *
 * NON-THROWING by design: website intake is already durably committed when
 * this runs, so orchestration failures must surface as blockers/warnings —
 * never as a failed application.
 */
export async function ensureSupplierSwitchForReadyCustomer(
  input: EnsureSupplierSwitchForReadyCustomerInput,
): Promise<SupplierSwitchOrchestrationResult> {
  try {
    const applicationId = requireUuid(input.applicationId, 'application_id')
    const source = clean(input.source) ?? 'website_customer_applications'
    const ensured = await ensureSupplierSwitchRequestForReadySite({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.siteId,
      meteringPointId: input.meteringPointId,
      actorUserId: input.actorUserId,
      operationId: input.operationId,
      automationOrigin: 'website_customer_application',
      automationKey: `website_application_${applicationId}_supplier_switch`,
      source,
      requestedStartDate: input.requestedStartDate,
      externalReference: input.externalReference,
      context: { ...(input.context ?? {}), applicationId },
    })

    if (!ensured.ok || !ensured.request) {
      await emitCustomerOperationEvent({
        companyId: input.companyId,
        customerId: input.customerId,
        actorUserId: input.actorUserId ?? null,
        eventType: 'supplier_switch.blocked',
        title: 'Leverantörsbyte kunde inte skapas automatiskt',
        message: `Komplettera först: ${ensured.blockers.map((blocker) => blocker.message).join(', ') || 'uppgifter för leverantörsbyte'}`,
        customerSiteId: input.siteId,
        meteringPointId: ensured.meteringPoint?.id ?? null,
        operationId: normalizeUuidOrNull(input.operationId, 'operation_id'),
        status: 'needs_review',
        severity: 'warning',
        actionRequired: true,
        source,
        actionUrl: `/admin/customers/${input.customerId}?tab=supplier-switch`,
        payload: {
          application_id: input.applicationId,
          blockers: ensured.blockers,
          site_id: input.siteId,
        },
        idempotencyKey: `supplier_switch.orchestration_blocked:${input.applicationId}:${ensured.blockers[0]?.code ?? 'unknown'}`,
      })
      return blockedResult(ensured.blockers)
    }

    if (ensured.blockers.length > 0) {
      await emitCustomerOperationEvent({
        companyId: input.companyId,
        customerId: input.customerId,
        actorUserId: input.actorUserId ?? null,
        eventType: 'supplier_switch.blocked',
        title: 'Leverantörsbyte väntar på komplettering',
        message: `Komplettera först: ${ensured.blockers.map((blocker) => blocker.message).join(', ')}`,
        customerSiteId: input.siteId,
        meteringPointId: ensured.meteringPoint?.id ?? input.meteringPointId ?? null,
        operationId: normalizeUuidOrNull(input.operationId, 'operation_id'),
        status: 'needs_review',
        severity: 'warning',
        actionRequired: true,
        source,
        actionUrl: `/admin/customers/${input.customerId}?tab=supplier-switch`,
        payload: {
          application_id: input.applicationId,
          supplier_switch_request_id: ensured.request.id,
          blockers: ensured.blockers,
          site_id: input.siteId,
        },
        idempotencyKey: `supplier_switch.blocked:${ensured.request.id}:${ensured.blockers[0]?.code ?? 'unknown'}`,
      })

      return {
        ok: true,
        created: ensured.created,
        reusedExisting: ensured.reusedExisting,
        supplierSwitchRequestId: ensured.request.id,
        jobId: null,
        jobDuplicate: false,
        requestedStartDate: ensured.requestedStartDate,
        blockers: ensured.blockers,
        blockedBeforeDispatch: true,
      }
    }

    const context = input.context ?? {}
    const job = await enqueueSupplierSwitchAutomation({
      companyId: input.companyId,
      customerId: input.customerId,
      siteId: input.siteId,
      meteringPointId: ensured.meteringPoint?.id ?? input.meteringPointId ?? null,
      actorUserId: input.actorUserId ?? null,
      operationId: input.operationId ?? null,
      source,
      payloadContext: {
        application_id: input.applicationId,
        supplier_switch_request_id: ensured.request.id,
        customer_id: input.customerId,
        customer_site_id: input.siteId,
        site_id: input.siteId,
        metering_point_id: ensured.meteringPoint?.id ?? null,
        contract_id: clean(context.contractId),
        requested_start_date: ensured.requestedStartDate,
        grid_owner_id: clean(context.gridOwnerId) ?? clean(ensured.site?.grid_owner_id),
        grid_area_code: clean(context.gridAreaCode) ?? clean(ensured.site?.grid_area_code),
        price_area_code: clean(context.priceAreaCode) ?? clean(ensured.site?.price_area_code),
        source,
        idempotency_context: `${input.applicationId}:${ensured.request.id}`,
      },
    })

    return {
      ok: true,
      created: ensured.created,
      reusedExisting: ensured.reusedExisting,
      supplierSwitchRequestId: ensured.request.id,
      jobId: job.id,
      jobDuplicate: Boolean(job.duplicate),
      requestedStartDate: ensured.requestedStartDate,
      blockers: [],
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Leverantörsbytesautomationen kunde inte startas.'
    console.error('[supplier-switch-orchestration] failed', { applicationId: input.applicationId, error })
    return blockedResult([{ code: 'supplier_switch_orchestration_failed', message }])
  }
}
