// Extracted from document-actions.ts; keep public imports on the facade module.

import { createHash } from 'node:crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'


import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { assignAuthorizationDocumentToGridOwnerRequest, assignAuthorizationDocumentToOutboundRequest, buildGridOwnerDataRequestAutomationKey, buildOutboundRequestAutomationKey, assignAuthorizationDocumentToSwitchRequest, createSupplierSwitchEvent, createSupplierSwitchRequest, buildSupplierSwitchRequestAutomationKey, findCustomerSiteById, findOpenGridOwnerDataRequestByDocument, findOpenOutboundRequestByDocument, findOpenSupplierSwitchRequestForSite, listMeteringPointsForSite, listPowersOfAttorneyByCustomerId, listSupplierSwitchRequestsByCustomerId, updateSupplierSwitchRequestStatus, updateSupplierSwitchValidationSnapshot } from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'

import { resolveFullmaktAutomationPolicy } from '@/lib/operations/fullmaktAutomation'

import type { CustomerAuthorizationDocumentRow, SupplierSwitchRequestType } from '@/lib/operations/types'
import { createGridOwnerDataRequest, createOutboundRequest, findOpenOutboundBySource, listGridOwnerDataRequestsByCustomerId, listOutboundRequestsByCustomerId, updateGridOwnerDataRequestStatus, updateOutboundRequestStatus } from '@/lib/cis/db'

export function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

export type CustomerDocumentActionContext = {
  customer: { id: string; company_id: string; status: string | null }
  companyId: string
}

export async function requireCustomerDocumentActionContext(
  customerId: string,
  guard: { userId: string; isPlatformAdmin: boolean }
): Promise<CustomerDocumentActionContext> {
  const { data, error } = await supabaseService
    .from('customers')
    .select('id, company_id, status')
    .eq('id', customerId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Kunden hittades inte.')
  if (!data.company_id) {
    throw new Error('Kunden saknar bolagskoppling och kan därför inte ändras säkert.')
  }

  if (!guard.isPlatformAdmin) {
    const operationalCompanyId = await requireOperationalCompanyId(guard.userId)
    if (operationalCompanyId !== data.company_id) {
      throw new Error('Du saknar behörighet för kundens bolag.')
    }
  }

  return {
    customer: data as { id: string; company_id: string; status: string | null },
    companyId: data.company_id,
  }
}

export function sanitizeFileName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
}

export function buildCustomerDocumentPath(params: {
  customerId: string
  siteId: string | null
  documentType: 'power_of_attorney' | 'complete_agreement' | 'grid_invoice_suggested'
  fileName: string
}): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const scope = params.siteId ? `site-${params.siteId}` : 'customer'
  return `${params.customerId}/${scope}/${params.documentType}/${stamp}_${sanitizeFileName(params.fileName)}`
}

export function normalizeDateOrNull(value: string | null): string | null {
  return value?.trim() ? value.trim() : null
}

export function parseCheckbox(value: FormDataEntryValue | null): boolean {
  if (typeof value !== 'string') return false
  return value === 'on' || value === 'true' || value === '1'
}

export function toBoolean(formData: FormData, key: string): boolean {
  return parseCheckbox(formData.get(key))
}

export function normalizeSwitchRequestType(
  value: string | null
): SupplierSwitchRequestType {
  if (value === 'move_in') return 'move_in'
  if (value === 'move_out_takeover') return 'move_out_takeover'
  return 'switch'
}

export function normalizeJsonObject(
  value: unknown
): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

export function getRecordValue(
  value: unknown,
  key: string
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>)[key]
}

export function getString(
  value: unknown,
  key: string
): string | null {
  const raw = getRecordValue(value, key)
  return typeof raw === 'string' ? raw : null
}

export type ArchiveLinkedRecordsImpact = {
  cancelledGridOwnerRequestIds: string[]
  flaggedGridOwnerRequestIds: string[]
  cancelledOutboundIds: string[]
  flaggedOutboundIds: string[]
  failedSwitchRequestIds: string[]
  flaggedSwitchRequestIds: string[]
}

export function mergeObjectRecord(
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

export async function handleArchivedDocumentLinkedRecords(params: {
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

export type UploadAutomationDecision = {
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
  canUseDocumentForRequests: boolean
  canUseDocumentForSwitch: boolean
}

export function formatMessageLines(lines: Array<string | null | undefined>): string {
  return lines
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

export function isIsoDateBefore(left: string | null, right: string | null): boolean {
  if (!left || !right) return false
  return left < right
}

export async function buildFileChecksum(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  return createHash('sha256').update(buffer).digest('hex')
}

export async function getActor() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

export async function queueGridOwnerRequestsFromDocument(params: {
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

export async function ensureSwitchRequestAndOutboundFromDocument(params: {
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

export async function resolveUploadAutomationDecision(params: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
  customerId: string
  siteId: string | null
  documentType: 'power_of_attorney' | 'complete_agreement' | 'grid_invoice_suggested'
  markAsSigned: boolean
  savedPowerOfAttorneyId: string | null
  autoCreateGridOwnerRequests: boolean
  includeCustomerMasterdata: boolean
  includeMeterValues: boolean
  includeBillingUnderlay: boolean
  autoCreateSwitchRequest: boolean
  autoQueueSwitchOutbound: boolean
  autoSendRequestsAfterSignedFullmakt: boolean
  autoSendRequestsAfterUploadedFullmakt: boolean
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

  const fullmaktPolicy = resolveFullmaktAutomationPolicy({
    documentType: params.documentType,
    markAsSigned: params.markAsSigned,
    savedPowerOfAttorneyId: params.savedPowerOfAttorneyId,
    autoCreateGridOwnerRequests: shouldCreateGridOwnerRequests,
    autoCreateSwitchRequest: shouldCreateSwitchRequest,
    autoQueueSwitchOutbound: shouldQueueSwitchOutbound,
    autoSendRequestsAfterSignedFullmakt: params.autoSendRequestsAfterSignedFullmakt,
    autoSendRequestsAfterUploadedFullmakt: params.autoSendRequestsAfterUploadedFullmakt,
  })

  shouldCreateGridOwnerRequests = fullmaktPolicy.shouldCreateGridOwnerRequests
  shouldCreateSwitchRequest = fullmaktPolicy.shouldCreateSwitchRequest
  shouldQueueSwitchOutbound = fullmaktPolicy.shouldQueueSwitchOutbound
  blockedReasons.push(...fullmaktPolicy.blockedReasons)
  warnings.push(...fullmaktPolicy.warnings)

  if (!shouldCreateGridOwnerRequests) {
    includeCustomerMasterdata = false
    includeMeterValues = false
    includeBillingUnderlay = false
  }

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
      canUseDocumentForRequests: fullmaktPolicy.canUseDocumentForRequests,
      canUseDocumentForSwitch: fullmaktPolicy.canUseDocumentForSwitch,
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
      canUseDocumentForRequests: fullmaktPolicy.canUseDocumentForRequests,
      canUseDocumentForSwitch: fullmaktPolicy.canUseDocumentForSwitch,
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
      canUseDocumentForRequests: fullmaktPolicy.canUseDocumentForRequests,
      canUseDocumentForSwitch: fullmaktPolicy.canUseDocumentForSwitch,
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

  if (shouldCreateGridOwnerRequests && !resolvedGridOwnerId) {
    shouldCreateGridOwnerRequests = false
    includeCustomerMasterdata = false
    includeMeterValues = false
    includeBillingUnderlay = false
    blockedReasons.push(
      'Begäran skickades inte eftersom systemet inte kunde fastställa rätt nätägare/mottagare från anläggning eller mätpunkt.'
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
    canUseDocumentForRequests: fullmaktPolicy.canUseDocumentForRequests,
    canUseDocumentForSwitch: fullmaktPolicy.canUseDocumentForSwitch,
  }
}
