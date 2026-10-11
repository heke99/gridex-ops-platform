import { applyPermissionMarketSource, type PermissionMarketTransitionResult } from '@/lib/ediel/permissions/permissionMarketTransition'
import { supabaseService } from '@/lib/supabase/service'
import { tenantDb } from '@/lib/supabase/tenantDb'
import { createEdielMessageEvent } from '@/lib/ediel/db'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { MeteringPermissionRow } from '@/lib/onboarding/infoRequests'
import { enqueueInboundGridOwnerResponseAutomation } from '@/lib/customer-operations/automation'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import { classifyZ02EnqueueFailure } from '@/lib/onboarding/z02EnqueueFailureClassification'

type JsonRecord = Record<string, unknown>

type ApplyResult = {
  applied: boolean
  targetId: string | null
  reason?: string | null
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

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function uuidOrNull(value: unknown): string | null {
  const candidate = stringOrNull(value)
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
}

function readJson(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}
}

function messageReferenceCandidates(message: EdielMessageRow): string[] {
  const parsed = readJson(message.parsed_payload)
  const parsedProdat = message.message_family === 'PRODAT' ? parseProdatMessage(message) : null
  const lineRefs = parsedProdat?.lineItems.flatMap((line) => [
    line.lineItemReference,
    line.permissionId,
    line.agreementReference,
    line.meteringPointId,
  ]) ?? []

  return unique([
    message.external_reference,
    message.transaction_reference,
    message.correlation_reference,
    message.original_message_id,
    message.original_transaction_id,
    stringOrNull(parsed.externalReference),
    stringOrNull(parsed.transactionReference),
    stringOrNull(parsed.caseReference),
    stringOrNull(parsed.permissionReference),
    parsedProdat?.messageReference,
    parsedProdat?.transactionReference,
    parsedProdat?.messageReference,
    ...lineRefs,
  ])
}

function prodatPayloadSnapshot(message: EdielMessageRow): JsonRecord {
  const parsedProdat = parseProdatMessage(message)
  return {
    edielMessageId: message.id,
    messageCode: message.message_code,
    messageReference: parsedProdat.messageReference,
    interchangeReference: parsedProdat.interchangeReference,
    transactionReference: parsedProdat.transactionReference,
    senderEdielId: message.sender_ediel_id ?? parsedProdat.senderEdielId,
    receiverEdielId: message.receiver_ediel_id ?? parsedProdat.receiverEdielId,
    lineItems: parsedProdat.lineItems.map((line) => ({
      facilityId: line.meteringPointId,
      identityAgency: line.identityAgency,
      lineSequenceNumber: line.lineSequenceNumber,
      registerIndex: line.registerIndex,
      registerCount: line.registerCount,
      firstRegisterSourceOrder: line.firstRegisterSourceOrder,
      validRegisterChain: line.validRegisterChain,
      annualConsumption: line.annualConsumption,
      meterConstant: line.meterConstant,
      meterDigitCount: line.meterDigitCount,
      meterTimeFrame: line.meterTimeFrame,
      gridAreaId: line.gridAreaId,
      caseReference: line.lineItemReference,
      permissionReference: line.permissionId,
      customerId: line.customerId,
      endUserId: line.endUserId,
      endUserIdQualifier: line.endUserIdQualifier,
      endUserName: line.endUserName,
      endUserAddress: line.endUserAddress,
      endUserPostcode: line.endUserPostcode,
      endUserCity: line.endUserCity,
      endUserCountry: line.endUserCountry,
      installationId: line.installationId,
      installationAddress: line.installationAddress,
      installationPostcode: line.installationPostcode,
      installationCity: line.installationCity,
      installationCountry: line.installationCountry,
      measuringMethod: line.measuringMethod,
      observationLength: line.observationLength ?? null,
      observationLengthFormat: line.observationLengthFormat ?? null,
      reportingFrequency: line.reportingFrequency,
      permissionStatus: line.permissionStatus,
      permissionPurpose: line.permissionPurpose,
      contractStartDate: line.contractStartDate,
      contractEndDate: line.contractEndDate,
      rawSegments: line.rawSegments,
    })),
  }
}

async function findCustomerInfoRequestForZ02(message: EdielMessageRow): Promise<Record<string, unknown> | null> {
  const companyId = message.company_id ?? null
  if (!companyId) return null

  const references = messageReferenceCandidates(message)
  const exactIds = unique([
    message.grid_owner_data_request_id,
    message.related_message_id,
    message.original_message_id,
  ])

  if (message.grid_owner_data_request_id) {
    const { data, error } = await supabaseService
      .from('customer_info_requests')
      .select('*')
      .eq('company_id', companyId)
      .eq('grid_owner_data_request_id', message.grid_owner_data_request_id)
      .maybeSingle()
    if (error && !isMissingRelationError(error)) throw error
    if (data) return data as Record<string, unknown>
  }

  for (const messageId of exactIds) {
    const { data, error } = await supabaseService
      .from('customer_info_requests')
      .select('*')
      .eq('company_id', companyId)
      .or(`ediel_message_id.eq.${messageId},response_ediel_message_id.eq.${messageId}`)
      .limit(2)
    if (error && !isMissingRelationError(error)) throw error
    if ((data ?? []).length === 1) return data?.[0] as Record<string, unknown>
    if ((data ?? []).length > 1) return null
  }

  if (references.length === 0) return null
  const lookups = await Promise.all([
    supabaseService.from('customer_info_requests').select('*').eq('company_id', companyId).in('external_reference', references).limit(3),
    supabaseService.from('customer_info_requests').select('*').eq('company_id', companyId).in('transaction_reference', references).limit(3),
    supabaseService.from('customer_info_requests').select('*').eq('company_id', companyId).in('correlation_reference', references).limit(3),
  ])
  const candidates = new Map<string, Record<string, unknown>>()
  for (const lookup of lookups) {
    if (lookup.error) {
      if (isMissingRelationError(lookup.error)) continue
      throw lookup.error
    }
    for (const row of (lookup.data ?? []) as Array<Record<string, unknown>>) {
      if (typeof row.id === 'string') candidates.set(row.id, row)
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0] ?? null : null
}

export async function applyInboundProdatZ02ToCustomerInfoRequest(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<ApplyResult> {
  if (params.message.message_family !== 'PRODAT' || String(params.message.message_code).toUpperCase() !== 'Z02') {
    return { applied: false, targetId: null, reason: 'not_z02' }
  }

  const companyId = params.message.company_id
  if (!companyId) return { applied: false, targetId: null, reason: 'missing_company_id' }
  const persistenceActorId=uuidOrNull(params.actorUserId)
  if(!persistenceActorId)throw new Error('ediel_processing_actor_required')
  await assertEdielTenantActor({companyId,actorUserId:persistenceActorId,permission:'metering.write'})

  const request = await findCustomerInfoRequestForZ02(params.message)
  if (!request) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'PRODAT Z02 kunde inte kopplas automatiskt till en uppgiftsbegäran.',
      payload: { references: messageReferenceCandidates(params.message) },
    })
    return { applied: false, targetId: null, reason: 'no_matching_customer_info_request' }
  }

  const eventActorId = persistenceActorId
  const z02Payload = prodatPayloadSnapshot(params.message)
  const linkedCustomerId = String(request.customer_id ?? '') || String(params.message.customer_id ?? '')
  const linkedSiteId = String(request.site_id ?? '') || String(params.message.site_id ?? '')

  // Receipt is message-level evidence only. Do not mark the candidate request
  // verified or pre-link customer/site before the canonical DB gates run.
  await createEdielMessageEvent({
    actorUserId: eventActorId,
    edielMessageId: params.message.id,
    eventType: 'manual_note',
    eventStatus: 'info',
    message: 'PRODAT Z02 mottaget. Canonical korrelation och identitetskontroll startas innan kunddata får ändras.',
    payload: { candidateCustomerInfoRequestId: request.id, z02: z02Payload },
  })

  if (!linkedCustomerId || !linkedSiteId) {
    await supabaseService
      .from('customer_info_requests')
      .update({
        status: 'manual_review_required',
        blocker_code: 'z02_missing_customer_or_site_link',
        blocker_reason: 'Svaret saknar säker koppling till kundens anläggning.',
        next_required_action: 'Granska Z02 och koppla rätt kund/anläggning innan svaret behandlas.',
        updated_by: persistenceActorId,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('id', request.id)
    await tenantDb(companyId).from('customer_info_request_events').insert({
      customer_info_request_id: request.id,
      customer_id: request.customer_id,
      event_type: 'z02_needs_review',
      message: 'Svar från nätägaren kunde inte kopplas säkert till en anläggning.',
      payload: { z02: z02Payload },
      created_by: persistenceActorId,
    })
    return { applied: false, targetId: String(request.id), reason: 'missing_customer_or_site_link' }
  }

  const operationId = uuidOrNull(request.operation_id)
  let responseJob: Awaited<ReturnType<typeof enqueueInboundGridOwnerResponseAutomation>>
  try {
    responseJob = await enqueueInboundGridOwnerResponseAutomation({
      companyId,
      customerId: linkedCustomerId,
      siteId: linkedSiteId,
      meteringPointId: String(request.metering_point_id ?? '') || String(params.message.metering_point_id ?? '') || null,
      requestId: String(request.id),
      edielMessageId: params.message.id,
      actorUserId: persistenceActorId,
      operationId,
    })
  } catch (enqueueError) {
    const enqueueFailureClassification = classifyZ02EnqueueFailure(enqueueError)
    const errorMessage = enqueueError instanceof Error ? enqueueError.message : String(enqueueError)
    await supabaseService
      .from('customer_info_requests')
      .update({
        status: 'manual_review_required',
        blocker_code: 'z02_processing_enqueue_failed',
        blocker_reason: errorMessage,
        next_required_action: 'Granska requestsnapshot och Z02 innan kunddata uppdateras.',
        updated_by: persistenceActorId,
        updated_at: new Date().toISOString(),
      })
      .eq('company_id', companyId)
      .eq('id', request.id)
    await createEdielMessageEvent({
      actorUserId: eventActorId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'error',
      message: 'Z02 kunde inte starta canonical verifiering och applicerades inte.',
      payload: { customerInfoRequestId: request.id, error: errorMessage, enqueueFailureClassification },
    })
    return { applied: false, targetId: String(request.id), reason: 'z02_processing_enqueue_failed' }
  }

  const gateResult = readJson(responseJob.result)
  const atomicCore = readJson(gateResult.z02_atomic_core)
  const atomicApplied =
    gateResult.z02_correlation_status === 'exact' &&
    gateResult.z02_payload_validation_status === 'valid' &&
    gateResult.z02_snapshot_freshness_status === 'valid' &&
    gateResult.z02_atomic_core_applied === true &&
    atomicCore.ok === true

  if (responseJob.status === 'needs_review' || responseJob.status === 'blocked' || !atomicApplied) {
    const reasonCode = stringOrNull(gateResult.reason_code) ?? stringOrNull(gateResult.reason) ?? 'z02_atomic_apply_not_confirmed'
    const blockerReason = stringOrNull(gateResult.blocker_reason) ?? 'Z02 klarade inte hela canonical verifieringskedjan och applicerades inte.'

    if (responseJob.status !== 'needs_review' && responseJob.status !== 'blocked') {
      await supabaseService
        .from('customer_info_requests')
        .update({
          status: 'manual_review_required',
          blocker_code: reasonCode,
          blocker_reason: blockerReason,
          next_required_action: 'Granska Z02-gaterna innan automation återupptas.',
          updated_by: persistenceActorId,
          updated_at: new Date().toISOString(),
        })
        .eq('company_id', companyId)
        .eq('id', request.id)
      await supabaseService
        .from('customer_operation_jobs')
        .update({ status: 'needs_review', last_error: blockerReason, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('id', responseJob.id)
    }

    await tenantDb(companyId).from('customer_info_request_events').insert({
      customer_info_request_id: request.id,
      customer_id: request.customer_id,
      event_type: 'z02_needs_review',
      message: blockerReason,
      payload: { customerOperationJobId: responseJob.id, operationId: responseJob.operationId, reasonCode, gateResult },
      created_by: persistenceActorId,
    })
    await createEdielMessageEvent({
      actorUserId: eventActorId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: blockerReason,
      payload: { customerInfoRequestId: request.id, customerOperationJobId: responseJob.id, reasonCode, gateResult },
    })
    return { applied: false, targetId: String(request.id), reason: reasonCode }
  }

  await tenantDb(companyId).from('customer_info_request_events').insert({
    customer_info_request_id: request.id,
    customer_id: request.customer_id,
    event_type: 'z02_market_verified',
    message: 'PRODAT Z02 passerade canonical korrelation, identitetskontroll, requestsnapshot och atomisk masterdataapply.',
    payload: { customerOperationJobId: responseJob.id, operationId: responseJob.operationId, atomicCore },
    created_by: persistenceActorId,
  })
  await createEdielMessageEvent({
    actorUserId: eventActorId,
    edielMessageId: params.message.id,
    eventType: 'linked',
    eventStatus: 'success',
    message: 'PRODAT Z02 verifierades och applicerades atomiskt mot exakt uppgiftsbegäran.',
    payload: { customerInfoRequestId: request.id, customerOperationJobId: responseJob.id },
  })

  return { applied: true, targetId: String(request.id) }
}

export async function applyInboundProdatZ14ToMeteringPermission(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<ApplyResult & Partial<PermissionMarketTransitionResult>> {
  if (String(params.message.message_code ?? '').toUpperCase().slice(0, 3) !== 'Z14') {
    return { applied: false, targetId: null, reason: 'not_z14' }
  }
  const result = await applyPermissionMarketSource(params)
  await createEdielMessageEvent({
    actorUserId: params.actorUserId, edielMessageId: params.message.id,
    eventType: result.applied ? 'linked' : 'manual_note',
    eventStatus: result.applied && result.reviewRequired !== true ? 'success' : 'warning',
    message: result.reviewRequired === true && result.applied ? 'PRODAT Z14 behandlades för styrkta objekt. Avvisade eller spärrade objekt kräver granskning.'
      : result.applied ? 'PRODAT Z14 behandlades atomiskt mot det källbundna tillståndet; utfallet framgår per begäran.'
      : 'PRODAT Z14 inväntar verifierbar originalbegäran, aktör och tillståndskoppling.',
    payload: { ...result, meteringPermissionId: result.permissionId },
  })
  return { ...result, targetId: result.permissionId }
}

export async function findActiveMeteringPermissionForUtiltsMessage(message: EdielMessageRow): Promise<MeteringPermissionRow | null> {
  const companyId = message.company_id ?? null
  if (!companyId) return null

  const parsed = readJson(message.parsed_payload)
  const normalized = readJson(parsed.normalizedMeteringPayload)
  const facilityId = stringOrNull(normalized.facilityId) ?? stringOrNull(normalized.installationId) ?? stringOrNull(normalized.meteringPointId) ?? stringOrNull(parsed.facilityId)
  const gridAreaCode = stringOrNull(normalized.gridAreaId) ?? stringOrNull(parsed.gridAreaId)
  const caseReference = stringOrNull(normalized.caseReference) ?? stringOrNull(parsed.caseReference) ?? message.external_reference ?? message.transaction_reference

  const statuses = ['active', 'approved', 'z14_received', 'partially_approved']

  if (facilityId) {
    const { data, error } = await supabaseService
      .from('metering_permission_sites')
      .select('metering_permission_id, metering_permissions(*)')
      .eq('company_id', companyId)
      .eq('facility_id', facilityId)
      .in('status', ['approved', 'active'])
      .order('created_at', { ascending: false })
      .limit(10)

    if (!error) {
      const rows = (data ?? []) as unknown as Array<{ metering_permissions?: MeteringPermissionRow | MeteringPermissionRow[] | null }>
      const hit = rows
        .map((row) => Array.isArray(row.metering_permissions) ? row.metering_permissions[0] : row.metering_permissions)
        .find((permission): permission is MeteringPermissionRow => Boolean(permission && statuses.includes(permission.status)))
      if (hit) return hit
    } else if (!isMissingRelationError(error)) {
      throw error
    }
  }

  let query = supabaseService
    .from('metering_permissions')
    .select('*')
    .eq('company_id', companyId)
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(50)

  if (message.customer_id) query = query.eq('customer_id', message.customer_id)
  if (message.metering_point_id) query = query.eq('metering_point_id', message.metering_point_id)

  const { data, error } = await query
  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }

  const rows = (data ?? []) as MeteringPermissionRow[]
  return rows.find((permission) => {
    const refs = unique([permission.case_reference, permission.permission_reference])
    if (caseReference && refs.includes(caseReference)) return true
    if (message.metering_point_id && permission.metering_point_id === message.metering_point_id) return true
    if (gridAreaCode) {
      const meta = readJson((permission as unknown as { metadata?: unknown }).metadata)
      const z14 = readJson(meta.z14)
      const approvedSites = Array.isArray(z14.approvedSites) ? z14.approvedSites as JsonRecord[] : []
      return approvedSites.some((site) => stringOrNull(site.gridAreaCode) === gridAreaCode && (!facilityId || stringOrNull(site.facilityId) === facilityId))
    }
    return false
  }) ?? null
}
