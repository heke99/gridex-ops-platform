import 'server-only'

import { requirePlatformAdminAccess } from '@/lib/admin/guards'
import { UUID_PATTERN } from '@/lib/ediel/matching/postgrestFilter'
import { supabaseService } from '@/lib/supabase/service'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && value === value.toLowerCase() && UUID_PATTERN.test(value)
}

export async function readReconciliationAttempt({ id, attemptId }: {
  id: string
  attemptId: string
}) {
  const operator = await requirePlatformAdminAccess()
  if (!isCanonicalUuid(id) || !isCanonicalUuid(attemptId)) return null

  const { companyId } = await getOperationalCompanyScope(operator.userId)
  if (companyId !== null && !isCanonicalUuid(companyId)) return null

  const { data, error } = await supabaseService.rpc('gridex_read_ediel_outbox_reconciliation_attempt_v1', {
    p_outbox_id: id,
    p_claim_id: attemptId,
    p_company_id: companyId,
  })
  if (error) throw error
  if (!data || data.outboxId !== id || data.claimId !== attemptId) return null

  const { journalStatus, journalId, enteredAt, observedAt } = data
  if (
    typeof journalStatus !== 'string'
    || (journalId != null && typeof journalId !== 'string')
    || (enteredAt != null && typeof enteredAt !== 'string')
    || (observedAt != null && typeof observedAt !== 'string')
  ) {
    throw new Error('ediel_outbox_reconciliation_attempt_invalid')
  }
  return {
    attemptId,
    journalStatus,
    journalId: journalId ?? null,
    enteredAt: enteredAt ?? null,
    observedAt: observedAt ?? null,
  }
}
