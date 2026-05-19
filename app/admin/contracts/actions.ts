'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { saveContractOffer } from '@/lib/customer-contracts/db'
import type { ContractType, GreenFeeMode } from '@/lib/customer-contracts/types'
import { supabaseService } from '@/lib/supabase/service'
import { resolveTenantScope } from '@/lib/tenant/scope'

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

function parseStatus(value: string): 'draft' | 'active' | 'inactive' {
  if (value === 'active' || value === 'inactive') return value
  return 'draft'
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

async function getContractTenantContext(formData: FormData) {
  const admin = await requireAdminActionAccess(['pricing.write'])
  const scope = await resolveTenantScope({
    userId: admin.userId,
    roles: admin.roles,
    permissions: admin.permissions,
    requestedCompanyId: getString(formData, 'companyId') || null,
    requireCompany: true,
  })

  if (!scope.companyId) {
    throw new Error('Välj vilket företag avtalet ska tillhöra.')
  }

  return { actorUserId: admin.userId, companyId: scope.companyId }
}

async function writeContractOfferVersion(params: {
  companyId: string
  actorUserId: string
  offerId: string
  snapshot: Record<string, unknown>
}) {
  try {
    const { count } = await supabaseService
      .from('contract_offer_versions')
      .select('id', { count: 'exact', head: true })
      .eq('contract_offer_id', params.offerId)

    await supabaseService.from('contract_offer_versions').insert({
      company_id: params.companyId,
      contract_offer_id: params.offerId,
      version_number: (count ?? 0) + 1,
      snapshot: params.snapshot,
      created_by: params.actorUserId,
    })
  } catch (error) {
    console.warn('Contract offer version could not be written', error)
  }
}

export async function saveContractOfferAction(formData: FormData) {
  const { actorUserId, companyId } = await getContractTenantContext(formData)

  const id = getString(formData, 'id') || undefined
  const name = getString(formData, 'name')
  const validFrom = getString(formData, 'valid_from') || null
  const validTo = getString(formData, 'valid_to') || null

  if (!name) {
    throw new Error('Avtalsnamn krävs.')
  }

  if (validFrom && validTo && validTo < validFrom) {
    throw new Error('Slutdatum får inte vara tidigare än startdatum.')
  }

  const saved = await saveContractOffer({
    id,
    name,
    slug: getString(formData, 'slug') || null,
    status: parseStatus(getString(formData, 'status')),
    contractType: parseContractType(getString(formData, 'contract_type')),
    campaignName: getString(formData, 'campaign_name') || null,
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
    validFrom,
    validTo,
    actorUserId,
    companyId,
  })

  await writeContractOfferVersion({
    companyId,
    actorUserId,
    offerId: saved.id,
    snapshot: saved as unknown as Record<string, unknown>,
  })

  await supabaseService.from('audit_logs').insert({
    actor_user_id: actorUserId,
    company_id: companyId,
    entity_type: 'contract_offer',
    entity_id: saved.id,
    action: id ? 'contract_offer_updated' : 'contract_offer_created',
    new_values: saved,
  })

  revalidatePath('/admin/contracts')
  revalidatePath('/admin/customers/intake')
  revalidatePath('/admin/customers')
}
