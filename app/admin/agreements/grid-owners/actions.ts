//app/admin/agreements/grid-owners/actions.ts
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

function normalizeComparable(value: string | null): string | null {
  return value ? value.trim().toLowerCase().replace(/\s+/g, ' ') : null
}

async function resolveOrCreateAgreementGridOwner(params: {
  formData: FormData
  companyId: string | null
  actorUserId: string
  selectedGridOwnerId: string | null
}): Promise<{ gridOwnerId: string | null; warning: string | null }> {
  const selectedGridOwnerId = normalizedSelectId(params.selectedGridOwnerId)
  const newName = text(params.formData, 'new_grid_owner_name')
  const newOrgNumber = text(params.formData, 'new_grid_owner_org_number')
  const newEdielId = text(params.formData, 'new_grid_owner_ediel_id')
  const newEmail = text(params.formData, 'new_grid_owner_email')
  const newPhone = text(params.formData, 'new_grid_owner_phone')

  if (selectedGridOwnerId || !newName) return { gridOwnerId: selectedGridOwnerId, warning: null }

  let query = supabaseService.from('grid_owners').select('id,name,org_number,ediel_id').limit(500)
  if (params.companyId) query = query.or(`company_id.is.null,company_id.eq.${params.companyId}`)
  const { data, error } = await query
  if (error) throw error

  const nameKey = normalizeComparable(newName)
  const orgKey = normalizeComparable(newOrgNumber)
  const edielKey = normalizeComparable(newEdielId)
  const match = ((data ?? []) as Array<Record<string, unknown>>).find((row) => {
    const rowName = normalizeComparable(typeof row.name === 'string' ? row.name : null)
    const rowOrg = normalizeComparable(typeof row.org_number === 'string' ? row.org_number : null)
    const rowEdiel = normalizeComparable(typeof row.ediel_id === 'string' ? row.ediel_id : null)
    return Boolean(
      (edielKey && rowEdiel === edielKey) ||
      (orgKey && rowOrg === orgKey) ||
      (nameKey && rowName === nameKey)
    )
  })

  if (match?.id) {
    return {
      gridOwnerId: String(match.id),
      warning: `Möjlig dubblett på nätägare hittades. Befintlig nätägare används: ${String(match.name ?? match.id)}.`,
    }
  }

  const { data: created, error: insertError } = await supabaseService
    .from('grid_owners')
    .insert({
      company_id: params.companyId,
      name: newName,
      owner_code: newEdielId ?? newOrgNumber ?? newName.slice(0, 24),
      ediel_id: newEdielId,
      org_number: newOrgNumber,
      email: newEmail,
      phone: newPhone,
      country: 'SE',
      notes: 'Skapad direkt från nätägaravtalet. Kontrollera route och Ediel-profil innan liveflöde skickas.',
      is_active: true,
      created_by: params.actorUserId,
      updated_by: params.actorUserId,
    })
    .select('id')
    .single()
  if (insertError) throw insertError
  return { gridOwnerId: String(created.id), warning: `Ny nätägare skapades från avtalsformuläret: ${newName}.` }
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
  const agreementScope = scopeFromUsage(text(formData, 'agreement_scope') ?? text(formData, 'agreement_type'))
  const gridOwnerResolution = await resolveOrCreateAgreementGridOwner({
    formData,
    companyId,
    actorUserId: admin.userId,
    selectedGridOwnerId: text(formData, 'grid_owner_id'),
  })
  const gridOwnerId = gridOwnerResolution.gridOwnerId
  const uploadedDocumentPath = await uploadAgreementDocument({ formData, companyId, gridOwnerId })

  await saveGridOwnerAccessAgreement({
    id,
    actorUserId: admin.userId,
    companyId,
    gridOwnerId,
    agreementType: text(formData, 'agreement_type') ?? agreementScope,
    agreementScope,
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
    preferredApplicationReference: text(formData, 'preferred_application_reference') ?? defaultApplicationReference(agreementScope),
    preferredMessageVersion: text(formData, 'preferred_message_version'),
    preferredReceiverEdielId: text(formData, 'preferred_receiver_ediel_id'),
    preferredReceiverSubAddress: text(formData, 'preferred_receiver_sub_address'),
    preferredRouteId: text(formData, 'preferred_route_id'),
    referenceRequirements: parseJson(text(formData, 'reference_requirements'), {}),
    metadata: {
      ...parseJson(text(formData, 'metadata'), {}),
      businessLabel: text(formData, 'agreement_scope_label'),
      gridOwnerResolutionWarning: gridOwnerResolution.warning,
    },
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
