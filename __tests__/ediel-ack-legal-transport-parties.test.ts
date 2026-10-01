import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { originalAckPartyIdentities, originalAckLegalNadSegment } from '@/lib/ediel/core/originalAckPartyIdentities'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { renderAperakEdiel } from '@/lib/ediel/aperakEngine'
import { buildAckDraftForSource } from '@/lib/ediel/ack'
import type { EdielMessageRow } from '@/lib/ediel/types'

function sourceRaw(alternate = false) {
  return EdifactEnvelopeCodec.encode({ sender: '90001', receiver: '90002', senderQualifier: 'ZZ', receiverQualifier: 'ZZ',
    senderSubAddress: 'ORIGINAL:S', receiverSubAddress: 'ORIGINAL:R', interchangeReference: 'SOURCEI', environment: 'test',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true,
    ...(alternate ? { una: { componentDataElementSeparator: '*', dataElementSeparator: ';', releaseCharacter: '!', segmentTerminator: '~' } } : {}),
    messages: [{ messageReference: 'SOURCEM', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: [
      'BGM+Z03+SOURCEDOC+9+AB', 'DTM+137:202609301200:203', 'DTM+ZZZ:1:805',
      'NAD+FR+54321:160:SVK+++++++SE', 'NAD+DO+12345:160:SVK+++++++NO',
      'LIN+1++735123456789012345:::9', 'RFF+LI:ORIGINAL-LI', 'CCI++Z13', 'CAV+Z22',
    ] }] })
}
function source(raw = sourceRaw()): EdielMessageRow {
  return { id: '00000000-0000-4000-8000-000000000001', company_id: '00000000-0000-4000-8000-000000000002',
    environment: 'test', test_flag: 1, direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z03', raw_payload: raw,
    sender_ediel_id: 'WRONG-ROW-S', receiver_ediel_id: 'WRONG-ROW-R', sender_sub_address: 'WRONG-S', receiver_sub_address: 'WRONG-R',
    application_reference: '23-DDQ-PRODAT', parsed_payload: {}, message_received_at: '2026-09-30T12:00:00Z', created_at: '2026-09-30T12:00:00Z',
  } as unknown as EdielMessageRow
}
describe('physical legal parties and technical transport stay separate across actual ACK adapters', () => {
  it.each([false, true])('reads exact own header with alternate service alphabet=%s', alternate => {
    const parties = originalAckPartyIdentities({ rawPayload: sourceRaw(alternate), expectedFamily: 'PRODAT' })
    expect(parties.transport.senderComponents).toEqual(['90001', 'ZZ', 'ORIGINAL:S'])
    expect(parties.transport.receiverComponents).toEqual(['90002', 'ZZ', 'ORIGINAL:R'])
    expect(parties.legalSender).toEqual({ id: '54321', identityComponents: ['54321', '160', 'SVK'], country: 'SE' })
    expect(parties.legalReceiver).toEqual({ id: '12345', identityComponents: ['12345', '160', 'SVK'], country: 'NO' })
    expect(originalAckLegalNadSegment('FR', parties.legalReceiver)).toBe('NAD+FR+12345:160:SVK+++++++NO')
  })
  it.each([false, true])('routes APERAK on physical UNB while reversing exact legal NAD=%s', alternate => {
    const draft = buildAckDraftForSource({ sourceMessage: source(sourceRaw(alternate)), ackFamily: 'APERAK', outcome: 'positive' })
    const envelope = EdifactEnvelopeCodec.decode(draft.rawPayload)
    expect([envelope.sender, envelope.receiver, envelope.senderSubAddress, envelope.receiverSubAddress]).toEqual(['90002', '90001', 'ORIGINAL:R', 'ORIGINAL:S'])
    const fr = envelope.segments.find(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, envelope.una)[0] === 'FR')!
    const receiver = envelope.segments.find(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, envelope.una)[0] === 'DO')!
    expect(segmentComposite(fr, 2, envelope.una)).toEqual(['12345', '160', 'SVK']); expect(segmentComposite(fr, 9, envelope.una)).toEqual(['NO'])
    expect(segmentComposite(receiver, 2, envelope.una)).toEqual(['54321', '160', 'SVK']); expect(segmentComposite(receiver, 9, envelope.una)).toEqual(['SE'])
  })
  it('holds a missing or ambiguous own legal header instead of borrowing technical or object actors', () => {
    const original = sourceRaw()
    for (const raw of [original.replace('NAD+DO+12345:160:SVK+++++++NO', 'NAD+UD+12345:160:SVK+++++++NO'), original.replace('NAD+DO+12345:160:SVK+++++++NO', "NAD+DO+12345:160:SVK+++++++NO'NAD+DO+99999:160:SVK+++++++SE")]) {
      expect(() => originalAckPartyIdentities({ rawPayload: raw })).toThrow(/juridiska parter/)
      expect(() => buildAckDraftForSource({ sourceMessage: source(raw), ackFamily: 'APERAK', outcome: 'positive' })).toThrow(/juridiska parter/)
    }
  })
  it('rejects conflicting explicit legal projections on the direct renderer', () => {
    expect(() => renderAperakEdiel({ source: { id: 'source', rawPayload: sourceRaw(), messageFamily: 'PRODAT', legalSenderEdielId: '90001' }, refs: {}, externalReference: 'ACKDOC', transactionReference: 'ACKT', outcome: 'positive' })).toThrow('aperak_original_legal_party_projection_conflict')
  })
  it('preserves released literal party data rather than sanitizing source identifiers', () => {
    const raw = sourceRaw().replace('NAD+FR+54321:160', "NAD+FR+543?+2?:1:160")
    const parties = originalAckPartyIdentities({ rawPayload: raw })
    const output = tokenizeEdifact(originalAckLegalNadSegment('DO', parties.legalSender) + "'")
    expect(segmentComposite(output.segments[0], 2, output.una)).toEqual(['543+2:1', '160', 'SVK'])
  })
})
