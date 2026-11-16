import { supabaseService } from '@/lib/supabase/service'

type ProfileScope = 'company' | 'global'
const UNIFORM_MONTH_WEIGHT = 100 / 12

export type MonthlyWeightBasis =
  | { kind: 'configured' | 'default'; profileId: string; scope: ProfileScope; weightPercent: number }
  | { kind: 'missing'; reason: 'profile_missing' | 'month_weight_missing'; profileId: string | null; scope: ProfileScope | null; weightPercent: number }
  | { kind: 'ambiguous'; scope: ProfileScope }
  | { kind: 'unavailable'; reason: 'profile_read_failed' | 'month_weight_read_failed' | 'invalid_profile' | 'invalid_weight' | 'transport_failed'; error: unknown }

function profileError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

type DefaultSelection =
  | { kind: 'selected'; profileId: string }
  | { kind: 'none' }
  | Extract<MonthlyWeightBasis, { kind: 'ambiguous' | 'unavailable' }>

async function readGenericDefault(companyId: string, scope: ProfileScope): Promise<DefaultSelection> {
  // The caller supplies no customer/heating/metering category. Only a generic
  // default is applicable; explicitly configured profiles are handled separately.
  let query = supabaseService
    .from('consumption_profiles')
    .select('id,company_id')
    .eq('is_default', true)
    .is('customer_type', null)
    .is('heating_type', null)
    .is('metering_method', null)
    .limit(2)
  query = scope === 'company' ? query.eq('company_id', companyId) : query.is('company_id', null)
  const { data, error } = await query
  if (error) return { kind: 'unavailable', reason: 'profile_read_failed', error }
  if (!Array.isArray(data) || data.some(row => !row || typeof row.id !== 'string' || !row.id.trim()
    || row.company_id !== (scope === 'company' ? companyId : null))) {
    return { kind: 'unavailable', reason: 'invalid_profile', error: profileError('CONSUMPTION_PROFILE_INVALID_RESPONSE') }
  }
  if (data.length > 1) return { kind: 'ambiguous', scope }
  return data.length === 0 ? { kind: 'none' } : { kind: 'selected', profileId: data[0].id }
}

/** Internal server basis; its underlying error is not a public wire DTO. */
export async function getMonthlyWeightBasis(
  companyId: string,
  profileId: string | null | undefined,
  monthNumber: number,
): Promise<MonthlyWeightBasis> {
  try {
    let resolvedProfileId = profileId || null
    let scope: ProfileScope = 'company'
    const configured = Boolean(resolvedProfileId)
    if (resolvedProfileId) {
      const { data, error } = await supabaseService
        .from('consumption_profiles')
        .select('id,company_id')
        .eq('id', resolvedProfileId)
        .maybeSingle()
      if (error) return { kind: 'unavailable', reason: 'profile_read_failed', error }
      if (!data || typeof data.id !== 'string' || data.id !== resolvedProfileId) {
        return { kind: 'unavailable', reason: 'invalid_profile', error: profileError('CONSUMPTION_PROFILE_NOT_FOUND') }
      }
      if (data.company_id !== companyId && data.company_id !== null) {
        return { kind: 'unavailable', reason: 'invalid_profile', error: profileError('CONSUMPTION_PROFILE_SCOPE_MISMATCH') }
      }
      scope = data.company_id === null ? 'global' : 'company'
    } else {
      for (const tier of ['company', 'global'] as const) {
        const selected = await readGenericDefault(companyId, tier)
        if (selected.kind === 'unavailable' || selected.kind === 'ambiguous') return selected
        if (selected.kind === 'selected') {
          resolvedProfileId = selected.profileId
          scope = tier
          break
        }
      }
    }

    if (!resolvedProfileId) {
      return { kind: 'missing', reason: 'profile_missing', profileId: null, scope: null, weightPercent: UNIFORM_MONTH_WEIGHT }
    }

    const { data, error } = await supabaseService
      .from('consumption_profile_month_weights')
      .select('weight_percent')
      .eq('profile_id', resolvedProfileId)
      .eq('month_number', monthNumber)
      .maybeSingle()
    if (error) return { kind: 'unavailable', reason: 'month_weight_read_failed', error }
    if (data === null) {
      return { kind: 'missing', reason: 'month_weight_missing', profileId: resolvedProfileId, scope, weightPercent: UNIFORM_MONTH_WEIGHT }
    }

    const rawWeight = data?.weight_percent
    const weightPercent = typeof rawWeight === 'number' ? rawWeight
      : typeof rawWeight === 'string' && rawWeight.trim() ? Number(rawWeight) : NaN
    if (!Number.isFinite(weightPercent)) {
      return { kind: 'unavailable', reason: 'invalid_weight', error: profileError('CONSUMPTION_PROFILE_WEIGHT_INVALID') }
    }
    return { kind: configured ? 'configured' : 'default', profileId: resolvedProfileId, scope, weightPercent }
  } catch (error) {
    return { kind: 'unavailable', reason: 'transport_failed', error }
  }
}

export async function getMonthlyWeightPercent(companyId: string, profileId: string | null | undefined, monthNumber: number): Promise<number> {
  const basis = await getMonthlyWeightBasis(companyId, profileId, monthNumber)
  if (basis.kind === 'unavailable') throw basis.error
  if (basis.kind === 'ambiguous') throw profileError('CONSUMPTION_PROFILE_DEFAULT_AMBIGUOUS')
  return basis.weightPercent
}
