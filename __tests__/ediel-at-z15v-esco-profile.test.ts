// Component evidence for AT-Z15V-ESCO; whole acceptance HELD.
// Profile/field admission and the real prior-context consumer execute here.
// Scope/history rows are finite fixtures. No permission write, physical ACK,
// DDQ preservation or absence of a newly queued Z13 is proved by these tests.
import { beforeEach, expect, it, vi } from 'vitest'
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'
import { applyPermissionMarketSource } from '@/lib/ediel/permissions/permissionMarketTransition'
import { assessPriorPermissionFlow, assertPriorPermissionContext, priorPermissionWire } from '@/lib/ediel/prodat/prodatPriorPermissionFlow'
import { validateProdatPermissionMessage } from '@/lib/ediel/testing/prodatPermissionEngine'
import { alphabets, msg, object, prior, scopeRecords } from './fixtures/prodat-prior-flow'

const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: io }))
beforeEach(() => {
  vi.clearAllMocks()
  io.rpc.mockImplementation(() => { throw new Error('UNEXPECTED_PERMISSION_RPC') })
  io.from.mockImplementation(() => { throw new Error('NO_LIVE_DATABASE') })
})

type RequiredField = '327' | '325' | '226' | '322' | '324' | '209' | '223'
function withoutOwnField(field: RequiredField) {
  const body = object('Z15', 'S17')
  if (field === '209') return body.map(part => part[0] === 'LIN' ? ['LIN', part[1]] : part)
  const qualifier = { '327': '164', '325': 'Z09', '226': 'LI', '322': 'Z23', '324': 'Z25', '223': 'Z13' }[field]
  return body.filter((part, index) => {
    if (field === '327') return !(part[0] === 'DTM' && Array.isArray(part[1]) && part[1][0] === qualifier)
    if (field === '325' || field === '226') return !(part[0] === 'RFF' && Array.isArray(part[1]) && part[1][0] === qualifier)
    return !(part[0] === 'CCI' && part[2] === qualifier
      || part[0] === 'CAV' && body[index - 1]?.[0] === 'CCI' && body[index - 1]?.[2] === qualifier)
  })
}

for (const alphabet of alphabets) it(`Z15V admits the complete DSO to ESCO S17 wire (${alphabet.join('')})`, () => {
  const message = msg('Z15', 'S17', 'CASE-ALPHA', undefined, alphabet)
  expect(priorPermissionWire(message)).toMatchObject({
    code: 'Z15', application: '23-DGI-PRODAT', transportSender: '12345', transportReceiver: '54321',
    objects: [{ mode: 'S17', permission: 'PERMISSION', li: 'CASE-ALPHA' }],
  })
  const decision = resolveCanonicalRuntimeDecision(message)
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).toBe('accepted')
  expect(decision.policy).toMatchObject({
    code: 'Z15', subtype: 'V', transactionReasonCode: 'S17', direction: 'inbound',
    applicationReference: '23-DGI-PRODAT',
    semantics: { senderRoles: ['grid_owner'], receiverRoles: ['esco'], historical: false, businessEffect: 'stop_metering_reporting' },
    businessResponses: [],
  })
  expect(decision.policy?.fieldRules).toHaveLength(77)
  expect(decision.responsePlan).toEqual(expect.arrayContaining([
    expect.objectContaining({ family: 'CONTRL', outcome: 'positive' }),
    expect.objectContaining({ family: 'APERAK', outcome: 'positive' }),
  ])) // Plans only: the committed-effect consumer still owns actual ACK birth.
  expect(validateProdatPermissionMessage({ message }).outcome).toBe('positive')
  expect(io.rpc).not.toHaveBeenCalled()
})

for (const field of ['327', '325', '226', '322', '324', '209'] as const) it(`Z15V rejects missing own required field ${field} with a typed occurrence`, () => {
  const decision = resolveCanonicalRuntimeDecision(msg('Z15', 'S17', 'CASE-ALPHA', withoutOwnField(field)))
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).toBe('rejected')
  const finding = decision.issues.find(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === field)
  expect(finding?.prodatDiagnostic).toMatchObject({
    kind: 'field', fieldNumber: field, errorKind: 'missing',
    occurrence: { messageReference: 'M', lineIndex: 0, objectId: field === '209' ? null : '735123456789012345', lineItemReference: field === '226' ? null : 'CASE-ALPHA' },
  })
  expect(finding?.prodatDiagnostic?.sourceRule).toBeTruthy()
  expect(decision.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'positive')).toBe(false)
})

it('Z15V cannot select its canonical profile without own field 223', () => {
  const decision = resolveCanonicalRuntimeDecision(msg('Z15', 'S17', 'CASE-ALPHA', withoutOwnField('223')))
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).not.toBe('accepted')
  expect(decision.policy).toBeNull()
  expect(decision.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'CANONICAL_POLICY_RESOLUTION_FAILED', description: expect.stringContaining('prodat_subtype_unknown:missing') }),
  ])) // Profile resolution holds before a typed national 223 rejection is available.
  expect(decision.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'positive')).toBe(false)
  expect(io.rpc).not.toHaveBeenCalled()
})

it('Z15V cannot borrow a later object’s DTM164', () => {
  const decision = resolveCanonicalRuntimeDecision(msg('Z15', 'S17', '', [
    ...withoutOwnField('327'), ...object('Z15', 'S17', 'SECOND', '2'),
  ]))
  expect(decision.applicationDecision).toBe('rejected')
  const findings = decision.issues.filter(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === '327')
  expect(findings).toHaveLength(1)
  expect(findings[0].prodatDiagnostic).toMatchObject({ occurrence: { lineIndex: 0, lineItemReference: 'CASE-ALPHA' } })
})

for (const change of ['supplier-application', 'suffixed-bgm', 'incompatible-reason'] as const) it(`Z15V refuses ${change} at canonical admission`, () => {
  const message = msg('Z15', 'S17')
  if (change === 'supplier-application') {
    message.raw_payload = message.raw_payload!.replace('23-DGI-PRODAT', '23-DDQ-PRODAT')
    message.application_reference = '23-DDQ-PRODAT'
  } else if (change === 'suffixed-bgm') message.raw_payload = message.raw_payload!.replace('BGM+Z15+', 'BGM+Z15V+')
  else message.raw_payload = message.raw_payload!.replace('CAV+S17', 'CAV+Z22')
  const decision = resolveCanonicalRuntimeDecision(message)
  expect(decision.applicationDecision).not.toBe('accepted')
  expect(decision.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'positive')).toBe(false)
  expect(io.rpc).not.toHaveBeenCalled()
})

it('Z15V’s finite sent Z18 tuple reaches the real source-bound prior consumer', () => {
  const message = msg('Z15', 'S17')
  const context = assessPriorPermissionFlow(message, scopeRecords(), [prior('Z18')])
  expect(context).toMatchObject({ kind: 'correlated', objects: [{ kind: 'correlated_request', candidate: { id: prior('Z18').id } }] })
  expect(() => assertPriorPermissionContext(message, context, null)).not.toThrow()
  expect(() => assertPriorPermissionContext(message, { ...context }, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
  for (const changed of [
    { ...message, company_id: '00000000-0000-4000-8000-000000000099' },
    { ...message, raw_payload: message.raw_payload!.replace('Z09:PERMISSION', 'Z09:OTHER') },
    { ...message, direction: 'outbound' as const },
  ]) expect(() => assertPriorPermissionContext(changed, context, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
})

for (const change of ['wrong-role', 'foreign-owner', 'wrong-direction', 'wrong-permission', 'wrong-end'] as const) it(`Z15V holds ${change} without issuing a usable prior context`, () => {
  const message = msg('Z15', 'S17'), records = scopeRecords(), candidate = prior('Z18')
  if (change === 'wrong-role') records.roles[0].role_code = 'supplier'
  else if (change === 'foreign-owner') candidate.company_id = '00000000-0000-4000-8000-000000000099'
  else if (change === 'wrong-direction') message.direction = 'outbound'
  else if (change === 'wrong-permission') candidate.raw_payload = candidate.raw_payload!.replace('Z09:PERMISSION', 'Z09:OTHER')
  else candidate.raw_payload = candidate.raw_payload!.replace('164:202610010000:203', '164:202610020000:203')
  const context = assessPriorPermissionFlow(message, records, [candidate])
  expect(context.kind).toBe('internal_review')
  expect(() => assertPriorPermissionContext(message, context, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
})

it('the actual permission adapter refuses outward Z15 before its native RPC', async () => {
  const result = await applyPermissionMarketSource({ actorUserId: prior().id, message: { ...msg('Z15', 'S17'), direction: 'outbound' } })
  expect(result).toMatchObject({ applied: false, reason: 'not_inbound_permission_source' })
  expect(io.rpc).not.toHaveBeenCalled()
})
