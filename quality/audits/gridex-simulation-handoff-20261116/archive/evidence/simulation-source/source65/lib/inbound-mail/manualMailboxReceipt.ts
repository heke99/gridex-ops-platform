import { createHash } from 'node:crypto'

// JSON webhook bodies and message headers cannot supply symbol-keyed data.
// Only the IMAP adapter assigns this observation from the installed client.
export const MANUAL_MAILBOX_RECEIPT = Symbol.for('gridex.manual-mail.imap-receipt.v1')

export type ManualMailboxReceipt = {
  version: 1
  source: 'imap_internal_date'
  receivedAt: string
  mailbox: string
  mailboxId: string
  mailboxFingerprint: string
  uidValidity: string
  uid: number
  rawSha256: string
}
type StoredReceipt = ManualMailboxReceipt & { sourceFingerprint: string }
const hash = /^[a-f0-9]{64}$/
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const address = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : ''

function validReceipt(value: unknown): value is ManualMailboxReceipt {
  const receipt = record(value)
  if (receipt.version !== 1 || receipt.source !== 'imap_internal_date'
    || typeof receipt.receivedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.receivedAt)
    || !Number.isFinite(Date.parse(receipt.receivedAt)) || new Date(receipt.receivedAt).toISOString() !== receipt.receivedAt
    || Number(receipt.receivedAt.slice(0, 4)) < 1970
    || !address(receipt.mailbox) || receipt.mailbox !== address(receipt.mailbox)
    || typeof receipt.mailboxId !== 'string' || !receipt.mailboxId.trim()
    || typeof receipt.mailboxFingerprint !== 'string' || !hash.test(receipt.mailboxFingerprint)
    || typeof receipt.rawSha256 !== 'string' || !hash.test(receipt.rawSha256)
    || !Number.isInteger(receipt.uid) || Number(receipt.uid) < 1 || Number(receipt.uid) > 0xffff_ffff
    || typeof receipt.uidValidity !== 'string' || !/^[1-9]\d{0,9}$/.test(receipt.uidValidity)
    || Number(receipt.uidValidity) > 0xffff_ffff) return false
  return true
}

/** Called with FETCH metadata and original RFC bytes, never the RFC Date header. */
export function captureManualMailboxReceipt(input: {
  internalDate: unknown; source: unknown; mailbox: string; mailboxId: string
  mailboxFingerprint: string; uidValidity: string; uid: number
}): ManualMailboxReceipt | null {
  if (!(input.internalDate instanceof Date) || !Number.isFinite(input.internalDate.getTime())
    || !(input.source instanceof Uint8Array) || !input.source.byteLength) return null
  const receipt: ManualMailboxReceipt = {
    version: 1, source: 'imap_internal_date', receivedAt: input.internalDate.toISOString(),
    mailbox: address(input.mailbox), mailboxId: input.mailboxId, mailboxFingerprint: input.mailboxFingerprint,
    uidValidity: input.uidValidity, uid: input.uid,
    rawSha256: createHash('sha256').update(input.source).digest('hex'),
  }
  return validReceipt(receipt) ? receipt : null
}

/** Qualify once, on first insert; a later poll may never backfill a legacy basis. */
export function qualifyManualMailboxReceipt(input: {
  observation: unknown; mailbox: string; sourceFingerprint: string; verifiedRawSha256?: string
}): StoredReceipt | null {
  const receipt = input.observation
  if (!validReceipt(receipt) || receipt.mailbox !== address(input.mailbox) || !hash.test(input.sourceFingerprint)
    || (input.verifiedRawSha256 !== undefined && receipt.rawSha256 !== input.verifiedRawSha256)) return null
  return { ...receipt, sourceFingerprint: input.sourceFingerprint }
}

/** Read only the existing SQL-protected server namespace. No root-key fallback. */
export function readStoredManualMailboxReceipt(input: {
  payload: unknown; receivedAt: string; sourceFingerprint: string
}): StoredReceipt | null {
  const payload = record(input.payload), receipt = record(payload.manual_automation).mailboxReceipt
  if (!validReceipt(receipt) || record(receipt).sourceFingerprint !== input.sourceFingerprint
    || payload.source_fingerprint_version !== 2 || payload.source_fingerprint !== input.sourceFingerprint
    || Date.parse(input.receivedAt) !== Date.parse(receipt.receivedAt)) return null
  const sender = record(payload.sender_verification)
  if (sender.status === 'verified' && sender.raw_sha256 !== receipt.rawSha256) return null
  return receipt as StoredReceipt
}
