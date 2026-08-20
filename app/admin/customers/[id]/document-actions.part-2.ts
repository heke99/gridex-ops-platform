// Extracted from document-actions.ts; keep public imports on the facade module.
import { revalidatePath } from 'next/cache'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'

import { supabaseService } from '@/lib/supabase/service'
import { archiveCustomerAuthorizationDocument, createAuditLogEntry, getCustomerAuthorizationDocumentById, listActiveCustomerAuthorizationDocumentsByScope, getPowerOfAttorneyById, buildDocumentUploadIdempotencyKey, findExistingCustomerAuthorizationDocumentByFingerprint, saveCustomerAuthorizationDocument, savePowerOfAttorney, setCustomerAuthorizationDocumentAsActive, syncCustomerOperationsForCustomer, syncCustomerOperationsForSite } from '@/lib/operations/db'

import { ensureInitialSwitchEdielAutomation } from '@/lib/operations/edielAutomation'

import { ensureAuthorizationScopeFromPowerOfAttorney, getSignedPowerOfAttorneyCoverage, powerOfAttorneyCoverageFromScopes, resolveCustomerBlockersAfterSignedPowerOfAttorney } from '@/lib/operations/powerOfAttorneyWorkflow'
import type { CustomerAuthorizationDocumentRow } from '@/lib/operations/types'

import type { CustomerDocumentActionContext, UploadCustomerAuthorizationDocumentActionState } from './document-actions.part-1'
import { buildCustomerDocumentPath, buildFileChecksum, ensureSwitchRequestAndOutboundFromDocument, formValue, formatMessageLines, getActor, handleArchivedDocumentLinkedRecords, isIsoDateBefore, normalizeDateOrNull, normalizeSwitchRequestType, queueGridOwnerRequestsFromDocument, requireCustomerDocumentActionContext, resolveUploadAutomationDecision, toBoolean } from './document-actions.part-1'

export async function uploadCustomerAuthorizationDocumentAction(
  _previousState: UploadCustomerAuthorizationDocumentActionState,
  formData: FormData
): Promise<UploadCustomerAuthorizationDocumentActionState> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = { id: guard.userId }
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
  // Manual-intake evidence so an uploaded signed PDF can later be used for
  // external grid-owner communication (signer + method + snapshot).
  const signerName = formValue(formData, 'signer_name') || null
  const signerIdentityNumber = formValue(formData, 'signer_identity_number') || null
  const signedDate = normalizeDateOrNull(formValue(formData, 'signed_date'))
  const selectedPoaScopes = formData
    .getAll('poa_scope')
    .map((value) => String(value).trim())
    .filter(Boolean)
  const poaScopes = selectedPoaScopes.length > 0 ? selectedPoaScopes : ['supplier_switch', 'facility_information_lookup']
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
  const autoSendRequestsAfterSignedFullmakt = toBoolean(
    formData,
    'auto_send_requests_after_signed_fullmakt'
  )
  const autoSendRequestsAfterUploadedFullmakt = toBoolean(
    formData,
    'auto_send_requests_after_uploaded_fullmakt'
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

  let actionContext: CustomerDocumentActionContext
  try {
    actionContext = await requireCustomerDocumentActionContext(customerId, guard)
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Kunden kunde inte verifieras mot bolaget.',
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
    const signedAtIso = markAsSigned ? (signedDate ?? new Date().toISOString()) : null
    const savedPowerOfAttorney = await savePowerOfAttorney(supabase, {
      customer_id: customerId,
      site_id: siteId,
      scope: 'supplier_switch',
      status: markAsSigned ? 'signed' : 'sent',
      signed_at: signedAtIso,
      accepted_at: signedAtIso,
      accepted_source: 'admin_manual',
      method: 'pdf_upload',
      signer_name: signerName,
      signer_identity_number: signerIdentityNumber,
      scopeSummary: {
        scopes: poaScopes,
        supplier_switch: poaScopes.includes('supplier_switch'),
        facility_information_lookup: poaScopes.includes('facility_information_lookup'),
        source: 'manual_pdf_upload',
      },
      signedScopes: poaScopes,
      valid_from: validFrom,
      valid_to: validTo,
      document_path: filePath,
      reference,
      notes,
      companyId: actionContext.companyId,
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
    metadata: { signedScopes: poaScopes },
    companyId: actionContext.companyId,
  })

  let authorizationScopeId: string | null = null
  let resolvedPowerOfAttorneyBlockers = 0

  if (markAsSigned && savedPowerOfAttorneyId) {
    authorizationScopeId = await ensureAuthorizationScopeFromPowerOfAttorney({
      companyId: actionContext.companyId,
      actorUserId: actor.id,
      customerId,
      powerOfAttorneyId: savedPowerOfAttorneyId,
      authorizationDocumentId: savedDocument.id,
      coverage: powerOfAttorneyCoverageFromScopes(poaScopes),
      signedScopes: poaScopes,
      validFrom,
      validTo,
      evidenceNote: 'Signerad fullmakt uppladdad och verifierad i kundkortet.',
    })

    const blockerResult = await resolveCustomerBlockersAfterSignedPowerOfAttorney({
      companyId: actionContext.companyId,
      actorUserId: actor.id,
      customerId,
      siteId,
      powerOfAttorneyId: savedPowerOfAttorneyId,
      authorizationDocumentId: savedDocument.id,
    })
    resolvedPowerOfAttorneyBlockers = blockerResult.resolved
  }

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
    autoSendRequestsAfterSignedFullmakt,
    autoSendRequestsAfterUploadedFullmakt,
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
  let switchEdielMessageId: string | null = null
  let switchEdielAutomationError: string | null = null

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

    if (switchResult.switchRequestId && automationDecision.shouldQueueSwitchOutbound) {
      try {
        const edielResult = await ensureInitialSwitchEdielAutomation({
          actorUserId: actor.id,
          switchRequestId: switchResult.switchRequestId,
        })

        if (edielResult.blocked) {
          automationDecision.warnings.push(
            `Ediel Z03 väntar: ${edielResult.blockers[0]?.message ?? 'sändfönster/readiness blockerar utskicket.'}`
          )
        }
        switchEdielMessageId = edielResult.message?.id ?? null
        if (!switchOutboundId && edielResult.outboundRequestId) {
          switchOutboundId = edielResult.outboundRequestId
        }
      } catch (error) {
        switchEdielAutomationError = error instanceof Error ? error.message : String(error)
        automationDecision.warnings.push(
          `Ediel Z03 skapades inte automatiskt efter fullmakt/avtal: ${switchEdielAutomationError}`
        )
      }
    }

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
      authorizationScopeId,
      resolvedPowerOfAttorneyBlockers,
      archivedDocumentIds,
      revokedPowerOfAttorneyIds,
      createdGridOwnerRequestIds,
      createdGridOwnerOutboundIds,
      switchRequestId,
      switchOutboundId,
      switchEdielMessageId,
      switchEdielAutomationError,
      switchReadinessIssues,
      automationBlockedReasons: automationDecision.blockedReasons,
      automationWarnings: automationDecision.warnings,
      automationDecision: {
        shouldCreateGridOwnerRequests:
          automationDecision.shouldCreateGridOwnerRequests,
        shouldCreateSwitchRequest: automationDecision.shouldCreateSwitchRequest,
        shouldQueueSwitchOutbound:
          automationDecision.shouldQueueSwitchOutbound,
        canUseDocumentForRequests:
          automationDecision.canUseDocumentForRequests,
        canUseDocumentForSwitch:
          automationDecision.canUseDocumentForSwitch,
        autoSendRequestsAfterSignedFullmakt,
        autoSendRequestsAfterUploadedFullmakt,
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
    switchEdielMessageId ? `Ediel Z03 skapades automatiskt: ${switchEdielMessageId}.` : null,
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

export async function verifyCustomerAuthorizationDocumentAndRequestDataAction(
  formData: FormData
): Promise<void> {
  const guard = await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const actor = { id: guard.userId }
  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''
  const documentId = formValue(formData, 'document_id') ?? ''
  const requestedPeriodStart = normalizeDateOrNull(
    formValue(formData, 'requested_period_start')
  )
  const requestedPeriodEnd = normalizeDateOrNull(
    formValue(formData, 'requested_period_end')
  )
  const requestedStartDate = normalizeDateOrNull(
    formValue(formData, 'requested_start_date')
  )

  if (!customerId || !documentId) {
    throw new Error('customer_id och document_id krävs')
  }

  const actionContext = await requireCustomerDocumentActionContext(customerId, guard)

  if (isIsoDateBefore(requestedPeriodEnd, requestedPeriodStart)) {
    throw new Error('Begär period till kan inte vara tidigare än begär period från')
  }

  const existingDocument = await getCustomerAuthorizationDocumentById(
    supabase,
    documentId
  )

  if (!existingDocument || existingDocument.customer_id !== customerId) {
    throw new Error('Fullmaktsdokumentet hittades inte för aktuell kund')
  }

  if (existingDocument.status === 'archived') {
    throw new Error('Arkiverad fullmakt kan inte verifieras eller användas för nya begäran')
  }

  if (existingDocument.document_type !== 'power_of_attorney') {
    throw new Error('Endast fullmaktsdokument kan verifieras från detta flöde')
  }

  let powerOfAttorneyId = existingDocument.power_of_attorney_id
  let linkedPowerOfAttorney = powerOfAttorneyId
    ? await getPowerOfAttorneyById(supabase, powerOfAttorneyId)
    : null

  if (!linkedPowerOfAttorney) {
    const metadataScopes = Array.isArray(existingDocument.metadata?.signedScopes)
      ? existingDocument.metadata.signedScopes.map(String).filter(Boolean)
      : []
    if (metadataScopes.length === 0) {
      throw new Error('Dokumentet saknar signerad fullmaktsscope och kan inte verifieras automatiskt.')
    }
    linkedPowerOfAttorney = await savePowerOfAttorney(supabase, {
      customer_id: customerId,
      site_id: existingDocument.site_id,
      scope: 'supplier_switch',
      status: 'signed',
      signed_at: new Date().toISOString(),
      valid_from: null,
      valid_to: null,
      document_path: existingDocument.file_path,
      reference: existingDocument.reference,
      notes: existingDocument.notes
        ? `${existingDocument.notes}

Verifierad manuellt från kundkortet.`
        : 'Verifierad manuellt från kundkortet.',
      scopeSummary: { scopes: metadataScopes, source: 'authorization_document_metadata' },
      signedScopes: metadataScopes,
      companyId: actionContext.companyId,
    })
    powerOfAttorneyId = linkedPowerOfAttorney.id
  } else if (linkedPowerOfAttorney.status !== 'signed') {
    const immutableScopes = Array.isArray(linkedPowerOfAttorney.signed_scope_snapshot)
      ? linkedPowerOfAttorney.signed_scope_snapshot.map(String).filter(Boolean)
      : Array.isArray(linkedPowerOfAttorney.scope_summary?.scopes)
        ? (linkedPowerOfAttorney.scope_summary.scopes as unknown[]).map(String).filter(Boolean)
        : []
    if (immutableScopes.length === 0) {
      throw new Error('Fullmaktens signerade scope saknas och får inte antas vid verifiering.')
    }
    linkedPowerOfAttorney = await savePowerOfAttorney(supabase, {
      id: linkedPowerOfAttorney.id,
      customer_id: linkedPowerOfAttorney.customer_id,
      site_id: linkedPowerOfAttorney.site_id,
      scope: linkedPowerOfAttorney.scope,
      status: 'signed',
      signed_at: linkedPowerOfAttorney.signed_at ?? new Date().toISOString(),
      valid_from: linkedPowerOfAttorney.valid_from,
      valid_to: linkedPowerOfAttorney.valid_to,
      document_path: linkedPowerOfAttorney.document_path ?? existingDocument.file_path,
      reference: linkedPowerOfAttorney.reference ?? existingDocument.reference,
      notes: linkedPowerOfAttorney.notes
        ? `${linkedPowerOfAttorney.notes}

Verifierad manuellt från kundkortet.`
        : 'Verifierad manuellt från kundkortet.',
      scopeSummary: linkedPowerOfAttorney.scope_summary ?? { scopes: immutableScopes },
      signedScopes: immutableScopes,
      companyId: actionContext.companyId,
    })
  }

  if (!powerOfAttorneyId) {
    throw new Error('Fullmakten kunde inte kopplas till ett permanent ID.')
  }

  const { data: updatedDocument, error: updateError } = await supabase
    .from('customer_authorization_documents')
    .update({
      power_of_attorney_id: powerOfAttorneyId,
      status: 'active',
      notes: existingDocument.notes
        ? `${existingDocument.notes}\n\nVerifierad och använd för automatisk uppgiftsbegäran.`
        : 'Verifierad och använd för automatisk uppgiftsbegäran.',
      updated_by: actor.id,
    })
    .eq('id', existingDocument.id)
    .select('*')
    .single()

  if (updateError) throw updateError

  const document = updatedDocument as CustomerAuthorizationDocumentRow
  const siteId = document.site_id
  const signedCoverage = await getSignedPowerOfAttorneyCoverage({
    companyId: actionContext.companyId,
    customerId,
    powerOfAttorneyId,
  })
  if (!signedCoverage) {
    throw new Error('Signerad fullmaktsscope saknas. Ange exakt omfattning innan dokumentet verifieras.')
  }
  const authorizationScopeId = await ensureAuthorizationScopeFromPowerOfAttorney({
    companyId: actionContext.companyId,
    actorUserId: actor.id,
    customerId,
    powerOfAttorneyId,
    authorizationDocumentId: document.id,
    coverage: signedCoverage.coverage,
    signedScopes: signedCoverage.signedScopes,
    evidenceNote: 'Fullmakt verifierad manuellt och upplåser endast signerad omfattning.',
  })
  const blockerResult = await resolveCustomerBlockersAfterSignedPowerOfAttorney({
    companyId: actionContext.companyId,
    actorUserId: actor.id,
    customerId,
    siteId,
    powerOfAttorneyId,
    authorizationDocumentId: document.id,
  })
  const automationDecision = await resolveUploadAutomationDecision({
    supabase,
    customerId,
    siteId,
    documentType: document.document_type,
    markAsSigned: true,
    savedPowerOfAttorneyId: powerOfAttorneyId,
    autoCreateGridOwnerRequests: true,
    includeCustomerMasterdata: true,
    includeMeterValues: true,
    includeBillingUnderlay: true,
    autoCreateSwitchRequest: true,
    autoQueueSwitchOutbound: true,
    autoSendRequestsAfterSignedFullmakt: true,
    autoSendRequestsAfterUploadedFullmakt: true,
  })

  let createdGridOwnerRequestIds: string[] = []
  let createdGridOwnerOutboundIds: string[] = []
  let switchRequestId: string | null = null
  let switchOutboundId: string | null = null
  let switchEdielMessageId: string | null = null
  let switchEdielAutomationError: string | null = null
  let switchReadinessIssues: Array<{ code?: unknown; title?: unknown }> | null = null

  if (siteId && automationDecision.shouldCreateGridOwnerRequests) {
    const requestResult = await queueGridOwnerRequestsFromDocument({
      actorUserId: actor.id,
      customerId,
      siteId,
      document,
      meteringPointId: automationDecision.resolvedMeteringPointId,
      gridOwnerId: automationDecision.resolvedGridOwnerId,
      externalReference: document.reference,
      requestedPeriodStart,
      requestedPeriodEnd,
      notes: document.notes,
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
      document,
      requestType: 'switch',
      requestedStartDate,
      autoQueueOutbound: automationDecision.shouldQueueSwitchOutbound,
    })

    switchRequestId = switchResult.switchRequestId
    switchOutboundId = switchResult.switchOutboundId
    switchReadinessIssues = switchResult.readinessIssues

    if (switchResult.switchRequestId && automationDecision.shouldQueueSwitchOutbound) {
      try {
        const edielResult = await ensureInitialSwitchEdielAutomation({
          actorUserId: actor.id,
          switchRequestId: switchResult.switchRequestId,
        })

        if (edielResult.blocked) {
          automationDecision.warnings.push(
            `Ediel Z03 väntar: ${edielResult.blockers[0]?.message ?? 'sändfönster/readiness blockerar utskicket.'}`
          )
        }
        switchEdielMessageId = edielResult.message?.id ?? null
        if (!switchOutboundId && edielResult.outboundRequestId) {
          switchOutboundId = edielResult.outboundRequestId
        }
      } catch (error) {
        switchEdielAutomationError = error instanceof Error ? error.message : String(error)
        automationDecision.warnings.push(
          `Ediel Z03 skapades inte automatiskt efter verifierad fullmakt: ${switchEdielAutomationError}`
        )
      }
    }

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
    entityId: document.id,
    action: 'customer_authorization_document_verified_automation',
    oldValues: existingDocument,
    newValues: document,
    metadata: {
      customerId,
      siteId,
      linkedPowerOfAttorneyId: powerOfAttorneyId,
      authorizationScopeId,
      resolvedPowerOfAttorneyBlockers: blockerResult.resolved,
      createdGridOwnerRequestIds,
      createdGridOwnerOutboundIds,
      switchRequestId,
      switchOutboundId,
      switchEdielMessageId,
      switchEdielAutomationError,
      switchReadinessIssues,
      automationBlockedReasons: automationDecision.blockedReasons,
      automationWarnings: automationDecision.warnings,
      automationDecision,
      syncSummary,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath('/admin/controltower')
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
