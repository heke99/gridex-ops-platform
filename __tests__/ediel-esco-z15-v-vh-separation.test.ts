// masterplan: SC-023, AT-Z15V-ESCO, AT-Z15VH-ESCO
import { describe, expect, it } from 'vitest'
import { applyEscoZ15Termination, type EscoRegister, type EscoZ15Input } from '@/lib/ediel/permissions/escoZ15FlowSeparation'

const A = 'tenant-a', B = 'tenant-b', OBJ = '735999999999999991', PERM = 'Z09-PERM-1'
const register = (): EscoRegister => Object.freeze({
  flows: Object.freeze([
    Object.freeze({ flowId: 'v-a', companyId: A, permissionId: PERM, objectId: OBJ, mode: 'V' as const, state: 'receiving_utilts_e66' as const, historyJob: null }),
    Object.freeze({ flowId: 'vh-a', companyId: A, permissionId: PERM, objectId: OBJ, mode: 'VH' as const, state: 'receiving_utilts_e66' as const, historyJob: Object.freeze({ status: 'open' as const, coverageReview: 'not_required' as const }) }),
    Object.freeze({ flowId: 'v-b', companyId: B, permissionId: 'Z09-PERM-B', objectId: OBJ, mode: 'V' as const, state: 'receiving_utilts_e66' as const, historyJob: null }),
  ]),
  ddqDeliveries: Object.freeze([Object.freeze({ companyId: A, objectId: OBJ, status: 'active' as const }), Object.freeze({ companyId: B, objectId: OBJ, status: 'active' as const })]),
})
const z15 = (field223: 'S17' | 'S18', extra: Partial<EscoZ15Input> = {}): EscoZ15Input => ({
  receivingCompanyId: A, direction: 'inbound', process: '23-DGI-PRODAT', bgm: 'Z15', field223, senderRole: 'DSO', receiverRole: 'ESCO',
  datum164: '2026-10-31T23:00:00Z', idZ09: PERM, reasonCode: 'B77', objectId: OBJ, ...extra,
})
const byId = (r: EscoRegister, id: string) => r.flows.find(f => f.flowId === id)!

describe('SC-023 / AT-Z15VH-ESCO: Z15 S18 ends the history job only', () => {
  it('completes VH history, requests coverage review, keeps V and DDQ running, no automatic Z13', () => {
    const before = register()
    const result = applyEscoZ15Termination(before, z15('S18'))
    expect(result).toMatchObject({ executed: true, endedFlowId: 'vh-a', mode: 'VH', acknowledgements: ['CONTRL', 'APERAK'], automaticZ13: false })
    expect(byId(result.register, 'vh-a')).toMatchObject({ state: 'terminated_after_z15', historyJob: { status: 'completed', coverageReview: 'pending' } })
    expect(byId(result.register, 'v-a')).toBe(byId(before, 'v-a'))
    expect(byId(result.register, 'v-a').state).toBe('receiving_utilts_e66')
    expect(byId(result.register, 'v-b')).toBe(byId(before, 'v-b'))
    expect(result.register.ddqDeliveries).toEqual(before.ddqDeliveries)
    expect(result.register.ddqDeliveries.every(d => d.status === 'active')).toBe(true)
  })
  it('V remains usable after VH ended: a later S17 still ends V', () => {
    const afterVh = applyEscoZ15Termination(register(), z15('S18')).register
    const result = applyEscoZ15Termination(afterVh, z15('S17'))
    expect(result.executed).toBe(true)
    expect(byId(result.register, 'v-a').state).toBe('terminated_after_z15')
  })
  it('a second S18 for an already completed history job is not executed', () => {
    const afterVh = applyEscoZ15Termination(register(), z15('S18')).register
    expect(applyEscoZ15Termination(afterVh, z15('S18'))).toMatchObject({ executed: false, reason: 'z15vh_history_job_not_open', acknowledgements: [] })
  })
})

describe('AT-Z15V-ESCO: Z15 S17 ends the continuous flow only', () => {
  it('ends V; VH history job and DDQ delivery are untouched; no automatic Z13', () => {
    const before = register()
    const result = applyEscoZ15Termination(before, z15('S17', { reasonCode: 'B79' }))
    expect(result).toMatchObject({ executed: true, endedFlowId: 'v-a', mode: 'V', acknowledgements: ['CONTRL', 'APERAK'], automaticZ13: false })
    expect(byId(result.register, 'v-a').state).toBe('z15_b79_customer_revocation')
    expect(byId(result.register, 'vh-a')).toBe(byId(before, 'vh-a'))
    expect(byId(result.register, 'vh-a').historyJob).toEqual({ status: 'open', coverageReview: 'not_required' })
    expect(result.register.ddqDeliveries).toEqual(before.ddqDeliveries)
  })
})

describe('AT-Z15V-ESCO / AT-Z15VH-ESCO prohibited: nothing is executed', () => {
  it.each([
    ['wrong direction', { direction: 'outbound' as const }, 'z15_wrong_direction'],
    ['wrong process', { process: '23-DGI-UTILTS' }, 'z15_wrong_message'],
    ['wrong BGM', { bgm: 'Z14' }, 'z15_wrong_message'],
    ['wrong sender role', { senderRole: 'ESCO' }, 'z15_wrong_role'],
    ['wrong receiver role', { receiverRole: 'SUPPLIER' }, 'z15_wrong_role'],
    ['unqualified field 223', { field223: 'S19' as never }, 'z15_field223_unqualified'],
    ['missing Datum164', { datum164: null }, 'z15_required_field_missing:datum164'],
    ['invalid Datum164', { datum164: 'not-a-date' }, 'z15_required_field_missing:datum164'],
    ['missing idZ09', { idZ09: null }, 'z15_required_field_missing:idZ09'],
    ['missing reason', { reasonCode: null }, 'z15_required_field_missing:reason'],
    ['missing object', { objectId: null }, 'z15_required_field_missing:object'],
    ['unknown reason', { reasonCode: 'A74' }, 'z15_termination_reason_unqualified'],
    ['bad correlation (permission)', { idZ09: 'UNKNOWN' }, 'z15_correlation_unmatched'],
    ['bad correlation (object)', { objectId: '735000000000000000' }, 'z15_correlation_unmatched'],
    ['another tenant\'s flow', { idZ09: 'Z09-PERM-B' }, 'z15_other_tenant_flow'],
  ])('%s', (_label, extra, reason) => {
    for (const mode of ['S17', 'S18'] as const) {
      const before = register()
      const result = applyEscoZ15Termination(before, z15(mode, extra))
      expect(result).toMatchObject({ executed: false, reason, acknowledgements: [], automaticZ13: false })
      expect(result.register).toBe(before)
    }
  })
  it('tenant B receiving a Z15 for tenant A\'s permission cannot end tenant A\'s flow', () => {
    const before = register()
    const result = applyEscoZ15Termination(before, z15('S17', { receivingCompanyId: B }))
    expect(result).toMatchObject({ executed: false, reason: 'z15_other_tenant_flow' })
    expect(result.register).toBe(before)
  })
  it('S18 against a permission with only a V flow is a mode mismatch, not a V termination', () => {
    const vOnly: EscoRegister = { ...register(), flows: register().flows.filter(f => f.flowId !== 'vh-a') }
    expect(applyEscoZ15Termination(vOnly, z15('S18'))).toMatchObject({ executed: false, reason: 'z15_mode_mismatch' })
  })
  it('S17 against a permission with only a VH flow does not end the history job', () => {
    const vhOnly: EscoRegister = { ...register(), flows: register().flows.filter(f => f.flowId !== 'v-a') }
    const result = applyEscoZ15Termination(vhOnly, z15('S17'))
    expect(result).toMatchObject({ executed: false, reason: 'z15_mode_mismatch' })
    expect(result.register).toBe(vhOnly)
  })
  it('duplicate same-mode flows are ambiguous and not executed', () => {
    const base = register()
    const dup: EscoRegister = { ...base, flows: [...base.flows, { ...base.flows[0], flowId: 'v-a2' }] }
    expect(applyEscoZ15Termination(dup, z15('S17'))).toMatchObject({ executed: false, reason: 'z15_correlation_ambiguous' })
  })
})
