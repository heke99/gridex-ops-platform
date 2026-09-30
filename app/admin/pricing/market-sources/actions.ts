'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireOperationalCompanyId } from '@/lib/tenant/scope'

export type MarketSourceActionState = { ok: boolean; message: string }
class PolicyInputError extends Error {}

function text(formData: FormData, key: string): string { return String(formData.get(key) ?? '').trim() }
function integer(formData: FormData, key: string, fallback: number): number {
  const raw = text(formData, key)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < (key === 'priority' ? 0 : 1) || parsed > 2147483647) {
    throw new PolicyInputError(key === 'priority' ? 'Ange en giltig prioritet från noll och uppåt.' : 'Ange en giltig dataålder i hela minuter.')
  }
  return parsed
}
function selected(formData: FormData, key: string): string[] {
  const values = [...new Set(formData.getAll(key).map(String).map(value => value.trim()).filter(Boolean))]
  const allowed = key === 'price_areas' ? ['SE1', 'SE2', 'SE3', 'SE4'] : ['monthly', 'hourly', 'quarterly']
  if (values.some(value => !allowed.includes(value))) throw new PolicyInputError('Välj giltiga elområden och upplösningar.')
  return values
}
function policyChoice(formData: FormData, key: string): string {
  const allowed = key === 'forecast_policy' ? ['latest_available_indication', 'require_forecast', 'disabled']
    : ['require_locked_period_price', 'indicative_until_locked', 'disabled']
  const value = text(formData, key) || allowed[0]
  if (!allowed.includes(value)) throw new PolicyInputError('Välj en giltig forecast- och portföljpolicy.')
  return value
}
function failure(error: unknown): MarketSourceActionState {
  if (error instanceof PolicyInputError) return { ok: false, message: error.message }
  const reference = randomUUID().slice(0, 8)
  // Database/provider messages do not belong in persisted policy diagnostics.
  console.error('[market-source-policy]', { reference })
  return { ok: false, message: 'Åtgärden kunde inte bekräftas. Ditt utkast är kvar. Referens: ' + reference + '.' }
}
function refresh(result: MarketSourceActionState): MarketSourceActionState {
  try { revalidatePath('/admin/pricing/market-sources'); return result }
  catch {
    console.warn('[market-source-policy] cache_refresh_failed')
    return { ...result, message: result.message + ' Läs om sidan för att se aktuella uppgifter.' }
  }
}
async function actionContext() {
  const guard = await requireAdminActionAccess({ anyOf: ['pricing.write', 'pricing.publish'] })
  const supabase = await createSupabaseServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user || user.id !== guard.userId) throw new Error('current_actor_unavailable')
  const companyId = await requireOperationalCompanyId(user.id)
  if (!guard.isPlatformAdmin && companyId !== guard.companyId) throw new Error('current_tenant_changed')
  return { supabase, user, companyId }
}
async function sourceContext(formData: FormData) {
  const context = await actionContext()
  const sourceKey = text(formData, 'source_key')
  if (!sourceKey) throw new PolicyInputError('Välj en marknadsdatakälla.')
  const source = await context.supabase.from('spot_price_sources').select('source_key').eq('source_key', sourceKey).maybeSingle()
  if (source.error) throw source.error
  if (source.data?.source_key !== sourceKey) throw new PolicyInputError('Marknadsdatakällan hittades inte. Läs om sidan.')
  return { ...context, sourceKey }
}
function assertReceipt(data: unknown, companyId: string, sourceKey: string) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
    (data as Record<string, unknown>).company_id !== companyId ||
    (data as Record<string, unknown>).source_key !== sourceKey) {
    throw new PolicyInputError('Ingen ändring kunde bekräftas för den valda källan. Läs om sidan innan du försöker igen.')
  }
}

export async function saveMarketSourcePolicyAction(formData: FormData): Promise<MarketSourceActionState> {
  try {
    const { supabase, user, companyId, sourceKey } = await sourceContext(formData)
    const existing = await supabase.from('company_market_price_sources').select('company_id,source_key,metadata')
      .eq('company_id', companyId).eq('source_key', sourceKey).maybeSingle()
    if (existing.error) throw existing.error
    if (existing.data) assertReceipt(existing.data, companyId, sourceKey)
    const metadata = existing.data?.metadata && typeof existing.data.metadata === 'object' && !Array.isArray(existing.data.metadata)
      ? existing.data.metadata : {}
    const payload = {
      company_id: companyId, source_key: sourceKey, enabled: formData.get('enabled') === 'on',
      priority: Math.max(integer(formData, 'priority', 100), 0),
      max_age_minutes: Math.max(integer(formData, 'max_age_minutes', 180), 1),
      allow_indicative_latest: formData.get('allow_indicative_latest') === 'on',
      supported_resolutions: selected(formData, 'supported_resolutions'), price_areas: selected(formData, 'price_areas'),
      forecast_policy: policyChoice(formData, 'forecast_policy'),
      portfolio_policy: policyChoice(formData, 'portfolio_policy'),
      metadata: { ...metadata, updated_from: 'tenant_market_sources_admin', updated_by: user.id }, updated_at: new Date().toISOString(),
    }
    const result = await supabase.from('company_market_price_sources').upsert(payload, { onConflict: 'company_id,source_key' })
      .select('company_id,source_key').single()
    if (result.error) throw result.error
    assertReceipt(result.data, companyId, sourceKey)
    return refresh({ ok: true, message: 'Marknadsdatapolicyn är sparad.' })
  } catch (error) { return failure(error) }
}

export async function testMarketSourceConnectionAction(formData: FormData): Promise<MarketSourceActionState> {
  try {
    const { supabase, user, companyId, sourceKey } = await sourceContext(formData)
    const policy = await supabase.from('company_market_price_sources').select('company_id,source_key,metadata')
      .eq('company_id', companyId).eq('source_key', sourceKey).maybeSingle()
    if (policy.error) throw policy.error
    assertReceipt(policy.data, companyId, sourceKey)
    const latest = await supabase.from('spot_price_intervals').select('time_start,price_area,resolution')
      .eq('source', sourceKey).order('time_start', { ascending: false }).limit(1).maybeSingle()
    const success = !latest.error && Boolean(latest.data?.time_start)
    const testedAt = new Date().toISOString()
    const diagnostic = latest.error ? 'Lagrad marknadsdata kunde inte kontrolleras.' : 'Ingen lagrad marknadsdata hittades för källan.'
    const metadata = policy.data?.metadata && typeof policy.data.metadata === 'object' && !Array.isArray(policy.data.metadata)
      ? policy.data.metadata : {}
    const result = await supabase.from('company_market_price_sources').update({
      last_tested_at: testedAt, ...(success ? { last_success_at: testedAt } : {}), last_error: success ? null : diagnostic,
      metadata: { ...metadata, stored_data_checked_by: user.id, latest_observation: latest.error ? null : latest.data ?? null },
      updated_at: testedAt,
    }).eq('company_id', companyId).eq('source_key', sourceKey).select('company_id,source_key').single()
    if (result.error) throw result.error
    assertReceipt(result.data, companyId, sourceKey)
    return refresh(success ? { ok: true, message: 'Lagrad marknadsdata hittades för källan.' } : { ok: false, message: diagnostic })
  } catch (error) { return failure(error) }
}
export async function saveMarketSourcePolicyFormAction(_previous: MarketSourceActionState, formData: FormData) {
  return saveMarketSourcePolicyAction(formData)
}
export async function checkStoredMarketDataFormAction(_previous: MarketSourceActionState, formData: FormData) {
  return testMarketSourceConnectionAction(formData)
}
