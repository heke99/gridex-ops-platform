// masterplan: SC-042
// Synthetic physical originals + actual runtime/builder/codec/final guide.
// No registered source, persistence, SMTP, native or ACK02/03 whole-rule claim.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite, tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {raw} from './fixtures/prodat-register'
import {source, z10} from './fixtures/prodat-identity'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

const ports = vi.hoisted(() => ({attempts: [] as string[]}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {
  from: (table: string) => {ports.attempts.push(`table:${table}`); throw Error(`undeclared_sc042_table:${table}`)},
  rpc: (name: string) => {ports.attempts.push(`rpc:${name}`); throw Error(`undeclared_sc042_rpc:${name}`)},
}}))
vi.mock('nodemailer', () => {
  const createTransport = () => {ports.attempts.push('smtp'); throw Error('sc042_external_transport_forbidden')}
  return {createTransport, default: {createTransport}}
})

const company = '10000000-0000-4000-8000-000000000001'
const actor = '20000000-0000-4000-8000-000000000001'
type Wire = ReturnType<typeof tokenizeEdifact>

beforeEach(() => {
  ports.attempts = []
  vi.stubGlobal('fetch', () => {ports.attempts.push('fetch'); throw Error('sc042_network_forbidden')})
})
afterEach(() => {expect(ports.attempts).toEqual([]); vi.unstubAllGlobals()})

function prodatOriginal(code = 'Z10'): EdielMessageRow {
  // The lower field fixture omits UNB qualifiers; complete the physical route
  // before testing a response which must reverse that exact original tuple.
  const payload = raw(z10(), code).replace('UNB+UNOC:3+S+R+', 'UNB+UNOC:3+S:14+R:14+')
  return {...source(payload, code), company_id: company,
    external_reference: 'CACHED-NOT-DOCUMENT', transaction_reference: 'CACHED-NOT-LI'}
}

function utiltsOriginal(badSecond = false): EdielMessageRow {
  const original = energyHandoffMessage('2026-10-01', company)
  const lines = original.raw_payload!.split('\n')
  const begin = lines.findIndex(line => line.startsWith('IDE+'))
  const end = lines.findIndex(line => line.startsWith('UNT+'))
  const second = lines.slice(begin, end).map(line => line
    .replaceAll('GRIDEX2607E66001', 'SECOND-UTILTS')
    .replace('QTY+136:500', badSecond ? 'QTY+136:500:MWH' : 'QTY+136:500'))
  return {...original, raw_payload: recountEdifactUnt([...lines.slice(0, end), ...second, ...lines.slice(end)].join('\n')),
    external_reference: 'CACHED-NOT-DOCUMENT', transaction_reference: 'CACHED-NOT-IDE'}
}

function refs(wire: Wire, qualifier: string, segments = wire.segments): string[] {
  return segments.filter(segment => segment.tag === 'RFF' && segmentComposite(segment, 1, wire.una)[0] === qualifier)
    .map(segment => segmentComposite(segment, 1, wire.una)[1])
}

function errorGroups(wire: Wire) {
  const groups: typeof wire.segments[] = []
  for (const segment of wire.segments) {
    if (segment.tag === 'ERC') groups.push([])
    if (groups.length && !['UNT', 'UNZ'].includes(segment.tag)) groups.at(-1)!.push(segment)
  }
  return groups
}

function ackPolicy(payload: string, original: EdielMessageRow): CanonicalEdielPolicy {
  const policy = resolveCanonicalMessagePolicy({...original, direction: 'outbound', message_family: 'APERAK',
    message_code: 'APERAK', raw_payload: payload, parsed_payload: {}, validation_report: {}})
  if (!policy) throw Error('sc042_actual_ack_policy_required')
  return policy
}

function guide(payload: string, original: EdielMessageRow, retainedPolicy = ackPolicy(payload, original)) {
  const wire = tokenizeEdifact(payload)
  return validateCanonicalAckGuide({policy: retainedPolicy, rawPayload: payload,
    rawSegments: wire.segments.map(segment => segment.raw), una: wire.una, sourceRawPayload: original.raw_payload})
}

function requiredPayload(draft: ReturnType<typeof buildAperakDraft>): string {
  if (typeof draft.rawPayload !== 'string' || !draft.rawPayload) throw Error('sc042_generated_wire_required')
  return draft.rawPayload
}

function finalWire(payload: string, original: EdielMessageRow, profile: readonly string[]) {
  const decoded = EdifactEnvelopeCodec.decode(payload)
  const wire = tokenizeEdifact(payload)
  // Literal expected positions are independent of the builder and codec.
  expect(segmentComposite(wire.segments.find(segment => segment.tag === 'UNH'), 2, wire.una)).toEqual(profile)
  expect(decoded.segments.map(segment => segment.raw)).toEqual(wire.segments.map(segment => segment.raw))
  expect(decoded.applicationReference).toBe(original.message_family === 'PRODAT' ? '23-DDQ-PRODAT' : '23-DDQ-E66-T')
  expect([decoded.sender, decoded.receiver]).toEqual(original.message_family === 'PRODAT' ? ['R', 'S'] : ['21660', '91100'])
  expect(guide(payload, original)).toEqual([])
  return wire
}

function refuses(payload: string, original: EdielMessageRow, policy: CanonicalEdielPolicy, code: string) {
  expect(guide(payload, original, policy).map(issue => issue.code)).toContain(code)
}

describe('SC042 actual original/outcome to APERAK family profile and final guide', () => {
  it('keeps processed PRODAT P34 in BGM1225 with its own BGM/object/LI references and no UTILTS groups', () => {
    const original = prodatOriginal(), before = JSON.stringify(original)
    const decision = resolveCanonicalRuntimeDecision(original)
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision, JSON.stringify(decision.issues)).toBe('accepted')
    const plan = decision.responsePlan.find(item => item.family === 'APERAK')
    expect(plan).toMatchObject({outcome: 'positive', erc: '100'})
    if (plan?.outcome !== 'positive') throw Error('sc042_actual_positive_prodat_plan_required')
    const draft = buildAperakDraft({actorUserId: actor, sourceMessage: original, outcome: plan.outcome, applicationErrors: plan.applicationErrors})
    const payload = requiredPayload(draft)
    const wire = finalWire(payload, original, ['APERAK', 'D', '96A', 'UN', 'E2SE6A'])
    expect(wire.segments.find(segment => segment.tag === 'BGM')!.raw.split('+')).toEqual(['BGM', '', '', '34'])
    expect(refs(wire, 'ACW')).toEqual(['D'])
    expect(refs(wire, 'Z07')).toEqual(['735123456789012345'])
    expect(refs(wire, 'LI')).toEqual(['EVENT'])
    expect(refs(wire, 'DM')).toEqual([])
    expect(wire.segments.filter(segment => segment.tag === 'DOC')).toEqual([])
    expect(errorGroups(wire).map(group => group.map(segment => segment.tag))).toEqual([['ERC', 'FTX', 'RFF', 'RFF']])
    expect(errorGroups(wire).map(group => segmentComposite(group[0], 1, wire.una))).toEqual([['100', '', '260']])
    const policy = ackPolicy(payload, original)
    refuses(payload.replace('APERAK:D:96A:UN:E2SE6A', 'APERAK:D:04A:UN:E5SE5A'), original, policy, 'ACK_APERAK_PROFILE_INVALID')
    refuses(payload.replace('BGM+++34', 'BGM+312+FOREIGN+9'), original, policy, 'ACK_PRODAT_MESSAGE_FUNCTION_INVALID')
    refuses(payload.replace('RFF+LI:EVENT', 'RFF+ACW:SECOND-UTILTS'), original, policy, 'ACK_PRODAT_OWN_OBJECT_REFERENCE_MISMATCH')
    expect(JSON.stringify(original)).toBe(before)
  })

  it('derives whole-message PRODAT P27 from the actual physical field202 rejection, without invented transaction references', () => {
    const original = prodatOriginal('ZZZ'), before = JSON.stringify(original)
    const decision = resolveCanonicalRuntimeDecision(original)
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision).toBe('rejected')
    expect(original.message_code).toBe('ZZZ')
    expect(original.parsed_payload).toEqual({})
    expect(decision.policy).toBeNull()
    const sourceWire = tokenizeEdifact(original.raw_payload)
    expect(segmentComposite(sourceWire.segments.find(segment => segment.tag === 'BGM'), 1, sourceWire.una)).toEqual(['ZZZ'])
    const plan = decision.responsePlan.find(item => item.family === 'APERAK')
    expect(plan).toMatchObject({outcome: 'negative', applicationErrors: [{ercCode: '42', fieldCode: '202', text: 'Felaktigt Meddelandenamn ZZZ'}]})
    expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code: 'PRODAT_HEADER_202_POLICY'})]))
    if (plan?.outcome !== 'negative') throw Error('sc042_actual_negative_prodat_plan_required')
    const draft = buildAperakDraft({actorUserId: actor, sourceMessage: original, outcome: plan.outcome, applicationErrors: plan.applicationErrors})
    const payload = requiredPayload(draft)
    const wire = finalWire(payload, original, ['APERAK', 'D', '96A', 'UN', 'E2SE6A'])
    expect(wire.segments.find(segment => segment.tag === 'BGM')!.raw.split('+')).toEqual(['BGM', '', '', '27'])
    expect(refs(wire, 'ACW')).toEqual(['D'])
    for (const qualifier of ['DM', 'Z07', 'LI']) expect(refs(wire, qualifier)).toEqual([])
    expect(wire.segments.filter(segment => segment.tag === 'DOC')).toEqual([])
    expect(errorGroups(wire).map(group => group.map(segment => segment.tag))).toEqual([['ERC', 'FTX']])
    expect(errorGroups(wire).map(group => segmentComposite(group[0], 1, wire.una))).toEqual([['42', '', '260']])
    expect(wire.segments.filter(segment => segment.tag === 'FTX').map(segment => segmentComposite(segment, 3, wire.una))).toEqual([['202', '', '260']])
    const policy = ackPolicy(payload, original)
    refuses(payload.replace('RFF+ACW:D', 'RFF+ACW:CACHED-NOT-LI'), original, policy, 'ACK_PRODAT_ORIGINAL_DOCUMENT_MISMATCH')
    refuses(payload.replace('ERC+42::260', 'ERC+100::260'), original, policy, 'ACK_PRODAT_WHOLE_REJECTION_ACCEPTANCE_CONFLICT')
    expect(JSON.stringify(original)).toBe(before)
  })

  it('keeps accepted UTILTS U312 in BGM1001, copying DOC and each physical IDE into separate own-DM groups', () => {
    const original = utiltsOriginal(), before = JSON.stringify(original)
    const runtime = runUtiltsRuntimeForMessage(original)
    expect(runtime.validation.classification, JSON.stringify(runtime.validation.issues)).toBe('accepted')
    expect(runtime.transactionDispositions.map(item => [item.transactionId, item.responseType])).toEqual([
      ['GRIDEX2607E66001', 'positive_aperak'], ['SECOND-UTILTS', 'positive_aperak'],
    ])
    expect(runtime.ackPlan.aperakOutcome).toBe('positive')
    if (runtime.ackPlan.aperakOutcome !== 'positive') throw Error('sc042_actual_positive_utilts_plan_required')
    const draft = buildAperakDraft({actorUserId: actor, sourceMessage: original, outcome: runtime.ackPlan.aperakOutcome,
      applicationErrors: runtime.ackPlan.aperakApplicationErrors})
    const payload = requiredPayload(draft)
    const wire = finalWire(payload, original, ['APERAK', 'D', '04A', 'UN', 'E5SE5A'])
    const bgm = wire.segments.find(segment => segment.tag === 'BGM')!.raw.split('+')
    expect([bgm[1], bgm[3], bgm.length]).toEqual(['312', '9', 4])
    expect(bgm[2]).toBeTruthy(); expect(bgm[2]).not.toBe('GRIDEX2607E66MSG001')
    expect(wire.segments.filter(segment => segment.tag === 'DOC').map(segment => segment.raw)).toEqual(['DOC+E66:SVK:260+GRIDEX2607E66MSG001'])
    expect(refs(wire, 'ACW')).toEqual(['GRIDEX2607E66001', 'SECOND-UTILTS'])
    expect(refs(wire, 'DM')).toHaveLength(2)
    expect(new Set(refs(wire, 'DM')).size).toBe(2)
    expect(refs(wire, 'DM').some(reference => ['GRIDEX2607E66001', 'SECOND-UTILTS'].includes(reference))).toBe(false)
    for (const qualifier of ['Z07', 'LI']) expect(refs(wire, qualifier)).toEqual([])
    expect(errorGroups(wire).map(group => group.map(segment => segment.tag))).toEqual([
      ['ERC', 'FTX', 'RFF', 'RFF'], ['ERC', 'FTX', 'RFF', 'RFF'],
    ])
    expect(errorGroups(wire).map(group => segmentComposite(group[0], 1, wire.una))).toEqual([['100', '', '260'], ['100', '', '260']])
    const policy = ackPolicy(payload, original)
    refuses(payload.replace('APERAK:D:04A:UN:E5SE5A', 'APERAK:D:96A:UN:E2SE6A'), original, policy, 'ACK_APERAK_PROFILE_INVALID')
    refuses(payload.replace(wire.segments.find(segment => segment.tag === 'BGM')!.raw, 'BGM+++34'), original, policy, 'ACK_UTILTS_BGM_STATUS_INVALID')
    refuses(payload.replace('DOC+E66:SVK:260+GRIDEX2607E66MSG001', 'DOC+Z10:SVK:260+D'), original, policy, 'ACK_UTILTS_ORIGINAL_DOCUMENT_MISMATCH')
    refuses(payload.replace('RFF+ACW:SECOND-UTILTS', 'RFF+ACW:EVENT'), original, policy, 'ACK_UTILTS_ORIGINAL_TRANSACTION_MISMATCH')
    refuses(payload.replace('ERC+100::260', 'ERC+42::260'), original, policy, 'ACK_UTILTS_DOCUMENT_TRANSACTION_OUTCOME_CONFLICT')
    expect(JSON.stringify(original)).toBe(before)
  })

  it('derives UTILTS U313 from its own rejected QTY-unit group and excludes the clean sibling ERC100', () => {
    const original = utiltsOriginal(true), before = JSON.stringify(original)
    const runtime = runUtiltsRuntimeForMessage(original)
    expect(runtime.validation.classification).toBe('application_rejected')
    expect(runtime.validation.syntaxOk).toBe(true)
    expect(runtime.transactionDispositions.map(item => [item.transactionId, item.disposition, item.responseType])).toEqual([
      ['GRIDEX2607E66001', 'accepted', 'positive_aperak'], ['SECOND-UTILTS', 'guide_rejected', 'negative_aperak'],
    ])
    expect(runtime.facts.transactions.map(item => [item.transactionId, item.quantities.map(quantity => quantity.raw)])).toEqual([
      ['GRIDEX2607E66001', ['QTY+136:500']], ['SECOND-UTILTS', ['QTY+136:500:MWH']],
    ])
    expect(runtime.ackPlan.aperakApplicationErrors).toEqual([{ercCode: '42', fieldCode: 'QTY/C186/6411', text: 'INCORRECT DATA MWH',
      referenceQualifier: 'ACW', referenceNumber: 'SECOND-UTILTS', lineItemReference: 'SECOND-UTILTS'}])
    expect(runtime.ackPlan.aperakOutcome).toBe('negative')
    if (runtime.ackPlan.aperakOutcome !== 'negative') throw Error('sc042_actual_negative_utilts_plan_required')
    const draft = buildAperakDraft({actorUserId: actor, sourceMessage: original, outcome: runtime.ackPlan.aperakOutcome,
      applicationErrors: runtime.ackPlan.aperakApplicationErrors})
    const payload = requiredPayload(draft)
    const wire = finalWire(payload, original, ['APERAK', 'D', '04A', 'UN', 'E5SE5A'])
    const bgm = wire.segments.find(segment => segment.tag === 'BGM')!.raw.split('+')
    expect([bgm[1], bgm[3], bgm.length]).toEqual(['313', '9', 4])
    expect(bgm[2]).toBeTruthy()
    expect(wire.segments.filter(segment => segment.tag === 'DOC').map(segment => segment.raw)).toEqual(['DOC+E66:SVK:260+GRIDEX2607E66MSG001'])
    expect(refs(wire, 'ACW')).toEqual(['SECOND-UTILTS'])
    expect(refs(wire, 'DM')).toHaveLength(1)
    expect(refs(wire, 'DM')[0]).not.toBe('SECOND-UTILTS')
    for (const qualifier of ['Z07', 'LI']) expect(refs(wire, qualifier)).toEqual([])
    expect(errorGroups(wire).map(group => group.map(segment => segment.tag))).toEqual([['ERC', 'FTX', 'RFF', 'RFF']])
    expect(errorGroups(wire).map(group => segmentComposite(group[0], 1, wire.una))).toEqual([['42', '', '260']])
    expect(wire.segments.filter(segment => segment.tag === 'FTX').map(segment => segmentComposite(segment, 3, wire.una))).toEqual([['QTY/C186/6411', '', '260']])
    const policy = ackPolicy(payload, original)
    refuses(payload.replace('ERC+42::260', 'ERC+100::260'), original, policy, 'ACK_UTILTS_DOCUMENT_TRANSACTION_OUTCOME_CONFLICT')
    refuses(payload.replace(`RFF+DM:${refs(wire, 'DM')[0]}`, 'RFF+LI:EVENT'), original, policy, 'ACK_UTILTS_OWN_TRANSACTION_ID_INVALID')
    expect(JSON.stringify(original)).toBe(before)
  })
})
