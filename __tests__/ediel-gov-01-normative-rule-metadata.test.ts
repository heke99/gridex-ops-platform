// masterplan: GOV-01, AT-GOV-01
import { describe, expect, it } from 'vitest'
import sourceManifest from '@/docs/ediel/masterplan-v2/registers/source_manifest.json'
import {
  AUTHORITATIVE_EDIEL_GUIDES,
  EDIEL_ENERGY_SHARING_NORMATIVE_RULE,
  authoritativeGuideNormativeRule,
} from '@/lib/ediel/rulebook/guideRegistry'
import {
  EMPTY_NORMATIVE_RULE_LEDGER,
  NORMATIVE_RULE_UNPROVEN,
  assessNormativeRule,
  normativeRuleVersionHash,
  publishNormativeRuleVersion,
  verifyNormativeRuleLedger,
  type NormativeRule,
} from '@/lib/ediel/rulebook/normativeRuleMetadata'
import * as registry from '@/lib/ediel/rulebook/canonicalRulePackRegistry'

const P = sourceManifest.find(source => source.id === 'P')!

function provenRule(overrides: Partial<NormativeRule['source']> = {}): NormativeRule {
  return {
    ruleId: 'P26A:energy_sharing:2.3',
    source: {
      document: '260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B',
      sha256: P.sha256,
      version: '26-A',
      section: '2.3',
      page: 35,
      validFrom: '2027-01-01',
      validTo: null,
      scope: ['PRODAT:Z13', 'PRODAT:Z14'],
      ...overrides,
    },
    content: { messageCodes: ['Z13', 'Z14'] },
  }
}

const actor = { kind: 'user' as const, id: '00000000-0000-4000-8000-000000000001' }

describe('GOV-01 normative rule metadata is complete or the rule is unproven', () => {
  it('accepts a rule with document hash, version, page/section, validity and exact scope', () => {
    expect(assessNormativeRule(provenRule())).toEqual({ status: 'proven', missing: [] })
  })

  it.each([
    ['sha256', { sha256: '' }],
    ['sha256', { sha256: 'not-a-hash' }],
    ['version', { version: ' ' }],
    ['page', { page: 0 }],
    ['section', { section: '' }],
    ['validFrom', { validFrom: '2027-02-30' }],
    ['validTo', { validTo: '2026-01-01' }],
    ['scope', { scope: [] }],
    ['scope', { scope: ['PRODAT:*'] }],
  ])('fails closed when %s is missing or invalid', (field, override) => {
    const assessment = assessNormativeRule(provenRule(override as Partial<NormativeRule['source']>))
    expect(assessment.status).toBe('unproven')
    expect(assessment.missing).toContain(field)
  })

  it('rejects a hash that is not the registered source document hash', () => {
    const assessment = assessNormativeRule(provenRule({ sha256: 'a'.repeat(64) }))
    expect(assessment).toMatchObject({ status: 'unproven' })
    expect(assessment.missing).toContain('sha256')
  })

  it('carries only repository-evidenced metadata in the guide registry', () => {
    for (const guide of AUTHORITATIVE_EDIEL_GUIDES) {
      const assessment = assessNormativeRule(authoritativeGuideNormativeRule(guide))
      // No guide registry entry has a page/section citation for its validity in
      // repository sources; inventing one is forbidden, so each stays unproven.
      expect(assessment.status).toBe('unproven')
      expect(assessment.missing).toEqual(expect.arrayContaining(['page', 'section']))
      const rule = authoritativeGuideNormativeRule(guide)
      expect(rule.source).toMatchObject({ document: guide.documentName, version: guide.guideRevision,
        validFrom: guide.effectiveFrom, validTo: guide.effectiveTo, page: null, section: null })
      if (rule.source.sha256) expect(sourceManifest.map(source => source.sha256)).toContain(rule.source.sha256)
    }
    // 25-A-3 has no hashed source in the manifest at all.
    const legacy = AUTHORITATIVE_EDIEL_GUIDES.find(guide => guide.family === 'UTILTS' && guide.guideRevision === '25-A-3')!
    expect(assessNormativeRule(authoritativeGuideNormativeRule(legacy)).missing).toContain('sha256')
  })

  it('proves the P26.A §2.3 p35 energy-sharing capability from its registered source', () => {
    expect(assessNormativeRule(EDIEL_ENERGY_SHARING_NORMATIVE_RULE)).toEqual({ status: 'proven', missing: [] })
  })
})

describe('GOV-01 publication: immutable rule version with audit trail', () => {
  it('publishes a proven rule as an immutable, hash-addressed version with actor and time', () => {
    const rule = provenRule()
    const result = publishNormativeRuleVersion({ ledger: EMPTY_NORMATIVE_RULE_LEDGER, rule, actor, publishedAt: '2026-10-04T10:00:00.000Z' })
    expect(result.status).toBe('published')
    if (result.status !== 'published') throw new Error('unreachable')
    const entry = result.entry
    expect(entry).toMatchObject({ sequence: 1, ruleId: rule.ruleId, versionHash: normativeRuleVersionHash(rule),
      actor, publishedAt: '2026-10-04T10:00:00.000Z', previousEntryHash: null })
    expect(entry.entryHash).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(entry)).toBe(true)
    expect(Object.isFrozen(entry.rule.source.scope)).toBe(true)
    expect(Object.isFrozen(result.ledger)).toBe(true)
    expect(() => { (entry.rule.source as { page: number }).page = 1 }).toThrow()
    // The input ledger is never mutated (append-only by value).
    expect(EMPTY_NORMATIVE_RULE_LEDGER).toHaveLength(0)
    // Mutating the caller's input after publication cannot change the version.
    ;(rule.source as { page: number }).page = 99
    expect(result.entry.rule.source.page).toBe(35)
    expect(verifyNormativeRuleLedger(result.ledger)).toEqual({ valid: true })
  })

  it('appends a new version instead of overwriting, chained to the prior entry', () => {
    const first = publishNormativeRuleVersion({ ledger: EMPTY_NORMATIVE_RULE_LEDGER, rule: provenRule(), actor, publishedAt: '2026-10-04T10:00:00.000Z' })
    if (first.status !== 'published') throw new Error('unreachable')
    const revised = provenRule({ scope: ['PRODAT:Z13'] })
    const second = publishNormativeRuleVersion({ ledger: first.ledger, rule: revised, actor, publishedAt: '2026-10-04T11:00:00.000Z' })
    if (second.status !== 'published') throw new Error('unreachable')
    expect(second.ledger).toHaveLength(2)
    expect(second.ledger[0]).toBe(first.entry)
    expect(second.entry.previousEntryHash).toBe(first.entry.entryHash)
    expect(second.entry.versionHash).not.toBe(first.entry.versionHash)
    expect(verifyNormativeRuleLedger(second.ledger)).toEqual({ valid: true })

    const same = publishNormativeRuleVersion({ ledger: second.ledger, rule: revised, actor, publishedAt: '2026-10-04T12:00:00.000Z' })
    expect(same).toMatchObject({ status: 'already_published', entry: second.entry })
    expect(same.ledger).toBe(second.ledger)
  })

  it('detects a tampered audit trail', () => {
    const first = publishNormativeRuleVersion({ ledger: EMPTY_NORMATIVE_RULE_LEDGER, rule: provenRule(), actor, publishedAt: '2026-10-04T10:00:00.000Z' })
    if (first.status !== 'published') throw new Error('unreachable')
    const forged = [{ ...first.entry, actor: { kind: 'user' as const, id: 'someone-else' } }]
    expect(verifyNormativeRuleLedger(forged)).toEqual({ valid: false, reason: 'entry_hash_mismatch', sequence: 1 })
  })

  it('requires an identified actor and a valid publication instant', () => {
    expect(() => publishNormativeRuleVersion({ ledger: EMPTY_NORMATIVE_RULE_LEDGER, rule: provenRule(), actor: { kind: 'user', id: ' ' }, publishedAt: '2026-10-04T10:00:00.000Z' }))
      .toThrow('normative_rule_publication_actor_required')
    expect(() => publishNormativeRuleVersion({ ledger: EMPTY_NORMATIVE_RULE_LEDGER, rule: provenRule(), actor, publishedAt: 'yesterday' }))
      .toThrow('normative_rule_publication_time_invalid')
  })
})

describe('GOV-01 on_failure: an unproven rule generates no external message or invented error code', () => {
  it('refuses publication without creating a version, an outbound message or a national error code', () => {
    const result = publishNormativeRuleVersion({ ledger: EMPTY_NORMATIVE_RULE_LEDGER,
      rule: provenRule({ page: null, section: null }), actor, publishedAt: '2026-10-04T10:00:00.000Z' })
    expect(result).toEqual({ status: 'unproven', code: NORMATIVE_RULE_UNPROVEN, missing: ['page', 'section'],
      ledger: EMPTY_NORMATIVE_RULE_LEDGER, externalMessages: [], errorCodes: [] })
    expect(NORMATIVE_RULE_UNPROVEN).not.toMatch(/^(ERC|E\d|Z\d|S\d)/)
  })

  it('removes the unused legacy snapshot assertion that accepted an association code as a version', () => {
    expect('assertLegacyRuleSnapshotMatchesCanonical' in registry).toBe(false)
  })
})
