// masterplan: ENV-05, AT-ENV-05
import { describe, expect, it } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { validateEdifactEnvelope } from '@/lib/ediel/core/edifactValidation'
import { createEdielExecutionContext, type EdielExecutionContextInput } from '@/lib/ediel/core/executionContext'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'

// Independent physical service-position fixtures; no database/native/market authority.
function wire(flag: string | null, separator = '+', component = ':', release = '?', terminator = "'") {
  const unb = ['UNB', `UNOC${component}3`, `12345${component}ZZ`, `54321${component}ZZ`, `261004${component}1200`, 'OWN-I', '', '23-DDQ-PRODAT']
  if (flag !== null) unb.push('', '', '', flag)
  return `UNA${component}${separator}.${release} ${terminator}` +
    [unb.join(separator), ['UNH', 'OWN-M', `PRODAT${component}D${component}97A${component}UN${component}E2SE6A`].join(separator),
      ['BGM', 'Z01', 'OWN-D', '9', 'NA'].join(separator), ['UNT', '3', 'OWN-M'].join(separator), ['UNZ', '1', 'OWN-I'].join(separator)].join(terminator) + terminator
}

describe('UNB0035 admits only a physical test1 or omitted production flag', () => {
  it.each([null, '1'])('accepts the service marker %j without rewriting original bytes', flag => {
    const raw = wire(flag)
    expect(validateEdifactEnvelope(raw).ok).toBe(true)
    expect(EdifactEnvelopeCodec.decode(raw)).toMatchObject({ rawPayload: raw, testIndicator: flag, environment: flag === '1' ? 'test' : 'production' })
  })
  it.each(['0', '2', '01', '1:0', '1?:0', ' ', '1 ', '\u00a0'])('rejects physical0035=%j rather than interpreting it as production authority', flag => {
    const raw = wire(flag)
    const result = validateEdifactEnvelope(raw)
    expect(result.ok).toBe(false)
    expect(result.issues.map(issue => issue.code)).toContain('unb_test_indicator_invalid')
    expect(EdifactEnvelopeCodec.decode(raw).rawPayload).toBe(raw)
  })
  it('enforces the actual UNA delimiters instead of default-service scanning', () => {
    expect(validateEdifactEnvelope(wire('1', '|', ':', '!', '~')).ok).toBe(true)
    expect(validateEdifactEnvelope(wire('0', '|', ':', '!', '~')).issues.map(issue => issue.code)).toContain('unb_test_indicator_invalid')
  })
  it('passes the invalid physical marker to the real canonical receive validator', () => {
    const result = validateRulebookMessage({ family: 'PRODAT', code: 'Z01', mode: 'parse', direction: 'inbound', environment: 'production',
      applicationReference: '23-DDQ-PRODAT', rawPayload: wire('0') })
    expect(result.blocking).toBe(true)
    expect(result.issues.map(issue => issue.code)).toContain('unb_test_indicator_invalid')
  })
})

// Context is explicit; neither a certification label nor replay time selects live authority.
const context: EdielExecutionContextInput = { companyId: 'tenant', environment: 'production', market: 'electricity', direction: 'outbound',
  family: 'PRODAT', messageCode: 'Z01', transactionSubtype: 'L', businessProcess: 'facility_lookup', businessDate: '2026-10-04',
  senderActorId: 'actor', legalActorEdielId: '12345', senderEdielId: '12345', senderRole: 'supplier', senderSubAddress: null,
  receiverActorId: 'remote', receiverEdielId: '54321', receiverRole: 'grid_owner', receiverSubAddress: null, gridAreaCode: null,
  rulePackId: 'pack', communicationRouteId: 'route', routeProfileId: 'profile', certificateProfileId: null, applicationReference: '23-DDQ-PRODAT', sourceOperationId: 'operation' }
it.each(['TGT-REFERENCE', 'AGT-REFERENCE', 'EDIELPORTAL-REFERENCE'])('never grants production context to %s', applicationReference => {
  expect(() => createEdielExecutionContext({ ...context, applicationReference })).toThrow('applicationReference:test_reference_in_production')
  expect(createEdielExecutionContext({ ...context, environment: 'test', applicationReference })).toMatchObject({ environment: 'test', applicationReference })
})
it('keeps a normal production reference and refuses replay as an implicit environment', () => {
  expect(createEdielExecutionContext(context)).toMatchObject({ environment: 'production', applicationReference: '23-DDQ-PRODAT' })
  expect(() => createEdielExecutionContext({ ...context, environment: 'replay' as never })).toThrow('environment:invalid_environment')
})
