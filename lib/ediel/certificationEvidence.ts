import { supabaseService } from '@/lib/supabase/service'

export const REQUIRED_PRODUCTION_EVIDENCE = ['TGT', 'AGT', 'SHADOW_PRODUCTION', 'LIMITED_PILOT', 'LIVE_TENANT_INTEGRITY', 'RESTORE_REPLAY'] as const
export type EdielCertificationEvidenceType = typeof REQUIRED_PRODUCTION_EVIDENCE[number]
export const CANONICAL_ENGINE_SCHEMA_VERSION = '20260713100000-ediel-completion-and-platform-contract'

type EvidenceRow = {
  evidence_type?: unknown
  status?: unknown
  engine_schema_version?: unknown
  approved_at?: unknown
  valid_until?: unknown
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function getEdielCertificationEvidenceReadiness(companyId: string) {
  const normalizedCompanyId = text(companyId)
  if (!normalizedCompanyId) throw new Error('certification_evidence_company_required')
  const { data, error } = await supabaseService
    .from('ediel_certification_evidence')
    .select('evidence_type,status,engine_schema_version,approved_at,valid_until')
    .eq('company_id', normalizedCompanyId)
    .eq('environment', 'production')
    .eq('engine_schema_version', CANONICAL_ENGINE_SCHEMA_VERSION)
  if (error) throw error
  const now = Date.now()
  const rows = (data ?? []) as EvidenceRow[]
  const passed = new Set(rows.filter((row) => {
    if (text(row.status) !== 'passed' || !text(row.approved_at)) return false
    const validUntil = text(row.valid_until)
    return !validUntil || new Date(validUntil).getTime() > now
  }).map((row) => text(row.evidence_type)).filter((value): value is string => Boolean(value)))
  const missing = REQUIRED_PRODUCTION_EVIDENCE.filter((type) => !passed.has(type))
  return { ready: missing.length === 0, passed: [...passed], missing }
}

export async function recordEdielCertificationEvidence(input: {
  companyId: string
  evidenceType: EdielCertificationEvidenceType
  status: 'pending' | 'passed' | 'failed' | 'expired' | 'revoked'
  externalReference?: string | null
  evidenceDocumentReference?: string | null
  testedAt?: string | null
  validUntil?: string | null
  approvedBy?: string | null
  metadata?: Record<string, unknown>
}) {
  const companyId = text(input.companyId)
  if (!companyId) throw new Error('certification_evidence_company_required')
  if (input.status === 'passed' && !text(input.approvedBy)) throw new Error('certification_evidence_approver_required')
  const now = new Date().toISOString()
  const { data, error } = await supabaseService.from('ediel_certification_evidence').upsert({
    company_id: companyId,
    environment: 'production',
    evidence_type: input.evidenceType,
    status: input.status,
    engine_schema_version: CANONICAL_ENGINE_SCHEMA_VERSION,
    external_reference: text(input.externalReference),
    evidence_document_reference: text(input.evidenceDocumentReference),
    tested_at: text(input.testedAt),
    valid_until: text(input.validUntil),
    approved_by: text(input.approvedBy),
    approved_at: input.status === 'passed' ? now : null,
    metadata: input.metadata ?? {},
    updated_at: now,
  }, { onConflict: 'company_id,environment,evidence_type,engine_schema_version' }).select('*').single()
  if (error) throw error
  return data
}
