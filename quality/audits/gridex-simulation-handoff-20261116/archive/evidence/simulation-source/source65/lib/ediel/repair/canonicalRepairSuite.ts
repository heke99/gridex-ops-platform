import { supabaseService } from '@/lib/supabase/service'

type RepairRunRow = {
  id: string
  company_id: string | null
  mode: 'scan' | 'safe_repair'
  status: string
  counters: Record<string, unknown>
  started_at: string
  completed_at: string | null
}

export type CanonicalRepairIssue = {
  id: string
  run_id: string
  company_id: string | null
  issue_fingerprint: string
  issue_type: string
  entity_type: string
  entity_id: string | null
  severity: 'warning' | 'error' | 'critical'
  status: 'open' | 'repaired' | 'ignored'
  details: Record<string, unknown>
  repaired_at: string | null
  created_at: string
}

function required(value: string | null | undefined, code: string): string {
  const clean = String(value ?? '').trim()
  if (!clean) throw new Error(code)
  return clean
}

export async function runCanonicalEdielRepairSuite(input: {
  companyId?: string | null
  applySafeRepairs?: boolean
  actorUserId: string
}): Promise<{ run: RepairRunRow; issues: CanonicalRepairIssue[] }> {
  const actorUserId = required(input.actorUserId, 'ediel_repair_actor_user_id_required')
  const { data: runId, error: runError } = await supabaseService.rpc('gridex_scan_ediel_canonical_repairs', {
    p_company_id: input.companyId ?? null,
    p_apply_safe_repairs: input.applySafeRepairs === true,
    p_actor_user_id: actorUserId,
  })
  if (runError) throw new Error(`ediel_canonical_repair_failed:${String(runError.message ?? runError)}`)
  const id = required(String(runId ?? ''), 'ediel_canonical_repair_run_id_missing')

  const [{ data: run, error: readRunError }, { data: issues, error: issuesError }] = await Promise.all([
    supabaseService.from('ediel_repair_runs').select('*').eq('id', id).single(),
    supabaseService.from('ediel_repair_issues').select('*').eq('run_id', id).order('severity', { ascending: false }).order('created_at', { ascending: true }),
  ])
  if (readRunError) throw readRunError
  if (issuesError) throw issuesError
  return { run: run as RepairRunRow, issues: (issues ?? []) as CanonicalRepairIssue[] }
}
