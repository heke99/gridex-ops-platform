import 'server-only'
import { getEffectiveSender } from '@/lib/email/companyEmailSettings'
import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'
import { prepareTenantTemplateEmail } from '@/lib/tenant/emailTemplates'

type ConfirmationIntent = {
  case_id: string
  company_id: string
  customer_id: string
  customer_email: string | null
  customer_name: string | null
  case_title: string | null
  next_action: string | null
  actor_user_id: string | null
}

export async function preparePendingWithdrawalConfirmations(input: { companyId: string | null; limit: number }) {
  const { data, error } = await supabaseService.rpc('gridex_list_due_withdrawal_confirmations_v1', {
    p_company_id: input.companyId,
    p_limit: input.limit,
  })
  if (error) throw error
  const result = { queued: 0, skipped: 0, deferred: 0 }
  for (const intent of (data ?? []) as ConfirmationIntent[]) {
    try {
      await requireCompanyOperationalForWrites(intent.company_id)
      const prepared = await prepareTenantTemplateEmail('withdrawal_received', {
        companyId: intent.company_id,
        customerId: intent.customer_id,
        customerCaseId: intent.case_id,
        customerName: intent.customer_name,
        customerEmail: intent.customer_email,
        caseTitle: intent.case_title,
        caseTypeLabel: 'Ånger',
        nextAction: intent.next_action,
        actorUserId: intent.actor_user_id,
      })
      let payload = null
      if (prepared) {
        const { draft, branding } = prepared
        const sender = await getEffectiveSender(intent.company_id, { requireSendReady: true })
        payload = {
          toEmail: draft.toEmail,
          from: sender.from,
          senderEmail: sender.senderEmail,
          replyTo: sender.replyTo ?? branding.supportEmail,
          senderMode: sender.mode,
          subject: draft.subject,
          html: draft.htmlBody,
          text: draft.textBody,
          redirectUrl: draft.redirectUrl,
          branding: { ...branding, sender_mode: sender.mode, sender_email: sender.senderEmail,
            redirect_url: draft.redirectUrl, created_by: draft.actorUserId },
        }
      }
      const committed = await supabaseService.rpc('gridex_publish_withdrawal_confirmation_v1', {
        p_company_id: intent.company_id, p_case_id: intent.case_id, p_payload: payload,
      })
      if (committed.error) throw committed.error
      if (committed.data?.state === 'queued') result.queued += Number(committed.data.existing === false)
      else if (committed.data?.state === 'skipped_missing_recipient' || committed.data?.state === 'suppressed_retention') {
        result.skipped += Number(committed.data.existing === false)
      }
      else throw new Error('Ogiltigt kökvitto för ångerbekräftelsen.')
    } catch {
      const deferred = await supabaseService.rpc('gridex_defer_withdrawal_confirmation_v1', {
        p_company_id: intent.company_id, p_case_id: intent.case_id,
      })
      if (deferred.error) throw deferred.error
      result.deferred += 1
    }
  }
  return result
}
