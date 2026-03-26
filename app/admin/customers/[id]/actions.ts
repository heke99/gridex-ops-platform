'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { MASTERDATA_PERMISSIONS } from '@/lib/admin/masterdataPermissions'
import { saveCustomerSite, saveMeteringPoint } from '@/lib/masterdata/db'
import {
  customerSiteInputSchema,
  meteringPointInputSchema,
  parseCheckbox,
} from '@/lib/masterdata/validators'

function formValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  return value
}

function normalizeUuidOrNull(value: string | null): string | null {
  if (!value) return null
  return value
}

function normalizePriceAreaOrNull(
  value: string | null
): 'SE1' | 'SE2' | 'SE3' | 'SE4' | null {
  if (!value) return null
  if (value === 'SE1' || value === 'SE2' || value === 'SE3' || value === 'SE4') {
    return value
  }
  return null
}

export async function saveCustomerSiteAction(formData: FormData): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''

  const parsed = customerSiteInputSchema.parse({
    id: formValue(formData, 'id') || undefined,
    customer_id: customerId,
    site_name: formValue(formData, 'site_name') ?? '',
    facility_id: formValue(formData, 'facility_id') || undefined,
    site_type: formValue(formData, 'site_type') ?? 'consumption',
    status: formValue(formData, 'status') ?? 'draft',
    grid_owner_id: normalizeUuidOrNull(formValue(formData, 'grid_owner_id')),
    price_area_code: normalizePriceAreaOrNull(formValue(formData, 'price_area_code')),
    move_in_date: formValue(formData, 'move_in_date') || undefined,
    annual_consumption_kwh: formValue(formData, 'annual_consumption_kwh'),
    current_supplier_name:
      formValue(formData, 'current_supplier_name') || undefined,
    current_supplier_org_number:
      formValue(formData, 'current_supplier_org_number') || undefined,
    street: formValue(formData, 'street') || undefined,
    care_of: formValue(formData, 'care_of') || undefined,
    postal_code: formValue(formData, 'postal_code') || undefined,
    city: formValue(formData, 'city') || undefined,
    country: formValue(formData, 'country') || 'SE',
    internal_notes: formValue(formData, 'internal_notes') || undefined,
  })

  await saveCustomerSite(supabase, parsed)
  revalidatePath(`/admin/customers/${customerId}`)
}

export async function saveMeteringPointAction(formData: FormData): Promise<void> {
  await requireAdminActionAccess([MASTERDATA_PERMISSIONS.WRITE])

  const supabase = await createSupabaseServerClient()
  const customerId = formValue(formData, 'customer_id') ?? ''

  const parsed = meteringPointInputSchema.parse({
    id: formValue(formData, 'id') || undefined,
    site_id: formValue(formData, 'site_id') ?? '',
    meter_point_id: formValue(formData, 'meter_point_id') ?? '',
    site_facility_id: formValue(formData, 'site_facility_id') || undefined,
    ediel_reference: formValue(formData, 'ediel_reference') || undefined,
    status: formValue(formData, 'status') ?? 'draft',
    measurement_type: formValue(formData, 'measurement_type') ?? 'consumption',
    reading_frequency: formValue(formData, 'reading_frequency') ?? 'hourly',
    grid_owner_id: normalizeUuidOrNull(formValue(formData, 'grid_owner_id')),
    price_area_code: normalizePriceAreaOrNull(formValue(formData, 'price_area_code')),
    start_date: formValue(formData, 'start_date') || undefined,
    end_date: formValue(formData, 'end_date') || undefined,
    is_settlement_relevant: parseCheckbox(formData.get('is_settlement_relevant')),
  })

  await saveMeteringPoint(supabase, parsed)
  revalidatePath(`/admin/customers/${customerId}`)
}