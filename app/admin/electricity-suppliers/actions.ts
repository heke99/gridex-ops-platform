'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { saveElectricitySupplier } from '@/lib/masterdata/db'
import {
  electricitySupplierInputSchema,
  parseCheckbox,
} from '@/lib/masterdata/validators'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  return value
}

export async function saveElectricitySupplierAction(
  formData: FormData
): Promise<void> {
  await requirePlatformAdminActionAccess()

  const supabase = await createSupabaseServerClient()

  const parsed = electricitySupplierInputSchema.parse({
    id: formValue(formData, 'id') || undefined,
    name: formValue(formData, 'name') ?? '',
    org_number: formValue(formData, 'org_number') || undefined,
    market_actor_code: formValue(formData, 'market_actor_code') || undefined,
    ediel_id: formValue(formData, 'ediel_id') || undefined,
    contact_name: formValue(formData, 'contact_name') || undefined,
    email: formValue(formData, 'email') || undefined,
    phone: formValue(formData, 'phone') || undefined,
    notes: formValue(formData, 'notes') || undefined,
    is_active: parseCheckbox(formData.get('is_active')),
  })

  await saveElectricitySupplier(supabase, parsed)

  revalidatePath('/admin/electricity-suppliers')
}