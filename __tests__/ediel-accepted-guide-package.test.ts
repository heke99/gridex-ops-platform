// masterplan: GOV-05, AT-GOV-05
import { describe, expect, it } from 'vitest'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'

function policy(date: string, revision: string, direction: 'inbound' | 'outbound' = 'inbound') {
  return resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'E66', direction,
    referenceDate: date, selectedGuideRevision: revision, associationAssignedCode: 'E5SE5A',
    applicationReference: '23-DDQ-E66-S', mode: 'catalog_evidence' })
}

describe('whole accepted guide candidate', () => {
  it.each(['2026-10-01', '2026-10-14'])('admits preceding guide as one complete package on %s', date => {
    const selected = policy(date, '25-A-3')
    expect(selected.referenceDate).toBe(date)
    expect(selected.guide.guideRevision).toBe('25-A-3')
    expect(selected.utiltsProfile?.guideVersion).toBe('25-A-3')
    expect(selected.utiltsProcessability?.guideRevision).toBe('25-A-3')
    expect(selected.sourceTrace.filter(item => ['guide', 'field_matrix', 'processability'].includes(item.authority))
      .every(item => item.document.includes('25-A-3'))).toBe(true)
    expect(selected.previousGuideGraceActive).toBe(true)
  })
  it('admits the current package with the same wire identifier', () => {
    const selected = policy('2026-10-01', '25-A-4')
    expect(selected.utiltsProfile?.guideVersion).toBe('25-A-4')
    expect(selected.utiltsProcessability?.guideRevision).toBe('25-A-4')
  })
  it('holds old candidates after the complete two-week window', () => {
    expect(() => policy('2026-10-15', '25-A-3')).toThrow(/guide_candidate_not_accepted/)
  })
  it('does not admit future guide candidates before effectiveness', () => {
    expect(() => policy('2026-09-30', '25-A-4')).toThrow(/guide_candidate_not_accepted/)
  })
  it('requires the current guide for all outgoing messages', () => {
    expect(() => policy('2026-10-01', '25-A-3', 'outbound')).toThrow(/guide_candidate_not_accepted/)
  })
})
