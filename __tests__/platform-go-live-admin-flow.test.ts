import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('app/admin/platform/go-live/[companyId]/page.tsx', 'utf8')
const actions = readFileSync('app/admin/platform/actor-testing/actions.ts', 'utf8')

describe('platform go-live admin flow', () => {
  it('evaluates production readiness with the authenticated platform-admin actor', () => {
    expect(page).toContain('getCompanyProductionReadiness(companyId, { checkedBy: admin.userId })')
    expect(page).not.toContain('getCompanyProductionReadiness(companyId),')
  })

  it('fails closed in the UI instead of crashing the whole company go-live page', () => {
    expect(page).toContain('safeLoad<ProductionReadinessResult>')
    expect(page).toContain('Ingen produktionsändring har gjorts.')
    expect(page).toContain('Production readiness kunde inte laddas')
  })

  it('keeps mutation actions actor-bound and readiness-gated', () => {
    expect(actions).toContain('getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })')
    expect(actions).toContain("confirmation !== 'ACTIVATE PRODUCTION'")
    expect(actions).toContain('readiness.blockingIssues.length > 0')
  })

  it('presents a short guided operator path before advanced controls', () => {
    expect(page).toContain('1. Fixa blockerare')
    expect(page).toContain('2. Kontroll + dry run')
    expect(page).toContain('3. Aktivera production')
    expect(page).toContain('Avancerat: testprofil, äldre actor-data och evidence package')
  })
})
