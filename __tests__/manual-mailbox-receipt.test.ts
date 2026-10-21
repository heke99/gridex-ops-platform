import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { captureManualMailboxReceipt, qualifyManualMailboxReceipt, readStoredManualMailboxReceipt, MANUAL_MAILBOX_RECEIPT } from '@/lib/inbound-mail/manualMailboxReceipt'

const bytes = Buffer.from('Date: Thu, 1 Jan 1970 00:00:00 +0000\r\n\r\nSynthetic original')
const rawSha256 = createHash('sha256').update(bytes).digest('hex')
const sourceFingerprint = 'a'.repeat(64)
const captureInput = { internalDate: new Date('2026-10-24T22:30:00.000Z'), source: bytes,
  mailbox: 'Manual@Example.invalid', mailboxId: 'mailbox-a', mailboxFingerprint: 'b'.repeat(64), uid: 51, uidValidity: '17' }
function qualified() {
  return qualifyManualMailboxReceipt({ observation: captureManualMailboxReceipt(captureInput), mailbox: 'manual@example.invalid', sourceFingerprint, verifiedRawSha256: rawSha256 })!
}
function persisted() {
  return { mailbox_receipt: qualified(), source_fingerprint: sourceFingerprint, source_fingerprint_version: 2,
    sender_verification: { status: 'verified', raw_sha256: rawSha256 } }
}

it('captures the IMAP date and exact raw hash independently of a contradictory sender Date header', () => {
  expect(captureManualMailboxReceipt(captureInput)).toEqual({ version: 1, source: 'imap_internal_date',
    receivedAt: '2026-10-24T22:30:00.000Z', rawSha256, mailbox: 'manual@example.invalid', mailboxId: 'mailbox-a',
    mailboxFingerprint: 'b'.repeat(64), uid: 51, uidValidity: '17' })
})
it('retains the qualified source binding across normal database timestamp formatting', () => {
  const receipt = readStoredManualMailboxReceipt({ payload: persisted(), receivedAt: '2026-10-24T22:30:00+00:00', sourceFingerprint })
  expect(receipt).toEqual(qualified())
})
it('loses the private observation on JSON serialization while retaining ordinary email fields', () => {
  const original = { subject: 'Synthetic reply', [MANUAL_MAILBOX_RECEIPT]: captureManualMailboxReceipt(captureInput) }
  expect(JSON.parse(JSON.stringify(original))).toEqual({ subject: 'Synthetic reply' })
})
it.each([
  { internalDate: undefined }, { internalDate: new Date('invalid') }, { internalDate: '2026-10-24T22:30:00.000Z' },
  { source: Buffer.alloc(0) }, { source: 'sender-controlled text' }, { uid: 0 }, { uid: 0x1_0000_0000 },
  { uidValidity: '0' }, { uidValidity: '4294967296' }, { mailboxFingerprint: '' }, { mailboxId: '' },
])('refuses absent or invalid original IMAP metadata %j', patch => {
  expect(captureManualMailboxReceipt({ ...captureInput, ...patch })).toBeNull()
})
it.each([
  { mailbox: 'other@example.invalid' }, { verifiedRawSha256: 'c'.repeat(64) }, { sourceFingerprint: 'invalid' },
])('does not qualify mismatched source bindings %j', patch => {
  expect(qualifyManualMailboxReceipt({ observation: captureManualMailboxReceipt(captureInput), mailbox: 'manual@example.invalid',
    sourceFingerprint, verifiedRawSha256: rawSha256, ...patch })).toBeNull()
})
it.each([
  { version: 2 }, { source: 'date_header' }, { receivedAt: '2026-02-30T22:30:00.000Z' },
  { receivedAt: '1969-12-31T23:30:00.000Z' }, { sourceFingerprint: 'c'.repeat(64) }, { rawSha256: 'c'.repeat(64) },
])('rejects corrupted persisted receipt fields %j', patch => {
  const payload = persisted(); payload.mailbox_receipt = { ...payload.mailbox_receipt, ...patch } as typeof payload.mailbox_receipt
  expect(readStoredManualMailboxReceipt({ payload, receivedAt: '2026-10-24T22:30:00Z', sourceFingerprint })).toBeNull()
})
it('cannot use a persisted receipt with another source or another received_at value', () => {
  expect(readStoredManualMailboxReceipt({ payload: persisted(), receivedAt: '2026-10-25T22:30:00Z', sourceFingerprint })).toBeNull()
  expect(readStoredManualMailboxReceipt({ payload: persisted(), receivedAt: '2026-10-24T22:30:00Z', sourceFingerprint: 'c'.repeat(64) })).toBeNull()
})
it('does not derive missing historical provenance from a current observation', () => {
  expect(readStoredManualMailboxReceipt({ payload: { source_fingerprint: sourceFingerprint, source_fingerprint_version: 2 },
    receivedAt: '2026-10-24T22:30:00Z', sourceFingerprint })).toBeNull()
  expect(readStoredManualMailboxReceipt({ payload: { ...persisted(), source_fingerprint_version: 1 },
    receivedAt: '2026-10-24T22:30:00Z', sourceFingerprint })).toBeNull()
})
