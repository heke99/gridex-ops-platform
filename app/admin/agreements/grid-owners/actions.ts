'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import {
  archiveGridOwnerAccessAgreement,
  saveGridOwnerAccessAgreement,
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

async function uploadAgreementDocument(input: {
  formData: FormData
  companyId: string | null
  gridOwnerId: string | null
}): Promise<string | null> {
  const file = fileFromFormData(input.formData, 'document_file')
  if (!file) return null

  const bucket = process.env.GRID_OWNER_AGREEMENTS_BUCKET ?? 'grid-owner-agreements'
  const ownerPart = input.gridOwnerId ?? 'unknown-grid-owner'
  const companyPart = input.companyId ?? 'platform'
  const path = `${companyPart}/${ownerPart}/${Date.now()}-${safeFileName(file.name)}`

  const uploadResult = await supabaseService.storage
    .from(bucket)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/pdf',
    })

  if (uploadResult.error) throw uploadResult.error
  return `${bucket}:${path}`
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

export async function saveGridOwnerAgreementAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const id = text(formData, 'id')

  const companyId = text(formData, 'company_id')
  const gridOwnerId = text(formData, 'grid_owner_id')
  const uploadedDocumentPath = await uploadAgreementDocument({ formData, companyId, gridOwnerId })

  await saveGridOwnerAccessAgreement({
    id,
    actorUserId: admin.userId,
    companyId,
    gridOwnerId,
    agreementType: text(formData, 'agreement_type') ?? 'metering_access',
    agreementScope: text(formData, 'agreement_scope') ?? 'metering_access',
    status: text(formData, 'status') ?? 'draft',
    agreementReference: text(formData, 'agreement_reference'),
    externalAgreementNumber: text(formData, 'external_agreement_number'),
    validFrom: text(formData, 'valid_from'),
    validTo: text(formData, 'valid_to'),
    signedAt: text(formData, 'signed_at'),
    documentPath: uploadedDocumentPath ?? text(formData, 'document_path'),
    requiresCustomerAuthorization: bool(formData, 'requires_customer_authorization'),
    requiresMeteringPointId: bool(formData, 'requires_metering_point_id'),
    requiresFacilityId: bool(formData, 'requires_facility_id'),
    requiresCustomerPersonalNumber: bool(formData, 'requires_customer_personal_number'),
    requiresReportPeriod: bool(formData, 'requires_report_period'),
    preferredApplicationReference: text(formData, 'preferred_application_reference'),
    preferredMessageVersion: text(formData, 'preferred_message_version'),
    preferredReceiverEdielId: text(formData, 'preferred_receiver_ediel_id'),
    preferredReceiverSubAddress: text(formData, 'preferred_receiver_sub_address'),
    preferredRouteId: text(formData, 'preferred_route_id'),
    referenceRequirements: parseJson(text(formData, 'reference_requirements'), {}),
    metadata: parseJson(text(formData, 'metadata'), {}),
  })

  revalidatePath('/admin/agreements/grid-owners')
}

export async function archiveGridOwnerAgreementAction(formData: FormData) {
  const admin = await requirePlatformAdminActionAccess()
  const id = text(formData, 'id')
  if (!id) throw new Error('Avtals-id saknas.')

  await archiveGridOwnerAccessAgreement({ id, actorUserId: admin.userId })
  revalidatePath('/admin/agreements/grid-owners')
}
