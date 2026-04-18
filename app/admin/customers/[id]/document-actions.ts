'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'
import {
  createSupplierSwitchEvent,
  createSupplierSwitchRequest,
  findCustomerSiteById,
  findOpenSupplierSwitchRequestForSite,
  listCustomerAuthorizationDocumentsByCustomerId,
  listMeteringPointsForSite,
  listPowersOfAttorneyByCustomerId,
  saveCustomerAuthorizationDocument,
  savePowerOfAttorney,
  syncCustomerOperationsForCustomer,
  syncCustomerOperationsForSite,
  updateSupplierSwitchValidationSnapshot,
} from '@/lib/operations/db'
import { evaluateSiteSwitchReadiness } from '@/lib/operations/readiness'
import type {
  CustomerAuthorizationDocumentRow,
  PowerOfAttorneyRow,
  SupplierSwitchRequestType,
} from '@/lib/operations/types'
import {
  createGridOwnerDataRequest,
  createOutboundRequest,
  findOpenOutboundBySource,
  updateGridOwnerDataRequestStatus,
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

function appendNote(
  existing: string | null | undefined,
  extra: string
): string {
  const base = (existing ?? '').trim()
  if (!base) return extra
  if (base.includes(extra)) return base
  return `${base}\n\n${extra}`
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

async function insertAuditLog(params: {
  actorUserId: string
  entityType: string
  entityId: string
  action: string
  oldValues?: unknown
  newValues?: unknown
  metadata?: unknown
}) {
  const { error } = await supabaseService.from('audit_logs').insert({
    actor_user_id: params.actorUserId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    old_values: params.oldValues ?? null,
    new_values: params.newValues ?? null,
    metadata: params.metadata ?? null,
  })

  if (error) throw error
}

async function getDocumentById(
  documentId: string
): Promise<CustomerAuthorizationDocumentRow | null> {
  const { data, error } = await supabaseService
    .from('customer_authorization_documents')
    .select('*')
    .eq('id', documentId)
    .maybeSingle()

  if (error) throw error
  return (data as CustomerAuthorizationDocumentRow | null) ?? null
}

async function getPowerOfAttorneyById(
  powerOfAttorneyId: string
): Promise<PowerOfAttorneyRow | null> {
  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .select('*')
    .eq('id', powerOfAttorneyId)
    .maybeSingle()

  if (error) throw error
  return (data as PowerOfAttorneyRow | null) ?? null
}

async function assignAuthorizationDocumentToGridOwnerRequest(params: {
  requestId: string
  documentId: string
}) {
  const { error } = await supabaseService
    .from('grid_owner_data_requests')
    .update({
      authorization_document_id: params.documentId,
    })
    .eq('id', params.requestId)

  if (error) throw error
}

async function assignAuthorizationDocumentToOutboundRequest(params: {
  outboundRequestId: string
  documentId: string
}) {
  const { error } = await supabaseService
    .from('outbound_requests')
    .update({
      authorization_document_id: params.documentId,
    })
    .eq('id', params.outboundRequestId)

  if (error) throw error
}

async function assignAuthorizationDocumentToSwitchRequest(params: {
  requestId: string
  documentId: string
}) {
  const { error } = await supabaseService
    .from('supplier_switch_requests')
    .update({
      authorization_document_id: params.documentId,
    })
    .eq('id', params.requestId)

  if (error) throw error
}

async function updateDocumentStatus(params: {
  actorUserId: string
  documentId: string
  status: 'uploaded' | 'active' | 'archived'
  notesAppend?: string | null
  archivedReason?: string | null
  replacedDocumentId?: string | null
}): Promise<CustomerAuthorizationDocumentRow> {
  const before = await getDocumentById(params.documentId)

  if (!before) {
    throw new Error('Dokumentet hittades inte')
  }

  const nextNotes = params.notesAppend
    ? appendNote(before.notes, params.notesAppend)
    : before.notes

  const { data, error } = await supabaseService
    .from('customer_authorization_documents')
    .update({
      status: params.status,
      notes: nextNotes ?? null,
      archived_reason:
        params.status === 'archived' ? params.archivedReason ?? null : null,
      replaced_document_id: params.replacedDocumentId ?? null,
      updated_by: params.actorUserId,
    })
    .eq('id', params.documentId)
    .select('*')
    .single()

  if (error) throw error
  return data as CustomerAuthorizationDocumentRow
}

async function revokeLinkedPowerOfAttorney(params: {
  actorUserId: string
  document: CustomerAuthorizationDocumentRow
  reason: string
}): Promise<PowerOfAttorneyRow | null> {
  if (!params.document.power_of_attorney_id) return null

  const poa = await getPowerOfAttorneyById(params.document.power_of_attorney_id)
  if (!poa) return null
  if (poa.status === 'revoked') return poa

  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .update({
      status: 'revoked',
      notes: appendNote(poa.notes, params.reason),
      updated_by: params.actorUserId,
    })
    .eq('id', poa.id)
    .select('*')
    .single()

  if (error) throw error
  return data as PowerOfAttorneyRow
}

async function restoreLinkedPowerOfAttorneyIfNeeded(params: {
  actorUserId: string
  document: CustomerAuthorizationDocumentRow
}): Promise<PowerOfAttorneyRow | null> {
  if (!params.document.power_of_attorney_id) return null

  const poa = await getPowerOfAttorneyById(params.document.power_of_attorney_id)
  if (!poa) return null
  if (poa.status !== 'revoked') return poa

  const restoredStatus: PowerOfAttorneyRow['status'] =
    poa.signed_at ? 'signed' : 'sent'

  const { data, error } = await supabaseService
    .from('powers_of_attorney')
    .update({
      status: restoredStatus,
      notes: appendNote(
        poa.notes,
        'Fullmakten återaktiverades eftersom dokumentet sattes som aktivt standarddokument.'
      ),
      updated_by: params.actorUserId,
    })
    .eq('id', poa.id)
    .select('*')
    .single()

  if (error) throw error
  return data as PowerOfAttorneyRow
}

async function listActiveDocumentsForSameScopeAndType(params: {
  customerId: string
  siteId: string | null
  documentType: 'power_of_attorney' | 'complete_agreement'
  excludeDocumentId?: string | null
}): Promise<CustomerAuthorizationDocumentRow[]> {
  let query = supabaseService
    .from('customer_authorization_documents')
    .select('*')
    .eq('customer_id', params.customerId)
    .eq('document_type', params.documentType)
    .eq('status', 'active')

  query = params.siteId
    ? query.eq('site_id', params.siteId)
    : query.is('site_id', null)

  const { data, error } = await query.order('uploaded_at', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as CustomerAuthorizationDocumentRow[]
  const excluded = params.excludeDocumentId ?? null

  return excluded ? rows.filter((row) => row.id !== excluded) : rows
}

async function archiveDocumentInternal(params: {
  actorUserId: string
  documentId: string
  reason: string
  replacementDocumentId?: string | null
}): Promise<{
  documentBefore: CustomerAuthorizationDocumentRow
  documentAfter: CustomerAuthorizationDocumentRow
  revokedPowerOfAttorney: PowerOfAttorneyRow | null
}> {
  const documentBefore = await getDocumentById(params.documentId)

  if (!documentBefore) {
    throw new Error('Dokumentet hittades inte')
  }

  const documentAfter = await updateDocumentStatus({
    actorUserId: params.actorUserId,
    documentId: params.documentId,
    status: 'archived',
    notesAppend: params.reason,
    archivedReason: params.reason,
    replacedDocumentId: params.replacementDocumentId ?? null,
  })

  const revokedPowerOfAttorney = await revokeLinkedPowerOfAttorney({
    actorUserId: params.actorUserId,
    document: documentAfter,
    reason: `Fullmakten revokerades eftersom dokumentet arkiverades. Orsak: ${params.reason}`,
  })

  return {
    documentBefore,
    documentAfter,
    revokedPowerOfAttorney,
  }
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
  const createdGridOwnerRequestIds: string[] = []
  const createdOutboundIds: string[] = []

  const maybeCreate = async (
    scope: 'customer_masterdata' | 'meter_values' | 'billing_underlay',
    enabled: boolean
  ) => {
    if (!enabled) return

    const saved = await createGridOwnerDataRequest({
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
        ? `${params.notes}\n\nBilaga: ${params.document.file_path}`
        : `Bilaga: ${params.document.file_path}`,
    })

    await assignAuthorizationDocumentToGridOwnerRequest({
      requestId: saved.id,
      documentId: params.document.id,
    })

    const outbound = await createOutboundRequest({
      actorUserId: params.actorUserId,
      customerId: params.customerId,
      siteId: params.siteId,
      meteringPointId: params.meteringPointId,
      gridOwnerId: params.gridOwnerId,
      requestType: scope === 'billing_underlay' ? 'billing_underlay' : 'meter_values',
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
    })

    await assignAuthorizationDocumentToOutboundRequest({
      outboundRequestId: outbound.id,
      documentId: params.document.id,
    })

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

  await assignAuthorizationDocumentToSwitchRequest({
    requestId: switchRequest.id,
    documentId: params.document.id,
  })

  let switchOutboundId: string | null = null

  if (params.autoQueueOutbound) {
    const existingOutbound = await findOpenOutboundBySource({
      sourceType: 'supplier_switch_request',
      sourceId: switchRequest.id,
      requestType: 'supplier_switch',
    })

    if (existingOutbound) {
      await assignAuthorizationDocumentToOutboundRequest({
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
      })

      await assignAuthorizationDocumentToOutboundRequest({
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

export async function uploadCustomerAuthorizationDocumentAction(
  formData: FormData
): Promise<void> {
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
    throw new Error('Customer ID saknas')
  }

  if (!(fileValue instanceof File) || fileValue.size === 0) {
    throw new Error('Du måste välja en fil att ladda upp')
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
    reference,
    notes,
  })

  const archivedDocumentIds: string[] = []
  const revokedPowerOfAttorneyIds: string[] = []

  if (replaceDocumentId) {
    const replaced = await archiveDocumentInternal({
      actorUserId: actor.id,
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
    const activeConflicts = await listActiveDocumentsForSameScopeAndType({
      customerId,
      siteId,
      documentType,
      excludeDocumentId: savedDocument.id,
    })

    for (const row of activeConflicts) {
      const archived = await archiveDocumentInternal({
        actorUserId: actor.id,
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

  if (
    siteId &&
    (autoCreateGridOwnerRequests ||
      autoCreateSwitchRequest ||
      autoQueueSwitchOutbound)
  ) {
    const site = await findCustomerSiteById(supabase, siteId)
    if (!site) {
      throw new Error('Anläggningen hittades inte')
    }

    const siteMeteringPoints = await listMeteringPointsForSite(supabase, siteId)
    const preferredMeteringPoint =
      siteMeteringPoints.find((row) => row.status === 'active') ??
      siteMeteringPoints.find((row) => row.status === 'pending_validation') ??
      siteMeteringPoints[0] ??
      null

    if (autoCreateGridOwnerRequests) {
      const requestResult = await queueGridOwnerRequestsFromDocument({
        actorUserId: actor.id,
        customerId,
        siteId,
        document: savedDocument,
        meteringPointId: preferredMeteringPoint?.id ?? null,
        gridOwnerId:
          preferredMeteringPoint?.grid_owner_id ?? site.grid_owner_id ?? null,
        externalReference,
        requestedPeriodStart,
        requestedPeriodEnd,
        notes,
        includeCustomerMasterdata,
        includeMeterValues,
        includeBillingUnderlay,
      })

      createdGridOwnerRequestIds = requestResult.createdGridOwnerRequestIds
      createdGridOwnerOutboundIds = requestResult.createdOutboundIds
    }

    if (autoCreateSwitchRequest || autoQueueSwitchOutbound) {
      const switchResult = await ensureSwitchRequestAndOutboundFromDocument({
        actorUserId: actor.id,
        customerId,
        siteId,
        document: savedDocument,
        requestType,
        requestedStartDate,
        autoQueueOutbound: autoQueueSwitchOutbound,
      })

      switchRequestId = switchResult.switchRequestId
      switchOutboundId = switchResult.switchOutboundId
      switchReadinessIssues = switchResult.readinessIssues
    }
  }

  const syncSummary = siteId
    ? await syncCustomerOperationsForSite(supabase, {
        customerId,
        siteId,
      })
    : await syncCustomerOperationsForCustomer(supabase, customerId)

  await insertAuditLog({
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
      syncSummary,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/outbound/unresolved')
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

  const archived = await archiveDocumentInternal({
    actorUserId: actor.id,
    documentId,
    reason,
  })

  const syncSummary = archived.documentAfter.site_id
    ? await syncCustomerOperationsForSite(supabase, {
        customerId,
        siteId: archived.documentAfter.site_id,
      })
    : await syncCustomerOperationsForCustomer(supabase, customerId)

  await insertAuditLog({
    actorUserId: actor.id,
    entityType: 'customer_authorization_document',
    entityId: archived.documentAfter.id,
    action: 'customer_authorization_document_archived',
    oldValues: archived.documentBefore,
    newValues: archived.documentAfter,
    metadata: {
      customerId,
      revokedPowerOfAttorneyId: archived.revokedPowerOfAttorney?.id ?? null,
      syncSummary,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/operations')
  revalidatePath('/admin/operations/tasks')
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

  const targetBefore = await getDocumentById(documentId)
  if (!targetBefore) {
    throw new Error('Dokumentet hittades inte')
  }

  const conflicts = await listActiveDocumentsForSameScopeAndType({
    customerId: targetBefore.customer_id,
    siteId: targetBefore.site_id,
    documentType: targetBefore.document_type,
    excludeDocumentId: targetBefore.id,
  })

  const archivedConflictIds: string[] = []
  const revokedPowerOfAttorneyIds: string[] = []

  for (const conflict of conflicts) {
    const archived = await archiveDocumentInternal({
      actorUserId: actor.id,
      documentId: conflict.id,
      reason: `Arkiverat automatiskt eftersom dokument ${targetBefore.id} sattes som aktivt standarddokument.`,
      replacementDocumentId: targetBefore.id,
    })

    archivedConflictIds.push(archived.documentAfter.id)

    if (archived.revokedPowerOfAttorney?.id) {
      revokedPowerOfAttorneyIds.push(archived.revokedPowerOfAttorney.id)
    }
  }

  const activeDocument = await updateDocumentStatus({
    actorUserId: actor.id,
    documentId: targetBefore.id,
    status: 'active',
    notesAppend: 'Satt som aktivt standarddokument manuellt.',
  })

  const restoredPowerOfAttorney = await restoreLinkedPowerOfAttorneyIfNeeded({
    actorUserId: actor.id,
    document: activeDocument,
  })

  const syncSummary = activeDocument.site_id
    ? await syncCustomerOperationsForSite(supabase, {
        customerId,
        siteId: activeDocument.site_id,
      })
    : await syncCustomerOperationsForCustomer(supabase, customerId)

  await insertAuditLog({
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