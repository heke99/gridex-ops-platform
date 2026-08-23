import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('customer portal identity match-strength vocabulary', () => {
  it('uses only canonical strengths in website runtime writes', () => {
    const source = read('lib/website/customerApplicationCommunication.ts')
    const start = source.indexOf('    match_strength:')
    const end = source.indexOf('    match_method:', start)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const block = source.slice(start, end)
    expect(block).toContain('? "strong"')
    expect(block).toContain(': "weak",')
    expect(block).not.toContain('"medium"')
  })

  it('canonicalizes resolver output to strong, weak or manual', () => {
    const resolver = read('lib/customer-portal/customerResolver.ts')

    expect(resolver).toContain("export type PortalMatchStrength = 'strong' | 'weak' | 'manual'")
    expect(resolver).toContain("if (strength === 'medium') return 'weak'")
    expect(resolver).toContain('match_strength: canonicalPortalMatchStrength(source.matchStrength)')
    expect(resolver).not.toMatch(/matchStrength:\s*'medium'/)
    expect(resolver).not.toContain("? 'strong' : 'medium'")
  })

  it('keeps shared customer matching on strong and weak semantics', () => {
    const matchingService = read('lib/customers/matchingService.ts')

    expect(matchingService).toContain("export type CustomerMatchStrength = 'strong' | 'weak'")
    expect(matchingService).not.toMatch(/CustomerMatchStrength = [^\n]*medium/)
  })

  it('keeps the database constraint canonical while normalizing legacy medium writes', () => {
    const compatibility = read(
      'supabase/migrations/20260823201059_normalize_customer_portal_identity_match_strength.sql',
    )
    const convergence = read(
      'supabase/migrations/20260823201716_canonical_customer_portal_match_strength_convergence.sql',
    )

    expect(compatibility).toContain("new.match_strength = 'medium'")
    expect(compatibility).toContain("new.match_strength := 'weak'")
    expect(convergence).toContain("set match_strength = 'weak'")
    expect(convergence).toContain("where match_strength = 'medium'")
    expect(convergence).toContain("new.match_strength := 'weak'")
    expect(convergence).toContain(
      'revoke all on function public.gridex_normalize_customer_portal_identity_match_strength()',
    )

    const constraintStart = convergence.indexOf(
      'add constraint customer_portal_identities_match_strength_check',
    )
    const constraintEnd = convergence.indexOf('));', constraintStart)
    expect(constraintStart).toBeGreaterThanOrEqual(0)
    expect(constraintEnd).toBeGreaterThan(constraintStart)

    const constraintBlock = convergence.slice(constraintStart, constraintEnd + 3)
    expect(constraintBlock).toContain("'strong'::text, 'weak'::text, 'manual'::text")
    expect(constraintBlock).not.toContain("'medium'")
  })
})
