import { describe, expect, it } from 'vitest'
import {
  sortTenantIntegrityFindings,
  type TenantIntegrityFinding,
} from '@/lib/tenant/integrity'

function finding(
  partial: Pick<TenantIntegrityFinding, 'id' | 'severity' | 'rule_key' | 'detected_at'>
): TenantIntegrityFinding {
  return {
    run_id: 'run-1',
    company_id: 'company-1',
    entity_type: 'company',
    entity_id: null,
    title: partial.rule_key,
    message: partial.rule_key,
    evidence: {},
    category: 'access',
    enforcement_mode: 'release_gate',
    description: partial.rule_key,
    remediation_hint: null,
    scope: 'all',
    audit_started_at: partial.detected_at,
    audit_finished_at: partial.detected_at,
    ...partial,
  }
}

describe('sortTenantIntegrityFindings', () => {
  it('orders critical and high before lower severities before applying UI limits', () => {
    const sorted = sortTenantIntegrityFindings([
      finding({ id: '1', severity: 'info', rule_key: 'ACCESS-004', detected_at: '2026-08-27T12:00:00Z' }),
      finding({ id: '2', severity: 'critical', rule_key: 'OPS-001', detected_at: '2026-08-27T11:00:00Z' }),
      finding({ id: '3', severity: 'medium', rule_key: 'TENANT-001', detected_at: '2026-08-27T13:00:00Z' }),
      finding({ id: '4', severity: 'high', rule_key: 'ACCESS-002', detected_at: '2026-08-27T10:00:00Z' }),
      finding({ id: '5', severity: 'critical', rule_key: 'ACCESS-001', detected_at: '2026-08-27T14:00:00Z' }),
    ])

    expect(sorted.map((row) => row.id)).toEqual(['5', '2', '4', '3', '1'])
  })
})
