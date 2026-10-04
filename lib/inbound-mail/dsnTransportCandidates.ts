import { findEdielDsnAttemptCandidates } from '@/lib/ediel/transport/outboundAttempt'
import type { DeliveryStatusReport } from './dsnDisposition'

export type DsnCandidateProjection = {
  status: 'not_attempted' | 'not_found' | 'candidate_found' | 'ambiguous' | 'lookup_failed'
  transportCorrelation: 'unverified'
  attempts: Record<string, unknown>[]
}

/** Mailbox attribution is server state. Returned business headers never select a tenant. */
export async function projectDsnTransportCandidates(row: Record<string, unknown>, report: DeliveryStatusReport | null): Promise<DsnCandidateProjection> {
  const result: DsnCandidateProjection = { status: 'not_attempted', transportCorrelation: 'unverified', attempts: [] }
  const mailbox = row.ediel_mailboxes && typeof row.ediel_mailboxes === 'object' && !Array.isArray(row.ediel_mailboxes)
    ? row.ediel_mailboxes as Record<string, unknown> : null
  const companyId = row.company_id
  const mailboxId = row.ediel_mailbox_id ?? row.mailbox_id
  const environment = mailbox?.environment
  if (typeof companyId !== 'string' || typeof mailboxId !== 'string' || mailbox?.id !== mailboxId ||
      (environment !== 'test' && environment !== 'production') ||
      (row.environment != null && row.environment !== environment) ||
      (row.mailbox_environment != null && row.mailbox_environment !== environment) ||
      (mailbox.company_id != null && mailbox.company_id !== companyId) ||
      !report || report.issues.length || report.originalMessageIds.length !== 1 || report.recipients.length !== 1) return result
  const recipient = report.recipients[0].finalRecipient
  if (!recipient || !['rfc822', 'utf-8'].includes(recipient.type) || !/^[^\s<>@]+@[^\s<>@]+$/.test(recipient.address)) return result
  try {
    // The RPC checks active mailbox ownership or the qualified shared platform
    // mailbox, exact environment, entered attempt, archived RFC ID and recipient.
    const attempts = await findEdielDsnAttemptCandidates({ companyId, environment, mailboxId,
      rfcMessageId: report.originalMessageIds[0], finalRecipient: recipient.address })
    return { ...result, attempts, status: attempts.length === 0 ? 'not_found' : attempts.length === 1 ? 'candidate_found' : 'ambiguous' }
  } catch {
    // Preserve transport quarantine even if its read-only journal lookup fails.
    return { ...result, status: 'lookup_failed' }
  }
}
