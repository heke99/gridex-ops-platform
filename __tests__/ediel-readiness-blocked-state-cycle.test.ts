import { describe, expect, it } from 'vitest'
import { deriveProductionReadinessStatus } from '@/lib/ediel/productionReadiness'

const blockingIssue = {
  code: 'actual_blocker',
  label: 'Actual blocker',
  message: 'A real readiness blocker exists.',
  severity: 'blocking' as const,
  area: 'safety' as const,
}

const warning = {
  code: 'warning_only',
  label: 'Warning only',
  message: 'A non-blocking warning exists.',
  severity: 'warning' as const,
  area: 'safety' as const,
}

describe('production readiness lifecycle separation', () => {
  it('allows fresh readiness to become ready while production is fail-closed blocked', () => {
    expect(deriveProductionReadinessStatus({
      blockingIssues: [],
      warnings: [],
      companyStatus: 'active',
      productionStatus: 'blocked',
      productionEnabled: false,
      liveApprovedAt: '2026-09-03T12:50:52.938Z',
    })).toBe('ready')
  })

  it('returns warning rather than blocked when only warnings remain', () => {
    expect(deriveProductionReadinessStatus({
      blockingIssues: [],
      warnings: [warning],
      companyStatus: 'active',
      productionStatus: 'blocked',
      productionEnabled: false,
    })).toBe('warning')
  })

  it('still fails readiness when a real blocker exists', () => {
    expect(deriveProductionReadinessStatus({
      blockingIssues: [blockingIssue],
      warnings: [],
      companyStatus: 'active',
      productionStatus: 'blocked',
      productionEnabled: false,
    })).toBe('not_ready')
  })

  it('does not report live from stale approval flags while lifecycle state is blocked', () => {
    expect(deriveProductionReadinessStatus({
      blockingIssues: [],
      warnings: [],
      companyStatus: 'active',
      productionStatus: 'blocked',
      productionEnabled: true,
      liveApprovedAt: '2026-09-03T12:50:52.938Z',
    })).toBe('ready')
  })

  it('keeps paused and inactive tenants fail-closed', () => {
    expect(deriveProductionReadinessStatus({
      blockingIssues: [],
      warnings: [],
      companyStatus: 'active',
      productionStatus: 'paused',
      productionEnabled: false,
    })).toBe('paused')

    expect(deriveProductionReadinessStatus({
      blockingIssues: [],
      warnings: [],
      companyStatus: 'suspended',
      productionStatus: 'blocked',
      productionEnabled: false,
    })).toBe('blocked')
  })
})
