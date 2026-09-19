import { describe, expect, it } from 'vitest'
import { ud } from './fixtures/prodat-ud'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdielMessageRowWithRulebook, validateRulebookMessage, validateRulebookMessageWithRegistry } from '@/lib/ediel/rulebook/validator'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { evaluateProdatDependentConditions } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { parseRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { alphabets, characteristic, line, raw, type Parts } from './fixtures/prodat-register'

// Independent boundary: the existing outbound profile is ONE UNH message
// (segmentSchema.ts PRODAT max=1). First-object validation must not certify a
// later message. P26.A r3 §2.2 p17 separately requires216 in the later Z09E.
const scopeCode = 'PRODAT_DEPENDENT_MESSAGE_SCOPE_UNDETERMINED'
function single(alphabet: readonly string[], body: readonly Parts[] = [line('1', 'A'), ...characteristic('Z13', 'E34'), ud()]): string {
  return raw(body, 'Z06', alphabet)
}
function pair(alphabet: readonly string[], firstFamily = 'PRODAT', secondCode = 'Z09'): string {
  const [, element, , terminator] = alphabet
  const first = tokenizeEdifact(single(alphabet))
  const second = tokenizeEdifact(raw([line('1', 'B'), ...characteristic('Z13', 'E34'), ud()], secondCode, alphabet))
  const start = second.segments.findIndex(s => s.tag === 'UNH')
  const end = second.segments.findIndex(s => s.tag === 'UNT')
  const messages = [
    ...first.segments.filter(s => s.tag !== 'UNZ').map(s => s.tag === 'UNH' ? s.raw.replace('PRODAT', firstFamily) : s.raw),
    ...second.segments.slice(start, end + 1).map(s => s.tag === 'UNH' ? s.raw.replace(`${element}M${element}`, `${element}M2${element}`) : s.tag === 'UNT' ? `${s.raw.slice(0, -1)}M2` : s.raw),
    ['UNZ', '2', 'I'].join(element),
  ]
  return first.una.raw + messages.join(terminator) + terminator
}
function row(payload: string, environment: 'test' | 'production' = 'test', meteringPointId = 'A'): EdielMessageRow {
  const wire = tokenizeEdifact(payload)
  const registerEvidence = createProdatRegisterEvidence({code:'Z06',rawSegments:wire.segments.map(segment=>segment.raw),una:wire.una,
    facts:{market:'electricity',registerObjects:[{meteringPointId,identityAgency:'89',expectedRegisterCount:1,meterReadingsSentInUtilts:false}]}})
  const fixture: Partial<EdielMessageRow> = { message_family:'PRODAT', message_code:'Z06', message_version:'26A', direction:'outbound', environment,
    message_standard:'edifact', application_reference:'23-DDQ-PRODAT', company_id:'synthetic-company', raw_payload:payload, mime_type:'application/EDIFACT',
    // Synthetic in-memory boundary; snapshot/markers may not certify another UNH.
    parsed_payload:{rulebookAllowInvalidSend:true, prodatEngine:{registerEvidence,dependentConditionStatuses:evaluateProdatDependentConditions({messageCode:'Z06',facts:{canonicalSubtype:'E'}}).map(c=>({...c,status:'not_required'}))}},
    validation_report:{systemTestAckSend:{enabled:true,source:'system_test_ack_action'}},
  }
  // This in-memory fixture models only the fields consumed by these boundaries.
  return fixture as EdielMessageRow
}
function hasScope(issues: {scope?: string; code: string; blocking?: boolean; severity: string}[]): boolean {
  return issues.some(i=>i.code === scopeCode && i.scope === 'prodat_dependent' && i.blocking === true && i.severity === 'error')
}

describe('PR330 rereview: never certify an unvalidated later PRODAT message', () => {
  for (const environment of ['test','production'] as const) for (const [index,alphabet] of alphabets.entries()) for (const family of ['PRODAT','UTILTS','APERAK']) {
    it(`${environment}/${index}/${family}: blocks the whole multi-message send before every override`, async () => {
      const payload = pair(alphabet, family)
      const r = row(payload,environment)
      r.message_family = family as EdielMessageRow['message_family']
      const validation = validateEdielMessageRowWithRulebook(r,'send')
      expect(hasScope(validation.issues)).toBe(true)
      expect(validation.blocking).toBe(true)
      expect(validation.ok).toBe(false)
      for (const override of [false,true]) {
        const candidate = {...r, parsed_payload:{...r.parsed_payload,rulebookAllowInvalidSend:override}}
        expect(()=>assertRulebookAllowsSend(candidate)).toThrow(scopeCode)
        expect(()=>assertEdielSendLock(candidate)).toThrow(scopeCode)
      }
      expect(preflightEdielMessageRow(r,'send').issues.some(i=>i.code === `PRODAT_DEPENDENT_PREFLIGHT_${scopeCode}` && i.severity === 'error')).toBe(true)
      // Supplying a parsed cache containing only the first message cannot hide
      // the second raw UNH from either independently callable API.
      const input = {family:'AI_LIST', code:'AI', rawPayload:payload, parsed:parseRulebookMessage(single(alphabet)), mode:'send' as const, environment}
      expect(hasScope(validateRulebookMessage(input).issues)).toBe(true)
      const registry = await validateRulebookMessageWithRegistry(input)
      expect(hasScope(registry.issues)).toBe(true)
      expect(registry.fieldRuleSource).toBe('static')
      expect(registry.rulePackSnapshot).toBeNull()
    })
  }
  for (const [index, alphabet] of alphabets.entries()) {
    it(`${index}: preserves the single-message first-D-scope positive control`, () => {
      const r = row(single(alphabet))
      expect(validateEdielMessageRowWithRulebook(r,'send').issues.filter(i=>i.scope === 'prodat_dependent')).toEqual([])
      expect(()=>assertRulebookAllowsSend(r)).not.toThrow()
      expect(()=>assertEdielSendLock(r)).not.toThrow()
    })
    it(`${index}: even two individually D-valid messages require separate sends`, () => {
      const r = row(pair(alphabet,'PRODAT','Z06'))
      expect(hasScope(validateEdielMessageRowWithRulebook(r,'send').issues)).toBe(true)
      expect(()=>assertRulebookAllowsSend(r)).toThrow(scopeCode)
    })
    it(`${index}: released UNH-looking text is data, not a second message`, () => {
      const [,element,,terminator] = alphabet
      const id = `A${terminator}UNH${element}M2${element}PRODAT`
      const r = row(single(alphabet,[line('1',id),...characteristic('Z13','E34'),ud()]),'test',id)
      expect(tokenizeEdifact(r.raw_payload).segments.filter(s=>s.tag === 'UNH')).toHaveLength(1)
      expect(hasScope(validateEdielMessageRowWithRulebook(r,'send').issues)).toBe(false)
      expect(()=>assertRulebookAllowsSend(r)).not.toThrow()
      expect(()=>assertEdielSendLock(r)).not.toThrow()
    })
  }
  it('does not replace inbound syntax diagnostics with an outbound D-scope claim', () => {
    const r = {...row(pair(alphabets[0])), direction:'inbound' as const}
    expect(preflightEdielMessageRow(r,'parse').issues.some(i=>i.code === `PRODAT_DEPENDENT_PREFLIGHT_${scopeCode}`)).toBe(false)
    expect(()=>assertRulebookAllowsSend(r)).not.toThrow()
  })
})
