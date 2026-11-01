/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/helpers/reality/rejectsWire.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
// What a grid owner writes back when it rejects or answers out of order: realistic Ediel answers to OUR
// outbound PRODAT (Z03 switch request, Z01 customer/facility request), built only from the received file the
// way a DSO's own system does. Pure functions, no database, no network; the rejecting grid-owner simulator
// (scripts/reality/simulators/gridOwnerRejects.ts) and the native defect tests share them.
//
// PRODAT APERAK (P26.A §3.3–3.5, masterplan ACK-02/ACK-10): D96A/E2SE6A, BGM+++27 when the WHOLE message is
// rejected (header), BGM+++34 when it was processed and each object gets its own ERC/FTX with RFF+Z07/LI.
// ERC 40 carries the national application code in FTX (P p93): 105 the object cannot be identified, 106 a
// similar message received from another actor, 107 the actor is not connected to the facility. ERC 42 points
// at the actual PRODAT field: 210 contract start date, 227 customer id.
//
// Synthetic only: every party, facility and identity comes from the received file.
import { randomUUID } from 'node:crypto'
import { buildAperakDraft, buildContrlDraft } from '@/lib/ediel/ack'
import { renderContrl2Ediel2 } from '@/lib/ediel/contrlEngine'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { originalAckLegalNadSegment, originalAckPartyIdentities } from '@/lib/ediel/core/originalAckPartyIdentities'
import { PRODAT_APERAK_APPLICATION_TEXTS, prodatAperakFieldWireLabel } from '@/lib/ediel/prodat/prodatAperakText'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { edielMinute } from '../live-chain-wire'

/** Why the grid owner rejects one object of our request. */
export type RejectionReason = 'unknown_gsrn' | 'other_supplier_pending' | 'start_date_not_allowed' | 'wrong_customer_identity' | 'actor_not_connected'

/** The ERC/FTX a DSO sends for each business reason (ERC 40 = national application code, ERC 42 = field). */
export const REJECTION_CODES: Readonly<Record<RejectionReason, { erc: '40' | '42'; code: string; text: (facts: ReceivedRequestFacts) => string }>> = Object.freeze({
  unknown_gsrn: { erc: '40', code: '105', text: () => PRODAT_APERAK_APPLICATION_TEXTS['105'] },
  other_supplier_pending: { erc: '40', code: '106', text: () => PRODAT_APERAK_APPLICATION_TEXTS['106'] },
  actor_not_connected: { erc: '40', code: '107', text: () => PRODAT_APERAK_APPLICATION_TEXTS['107'] },
  start_date_not_allowed: { erc: '42', code: '210', text: f => `Felaktigt ${prodatAperakFieldWireLabel('210')} ${f.startDate || 'saknas'}` },
  wrong_customer_identity: { erc: '42', code: '227', text: f => `Felaktigt ${prodatAperakFieldWireLabel('227')} ${f.customerIdentity || 'saknas'}` },
})

export type ReceivedRequestFacts = {
  family: string; code: string; interchange: string; document: string; supplier: string; gridOwner: string
  facility: string; lineItemReference: string; startDate: string; customerIdentity: string
}

/** The facts a DSO reads from a received PRODAT request (Z03 or Z01). Missing optional facts are ''. */
export function readReceivedRequest(raw: string): ReceivedRequestFacts {
  const t = tokenizeEdifact(raw)
  const first = (tag: string, qualifier?: string) => t.segments.find(s => s.tag === tag && (qualifier === undefined || segmentComposite(s, 1, t.una)[0] === qualifier))
  const comp = (tag: string, qualifier: string | undefined, element: number, component = 0) => {
    const s = first(tag, qualifier)
    return s ? segmentComposite(s, element, t.una)[component] ?? '' : ''
  }
  const unb = first('UNB'), unh = first('UNH')
  return {
    family: unh ? segmentComposite(unh, 2, t.una)[0] ?? '' : '', code: comp('BGM', undefined, 1), interchange: unb ? segmentComposite(unb, 5, t.una)[0] ?? '' : '',
    document: comp('BGM', undefined, 2), supplier: unb ? segmentComposite(unb, 2, t.una)[0] ?? '' : '', gridOwner: unb ? segmentComposite(unb, 3, t.una)[0] ?? '' : '',
    facility: comp('LIN', undefined, 3), lineItemReference: comp('RFF', 'LI', 1, 1), startDate: comp('DTM', '92', 1, 1).slice(0, 8),
    customerIdentity: comp('NAD', 'UD', 2),
  }
}

/** The platform's file as the grid owner received it (its own perspective: inbound). */
export function asReceived(raw: string, family = 'PRODAT'): EdielMessageRow {
  return { id: randomUUID(), raw_payload: raw, company_id: null, environment: EdifactEnvelopeCodec.decode(raw).environment, message_standard: 'edifact', message_family: family, direction: 'inbound' } as unknown as EdielMessageRow
}

/** CONTRL for one received interchange: 'positive' (UCI action 7/1) or 'negative' (UCI action 4, syntax rejection). */
export function contrlFor(raw: string, outcome: 'positive' | 'negative') {
  return buildContrlDraft({ sourceMessage: asReceived(raw), outcome }).rawPayload!
}

/** Positive PRODAT APERAK (BGM 34, ERC 100 per object). */
export function positiveAperakFor(raw: string) {
  return buildAperakDraft({ sourceMessage: asReceived(raw), outcome: 'positive' }).rawPayload!
}

/**
 * Business rejection of the request's object: BGM+++34 with ERC/FTX and RFF+Z07 (facility) + RFF+LI (our case
 * reference), built by the platform's own PRODAT APERAK renderer from the grid owner's received view.
 */
export function objectRejectionAperakFor(raw: string, reason: RejectionReason) {
  const facts = readReceivedRequest(raw), rule = REJECTION_CODES[reason]
  if (!facts.lineItemReference) throw Error('rejects_request_line_item_reference_missing')
  return buildAperakDraft({ sourceMessage: asReceived(raw), outcome: 'negative', applicationErrors: [{ ercCode: rule.erc, fieldCode: rule.code, text: rule.text(facts),
    referenceQualifier: facts.facility ? 'Z07' : null, referenceNumber: facts.facility || null, lineItemReference: facts.lineItemReference }] }).rawPayload!
}

/**
 * Whole-message rejection (BGM+++27): the DSO could not read the message header (ERC 40 / 102). Written by
 * hand as the counterparty's own wire: our renderer correctly refuses a header rejection of a healthy file.
 */
export function headerRejectionAperakFor(raw: string, now = new Date()) {
  const parties = originalAckPartyIdentities({ rawPayload: raw, expectedFamily: 'PRODAT' })
  const facts = readReceivedRequest(raw)
  // ENV-08: the APERAK document time is Ediel fixed normal time +0100 (formerly Stockholm local time, J4-H1; T15).
  const date = edielMinute(now.getTime())
  return replyEnvelope(raw, 'APERAK:D:96A:UN:E2SE6A', ['BGM+++27', `DTM+137:${date}:203`, `RFF+ACW:${facts.document}`,
    originalAckLegalNadSegment('FR', parties.legalReceiver), originalAckLegalNadSegment('DO', parties.legalSender),
    'ERC+40::260', `FTX+AAO++102::260+${PRODAT_APERAK_APPLICATION_TEXTS['102']}`])
}

/** Negative CONTRL rendered by the national CONTRL engine (UCI action 4). */
export function syntaxRejectionContrlFor(raw: string) {
  return replyEnvelope(raw, 'CONTRL:2:2:UN:EDIEL2', renderContrl2Ediel2({ source: { rawPayload: raw }, outcome: 'negative' }).segments)
}

/** A reply interchange from the grid owner to the supplier, envelope mirrored from the received request. */
export function replyEnvelope(raw: string, messageTypeToken: string, businessSegments: string[]) {
  const envelope = EdifactEnvelopeCodec.decode(raw)
  return EdifactEnvelopeCodec.encode({ sender: envelope.receiver!, receiver: envelope.sender!, senderQualifier: envelope.receiverQualifier, receiverQualifier: envelope.senderQualifier,
    senderSubAddress: envelope.receiverSubAddress, receiverSubAddress: envelope.senderSubAddress, applicationReference: envelope.applicationReference,
    acknowledgementRequest: false, environment: envelope.environment, interchangeReference: randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase(),
    messages: [{ messageReference: randomUUID().replaceAll('-', '').slice(0, 14), messageTypeToken, businessSegments }] })
}

/** What the DSO answers to one request. Unlisted facilities get the default behaviour. */
export type GridOwnerAnswerPlan = {
  contrl: 'positive' | 'negative' | 'none'
  /** none = silent; positive; reject = BGM34 object rejection with a reason; header = BGM27 whole-message rejection. */
  aperak: { kind: 'none' } | { kind: 'positive' } | { kind: 'reject'; reason: RejectionReason } | { kind: 'header' }
  /** Z03 only: send a Z04 confirmation, before or after the APERAK (P-11: a valid Z04 may precede the APERAK). */
  z04: 'none' | 'before_aperak' | 'after_aperak'
  /** Re-deliver the APERAK file once more (same bytes, second mail). */
  duplicateAperak: boolean
}
export const SILENT: GridOwnerAnswerPlan = { contrl: 'none', aperak: { kind: 'none' }, z04: 'none', duplicateAperak: false }

/** The files the DSO sends for one received request, in order. Z04 is built by the caller (needs gridOwnerWire). */
export function answersFor(raw: string, plan: GridOwnerAnswerPlan): Array<{ kind: string; edifact: string | null }> {
  const facts = readReceivedRequest(raw)
  const out: Array<{ kind: string; edifact: string | null }> = []
  if (plan.contrl !== 'none') out.push({ kind: plan.contrl === 'negative' ? 'CONTRL-negative' : 'CONTRL', edifact: plan.contrl === 'negative' ? syntaxRejectionContrlFor(raw) : contrlFor(raw, 'positive') })
  // A syntax-rejected interchange is never processed further (T §2.1).
  if (plan.contrl === 'negative') return out
  const isZ03 = facts.family === 'PRODAT' && facts.code === 'Z03'
  if (isZ03 && plan.z04 === 'before_aperak') out.push({ kind: 'PRODAT-Z04', edifact: null })
  const aperak = plan.aperak.kind === 'positive' ? positiveAperakFor(raw)
    : plan.aperak.kind === 'reject' ? objectRejectionAperakFor(raw, plan.aperak.reason)
      : plan.aperak.kind === 'header' ? headerRejectionAperakFor(raw) : null
  const label = plan.aperak.kind === 'reject' ? `APERAK-reject-${plan.aperak.reason}` : plan.aperak.kind === 'header' ? 'APERAK-header-27' : 'APERAK'
  if (aperak) out.push({ kind: label, edifact: aperak })
  if (aperak && plan.duplicateAperak) out.push({ kind: `${label} (duplicate)`, edifact: aperak })
  if (isZ03 && plan.z04 === 'after_aperak') out.push({ kind: 'PRODAT-Z04', edifact: null })
  return out
}
