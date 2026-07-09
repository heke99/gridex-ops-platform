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

type JsonRecord = Record<string, unknown>

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function missingSchema(error: unknown): boolean {
  const row = error as { code?: string; message?: string } | null
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(row?.code ?? '') || /does not exist|schema cache|column .* does not exist/i.test(row?.message ?? '')
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

  if (!readiness.isReady) {
    return {
      ok: false,
      created: false,
      reusedExisting: false,
      request: null,
      site,
      meteringPoint: candidate,
      readiness,
      requestedStartDate: null,
      blockers: readiness.issues.map((issue) => ({ code: issue.code, message: issue.title })),
    }
  }

  const requestedStartDate = clean(input.requestedStartDate) ?? clean(context.requestedStartDate) ?? clean(site.move_in_date) ?? null

  const existing = await findOpenSupplierSwitchRequestForSite(supabaseService, { companyId, customerId, siteId })
  if (existing) {
    return {
      ok: true,
      created: false,
      reusedExisting: true,
      request: existing,
      site,
      meteringPoint: candidate,
      readiness,
      requestedStartDate: existing.requested_start_date ?? requestedStartDate,
      blockers: [],
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
    automationOrigin: input.automationOrigin,
    automationKey: input.automationKey,
    externalReference: clean(input.externalReference) ?? clean(context.externalCustomerId),
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
    message: requestedStartDate
      ? `Leverantörsbyte är skapat och planeras utifrån önskat startdatum ${requestedStartDate}.`
      : 'Leverantörsbyte är skapat och planeras utifrån tidigast möjliga startdatum.',
    customerSiteId: siteId,
    meteringPointId: candidate.id,
    operationId,
    status: 'queued',
    severity: 'info',
    actionRequired: false,
    source: input.source,
    actionUrl: `/admin/customers/${customerId}?tab=supplier-switch`,
    payload: {
      supplier_switch_request_id: request.id,
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
