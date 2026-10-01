import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { prepareEdielBusinessExpectationPlan } from '@/lib/ediel/businessExpectations'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { source, head, own } from './fixtures/prodat-identity'
import { raw } from './fixtures/prodat-register'
import { permissionAckMessage } from './fixtures/prodat-permission-ack'
import type { EdielMessageRow } from '@/lib/ediel/types'
const policy = (code: string, subtype: string) => resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code, subtypeOrReasonCode: subtype, direction: 'outbound', referenceDate: '2026-09-30', mode: 'catalog_evidence' })
describe('source owned business expectation preparation', () => {
  it('uses canonical Z02 timing as an independent uncertain sender watch', () => {
    const m = { ...source(raw([...head(), ...own('1', '735123456789012345', 'OWN')], 'Z01')), direction: 'outbound' } as EdielMessageRow
    const plan = prepareEdielBusinessExpectationPlan(m, policy('Z01', 'L'))
    expect(plan).toMatchObject({ expectedCode: 'Z02', expectedSubtypes: ['L'], offset: 30, unit: 'minutes', timerRuleId: 'TM-Z02', remoteReceiptKnown: false, anchor: 'actual_accepted_smtp_observed_at', timerKind: 'internal_sender_watch' })
    expect(Object.isFrozen(plan)).toBe(true)
    expect(plan?.policy.referenceDate).toBe('2026-09-30')
  })
  it('derives the21 calendar day watch from canonical Z14 rules without treating SMTP as remote receipt', () => {
    const m = { ...permissionAckMessage('Z13'), direction: 'outbound' } as EdielMessageRow
    expect(prepareEdielBusinessExpectationPlan(m, policy('Z13', 'V'))).toMatchObject({ expectedCode: 'Z14', expectedSubtypes: ['V', 'N'], offset: 21, unit: 'calendar_days', timerRuleId: 'TM-ESCO21', remoteReceiptKnown: false })
  })
  it('expects applicable Z15 without inventing a numeric Z18 deadline', () => {
    const m = { ...permissionAckMessage('Z18'), direction: 'outbound' } as EdielMessageRow
    expect(prepareEdielBusinessExpectationPlan(m, policy('Z18', 'V'))).toMatchObject({ expectedCode: 'Z15', expectedSubtypes: ['V'], offset: null, unit: null, timerRuleId: null, timerKind: 'untimed_business_response' })
  })
  it('rejects a local declared family/code policy that contradicts the physical source', () => {
    const m = { ...permissionAckMessage('Z13'), direction: 'outbound', message_code: 'Z18' } as EdielMessageRow
    expect(() => prepareEdielBusinessExpectationPlan(m, policy('Z18', 'V'))).toThrow(/policy_source_mismatch/)
  })
  it('holds a manually supplied multi-message expectation before provider entry', () => {
    const m = { ...permissionAckMessage('Z13'), direction: 'outbound' } as EdielMessageRow
    m.raw_payload = m.raw_payload!.replace(/UNZ[^']*'/, "UNH+SECOND+PRODAT:D:97A:UN:E2SE6A'BGM+Z18+SECOND-DOC'UNT+3+SECOND'UNZ+2+I'")
    expect(() => prepareEdielBusinessExpectationPlan(m, policy('Z13', 'V'))).toThrow(/multiple_message_scope_not_supported/)
  })
})
