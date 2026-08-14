import { supabaseService } from '@/lib/supabase/service'

export const REQUIRED_PRODUCTION_EVIDENCE = ['TGT', 'AGT', 'SHADOW_PRODUCTION', 'LIMITED_PILOT', 'LIVE_TENANT_INTEGRITY', 'RESTORE_REPLAY'] as const
export type EdielCertificationEvidenceType = typeof REQUIRED_PRODUCTION_EVIDENCE[number]
export const CANONICAL_ENGINE_SCHEMA_VERSION = '20260713100000-ediel-completion-and-platform-contract'

export type EdielCertificationEvidenceRecord = {
  id: string
  company_id: string
  environment: string
  evidence_type: string
  status: string
  engine_schema_version: string
  external_reference: string | null
  evidence_document_reference: string | null
  tested_at: string | null
  approved_at: string | null
  approved_by: string | null
  valid_until: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type EvidenceRow = {
  evidence_type?: unknown
  status?: unknown
  external_reference?: unknown
  evidence_document_reference?: unknown
  tested_at?: unknown
  approved_at?: unknown
  approved_by?: unknown
  valid_until?: unknown
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function timestamp(value: unknown): number | null {
  const normalized = text(value)
  if (!normalized) return null
  const parsed = new Date(normalized).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

export function isEdielCertificationEvidenceApproved(
  row: EvidenceRow,
  now: number = Date.now(),
): boolean {
  if (text(row.status) !== 'passed') return false
  if (!text(row.external_reference) || !text(row.evidence_document_reference)) return false
  if (!text(row.approved_by) || !timestamp(row.approved_at)) return false

  const testedAt = timestamp(row.tested_at)
  if (!testedAt || testedAt > now) return false

  const validUntil = timestamp(row.valid_until)
  if (text(row.valid_until) && !validUntil) return false
  if (validUntil && validUntil <= now) return false
  if (validUntil && validUntil <= testedAt) return false

  return true
}

export async function listEdielCertificationEvidence(companyId: string): Promise<EdielCertificationEvidenceRecord[]> {
  const normalizedCompanyId = text(companyId)
  if (!normalizedCompanyId) throw new Error('certification_evidence_company_required')
  const { data, error } = await supabaseService
    .from('ediel_certification_evidence')
    .select('id,company_id,environment,evidence_type,status,engine_schema_version,external_reference,evidence_document_reference,tested_at,approved_at,approved_by,valid_until,metadata,created_at,updated_at')
    .eq('company_id', normalizedCompanyId)
    .eq('environment', 'production')
    .eq('engine_schema_version', CANONICAL_ENGINE_SCHEMA_VERSION)
    .order('evidence_type', { ascending: true })
  if (error) throw error
  return (data ?? []) as EdielCertificationEvidenceRecord[]
}

export async function getEdielCertificationEvidenceReadiness(companyId: string) {
  const normalizedCompanyId = text(companyId)
  if (!normalizedCompanyId) throw new Error('certification_evidence_company_required')
  const { data, error } = await supabaseService
    .from('ediel_certification_evidence')
    .select('evidence_type,status,external_reference,evidence_document_reference,tested_at,approved_at,approved_by,valid_until')
    .eq('company_id', normalizedCompanyId)
    .eq('environment', 'production')
    .eq('engine_schema_version', CANONICAL_ENGINE_SCHEMA_VERSION)
  if (error) throw error
  const now = Date.now()
  const rows = (data ?? []) as EvidenceRow[]
  const passed = new Set(
    rows
      .filter((row) => isEdielCertificationEvidenceApproved(row, now))
      .map((row) => text(row.evidence_type))
      .filter((value): value is string => Boolean(value)),
  )
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

  const externalReference = text(input.externalReference)
  const evidenceDocumentReference = text(input.evidenceDocumentReference)
  const testedAt = text(input.testedAt)
  const approvedBy = text(input.approvedBy)
  const validUntil = text(input.validUntil)
  const nowMs = Date.now()
  const testedAtMs = timestamp(testedAt)
  const validUntilMs = timestamp(validUntil)

  if (input.status === 'passed') {
    if (!approvedBy) throw new Error('certification_evidence_approver_required')
    if (!externalReference) throw new Error('certification_evidence_external_reference_required')
    if (!evidenceDocumentReference) throw new Error('certification_evidence_document_reference_required')
    if (!testedAtMs) throw new Error('certification_evidence_tested_at_required')
    if (testedAtMs > nowMs) throw new Error('certification_evidence_tested_at_future')
    if (validUntil && !validUntilMs) throw new Error('certification_evidence_valid_until_invalid')
    if (validUntilMs && validUntilMs <= nowMs) throw new Error('certification_evidence_already_expired')
    if (validUntilMs && validUntilMs <= testedAtMs) throw new Error('certification_evidence_valid_until_before_test')
  }

  const now = new Date(nowMs).toISOString()
  const { data, error } = await supabaseService.from('ediel_certification_evidence').upsert({
    company_id: companyId,
    environment: 'production',
    evidence_type: input.evidenceType,
    status: input.status,
    engine_schema_version: CANONICAL_ENGINE_SCHEMA_VERSION,
    external_reference: externalReference,
    evidence_document_reference: evidenceDocumentReference,
    tested_at: testedAt,
    valid_until: validUntil,
    approved_by: approvedBy,
    approved_at: input.status === 'passed' ? now : null,
    metadata: input.metadata ?? {},
    updated_at: now,
  }, { onConflict: 'company_id,environment,evidence_type,engine_schema_version' }).select('*').single()
  if (error) throw error
  return data
}
