import 'server-only'
import { z } from 'zod'
import { unstable_rethrow } from 'next/navigation'
import { currentSupportSession } from '@/lib/customer-operations/supportSession'
import { supabaseService } from '@/lib/supabase/service'

export type AccountCompletionSource = {
  customer: { id: string; companyId: string; customerType: string | null; firstName: string | null; lastName: string | null;
    fullName: string | null; companyName: string | null; email: string | null; personalNumber: string | null;
    customerNumber: string | null; profileRevision: string; contactRevision: string }
  contacts: Array<{ id: string; companyId: string; customerId: string; name: string | null; email: string | null }>
  site: { id: string; companyId: string; customerId: string; facilityId: string | null; siteRevision: string; addressRevision: string }
  point: { id: string; companyId: string | null; customerId: string | null; siteId: string | null;
    customerSiteId: string | null; meterPointId: string | null; meteringPointId: string | null; updatedAt: string } | null
}
export type AccountCompletionInput = {
  companyId: string; customerId: string; expectedUserId: string; authEmail: string
  input: { email: string; personalNumber: string; firstName: string; lastName: string; fullName: string; installationId: string; companySlug: string }
  source: AccountCompletionSource
}

export class AccountCompletionError extends Error {
  constructor(readonly code: string, readonly status: 400 | 403 | 409 | 503) {
    super(code)
    this.name = 'AccountCompletionError'
  }
}
const receipt = z.object({
  status: z.enum(['created', 'replayed', 'existing']), companyId: z.string().uuid(), customerId: z.string().uuid(),
  userId: z.string().uuid(), accountId: z.string().uuid(), role: z.enum(['owner', 'billing', 'viewer']),
  receiptId: z.string().uuid().nullable(), claimId: z.string().uuid().nullable(), eventId: z.string().uuid().nullable(),
}).strict()

/** Matching facts come from current server reads. Identity/session comes only
 * from verified Auth, and the command rechecks current locked sources and the
 * session clock before returning its durable receipt. */
export async function completeNativePortalAccount(input: AccountCompletionInput) {
  let actor: Awaited<ReturnType<typeof currentSupportSession>>
  try { actor = await currentSupportSession('portal', input.expectedUserId) }
  catch (error) { unstable_rethrow(error); throw new AccountCompletionError('portal_claim_session_unavailable', 403) }
  const { data, error } = await supabaseService.rpc('gridex_complete_customer_portal_account_v1', { p_command: {
    companyId: input.companyId, customerId: input.customerId, userId: actor.userId, sessionId: actor.sessionId,
    authEmail: input.authEmail, input: input.input, source: input.source,
  } })
  if (error) {
    if (error.code === '42501') throw new AccountCompletionError('portal_claim_current_identity_required', 403)
    if (['PT409', '23505', '23514'].includes(error.code)) throw new AccountCompletionError('portal_claim_binding_conflict', 409)
    if (['22023', '22P02'].includes(error.code)) throw new AccountCompletionError('portal_claim_invalid', 400)
    throw new AccountCompletionError('portal_claim_completion_unavailable', 503)
  }
  const parsed = receipt.safeParse(data)
  if (!parsed.success || parsed.data.companyId !== input.companyId || parsed.data.customerId !== input.customerId ||
    parsed.data.userId !== actor.userId || (parsed.data.status === 'created' && parsed.data.role !== 'owner') ||
    (parsed.data.status === 'existing' ? parsed.data.receiptId !== null || parsed.data.claimId !== null || parsed.data.eventId !== null :
      parsed.data.receiptId === null || parsed.data.claimId === null || parsed.data.eventId === null)) {
    throw new AccountCompletionError('portal_claim_completion_unavailable', 503)
  }
  return parsed.data
}
