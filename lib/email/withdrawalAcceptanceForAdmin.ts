import 'server-only'

import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { UUID_PATTERN } from '@/lib/ediel/matching/postgrestFilter'
import { supabaseService } from '@/lib/supabase/service'

type AcceptanceReview = { companyId: string; outboxId: string; acceptanceToken: string; reviewedAttemptId: string }

export async function reconcileWithdrawalAcceptanceForAdmin(review: AcceptanceReview) {
  const { userId } = await requirePlatformAdminActionAccess()
  if (![userId, review.companyId, review.outboxId, review.acceptanceToken, review.reviewedAttemptId].every(id => UUID_PATTERN.test(id))) {
    throw new Error('Det granskade leverantörskvittot saknas. Uppdatera sidan och granska posten igen.')
  }
  const { data, error } = await supabaseService.rpc('gridex_reconcile_withdrawal_email_acceptance_v1', {
    p_company_id: review.companyId,
    p_outbox_id: review.outboxId,
    p_acceptance_token: review.acceptanceToken,
    p_reviewed_attempt_id: review.reviewedAttemptId,
    p_actor_user_id: userId,
  })
  if (error) throw new Error('Leverantörskvittot kunde inte stämmas av. Försök igen från systemhälsan.')
  return data
}
