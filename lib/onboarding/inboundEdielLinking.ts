import { supabaseService } from '@/lib/supabase/service'
import { createEdielMessageEvent, linkEdielMessage } from '@/lib/ediel/db'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { MeteringPermissionRow } from '@/lib/onboarding/infoRequests'
import {
  createSupplierSwitchRequest,
  findCustomerSiteById,
  findOpenSupplierSwitchRequestForSite,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  syncOperationTasksFromReadiness,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type { SupplierSwitchRequestType } from '@/lib/operations/types'

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
      gridAreaId: line.gridAreaId,
      caseReference: line.lineItemReference,
      permissionReference: line.permissionId,
      customerId: line.customerId,
      measuringMethod: line.measuringMethod,
      observationLength: line.timeSeriesProduct,
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
  const gridOwnerDataRequestId = message.grid_owner_data_request_id ?? null

  const { data, error } = await supabaseService
    .from('customer_info_requests')
    .select('*')
    .eq('company_id', companyId)
    .in('status', ['z01_prepared', 'route_missing', 'sent_to_grid_owner', 'waiting_for_z02', 'waiting_for_aperak', 'waiting_for_contrl', 'ready_to_send', 'draft', 'manual_review_required'])
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  return rows.find((row) => {
    const payload = readJson(row.verified_payload)
    const payloadReferences = unique([
      stringOrNull(payload.externalReference),
      stringOrNull(payload.caseReference),
      stringOrNull(payload.z01Reference),
      stringOrNull(payload.gridOwnerDataRequestId),
    ])

    if (gridOwnerDataRequestId && payload.gridOwnerDataRequestId === gridOwnerDataRequestId) return true
    if (message.customer_id && row.customer_id === message.customer_id) return true
    return payloadReferences.some((reference) => references.includes(reference))
  }) ?? null
}

async function findMeteringPermissionForZ14(message: EdielMessageRow): Promise<MeteringPermissionRow | null> {
  const companyId = message.company_id ?? null
  if (!companyId) return null

  const parsedProdat = parseProdatMessage(message)
  const references = unique([
    ...messageReferenceCandidates(message),
    ...parsedProdat.lineItems.flatMap((line) => [line.lineItemReference, line.permissionId]),
  ])

  const { data, error } = await supabaseService
    .from('metering_permissions')
    .select('*')
    .eq('company_id', companyId)
    .in('status', ['z13_sent', 'waiting_for_customer_approval', 'draft', 'z13_ready', 'blocked', 'missing_authorization'])
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }

  const rows = (data ?? []) as MeteringPermissionRow[]
  return rows.find((row) => {
    const metadata = readJson((row as unknown as { metadata?: unknown }).metadata)
    const z13 = readJson(metadata.z13)
    const rowRefs = unique([
      row.case_reference,
      row.permission_reference,
      stringOrNull(z13.gridOwnerDataRequestId),
      stringOrNull(z13.outboundRequestId),
    ])

    if (message.grid_owner_data_request_id && z13.gridOwnerDataRequestId === message.grid_owner_data_request_id) return true
    if (message.customer_id && row.customer_id === message.customer_id && references.some((reference) => rowRefs.includes(reference))) return true
    return rowRefs.some((reference) => references.includes(reference))
  }) ?? null
}

function z14ApprovedSitesFromMessage(message: EdielMessageRow): Array<{
  siteId?: string | null
  meteringPointId?: string | null
  facilityId?: string | null
  gridAreaCode?: string | null
  status?: string | null
}> {
  const parsedProdat = parseProdatMessage(message)
  return parsedProdat.lineItems.map((line) => ({
    siteId: message.site_id ?? null,
    meteringPointId: message.metering_point_id ?? null,
    facilityId: line.meteringPointId,
    gridAreaCode: line.gridAreaId,
    status: line.permissionStatus === 'N' || String(message.message_code).toUpperCase() === 'Z14N' ? 'rejected' : 'approved',
  }))
}


async function tryQueueSupplierSwitchAfterZ02(params: {
  actorUserId: string
  companyId: string
  request: Record<string, unknown>
  z02Payload: JsonRecord
}): Promise<{ queued: boolean; reason: string | null; switchRequestId: string | null }> {
  const customerId = stringOrNull(params.request.customer_id)
  const siteId = stringOrNull(params.request.site_id)
  if (!customerId || !siteId) return { queued: false, reason: 'missing_customer_or_site', switchRequestId: null }

  const site = await findCustomerSiteById(supabaseService, siteId)
  if (!site || site.company_id !== params.companyId || site.customer_id !== customerId) {
    return { queued: false, reason: 'site_not_found_or_wrong_tenant', switchRequestId: null }
  }

  const existing = await findOpenSupplierSwitchRequestForSite(supabaseService, {
    customerId,
    siteId,
    companyId: params.companyId,
  })
  if (existing) return { queued: false, reason: 'open_supplier_switch_exists', switchRequestId: existing.id }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabaseService, siteId),
    listPowersOfAttorneyByCustomerId(supabaseService, customerId),
  ])
  const readiness = evaluateSiteSwitchReadiness({ site, meteringPoints, powersOfAttorney })
  await syncOperationTasksFromReadiness(supabaseService, readiness)

  if (!readiness.isReady || !readiness.candidateMeteringPointId) {
    return { queued: false, reason: 'switch_preflight_not_ready', switchRequestId: null }
  }

  const meteringPoint = meteringPoints.find((point) => point.id === readiness.candidateMeteringPointId) ?? null
  if (!meteringPoint) return { queued: false, reason: 'candidate_metering_point_not_found', switchRequestId: null }

  const requestType: SupplierSwitchRequestType = site.move_in_date ? 'move_in' : 'switch'
  const saved = await createSupplierSwitchRequest(supabaseService, {
    readiness,
    site,
    meteringPoint,
    requestType,
    requestedStartDate: site.move_in_date ?? null,
    companyId: params.companyId,
    automationOrigin: 'z02_customer_masterdata_received',
    automationKey: `z02-to-z03:${customerId}:${siteId}:${meteringPoint.id}`,
  })

  await supabaseService.from('supplier_switch_events').insert({
    company_id: params.companyId,
    switch_request_id: saved.id,
    event_type: 'z02_preflight_queued_z03',
    event_status: 'success',
    message: 'PRODAT Z02 uppdaterade kund-/anläggningsdata och systemet köade Z03 eftersom preflight blev grön.',
    payload: { z02: params.z02Payload, customerInfoRequestId: params.request.id ?? null },
    created_by: params.actorUserId,
  })

  return { queued: true, reason: null, switchRequestId: saved.id }
}

export async function applyInboundProdatZ02ToCustomerInfoRequest(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<ApplyResult> {
  if (params.message.message_family !== 'PRODAT' || String(params.message.message_code).toUpperCase() !== 'Z02') {
    return { applied: false, targetId: null, reason: 'not_z02' }
  }

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

  const companyId = params.message.company_id
  if (!companyId) return { applied: false, targetId: null, reason: 'missing_company_id' }

  const currentPayload = readJson(request.verified_payload)
  const z02Payload = prodatPayloadSnapshot(params.message)

  const { error } = await supabaseService
    .from('customer_info_requests')
    .update({
      status: 'z02_received',
      received_at: new Date().toISOString(),
      blocker_reason: null,
      verified_payload: {
        ...currentPayload,
        z02: z02Payload,
        z02MessageId: params.message.id,
        linkedAutomaticallyAt: new Date().toISOString(),
      },
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', request.id)

  if (error) throw error

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    customerId: String(request.customer_id ?? '') || params.message.customer_id,
    siteId: String(request.site_id ?? '') || params.message.site_id,
    meteringPointId: String(request.metering_point_id ?? '') || params.message.metering_point_id,
    gridOwnerId: String(request.grid_owner_id ?? '') || params.message.grid_owner_id,
    relatedMessageId: params.message.related_message_id,
  })

  await supabaseService.from('customer_info_request_events').insert({
    company_id: companyId,
    customer_info_request_id: request.id,
    customer_id: request.customer_id,
    event_type: 'z02_received',
    message: 'PRODAT Z02 kopplades automatiskt till uppgiftsbegäran och verifierade uppgifter sparades.',
    payload: z02Payload,
    created_by: params.actorUserId,
  })

  const autoSwitch = await tryQueueSupplierSwitchAfterZ02({
    actorUserId: params.actorUserId,
    companyId,
    request,
    z02Payload,
  })

  await supabaseService.from('customer_info_request_events').insert({
    company_id: companyId,
    customer_info_request_id: request.id,
    customer_id: request.customer_id,
    event_type: autoSwitch.queued ? 'z03_auto_queued_after_z02' : 'z03_auto_not_queued_after_z02',
    message: autoSwitch.queued
      ? 'Efter Z02 blev preflight grön och systemet köade leverantörsbyte/Z03.'
      : 'Z02 mottogs men leverantörsbyte/Z03 köades inte automatiskt.',
    payload: autoSwitch,
    created_by: params.actorUserId,
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'linked',
    eventStatus: 'success',
    message: 'PRODAT Z02 kopplades automatiskt till uppgiftsbegäran.',
    payload: { customerInfoRequestId: request.id },
  })

  return { applied: true, targetId: String(request.id) }
}

export async function applyInboundProdatZ14ToMeteringPermission(params: {
  actorUserId: string
  message: EdielMessageRow
}): Promise<ApplyResult> {
  if (params.message.message_family !== 'PRODAT' || String(params.message.message_code).toUpperCase() !== 'Z14') {
    return { applied: false, targetId: null, reason: 'not_z14' }
  }

  const permission = await findMeteringPermissionForZ14(params.message)
  if (!permission) {
    await createEdielMessageEvent({
      actorUserId: params.actorUserId,
      edielMessageId: params.message.id,
      eventType: 'manual_note',
      eventStatus: 'warning',
      message: 'PRODAT Z14 kunde inte kopplas automatiskt till ett mätvärdestillstånd.',
      payload: { references: messageReferenceCandidates(params.message) },
    })
    return { applied: false, targetId: null, reason: 'no_matching_metering_permission' }
  }

  const companyId = params.message.company_id
  if (!companyId) return { applied: false, targetId: null, reason: 'missing_company_id' }

  const parsedProdat = parseProdatMessage(params.message)
  const approvedSites = z14ApprovedSitesFromMessage(params.message)
  const hasApproved = approvedSites.some((site) => site.status === 'approved')
  const nextStatus = hasApproved ? (approvedSites.length > 1 ? 'partially_approved' : 'active') : 'rejected_active'
  const firstLine = parsedProdat.lineItems[0]
  const metadata = readJson((permission as unknown as { metadata?: unknown }).metadata)
  const z14Snapshot = prodatPayloadSnapshot(params.message)

  const { error } = await supabaseService
    .from('metering_permissions')
    .update({
      status: nextStatus,
      permission_reference: firstLine?.permissionId ?? permission.permission_reference,
      approved_start_date: firstLine?.contractStartDate ?? permission.approved_start_date,
      approved_end_date: firstLine?.contractEndDate ?? permission.approved_end_date,
      resolution_code: firstLine?.timeSeriesProduct ?? permission.resolution_code,
      report_frequency: firstLine?.reportingFrequency ?? permission.report_frequency,
      source_z14_message_id: params.message.id,
      last_blocker: hasApproved ? null : 'Z14 markerade begäran som nekad.',
      metadata: {
        ...metadata,
        z14: {
          ...z14Snapshot,
          appliedAt: new Date().toISOString(),
          approvedSites,
        },
      },
      updated_by: params.actorUserId,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
    .eq('id', permission.id)

  if (error) throw error

  if (approvedSites.length > 0) {
    const rows = approvedSites.map((site) => ({
      company_id: companyId,
      metering_permission_id: permission.id,
      customer_id: permission.customer_id,
      site_id: site.siteId ?? permission.site_id,
      metering_point_id: site.meteringPointId ?? permission.metering_point_id,
      facility_id: site.facilityId ?? null,
      grid_area_code: site.gridAreaCode ?? null,
      status: site.status ?? 'approved',
      start_date: firstLine?.contractStartDate ?? permission.approved_start_date,
      end_date: firstLine?.contractEndDate ?? permission.approved_end_date,
      metadata: { source: 'inbound_prodat_z14', edielMessageId: params.message.id },
    }))

    const deleteExisting = await supabaseService
      .from('metering_permission_sites')
      .delete()
      .eq('company_id', companyId)
      .eq('metering_permission_id', permission.id)

    if (deleteExisting.error && !isMissingRelationError(deleteExisting.error)) throw deleteExisting.error

    const { error: siteError } = await supabaseService.from('metering_permission_sites').insert(rows)

    if (siteError && !isMissingRelationError(siteError)) throw siteError
  }

  await linkEdielMessage({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    customerId: permission.customer_id,
    siteId: permission.site_id,
    meteringPointId: permission.metering_point_id,
    gridOwnerId: permission.grid_owner_id,
    relatedMessageId: params.message.related_message_id,
  })

  await createEdielMessageEvent({
    actorUserId: params.actorUserId,
    edielMessageId: params.message.id,
    eventType: 'linked',
    eventStatus: hasApproved ? 'success' : 'warning',
    message: hasApproved
      ? 'PRODAT Z14 kopplades automatiskt och mätvärdestillståndet aktiverades.'
      : 'PRODAT Z14 kopplades automatiskt men rapporteringen markerades som nekad.',
    payload: { meteringPermissionId: permission.id, approvedSites },
  })

  return { applied: true, targetId: permission.id }
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
