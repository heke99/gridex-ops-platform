import 'server-only'

import { supabaseService } from '@/lib/supabase/service'
import { getEffectiveSender } from './companyEmailSettings'
import { getCompanyEmailTemplate } from './emailTemplates'
import { isEventRuleEnabled, isLegalOrCritical } from './sendCompanyEmail'

const outcomes = ['queued', 'duplicate', 'requires_reconciliation', 'failed', 'already_pending'] as const

type ResendOutcome = typeof outcomes[number]
type Scope = { companyId: string; customerId: string; logId: string; actorId: string }

type ReadyReceipt = {
  status: 'ready'
  sourceId: string
  templateKey: string
  eventKey: string | null
}

function isReadyReceipt(receipt: unknown): receipt is ReadyReceipt {
  if (!receipt || typeof receipt !== 'object' || !('status' in receipt) || receipt.status !== 'ready') return false
  return 'sourceId' in receipt && typeof receipt.sourceId === 'string'
    && 'templateKey' in receipt && typeof receipt.templateKey === 'string'
    && 'eventKey' in receipt && (receipt.eventKey === null || typeof receipt.eventKey === 'string')
}

function resendOutcome(receipt: unknown): ResendOutcome {
  if (!receipt || typeof receipt !== 'object' || !('status' in receipt)) return 'failed'
  return outcomes.find(outcome => outcome === receipt.status) ?? 'failed'
}

export async function resendCustomerEmail(scope: Scope): Promise<ResendOutcome> {
  const args = {
    p_company: scope.companyId,
    p_customer: scope.customerId,
    p_requested: scope.logId,
    p_actor: scope.actorId,
  }
  const { data: prepared, error: preparationError } = await supabaseService.rpc('gridex_resend_customer_email_v1', args)
  if (preparationError) throw preparationError
  if (!isReadyReceipt(prepared)) return resendOutcome(prepared)

  const { eventKey, templateKey } = prepared
  if (!await isEventRuleEnabled(scope.companyId, eventKey, templateKey)) return 'failed'
  if (!await getCompanyEmailTemplate(scope.companyId, templateKey)) return 'failed'
  const sender = await getEffectiveSender(scope.companyId, {
    legalOrCritical: isLegalOrCritical({ eventKey, templateKey }),
    requireSendReady: true,
  })
  const { data, error } = await supabaseService.rpc('gridex_resend_customer_email_v1', {
    ...args,
    p_expected_source: prepared.sourceId,
    p_sender: {
      from: sender.from,
      sender_email: sender.senderEmail,
      reply_to: sender.replyTo ?? null,
      mode: sender.mode,
      from_name: sender.fromName ?? null,
      domain_verified_at: sender.domainVerifiedAt ?? null,
    },
  })
  if (error) {
    // The transaction might already have committed before the response failed.
    // Re-read the same intent and let the durable database state decide.
    const { data: recovered, error: recoveryError } = await supabaseService.rpc('gridex_resend_customer_email_v1', args)
    if (recoveryError) throw recoveryError
    return resendOutcome(recovered)
  }
  return resendOutcome(data)
}
