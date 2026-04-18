'use server'

import { revalidatePath } from 'next/cache'
import { createHash } from 'node:crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'
import {
  archiveCustomerAuthorizationDocument,
  assignAuthorizationDocumentToGridOwnerRequest,
  assignAuthorizationDocumentToOutboundRequest,
  buildGridOwnerDataRequestAutomationKey,
  buildOutboundRequestAutomationKey,
  assignAuthorizationDocumentToSwitchRequest,
  createAuditLogEntry,
  createSupplierSwitchEvent,
  createSupplierSwitchRequest,
  buildSupplierSwitchRequestAutomationKey,
  findCustomerSiteById,
  findOpenGridOwnerDataRequestByDocument,
  findOpenOutboundRequestByDocument,
  findOpenSupplierSwitchRequestForSite,
  getCustomerAuthorizationDocumentById,
  listActiveCustomerAuthorizationDocumentsByScope,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  listSupplierSwitchRequestsByCustomerId,
  buildDocumentUploadIdempotencyKey,
  findExistingCustomerAuthorizationDocumentByFingerprint,
  saveCustomerAuthorizationDocument,
  savePowerOfAttorney,
  setCustomerAuthorizationDocumentAsActive,
  syncCustomerOperationsForCustomer,
  syncCustomerOperationsForSite,
  updateSupplierSwitchRequestStatus,
  updateSupplierSwitchValidationSnapshot,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type {
  CustomerAuthorizationDocumentRow,
  SupplierSwitchRequestType,
} from '@/lib/operations/types'
import {
  createGridOwnerDataRequest,
  createOutboundRequest,
  findOpenOutboundBySource,
  listGridOwnerDataRequestsByCustomerId,
  listOutboundRequestsByCustomerId,
  updateGridOwnerDataRequestStatus,
  updateOutboundRequestStatus,
} from '@/lib/cis/db'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

function sanitizeFileName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
}

function buildCustomerDocumentPath(params: {
  customerId: string
  siteId: string | null
  documentType: 'power_of_attorney' | 'complete_agreement'
  fileName: string
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const scope = params.siteId ? `site-${params.siteId}` : 'customer'
  return `${params.customerId}/${scope}/${params.documentType}/${stamp}_${sanitizeFileName(params.fileName)}`
}

function normalizeDateOrNull(value: string | null): string | null {
  return value?.trim() ? value.trim() : null
}

function parseCheckbox(value: FormDataEntryValue | null): boolean {
  if (typeof value !== 'string') return false
  return value === 'on' || value === 'true' || value === '1'
}

function toBoolean(formData: FormData, key: string): boolean {
  return parseCheckbox(formData.get(key))
}

function normalizeSwitchRequestType(
  value: string | null
): SupplierSwitchRequestType {
  if (value === 'move_in') return 'move_in'
  if (value === 'move_out_takeover') return 'move_out_takeover'
  return 'switch'
}

function normalizeJsonObject(
  value: unknown
): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function getRecordValue(
  value: unknown,
  key: string
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

function getString(
  value: unknown,
  key: string
): string | null {
  const raw = getRecordValue(value, key)
  return typeof raw === 'string' ? raw : null
}

type ArchiveLinkedRecordsImpact = {
  cancelledGridOwnerRequestIds: string[]
  flaggedGridOwnerRequestIds: string[]
  cancelledOutboundIds: string[]
  flaggedOutboundIds: string[]
  failedSwitchRequestIds: string[]
  flaggedSwitchRequestIds: string[]
}

function mergeObjectRecord(
  base: unknown,
  extra: Record<string, unknown>
): Record<string, unknown> {
  if (base && typeof base === 'object' && !Array.isArray(base)) {
    return {
      ...(base as Record<string, unknown>),
      ...extra,
    }
  }

  return { ...extra }
}

async function handleArchivedDocumentLinkedRecords(params: {
  actorUserId: string
  customerId: string
  document: CustomerAuthorizationDocumentRow
  reason: string
}): Promise<ArchiveLinkedRecordsImpact> {
  const supabase = await createSupabaseServerClient()
  const impact: ArchiveLinkedRecordsImpact = {
    cancelledGridOwnerRequestIds: [],
    flaggedGridOwnerRequestIds: [],
    cancelledOutboundIds: [],
    flaggedOutboundIds: [],
    failedSwitchRequestIds: [],
    flaggedSwitchRequestIds: [],
  }

  const [gridOwnerDataRequests, outboundRequests, switchRequests] = await Promise.all([
    listGridOwnerDataRequestsByCustomerId(params.customerId),
    listOutboundRequestsByCustomerId(params.customerId),
    listSupplierSwitchRequestsByCustomerId(supabase, params.customerId),
  ])

  const matchingGridOwnerRequests = gridOwnerDataRequests.filter((row) => {
    const directMatch = row.authorization_document_id === params.document.id
    const responseMatch =
      getString(row.response_payload, 'authorizationDocumentId') === params.document.id
    const requestMatch =
      getString(row.request_payload, 'authorizationDocumentId') === params.document.id
    return directMatch || responseMatch || requestMatch
  })

  const matchingSwitchRequests = switchRequests.filter((row) => {
    const directMatch = row.authorization_document_id === params.document.id
    const snapshotMatch =
      getString(row.validation_snapshot, 'authorizationDocumentId') ===
        params.document.id ||
      getString(row.validation_snapshot, 'sourceDocumentId') === params.document.id

    const poaMatch =
      Boolean(params.document.power_of_attorney_id) &&
      row.power_of_attorney_id === params.document.power_of_attorney_id

    return directMatch || snapshotMatch || poaMatch
  })

  const matchingGridOwnerRequestIds = new Set(
    matchingGridOwnerRequests.map((row) => row.id)
  )
  const matchingSwitchRequestIds = new Set(
    matchingSwitchRequests.map((row) => row.id)
  )

  const matchingOutbounds = outboundRequests.filter((row) => {
    const directMatch = row.authorization_document_id === params.document.id
    const payloadMatch =
      getString(row.payload, 'authorizationDocumentId') === params.document.id ||
      getString(row.response_payload, 'authorizationDocumentId') === params.document.id

    const switchSourceMatch =
      row.source_type === 'supplier_switch_request' &&
      typeof row.source_id === 'string' &&
      matchingSwitchRequestIds.has(row.source_id)

    const gridOwnerSourceMatch =
      row.source_type === 'grid_owner_data_request' &&
      typeof row.source_id === 'string' &&
      matchingGridOwnerRequestIds.has(row.source_id)

    return directMatch || payloadMatch || switchSourceMatch || gridOwnerSourceMatch
  })

  for (const row of matchingGridOwnerRequests) {
    const nextPayload = mergeObjectRecord(row.response_payload, {
      documentArchived: true,
      documentArchivedAt: new Date().toISOString(),
      documentArchivedReason: params.reason,
      authorizationDocumentId: params.document.id,
    })

    if (row.status === 'pending') {
      await updateGridOwnerDataRequestStatus({
        actorUserId: params.actorUserId,
        requestId: row.id,
        status: 'cancelled',
        externalReference: row.external_reference,
        responsePayload: nextPayload,
        notes: row.notes
          ? `${row.notes}\n\nAutomatisk markering: request stoppades eftersom dokument ${params.document.id} arkiverades. Orsak: ${params.reason}`
          : `Automatisk markering: request stoppades eftersom dokument ${params.document.id} arkiverades. Orsak: ${params.reason}`,
      })
      impact.cancelledGridOwnerRequestIds.push(row.id)
      continue
    }

    await supabaseService
      .from('grid_owner_data_requests')
      .update({
        response_payload: nextPayload,
        notes: row.notes
          ? `${row.notes}\n\nFlaggad: kopplat dokument ${params.document.id} har arkiverats. Orsak: ${params.reason}`
          : `Flaggad: kopplat dokument ${params.document.id} har arkiverats. Orsak: ${params.reason}`,
        updated_by: params.actorUserId,
      })
      .eq('id', row.id)

    impact.flaggedGridOwnerRequestIds.push(row.id)
  }

  for (const row of matchingOutbounds) {
    const nextPayload = mergeObjectRecord(row.response_payload, {
      documentArchived: true,
      documentArchivedAt: new Date().toISOString(),
      documentArchivedReason: params.reason,
      authorizationDocumentId: params.document.id,
    })

    if (row.status === 'queued' || row.status === 'prepared') {
      await updateOutboundRequestStatus({
        actorUserId: params.actorUserId,
        outboundRequestId: row.id,
        status: 'cancelled',
        externalReference: row.external_reference,
        failureReason: `Outbound stoppades eftersom dokument ${params.document.id} arkiverades. Orsak: ${params.reason}`,
        responsePayload: nextPayload,
      })
      impact.cancelledOutboundIds.push(row.id)
      continue
    }

    await supabaseService
      .from('outbound_requests')
      .update({
        response_payload: nextPayload,
        updated_by: params.actorUserId,
      })
      .eq('id', row.id)

    impact.flaggedOutboundIds.push(row.id)
  }

  for (const row of matchingSwitchRequests) {
    const nextSnapshot = mergeObjectRecord(row.validation_snapshot, {
      documentArchived: true,
      documentArchivedAt: new Date().toISOString(),
      documentArchivedReason: params.reason,
      authorizationDocumentId: params.document.id,
    })

    if (row.status === 'draft' || row.status === 'queued' || row.status === 'submitted') {
      await updateSupplierSwitchRequestStatus(supabase, {
        requestId: row.id,
        status: 'failed',
        externalReference: row.external_reference,
        failureReason: `Switchärendet stoppades eftersom dokument ${params.document.id} arkiverades. Orsak: ${params.reason}`,
      })

      await updateSupplierSwitchValidationSnapshot(supabase, {
        requestId: row.id,
        validationSnapshot: nextSnapshot,
      })

      impact.failedSwitchRequestIds.push(row.id)
      continue
    }

    await updateSupplierSwitchValidationSnapshot(supabase, {
      requestId: row.id,
      validationSnapshot: nextSnapshot,
    })

    await createSupplierSwitchEvent(supabase, {
      switchRequestId: row.id,
      eventType: 'document_archived_flagged',
      eventStatus: row.status,
      message: `Kopplat dokument ${params.document.id} arkiverades. Orsak: ${params.reason}`,
      payload: {
        authorizationDocumentId: params.document.id,
        archivedReason: params.reason,
      },
    })

    impact.flaggedSwitchRequestIds.push(row.id)
  }

  return impact
}

export type UploadCustomerAuthorizationDocumentActionState = {
  status: 'idle' | 'success' | 'duplicate' | 'error'
  message: string | null
  documentId: string | null
  duplicateDocumentId: string | null
}

export const initialUploadCustomerAuthorizationDocumentActionState: UploadCustomerAuthorizationDocumentActionState =
  {
    status: 'idle',
    message: null,
    documentId: null,
    duplicateDocumentId: null,
  }

type UploadAutomationDecision = {
  shouldCreateGridOwnerRequests: boolean
  shouldCreateSwitchRequest: boolean
  shouldQueueSwitchOutbound: boolean
  includeCustomerMasterdata: boolean
  includeMeterValues: boolean
  includeBillingUnderlay: boolean
  resolvedMeteringPointId: string | null
  resolvedGridOwnerId: string | null
  blockedReasons: string[]
  warnings: string[]
}

function formatMessageLines(lines: Array<string | null | undefined>): string {
  return lines
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function isIsoDateBefore(left: string | null, right: string | null): boolean {
  if (!left || !right) return false
  return left < right
}

async function buildFileChecksum(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  return createHash('sha256').update(buffer).digest('hex')
}

async function getActor() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

async function queueGridOwnerRequestsFromDocument(params: {
  actorUserId: string
  customerId: string
  siteId: string
  document: CustomerAuthorizationDocumentRow
  meteringPointId: string | null
  gridOwnerId: string | null
  externalReference: string | null
  requestedPeriodStart: string | null
  requestedPeriodEnd: string | null
  notes: string | null
  includeCustomerMasterdata: boolean
  includeMeterValues: boolean
  includeBillingUnderlay: boolean
}) {
  const supabase = await createSupabaseServerClient()
  const createdGridOwnerRequestIds: string[] = []
  const createdOutboundIds: string[] = []

  const maybeCreate = async (
    scope: 'customer_masterdata' | 'meter_values' | 'billing_underlay',
    enabled: boolean
  ) => {
    if (!enabled) return

    const requestType = scope === 'billing_underlay' ? 'billing_underlay' : 'meter_values'

    let saved = await findOpenGridOwnerDataRequestByDocument(supabase, {
      customerId: params.customerId,
      siteId: params.siteId,
      meteringPointId: params.meteringPointId,
      requestScope: scope,
      documentId: params.document.id,
    })

    if (!saved) {
      saved = await createGridOwnerDataRequest({
        actorUserId: params.actorUserId,
        customerId: params.customerId,
        siteId: params.siteId,
        meteringPointId: params.meteringPointId,
        gridOwnerId: params.gridOwnerId,
        requestScope: scope,
        requestedPeriodStart: params.requestedPeriodStart,
        requestedPeriodEnd: params.requestedPeriodEnd,
        externalReference: params.externalReference,
        notes: params.notes
          ? `${params.notes}

Bilaga: ${params.document.file_path}`
          : `Bilaga: ${params.document.file_path}`,
        automationOrigin: 'document_upload',
        automationKey: buildGridOwnerDataRequestAutomationKey({
          documentId: params.document.id,
          requestScope: scope,
        }),
      })

      await assignAuthorizationDocumentToGridOwnerRequest(supabase, {
        requestId: saved.id,
        documentId: params.document.id,
      })
    }

    let outbound = await findOpenOutboundRequestByDocument(supabase, {
      customerId: params.customerId,
      siteId: params.siteId,
      meteringPointId: params.meteringPointId,
      requestType,
      documentId: params.document.id,
      sourceType: 'grid_owner_data_request',
      sourceId: saved.id,
    })

    if (!outbound) {
      outbound = await createOutboundRequest({
        actorUserId: params.actorUserId,
        customerId: params.customerId,
        siteId: params.siteId,
        meteringPointId: params.meteringPointId,
        gridOwnerId: params.gridOwnerId,
        requestType,
        sourceType: 'grid_owner_data_request',
        sourceId: saved.id,
        payload: {
          authorizationDocumentId: params.document.id,
          authorizationDocumentType: params.document.document_type,
          authorizationDocumentTitle: params.document.title,
          authorizationDocumentPath: params.document.file_path,
          requestScope: scope,
          gridOwnerDataRequestId: saved.id,
          createdFrom: 'document_upload',
        },
        periodStart: params.requestedPeriodStart,
        periodEnd: params.requestedPeriodEnd,
        externalReference: params.externalReference,
        automationOrigin: 'document_upload',
        automationKey: buildOutboundRequestAutomationKey({
          documentId: params.document.id,
          requestType,
          sourceType: 'grid_owner_data_request',
        }),
      })

      await assignAuthorizationDocumentToOutboundRequest(supabase, {
        outboundRequestId: outbound.id,
        documentId: params.document.id,
      })
    }

    await updateGridOwnerDataRequestStatus({
      actorUserId: params.actorUserId,
      requestId: saved.id,
      status: outbound.status === 'sent' ? 'sent' : 'pending',
      externalReference: params.externalReference ?? outbound.external_reference ?? null,
      responsePayload: {
        outboundRequestId: outbound.id,
        authorizationDocumentId: params.document.id,
        queuedAutomatically: true,
        createdFrom: 'document_upload',
        idempotentReuse: true,
      },
      notes: saved.notes ?? null,
    })

    createdGridOwnerRequestIds.push(saved.id)
    createdOutboundIds.push(outbound.id)
  }

  await maybeCreate('customer_masterdata', params.includeCustomerMasterdata)
  await maybeCreate('meter_values', params.includeMeterValues)
  await maybeCreate('billing_underlay', params.includeBillingUnderlay)

  return {
    createdGridOwnerRequestIds,
    createdOutboundIds,
  }
}

async function ensureSwitchRequestAndOutboundFromDocument(params: {
  actorUserId: string
  customerId: string
  siteId: string
  document: CustomerAuthorizationDocumentRow
  requestType: SupplierSwitchRequestType
  requestedStartDate: string | null
  autoQueueOutbound: boolean
}): Promise<{
  switchRequestId: string | null
  switchOutboundId: string | null
  switchRequestCreated: boolean
  readinessIssues: Array<{ code?: unknown; title?: unknown }> | null
}> {
  const supabase = await createSupabaseServerClient()

  const site = await findCustomerSiteById(supabase, params.siteId)
  if (!site) {
    throw new Error('Anläggningen hittades inte för switchskapande')
  }

  const [meteringPoints, powersOfAttorney] = await Promise.all([
    listMeteringPointsForSite(supabase, params.siteId),
    listPowersOfAttorneyByCustomerId(supabase, params.customerId),
  ])

  const readiness = evaluateSiteSwitchReadiness({
    site,
    meteringPoints,
    powersOfAttorney,
  })

  const point =
    meteringPoints.find((row) => row.id === readiness.candidateMeteringPointId) ??
    meteringPoints.find((row) => row.status === 'active') ??
    meteringPoints[0] ??
    null

  if (!readiness.isReady || !point) {
    return {
      switchRequestId: null,
      switchOutboundId: null,
      switchRequestCreated: false,
      readinessIssues: readiness.issues.map((issue) => ({
        code: issue.code,
        title: issue.title,
      })),
    }
  }

  let switchRequest = await findOpenSupplierSwitchRequestForSite(supabase, {
    customerId: params.customerId,
    siteId: params.siteId,
  })

  let switchRequestCreated = false

  if (!switchRequest) {
    switchRequest = await createSupplierSwitchRequest(supabase, {
      readiness,
      site,
      meteringPoint: point,
      requestType: params.requestType,
      requestedStartDate: params.requestedStartDate,
      authorizationDocumentId: params.document.id,
      automationOrigin: 'document_upload',
      automationKey: buildSupplierSwitchRequestAutomationKey(params.document.id),
    })

    switchRequestCreated = true
  }

  const currentSnapshot = normalizeJsonObject(switchRequest.validation_snapshot)

  switchRequest = await updateSupplierSwitchValidationSnapshot(supabase, {
    requestId: switchRequest.id,
    validationSnapshot: {
      ...currentSnapshot,
      authorizationDocumentId: params.document.id,
      authorizationDocumentType: params.document.document_type,
      authorizationDocumentTitle: params.document.title,
      authorizationDocumentPath: params.document.file_path,
      createdFrom: switchRequestCreated ? 'document_upload' : 'document_upload_existing_request',
    },
  })

  await assignAuthorizationDocumentToSwitchRequest(supabase, {
    requestId: switchRequest.id,
    documentId: params.document.id,
  })

  let switchOutboundId: string | null = null

  if (params.autoQueueOutbound) {
    const existingOutbound =
      (await findOpenOutboundRequestByDocument(supabase, {
        customerId: switchRequest.customer_id,
        siteId: switchRequest.site_id,
        meteringPointId: switchRequest.metering_point_id,
        requestType: 'supplier_switch',
        documentId: params.document.id,
        sourceType: 'supplier_switch_request',
        sourceId: switchRequest.id,
      })) ??
      (await findOpenOutboundBySource({
        sourceType: 'supplier_switch_request',
        sourceId: switchRequest.id,
        requestType: 'supplier_switch',
      }))

    if (existingOutbound) {
      await assignAuthorizationDocumentToOutboundRequest(supabase, {
        outboundRequestId: existingOutbound.id,
        documentId: params.document.id,
      })

      switchOutboundId = existingOutbound.id
    } else {
      const outbound = await createOutboundRequest({
        actorUserId: params.actorUserId,
        customerId: switchRequest.customer_id,
        siteId: switchRequest.site_id,
        meteringPointId: switchRequest.metering_point_id,
        gridOwnerId: point.grid_owner_id ?? switchRequest.grid_owner_id ?? null,
        requestType: 'supplier_switch',
        sourceType: 'supplier_switch_request',
        sourceId: switchRequest.id,
        payload: {
          authorizationDocumentId: params.document.id,
          authorizationDocumentType: params.document.document_type,
          authorizationDocumentTitle: params.document.title,
          authorizationDocumentPath: params.document.file_path,
          requestType: switchRequest.request_type,
          requestedStartDate: switchRequest.requested_start_date,
          currentSupplierName: switchRequest.current_supplier_name,
          createdFrom: 'document_upload',
        },
        periodStart: switchRequest.requested_start_date ?? null,
        externalReference: switchRequest.external_reference ?? null,
        automationOrigin: 'document_upload',
        automationKey: buildOutboundRequestAutomationKey({
          documentId: params.document.id,
          requestType: 'supplier_switch',
          sourceType: 'supplier_switch_request',
        }),
      })

      await assignAuthorizationDocumentToOutboundRequest(supabase, {
        outboundRequestId: outbound.id,
        documentId: params.document.id,
      })

      switchOutboundId = outbound.id

      await createSupplierSwitchEvent(supabase, {
        switchRequestId: switchRequest.id,
        eventType: 'outbound_queued',
        eventStatus: outbound.status,
        message: `Outbound ${outbound.id} köad direkt från dokumentuppladdning.`,
        payload: {
          outboundRequestId: outbound.id,
          authorizationDocumentId: params.document.id,
          channelType: outbound.channel_type,
          routeId: outbound.communication_route_id,
        },
      })
    }
  }

  return {
    switchRequestId: switchRequest.id,
    switchOutboundId,
    switchRequestCreated,
    readinessIssues: null,
  }
}

async function resolveUploadAutomationDecision(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  customerId: string
  siteId: string | null
  documentType: 'power_of_attorney' | 'complete_agreement'
  markAsSigned: boolean
  savedPowerOfAttorneyId: string | null
  autoCreateGridOwnerRequests: boolean
  includeCustomerMasterdata: boolean
  includeMeterValues: boolean
  includeBillingUnderlay: boolean
  autoCreateSwitchRequest: boolean
  autoQueueSwitchOutbound: boolean
}): Promise<UploadAutomationDecision> {
  const blockedReasons: string[] = []
  const warnings: string[] = []

  let shouldCreateGridOwnerRequests = params.autoCreateGridOwnerRequests
  let shouldCreateSwitchRequest = params.autoCreateSwitchRequest
  let shouldQueueSwitchOutbound = params.autoQueueSwitchOutbound
  let includeCustomerMasterdata =
    params.autoCreateGridOwnerRequests && params.includeCustomerMasterdata
  let includeMeterValues =
    params.autoCreateGridOwnerRequests && params.includeMeterValues
  let includeBillingUnderlay =
    params.autoCreateGridOwnerRequests && params.includeBillingUnderlay
  let resolvedMeteringPointId: string | null = null
  let resolvedGridOwnerId: string | null = null

  if (
    !params.siteId &&
    (shouldCreateGridOwnerRequests || shouldCreateSwitchRequest || shouldQueueSwitchOutbound)
  ) {
    blockedReasons.push(
      'Automatiska request-/switch-steg hoppades över eftersom ingen anläggning valdes.'
    )

    return {
      shouldCreateGridOwnerRequests: false,
      shouldCreateSwitchRequest: false,
      shouldQueueSwitchOutbound: false,
      includeCustomerMasterdata: false,
      includeMeterValues: false,
      includeBillingUnderlay: false,
      resolvedMeteringPointId: null,
      resolvedGridOwnerId: null,
      blockedReasons,
      warnings,
    }
  }

  if (!params.siteId) {
    return {
      shouldCreateGridOwnerRequests,
      shouldCreateSwitchRequest,
      shouldQueueSwitchOutbound,
      includeCustomerMasterdata,
      includeMeterValues,
      includeBillingUnderlay,
      resolvedMeteringPointId,
      resolvedGridOwnerId,
      blockedReasons,
      warnings,
    }
  }

  const site = await findCustomerSiteById(params.supabase, params.siteId)
  if (!site) {
    blockedReasons.push('Automatiska steg stoppades eftersom vald anläggning inte hittades.')

    return {
      shouldCreateGridOwnerRequests: false,
      shouldCreateSwitchRequest: false,
      shouldQueueSwitchOutbound: false,
      includeCustomerMasterdata: false,
      includeMeterValues: false,
      includeBillingUnderlay: false,
      resolvedMeteringPointId: null,
      resolvedGridOwnerId: null,
      blockedReasons,
      warnings,
    }
  }

  const siteMeteringPoints = await listMeteringPointsForSite(params.supabase, params.siteId)
  const preferredMeteringPoint =
    siteMeteringPoints.find((row) => row.status === 'active') ??
    siteMeteringPoints.find((row) => row.status === 'pending_validation') ??
    siteMeteringPoints[0] ??
    null

  resolvedMeteringPointId = preferredMeteringPoint?.id ?? null
  resolvedGridOwnerId =
    preferredMeteringPoint?.grid_owner_id ?? site.grid_owner_id ?? null

  if (!includeCustomerMasterdata && !includeMeterValues && !includeBillingUnderlay) {
    shouldCreateGridOwnerRequests = false
  }

  if (!preferredMeteringPoint) {
    if (includeMeterValues) {
      includeMeterValues = false
      warnings.push('Mätvärdesbegäran skapades inte eftersom anläggningen saknar mätpunkt.')
    }

    if (includeBillingUnderlay) {
      includeBillingUnderlay = false
      warnings.push('Billing-underlag skapades inte eftersom anläggningen saknar mätpunkt.')
    }

    if (shouldCreateSwitchRequest || shouldQueueSwitchOutbound) {
      shouldCreateSwitchRequest = false
      shouldQueueSwitchOutbound = false
      blockedReasons.push(
        'Supplier switch/outbound skapades inte eftersom anläggningen saknar mätpunkt.'
      )
    }
  }

  if (!includeCustomerMasterdata && !includeMeterValues && !includeBillingUnderlay) {
    shouldCreateGridOwnerRequests = false
  }

  if (params.documentType === 'complete_agreement' && !params.savedPowerOfAttorneyId) {
    if (shouldCreateSwitchRequest || shouldQueueSwitchOutbound) {
      shouldCreateSwitchRequest = false
      shouldQueueSwitchOutbound = false
      blockedReasons.push(
        'Supplier switch/outbound stoppades eftersom komplett avtal inte skapade någon kopplad fullmakt.'
      )
    }
  }

  if ((shouldCreateSwitchRequest || shouldQueueSwitchOutbound) && !params.markAsSigned) {
    shouldCreateSwitchRequest = false
    shouldQueueSwitchOutbound = false
    blockedReasons.push(
      'Supplier switch/outbound stoppades eftersom dokumentet inte markerades som signerat.'
    )
  }

  return {
    shouldCreateGridOwnerRequests,
    shouldCreateSwitchRequest,
    shouldQueueSwitchOutbound,
    includeCustomerMasterdata,
    includeMeterValues,
    includeBillingUnderlay,
    resolvedMeteringPointId,
    resolvedGridOwnerId,
    blockedReasons,
    warnings,
  }
}

export async function uploadCustomerAuthorizationDocumentAction(
  _previousState: UploadCustomerAuthorizationDocumentActionState,
  formData: FormData
): Promise<UploadCustomerAuthorizationDocumentActionState> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()

  const customerId = formValue(formData, 'customer_id') ?? ''
  const siteId = formValue(formData, 'site_id') || null
  const documentType =
    (formValue(formData, 'document_type') as
      | 'power_of_attorney'
      | 'complete_agreement'
      | null) ?? 'power_of_attorney'

  const title = formValue(formData, 'title') || null
  const reference = formValue(formData, 'reference') || null
  const notes = formValue(formData, 'notes') || null
  const validFrom = normalizeDateOrNull(formValue(formData, 'valid_from'))
  const validTo = normalizeDateOrNull(formValue(formData, 'valid_to'))
  const requestedStartDate = normalizeDateOrNull(
    formValue(formData, 'requested_start_date')
  )
  const requestedPeriodStart = normalizeDateOrNull(
    formValue(formData, 'requested_period_start')
  )
  const requestedPeriodEnd = normalizeDateOrNull(
    formValue(formData, 'requested_period_end')
  )
  const externalReference = formValue(formData, 'external_reference') || null

  const markAsSigned = toBoolean(formData, 'mark_as_signed')
  const syncToPowerOfAttorney = toBoolean(formData, 'sync_to_power_of_attorney')
  const setAsActive = toBoolean(formData, 'set_as_active')
  const archivePreviousActive = toBoolean(formData, 'archive_previous_active')
  const autoCreateGridOwnerRequests = toBoolean(
    formData,
    'auto_create_grid_owner_requests'
  )
  const includeCustomerMasterdata = toBoolean(
    formData,
    'include_customer_masterdata'
  )
  const includeMeterValues = toBoolean(formData, 'include_meter_values')
  const includeBillingUnderlay = toBoolean(
    formData,
    'include_billing_underlay'
  )
  const autoCreateSwitchRequest = toBoolean(formData, 'auto_create_switch_request')
  const autoQueueSwitchOutbound = toBoolean(
    formData,
    'auto_queue_switch_outbound'
  )
  const replaceDocumentId = formValue(formData, 'replace_document_id') || null
  const requestType = normalizeSwitchRequestType(formValue(formData, 'request_type'))
  const fileValue = formData.get('document_file')

  if (!customerId) {
    return {
      status: 'error',
      message: 'Customer ID saknas.',
      documentId: null,
      duplicateDocumentId: null,
    }
  }

  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return {
      status: 'error',
      message: 'Du måste välja en fil att ladda upp.',
      documentId: null,
      duplicateDocumentId: null,
    }
  }

  if (isIsoDateBefore(validTo, validFrom)) {
    return {
      status: 'error',
      message: 'Giltig till kan inte vara tidigare än giltig från.',
      documentId: null,
      duplicateDocumentId: null,
    }
  }

  if (isIsoDateBefore(requestedPeriodEnd, requestedPeriodStart)) {
    return {
      status: 'error',
      message: 'Begär period till kan inte vara tidigare än begär period från.',
      documentId: null,
      duplicateDocumentId: null,
    }
  }

  const fileChecksum = await buildFileChecksum(fileValue)
  const uploadIdempotencyKey = buildDocumentUploadIdempotencyKey({
    customerId,
    siteId,
    documentType,
    fileChecksum,
  })

  if (replaceDocumentId) {
    const replacementTarget = await getCustomerAuthorizationDocumentById(
      supabase,
      replaceDocumentId
    )

    if (!replacementTarget) {
      return {
        status: 'error',
        message: 'Dokumentet som skulle ersättas hittades inte.',
        documentId: null,
        duplicateDocumentId: null,
      }
    }

    const sameCustomer = replacementTarget.customer_id === customerId
    const sameType = replacementTarget.document_type === documentType
    const sameScope = (replacementTarget.site_id ?? null) === siteId

    if (!sameCustomer || !sameType || !sameScope) {
      return {
        status: 'error',
        message:
          'Ersättningsdokumentet måste tillhöra samma kund, samma dokumenttyp och samma scope/anläggning.',
        documentId: null,
        duplicateDocumentId: null,
      }
    }
  }

  const existingDocument = await findExistingCustomerAuthorizationDocumentByFingerprint(
    supabase,
    {
      customerId,
      siteId,
      documentType,
      fileChecksum,
    }
  )

  if (existingDocument) {
    revalidatePath(`/admin/customers/${customerId}`)

    return {
      status: 'duplicate',
      message: `Dokumentet finns redan. Befintligt dokument ${existingDocument.id} återanvändes i stället för ny upload.`,
      documentId: existingDocument.id,
      duplicateDocumentId: existingDocument.id,
    }
  }

  const bucket = 'customer-documents'
  const filePath = buildCustomerDocumentPath({
    customerId,
    siteId,
    documentType,
    fileName: fileValue.name || 'document.pdf',
  })

  const uploadResult = await supabaseService.storage
    .from(bucket)
    .upload(filePath, fileValue, {
      contentType: fileValue.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadResult.error) throw uploadResult.error

  let savedPowerOfAttorneyId: string | null = null

  if (syncToPowerOfAttorney || documentType === 'power_of_attorney') {
    const savedPowerOfAttorney = await savePowerOfAttorney(supabase, {
      customer_id: customerId,
      site_id: siteId,
      scope: 'supplier_switch',
      status: markAsSigned ? 'signed' : 'sent',
      signed_at: markAsSigned ? new Date().toISOString() : null,
      valid_from: validFrom,
      valid_to: validTo,
      document_path: filePath,
      reference,
      notes,
    })

    savedPowerOfAttorneyId = savedPowerOfAttorney.id
  }

  const savedDocument = await saveCustomerAuthorizationDocument(supabase, {
    customer_id: customerId,
    site_id: siteId,
    power_of_attorney_id: savedPowerOfAttorneyId,
    document_type: documentType,
    status: setAsActive ? 'active' : 'uploaded',
    title,
    file_name: fileValue.name || null,
    mime_type: fileValue.type || null,
    file_size_bytes: fileValue.size || null,
    storage_bucket: bucket,
    file_path: filePath,
    file_checksum: fileChecksum,
    upload_idempotency_key: uploadIdempotencyKey,
    reference,
    notes,
  })

  const automationDecision = await resolveUploadAutomationDecision({
    supabase,
    customerId,
    siteId,
    documentType,
    markAsSigned,
    savedPowerOfAttorneyId,
    autoCreateGridOwnerRequests,
    includeCustomerMasterdata,
    includeMeterValues,
    includeBillingUnderlay,
    autoCreateSwitchRequest,
    autoQueueSwitchOutbound,
  })

  const archivedDocumentIds: string[] = []
  const revokedPowerOfAttorneyIds: string[] = []

  if (replaceDocumentId) {
    const replaced = await archiveCustomerAuthorizationDocument(supabase, {
      documentId: replaceDocumentId,
      reason: `Ersatt av nytt dokument ${savedDocument.id} vid upload.`,
      replacementDocumentId: savedDocument.id,
    })

    archivedDocumentIds.push(replaced.documentAfter.id)

    if (replaced.revokedPowerOfAttorney?.id) {
      revokedPowerOfAttorneyIds.push(replaced.revokedPowerOfAttorney.id)
    }
  }

  if (setAsActive && archivePreviousActive) {
    const activeConflicts = await listActiveCustomerAuthorizationDocumentsByScope(supabase, {
      customerId,
      siteId,
      documentType,
      excludeDocumentId: savedDocument.id,
    })

    for (const row of activeConflicts) {
      const archived = await archiveCustomerAuthorizationDocument(supabase, {
        documentId: row.id,
        reason: `Arkiverat automatiskt när nytt aktivt standarddokument ${savedDocument.id} laddades upp.`,
        replacementDocumentId: savedDocument.id,
      })

      archivedDocumentIds.push(archived.documentAfter.id)

      if (archived.revokedPowerOfAttorney?.id) {
        revokedPowerOfAttorneyIds.push(archived.revokedPowerOfAttorney.id)
      }
    }
  }

  let createdGridOwnerRequestIds: string[] = []
  let createdGridOwnerOutboundIds: string[] = []
  let switchRequestId: string | null = null
  let switchOutboundId: string | null = null
  let switchReadinessIssues: Array<{ code?: unknown; title?: unknown }> | null = null

  if (siteId && automationDecision.shouldCreateGridOwnerRequests) {
    const requestResult = await queueGridOwnerRequestsFromDocument({
      actorUserId: actor.id,
      customerId,
      siteId,
      document: savedDocument,
      meteringPointId: automationDecision.resolvedMeteringPointId,
      gridOwnerId: automationDecision.resolvedGridOwnerId,
      externalReference,
      requestedPeriodStart,
      requestedPeriodEnd,
      notes,
      includeCustomerMasterdata: automationDecision.includeCustomerMasterdata,
      includeMeterValues: automationDecision.includeMeterValues,
      includeBillingUnderlay: automationDecision.includeBillingUnderlay,
    })

    createdGridOwnerRequestIds = requestResult.createdGridOwnerRequestIds
    createdGridOwnerOutboundIds = requestResult.createdOutboundIds
  }

  if (
    siteId &&
    (automationDecision.shouldCreateSwitchRequest ||
      automationDecision.shouldQueueSwitchOutbound)
  ) {
    const switchResult = await ensureSwitchRequestAndOutboundFromDocument({
      actorUserId: actor.id,
      customerId,
      siteId,
      document: savedDocument,
      requestType,
      requestedStartDate,
      autoQueueOutbound: automationDecision.shouldQueueSwitchOutbound,
    })

    switchRequestId = switchResult.switchRequestId
    switchOutboundId = switchResult.switchOutboundId
    switchReadinessIssues = switchResult.readinessIssues

    if (!switchResult.switchRequestId && switchResult.readinessIssues?.length) {
      automationDecision.blockedReasons.push(
        `Supplier switch skapades inte eftersom readiness blockerade: ${switchResult.readinessIssues
          .map((issue) => String(issue.title ?? issue.code ?? 'okänd blockerare'))
          .join(', ')}`
      )
    }
  }

  const syncSummary = siteId
    ? await syncCustomerOperationsForSite(supabase, {
        customerId,
        siteId,
      })
    : await syncCustomerOperationsForCustomer(supabase, customerId)

  await createAuditLogEntry(supabase, {
    actorUserId: actor.id,
    entityType: 'customer_authorization_document',
    entityId: savedDocument.id,
    action: 'customer_authorization_document_uploaded_v2',
    newValues: savedDocument,
    metadata: {
      customerId,
      siteId,
      documentType,
      linkedPowerOfAttorneyId: savedPowerOfAttorneyId,
      archivedDocumentIds,
      revokedPowerOfAttorneyIds,
      createdGridOwnerRequestIds,
      createdGridOwnerOutboundIds,
      switchRequestId,
      switchOutboundId,
      switchReadinessIssues,
      automationBlockedReasons: automationDecision.blockedReasons,
      automationWarnings: automationDecision.warnings,
      automationDecision: {
        shouldCreateGridOwnerRequests:
          automationDecision.shouldCreateGridOwnerRequests,
        shouldCreateSwitchRequest: automationDecision.shouldCreateSwitchRequest,
        shouldQueueSwitchOutbound:
          automationDecision.shouldQueueSwitchOutbound,
        includeCustomerMasterdata:
          automationDecision.includeCustomerMasterdata,
        includeMeterValues: automationDecision.includeMeterValues,
        includeBillingUnderlay: automationDecision.includeBillingUnderlay,
        resolvedMeteringPointId:
          automationDecision.resolvedMeteringPointId,
        resolvedGridOwnerId: automationDecision.resolvedGridOwnerId,
      },
      syncSummary,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/unresolved')

  const message = formatMessageLines([
    `Dokument ${savedDocument.id} uppladdat och registrerat. ${
      replaceDocumentId ? 'Ersättningsflöde kördes.' : 'Nytt dokument sparades.'
    }`,
    createdGridOwnerRequestIds.length
      ? `Skapade nätägarrequester: ${createdGridOwnerRequestIds.length}.`
      : null,
    createdGridOwnerOutboundIds.length
      ? `Skapade outbounds för nätägarrequester: ${createdGridOwnerOutboundIds.length}.`
      : null,
    switchRequestId ? `Switch request: ${switchRequestId}.` : null,
    switchOutboundId ? `Switch outbound: ${switchOutboundId}.` : null,
    automationDecision.warnings.length
      ? `Begränsningar: ${automationDecision.warnings.join(' ')}`
      : null,
    automationDecision.blockedReasons.length
      ? `Automatiska steg stoppades delvis: ${automationDecision.blockedReasons.join(' ')}`
      : null,
  ])

  return {
    status: 'success',
    message,
    documentId: savedDocument.id,
    duplicateDocumentId: null,
  }
}

export async function archiveCustomerAuthorizationDocumentAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const documentId = formValue(formData, 'document_id') ?? ''
  const reason =
    formValue(formData, 'archive_reason') ||
    'Arkiverad manuellt från dokumentkortet.'

  if (!customerId || !documentId) {
    throw new Error('customer_id och document_id krävs')
  }

  const archived = await archiveCustomerAuthorizationDocument(supabase, {
    documentId,
    reason,
  })

  const archiveImpact = await handleArchivedDocumentLinkedRecords({
    actorUserId: actor.id,
    customerId,
    document: archived.documentAfter,
    reason,
  })

  const syncSummary = archived.documentAfter.site_id
    ? await syncCustomerOperationsForSite(supabase, {
        customerId,
        siteId: archived.documentAfter.site_id,
      })
    : await syncCustomerOperationsForCustomer(supabase, customerId)

  await createAuditLogEntry(supabase, {
    actorUserId: actor.id,
    entityType: 'customer_authorization_document',
    entityId: archived.documentAfter.id,
    action: 'customer_authorization_document_archived',
    oldValues: archived.documentBefore,
    newValues: archived.documentAfter,
    metadata: {
      customerId,
      revokedPowerOfAttorneyId: archived.revokedPowerOfAttorney?.id ?? null,
      archiveImpact,
      syncSummary,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/operations/switches')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/unresolved')
}

export async function setCustomerAuthorizationDocumentActiveAction(
  formData: FormData
): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = await getActor()
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const documentId = formValue(formData, 'document_id') ?? ''

  if (!customerId || !documentId) {
    throw new Error('customer_id och document_id krävs')
  }

  const targetBefore = await getCustomerAuthorizationDocumentById(
    supabase,
    documentId
  )
  if (!targetBefore) {
    throw new Error('Dokumentet hittades inte')
  }

  const activation = await setCustomerAuthorizationDocumentAsActive(supabase, {
    documentId: targetBefore.id,
    archiveOtherActiveDocuments: true,
  })

  const archivedConflictIds = activation.archivedDocuments.map((row) => row.id)
  const revokedPowerOfAttorneyIds = activation.revokedPowerOfAttorneyIds
  const activeDocument = activation.targetAfter
  const restoredPowerOfAttorney = activation.restoredPowerOfAttorney

  const syncSummary = activeDocument.site_id
    ? await syncCustomerOperationsForSite(supabase, {
        customerId,
        siteId: activeDocument.site_id,
      })
    : await syncCustomerOperationsForCustomer(supabase, customerId)

  await createAuditLogEntry(supabase, {
    actorUserId: actor.id,
    entityType: 'customer_authorization_document',
    entityId: activeDocument.id,
    action: 'customer_authorization_document_set_active',
    oldValues: targetBefore,
    newValues: activeDocument,
    metadata: {
      customerId,
      archivedConflictIds,
      revokedPowerOfAttorneyIds,
      restoredPowerOfAttorneyId: restoredPowerOfAttorney?.id ?? null,
      syncSummary,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
}