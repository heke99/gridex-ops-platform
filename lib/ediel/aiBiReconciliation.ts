// lib/ediel/aiBiReconciliation.ts
//
// Batch 8: AI/BI list import is reconciliation, not automatic masterdata overwrite.
// The import engine only creates reconciliation runs, parsed rows and discrepancy
// rows. Masterdata changes (customer_sites.facility_id, metering_points,
// contracts, supplier_switch_requests) happen ONLY after explicit admin approval
// or a deterministic safe match rule, always with an audit trail. This module
// owns the approval workflow + audit; it never auto-overwrites masterdata.

import { supabaseService } from '@/lib/supabase/service'

// Masterdata tables the AI/BI import path must never write to automatically.
export const AI_BI_PROTECTED_MASTERDATA_TABLES = [
  'customer_sites',
  'metering_points',
  'contracts',
  'customer_contracts',
  'supplier_switch_requests',
] as const

export type AiBiProtectedMasterdataTable = (typeof AI_BI_PROTECTED_MASTERDATA_TABLES)[number]

export function isProtectedMasterdataTable(table: string): table is AiBiProtectedMasterdataTable {
  return (AI_BI_PROTECTED_MASTERDATA_TABLES as readonly string[]).includes(table)
}

// Defensive guard: any code path attempting an automatic masterdata write as part
// of AI/BI import must call this and be rejected.
export function assertAiBiNeverOverwritesMasterdata(table: string): void {
  if (isProtectedMasterdataTable(table)) {
    throw new Error(
      `ai_bi_no_auto_overwrite: AI/BI-import får inte automatiskt skriva till ${table}. Ändringar kräver admin-godkännande med revisionsspår.`,
    )
  }
}

// Default retention policy for imported raw payloads (GDPR). Conservative default;
// overridable per import/company policy.
export const AI_BI_DEFAULT_RETENTION_DAYS = 365

export function defaultRetentionUntil(now: Date = new Date()): string {
  const until = new Date(now.getTime() + AI_BI_DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  return until.toISOString().slice(0, 10)
}

function isMissingSchema(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(code) || /schema cache|does not exist/i.test(message)
}

export type AiBiDiscrepancyDecision = 'accepted' | 'rejected' | 'accepted_manual_apply'

// Records an admin decision on a discrepancy with full audit. This never performs
// an automatic masterdata write; "accepted" only authorizes a subsequent, audited
// deterministic-safe apply step. Tenant isolation via company_id.
export async function approveAiBiDiscrepancy(input: {
  companyId: string
  discrepancyId: string
  decision: AiBiDiscrepancyDecision
  actorUserId: string
  note?: string | null
}): Promise<{ ok: boolean; discrepancyId: string; decision: AiBiDiscrepancyDecision; reason?: string }> {
  const nowIso = new Date().toISOString()
  const status = input.decision === 'rejected' ? 'rejected' : 'resolved'
  const { error } = await supabaseService
    .from('ai_list_discrepancies')
    .update({
      status,
      resolution: input.decision,
      resolution_note: input.note ?? null,
      resolved_by: input.actorUserId,
      resolved_at: nowIso,
      // applied_by/applied_at only set when a safe apply is actually performed.
    })
    .eq('company_id', input.companyId)
    .eq('id', input.discrepancyId)

  if (error) {
    if (isMissingSchema(error)) return { ok: false, discrepancyId: input.discrepancyId, decision: input.decision, reason: 'reconciliation_schema_missing' }
    throw error
  }
  return { ok: true, discrepancyId: input.discrepancyId, decision: input.decision }
}
