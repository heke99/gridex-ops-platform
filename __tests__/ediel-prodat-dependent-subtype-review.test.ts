import { describe, expect, it } from 'vitest'
import { validateEdielMessageRowWithRulebook, validateRulebookMessage, validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { evaluateProdatDependentConditions } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { parseRulebookMessage, parseRulebookListPayload } from '@/lib/ediel/rulebook/messageParser'
import { PRODAT_SOURCE_SUBTYPE_REQUIREMENTS, prodatSourceSubtypeRule, resolveProdatSourceSubtypeRequirement } from '@/lib/ediel/prodat/prodatSubtypeRequirement'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { endUser, alphabets, characteristic, line, raw, type Parts } from './fixtures/prodat-register'

// Independent oracle: P26.A r3 §2.2 p17, Z09E requires field216;
// Z06E does not. A shared E34 reason must not allow metadata to choose Z06.
function message(body: Parts[], code = 'Z09', environment: 'test' | 'production' = 'test', alphabet: readonly string[] = alphabets[0]): EdielMessageRow {
  const payload = raw(body,code,alphabet)
  const row: Partial<EdielMessageRow> = {message_family:'PRODAT',message_code:code,message_version:'26A',direction:'outbound',environment,
    message_standard:'edifact',application_reference:'23-DDQ-PRODAT',
    company_id:'synthetic-company',raw_payload:payload,mime_type:'application/EDIFACT',
    parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{
      dependentConditionStatuses:evaluateProdatDependentConditions({messageCode:code,facts:{canonicalSubtype:'F'}})
        .map(condition=>({...condition,status:'not_required'}))}},
  }
  // Deliberately partial synthetic persistence boundary, not a database row certificate.
  return row as EdielMessageRow
}
const missingValidity = () => [line('1', 'A'), ...characteristic('Z13', 'E34')]
const hasWire216 = (issues: { scope?: string; description: string; severity: string; blocking?: boolean }[]) =>
  issues.some(issue => issue.scope === 'prodat_dependent' && issue.description.includes('Z09:216') && issue.severity === 'error' && issue.blocking)

describe('PR330 review: wire-specific D rules survive mismatched row metadata', () => {
  for (const environment of ['test', 'production'] as const) {
    for (const [index, alphabet] of alphabets.entries()) {
      for (const family of ['PRODAT', 'UTILTS', 'APERAK', 'AI_LIST'] as const) {
        it(`${environment}/${index}/${family}: E34 cannot turn missing Z09:216 into optional Z06E`, () => {
          const row = message(missingValidity(), 'Z09', environment, alphabet)
          row.message_code = 'Z06'
          row.parsed_payload = { rulebookAllowInvalidSend: true, prodatEngine: {
            dependentConditionStatuses: evaluateProdatDependentConditions({ messageCode: 'Z06', facts: { canonicalSubtype: 'E' } })
              .map(condition => ({ ...condition, status: 'not_required' })),
          } }
          row.message_family = family
          expect(hasWire216(validateEdielMessageRowWithRulebook(row, 'send').issues)).toBe(true)
          expect(() => assertRulebookAllowsSend(row)).toThrow(/D-villkor|PRODAT_DEPENDENT/)
          expect(preflightEdielMessageRow(row, 'send').issues.some(issue =>
            issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_') && issue.description.includes('Z09:216'))).toBe(true)
          expect(() => assertEdielSendLock(row)).toThrow(/PRODAT_DEPENDENT_PREFLIGHT_/)
        })
      }
    }
  }
  it('binds the synchronous API despite stale parsed code', () => {
    const payload = raw(missingValidity(), 'Z09')
    const parsed = { ...parseRulebookMessage(payload), code: 'Z06' }
    const result = validateRulebookMessage({ rawPayload: payload, parsed, family: 'PRODAT', code: 'Z06', mode: 'send', environment: 'test' })
    expect(hasWire216(result.issues)).toBe(true)
  })
  it('binds the registry API before evidence lookup despite stale parsed code', async () => {
    const payload = raw(missingValidity(), 'Z09')
    const parsed = { ...parseRulebookMessage(payload), code: 'Z06' }
    const result = await validateRulebookMessageWithRegistry({ rawPayload: payload, parsed, family: 'PRODAT', code: 'Z06', mode: 'send', environment: 'test' })
    expect(hasWire216(result.issues)).toBe(true)
    expect(result.fieldRuleSource).toBe('static')
  })
  it.each(alphabets)('keeps a real Z06E optional, rather than inventing a Z09:216 rule from metadata: %j', (...alphabet) => {
    const row = message([...missingValidity(), endUser()], 'Z06', 'test', alphabet)
    row.message_code = 'Z09'
    const result = validateEdielMessageRowWithRulebook(row, 'send')
    expect(result.issues.filter(issue => issue.scope === 'prodat_dependent')).toEqual([])
    expect(() => assertRulebookAllowsSend(row)).not.toThrow()
    expect(() => assertEdielSendLock(row)).not.toThrow()
  })
  it('cannot use the system-test ACK marker to bypass Z09:216', () => {
    const row = message(missingValidity(), 'Z09')
    row.message_code = 'Z06'
    row.parsed_payload = { ...row.parsed_payload, systemTestAckSend: true }
    expect(() => assertRulebookAllowsSend(row)).toThrow(/D-villkor|PRODAT_DEPENDENT/)
    expect(() => assertEdielSendLock(row)).toThrow(/PRODAT_DEPENDENT_PREFLIGHT_/)
  })
  it('leaves syntax-only inbound preflight without outbound D enforcement', () => {
    const row = { ...message(missingValidity()), direction: 'inbound' as const }
    expect(preflightEdielMessageRow(row, 'parse').issues.filter(issue => issue.code.startsWith('PRODAT_DEPENDENT_PREFLIGHT_'))).toEqual([])
  })
})

describe('source authority returned by the new D registry is immutable', () => {
  it('freezes the array, each source row, and every nested outcome', () => {
    expect(Object.isFrozen(PRODAT_SOURCE_SUBTYPE_REQUIREMENTS)).toBe(true)
    for (const source of PRODAT_SOURCE_SUBTYPE_REQUIREMENTS) {
      expect(Object.isFrozen(source)).toBe(true)
      expect(Object.isFrozen(source.outcomes)).toBe(true)
      expect(prodatSourceSubtypeRule(source.messageCode, source.fieldNumber)).toBe(source)
    }
  })
  it('rejects attempted changes while preserving the normative required outcome', () => {
    const source = prodatSourceSubtypeRule('Z09', '216')!
    const before = source.outcomes.E
    const changed = Reflect.set(source.outcomes, 'E', 'optional')
    // Restore the red-baseline module to keep the reproduction isolated.
    if (changed) Reflect.set(source.outcomes, 'E', before)
    expect(changed).toBe(false)
    expect(resolveProdatSourceSubtypeRequirement({ messageCode: 'Z09', fieldNumber: '216', subtype: 'E' })).toBe('required')
  })
})

it('preserves an unrelated structured/list payload with literal question marks', () => {
  const payload = 'Företag;Kontakt\nA;Varför?'
  expect(() => validateRulebookMessage({ rawPayload: payload, parsed: parseRulebookListPayload(payload),
    family: 'AI_LIST', code: 'AI', mode: 'parse', direction: 'inbound' })).not.toThrow()
})
