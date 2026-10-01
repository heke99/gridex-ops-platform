//app/admin/agreements/grid-owners/actions.ts

'use server'

import { createHash } from 'node:crypto'
import { unstable_rethrow } from 'next/navigation'
import { currentSupportSession } from '@/lib/customer-operations/supportSession'
import { isGridOwnerAgreementBucket, parseGridOwnerAgreementDocumentKey } from '@/lib/routes/gridOwnerAgreementDocumentKey'
import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  archiveGridOwnerAccessAgreement,
  agreementSaveCommand, completeAgreementUploadCleanup, executeAgreementCommand,
  getGridOwnerAccessAgreementById, GridOwnerAgreementCommandError,
  prepareAgreementDocumentUpload, reconcileAgreementUpload,
  type AgreementUploadIntent, type GridOwnerAgreementCommand, type GridOwnerAgreementResult,
} from '@/lib/routes/gridOwnerAgreements'

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === 'on' || formData.get(key) === 'true'
}

function normalizedSelectId(value: string | null): string | null {
  if (!value || value === '__new__') return null
  return value
}

function scopeFromUsage(value: string | null): string {
  if (value === 'supplier_switch') return 'supplier_switch'
  if (value === 'customer_masterdata') return 'customer_masterdata'
  if (value === 'meter_values') return 'meter_values'
  if (value === 'billing_underlay') return 'billing_underlay'
  if (value === 'general_ediel') return 'general_ediel'
  return 'metering_access'
}

function defaultApplicationReference(scope: string): string | null {
  if (scope === 'metering_access') return '23-DGI-PRODAT'
  if (scope === 'supplier_switch' || scope === 'customer_masterdata') return '23-DDQ-PRODAT'
  return null
}

function fileFromFormData(formData: FormData, key: string): File | null {
  const value = formData.get(key)
  if (!value || typeof value !== 'object' || !('arrayBuffer' in value) || !('size' in value)) return null
  const file = value as File
  return file.size > 0 ? file : null
}

function safeFileName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return cleaned || 'agreement.pdf'
}

function parseJson(value: string | null, fallback: Record<string, unknown>) {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : fallback
  } catch {
    return fallback
  }
}

function refreshAgreementView() {
  try { revalidatePath('/admin/agreements/grid-owners') }
  catch (error) { unstable_rethrow(error); console.warn('Agreement saved; view refresh requires retry.') }
}
function commandKey(formData: FormData, actorId: string, binding: unknown): string {
  return text(formData, 'idempotency_key') ?? 'agreement-' + createHash('sha256').update(JSON.stringify({ actorId, binding })).digest('hex')
}
function safeMutationError(error: unknown) {
  return error instanceof GridOwnerAgreementCommandError ? error : new GridOwnerAgreementCommandError('agreement_unavailable', 503)
}
async function cleanupUnattachedUpload(command: GridOwnerAgreementCommand, intent: AgreementUploadIntent) {
  try {
    const { error } = await supabaseService.storage.from(intent.bucket).remove([intent.path])
    if (error) throw new GridOwnerAgreementCommandError('agreement_cleanup_pending', 503)
    await completeAgreementUploadCleanup(command, intent)
  } catch (error) {
    unstable_rethrow(error)
    // Durable cleanup_required remains; never include Storage paths or errors.
    console.warn('Agreement upload cleanup requires retry.')
  }
}
export async function saveGridOwnerAgreementAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const actor = await currentSupportSession('ops', admin.userId)
  const id = text(formData, 'id')
  const companyId = text(formData, 'company_id')
  const current = id ? await getGridOwnerAccessAgreementById(id) : null
  if (id && (!current || current.company_id !== companyId)) throw new GridOwnerAgreementCommandError('agreement_resource_unavailable', 404)
  const expectedRevision = current?.revision ?? 0
  const agreementScope = scopeFromUsage(text(formData, 'agreement_scope') ?? text(formData, 'agreement_type'))
  const gridOwnerId = normalizedSelectId(text(formData, 'grid_owner_id'))
  const newName = text(formData, 'new_grid_owner_name')
  const newGridOwner = !gridOwnerId && newName ? {
    name: newName, orgNumber: text(formData, 'new_grid_owner_org_number'), edielId: text(formData, 'new_grid_owner_ediel_id'),
    email: text(formData, 'new_grid_owner_email'), phone: text(formData, 'new_grid_owner_phone'),
  } : undefined
  const bucket = process.env.GRID_OWNER_AGREEMENTS_BUCKET ?? 'grid-owner-agreements'
  if (!isGridOwnerAgreementBucket(bucket) || bucket === 'customer-support-quarantine') throw new GridOwnerAgreementCommandError('invalid_agreement_document', 422)
  const file = fileFromFormData(formData, 'document_file')
  const documentPath = file ? null : text(formData, 'document_path')
  if (documentPath) {
    const parsed = parseGridOwnerAgreementDocumentKey(documentPath, bucket)
    if (!parsed || parsed.bucket !== bucket) throw new GridOwnerAgreementCommandError('invalid_agreement_document', 422)
  }
  if (file && file.size > 52428800) throw new GridOwnerAgreementCommandError('invalid_agreement_document', 422)
  const documentFile = file ? { bucket, name: safeFileName(file.name), sha256: createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex'),
    size: file.size, contentType: file.type || 'application/pdf' } : undefined
  const input = {
    id, actor, companyId, gridOwnerId, newGridOwner, expectedRevision, idempotencyKey: '',
    agreementType: text(formData, 'agreement_type') ?? agreementScope, agreementScope, status: text(formData, 'status') ?? 'draft',
    agreementReference: text(formData, 'agreement_reference'), externalAgreementNumber: text(formData, 'external_agreement_number'),
    validFrom: text(formData, 'valid_from'), validTo: text(formData, 'valid_to'), signedAt: text(formData, 'signed_at'),
    documentPath, documentFile,
    requiresCustomerAuthorization: bool(formData, 'requires_customer_authorization'), requiresMeteringPointId: bool(formData, 'requires_metering_point_id'),
    requiresFacilityId: bool(formData, 'requires_facility_id'), requiresCustomerPersonalNumber: bool(formData, 'requires_customer_personal_number'),
    requiresReportPeriod: bool(formData, 'requires_report_period'),
    preferredApplicationReference: text(formData, 'preferred_application_reference') ?? defaultApplicationReference(agreementScope),
    preferredMessageVersion: text(formData, 'preferred_message_version'), preferredReceiverEdielId: text(formData, 'preferred_receiver_ediel_id'),
    preferredReceiverSubAddress: text(formData, 'preferred_receiver_sub_address'), preferredRouteId: text(formData, 'preferred_route_id'),
    referenceRequirements: parseJson(text(formData, 'reference_requirements'), {}),
    metadata: { ...parseJson(text(formData, 'metadata'), {}), businessLabel: text(formData, 'agreement_scope_label') },
  }
  const base = agreementSaveCommand(input)
  const command = { ...base, idempotencyKey: commandKey(formData, actor.userId, { ...base, sessionId: undefined, idempotencyKey: undefined }) }
  let intent: AgreementUploadIntent | undefined
  let saved: GridOwnerAgreementResult | undefined
  if (file) {
    const prepared = await prepareAgreementDocumentUpload(command, bucket)
    if (prepared.committed) { refreshAgreementView(); return }
    intent = prepared.intent
    if (!intent) throw new GridOwnerAgreementCommandError('agreement_invalid_receipt', 503)
  }
  try {
    if (file && intent) {
      const { error } = await supabaseService.storage.from(intent.bucket).upload(intent.path, file, { cacheControl: '3600', upsert: false, contentType: documentFile?.contentType })
      if (error) throw new GridOwnerAgreementCommandError('agreement_upload_unavailable', 503)
    }
    saved = await executeAgreementCommand(command, intent)
  } catch (error) {
    unstable_rethrow(error)
    if (!intent) throw safeMutationError(error)
    let receipt
    try { receipt = await reconcileAgreementUpload(command, intent) }
    catch (reconcileError) {
      unstable_rethrow(reconcileError)
      console.warn('Agreement upload reconciliation requires retry.')
      throw safeMutationError(error)
    }
    if (receipt.cleanup) await cleanupUnattachedUpload(command, receipt.cleanup)
    if (!receipt.committed) throw safeMutationError(error)
    saved = receipt.committed
  }
  if (saved.replayed && intent) {
    try {
      const receipt = await reconcileAgreementUpload(command, intent)
      if (receipt.cleanup) await cleanupUnattachedUpload(command, receipt.cleanup)
    } catch (error) { unstable_rethrow(error); console.warn('Agreement upload reconciliation requires retry.') }
  }
  refreshAgreementView()
}
export async function archiveGridOwnerAgreementAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const actor = await currentSupportSession('ops', admin.userId)
  const id = text(formData, 'id')
  if (!id) throw new GridOwnerAgreementCommandError('invalid_agreement_command', 422)
  const current = await getGridOwnerAccessAgreementById(id)
  if (!current) throw new GridOwnerAgreementCommandError('agreement_resource_unavailable', 404)
  const binding = { operation: 'archive', id, companyId: current.company_id, expectedRevision: current.revision }
  await archiveGridOwnerAccessAgreement({ ...binding, actor, idempotencyKey: commandKey(formData, actor.userId, binding) })
  refreshAgreementView()
}
