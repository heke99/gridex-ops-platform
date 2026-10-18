import { createHash } from 'node:crypto'
import { ApiInputError } from '@/lib/api/strictRequest'
import { supabaseService } from '@/lib/supabase/service'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { publicReference } from '@/lib/integrations/publicReferences'
import { poaMailEvidence, poaMailEvidenceFingerprint } from '@/lib/email/poaMailEvidence'
import { inspectPdfStructure } from '@/lib/documents/pdfStructure'
import { requirePortalRetentionAccess } from '@/lib/ediel/retention/customerRecordClasses'
import { canonicalPortalCustomer } from '@/lib/customer-portal/customerLifecycle'
import { buildPortalDatabasePage, decodePortalCursor, PortalCursorError } from '@/lib/customer-portal/keysetPagination'

type Row = Record<string, unknown>
export type PoaArchiveCustomerScope = { companyId: string; customerId: string }
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const HASH = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
const RESOURCE = 'poa-archive-evidence'
const BUCKET = 'customer-documents'
const MAX_PDF_BYTES = 15 * 1024 * 1024
const API_PATH = '/api/v1/customer/powers-of-attorney/evidence'

export function isPoaVerificationReference(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value) && !UUID.test(value)
}
function unavailable(): never {
  throw new ApiInputError('Fullmaktens arkiverade original kunde inte verifieras. Kontakta kundtjänst.', 'poa_archive_unavailable', 409)
}
function assertRowScope(row: Row, scope: PoaArchiveCustomerScope) {
  if (row.company_id !== scope.companyId || row.customer_id !== scope.customerId || !UUID.test(String(row.id))) unavailable()
}
function archiveBinding(row: Row, scope: PoaArchiveCustomerScope) {
  assertRowScope(row, scope)
  const archive = record(record(row.metadata).document_archive), proof = poaMailEvidence(row)
  const path = clean(row.document_path), hash = clean(archive.sha256)
  if (!path || !hash || !HASH.test(hash) || archive.path !== path || archive.storage_bucket !== BUCKET
    || archive.evidence_sha256 !== poaMailEvidenceFingerprint(row)
    || !isPoaVerificationReference(proof.verificationReference) || archive.verification_number !== proof.verificationReference) unavailable()
  const parts = /^companies\/([A-Za-z0-9_-]+)\/customers\/([A-Za-z0-9_-]+)\/powers-of-attorney\/([A-Za-z0-9_-]+)\/fullmakt-([a-f0-9]{64})\.pdf$/.exec(path)
  if (!parts || parts[1] !== scope.companyId || parts[3] !== row.id || parts[4] !== hash) unavailable()
  return { path, hash, ownerCustomerId: parts[2], verificationReference: proof.verificationReference }
}

// A tenant/customer assertion never authorizes arbitrary former storage prefixes.
// Reuse canonical resolution, requiring the archive writer's exact merge-event
// evidence at every hop before an immutable original can follow its moved POA.
async function requireArchiveOwner(ownerId: string, scope: PoaArchiveCustomerScope) {
  if (ownerId === scope.customerId) return
  const load = async (id: string) => {
    const result = await tenantSelect(scope.companyId, 'customers', 'id,company_id,status,merge_status,merged_into_customer_id,merged_at,merged_by').eq('id', id).maybeSingle()
    if (result.error) throw result.error
    return result.data as Row | null
  }
  let prior = await load(ownerId)
  if (!prior) unavailable()
  const canonical = await canonicalPortalCustomer({ companyId: scope.companyId, customer: prior, allowMergedAlias: true,
    load: async next => {
      const source = prior!
      if (source.merge_status !== 'merged' || !['inactive', 'archived'].includes(String(source.status))
        || !clean(source.merged_by) || !clean(source.merged_at) || !Number.isFinite(Date.parse(String(source.merged_at)))) return null
      const events = await tenantSelect(scope.companyId, 'customer_merge_events', 'primary_customer_id,merged_customer_id,moved_counts,source_snapshot,created_by,created_at')
        .eq('merged_customer_id', String(source.id)).eq('primary_customer_id', next).eq('created_by', String(source.merged_by)).limit(2)
      if (events.error) throw events.error
      const rows = (events.data ?? []) as Row[], event = rows[0], moved = record(event?.moved_counts).powers_of_attorney
      if (rows.length !== 1 || record(event?.source_snapshot).id !== source.id || !Number.isInteger(moved) || Number(moved) < 1
        || typeof event.created_at !== 'string' || Date.parse(event.created_at) !== Date.parse(String(source.merged_at))) return null
      prior = await load(next)
      return prior
    },
  })
  if (!canonical || canonical.id !== scope.customerId) unavailable()
}

function projection(row: Row, scope: PoaArchiveCustomerScope) {
  assertRowScope(row, scope)
  const proof = poaMailEvidence(row), reference = isPoaVerificationReference(proof.verificationReference) ? proof.verificationReference : null
  let status: 'missing' | 'incomplete_evidence' | 'archived_unverified' | 'unavailable' = !row.document_path ? 'missing' : !reference ? 'incomplete_evidence' : 'archived_unverified'
  if (status === 'archived_unverified') {
    try { archiveBinding(row, scope) } catch { status = 'unavailable' }
  }
  return {
    power_of_attorney_reference: publicReference('power_of_attorney', scope.companyId, row.id),
    verification_reference: reference,
    consent_status: clean(row.status),
    archive_status: status,
    archived_sha256: status === 'archived_unverified' ? String(record(record(row.metadata).document_archive).sha256) : null,
    download_url: reference && status === 'archived_unverified' ? `${API_PATH}/${encodeURIComponent(reference)}?format=pdf` : null,
  }
}

export async function listCustomerPoaArchives(scope: PoaArchiveCustomerScope, input: { limit: number; cursor: string | null }) {
  await requirePortalRetentionAccess(scope)
  let cursor
  try { cursor = decodePortalCursor({ ...scope, resource: RESOURCE, cursor: input.cursor }) }
  catch (error) {
    if (error instanceof PortalCursorError) throw new ApiInputError('Ogiltig sidmarkör.', 'invalid_cursor', 400, 'cursor')
    throw error
  }
  if (cursor && cursor.orderValue !== cursor.id) throw new ApiInputError('Ogiltig sidmarkör.', 'invalid_cursor', 400, 'cursor')
  let query = tenantSelect(scope.companyId, 'powers_of_attorney').eq('customer_id', scope.customerId).order('id', { ascending: true }).limit(input.limit + 1)
  if (cursor) query = query.gt('id', cursor.id)
  const { data, error } = await query
  if (error) throw error
  const page = buildPortalDatabasePage((data ?? []) as Row[], { ...scope, resource: RESOURCE, limit: input.limit, orderColumn: 'id' })
  await requirePortalRetentionAccess(scope)
  return { data: page.items.map(row => projection(row, scope)), page: page.page }
}

async function readRow(scope: PoaArchiveCustomerScope, reference: string): Promise<Row> {
  const { data, error } = await tenantSelect(scope.companyId, 'powers_of_attorney').eq('customer_id', scope.customerId)
    .eq('evidence_payload->>verification_reference', reference).limit(2)
  if (error) throw error
  const rows = (data ?? []) as Row[]
  if (!rows.length) throw new ApiInputError('Fullmakten hittades inte.', 'poa_document_not_found', 404)
  if (rows.length !== 1) unavailable()
  assertRowScope(rows[0], scope)
  return rows[0]
}
function sourceBinding(row: Row) {
  return JSON.stringify([row.id, row.company_id, row.customer_id, row.document_path, row.updated_at, row.status,
    record(row.metadata).document_archive, poaMailEvidenceFingerprint(row)])
}

/** Read only: consent completion, PDF rendering/upload and archive writes are forbidden here. */
export async function readCustomerPoaArchive(scope: PoaArchiveCustomerScope, reference: string, submittedSha256: string | null) {
  await requirePortalRetentionAccess(scope)
  const row = await readRow(scope, reference), binding = archiveBinding(row, scope), before = sourceBinding(row)
  await requireArchiveOwner(binding.ownerCustomerId, scope)
  const { data, error } = await supabaseService.storage.from(BUCKET).download(binding.path)
  if (error || !data || !Number.isSafeInteger(data.size) || data.size < 1 || data.size > MAX_PDF_BYTES) unavailable()
  const pdf = Buffer.from(await data.arrayBuffer())
  const hash = createHash('sha256').update(pdf).digest('hex')
  if (pdf.length !== data.size || hash !== binding.hash || !inspectPdfStructure(pdf).ok) unavailable()
  const current = await readRow(scope, reference)
  if (sourceBinding(current) !== before) unavailable()
  await requirePortalRetentionAccess(scope)
  const proof = poaMailEvidence(row)
  const validTime = (value: unknown) => clean(value) && Number.isFinite(Date.parse(String(value))) ? String(value) : null
  const accepted = validTime(row.accepted_at), signed = validTime(row.signed_at)
  const acceptedAt = accepted ?? signed
  return { pdf, data: {
    ...projection(row, scope), archive_integrity: 'verified' as const, sha256: hash,
    submitted_sha256_matches: submittedSha256 ? submittedSha256 === hash : null,
    accepted_at: acceptedAt,
    accepted_at_source: accepted ? 'accepted_at' : signed ? 'signed_at' : null,
    signer_ip_address: proof.signerIpAddress, signer_ip_source: proof.signerIpAddress ? 'signer_reported' : null,
    capture_issues: [
      ...(!acceptedAt || !Number.isFinite(Date.parse(acceptedAt)) ? ['poa_acceptance_time_missing'] : []),
      ...(!proof.signerIpAddress && !proof.bankidVerified ? ['poa_signer_ip_missing'] : []),
    ],
    bankid_verified: proof.bankidVerified, pdf_signature_validation: 'not_performed' as const,
    legal_text_version: proof.legalTextVersion, signed_scopes: proof.signedScopes,
  } }
}
