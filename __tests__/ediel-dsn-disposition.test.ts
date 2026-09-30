import { describe, expect, it } from 'vitest'
import { parseDeliveryStatusReport } from '@/lib/inbound-mail/dsnDisposition'

function report(status = 'Final-Recipient: rfc822; receiver@example.test\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 unknown recipient') {
  return `Content-Type: multipart/report; report-type=delivery-status; boundary="dsn"\r\n\r\n--dsn\r\nContent-Type: text/plain\r\n\r\nFailure\r\n--dsn\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; smtp.example.test\r\nOriginal-Envelope-Id: queue-123\r\n\r\n${status}\r\n\r\n--dsn\r\nContent-Type: message/rfc822\r\n\r\nMessage-ID: <original@example.test>\r\nContent-Type: application/EDIFACT\r\n\r\nUNB+returned-business-data'\r\n--dsn--\r\n`
}

describe('DSN structured disposition remains unverified transport evidence', () => {
  it('preserves separate envelope, RFC identity and recipient failure fields', () => {
    expect(parseDeliveryStatusReport(report())).toMatchObject({ version: 1, transportCorrelation: 'unverified',
      originalEnvelopeId: 'queue-123', originalMessageIds: ['<original@example.test>'],
      recipients: [{ finalRecipient: { type: 'rfc822', address: 'receiver@example.test' }, action: 'failed', status: '5.1.1',
        diagnosticCode: { type: 'smtp', text: '550 unknown recipient' } }], issues: [] })
    expect(JSON.stringify(parseDeliveryStatusReport(report()))).not.toContain('returned-business-data')
  })
  it('keeps each recipient in its own field block and unfolds diagnostics', () => {
    const recipient = 'Final-Recipient: rfc822; receiver@example.test\r\nAction: delayed\r\nStatus: 4.2.0\r\nDiagnostic-Code: smtp; 450\r\n mailbox busy\r\n\r\nFinal-Recipient: utf-8; å@example.test\r\nAction: failed\r\nStatus: 5.1.1'
    const parsed = parseDeliveryStatusReport(report(recipient))!
    expect(parsed.recipients).toHaveLength(2)
    expect(parsed.recipients[0].diagnosticCode?.text).toBe('450 mailbox busy')
    expect(parsed.recipients[1].finalRecipient?.address).toBe('å@example.test')
    expect(parsed.transportCorrelation).toBe('unverified')
  })
  it('decodes global delivery status without extracting its returned original', () => {
    const body = 'Reporting-MTA: dns; smtp.example.test\r\n\r\nFinal-Recipient: utf-8; å@example.test\r\nAction: failed\r\nStatus: 5.1.1'
    const parsed = parseDeliveryStatusReport(`Content-Type: message/global-delivery-status\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString('base64')}`)!
    expect(parsed.recipients[0].finalRecipient?.address).toBe('å@example.test')
    expect(parsed.originalMessageIds).toEqual([])
  })
  it.each([
    'Final-Recipient: rfc822; receiver@example.test\r\nFinal-Recipient: rfc822; other@example.test\r\nAction: failed\r\nStatus: 5.1.1',
    'Final-Recipient: rfc822; receiver@example.test\r\nAction: delivered\r\nStatus: 5.1.1',
    'Final-Recipient: rfc822; receiver@example.test\r\nAction: failed\r\nStatus: nonsense',
  ])('retains malformed reports for review without granting authoritative disposition', (body) => {
    const parsed = parseDeliveryStatusReport(report(body))!
    expect(parsed.issues.length).toBeGreaterThan(0)
    expect(parsed.transportCorrelation).toBe('unverified')
  })
  it('rejects ambiguous original IDs and never substitutes returned UNB for RFC identity', () => {
    const parsed = parseDeliveryStatusReport(report().replace('Message-ID: <original@example.test>', 'Message-ID: <original@example.test>\r\nMessage-ID: <other@example.test>'))!
    expect(parsed.originalMessageIds).toEqual([])
    expect(parsed.issues).toContain('original_message_id_ambiguous')
  })
  it('does not interpret ordinary MIME-looking prose as a report', () => {
    expect(parseDeliveryStatusReport('Content-Type: text/plain\r\n\r\nContent-Type: message/delivery-status\r\nAction: failed')).toBeNull()
  })
})
