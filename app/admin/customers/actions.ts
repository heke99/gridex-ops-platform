'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getUserPermissions } from '@/lib/rbac/getUserPermissions'
import { supabaseService } from '@/lib/supabase/service'

async function requireMasterdataWrite() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Unauthorized')

  const permissions = await getUserPermissions(user.id)
  if (!permissions.includes('masterdata.write')) {
    throw new Error('Forbidden')
  }

  return user
}

export async function createCustomerAction(formData: FormData) {
  const actor = await requireMasterdataWrite()

  const customerType = String(formData.get('customerType') ?? 'private')
  const firstName = String(formData.get('firstName') ?? '')
  const lastName = String(formData.get('lastName') ?? '')
  const companyName = String(formData.get('companyName') ?? '')
  const email = String(formData.get('email') ?? '')
  const phone = String(formData.get('phone') ?? '')
  const personalNumber = String(formData.get('personalNumber') ?? '')
  const orgNumber = String(formData.get('orgNumber') ?? '')

  const fullName =
    customerType === 'private'
      ? `${firstName} ${lastName}`.trim()
      : companyName.trim()

  const { data, error } = await supabaseService
    .from('customers')
    .insert({
      customer_type: customerType,
      status: 'draft',
      first_name: firstName || null,
      last_name: lastName || null,
      full_name: fullName || null,
      company_name: companyName || null,
      email: email || null,
      phone: phone || null,
      personal_number: personalNumber || null,
      org_number: orgNumber || null,
      created_by: actor.id,
    })
    .select('id')
    .single()

  if (error) throw error

  await supabaseService.from('audit_logs').insert({
    actor_user_id: actor.id,
    entity_type: 'customer',
    entity_id: data.id,
    action: 'customer_created',
    new_values: {
      customerType,
      fullName,
      email,
      phone,
    },
  })

  revalidatePath('/admin/customers')
}