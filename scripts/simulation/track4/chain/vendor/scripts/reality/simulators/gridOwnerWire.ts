/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/reality/simulators/gridOwnerWire.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
// What a grid owner writes back: a PRODAT Z04 confirming a received Z03, built
// only from the Z03 itself (the facts a real DSO echoes) and the DSO's own
// facility register defaults. Same mapping as the approved native acceptance
// test scripts/ediel-at-z03l-z03lk-supplier-native.test.ts (confirmation()).
import { randomUUID } from 'node:crypto'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { OWNER, ownerSourceWithInstallationStatus } from '@/__tests__/helpers/sourceOwnerFixtures'

export type SwitchRequestFacts = {
  supplier: string; gridOwner: string; external: string; startDate: string; variant: 'L' | 'LK'
  caseReference: string; gridArea: string; customerIdentity: string; brp: string
}

/** Reads the facts a grid owner needs from our Z03, as the DSO's own system would. */
export function readSwitchRequest(raw: string): SwitchRequestFacts {
  const t = tokenizeEdifact(raw)
  const seg = (tag: string, qualifier?: string, index = 1) => t.segments.find(s => s.tag === tag && (qualifier === undefined || segmentComposite(s, index, t.una)[0] === qualifier))
  const comp = (tag: string, qualifier: string | undefined, element: number, component = 0, index = 1) => {
    const s = seg(tag, qualifier, index)
    return s ? segmentComposite(s, element, t.una)[component] ?? '' : ''
  }
  const unb = seg('UNB')!
  const cav = t.segments.find((s, i) => s.tag === 'CAV' && t.segments[i - 1]?.tag === 'CCI' && segmentComposite(t.segments[i - 1], 2, t.una)[0] === 'Z13')
  const kind = cav ? segmentComposite(cav, 1, t.una)[0] : ''
  const facts: SwitchRequestFacts = {
    supplier: segmentComposite(unb, 2, t.una)[0], gridOwner: segmentComposite(unb, 3, t.una)[0],
    external: comp('LIN', undefined, 3), startDate: comp('DTM', '92', 1, 1).slice(0, 8),
    variant: kind === 'Z23' ? 'LK' : 'L', caseReference: comp('RFF', 'LI', 1, 1), gridArea: comp('RFF', 'Z05', 1, 1),
    customerIdentity: comp('NAD', 'UD', 2), brp: comp('NAD', 'Z02', 2),
  }
  for (const [key, value] of Object.entries(facts)) if (!value) throw Error(`switch_request_fact_missing:${key}`)
  return facts
}

export function buildZ04ForSwitchRequest(input: { request: string; gridOwnerEdielId: string }) {
  const f = readSwitchRequest(input.request)
  if (f.gridOwner !== input.gridOwnerEdielId) throw Error(`switch_request_addressed_to_other_grid_owner:${f.gridOwner}`)
  const start = `${f.startDate}0000`
  const selected = ownerSourceWithInstallationStatus('Z12').raw_payload!.replaceAll(OWNER.external, f.external)
    .replaceAll('12345:160:SVK', `${f.gridOwner}:160:SVK`).replaceAll('54321:160:SVK', `${f.supplier}:160:SVK`)
    .replaceAll('11111:160:SVK', `${f.brp}:160:SVK`).replaceAll('CUSTOMER-1::89', `${f.customerIdentity}:SE2:260`)
    .replaceAll('RFF+Z05:NET-1', `RFF+Z05:${f.gridArea}`).replaceAll('RFF+LI:CASE-1', `RFF+LI:${f.caseReference}`)
    .replaceAll('202610010000', start).replaceAll('CAV+Z22', `CAV+${f.variant === 'L' ? 'Z22' : 'Z23'}`)
  const template = tokenizeEdifact(selected)
  const documentNumber = randomUUID().replaceAll('-', '').slice(0, 20)
  const body = template.segments.filter(s => !['UNA', 'UNB', 'UNH', 'UNT', 'UNZ'].includes(s.tag)).map((s, index, segments) => {
    if (s.tag === 'BGM') return `BGM+Z04+${documentNumber}+9+AB`
    if (s.tag === 'CAV' && segments[index - 1]?.tag === 'CCI') {
      const qualifier = segmentComposite(segments[index - 1], 2, template.una)[0]
      if (qualifier === 'Z04') return 'CAV+Z04'
      if (qualifier === 'Z15') return 'CAV+Z32'
      if (qualifier === 'Z14') return 'CAV+:::L639Q'
    }
    if (s.tag === 'NAD' && segmentComposite(s, 1, template.una)[0] === 'Z02') return `${s.raw}+++++++SE`
    return s.raw
  })
  // The grid owner declares the facility's own readings (fields 214/218/259: digits, decimals, tariff code), as
  // the approved native test's withOwnReadings(body, true) does. Without them the receiver holds the Z04 with
  // PRODAT_DEPENDENT_CONDITION_UNDETERMINED and the switch is never confirmed (FINDINGS T6).
  if (body.some(segment => /^CCI\+\+Z(?:02|05|16)(?:[+:]|$)/.test(segment))) throw Error('z04_own_readings_already_present')
  const line = body.findIndex(segment => segment.startsWith('LIN+'))
  const boundary = body.findIndex((segment, index) => index > line && /^(?:RFF|NAD)\+/.test(segment))
  if (line < 0 || boundary < 0) throw Error('z04_own_readings_boundary_missing')
  body.splice(boundary, 0, 'CCI++Z02', 'CAV+:::1', 'CCI++Z05', 'CAV+:::6', 'CCI++Z16', 'CAV+:::101')
  return { ...encodeGridOwnerAnswer(input.request, f.gridOwner, f.supplier, body), facts: f }
}

/**
 * One PRODAT business message from the grid owner (`gridOwner`) back to the sender (`supplier`) of `request` (our
 * Z03 or Z01): qualifiers and sub-addresses mirror the request, in the lane the request came in.
 */
export function encodeGridOwnerAnswer(request: string, gridOwner: string, supplier: string, businessSegments: string[]) {
  const envelope = EdifactEnvelopeCodec.decode(request)
  const reference = randomUUID().replaceAll('-', '').slice(0, 14).toUpperCase()
  const raw = EdifactEnvelopeCodec.encode({
    sender: gridOwner, receiver: supplier, senderQualifier: envelope.receiverQualifier, receiverQualifier: envelope.senderQualifier,
    senderSubAddress: envelope.receiverSubAddress, receiverSubAddress: envelope.senderSubAddress, applicationReference: '23-DDQ-PRODAT',
    // Answered in the lane the request came in: a production Z03 gets a production Z04 (FINDINGS T7).
    acknowledgementRequest: true, environment: envelope.environment, interchangeReference: reference,
    messages: [{ messageReference: randomUUID().replaceAll('-', '').slice(0, 14), messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments }],
  })
  return { raw, reference }
}
