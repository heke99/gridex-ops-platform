import { describe, expect, it } from 'vitest'
import { resolveAuthoritativeEdielGuide } from '@/lib/ediel/rulebook/guideRegistry'
import { getUtiltsFieldRules } from '@/lib/ediel/rulebook/utiltsFieldMatrix'
import { evaluateUtiltsFieldMatrix, selectUtiltsFieldRules } from '@/lib/ediel/utilts/fieldMatrixProjection'

function policy(code: string) {
  return { family: 'UTILTS', code, referenceDate: '2026-10-23',
    guide: resolveAuthoritativeEdielGuide({ family: 'UTILTS', referenceDate: '2026-10-23', associationAssignedCode: 'E5SE5A' }),
    fieldRules: getUtiltsFieldRules(code) }
}
const transaction = (id: string, extra = '') => `IDE+24+${id}'LIN+1++8716867000016:SRW'PIA+1+123:Z10'DTM+324:202610010000202611010000:719'DTM+368:202610230000:203'DTM+354:15:806' STS+7++Z01:SVK:260'${extra}`
const wire = (body: string, code = 'S01') => `UNA:+.? 'UNB+UNOC:3+S+R+261023:1200+I++++23-DDK-S01-S'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+${code}:SVK:260+DOC+9+AB'${body}UNT+1+1'UNZ+1+I'`

describe('UTILTS source-selected executable projection, bounded first slice', () => {
  it('does not qualify an invalid policy date or a noncanonical message code', () => {
    for (const override of [{ referenceDate: '2026-99-99' }, { referenceDate: '2026-02-31' }, { code: 's01' }]) {
      const result = evaluateUtiltsFieldMatrix({ policy: { ...policy('S01'), ...override }, rawPayload: wire(transaction('OWN')) })
      expect(result.sourceQualified).toBe(false)
      expect(result.issues).toEqual([])
    }
  })

  it('cannot change the selected published requirement through supplied policy metadata', () => {
    const original = policy('S01')
    const changed = { ...original, fieldRules: original.fieldRules.map(rule => rule.fieldNo === '209'
      ? { ...rule, requirements: { ...rule.requirements, S01: 'O' as const } } : rule) }
    const result = evaluateUtiltsFieldMatrix({ policy: changed, rawPayload: wire(transaction('OWN', "LOC+172+BAD::9'")) })
    expect(result).toMatchObject({ sourceQualified: false, issues: [] })
    expect(result.unresolved).toContainEqual(expect.objectContaining({ reason: 'policy_rows_unqualified' }))
  })

  it('a CCI Z13 must not supply the missing UTILTS STS7 transaction reason', () => {
    const rawPayload = wire(transaction('OWN').replace(" STS+7++Z01:SVK:260'", "CCI+++Z13::260'CAV+Z01::260'"))
    expect(evaluateUtiltsFieldMatrix({ policy: policy('S01'), rawPayload }).issues)
      .toContainEqual(expect.objectContaining({ fieldNo: '223', kind: 'missing', transactionIndex: 0 }))
  })

  it('retains actual publication rows for every current code without treating them as complete execution', () => {
    for (const code of ['E30', 'E31', 'E66', 'E72', 'E73', 'E74', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07']) {
      const selected = selectUtiltsFieldRules(policy(code))
      expect(selected).toHaveLength(getUtiltsFieldRules(code).length)
      for (const rule of selected) expect(rule.requirement).toBe(rule.requirements[code as keyof typeof rule.requirements])
    }
  })

  it('normalizes the actual selected source requirement with source identity', () => {
    const selected = selectUtiltsFieldRules(policy('S01')).find(rule => rule.fieldNo === '209')
    expect(selected).toMatchObject({ requirement: 'X', fieldNo: '209', semanticKey: 'metering_point_id',
      sourceEdition: '25-A-5', sourceSha256: 'b76a61b9aa6f136771e5db4948296d1b632b8d775314eb6c93783595ae419db2' })
  })

  it('rejects only the own S01 IDE containing LOC172 and preserves the clean sibling', () => {
    const result = evaluateUtiltsFieldMatrix({ policy: policy('S01'), rawPayload: wire(transaction('SAME', "LOC+172+735999260731000007::9'") + transaction('SAME')) })
    expect(result.sourceQualified).toBe(true)
    expect(result.issues.filter(issue => issue.fieldNo === '209')).toMatchObject([{ kind: 'forbidden', transactionIndex: 0, referenceNumber: 'SAME' }])
    expect(result.issues.some(issue => issue.transactionIndex === 1)).toBe(false)
    expect(result.complete).toBe(false)
  })

  it('an empty supplied forbidden field is still rejected', () => {
    const result = evaluateUtiltsFieldMatrix({ policy: policy('S01'), rawPayload: wire(transaction('OWN', "LOC+172+::9'")) })
    expect(result.issues).toContainEqual(expect.objectContaining({ fieldNo: '209', kind: 'forbidden' }))
  })

  it('a present parent segment cannot manufacture its missing required component', () => {
    const result = evaluateUtiltsFieldMatrix({ policy: policy('S01'), rawPayload: wire(transaction('OWN').replace('LIN+1++8716867000016:SRW', 'LIN+1++:SRW')) })
    expect(result.issues).toContainEqual(expect.objectContaining({ fieldNo: '506', kind: 'missing', transactionIndex: 0 }))
  })

  it('never promotes E66 D209 to R or X and reports unresolved conditions explicitly', () => {
    const result = evaluateUtiltsFieldMatrix({ policy: policy('E66'), rawPayload: wire("IDE+24+OWN'LIN+1++8716867000016:SRW'DTM+597:202610230000:203'STS+7++E88::260'MEA+AAZ++KWH'CCI+++E12::260'CAV+E17::260'LOC+175+735999260731000007::9'", 'E66') })
    expect(result.issues.some(issue => issue.fieldNo === '209')).toBe(false)
    expect(result.unresolved).toContainEqual(expect.objectContaining({ fieldNo: '209', reason: 'dependent_condition' }))
  })

  it('does not demand energy136 from an S01 price-only observation', () => {
    const result = evaluateUtiltsFieldMatrix({ policy: policy('S01'), rawPayload: wire(transaction('OWN', "SEQ++1'PRI+CAL:12'CUX+2:SEK'")) })
    expect(result.issues.some(issue => issue.fieldNo === '516')).toBe(false)
    expect(result.unresolved).toContainEqual(expect.objectContaining({ fieldNo: '516', reason: 'branch_condition' }))
  })

  it('holds unsupported edition/source qualification locally without national field findings', () => {
    const original = policy('S01')
    const changed = { ...original, guide: { ...original.guide, primarySource: { ...original.guide.primarySource!, sha256: '0'.repeat(64) } } }
    const result = evaluateUtiltsFieldMatrix({ policy: changed, rawPayload: wire(transaction('OWN', "LOC+172+BAD::9'")) })
    expect(result).toMatchObject({ sourceQualified: false, complete: false, issues: [] })
    expect(result.unresolved).toContainEqual(expect.objectContaining({ reason: 'source_edition_unqualified' }))
  })
})


// The shared physical matrix does not share edition-specific conditions.
describe('source-proven U3 shared physical R/X admission', () => {
  async function prior(date: string) {
    const { resolveCanonicalEdielPolicy } = await import('@/lib/ediel/rulebook/canonicalEdielPolicy')
    return resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'S01', direction: 'inbound', referenceDate: date,
      selectedGuideRevision: '25-A-3', applicationReference: '23-DDK-S01-S', mode: 'parse' })
  }
  it.each(['2026-09-30', '2026-10-01', '2026-10-14'])('keeps original U3 R/X evidence on admitted %s', async date => {
    const selected = await prior(date)
    const rawPayload = wire(transaction('OWN', "LOC+172+735999260731000007::9'")).replace("PIA+1+123:Z10'", '')
    const result = evaluateUtiltsFieldMatrix({ policy: selected, rawPayload })
    expect(result.sourceQualified).toBe(true)
    for (const [fieldNo, kind] of [['209', 'forbidden'], ['511', 'missing']]) {
      expect(result.issues).toContainEqual(expect.objectContaining({ fieldNo, kind, sourceEdition: '25-A-3',
        sourceSha256: 'a4ae498e5231df22e043ec24b93f97563095bb9880ee296683acf7a0f6973fff' }))
    }
    expect(selectUtiltsFieldRules(selected)).toEqual([])
    const { resolveUtiltsFieldConditions } = await import('@/lib/ediel/utilts/fieldMatrixConditions')
    expect(resolveUtiltsFieldConditions({ policy: selected, rawPayload }).sourceQualified).toBe(false)
  })
  it('does not extend U3 admission or accept forged predecessor metadata/rows', async () => {
    const selected = await prior('2026-10-01')
    for (const changed of [
      { ...selected, referenceDate: '2026-10-15' },
      { ...selected, referenceDate: '2026-02-31' },
      { ...selected, direction: 'outbound' },
      { ...selected, guide: { ...selected.guide, documentName: 'unqualified' } },
      { ...selected, guide: { ...selected.guide, effectiveFrom: '2025-01-01' } },
      { ...selected, guide: { ...selected.guide, primarySource: policy('S01').guide.primarySource } },
      { ...selected, fieldRules: getUtiltsFieldRules('S01').map(row => row.fieldNo === '209'
        ? { ...row, requirements: { ...row.requirements, S01: 'O' as const } } : row) },
    ]) expect(evaluateUtiltsFieldMatrix({ policy: changed, rawPayload: wire(transaction('OWN', "LOC+172+BAD::9'")) }))
      .toMatchObject({ sourceQualified: false, issues: [] })
  })
  it.each(['209', '511'])('actual whole-message grace cannot bypass shared S01 field %s', async field => {
    const { energyHandoffMessage } = await import('./helpers/utiltsObservationHandoff')
    const { s01L359AggregateWire } = await import('../scripts/helpers/utiltsS01AggregateFixture')
    const { resolveCanonicalMessagePolicy } = await import('@/lib/ediel/core/messagePolicy')
    const { runUtiltsRuntimeForMessage } = await import('@/lib/ediel/utiltsEngine')
    const message = energyHandoffMessage('2026-10-01')
    message.message_code = 'S01'; message.application_reference = '23-DDK-S01-S'
    message.raw_payload = s01L359AggregateWire(message.raw_payload!, [{ transactionId: 'GRACE', latestUpdateDate: '202607010000', quantity: '1' }])
    message.raw_payload = field === '209'
      ? message.raw_payload.replace("LOC+239+TES:SVK:260'", "LOC+239+TES:SVK:260'\nLOC+172+735999260731000007::9'")
      : message.raw_payload.split('\n').filter(line => !line.startsWith('PIA+')).join('\n')
    const lines = message.raw_payload.split('\n'), unh = lines.findIndex(line => line.startsWith('UNH+')), unt = lines.findIndex(line => line.startsWith('UNT+'))
    lines[unt] = `UNT+${unt - unh + 1}+1'`; message.raw_payload = lines.join('\n')
    expect(runUtiltsRuntimeForMessage(message, { canonicalPolicy: await prior('2026-10-01'), guideOnly: true }).validation.issues)
      .toContainEqual(expect.objectContaining({ code: `UTILTS_FIELD_${field}_${field === '209' ? 'FORBIDDEN' : 'MISSING'}` }))
    expect(resolveCanonicalMessagePolicy(message)?.guide.guideRevision).toBe('25-A-5')
  })
})
