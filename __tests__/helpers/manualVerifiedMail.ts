import type { ManualSenderVerification } from '@/lib/inbound-mail/manualSenderVerification'

// Synthetic output of the server DKIM verification port. These fixtures test
// downstream business handling; real signed RFC verification is covered by
// manual-sender-verification.test.ts.
export function manualVerifiedMail(fromEmail: string): ManualSenderVerification {
  const author = fromEmail.toLowerCase()
  return {
    version: 1,
    status: 'verified',
    method: 'dkim',
    raw_sha256: 'a'.repeat(64),
    from_email: author,
    signing_domain: author.slice(author.lastIndexOf('@') + 1),
    signed_headers: ['from', 'subject', 'in-reply-to', 'references', 'content-type', 'content-transfer-encoding', 'mime-version'],
    verified_at: '2026-10-18T18:00:00.000Z',
  }
}
