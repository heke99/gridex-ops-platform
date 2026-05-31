import { supabaseService } from '@/lib/supabase/service'
import { asNumber } from '@/lib/analytics/utils'

export async function getMonthlyWeightPercent(companyId: string, profileId: string | null | undefined, monthNumber: number): Promise<number> {
  let resolvedProfileId = profileId ?? null
  if (!resolvedProfileId) {
    const { data } = await supabaseService
      .from('consumption_profiles')
      .select('id')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .eq('is_default', true)
      .order('company_id', { ascending: false })
      .limit(1)
    resolvedProfileId = data?.[0]?.id ?? null
  }

  if (!resolvedProfileId) return 100 / 12

  const { data, error } = await supabaseService
    .from('consumption_profile_month_weights')
    .select('weight_percent')
    .eq('profile_id', resolvedProfileId)
    .eq('month_number', monthNumber)
    .maybeSingle()

  if (error) {
    if (/does not exist|schema cache|Could not find/i.test(error.message)) return 100 / 12
    throw error
  }

  return asNumber(data?.weight_percent) || 100 / 12
}
