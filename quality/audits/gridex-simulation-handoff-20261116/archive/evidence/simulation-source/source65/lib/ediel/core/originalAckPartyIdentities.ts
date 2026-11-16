import { contrlSourceEnvelope, type ContrlSourceEnvelope } from '@/lib/ediel/contrlEngine'
import { assertEdifactLatin1Representable } from '@/lib/ediel/core/edifactEncoding'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { escapeEdifactValue } from '@/lib/ediel/core/edifactSerializer'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'

export type OriginalAckLegalParty = Readonly<{
  id: string
  identityComponents: readonly string[]
  country: string | null
}>
export type OriginalAckPartyIdentities = Readonly<{
  family: 'PRODAT' | 'UTILTS'
  transport: ContrlSourceEnvelope
  legalSender: OriginalAckLegalParty
  legalReceiver: OriginalAckLegalParty
  applicationReference: string | null
}>

/** Physical observations only. UNB identifies the technical endpoints, while
 * the original own message header NAD identifies the legal parties. This does
 * not assert entitlement or approve a source that failed its national guide. */
export function originalAckPartyIdentities(input: {
  rawPayload: string | null | undefined
  expectedFamily?: string | null
}): OriginalAckPartyIdentities {
  const held = (): never => { throw new EdielExecutionFailure({ kind: 'internal_failure', code: 'EDIEL_ACK_ORIGINAL_LEGAL_PARTIES_UNQUALIFIED' }, 'Kvittensen kräver entydiga juridiska parter i ursprungsmeddelandets eget fysiska NAD-huvud.') }
  let wire: ReturnType<typeof tokenizeEdifact>
  try { wire = tokenizeEdifact(input.rawPayload) } catch { return held() }
  const messages = wire.segments.filter(segment => segment.tag === 'UNH')
  if (messages.length !== 1) return held()
  const family = segmentComposite(messages[0], 2, wire.una)[0]
  if (family !== 'PRODAT' && family !== 'UTILTS') return held()
  const expected = input.expectedFamily === 'UTILTS_ERR' ? 'UTILTS' : input.expectedFamily
  if (expected && family !== expected) return held()
  const end = wire.segments.findIndex(segment => segment.index > messages[0].index && ['LIN', 'IDE', 'UNT', 'UNZ', 'UNH'].includes(segment.tag))
  const header = wire.segments.slice(messages[0].index + 1, end < 0 ? undefined : end)
  const party = (role: string): OriginalAckLegalParty => {
    const rows = header.filter(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, wire.una).length === 1 && segmentComposite(segment, 1, wire.una)[0] === role)
    if (rows.length !== 1) return held()
    const identity = segmentComposite(rows[0], 2, wire.una)
    const countryParts = segmentComposite(rows[0], 9, wire.una)
    if (!identity[0] || identity.length !== 3 || identity.some(value => Array.from(value).length > 35)
      || countryParts.length !== 1 || (family === 'PRODAT' && !/^[A-Z]{2}$/.test(countryParts[0] ?? ''))) return held()
    try { assertEdifactLatin1Representable(identity.join('') + countryParts[0]) } catch { return held() }
    return Object.freeze({ id: identity[0], identityComponents: Object.freeze(identity), country: countryParts[0] || null })
  }
  const unb = wire.segments.find(segment => segment.tag === 'UNB')
  const application = segmentComposite(unb, 7, wire.una)
  if (application.length !== 1) return held()
  return Object.freeze({ family, transport: contrlSourceEnvelope(input.rawPayload),
    legalSender: party(family === 'PRODAT' ? 'FR' : 'MS'), legalReceiver: party(family === 'PRODAT' ? 'DO' : 'MR'),
    applicationReference: application[0] || null })
}

/** Copy only source-qualified party identity/country into a reverse ACK NAD.
 * Names, installation beneficiaries and other object NAD never supply this. */
export function originalAckLegalNadSegment(role: 'FR' | 'DO' | 'MS' | 'MR', party: OriginalAckLegalParty): string {
  const identity = party.identityComponents.map(value => escapeEdifactValue(value)).join(':')
  return `NAD+${role}+${identity}${party.country ? `+++++++${escapeEdifactValue(party.country)}` : ''}`
}
