'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { saveContractOffer } from '@/lib/customer-contracts/db'
import type { ContractType, GreenFeeMode } from '@/lib/customer-contracts/types'
import { supabaseService } from '@/lib/supabase/service'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'

function getString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function getNullableNumber(formData: FormData, key: string): number | null {
  const raw = getString(formData, key)
  if (!raw) return null
  const parsed = Number(raw.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function getNullableInt(formData: FormData, key: string): number | null {
  const raw = getString(formData, key)
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseContractType(value: string): ContractType {
  switch (value) {
    case 'fixed':
    case 'variable_monthly':
    case 'variable_hourly':
    case 'portfolio':
      return value
    default:
      return 'variable_hourly'
  }
}

function parseGreenFeeMode(value: string): GreenFeeMode {
  switch (value) {
    case 'sek_month':
    case 'ore_per_kwh':
      return value
    default:
      return 'none'
  }
}

function parseOptionalFeeLines(value: string): Array<Record<string, unknown>> {
  const trimmed = value.trim()
  if (!trimmed) return []

  return trimmed
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [label, amountRaw, unitRaw] = row.split('|').map((part) => part.trim())
      const amount = amountRaw ? Number(amountRaw.replace(',', '.')) : null

      return {
        label: label || '',
        amount: Number.isFinite(amount ?? NaN) ? amount : null,
        unit: unitRaw || 'sek',
      }
    })
}

export async function saveContractOfferAction(formData: FormData) {
  await requirePlatformAdminActionAccess()

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  const companyId = await requireOperationalCompanyId(user.id)
  await requireCompanyOperationalForWrites(companyId)
  const id = getString(formData, 'id') || undefined
  const name = getString(formData, 'name')

  let previous: Record<string, unknown> | null = null
  if (id) {
    const { data: oldOffer, error: oldOfferError } = await supabaseService
      .from('contract_offers')
      .select('*')
      .eq('id', id)
      .eq('company_id', companyId)
      .maybeSingle()
    if (oldOfferError) throw oldOfferError
    previous = (oldOffer as Record<string, unknown> | null) ?? null
  }

  if (!name) {
    throw new Error('Avtalsnamn krävs')
  }

  const saved = await saveContractOffer({
    id,
    companyId,
    name,
    slug: getString(formData, 'slug') || null,
    status: (getString(formData, 'status') || 'active') as 'draft' | 'active' | 'inactive',
    contractType: parseContractType(getString(formData, 'contract_type')),
    campaignName: getString(formData, 'campaign_name') || null,
    campaignCode: getString(formData, 'campaign_code') || null,
    campaignVersion: getString(formData, 'campaign_version') || null,
    priceVersion: getString(formData, 'price_version') || null,
    termsVersion: getString(formData, 'terms_version') || null,
    maxCustomers: getNullableInt(formData, 'max_customers'),
    discountValue: getNullableNumber(formData, 'discount_value'),
    discountUnit: getString(formData, 'discount_unit') || null,
    startFeeSek: getNullableNumber(formData, 'start_fee_sek'),
    adminFeeSek: getNullableNumber(formData, 'admin_fee_sek'),
    breakFeeSek: getNullableNumber(formData, 'break_fee_sek'),
    vatRate: getNullableNumber(formData, 'vat_rate'),
    description: getString(formData, 'description') || null,
    fixedPriceOrePerKwh: getNullableNumber(formData, 'fixed_price_ore_per_kwh'),
    spotMarkupOrePerKwh: getNullableNumber(formData, 'spot_markup_ore_per_kwh'),
    variableFeeOrePerKwh: getNullableNumber(formData, 'variable_fee_ore_per_kwh'),
    monthlyFeeSek: getNullableNumber(formData, 'monthly_fee_sek'),
    greenFeeMode: parseGreenFeeMode(getString(formData, 'green_fee_mode')),
    greenFeeValue: getNullableNumber(formData, 'green_fee_value'),
    defaultBindingMonths: getNullableInt(formData, 'default_binding_months'),
    defaultNoticeMonths: getNullableInt(formData, 'default_notice_months'),
    optionalFeeLines: parseOptionalFeeLines(getString(formData, 'optional_fee_lines')),
    isActive: getString(formData, 'is_active') === 'on',
    validFrom: getString(formData, 'valid_from') || null,
    validTo: getString(formData, 'valid_to') || null,
    actorUserId: user.id,
  })

  await supabaseService.from('audit_logs').insert({
    actor_user_id: user.id,
    entity_type: 'contract_offer',
    entity_id: saved.id,
    company_id: companyId,
    action: id ? 'contract_offer_updated_platform_admin_only' : 'contract_offer_created_platform_admin_only',
    old_values: previous,
    new_values: saved,
    metadata: {
      campaign_code: (saved as Record<string, unknown>).campaign_code ?? null,
      campaign_version: (saved as Record<string, unknown>).campaign_version ?? null,
      price_version: (saved as Record<string, unknown>).price_version ?? null,
      terms_version: (saved as Record<string, unknown>).terms_version ?? null,
    },
  })

  revalidatePath('/admin/contracts')
  revalidatePath('/admin/customers/intake')
  revalidatePath('/admin/customers')
}