import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateCanonicalActorTestReadiness } from '@/lib/ediel/productionReadinessTestAuthority'

describe('canonical production readiness test authority', () => {
  it('accepts canonical 6/6 PRODAT and 5/5 UTILTS with current evidence', () => {
    expect(evaluateCanonicalActorTestReadiness({
      status: 'ready',
      blockers: [],
      prodat_passed: 6,
      prodat_total: 6,
      utilts_passed: 5,
      utilts_total: 5,
      evidence_ready: true,
    }, 6, 5)).toMatchObject({ ready: true, reason: null })
  })

  it('fails closed when canonical counts are incomplete', () => {
    const result = evaluateCanonicalActorTestReadiness({
      status: 'blocked',
      blockers: ['Canonical Ediel-evidens är inte komplett'],
      prodat_passed: 5,
      prodat_total: 6,
      utilts_passed: 5,
      utilts_total: 5,
      evidence_ready: false,
    }, 6, 5)
    expect(result.ready).toBe(false)
    expect(result.reason).toContain('PRODAT 5/6')
    expect(result.reason).toContain('evidence_ready=false')
  })

  it('fails closed when canonical readiness is unavailable or malformed', () => {
    expect(evaluateCanonicalActorTestReadiness(null, 6, 5).ready).toBe(false)
    expect(evaluateCanonicalActorTestReadiness({
      status: 'ready',
      prodat_passed: '6',
      prodat_total: 6,
      utilts_passed: 5,
      utilts_total: 5,
      evidence_ready: true,
    }, 6, 5).ready).toBe(false)
  })

  it('does not use actor_test_results as a second production certification authority', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/ediel/productionReadiness.part-2.ts'), 'utf8')
    expect(source).toContain("rpc('gridex_company_go_live_readiness'")
    expect(source).not.toContain('actor_test_results')
    expect(source).toContain('canonical_required_tests_unavailable')
  })
})
