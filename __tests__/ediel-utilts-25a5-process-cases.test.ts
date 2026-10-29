import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn(() => { throw new Error('unexpected_database_io') }) } }))
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { energyHandoffMessage, observationHandoffMessage } from './helpers/utiltsObservationHandoff'
import { s02PlanningFixture, s02PlanningPair } from './helpers/utiltsS02PlanningFixture'

const current = (code: string, reference: string) => resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: code,
  direction: 'inbound', referenceDate: '2026-10-20', applicationReference: reference })
function recount(lines: string[]): string {
  const unh = lines.findIndex(line => line.startsWith('UNH+')), unt = lines.findIndex(line => line.startsWith('UNT+'))
  lines[unt] = `UNT+${unt - unh + 1}+1'`
  return lines.join('\n')
}
describe('Swedish U5 receiving behavior, pure wire/runtime boundary', () => {
  it('keeps actual supplied-point identity checks active under U5', () => {
    const message = s02PlanningFixture({ company: 'synthetic-u5', transactions: s02PlanningPair('clean', true) })
    message.raw_payload = message.raw_payload!.replace('735999260731000007::9', '735999260731000008::9')
    const policy = current('S02', '23-DDQ-S02-S')
    expect(policy.guide.guideRevision).toBe('25-A-5')
    const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy: policy })
    expect(runtime.validation.issues).toContainEqual(expect.objectContaining({ code: 'UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID', referenceNumber: 'S02-OWN' }))
    expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-OWN')?.disposition).toBe('guide_rejected')
    expect(runtime.transactionDispositions.find(row => row.transactionId === 'S02-SIBLING')?.disposition).toBe('accepted')
  })
  it('keeps the conditional supplied regulating-object check active for a U5 E73 request', () => {
    const message = energyHandoffMessage('2026-10-20', 'synthetic-u5')
    const lines = message.raw_payload!.split('\n').filter(line => !/^(LIN|MEA|SEQ|QTY|CCI|CAV)\+/.test(line)
      && !line.startsWith('DTM+597') && !line.startsWith('DTM+354') && !line.startsWith('STS+7++21'))
    message.raw_payload = recount(lines.map(line => line.replace('BGM+E66', 'BGM+E73')
      .replace('LOC+172+735999260731000007::9', 'LOC+175+735999260731000008::9')))
    message.message_code = 'E73'
    const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy: current('E73', '23-DDQ-E66-T') })
    expect(runtime.validation.syntaxOk).toBe(true)
    expect(runtime.validation.issues).toContainEqual(expect.objectContaining({
      code: 'UTILTS_REGULATING_OBJECT_GS1_CHECK_DIGIT_INVALID', aperakFieldCode: '533' }))
    expect(runtime.transactionDispositions[0]).toMatchObject({ disposition: 'guide_rejected', responseType: 'negative_aperak' })
  })
  it('preserves a known zero energy observation rather than turning it into missing data', () => {
    const message = energyHandoffMessage('2026-10-20', 'synthetic-u5')
    message.raw_payload = message.raw_payload!.replace('QTY+136:500', 'QTY+136:0')
    const policy = current('E66', '23-DDQ-E66-T')
    expect(policy.guide.guideRevision).toBe('25-A-5')
    const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy: policy })
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    expect(runtime.facts.transactions[0].quantities).toContainEqual(expect.objectContaining({ qualifier: '136', value: 0 }))
  })
  it('accepts source-shaped partial monthly periods without demanding a complete calendar month', () => {
    const message = observationHandoffMessage('2026-10-20', 'synthetic-u5')
    message.raw_payload = message.raw_payload!.replaceAll('202608010000', '202607180000')
    const policy = current('E66', '23-DDQ-E66-S')
    expect(policy.guide.guideRevision).toBe('25-A-5')
    const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy: policy })
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    expect(runtime.facts.transactions[0].deliveryPeriodRaw).toBe('202607010000202607180000')
  })
  it('accepts all96 known zero quarters for the source disconnect example’s intervening day', () => {
    // U5 §3.6.13 pp42–43 example1(b): Apr18 00 to Apr19 00, known zero.
    // This exercises the recipient, not a DSO event/measurement producer.
    const message = energyHandoffMessage('2026-10-20', 'synthetic-u5')
    const lines = message.raw_payload!.split('\n'), seq = lines.findIndex(line => line.startsWith('SEQ+'))
    const body = lines.slice(0, seq).map(line => line
      .replace('202607010000202607010015:719', '202604180000202604190000:719')
      .replace('DTM+597:202607010020:203', 'DTM+597:202604190000:203'))
    for (let quarter = 0; quarter < 96; quarter++) {
      const stamp = new Date(Date.UTC(2026, 3, 18, 0, quarter * 15)).toISOString().replace(/[-:T]/g, '').slice(0, 12)
      body.push(`SEQ++${quarter + 1}'`, "QTY+136:0'", `DTM+597:${stamp}:203'`, "STS+7++21::260'")
    }
    body.push("UNT+0+1'", lines[lines.length - 1])
    message.raw_payload = recount(body)
    const runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy: current('E66', '23-DDQ-E66-T') })
    expect(runtime.validation.ok, JSON.stringify(runtime.validation.issues)).toBe(true)
    expect(runtime.facts.transactions[0].deliveryPeriodRaw).toBe('202604180000202604190000')
    expect(runtime.facts.transactions[0].quantities).toHaveLength(96)
    expect(runtime.facts.transactions[0].quantities.every(value => value.value === 0)).toBe(true)
  })
  it('does not turn the U5 DGI energy-sharing description into operational authorization', () => {
    const message = energyHandoffMessage('2026-10-20', 'synthetic-u5')
    message.raw_payload = message.raw_payload!.replace('NAD+DDQ', 'NAD+DGI')
    message.parsed_payload = { requestedCapability: 'energy_sharing' }
    expect(() => runUtiltsRuntimeForMessage(message)).toThrow('ediel_energy_sharing_activation_held')
  })
})
