import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('app/admin/platform/go-live/[companyId]/page.tsx', 'utf8')
const actorActions = readFileSync('app/admin/platform/actor-testing/actions.ts', 'utf8')
const goLiveActions = readFileSync('app/admin/platform/go-live/actions.ts', 'utf8')

describe('platform go-live admin flow', () => {
  it('evaluates production readiness with the authenticated platform-admin actor', () => {
    expect(page).toContain('getCompanyProductionReadiness(companyId, { checkedBy: admin.userId })')
    expect(page).not.toContain('getCompanyProductionReadiness(companyId),')
  })

  it('fails closed in the UI instead of crashing the whole company go-live page', () => {
    expect(page).toContain('safeLoad<ProductionReadinessResult>')
    expect(page).toContain('Ingen produktionsändring har gjorts.')
    expect(page).toContain('Production readiness kunde inte laddas')
    expect(page).toContain('Webb & Mina sidor kunde inte verifieras')
    expect(page).toContain('Production-evidens kunde inte laddas')
  })

  it('keeps production mutation actions actor-bound and readiness-gated', () => {
    expect(actorActions).toContain('getCompanyProductionReadiness(companyId, { checkedBy: admin.userId, persist: true })')
    expect(actorActions).toContain("confirmation !== 'ACTIVATE PRODUCTION'")
    expect(actorActions).toContain('readiness.blockingIssues.length > 0')
  })

  it('keeps website verification and evidence writes platform-admin bound', () => {
    expect(goLiveActions).toContain('requirePlatformAdminActionAccess()')
    expect(goLiveActions).toContain('provisionTenantWebsiteIntegration')
    expect(goLiveActions).toContain("confirmation') !== 'APPROVE EVIDENCE'")
    expect(goLiveActions).toContain('logAdminActionAndUsage')
  })

  it('presents the dependency-safe repeatable operator path before advanced controls', () => {
    // Step labels were renamed in "Fix tenant sales gating and simplify
    // production approval"; the four-step path and both panels are unchanged.
    expect(page).toContain('1. Kontrollera bolaget')
    expect(page).toContain('2. Kör dry run')
    expect(page).toContain('3. Godkänn production')
    expect(page).toContain('4. Kundintag är separat')
    expect(page).toContain('<CertificationEvidencePanel')
    expect(page).toContain('<TenantWebsiteGoLivePanel')
    expect(page).toContain('Avancerat: testprofil, äldre actor-data och evidence package')
  })
})
