import { expect, it } from 'vitest'
import { validateProdatMeterChange } from '@/lib/ediel/rulebook/prodatMeterChangePolicy'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { decideProdatAperak } from '@/lib/ediel/decisionEngine'
import { preflightEdielPayload } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { changeRaw, changeBody, meterChange } from './fixtures/prodat-meter-change'
import { alphabets, characteristic, type Parts } from './fixtures/prodat-register'

function policy(rawPayload: string, direction: 'inbound' | 'outbound', facts?: ReturnType<typeof meterChange>) {
  const wire = tokenizeEdifact(rawPayload)
  return validateProdatMeterChange({ code: 'Z10', rawSegments: wire.segments.map(t => t.raw), una: wire.una, direction, facts: facts ? { meterChange: facts } : undefined })
}
const selected242 = (issues: ReturnType<typeof policy>) => issues.filter(i => i.fieldPath === 'CCI++Z14/CAV' && (i.blocking || i.severity === 'error'))

it.each(alphabets)('U attributes fourth242 independently from fifth506 (%s)', (...alphabet) => {
  for (const value of ['', 'L639Q', 'INVALID']) {
    const fields: Parts[] = [...characteristic('Z15', 'Z32'), ['CCI', '', 'Z14'], ['CAV', ['', '', '', value, '8716867000030']]]
    const rawPayload = changeRaw(changeBody(fields), alphabet)
    expect(selected242(policy(rawPayload, 'inbound')).length > 0).toBe(value === 'INVALID')
    const result = decideProdatAperak({ rawPayload, testKind: 'production' })
    expect(result.applicationErrors?.some(e => e.fieldCode === '242' && e.ercCode === '42')).toBe(value === 'INVALID')
    const canonical = validateRulebookMessage({ family: 'PRODAT', code: 'Z10', rawPayload, mode: 'parse', direction: 'inbound' })
    expect(canonical.issues.some(i => i.title === 'energy_product får inte skickas' && i.code === 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT')).toBe(true)
  }
})
it('independently required242 remains missing beside actual506', () => {
  const rawPayload = changeRaw(changeBody([...characteristic('Z15', 'Z32'), ...characteristic('Z14', '8716867000030', 4)]))
  expect(selected242(policy(rawPayload, 'inbound', meterChange(true))).map(i => i.code)).toContain('PRODAT_METER_CHANGE_REQUIRED')
})
it.each([true, false])('outgoing unused3055 is rejected for both selected fields, changed=%s', changed => {
  for (const field of ['254', '242']) {
    const fields: Parts[] = field === '254'
      ? [['CCI', '', 'Z15'], ['CAV', [changed ? 'Z32' : 'Z31', '', 'BAD']], ...characteristic('Z14', changed ? 'L639Q' : 'L917', 3)]
      : [...characteristic('Z15', changed ? 'Z32' : 'Z31'), ['CCI', '', 'Z14'], ['CAV', ['', '', 'BAD', changed ? 'L639Q' : 'L917']]]
    const rawPayload = changeRaw(changeBody(fields))
    expect(policy(rawPayload, 'outbound', meterChange(changed)).some(i => i.code === 'PRODAT_METER_CHANGE_FIELD_INVALID' && i.fieldPath === (field === '254' ? 'CCI++Z15/CAV' : 'CCI++Z14/CAV'))).toBe(true)
    if (!changed) expect(policy(rawPayload, 'inbound', meterChange()).filter(i => i.blocking || i.severity === 'error')).toEqual([])
  }
})
it.each(['xml', 'ai_list'] as const)('raw Z10 overrides misleading %s send metadata across UNA alphabets', messageStandard => {
  for (const alphabet of alphabets) {
    const result = preflightEdielPayload({ rawPayload: changeRaw(changeBody(), alphabet), mode: 'send', messageStandard })
    expect(result.issues.map(i => i.code)).toContain('PRODAT_DEPENDENT_PREFLIGHT_PRODAT_METER_CHANGE_SOURCE_UNQUALIFIED')
    expect(result.blocking).toBe(true)
  }
})
it.each([
  { messageStandard: 'xml' as const, rawPayload: '<Document><Type>Schedule</Type></Document>', family: 'NBS_XML' },
  { messageStandard: 'ai_list' as const, rawPayload: 'Ver20140401;A;B\n1;2;3', family: 'AI_LIST' },
])('valid non-Z10 $messageStandard retains its routing', ({ family, ...input }) => {
  const result = preflightEdielPayload({ ...input, mode: 'send' })
  expect(result.family).toBe(family)
  expect(result.blocking).toBe(false)
  expect(result.issues.some(i => i.code.includes('METER_CHANGE'))).toBe(false)
})
