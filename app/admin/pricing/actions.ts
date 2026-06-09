'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'
import { createPricingComponentRule } from '@/lib/billing/pricingEngine'
import { calculationTypeForPricingUnit, displayPricingUnit, normalizePricingUnit } from '@/lib/pricing/unitConversion'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function nullableText(formData: FormData, key: string): string | null {
  const value = text(formData, key)
  return value || null
}

function nullableNumber(formData: FormData, key: string): number | null {
  const value = text(formData, key)
  if (!value) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function nullableInteger(formData: FormData, key: string): number | null {
  const value = text(formData, key)
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export async function createPricingComponentRuleAction(formData: FormData) {
  await requireAdminActionAccess(['pricing.write'])
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Du måste vara inloggad.')

  const companyId = await requireOperationalCompanyId(user.id)

  const selectedUnit = text(formData, 'calculation_unit') || 'ore_per_kwh'
  const normalizedUnit = normalizePricingUnit({ unit: selectedUnit })
  const createdRule = await createPricingComponentRule({
    companyId,
    actorUserId: user.id,
    contractOfferId: nullableText(formData, 'contract_offer_id'),
    componentCode: text(formData, 'component_code'),
    componentLabel: text(formData, 'component_label'),
    componentType: text(formData, 'component_type') || 'variable_fee',
    calculationUnit: selectedUnit,
    valueAmount: nullableNumber(formData, 'value_amount'),
    currency: text(formData, 'currency') || 'SEK',
    appliesTo: text(formData, 'applies_to') || 'contract',
    validFrom: nullableText(formData, 'valid_from'),
    validTo: nullableText(formData, 'valid_to'),
    priority: nullableInteger(formData, 'priority'),
    isActive: formData.get('is_active') !== 'off',
    metadata: {
      note: nullableText(formData, 'note'),
      selected_unit: selectedUnit,
      normalized_pricing_unit: normalizedUnit,
      unit_display_label: displayPricingUnit(normalizedUnit),
      calculation_type_for_engine: calculationTypeForPricingUnit(selectedUnit),
      invoice_line_unit_source: 'admin_selected_unit',
    },
  })

  await supabase
    .from('audit_logs')
    .insert({
      company_id: companyId,
      actor_user_id: user.id,
      entity_type: 'pricing_component_rule',
      entity_id: createdRule.id,
      action: 'pricing_component_rule_created',
      new_values: createdRule,
      metadata: {
        component_type: createdRule.component_type,
        applies_to: createdRule.applies_to,
      },
    })

  revalidatePath('/admin/pricing')
  revalidatePath('/admin/contracts')
  revalidatePath('/admin/billing')
}
