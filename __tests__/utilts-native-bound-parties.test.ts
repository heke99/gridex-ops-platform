import { describe, expect, it } from 'vitest'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { assertUtiltsConsumptionPartiesBound } from '../scripts/helpers/utiltsConsumptionBoundParties'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'

const parties = { ediel: '70042', issuer: '80042' }
const sourceId = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc'
const refusal = 'native_consumption_parties_unbound'

function boundFixture(id = sourceId): string {
  return energyHandoffMessage().raw_payload!
    .replace('?+0200:406', '?+0100:406')
    .replaceAll('260831181101', id.slice(0, 12).replaceAll('-', ''))
    .replace('+21660:ZZ+', `+${parties.ediel}:ZZ+`)
    .replace('NAD+MR+21660:SVK:260', `NAD+MR+${parties.ediel}:SVK:260`)
    .replace('+91100:ZZ+', `+${parties.issuer}:ZZ+`)
    .replace('NAD+MS+91100:SVK:260', `NAD+MS+${parties.issuer}:SVK:260`)
}

const slots = [
  { name: 'UNB sender', wire: '+80042:ZZ+', wrong: '+89999:ZZ+', unbound: '+91100:ZZ+', missing: '+:ZZ+' },
  { name: 'UNB receiver', wire: '+70042:ZZ+', wrong: '+79999:ZZ+', unbound: '+21660:ZZ+', missing: '+:ZZ+' },
  { name: 'NAD MS', wire: 'NAD+MS+80042:SVK:260', wrong: 'NAD+MS+89999:SVK:260', unbound: 'NAD+MS+91100:SVK:260', missing: 'NAD+MS+:SVK:260' },
  { name: 'NAD MR', wire: 'NAD+MR+70042:SVK:260', wrong: 'NAD+MR+79999:SVK:260', unbound: 'NAD+MR+21660:SVK:260', missing: 'NAD+MR+:SVK:260' },
]

describe('native UTILTS fixture bound parties', () => {
  it('accepts the actual energy fixture with its own seeded parties', () => {
    expect(() => assertUtiltsConsumptionPartiesBound(boundFixture(), parties)).not.toThrow()
  })

  it.each([
    { digits: '21660', id: 'a21660aa-bbbb-4000-8000-cccccccccccc' },
    { digits: '91100', id: 'a91100aa-bbbb-4000-8000-cccccccccccc' },
  ])('accepts correctly bound parties when UUID reference contains $digits', ({ digits, id }) => {
    expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    const raw = boundFixture(id)
    const wire = tokenizeEdifact(raw)
    const unb = wire.segments.find(segment => segment.tag === 'UNB')
    expect(segmentComposite(unb, 5, wire.una)[0]).toContain(digits)
    expect(segmentComposite(unb, 2, wire.una)[0]).toBe(parties.issuer)
    expect(segmentComposite(unb, 3, wire.una)[0]).toBe(parties.ediel)
    for (const [role, expected] of [['MS', parties.issuer], ['MR', parties.ediel]]) {
      const nad = wire.segments.find(segment => segment.tag === 'NAD' && segmentComposite(segment, 1, wire.una)[0] === role)
      expect(segmentComposite(nad, 2, wire.una)[0]).toBe(expected)
    }
    expect(() => assertUtiltsConsumptionPartiesBound(raw, parties)).not.toThrow()
  })

  it.each(slots)('refuses another registered party in $name', slot => {
    expect(() => assertUtiltsConsumptionPartiesBound(boundFixture().replace(slot.wire, slot.wrong), parties)).toThrow(refusal)
  })

  it.each(slots)('refuses the unbound original template party in $name', slot => {
    expect(() => assertUtiltsConsumptionPartiesBound(boundFixture().replace(slot.wire, slot.unbound), parties)).toThrow(refusal)
  })

  it.each(slots)('refuses a missing identity in $name', slot => {
    expect(() => assertUtiltsConsumptionPartiesBound(boundFixture().replace(slot.wire, slot.missing), parties)).toThrow(refusal)
  })

  it.each(['UNB+', 'NAD+MS+', 'NAD+MR+'])('refuses a missing %s party segment', prefix => {
    const raw = boundFixture().split('\n').filter(line => !line.startsWith(prefix)).join('\n')
    expect(() => assertUtiltsConsumptionPartiesBound(raw, parties)).toThrow(refusal)
  })

  it.each(['UNB+', 'NAD+MS+', 'NAD+MR+'])('refuses a duplicate %s party segment', prefix => {
    const raw = boundFixture()
    const segment = raw.split('\n').find(line => line.startsWith(prefix))!
    expect(() => assertUtiltsConsumptionPartiesBound(raw.replace(segment, `${segment}\n${segment}`), parties)).toThrow(refusal)
  })

  it('refuses an unreadable wire with the established fixture error', () => {
    expect(() => assertUtiltsConsumptionPartiesBound(boundFixture() + '?', parties)).toThrow(refusal)
  })
})
