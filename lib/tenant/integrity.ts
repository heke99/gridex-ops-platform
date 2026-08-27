import { supabaseService } from '@/lib/supabase/service'

export type TenantIntegrityScope = 'all' | 'access' | 'operations' | 'ediel'
export type TenantIntegritySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export type TenantIntegrityAuditResult = {
  ok: boolean
  run_id: string
  company_id: string | null
  scope: TenantIntegrityScope
  finding_count?: number
  critical_count?: number
  high_count?: number
  medium_count?: number
  low_count?: number
  info_count?: number
  error?: string
}

export type TenantIntegrityCompanySummary = {
  company_id: string
  company_name: string | null
  company_status: string | null
  latest_run_id: string | null
  audited_at: string | null
  finding_count: number | null
  critical_count: number | null
  high_count: number | null
  medium_count: number | null
  low_count: number | null
  info_count: number | null
  integrity_status: string
}

export type TenantIntegrityFinding = {
  id: string
  run_id: string
  rule_key: string
  company_id: string | null
  entity_type: string
  entity_id: string | null
  severity: TenantIntegritySeverity
  title: string
  message: string
  evidence: Record<string, unknown>
  detected_at: string
  category: string
  enforcement_mode: 'database' | 'audit' | 'release_gate'
  description: string
  remediation_hint: string | null
  scope: TenantIntegrityScope
  audit_started_at: string
  audit_finished_at: string | null
}

export type TenantIntegrityRule = {
  rule_key: string
  category: string
  severity: TenantIntegritySeverity
  enforcement_mode: 'database' | 'audit' | 'release_gate'
  title: string
  description: string
  remediation_hint: string | null
  is_enabled: boolean
}

export type TenantIntegrityAuditRun = {
  id: string
  company_id: string | null
  scope: TenantIntegrityScope
  status: 'running' | 'completed' | 'failed'
  started_at: string
  finished_at: string | null
  finding_count: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  info_count: number
  error_message: string | null
}

const severityRank: Record<TenantIntegritySeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

function assertNoError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback)
}

export function sortTenantIntegrityFindings(findings: TenantIntegrityFinding[]): TenantIntegrityFinding[] {
  return [...findings].sort((a, b) => {
    const severityDelta = severityRank[a.severity] - severityRank[b.severity]
    if (severityDelta !== 0) return severityDelta
    const ruleDelta = a.rule_key.localeCompare(b.rule_key)
    if (ruleDelta !== 0) return ruleDelta
    return b.detected_at.localeCompare(a.detected_at)
  })
}

export async function runTenantIntegrityAudit(input: {
  companyId?: string | null
  scope?: TenantIntegrityScope
  requestedBy?: string | null
}): Promise<TenantIntegrityAuditResult> {
  const { data, error } = await supabaseService.rpc('run_tenant_integrity_audit', {
    p_company_id: input.companyId ?? null,
    p_scope: input.scope ?? 'all',
    p_requested_by: input.requestedBy ?? null,
  })

  assertNoError(error, 'Tenant-integritetsauditen kunde inte köras.')
  const result = (data ?? null) as TenantIntegrityAuditResult | null
  if (!result?.run_id) throw new Error('Tenant-integritetsauditen returnerade inget körnings-ID.')
  if (!result.ok) throw new Error(result.error || 'Tenant-integritetsauditen misslyckades.')
  return result
}

export async function loadTenantIntegrityDashboard(): Promise<{
  companies: TenantIntegrityCompanySummary[]
  findings: TenantIntegrityFinding[]
  rules: TenantIntegrityRule[]
  runs: TenantIntegrityAuditRun[]
}> {
  const [companiesResult, findingsResult, rulesResult, runsResult] = await Promise.all([
    supabaseService
      .from('tenant_integrity_company_summary_v')
      .select('company_id, company_name, company_status, latest_run_id, audited_at, finding_count, critical_count, high_count, medium_count, low_count, info_count, integrity_status')
      .order('company_name', { ascending: true }),
    supabaseService
      .from('tenant_integrity_latest_findings_v')
      .select('id, run_id, rule_key, company_id, entity_type, entity_id, severity, title, message, evidence, detected_at, category, enforcement_mode, description, remediation_hint, scope, audit_started_at, audit_finished_at')
      .limit(250),
    supabaseService
      .from('tenant_integrity_rule_registry')
      .select('rule_key, category, severity, enforcement_mode, title, description, remediation_hint, is_enabled')
      .order('rule_key', { ascending: true }),
    supabaseService
      .from('tenant_integrity_audit_runs')
      .select('id, company_id, scope, status, started_at, finished_at, finding_count, critical_count, high_count, medium_count, low_count, info_count, error_message')
      .order('started_at', { ascending: false })
      .limit(20),
  ])

  assertNoError(companiesResult.error, 'Tenant-sammanfattningen kunde inte läsas.')
  assertNoError(findingsResult.error, 'Integritetsfynden kunde inte läsas.')
  assertNoError(rulesResult.error, 'Integritetsreglerna kunde inte läsas.')
  assertNoError(runsResult.error, 'Audit-historiken kunde inte läsas.')

  return {
    companies: (companiesResult.data ?? []) as TenantIntegrityCompanySummary[],
    findings: sortTenantIntegrityFindings((findingsResult.data ?? []) as TenantIntegrityFinding[]),
    rules: (rulesResult.data ?? []) as TenantIntegrityRule[],
    runs: (runsResult.data ?? []) as TenantIntegrityAuditRun[],
  }
}
