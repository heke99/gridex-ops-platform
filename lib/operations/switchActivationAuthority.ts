import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { mapWithConcurrency } from '@/lib/performance/mapWithConcurrency'
import { InvalidReadModelResponseError } from '@/lib/read-models/readResult'
import { isUuid } from '@/lib/validation/uuid'

/** The caller must first check the admin action permission and scope the candidates. */
export async function readSwitchActivationCompanyIds(
  supabase: SupabaseClient,
  actorUserId: string,
  candidateCompanyIds: readonly (string | null | undefined)[],
): Promise<Set<string>> {
  const companyIds = [...new Set(candidateCompanyIds.filter((id): id is string => id != null))]
  if (companyIds.length === 0) return new Set()
  if (!isUuid(actorUserId) || companyIds.length > 1000 || companyIds.some(id => !isUuid(id))) {
    throw new InvalidReadModelResponseError()
  }

  const allowed = await mapWithConcurrency(companyIds, 4, async companyId => {
    const { data: writable, error } = await supabase.rpc('gridex_can_write_company', { p_company_id: companyId })
    if (error) throw error
    if (typeof writable !== 'boolean') throw new InvalidReadModelResponseError()
    if (!writable) return false

    try {
      await assertEdielTenantActor({ companyId, actorUserId, permission: 'metering.write' })
      return true
    } catch (failure) {
      if (failure instanceof EdielExecutionFailure && failure.disposition.kind === 'security_quarantine'
        && ['EDIEL_TENANT_ACTOR_FORBIDDEN', 'EDIEL_TENANT_PERMISSION_FORBIDDEN'].includes(failure.disposition.code)) {
        return false
      }
      throw failure
    }
  })
  return new Set(companyIds.filter((_, index) => allowed[index]))
}
