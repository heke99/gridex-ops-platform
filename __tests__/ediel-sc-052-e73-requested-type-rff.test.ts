// masterplan: SC-052
// Field 503 (SG6/RFF/C506/1153): the physical E73 request names the requested
// UTILTS message type explicitly, consistent with its application reference.
// A generic E73 reference is never accepted and an E66-DGI route never becomes
// an S02 request.
import { expect, it } from 'vitest'
import { buildUtiltsOutboundDraft } from '@/lib/ediel/utilts'

const base = {
  code: 'E73' as const,
  environment: 'test' as const,
  senderEdielId: '11111',
  receiverEdielId: '22222',
  externalReference: 'SC052-DOC',
  transactionReference: 'SC052-TX',
}
const payload = {
  legalSenderEdielId: '33333',
  legalReceiverEdielId: '44444',
  meterPointId: '735999100001686670',
  gridAreaId: 'TES',
  periodStart: '2026-09-30T00:00:00+01:00',
  periodEnd: '2026-10-01T00:00:00+01:00',
  registrationTime: '2026-10-01T10:00:00+01:00',
}
const segments = (raw: string) => raw.split(/'\s*/).map(s => s.trim()).filter(Boolean)

it.each(['23-DGI-E66-S', '23-DGI-E66-T'])('an E73 for missing E66 on %s renders the explicit requested type RFF+E66 once', async ref => {
  const draft = await buildUtiltsOutboundDraft({ ...base, applicationReference: ref, payload: { ...payload, requestedMessageCode: 'E66' } })
  const segs = segments(draft.rawPayload!)
  expect(draft.applicationReference).toBe(ref)
  expect(segs.filter(s => /^RFF\+(E66|S02)(:|$)/.test(s))).toEqual(['RFF+E66'])
  // SG6 follows the SG5 FTX segments of its own transaction.
  expect(segs.indexOf('RFF+E66')).toBeGreaterThan(segs.findIndex(s => s.startsWith('FTX+AAO')))
  expect(segs.indexOf('RFF+E66')).toBeGreaterThan(segs.indexOf('RFF+TN:SC052-TX'))
})

it('derives the requested type only from an unambiguous request application reference', async () => {
  const draft = await buildUtiltsOutboundDraft({ ...base, applicationReference: '23-DGI-E66-S', payload })
  expect(segments(draft.rawPayload!)).toContain('RFF+E66')
})

it('never assumes S02 from an E66-DGI route', async () => {
  await expect(buildUtiltsOutboundDraft({ ...base, applicationReference: '23-DGI-E66-S', payload: { ...payload, requestedMessageCode: 'S02' } }))
    .rejects.toThrow(/utilts_request_requested_type_reference_mismatch:E73:S02:23-DGI-E66-S/)
})

it('never accepts a generic E73 application reference', async () => {
  await expect(buildUtiltsOutboundDraft({ ...base, applicationReference: '23-DGI-E73-S', payload: { ...payload, requestedMessageCode: 'E66' } }))
    .rejects.toThrow(/utilts_request_requested_type_reference_mismatch:E73:E66:23-DGI-E73-S/)
  await expect(buildUtiltsOutboundDraft({ ...base, applicationReference: '23-DGI-E73-S', payload }))
    .rejects.toThrow(/utilts_request_application_reference_target_invalid/)
})

it('refuses a requested type that E73 cannot request', async () => {
  await expect(buildUtiltsOutboundDraft({ ...base, applicationReference: '23-DGI-E66-S', payload: { ...payload, requestedMessageCode: 'E31' } }))
    .rejects.toThrow(/utilts_request_application_reference_target_invalid:E73:E31/)
})

it('an E66 observation never carries a requested-type reference', async () => {
  const draft = await buildUtiltsOutboundDraft({ ...base, code: 'E66', applicationReference: '23-DGI-E66-S', payload: { ...payload, requestedMessageCode: 'E66' } })
  expect(segments(draft.rawPayload!).some(s => /^RFF\+E66(:|$)/.test(s))).toBe(false)
})
