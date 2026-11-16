'use server'

import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function integer(formData: FormData, key: string, fallback: number): number {
  const parsed = Number.parseInt(text(formData, key), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function selected(formData: FormData, key: string): string[] {
  return formData.getAll(key).map(String).map((value) => value.trim()).filter(Boolean)
}

async function actionContext() {
  await requireAdminActionAccess({ anyOf: ['pricing.write', 'pricing.publish'] })
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Du måste vara inloggad.')
  return { supabase, user, companyId: await requireOperationalCompanyId(user.id) }
}

export async function saveMarketSourcePolicyAction(formData: FormData) {
  const { supabase, user, companyId } = await actionContext()
  const sourceKey = text(formData, 'source_key')
  if (!sourceKey) throw new Error('Marknadsdatakälla saknas.')

  const payload = {
    company_id: companyId,
    source_key: sourceKey,
    enabled: formData.get('enabled') === 'on',
    priority: Math.max(integer(formData, 'priority', 100), 0),
    max_age_minutes: Math.max(integer(formData, 'max_age_minutes', 180), 1),
    allow_indicative_latest: formData.get('allow_indicative_latest') === 'on',
    supported_resolutions: selected(formData, 'supported_resolutions'),
    price_areas: selected(formData, 'price_areas'),
    forecast_policy: text(formData, 'forecast_policy') || 'latest_available_indication',
    portfolio_policy: text(formData, 'portfolio_policy') || 'require_locked_period_price',
    metadata: { updated_from: 'tenant_market_sources_admin', updated_by: user.id },
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('company_market_price_sources')
    .upsert(payload, { onConflict: 'company_id,source_key' })
  if (error) throw error

  revalidatePath('/admin/pricing/market-sources')
}

export async function testMarketSourceConnectionAction(formData: FormData) {
  const { supabase, user, companyId } = await actionContext()
  const sourceKey = text(formData, 'source_key')
  if (!sourceKey) throw new Error('Marknadsdatakälla saknas.')

  const testedAt = new Date().toISOString()
  const latest = await supabase
    .from('spot_price_intervals')
    .select('time_start,price_area,resolution')
    .eq('source', sourceKey)
    .order('time_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  const success = !latest.error && Boolean(latest.data?.time_start)
  const { error } = await supabase
    .from('company_market_price_sources')
    .update({
      last_tested_at: testedAt,
      ...(success ? { last_success_at: testedAt } : {}),
      last_error: success ? null : latest.error?.message ?? 'Ingen marknadsdata hittades för källan.',
      metadata: {
        connection_tested_by: user.id,
        latest_observation: latest.data ?? null,
      },
      updated_at: testedAt,
    })
    .eq('company_id', companyId)
    .eq('source_key', sourceKey)
  if (error) throw error

  revalidatePath('/admin/pricing/market-sources')
}
