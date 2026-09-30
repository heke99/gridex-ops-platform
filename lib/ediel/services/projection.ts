import { supabaseService } from '@/lib/supabase/service'
import type { EdielProjectionPage, EdielProjectionRequest } from './types'

/** One source series, several scoped reads. No copying owner rows, raw bytes or upstream ACK. */
export async function projectEdielSeriesToBeneficiary(input: EdielProjectionRequest): Promise<EdielProjectionPage> {
  if (!Number.isInteger(input.expectedGrantVersion) || input.expectedGrantVersion < 1) throw new Error('ediel_grant_version_required')
  const { data, error } = await supabaseService.rpc('ediel_beneficiary_series_page_v1', {
    p_beneficiary_company_id: input.beneficiaryCompanyId, p_actor_user_id: input.actorUserId,
    p_grant_id: input.grantId, p_expected_grant_version: input.expectedGrantVersion,
    p_purpose: input.purpose, p_series_id: input.seriesId, p_fields: [...input.fields],
    p_start: input.startInclusive, p_end: input.endExclusive, p_limit: input.limit ?? 100,
    p_after_at: input.after?.readingAt ?? null, p_after_id: input.after?.valueId ?? null,
  })
  if (error) throw error
  if (!data || !Array.isArray(data.rows)) throw new Error('ediel_beneficiary_projection_invalid')
  return data as EdielProjectionPage
}
