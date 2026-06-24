import { supabaseService } from '@/lib/supabase/service'
import { findCustomerSiteById, listMeteringPointsForSite, listPowersOfAttorneyByCustomerId, findOpenSupplierSwitchRequestForSite, createSupplierSwitchRequest, syncOperationTasksFromReadiness } from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import { ensureInitialSwitchEdielAutomation } from '@/lib/operations/edielAutomation'
import { finalizeStuckZ01GridOwnerDataRequest } from '@/lib/customer-operations/z01Finalizer'
import { emitCustomerProcessEvent } from '@/lib/customer-operations/customerProcessEvents'
import { evaluateCustomerProcessRouteReadiness } from '@/lib/customer-operations/customerProcessRouteReadiness'
import type { CustomerSiteRow, MeteringPointRow } from '@/lib/masterdata/types'

type JsonRecord = Record<string, unknown>

export type CustomerProcessNextStepTrigger =
  | 'facility_data_received'
  | 'z01_prepared'
  | 'z01_acknowledged'
  | 'supplier_switch_ready'
  | 'manual_review_resolved'

export type CustomerProcessNextStepResult = {
  decision: 'blocked' | 'manual_review' | 'prepare_z01' | 'prepare_supplier_switch' | 'wait_for_ack' | 'skipped'
  actionTaken: string | null
  blockers: Array<{ code: string; message: string; metadata?: JsonRecord }>
  z01?: JsonRecord | null
  supplierSwitchRequestId?: string | null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function firstMeteringPointWithIdentity(points: MeteringPointRow[]): MeteringPointRow | null {
  return points.find((point) => Boolean(point.meter_point_id ?? point.ediel_reference ?? (point as unknown as JsonRecord).metering_point_id)) ?? points[0] ?? null
}

async function findLatestFacilityBlockedCustomerInfo(input: {
  companyId: string
  customerId: string
  siteId?: string | null
}) {
  let query = supabaseService
    .from('customer_info_requests')
    .select('*')
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .order('updated_at', { ascending: false })
    .limit(1)
  if (input.siteId) query = query.eq('site_id', input.siteId)
  const { data, error } = await query.maybeSingle()
  if (error) return null
  return (data as JsonRecord | null) ?? null
}

async function clearFacilityBlocker(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  actorUserId?: string | null
}) {
  let query = supabaseService
    .from('customer_info_requests')
    .update({
      blocker_code: null,
      blocker_reason: null,
      blocker_details: {},
      route_resolution_status: 'facility_identifier_received',
      next_required_action: 'Fortsätt Z01-finalisering.',
      updated_at: new Date().toISOString(),
      updated_by: input.actorUserId ?? null,
    })
    .eq('company_id', input.companyId)
    .eq('customer_id', input.customerId)
    .eq('blocker_code', 'facility_or_metering_point_missing')
  if (input.siteId) query = query.eq('site_id', input.siteId)
  await query.then((result) => {
    if (result.error && !['42P01', '42703', 'PGRST204', 'PGRST205'].includes(result.error.code ?? '')) throw result.error
  })
}

async function tryPrepareZ01(input: {
  companyId: string
  customerId: string
  siteId: string
  operationId?: string | null
  actorUserId: string
}): Promise<CustomerProcessNextStepResult | null> {
  const cir = await findLatestFacilityBlockedCustomerInfo({ companyId: input.companyId, customerId: input.customerId, siteId: input.siteId })
  const gridOwnerDataRequestId = text(cir?.grid_owner_data_request_id) ?? text(cir?.verified_payload && asRecord(cir.verified_payload).gridOwnerDataRequestId)
  if (!gridOwnerDataRequestId && !text(cir?.id)) return null

  await emitCustomerProcessEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.siteId,
    operationId: input.operationId ?? null,
    eventType: 'z01.preparing',
    title: 'Z01 förbereds',
    message: 'Anläggningsuppgifter är mottagna och systemet försöker förbereda Z01.',
    actorUserId: input.actorUserId,
    status: 'in_progress',
    severity: 'info',
    actionRequired: false,
    source: 'customer_process_next_step_engine',
    idempotencyKey: `z01.preparing:${input.companyId}:${input.siteId}:${gridOwnerDataRequestId ?? cir?.id}`,
  })

  const z01 = await finalizeStuckZ01GridOwnerDataRequest({
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    gridOwnerDataRequestId,
    customerInfoRequestId: text(cir?.id),
    environment: 'production',
    dryRun: false,
  })

  if (z01.blockerCode) {
    await emitCustomerProcessEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      customerSiteId: input.siteId,
      operationId: input.operationId ?? null,
      eventType: 'z01.blocked',
      title: 'Z01 blockerad',
      message: z01.blockerReason ?? 'Z01 kunde inte förberedas.',
      actorUserId: input.actorUserId,
      status: 'blocked',
      severity: 'error',
      actionRequired: true,
      source: 'customer_process_next_step_engine',
      payload: z01 as unknown as JsonRecord,
      idempotencyKey: `z01.blocked:${input.companyId}:${input.siteId}:${z01.blockerCode}`,
    })
    return { decision: 'blocked', actionTaken: 'z01_blocked', blockers: [{ code: z01.blockerCode, message: z01.blockerReason ?? z01.blockerCode }], z01: z01 as unknown as JsonRecord }
  }

  await emitCustomerProcessEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.siteId,
    operationId: input.operationId ?? null,
    eventType: 'z01.prepared',
    title: 'Z01 förberedd',
    message: 'Z01 är förberedd och väntar på ordinarie skick-/kvittensflöde.',
    actorUserId: input.actorUserId,
    status: 'waiting_response',
    severity: 'info',
    source: 'customer_process_next_step_engine',
    payload: z01 as unknown as JsonRecord,
    idempotencyKey: `z01.prepared:${input.companyId}:${input.siteId}:${z01.edielMessageId ?? z01.outboundRequestId}`,
  })

  return { decision: 'prepare_z01', actionTaken: 'z01_prepared', blockers: [], z01: z01 as unknown as JsonRecord }
}

async function tryPrepareSupplierSwitch(input: {
  companyId: string
  customerId: string
  site: CustomerSiteRow
  meteringPoint: MeteringPointRow
  actorUserId: string
  operationId?: string | null
}) {
  const existing = await findOpenSupplierSwitchRequestForSite(supabaseService, {
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.site.id,
  })

  if (existing) {
    await emitCustomerProcessEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      customerSiteId: input.site.id,
      meteringPointId: input.meteringPoint.id,
      operationId: input.operationId ?? null,
      eventType: 'supplier_switch.waiting_ack',
      title: 'Leverantörsbyte finns redan',
      message: 'Det finns redan ett öppet leverantörsbyte för anläggningen. Systemet inväntar nästa status.',
      actorUserId: input.actorUserId,
      status: 'waiting_response',
      severity: 'info',
      source: 'customer_process_next_step_engine',
      payload: { supplier_switch_request_id: existing.id, status: existing.status },
      idempotencyKey: `supplier_switch.waiting_ack:${existing.id}`,
    })
    return { switchRequestId: existing.id, alreadyOpen: true }
  }

  const powersOfAttorney = await listPowersOfAttorneyByCustomerId(supabaseService, input.customerId, { companyId: input.companyId })
  const readiness = evaluateSiteSwitchReadiness({ site: input.site, meteringPoints: [input.meteringPoint], powersOfAttorney })
  await syncOperationTasksFromReadiness(supabaseService, readiness)
  if (!readiness.isReady || !readiness.candidateMeteringPointId) {
    await emitCustomerProcessEvent({
      companyId: input.companyId,
      customerId: input.customerId,
      customerSiteId: input.site.id,
      meteringPointId: input.meteringPoint.id,
      operationId: input.operationId ?? null,
      eventType: 'supplier_switch.blocked',
      title: 'Leverantörsbyte kan inte startas ännu',
      message: `Komplettera först: ${readiness.issues.map((issue) => issue.title).join(', ') || 'readiness'}`,
      actorUserId: input.actorUserId,
      status: 'blocked',
      severity: 'error',
      actionRequired: true,
      source: 'customer_process_next_step_engine',
      payload: { readiness },
      idempotencyKey: `supplier_switch.blocked:${input.companyId}:${input.site.id}:readiness`,
    })
    return null
  }

  const routeReadiness = await evaluateCustomerProcessRouteReadiness({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: input.site.id,
    gridOwnerId: input.meteringPoint.grid_owner_id ?? input.site.grid_owner_id ?? null,
    process: 'supplier_switch',
    actorUserId: input.actorUserId,
  })
  if (!routeReadiness.ready) return null

  await emitCustomerProcessEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.site.id,
    meteringPointId: input.meteringPoint.id,
    operationId: input.operationId ?? null,
    eventType: 'supplier_switch.preparing',
    title: 'Leverantörsbyte förbereds',
    message: 'Anläggningsdata är verifierad och systemet förbereder leverantörsbyte.',
    actorUserId: input.actorUserId,
    status: 'in_progress',
    severity: 'info',
    source: 'customer_process_next_step_engine',
    idempotencyKey: `supplier_switch.preparing:${input.companyId}:${input.site.id}`,
  })

  const request = await createSupplierSwitchRequest(supabaseService, {
    readiness,
    site: input.site,
    meteringPoint: input.meteringPoint,
    requestType: 'switch',
    requestedStartDate: null,
    automationOrigin: 'customer_process_next_step_engine',
    automationKey: `facility_data_received:${input.companyId}:${input.site.id}`,
    companyId: input.companyId,
  })

  const automation = await ensureInitialSwitchEdielAutomation({
    actorUserId: input.actorUserId,
    switchRequestId: request.id,
  })

  await emitCustomerProcessEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: input.site.id,
    meteringPointId: input.meteringPoint.id,
    operationId: input.operationId ?? null,
    eventType: 'supplier_switch.requested',
    title: 'Leverantörsbyte förberett',
    message: 'Leverantörsbyte är skapat och Ediel-filen är förberedd i ordinarie utskicksflöde.',
    actorUserId: input.actorUserId,
    status: 'waiting_response',
    severity: 'info',
    source: 'customer_process_next_step_engine',
    payload: { supplier_switch_request_id: request.id, automation },
    idempotencyKey: `supplier_switch.requested:${request.id}`,
  })

  return { switchRequestId: request.id, alreadyOpen: false }
}

export async function evaluateAndRunNextCustomerStep(input: {
  companyId: string
  customerId: string
  siteId?: string | null
  operationId?: string | null
  trigger: CustomerProcessNextStepTrigger
  actorUserId?: string | null
  source?: 'manual' | 'ediel_inbound' | 'system'
  skipZ01Finalization?: boolean
}): Promise<CustomerProcessNextStepResult> {
  const actorUserId = input.actorUserId ?? 'system'
  const blockers: CustomerProcessNextStepResult['blockers'] = []
  if (!input.siteId) {
    return { decision: 'manual_review', actionTaken: null, blockers: [{ code: 'site_missing', message: 'Anläggning saknas för nästa steg.' }] }
  }

  const site = await findCustomerSiteById(supabaseService, input.siteId)
  if (!site || site.company_id !== input.companyId || site.customer_id !== input.customerId) {
    return { decision: 'manual_review', actionTaken: null, blockers: [{ code: 'site_not_found', message: 'Anläggningen kunde inte hittas i rätt tenant.' }] }
  }

  const meteringPoints = await listMeteringPointsForSite(supabaseService, site.id)
  const selectedMeteringPoint = firstMeteringPointWithIdentity(meteringPoints)
  if (!site.facility_id && !selectedMeteringPoint) {
    blockers.push({ code: 'facility_or_metering_point_missing', message: 'Anläggnings-ID eller mätpunkt saknas fortfarande.' })
    return { decision: 'blocked', actionTaken: null, blockers }
  }

  await clearFacilityBlocker({ companyId: input.companyId, customerId: input.customerId, siteId: site.id, actorUserId })
  await emitCustomerProcessEvent({
    companyId: input.companyId,
    customerId: input.customerId,
    customerSiteId: site.id,
    meteringPointId: selectedMeteringPoint?.id ?? null,
    operationId: input.operationId ?? null,
    eventType: 'facility_data.received',
    title: 'Anläggningsuppgifter mottagna',
    message: 'Anläggningsuppgifter är mottagna och nästa steg kontrolleras automatiskt.',
    actorUserId,
    status: 'response_received',
    severity: 'info',
    source: 'customer_process_next_step_engine',
    payload: { trigger: input.trigger, source: input.source ?? 'system' },
    idempotencyKey: `facility_data.received:${input.companyId}:${site.id}:${input.trigger}`,
  })

  const z01Route = await evaluateCustomerProcessRouteReadiness({
    companyId: input.companyId,
    customerId: input.customerId,
    siteId: site.id,
    gridOwnerId: site.grid_owner_id ?? selectedMeteringPoint?.grid_owner_id ?? null,
    process: 'z01_customer_masterdata',
    actorUserId,
  })

  if (z01Route.ready && input.skipZ01Finalization !== true) {
    const z01Result = await tryPrepareZ01({ companyId: input.companyId, customerId: input.customerId, siteId: site.id, operationId: input.operationId ?? null, actorUserId })
    if (z01Result) return z01Result
  }

  if (!selectedMeteringPoint) {
    return { decision: 'blocked', actionTaken: null, blockers: [{ code: 'metering_point_missing', message: 'Leverantörsbyte kräver verifierad mätpunkt.' }] }
  }

  const switchResult = await tryPrepareSupplierSwitch({
    companyId: input.companyId,
    customerId: input.customerId,
    site,
    meteringPoint: selectedMeteringPoint,
    actorUserId,
    operationId: input.operationId ?? null,
  })

  if (switchResult?.switchRequestId) {
    return { decision: 'prepare_supplier_switch', actionTaken: switchResult.alreadyOpen ? 'supplier_switch_already_open' : 'supplier_switch_requested', blockers: [], supplierSwitchRequestId: switchResult.switchRequestId }
  }

  return { decision: z01Route.ready ? 'wait_for_ack' : 'blocked', actionTaken: null, blockers: z01Route.blockers.map((blocker) => ({ code: blocker.code, message: blocker.message, metadata: blocker.metadata })) }
}
