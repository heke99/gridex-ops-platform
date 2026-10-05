// Component evidence for AT-Z15VH-ESCO; whole acceptance HELD.
// Full wire admission executes; temporal identity/history records are finite.
// Historical-job completion/coverage, unchanged V/DDQ, physical ACK and durable
// permission effects remain with the existing ESCO/SC023/native owners.
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
  const body = object('Z15', 'S18')
  if (field === '209') return body.map(part => part[0] === 'LIN' ? ['LIN', part[1]] : part)
  const qualifier = { '327': '164', '325': 'Z09', '226': 'LI', '322': 'Z23', '324': 'Z25', '223': 'Z13' }[field]
  return body.filter((part, index) => {
    if (field === '327') return !(part[0] === 'DTM' && Array.isArray(part[1]) && part[1][0] === qualifier)
    if (field === '325' || field === '226') return !(part[0] === 'RFF' && Array.isArray(part[1]) && part[1][0] === qualifier)
    return !(part[0] === 'CCI' && part[2] === qualifier
      || part[0] === 'CAV' && body[index - 1]?.[0] === 'CCI' && body[index - 1]?.[2] === qualifier)
  })
}

for (const alphabet of alphabets) it(`Z15VH admits the complete DSO to ESCO S18 wire (${alphabet.join('')})`, () => {
  const message = msg('Z15', 'S18', 'CASE-ALPHA', undefined, alphabet)
  expect(priorPermissionWire(message)).toMatchObject({
    code: 'Z15', application: '23-DGI-PRODAT', transportSender: '12345', transportReceiver: '54321',
    objects: [{ mode: 'S18', permission: 'PERMISSION', li: 'CASE-ALPHA' }],
  })
  const decision = resolveCanonicalRuntimeDecision(message)
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).toBe('accepted')
  expect(decision.policy).toMatchObject({
    code: 'Z15', subtype: 'VH', transactionReasonCode: 'S18', direction: 'inbound',
    applicationReference: '23-DGI-PRODAT',
    semantics: { senderRoles: ['grid_owner'], receiverRoles: ['esco'], historical: true, businessEffect: 'stop_historical_metering_reporting' },
    businessResponses: [],
  })
  expect(decision.policy?.fieldRules).toHaveLength(77)
  expect(decision.responsePlan).toEqual(expect.arrayContaining([
    expect.objectContaining({ family: 'CONTRL', outcome: 'positive' }),
    expect.objectContaining({ family: 'APERAK', outcome: 'positive' }),
  ])) // A plan grants no native permission effect or physical ACK authority.
  expect(validateProdatPermissionMessage({ message }).outcome).toBe('positive')
  expect(io.rpc).not.toHaveBeenCalled()
})

for (const field of ['327', '325', '226', '322', '324', '209'] as const) it(`Z15VH rejects missing own required field ${field} with a typed occurrence`, () => {
  const decision = resolveCanonicalRuntimeDecision(msg('Z15', 'S18', 'CASE-ALPHA', withoutOwnField(field)))
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

it('Z15VH cannot select its canonical profile without own field 223', () => {
  const decision = resolveCanonicalRuntimeDecision(msg('Z15', 'S18', 'CASE-ALPHA', withoutOwnField('223')))
  expect(decision.syntaxDecision).toBe('accepted')
  expect(decision.applicationDecision).not.toBe('accepted')
  expect(decision.policy).toBeNull()
  expect(decision.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'CANONICAL_POLICY_RESOLUTION_FAILED', description: expect.stringContaining('prodat_subtype_unknown:missing') }),
  ])) // Profile resolution holds before a typed national 223 rejection is available.
  expect(decision.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'positive')).toBe(false)
  expect(io.rpc).not.toHaveBeenCalled()
})

it('Z15VH cannot borrow a later object’s permission identity', () => {
  const decision = resolveCanonicalRuntimeDecision(msg('Z15', 'S18', '', [
    ...withoutOwnField('325'), ...object('Z15', 'S18', 'SECOND', '2'),
  ]))
  expect(decision.applicationDecision).toBe('rejected')
  const findings = decision.issues.filter(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === '325')
  expect(findings).toHaveLength(1)
  expect(findings[0].prodatDiagnostic).toMatchObject({ occurrence: { lineIndex: 0, lineItemReference: 'CASE-ALPHA' } })
})

for (const change of ['supplier-application', 'suffixed-bgm', 'incompatible-reason'] as const) it(`Z15VH refuses ${change} at canonical admission`, () => {
  const message = msg('Z15', 'S18')
  if (change === 'supplier-application') {
    message.raw_payload = message.raw_payload!.replace('23-DGI-PRODAT', '23-DDQ-PRODAT')
    message.application_reference = '23-DDQ-PRODAT'
  } else if (change === 'suffixed-bgm') message.raw_payload = message.raw_payload!.replace('BGM+Z15+', 'BGM+Z15VH+')
  else message.raw_payload = message.raw_payload!.replace('CAV+S18', 'CAV+Z22')
  const decision = resolveCanonicalRuntimeDecision(message)
  expect(decision.applicationDecision).not.toBe('accepted')
  expect(decision.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'positive')).toBe(false)
  expect(io.rpc).not.toHaveBeenCalled()
})

it('Z15VH retains the manual correlation hold with finite S18 wire history and no outgoing Z18VH', () => {
  const message = msg('Z15', 'S18')
  const historyBody = (code: 'Z13' | 'Z14') => object(code, 'S18').map(part => {
    if (part[0] !== 'DTM' || !Array.isArray(part[1]) || !['90', '91'].includes(part[1][0])) return part
    return ['DTM', [part[1][0], part[1][0] === '90' ? '202609010000' : '202609180000', '203']]
  })
  const requestWire = msg('Z13', 'S18', 'CASE-ALPHA', historyBody('Z13')).raw_payload!
    .replaceAll('+12345:', '+TMPID:').replaceAll('+54321:', '+12345:').replaceAll('+TMPID:', '+54321:')
  const request = prior('Z13', 'CASE-ALPHA', { raw_payload: requestWire })
  const requestDecision = resolveCanonicalRuntimeDecision(request)
  expect(requestDecision.syntaxDecision).toBe('accepted')
  expect(requestDecision.policy).toMatchObject({ code: 'Z13', subtype: 'VH', transactionReasonCode: 'S18', direction: 'outbound', applicationReference: '23-DGI-PRODAT' })
  expect(request.raw_payload).toContain('DTM+91:202609180000:203')
  expect(requestDecision.applicationDecision).toBe('accepted')
  expect(requestDecision.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'PRODAT_REPORTING_UNDETERMINED', severity: 'warning', prodatDiagnostic: expect.objectContaining({ kind: 'local_evidence' }) }),
  ])) // Parse admission accepts local warnings; it grants no persisted-send authority.
  const answer = { ...msg('Z14', 'S18', 'CASE-ALPHA', historyBody('Z14')), id: '00000000-0000-4000-8000-000000000003',
    created_at: '2026-09-19T00:00:00.000Z', message_received_at: '2026-09-19T00:00:00.000Z' }
  const answerDecision = resolveCanonicalRuntimeDecision(answer)
  expect(answerDecision.syntaxDecision).toBe('accepted')
  expect(answerDecision.applicationDecision).toBe('accepted')
  expect(answerDecision.policy).toMatchObject({ code: 'Z14', subtype: 'VH', transactionReasonCode: 'S18', direction: 'inbound' })
  const context = assessPriorPermissionFlow(message, scopeRecords(), [request, answer])
  expect(context).toMatchObject({ kind: 'internal_review', reason: 'state_authority_unavailable' })
  expect(() => assertPriorPermissionContext(message, context, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
  context.kind = 'correlated'
  expect(() => assertPriorPermissionContext(message, context, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
})

it('Z15VH cannot borrow an issued V context or caller-authored correlation', () => {
  const ongoing = msg('Z15', 'S17'), historical = msg('Z15', 'S18')
  const context = assessPriorPermissionFlow(ongoing, scopeRecords(), [prior('Z18')])
  expect(() => assertPriorPermissionContext(ongoing, context, null)).not.toThrow()
  expect(() => assertPriorPermissionContext(historical, context, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
  expect(() => assertPriorPermissionContext(historical, { kind: 'correlated', hasMatchingPriorPermissionFlow: true }, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
  expect(io.rpc).not.toHaveBeenCalled()
})

for (const change of ['wrong-role', 'foreign-owner', 'wrong-direction', 'missing-own-li'] as const) it(`Z15VH holds ${change} in the actual prior consumer`, () => {
  const message = msg('Z15', 'S18'), records = scopeRecords()
  if (change === 'wrong-role') records.roles[0].role_code = 'supplier'
  else if (change === 'foreign-owner') message.company_id = '00000000-0000-4000-8000-000000000099'
  else if (change === 'wrong-direction') message.direction = 'outbound'
  else message.raw_payload = message.raw_payload!.replace('LI:CASE-ALPHA', 'LI:')
  const context = assessPriorPermissionFlow(message, records, [])
  expect(context).toMatchObject({ kind: 'internal_review', reason: change === 'missing-own-li' ? 'wire_conflict' : 'scope_unavailable' })
  expect(() => assertPriorPermissionContext(message, context, null)).toThrow('PRODAT_PERMISSION_PRIOR_REVIEW_REQUIRED')
})

it('the actual permission adapter refuses outward Z15VH before its native RPC', async () => {
  const result = await applyPermissionMarketSource({ actorUserId: prior().id, message: { ...msg('Z15', 'S18'), direction: 'outbound' } })
  expect(result).toMatchObject({ applied: false, reason: 'not_inbound_permission_source' })
  expect(io.rpc).not.toHaveBeenCalled()
})
