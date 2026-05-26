'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { savePriceAreaLocality } from '@/lib/masterdata/db'
import {
  parseCheckbox,
  priceAreaLocalityInputSchema,
} from '@/lib/masterdata/validators'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  return value
}

export async function savePriceAreaLocalityAction(
  formData: FormData
): Promise<void> {
  await requirePlatformAdminActionAccess()

  const supabase = await createSupabaseServerClient()

  const parsed = priceAreaLocalityInputSchema.parse({
    id: formValue(formData, 'id') || undefined,
    price_area_code: formValue(formData, 'price_area_code') ?? 'SE4',
    locality_name: formValue(formData, 'locality_name') ?? '',
    municipality: formValue(formData, 'municipality') || undefined,
    postal_code: formValue(formData, 'postal_code') || undefined,
    is_active: parseCheckbox(formData.get('is_active')),
  })

  await savePriceAreaLocality(supabase, parsed)

  revalidatePath('/admin/price-area-localities')
}