// Operator-only backfill; ordinary test runs skip without importing a DB client.
// Scope is the observed signed website_api capture, never consent/IP repair.
import { test } from 'vitest'
import { createHash } from 'node:crypto'
import type { Database } from '@/supabase/database.types'

type Poa = Database['public']['Tables']['powers_of_attorney']['Row']
type Row = Record<string, unknown>
const ENABLED = process.env.GRIDEX_BACKFILL_LEGACY_POA_ARCHIVES === '1'
const MAX_BATCH = 5
const HOST = 'piidsfebjqjmnepdpnas.supabase.co'
const BUCKET = 'customer-documents'
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const plainObject = (value: unknown): boolean => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

// Fixed error codes only: matcher diffs, helper errors and row/path values must
// never reach Vitest output, even when a postcondition fails after a write.
class Refusal extends Error {
  constructor(readonly code: string) { super(code) }
}
function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Refusal(code)
}
function requireProject(raw: unknown): void {
  let valid = false
  try {
    const url = new URL(typeof raw === 'string' ? raw : '')
    valid = url.protocol === 'https:' && url.host === HOST && url.pathname === '/'
      && !url.username && !url.password && !url.search && !url.hash
  } catch { /* Refuse without printing the supplied URL. */ }
  requireCondition(valid, 'POA_BACKFILL_WRONG_PROJECT')
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable((value as Row)[key])]))
  return value
}
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
function retainedConsent(row: Poa): string {
  const preserved = structuredClone(row) as Row
  delete preserved.document_path
  delete preserved.updated_at
  const metadata = object(preserved.metadata), evidence = object(preserved.evidence_payload)
  delete metadata.document_archive
  delete evidence.verification_reference
  return digest({ ...preserved, metadata, evidence_payload: evidence })
}
const pdfEscape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[\r\n\t]+/g, ' ')

test.skipIf(!ENABLED)('archives at most five recorded signed website API consents in the production OPS project', async () => {
  const counts = { eligible: 0, attempted: 0, completed: 0, requires_signature_completion: 0 }
  let phase = 'preflight'
  try {
    // The fixture setup's default unit-test URL fails here before any DB import.
    requireProject(process.env.NEXT_PUBLIC_SUPABASE_URL)
    const [{ supabaseService, SUPABASE_SERVICE_URL }, { tenantSelect }, { tenantDb },
      { ensurePoaPdfArchive }, { poaMailEvidence, poaMailEvidenceFingerprint },
      { renderFullmaktPdf }, { inspectPdfStructure }, { publicReference }] = await Promise.all([
      import('@/lib/supabase/service'), import('@/lib/supabase/tenantQuery'), import('@/lib/supabase/tenantDb'),
      import('@/lib/customers/poaDocuments'), import('@/lib/email/poaMailEvidence'),
      import('@/lib/email/fullmaktPdf'), import('@/lib/documents/pdfStructure'), import('@/lib/integrations/publicReferences'),
    ])
    requireProject(SUPABASE_SERVICE_URL)

    // Deliberately global discovery with an exact capture/status predicate and
    // a sixth-row sentinel. All subsequent reads use the discovered tenant.
    const candidates = await supabaseService.from('powers_of_attorney').select('*')
      .eq('source', 'website_api').eq('status', 'signed').is('document_path', null)
      .order('created_at', { ascending: true }).limit(MAX_BATCH + 1)
    requireCondition(!candidates.error && Array.isArray(candidates.data), 'POA_BACKFILL_DISCOVERY_FAILED')
    requireCondition(candidates.data.length <= MAX_BATCH, 'POA_BACKFILL_BATCH_LIMIT')
    const rows = candidates.data as Poa[]
    counts.eligible = rows.length

    const read = async (row: Poa): Promise<Poa> => {
      const result = await tenantSelect(row.company_id!, 'powers_of_attorney')
        .eq('customer_id', row.customer_id).eq('id', row.id).maybeSingle()
      requireCondition(!result.error && result.data, 'POA_BACKFILL_REREAD_FAILED')
      return result.data as Poa
    }
    const readAuthorizationOriginals = async (row: Poa): Promise<Row[]> => {
      const result = await tenantSelect(row.company_id!, 'customer_authorization_documents')
        .eq('customer_id', row.customer_id).eq('power_of_attorney_id', row.id).order('id', { ascending: true }).limit(MAX_BATCH + 1)
      requireCondition(!result.error && Array.isArray(result.data) && result.data.length <= MAX_BATCH, 'POA_BACKFILL_AUTHORIZATION_READ_FAILED')
      return result.data as Row[]
    }

    // Complete ALL eligibility, ownership, immutable snapshots and pure PDF
    // preflights before invoking the sole write helper for any candidate.
    const plans = []
    for (const row of rows) {
      requireCondition(row.source === 'website_api' && row.status === 'signed' && row.document_path === null,
        'POA_BACKFILL_INELIGIBLE_CAPTURE')
      requireCondition(text(row.id) && text(row.company_id) && text(row.customer_id), 'POA_BACKFILL_SCOPE_MISSING')
      requireCondition(plainObject(row.evidence_payload) && plainObject(row.fullmakt_snapshot) && plainObject(row.metadata),
        'POA_BACKFILL_CAPTURE_SHAPE_INVALID')
      const previousArchive = object(row.metadata).document_archive
      requireCondition(previousArchive == null || plainObject(previousArchive) && Object.keys(object(previousArchive)).length === 0,
        'POA_BACKFILL_EXISTING_ARCHIVE_REQUIRES_SEPARATE_REVIEW')
      const siteId = text(row.customer_site_id) ?? text(row.site_id)
      requireCondition(siteId && !(row.customer_site_id && row.site_id && row.customer_site_id !== row.site_id), 'POA_BACKFILL_SITE_SCOPE_INVALID')
      const proof = poaMailEvidence(row)
      const acceptance = text(row.accepted_at) ?? text(row.signed_at)
      requireCondition(acceptance && Number.isFinite(Date.parse(acceptance)) && text(row.signer_name)
        && text(row.signer_identity_number) && text(row.method) && proof.legalText && Array.isArray(row.signed_scope_snapshot)
        && row.signed_scope_snapshot.length > 0 && row.signed_scope_snapshot.every(scope => typeof scope === 'string' && text(scope)),
      'POA_BACKFILL_ORIGINAL_CONSENT_INCOMPLETE')
      // Adding a verifier must not normalize/promote an old IP into new proof.
      requireCondition(!proof.signerIpAddress || object(row.evidence_payload).ip_address === proof.signerIpAddress,
        'POA_BACKFILL_SIGNER_IP_REQUIRES_SEPARATE_REVIEW')
      const [companyResult, customerResult, siteResult, authorizationOriginals] = await Promise.all([
        // companies is keyed by tenant id, with no company_id column.
        tenantDb(row.company_id).unscoped().from('companies').select('*').eq('id', row.company_id!).maybeSingle(),
        tenantSelect(row.company_id!, 'customers').eq('id', row.customer_id).maybeSingle(),
        tenantSelect(row.company_id!, 'customer_sites').eq('customer_id', row.customer_id).eq('id', siteId).maybeSingle(),
        readAuthorizationOriginals(row),
      ])
      const customer = object(customerResult.data), company = object(companyResult.data), site = object(siteResult.data)
      requireCondition(!companyResult.error && !customerResult.error && !siteResult.error
        && company.id === row.company_id && customer.id === row.customer_id
        && customer.company_id === row.company_id && site.id === siteId
        && site.company_id === row.company_id && site.customer_id === row.customer_id,
      'POA_BACKFILL_CANONICAL_OWNERSHIP_INVALID')
      requireCondition(!row.document_id || authorizationOriginals.some(document => document.id === row.document_id
        && document.company_id === row.company_id && document.customer_id === row.customer_id && document.power_of_attorney_id === row.id),
      'POA_BACKFILL_ORIGINAL_AUTHORIZATION_MISMATCH')
      requireCondition(authorizationOriginals.every(document => !document.site_id || document.site_id === siteId),
        'POA_BACKFILL_ORIGINAL_AUTHORIZATION_SITE_MISMATCH')
      const verification = proof.verificationReference ?? publicReference('poa_verification', row.company_id!, row.id)
      requireCondition(verification && proof.reference && /^[\x20-\x7e]{1,64}$/.test(proof.reference), 'POA_BACKFILL_REFERENCE_INVALID')
      const frozen = object(object(row.fullmakt_snapshot).customer)
      // Pure renderer only; it catches unsupported legal text/fonts/page count
      // before any reference or archive is added to any row.
      const preview = renderFullmaktPdf({ powerOfAttorneyId: row.id, reference: proof.reference,
        customerName: text(frozen.name) ?? text(customer.company_name) ?? text(customer.full_name),
        customerIdentity: text(frozen.identity) ?? text(customer.org_number) ?? text(customer.personal_number),
        siteAddress: text(site.street), sitePostalCode: text(site.postal_code), siteCity: text(site.city),
        representativeName: text(company.legal_name) ?? text(company.name), representativeOrganizationNumber: text(company.org_number),
        legalTextTitle: proof.legalTextTitle, legalTextVersion: proof.legalTextVersion, legalTextVersionId: row.legal_text_version_id,
        legalText: proof.legalText, signedScopes: proof.signedScopes, verificationReference: verification,
        signerIpAddress: proof.signerIpAddress, bankidVerified: proof.bankidVerified, bankidReference: proof.bankidReference,
        acceptedAt: text(row.accepted_at) ?? text(row.signed_at), signerName: text(row.signer_name),
        signerIdentityNumber: text(row.signer_identity_number), method: text(row.method), source: text(row.source) })
      requireCondition(inspectPdfStructure(preview).ok, 'POA_BACKFILL_PREFLIGHT_PDF_INVALID')
      const previewPath = `companies/${row.company_id}/customers/${row.customer_id}/powers-of-attorney/${row.id}/fullmakt-${sha(preview)}.pdf`
      requireCondition(!authorizationOriginals.some(document => (document.storage_bucket ?? BUCKET) === BUCKET && document.file_path === previewPath),
        'POA_BACKFILL_ORIGINAL_PATH_COLLISION')
      plans.push({ row, siteId, verification, reference: proof.reference, previewHash: sha(preview),
        retainedDigest: retainedConsent(row), originalDigest: digest(authorizationOriginals) })
      if (!proof.signerIpAddress && !proof.bankidVerified) counts.requires_signature_completion++
    }
    // Recheck the whole prepared batch, not merely the first row, before writing.
    for (const plan of plans) {
      requireCondition(digest(await read(plan.row)) === digest(plan.row), 'POA_BACKFILL_CAPTURE_CHANGED_BEFORE_WRITE')
      requireCondition(digest(await readAuthorizationOriginals(plan.row)) === plan.originalDigest, 'POA_BACKFILL_ORIGINAL_CHANGED_BEFORE_WRITE')
    }

    phase = 'archive'
    for (const plan of plans) {
      requireCondition(digest(await read(plan.row)) === digest(plan.row), 'POA_BACKFILL_CAPTURE_CHANGED_BEFORE_WRITE')
      const scope = { companyId: plan.row.company_id!, customerId: plan.row.customer_id!, powerOfAttorneyId: plan.row.id }
      // Sole mutation path. No manual storage upload, consent/IP/CAD update,
      // email/provider dispatch, market permission or original-file rewrite.
      counts.attempted++
      const archived = await ensurePoaPdfArchive(scope)
      phase = 'verify'
      const after = await read(plan.row), proof = poaMailEvidence(after)
      requireCondition(retainedConsent(after) === plan.retainedDigest, 'POA_BACKFILL_RETAINED_CAPTURE_CHANGED')
      requireCondition(proof.verificationReference === plan.verification, 'POA_BACKFILL_VERIFICATION_REFERENCE_INVALID')
      requireCondition(digest(await readAuthorizationOriginals(plan.row)) === plan.originalDigest, 'POA_BACKFILL_ORIGINAL_CHANGED')
      const hash = sha(archived.pdf), archive = object(object(after.metadata).document_archive)
      const expectedPath = `companies/${scope.companyId}/customers/${scope.customerId}/powers-of-attorney/${scope.powerOfAttorneyId}/fullmakt-${hash}.pdf`
      requireCondition(inspectPdfStructure(archived.pdf).ok && hash === plan.previewHash, 'POA_BACKFILL_ARCHIVED_PDF_INVALID')
      requireCondition(archived.path === expectedPath && after.document_path === expectedPath && archive.path === expectedPath
        && archive.storage_bucket === BUCKET && archive.sha256 === hash && archive.verification_number === plan.verification
        && archive.evidence_sha256 === poaMailEvidenceFingerprint(after) && typeof archive.saved_at === 'string'
        && Number.isFinite(Date.parse(archive.saved_at)), 'POA_BACKFILL_ARCHIVE_MANIFEST_INVALID')
      const pdf = archived.pdf.toString('latin1'), pages = (pdf.match(/\/Type\s*\/Page\b/g) ?? []).length
      requireCondition(pages > 0 && pdf.split(pdfEscape(`Verifikatsnummer: ${plan.verification}`)).length - 1 >= pages
        && pdf.split(pdfEscape(`Fullmaktsreferens: ${plan.reference}`)).length - 1 === pages, 'POA_BACKFILL_PDF_REFERENCE_MISSING')
      const repeated = await ensurePoaPdfArchive(scope)
      requireCondition(repeated.path === archived.path && sha(repeated.pdf) === hash
        && digest(await read(plan.row)) === digest(after), 'POA_BACKFILL_IDEMPOTENCY_FAILED')
      requireCondition(digest(await readAuthorizationOriginals(plan.row)) === plan.originalDigest, 'POA_BACKFILL_ORIGINAL_CHANGED')
      counts.completed++
      phase = 'archive'
    }
    console.log(JSON.stringify({ status: 'completed', ...counts }))
  } catch (error) {
    const code = error instanceof Refusal ? error.code : 'POA_BACKFILL_OPERATION_FAILED'
    console.log(JSON.stringify({ status: 'failed', phase, code, ...counts }))
    // Earlier per-row helper commits can remain if a later row fails. Preserve
    // those originals and stop; this operation makes no batch rollback claim.
    throw new Error(code)
  }
}, 120_000)
