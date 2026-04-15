'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { supabaseService } from '@/lib/supabase/service'

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function getNullableString(formData: FormData, key: string): string | null {
  const value = getString(formData, key)
  return value || null
}

function normalizeCustomerType(
  value: string | null | undefined
): 'private' | 'business' | 'association' {
  if (value === 'business') return 'business'
  if (value === 'association') return 'association'
  return 'private'
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function requireValue(value: string | null | undefined, message: string) {
  if (!normalizeOptionalString(value)) {
    throw new Error(message)
  }
}

async function getActorUserId(): Promise<string> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user.id
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

export async function saveCustomerProfileAction(formData: FormData): Promise<void> {
  const actorUserId = await getActorUserId()

  const customerId = getString(formData, 'customer_id')
  if (!customerId) {
    throw new Error('customer_id saknas')
  }

  const customerType = normalizeCustomerType(getNullableString(formData, 'customer_type'))
  const firstName = normalizeOptionalString(getNullableString(formData, 'first_name'))
  const lastName = normalizeOptionalString(getNullableString(formData, 'last_name'))
  const companyNameInput = normalizeOptionalString(getNullableString(formData, 'company_name'))
  const personalNumberInput = normalizeOptionalString(
    getNullableString(formData, 'personal_number')
  )
  const orgNumberInput = normalizeOptionalString(getNullableString(formData, 'org_number'))
  const email = normalizeOptionalString(getNullableString(formData, 'email'))
  const phone = normalizeOptionalString(getNullableString(formData, 'phone'))
  const apartmentNumber = normalizeOptionalString(
    getNullableString(formData, 'apartment_number')
  )
  const status = getNullableString(formData, 'status') ?? 'draft'

  requireValue(
    firstName,
    customerType === 'private'
      ? 'Privatkund kräver förnamn'
      : 'Företag eller förening kräver kontaktperson förnamn'
  )
  requireValue(
    lastName,
    customerType === 'private'
      ? 'Privatkund kräver efternamn'
      : 'Företag eller förening kräver kontaktperson efternamn'
  )

  const companyName = customerType === 'private' ? null : companyNameInput
  const personalNumber = customerType === 'private' ? personalNumberInput : null
  const orgNumber = customerType === 'private' ? null : orgNumberInput

  if (customerType !== 'private') {
    requireValue(companyName, 'Företag eller förening kräver namn')
    requireValue(orgNumber, 'Företag eller förening kräver organisationsnummer')
  }

  const fullName =
    customerType === 'private'
      ? [firstName, lastName].filter(Boolean).join(' ').trim() || null
      : companyName || [firstName, lastName].filter(Boolean).join(' ').trim() || null

  const { data: before, error: beforeError } = await supabaseService
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single()

  if (beforeError) throw beforeError

  const { data: updated, error: updateError } = await supabaseService
    .from('customers')
    .update({
      customer_type: customerType,
      status,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      company_name: companyName,
      personal_number: personalNumber,
      org_number: orgNumber,
      email,
      phone,
      apartment_number: apartmentNumber,
      updated_at: new Date().toISOString(),
    })
    .eq('id', customerId)
    .select('*')
    .single()

  if (updateError) throw updateError

  const { data: existingPrimaryContact, error: contactLookupError } = await supabaseService
    .from('customer_contacts')
    .select('*')
    .eq('customer_id', customerId)
    .eq('is_primary', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (contactLookupError) throw contactLookupError

  const primaryContactName =
    customerType === 'private'
      ? [firstName, lastName].filter(Boolean).join(' ').trim() || null
      : [firstName, lastName].filter(Boolean).join(' ').trim() || companyName || null

  if (existingPrimaryContact) {
    const { error: contactUpdateError } = await supabaseService
      .from('customer_contacts')
      .update({
        name: primaryContactName,
        email,
        phone,
      })
      .eq('id', existingPrimaryContact.id)

    if (contactUpdateError) throw contactUpdateError
  } else if (primaryContactName || email || phone) {
    const { error: contactInsertError } = await supabaseService
      .from('customer_contacts')
      .insert({
        customer_id: customerId,
        type: 'primary',
        name: primaryContactName,
        email,
        phone,
        title: null,
        is_primary: true,
      })

    if (contactInsertError) throw contactInsertError
  }

  await insertAuditLog({
    actorUserId,
    entityType: 'customer',
    entityId: customerId,
    action: 'customer_profile_updated',
    oldValues: before,
    newValues: updated,
    metadata: {
      syncedPrimaryContact: true,
    },
  })

  revalidatePath(`/admin/customers/${customerId}`)
  revalidatePath(`/admin/customers/${customerId}/profile`)
  revalidatePath('/admin/customers')
  revalidatePath('/admin/customers/segments')
}