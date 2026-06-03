'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { supabaseService } from '@/lib/supabase/service'
import { normalizeTransportSecurityMode } from '@/lib/ediel/partyRegistry'
import { fetchReceiverCertificatesFromExpisoft } from '@/lib/ediel/security/expisoftCertificateDirectory'

function value(formData: FormData, key: string): string | null {
  const raw = formData.get(key)
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function boolValue(formData: FormData, key: string): boolean {
  const raw = formData.get(key)
  return raw === 'true' || raw === 'on' || raw === '1'
}

function normalizeRolesForParty(formData: FormData): string[] {
  const selected = new Set(values(formData, 'roles'))
  const partyType = value(formData, 'partyType')
  if (partyType) selected.add(partyType)
  if (partyType === 'electricity_supplier') selected.add('supplier')
  if (partyType === 'balance_responsible_party') selected.add('brp')
  return Array.from(selected)
}

function primaryPartyType(roles: string[]): string {
  if (roles.includes('grid_owner')) return 'grid_owner'
  if (roles.includes('electricity_supplier') || roles.includes('supplier')) return 'electricity_supplier'
  if (roles.includes('energy_service_company')) return 'energy_service_company'
  if (roles.includes('balance_responsible_party') || roles.includes('brp')) return 'balance_responsible_party'
  if (roles.includes('ediel_portal')) return 'ediel_portal'
  if (roles.includes('test_counterparty')) return 'test_counterparty'
  return roles[0] ?? 'other'
}

function customerFlowVisibilityAllowed(roles: string[], status: string): boolean {
  if (status !== 'verified') return false
  if (roles.includes('ediel_portal') || roles.includes('test_counterparty')) return false
  return roles.includes('grid_owner') || roles.includes('electricity_supplier') || roles.includes('supplier')
}

function values(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export async function saveEdielPartyRegistryEntryAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const name = value(formData, 'name')
  const edielId = value(formData, 'edielId')
  if (!name || !edielId) throw new Error('Namn och Ediel-ID krävs.')

  const now = new Date().toISOString()
  const roles = normalizeRolesForParty(formData)
  const status = value(formData, 'status') ?? 'needs_verification'
  const source = value(formData, 'source') ?? 'manual'
  const addressSource = source === 'import' ? 'manual' : source
  const partyType = primaryPartyType(roles)
  const requestedVisibleToCustomerFlow = boolValue(formData, 'visibleToCustomerFlow')
  const visibleToCustomerFlow = requestedVisibleToCustomerFlow && customerFlowVisibilityAllowed(roles, status)

  const partyPayload = {
    name,
    organization_number: value(formData, 'organizationNumber'),
    ediel_id: edielId,
    roles,
    status,
    visible_to_customer_flow: visibleToCustomerFlow,
    source,
    notes: value(formData, 'notes'),
    updated_by: context.userId,
    updated_at: now,
  }

  const existing = await supabaseService
    .from('ediel_parties')
    .select('id')
    .eq('ediel_id', edielId)
    .maybeSingle()
  if (existing.error) throw existing.error

  const partyResult = existing.data?.id
    ? await supabaseService
        .from('ediel_parties')
        .update(partyPayload)
        .eq('id', existing.data.id)
        .select('id')
        .single()
    : await supabaseService
        .from('ediel_parties')
        .insert({ ...partyPayload, created_by: context.userId })
        .select('id')
        .single()

  if (partyResult.error) throw partyResult.error

  const messageFamily = (value(formData, 'messageFamily') ?? 'PRODAT').toUpperCase()
  const businessCode = value(formData, 'businessCode')?.toUpperCase() ?? null
  const environment = value(formData, 'environment') ?? 'test'
  const subaddress = value(formData, 'subaddress')?.toUpperCase() ?? null
  const smtpAddress = value(formData, 'smtpAddress')
  const transportSecurityMode = normalizeTransportSecurityMode(
    value(formData, 'transportSecurityMode') ??
      (roles.includes('grid_owner') && messageFamily === 'PRODAT' ? 'required_encrypted' : 'needs_verification'),
  )

  if (smtpAddress) {
    let receiverCertificateId = value(formData, 'receiverCertificateId')
    let certificateLookupSummary: Record<string, unknown> | null = null
    const shouldLookupCertificate = boolValue(formData, 'lookupCertificateOnSave') || boolValue(formData, 'fetchCertificateOnSave')
    if (!receiverCertificateId && shouldLookupCertificate && messageFamily === 'PRODAT') {
      const lookup = await fetchReceiverCertificatesFromExpisoft({
        smtpEmail: smtpAddress,
        edielId,
        subaddress,
        partyId: partyResult.data.id,
        forceRefresh: true,
      })
      const firstValid = lookup.certificates.find((certificate) => certificate.status === 'valid' && certificate.certificateId)
      receiverCertificateId = firstValid?.certificateId ?? lookup.certificates.find((certificate) => certificate.certificateId)?.certificateId ?? null
      certificateLookupSummary = {
        lookupEmail: lookup.lookupEmail,
        certificatesFound: lookup.certificatesFound,
        validCount: lookup.certificates.filter((certificate) => certificate.status === 'valid').length,
        selectedCertificateId: receiverCertificateId,
        ldapUrl: lookup.ldapUrl,
      }
    }

    const effectiveTransportSecurityMode = messageFamily === 'PRODAT' && receiverCertificateId
      ? normalizeTransportSecurityMode('required_encrypted')
      : transportSecurityMode

    const addressPayload = {
      party_id: partyResult.data.id,
      ediel_id: edielId,
      qualifier: value(formData, 'qualifier') ?? 'ZZ',
      subaddress,
      message_family: messageFamily,
      message_type: messageFamily,
      business_code: businessCode,
      environment,
      smtp_address: smtpAddress,
      transport_security_mode: effectiveTransportSecurityMode,
      requires_subaddress: boolValue(formData, 'requiresSubaddress') || Boolean(subaddress),
      certificate_required: boolValue(formData, 'certificateRequired') || effectiveTransportSecurityMode === 'required_encrypted',
      receiver_certificate_id: receiverCertificateId,
      status: value(formData, 'addressStatus') ?? (effectiveTransportSecurityMode === 'needs_verification' ? 'needs_verification' : 'active'),
      source: addressSource,
      last_verified_at: value(formData, 'lastVerifiedAt') ?? (source === 'manual_verified' || source === 'grid_owner_confirmation' ? now : null),
      valid_from: value(formData, 'validFrom'),
      valid_to: value(formData, 'validTo'),
      metadata: {
        createdFrom: 'admin_ediel_party_registry',
        partyType,
        requestedVisibleToCustomerFlow,
        visibilityWasAccepted: visibleToCustomerFlow,
        certificateLookup: certificateLookupSummary,
      },
      updated_by: context.userId,
      updated_at: now,
    }

    let existingAddressQuery = supabaseService
      .from('ediel_party_addresses')
      .select('id')
      .eq('party_id', partyResult.data.id)
      .eq('environment', environment)
      .eq('message_family', messageFamily)
    existingAddressQuery = businessCode
      ? existingAddressQuery.eq('business_code', businessCode)
      : existingAddressQuery.is('business_code', null)
    const existingAddress = await existingAddressQuery
      .maybeSingle()

    if (existingAddress.error && existingAddress.error.code !== 'PGRST116') throw existingAddress.error

    const addressResult = existingAddress.data?.id
      ? await supabaseService
          .from('ediel_party_addresses')
          .update(addressPayload)
          .eq('id', existingAddress.data.id)
      : await supabaseService
          .from('ediel_party_addresses')
          .insert({ ...addressPayload, created_by: context.userId })

    if (addressResult.error) throw addressResult.error
  }

  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/ediel/routes')
}

export async function refreshExpisoftReceiverCertificateAction(formData: FormData) {
  await requirePlatformAdminActionAccess()
  const smtpEmail = value(formData, 'smtpEmail')
  if (!smtpEmail) throw new Error('SMTP address krävs för Expisoft lookup.')
  await fetchReceiverCertificatesFromExpisoft({
    smtpEmail,
    edielId: value(formData, 'edielId'),
    subaddress: value(formData, 'subaddress'),
    partyId: value(formData, 'partyId'),
    forceRefresh: boolValue(formData, 'forceRefresh'),
  })
  revalidatePath('/admin/ediel/actors')
  revalidatePath('/admin/ediel/certificates')
}
