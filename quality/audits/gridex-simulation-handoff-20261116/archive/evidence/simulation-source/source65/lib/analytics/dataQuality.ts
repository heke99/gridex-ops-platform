import { supabaseService } from '@/lib/supabase/service'
import { monthStart } from '@/lib/analytics/utils'
import type { ManagedDataQualityIssueInput } from '@/lib/analytics/dataQualityRules'

/** Automated producers share tenant/source validation and one open identity. */
export async function upsertManagedDataQualityIssue(input: ManagedDataQualityIssueInput): Promise<void> {
  const { error } = await supabaseService.rpc('gridex_upsert_data_quality_issue_v1', {
    p_company: input.companyId,
    p_entity: input.entityId,
    p_issue_type: input.issueType,
    p_severity: input.severity ?? 'warning',
    p_message: input.message,
    p_period: input.periodMonth ?? null,
  })
  if (error) throw error
}

export async function resolveDataQualityIssue(issueId: string, companyId: string): Promise<void> {
  const { error } = await supabaseService.rpc('gridex_resolve_data_quality_issue_v1', {
    p_company: companyId,
    p_issue: issueId,
  })
  if (error) throw error
}

/** Resolve only a rule/window the producer has positively evaluated as healthy. */
export async function resolveManagedDataQualityIssue(
  input: Pick<ManagedDataQualityIssueInput, 'companyId' | 'entityId' | 'issueType' | 'periodMonth'>,
): Promise<void> {
  const { error } = await supabaseService.rpc('gridex_resolve_managed_quality_rule_v1', {
    p_company: input.companyId,
    p_entity: input.entityId,
    p_issue_type: input.issueType,
    p_period: input.periodMonth ?? null,
  })
  if (error) throw error
}

async function scan(companyId: string, month: string, meteringPointId: string | null): Promise<number> {
  const { data, error } = await supabaseService.rpc('gridex_scan_data_quality_v1', {
    p_company: companyId,
    p_month: monthStart(month),
    p_point: meteringPointId,
  })
  // Schema/read/write failures must remain failures. A partial scan must never
  // look like a successful zero-issue reconciliation.
  if (error) throw error
  const issues = Number((data as { issues?: unknown } | null)?.issues)
  if (!Number.isInteger(issues) || issues < 0) throw new Error('Invalid data-quality scan result')
  return issues
}

export async function scanMeteringPointDataQuality(companyId: string, meteringPointId: string): Promise<number> {
  return scan(companyId, monthStart(), meteringPointId)
}

export async function scanCompanyDataQuality(companyId: string, month = monthStart()): Promise<{ issues: number }> {
  return { issues: await scan(companyId, month, null) }
}
