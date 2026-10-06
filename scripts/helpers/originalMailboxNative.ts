import { createHash, randomUUID } from 'node:crypto'
import { recordInboundReception, type InboundReception } from '@/lib/ediel/inbound/receptions'
import { parseEdifactPayload, type ParsedEdifactEnvelope } from '@/lib/inbound-mail/edielEmailParser'
import { createParseResult } from '@/lib/inbound-mail/inboundStatusUpdater'

type Sql = <T = unknown>(statement: string) => T
type Literal = (value: unknown) => string

export type OriginalMailboxNativeInput = {
  companyId: string
  environment: 'test' | 'production'
  raw: string
  receivedAt?: string
  smtpFrom: string
  senderEmail?: string
  parsed?: ParsedEdifactEnvelope
}
export type OriginalMailboxNative = {
  mailboxId: string
  inboundEmailMessageId: string
  parseResultId: string
  parsed: ParsedEdifactEnvelope
  sourcePayloadHash: string
}

/** Prospective public transport input only: INSERT owners freeze its mailbox
 * and raw birth; the production parser port retains the actual physical facts.
 * Call before inserting the canonical source, then link both mail columns. */
export async function seedOriginalMailboxNative(sql: Sql, literal: Literal, input: OriginalMailboxNativeInput): Promise<OriginalMailboxNative> {
  const parsed = parseEdifactPayload(input.raw)
  if (parsed.rawPayload !== input.raw || (input.parsed && JSON.stringify(input.parsed) !== JSON.stringify(parsed))) {
    throw new Error('native_original_mailbox_actual_parse_required')
  }
  const mailboxId = randomUUID(), inboundEmailMessageId = randomUUID()
  const senderEmail = input.senderEmail ?? 'recipient@example.invalid'
  const receivedAt = input.receivedAt ?? new Date().toISOString()
  const rawEmail = `From: ${senderEmail}\r\nTo: ${input.smtpFrom}\r\nMessage-ID: <${inboundEmailMessageId}@example.invalid>\r\nContent-Type: application/edifact\r\n\r\n${input.raw}`
  sql(`INSERT INTO public.ediel_mailboxes(id,company_id,mailbox_name,email_address,environment,is_active,is_shared_platform_mailbox)
    VALUES(${literal(mailboxId)},${literal(input.companyId)},'Synthetic original native mailbox',${literal(input.smtpFrom)},${literal(input.environment)},true,false);
    INSERT INTO public.inbound_email_messages(id,company_id,environment,mailbox_id,internet_message_id,received_at,from_address,to_address,raw_email,raw_edifact_payload,body_text,processing_status,match_status)
    VALUES(${literal(inboundEmailMessageId)},${literal(input.companyId)},${literal(input.environment)},${literal(mailboxId)},${literal(`${inboundEmailMessageId}@example.invalid`)},${literal(receivedAt)}::timestamptz,${literal(senderEmail)},${literal(input.smtpFrom)},${literal(rawEmail)},${literal(input.raw)},${literal(input.raw)},'received','not_checked');`)
  const parseResultId = await createParseResult({ inboundEmailMessageId, companyId: input.companyId, parsed })
  return { mailboxId, inboundEmailMessageId, parseResultId, parsed, sourcePayloadHash: createHash('sha256').update(input.raw, 'utf8').digest('hex') }
}

/** Actual WRITE-authorized production RPC; no private receipts or extra grants.
 * A first reception observes transport custody without business authorization. */
export async function recordOriginalMailboxNativeReception(input: {
  companyId: string
  sourceMessageId: string
  actorUserId: string
  inboundEmailMessageId: string
  parseResultId: string
  sourcePayloadHash?: string
}): Promise<InboundReception> {
  const reception = await recordInboundReception({ ...input, messageId: input.sourceMessageId })
  if (reception.classification !== 'first_reception' || reception.businessEffectAuthorized !== false ||
      reception.parseResultId !== input.parseResultId || (input.sourcePayloadHash &&
      (reception.canonicalPayloadHash !== input.sourcePayloadHash || reception.receivedPayloadHash !== input.sourcePayloadHash))) {
    throw new Error('native_original_mailbox_first_reception_required')
  }
  return reception
}
