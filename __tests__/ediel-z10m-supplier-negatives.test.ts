// masterplan: AT-Z10M-SUPPLIER
// Prohibited Z10M effects: wrong market/application role, wrong direction,
// missing required (R) and dependent (D) fields, bad correlation. Each case is
// executed through the real validators/decision engine; none may yield a
// positive APERAK or a determined independent meter-change fact.
import { expect, it } from 'vitest'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { decideProdatAperak } from '@/lib/ediel/decisionEngine'
import { evaluateProdatMeterChange } from '@/lib/ediel/rulebook/prodatMeterChangePolicy'
import { meterChangeSendIssue } from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { characteristic, line, raw, type Parts } from './fixtures/prodat-register'
import { changeBody, changeFields, changeRaw, meterChange } from './fixtures/prodat-meter-change'

// Complete supplier-side Z10 wire (two registers, E58, old/new meter, LI).
function wire(drop: readonly string[] = []): string {
  const body: Parts[] = [
    ['NAD', 'FR', ['7359991111111', '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    ['NAD', 'DO', ['7359992222222', '160', 'SVK'], '', '', '', '', '', '', 'SE'],
    line('1', '735999100000000001', '1', '9'), ['DTM', ['157', '202610200000', '203']], ['DTM', ['354', '15', '806']],
    ...characteristic('Z13', 'E58'), ...characteristic('Z04', 'Z04'), ...characteristic('Z12', 'D', 3),
    ...characteristic('Z15', 'Z32'), ...characteristic('Z14', 'L639Q', 3),
    ...characteristic('Z16', '101', 3), ...characteristic('Z02', '1', 3), ...characteristic('Z05', '6', 3),
    ['RFF', ['MG', 'NEW-METER']], ['RFF', ['Z02', 'METER-1']], ['RFF', ['Z05', 'ABC']], ['RFF', ['LI', 'M-REF-1']],
    ['NAD', 'Z02', ['7359993333333', '160', 'SVK']],
    line('2', '735999100000000001', '2', '9'), ...characteristic('Z16', '102', 3), ...characteristic('Z02', '1', 3), ...characteristic('Z05', '6', 3),
  ]
  const kept = body.filter(part => !drop.some(marker => JSON.stringify(part).includes(marker)))
  return raw(kept, 'Z10').replace('+S+R+', '+7359991111111:14+7359992222222:14+').replace('BGM+Z10+D+9+AB', 'BGM+Z10+M-REF-1+9+AB')
}
const blocking = (rawPayload: string, direction: 'inbound' | 'outbound' = 'inbound') =>
  validateRulebookMessage({ family: 'PRODAT', code: 'Z10', rawPayload, mode: 'parse', direction }).issues
    .filter(issue => issue.blocking).map(issue => `${issue.code}@${issue.fieldPath ?? ''}`)
const baseline = () => new Set(blocking(wire()))

it('the complete supplier wire carries 23-DDQ-PRODAT, BGM Z10 and 223=E58 with a positive structural APERAK decision', () => {
  const rawPayload = wire()
  expect(rawPayload).toContain('23-DDQ-PRODAT')
  expect(rawPayload).toContain("BGM+Z10+M-REF-1")
  expect(rawPayload).toContain("CCI++Z13'CAV+E58'")
  expect(decideProdatAperak({ rawPayload, testKind: 'production' })).toMatchObject({ kind: 'ack', ackFamily: 'APERAK', outcome: 'positive' })
  // Only register-level dependent conditions remain undetermined without the native registry.
  expect([...baseline()].every(code => code.startsWith('PRODAT_DEPENDENT_CONDITION_UNDETERMINED@'))).toBe(true)
})

it.each(['23-DGI-PRODAT', '23-DDQ-UTILTS'])('wrong market/application role %s is refused by the canonical policy', reference => {
  expect(blocking(wire().replace('23-DDQ-PRODAT', reference))).toContain('CANONICAL_POLICY_VALIDATION_FAILED@')
})

it.each([
  ['wrong 223 reason', (w: string) => w.replace("CAV+E58'", "CAV+E99'")],
  ['wrong BGM function for E58', (w: string) => w.replace('BGM+Z10', 'BGM+Z04')],
])('%s produces a negative APERAK naming field 223', (_name, mutate) => {
  const rawPayload = mutate(wire())
  const decision = decideProdatAperak({ rawPayload, testKind: 'production' })
  expect(decision).toMatchObject({ kind: 'ack', ackFamily: 'APERAK', outcome: 'negative' })
  expect(decision.applicationErrors?.map(e => e.fieldCode)).toContain('223')
  expect(blocking(rawPayload)).toContain('PRODAT_TRANSACTION_REASON_INVALID@CCI++Z13/CAV')
})

it('missing 223 entirely is a negative APERAK, never positive', () => {
  const decision = decideProdatAperak({ rawPayload: wire(['"E58"']), testKind: 'production' })
  expect(decision.outcome).toBe('negative')
  expect(decision.applicationErrors?.map(e => e.fieldCode)).toContain('223')
})

it.each([
  ['DTM+157 boundary time', '"157"', 'DTM+157'],
  ['RFF+LI correlation', '"LI"', 'RFF+LI'],
  ['RFF+Z02 old meter', '"Z02","METER-1"', 'RFF+Z02'],
  ['RFF+MG new meter', '"MG"', 'RFF+MG'],
  ['NAD+FR grid owner', '"FR"', 'NAD+FR/C082/3039 + NAD+FR/3207'],
])('missing required %s is a new blocking canonical failure', (_name, marker, fieldPath) => {
  const issues = blocking(wire([marker]))
  expect(issues).toContain(`FIELD_MATRIX_REQUIRED_FIELD_MISSING@${fieldPath}`)
  expect(baseline().has(`FIELD_MATRIX_REQUIRED_FIELD_MISSING@${fieldPath}`)).toBe(false)
})

function policy(rawPayload: string, direction: 'inbound' | 'outbound', facts?: ReturnType<typeof meterChange>) {
  const parsed = tokenizeEdifact(rawPayload)
  return evaluateProdatMeterChange({ code: 'Z10', rawSegments: parsed.segments.map(t => t.raw), una: parsed.una, direction, facts: facts ? { meterChange: facts } : undefined })
}

it.each([['254', 'CCI++Z15/CAV', [...characteristic('Z14', 'L639Q', 3)]], ['242', 'CCI++Z14/CAV', [...characteristic('Z15', 'Z32')]]] as const)(
  'missing dependent field %s when the independent fact requires it is a blocking REQUIRED failure', (field, fieldPath, fields) => {
    const result = policy(changeRaw(changeBody([...fields])), 'inbound', meterChange(true))
    expect(result.statuses.get(field)).toBe('required')
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PRODAT_METER_CHANGE_REQUIRED', fieldPath, blocking: true })]))
  })

it('bad LI/meter correlation discards the independent fact and leaves both dependent fields undetermined', () => {
  const facts = meterChange(true)
  const mismatched = { ...facts, objects: [{ ...facts.objects[0], li: 'OTHER-EVENT' }] }
  for (const direction of ['inbound', 'outbound'] as const) {
    const result = policy(changeRaw(changeBody(changeFields())), direction, mismatched)
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PRODAT_METER_CHANGE_CONTEXT_MISMATCH', blocking: direction === 'outbound' })]))
    expect(result.statuses.get('254')).toBe('undetermined')
    expect(result.statuses.get('242')).toBe('undetermined')
  }
  const swapped = { ...facts, objects: [{ ...facts.objects[0], oldMeter: { ...facts.objects[0].oldMeter, number: 'NEW-A' }, newMeter: { ...facts.objects[0].newMeter, number: 'OLD-A' } }] }
  expect(policy(changeRaw(changeBody(changeFields())), 'outbound', swapped).issues.map(i => i.code)).toContain('PRODAT_METER_CHANGE_CONTEXT_MISMATCH')
  // The correctly correlated fact is accepted for the same wire.
  expect(policy(changeRaw(changeBody(changeFields())), 'inbound', facts).issues.filter(i => i.blocking)).toEqual([])
})

it('wrong direction: the supplier never sends Z10 (grid-owner message) outbound', () => {
  const rawPayload = wire()
  expect(meterChangeSendIssue({ message_family: 'PRODAT', message_code: 'Z10', raw_payload: rawPayload }))
    .toMatchObject({ code: 'PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED', blocking: true })
  expect(meterChangeSendIssue({ message_family: 'PRODAT', message_code: null, raw_payload: rawPayload }))
    .toMatchObject({ code: 'PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED', blocking: true })
  // Outbound evaluation without independent facts can never determine the fields.
  expect(policy(rawPayload, 'outbound').issues.filter(i => i.blocking).map(i => i.code)).toContain('PRODAT_METER_CHANGE_UNDETERMINED')
})
