// Profile/correlation component for AT-Z15C-ESCO and AT-Z18V-ESCO.
// Whole-contract promotion requires native source, ACK and durable-effect proof.
import { beforeEach, expect, it, vi } from 'vitest'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { assessPriorPermissionFlow, assertPriorPermissionContext, priorPermissionWire } from '@/lib/ediel/prodat/prodatPriorPermissionFlow'
import { applyPermissionMarketSource } from '@/lib/ediel/permissions/permissionMarketTransition'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { omitPermissionField, permissionRequiredFields } from '../scripts/helpers/ediel-permission-field-omissions'
import { alphabets, msg, object, prior, scopeRecords } from './fixtures/prodat-prior-flow'

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: io }))
beforeEach(() => {
  vi.clearAllMocks()
  io.rpc.mockImplementation(() => { throw new Error('UNEXPECTED_PERMISSION_RPC') })
  io.from.mockImplementation(() => { throw new Error('NO_LIVE_DATABASE') })
})

for (const alphabet of alphabets) it(`Z15C admits the exact DGI Z15/Z24 restoration profile (${alphabet.join('')})`, () => {
  const message = msg('Z15', 'Z24', 'CASE-ALPHA', undefined, alphabet)
  expect(priorPermissionWire(message)).toMatchObject({ code: 'Z15', application: '23-DGI-PRODAT', objects: [{ mode: 'Z24', permission: 'PERMISSION', li: 'CASE-ALPHA' }] })
  const decision = resolveCanonicalRuntimeDecision(message)
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).toBe('accepted')
  expect(decision.policy).toMatchObject({ code: 'Z15', subtype: 'C', transactionReasonCode: 'Z24', direction: 'inbound', applicationReference: '23-DGI-PRODAT' })
  expect(io.rpc).not.toHaveBeenCalled()
})

function omitField(code: 'Z15' | 'Z18', field: '327' | '324' | '325' | '226' | '322' | '209') {
  const body = object(code, code === 'Z15' ? 'Z24' : 'S17')
  if (field === '209') return body.map(part => part[0] === 'LIN' ? ['LIN', part[1]] : part)
  const q = { '327': '164', '324': 'Z25', '325': 'Z09', '226': 'LI', '322': 'Z23' }[field]
  return body.filter((part, index) => {
    if (field === '327') return !(part[0] === 'DTM' && Array.isArray(part[1]) && part[1][0] === q)
    if (field === '325' || field === '226') return !(part[0] === 'RFF' && Array.isArray(part[1]) && part[1][0] === q)
    return !(part[0] === 'CCI' && part[2] === q || part[0] === 'CAV' && body[index - 1]?.[0] === 'CCI' && body[index - 1]?.[2] === q)
  })
}

for (const field of ['327', '324', '325', '226', '322', '209'] as const) it(`Z15C refuses missing own required field ${field}`, () => {
  const decision = resolveCanonicalRuntimeDecision(msg('Z15', 'Z24', 'CASE-ALPHA', omitField('Z15', field)))
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).toBe('rejected')
  expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({ prodatDiagnostic: expect.objectContaining({ kind: 'field', fieldNumber: field, errorKind: 'missing' }) })]))
  expect(decision.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'positive')).toBe(false)
})

it('Z15C correlates the exact prior received Z15 without a Z18', () => {
  const message = msg('Z15', 'Z24')
  const ending = { ...msg('Z15'), id: prior().id, created_at: '2026-09-19T00:00:00Z', message_received_at: '2026-09-19T00:00:00Z' }
  const context = assessPriorPermissionFlow(message, scopeRecords(), [ending])
  expect(context).toMatchObject({ kind: 'correlated', objects: [{ kind: 'correlated_cancellation', candidate: { id: ending.id } }] })
  expect(() => assertPriorPermissionContext(message, context, null)).not.toThrow()
  expect(assessPriorPermissionFlow(message, scopeRecords(), [prior('Z18')]).kind).toBe('internal_review')
  expect(() => assertPriorPermissionContext(message, { ...context }, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
})

for (const change of ['foreign-tenant', 'wrong-role', 'wrong-direction', 'wrong-permission', 'wrong-li', 'wrong-object', 'wrong-end', 'wire-mutation'] as const) it(`Z15C refuses ${change} through the actual correlation guard`, () => {
  const message = msg('Z15', 'Z24'), records = scopeRecords()
  const ending = { ...msg('Z15'), id: prior().id, created_at: '2026-09-19T00:00:00Z', message_received_at: '2026-09-19T00:00:00Z' }
  if (change === 'foreign-tenant') ending.company_id = '00000000-0000-4000-8000-000000000099'
  else if (change === 'wrong-role') records.roles[0].role_code = 'supplier'
  else if (change === 'wrong-direction') message.direction = 'outbound'
  else if (change === 'wrong-permission') ending.raw_payload = ending.raw_payload!.replace('Z09:PERMISSION', 'Z09:OTHER')
  else if (change === 'wrong-li') ending.raw_payload = ending.raw_payload!.replace('LI:CASE-ALPHA', 'LI:OTHER')
  else if (change === 'wrong-object') ending.raw_payload = ending.raw_payload!.replace('735123456789012345', '735123456789012352')
  else if (change === 'wrong-end') ending.raw_payload = ending.raw_payload!.replace('164:202610010000:203', '164:202610020000:203')
  const context = assessPriorPermissionFlow(message, records, [ending])
  if (change === 'wire-mutation') message.raw_payload = message.raw_payload!.replace('LI:CASE-ALPHA', 'LI:CHANGED')
  else expect(context.kind).toBe('internal_review')
  expect(() => assertPriorPermissionContext(message, context, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
  expect(io.rpc).not.toHaveBeenCalled()
})

it('the permission effect adapter refuses outward Z15C before any native write', async () => {
  expect(await applyPermissionMarketSource({ actorUserId: prior().id, message: { ...msg('Z15', 'Z24'), direction: 'outbound' } })).toMatchObject({ applied: false, reason: 'not_inbound_permission_source' })
  expect(io.rpc).not.toHaveBeenCalled()
})

it('complete outward Z18V has matching physical ESCO parties and the S17 profile', () => {
  const message = prior('Z18'), wire = EdifactEnvelopeCodec.decode(message.raw_payload!)
  expect(wire).toMatchObject({ sender: message.sender_ediel_id, receiver: message.receiver_ediel_id, applicationReference: '23-DGI-PRODAT' })
  const decision = resolveCanonicalRuntimeDecision(message)
  expect([decision.syntaxDecision, decision.applicationDecision]).toEqual(['accepted', 'accepted'])
  expect(decision.policy).toMatchObject({ code: 'Z18', subtype: 'V', direction: 'outbound', transactionReasonCode: 'S17' })
})

for (const field of ['327', '324', '325'] as const) it(`Z18V refuses missing required termination field ${field}`, () => {
  const message = prior('Z18')
  // Apply the same physical party reversal as prior(), retaining an outgoing
  // ESCO source while removing only the field under test.
  const [component, element] = alphabets[0]
  message.raw_payload = msg('Z18', 'S17', 'CASE-ALPHA', omitField('Z18', field)).raw_payload!
    .replaceAll(element + '12345' + component, element + 'TMPID' + component)
    .replaceAll(element + '54321' + component, element + '12345' + component)
    .replaceAll(element + 'TMPID' + component, element + '54321' + component)
  expect(EdifactEnvelopeCodec.decode(message.raw_payload)).toMatchObject({ sender: message.sender_ediel_id, receiver: message.receiver_ediel_id })
  const decision = resolveCanonicalRuntimeDecision(message)
  expect(decision.applicationDecision).toBe('rejected')
  expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({ prodatDiagnostic: expect.objectContaining({ fieldNumber: field, errorKind: 'missing' }) })]))
})

for (const code of ['Z15', 'Z18'] as const) for (const field of permissionRequiredFields.filter(field => code === 'Z15' || field !== '322')) it(`${code} rejects required common/own/UD field ${field} with its own source diagnostic`, () => {
  const message = code === 'Z15' ? msg('Z15', 'Z24') : prior('Z18')
  message.raw_payload = omitPermissionField(message.raw_payload!, field)
  const decision = resolveCanonicalRuntimeDecision(message)
  if (['207', '208', '227'].includes(field)) {
    // These empty NAD identifiers violate the underlying UNSM mandatory
    // C082/3039 component before national application assessment can execute.
    expect(decision.syntaxDecision).toBe('rejected')
    expect(decision.applicationDecision).toBe('not_applicable')
    expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'UNSM_MANDATORY_ELEMENT_MISSING' })]))
  } else if (code === 'Z15' && field === '311') {
    // No physical process prefix: canonical guide selection is held; the
    // cached row app must not qualify application/effect acceptance.
    expect(decision.applicationDecision).toBe('manual_review')
    expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'CANONICAL_POLICY_RESOLUTION_FAILED' })]))
  } else {
    expect(decision.applicationDecision).toBe('rejected')
    expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({ prodatDiagnostic: expect.objectContaining({ fieldNumber: field, errorKind: 'missing' }) })]))
  }
  expect(decision.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'positive')).toBe(false)
})
