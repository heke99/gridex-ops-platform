import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeliveryStatusReport } from '@/lib/inbound-mail/dsnDisposition'
const lookup = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ediel/transport/outboundAttempt', () => ({ findEdielDsnAttemptCandidates: lookup }))
import { projectDsnTransportCandidates } from '@/lib/inbound-mail/dsnTransportCandidates'
const row = { company_id: 'company-1', ediel_mailbox_id: 'mailbox-1', environment: 'test', ediel_mailboxes: { id: 'mailbox-1', company_id: 'company-1', environment: 'test' } }
const report: DeliveryStatusReport = { version: 1, transportCorrelation: 'unverified', reportingMta: { type: 'dns', address: 'relay.test' }, originalEnvelopeId: null,
  originalMessageIds: ['<original@sender.test>'], recipients: [{ finalRecipient: { type: 'rfc822', address: 'recipient@receiver.test' }, originalRecipient: null, action: 'failed', status: '5.1.1', diagnosticCode: null, remoteMta: null, lastAttemptDate: null, willRetryUntil: null }], issues: [] }
describe('DSN journal candidate projection', () => {
  beforeEach(() => { vi.clearAllMocks(); lookup.mockResolvedValue([{ attemptId: 'attempt-1', correlationStatus: 'unverified' }]) })
  it('queries only attributed mailbox scope and exact returned RFC ID and recipient', async () => {
    expect(await projectDsnTransportCandidates(row, report)).toMatchObject({ status: 'candidate_found', transportCorrelation: 'unverified' })
    expect(lookup).toHaveBeenCalledWith({ companyId: 'company-1', environment: 'test', mailboxId: 'mailbox-1', rfcMessageId: '<original@sender.test>', finalRecipient: 'recipient@receiver.test' })
  })
  it.each([
    { ...row, company_id: null }, { ...row, company_id: 'another-company' }, { ...row, environment: 'production' },
    { ...row, ediel_mailbox_id: 'another-mailbox' }, { ...row, ediel_mailboxes: null },
  ])('does not derive tenant or environment from returned business data (%#)', async (untrusted) => {
    expect((await projectDsnTransportCandidates(untrusted, report)).status).toBe('not_attempted')
    expect(lookup).not.toHaveBeenCalled()
  })
  it.each([
    { ...report, issues: ['original_message_id_ambiguous'] }, { ...report, originalMessageIds: [] },
    { ...report, recipients: [...report.recipients, ...report.recipients] },
  ])('keeps malformed or ambiguous reports out of journal correlation (%#)', async (invalid) => {
    expect((await projectDsnTransportCandidates(row, invalid)).status).toBe('not_attempted')
    expect(lookup).not.toHaveBeenCalled()
  })
  it('does not turn matching candidates or a lookup failure into an acceptance', async () => {
    lookup.mockResolvedValueOnce([{ attemptId: 'a' }, { attemptId: 'b' }]).mockRejectedValueOnce(new Error('journal unavailable'))
    expect(await projectDsnTransportCandidates(row, report)).toMatchObject({ status: 'ambiguous', transportCorrelation: 'unverified' })
    expect(await projectDsnTransportCandidates(row, report)).toEqual({ status: 'lookup_failed', transportCorrelation: 'unverified', attempts: [] })
  })
})
