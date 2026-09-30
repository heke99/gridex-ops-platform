import { afterEach, describe, expect, it, vi } from 'vitest'
import { runUtiltsOperationsEngine } from '@/lib/ediel/utilts/engine'
import { validateUtilts } from '@/lib/ediel/utilts/validateUtilts'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { s02PlanningFixture } from './helpers/utiltsS02PlanningFixture'

afterEach(() => vi.useRealTimers())

const priorGuideWire = energyHandoffMessage('2026-09-30').raw_payload!
  .replace('735999260731000007::9', '735999260731000008::9')
const s02Wire = s02PlanningFixture({
  company: 'synthetic-preview',
  transactions: [{ reference: 'S02-PREVIEW', point: '735999260731000007', quantity: 111 }],
}).raw_payload!

const adapters = [
  {
    name: 'raw validator',
    run: (rawPayload: string, admissionAt?: string | Date) => validateUtilts(rawPayload, { admissionAt }),
  },
  {
    name: 'operations preview',
    run: (rawPayload: string, admissionAt?: string | Date) => runUtiltsOperationsEngine({ rawPayload, admissionAt }).validation,
  },
]

describe.each(adapters)('$name admission context', ({ run }) => {
  it('admits physical S02 during guide grace without inventing an E66 row identity', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T20:00:00Z'))
    expect(run(s02Wire)).toMatchObject({ ok: true, classification: 'accepted' })
  })

  it.each([
    ['2026-10-01T20:00:00Z', true],
    ['2026-10-14T20:00:00Z', true],
    ['2026-10-14T22:00:00Z', false],
    ['2026-10-15T20:00:00Z', false],
  ] as const)('uses explicit preview admission %s for the complete guide package', (admissionAt, accepted) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T20:00:00Z'))
    const validation = run(priorGuideWire, admissionAt)
    expect(validation.ok).toBe(accepted)
    expect(validation.issues.some(issue => issue.code === 'UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID')).toBe(!accepted)
  })

  it('uses the current invocation time when admission is omitted, despite an old document date', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T20:00:00Z'))
    expect(run(priorGuideWire).ok).toBe(true)
    vi.setSystemTime(new Date('2026-10-14T22:00:00Z'))
    expect(run(priorGuideWire).issues).toContainEqual(expect.objectContaining({
      code: 'UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID', kind: 'application',
    }))
  })

  it('checks future physical document time against explicit preview time', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T20:00:00Z'))
    expect(run(s02Wire, new Date('2026-10-01T16:00:00Z')).issues).toContainEqual(expect.objectContaining({
      code: 'UTILTS_MESSAGE_DATE_INVALID', aperakFieldCode: '205',
    }))
    expect(run(s02Wire, new Date('2026-10-01T20:00:00Z')).ok).toBe(true)
  })

  it('leaves dangling-release input to the central structured syntax rejection', () => {
    expect(run(`${priorGuideWire}?`)).toMatchObject({ ok: false, syntaxOk: false, classification: 'syntax_rejected' })
  })
})

it('preserves physical document and measurement times across different preview admission dates', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T20:00:00Z'))
  for (const admissionAt of ['2026-10-14T20:00:00Z', '2026-10-15T20:00:00Z']) {
    const result = runUtiltsOperationsEngine({ rawPayload: priorGuideWire, admissionAt })
    expect(result.facts.rawSegments).toContain('DTM+137:202609301811:203')
    expect(result.facts.deliveryPeriodStart).toBe('2026-07-01T00:00:00')
    expect(result.facts.deliveryPeriodEnd).toBe('2026-07-01T00:15:00')
    expect(result.normalizedPayload).toMatchObject({
      periodStart: '2026-06-30T22:00:00.000Z', periodEnd: '2026-06-30T22:15:00.000Z', quantity: 500,
    })
  }
})
