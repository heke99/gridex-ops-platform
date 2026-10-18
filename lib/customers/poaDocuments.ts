import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { renderFullmaktPdf } from '@/lib/email/fullmaktPdf'
import { poaMailEvidence, poaMailEvidenceFingerprint } from '@/lib/email/poaMailEvidence'
import { inspectPdfStructure } from '@/lib/documents/pdfStructure'
import { ensurePoaVerificationReference } from './poaEvidenceCompletion'

type Row = Record<string, unknown>
export type PoaDocumentScope = { companyId: string; customerId: string; powerOfAttorneyId: string }
const clean = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const BUCKET = 'customer-documents'
const evidenceFingerprint = poaMailEvidenceFingerprint

export function assertPoaDocumentPath(path: string, scope: PoaDocumentScope): void {
  const canonical = `companies/${scope.companyId}/customers/${scope.customerId}/`
  const legacy = `${scope.customerId}/`
  if ((!path.startsWith(canonical) && !path.startsWith(legacy)) || path.split('/').includes('..')) {
    throw new Error('Fullmaktsdokumentets lagringsväg tillhör inte kunden och tenantens dokumentutrymme.')
  }
}

async function readPoa(scope: PoaDocumentScope): Promise<Row> {
  const { data, error } = await supabaseService.from('powers_of_attorney').select('*')
    .eq('company_id', scope.companyId).eq('customer_id', scope.customerId).eq('id', scope.powerOfAttorneyId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Fullmakten hittades inte.')
  return data as Row
}

async function download(path: string, scope: PoaDocumentScope, verifiedPartnerOriginal = false): Promise<Buffer> {
  if (!(verifiedPartnerOriginal && path.startsWith(`partner-api/${scope.companyId}/`) && /^partner-api\/[^/]+\/[A-Za-z0-9_-]+\.pdf$/.test(path))) assertPoaDocumentPath(path, scope)
  const { data, error } = await supabaseService.storage.from(BUCKET).download(path)
  if (error || !data) throw error ?? new Error('Det sparade fullmaktsdokumentet kunde inte hämtas.')
  const bytes = Buffer.from(await data.arrayBuffer())
  if (!inspectPdfStructure(bytes).ok) throw new Error('Det sparade fullmaktsdokumentet är inte en läsbar PDF.')
  return bytes
}

// No overwrite: a signed/uploaded original and its bytes survive later edits
// to the customer, tenant profile or email templates. New consent gets a new POA.
export async function savePoaPdfArchive(scope: PoaDocumentScope, pdf: Buffer, expectedEvidenceFingerprint: string) {
  const poa = await readPoa(scope)
  if (evidenceFingerprint(poa) !== expectedEvidenceFingerprint) throw new Error('Fullmaktens underlag ändrades under PDF-genereringen. Läs om underlaget.')
  const previousPath = clean(poa.document_path)
  const previousArchive = record(record(poa.metadata).document_archive)
  const archivePrefix = `companies/${scope.companyId}/customers/${scope.customerId}/powers-of-attorney/${scope.powerOfAttorneyId}/`
  const isArchived = previousPath?.startsWith(archivePrefix) && Boolean(previousArchive.sha256)
  const originalUpload = Boolean(previousPath && !isArchived)
  if (originalUpload) pdf = await download(previousPath!, scope, poa.source === 'partner_api')
  const sha256 = createHash('sha256').update(pdf).digest('hex')
  if (isArchived && previousPath && previousArchive.sha256 === sha256) {
    return { path: previousPath, pdf: await download(previousPath, scope) }
  }
  if (!inspectPdfStructure(pdf).ok) throw new Error('Fullmakten kunde inte arkiveras som en läsbar PDF.')
  for (const value of Object.values(scope)) if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Ogiltig dokumentkoppling.')
  const path = `companies/${scope.companyId}/customers/${scope.customerId}/powers-of-attorney/${scope.powerOfAttorneyId}/fullmakt-${sha256}.pdf`
  const result = await supabaseService.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false })
  let original = pdf
  if (result.error) {
    if (String((result.error as { statusCode?: unknown }).statusCode) !== '409') throw result.error
    original = await download(path, scope)
  }
  const archive = { storage_bucket: BUCKET, path, sha256: createHash('sha256').update(original).digest('hex'),
    saved_at: new Date().toISOString(), verification_number: poaMailEvidence(poa).verificationReference,
    evidence_sha256: evidenceFingerprint(poa),
    ...(originalUpload ? { source_path: previousPath, original_upload: true } :
      previousArchive.original_upload ? { source_path: previousArchive.source_path, original_upload: true } : {}),
    previous_paths: [...(Array.isArray(previousArchive.previous_paths) ? previousArchive.previous_paths : []), ...(previousPath && previousPath !== path ? [previousPath] : [])],
  }
  let update = supabaseService.from('powers_of_attorney').update({ document_path: path,
    metadata: { ...record(poa.metadata), document_archive: archive }, updated_at: new Date().toISOString() })
    .eq('company_id', scope.companyId).eq('customer_id', scope.customerId).eq('id', scope.powerOfAttorneyId)
  update = previousPath ? update.eq('document_path', previousPath) : update.is('document_path', null)
  update = poa.updated_at ? update.eq('updated_at', String(poa.updated_at)) : update.is('updated_at', null)
  const saved = await update.select('id').maybeSingle()
  if (saved.error) throw saved.error
  if (!saved.data) {
    const current = await readPoa(scope)
    const currentPath = clean(current.document_path)
    if (!currentPath || currentPath !== path || evidenceFingerprint(current) !== evidenceFingerprint(poa)) {
      throw new Error('Fullmakten ändrades samtidigt. Läs om underlaget före arkivering eller utskick.')
    }
    return { path: currentPath, pdf: await download(currentPath, scope) }
  }
  return { path, pdf: original }
}

export async function ensurePoaPdfArchive(scope: PoaDocumentScope) {
  const poa = await ensurePoaVerificationReference(scope)
  const previousPath = clean(poa.document_path)
  const archive = record(record(poa.metadata).document_archive)
  if (previousPath && /\.pdf$/i.test(previousPath)) {
    const archived = previousPath.startsWith(`companies/${scope.companyId}/customers/${scope.customerId}/powers-of-attorney/${scope.powerOfAttorneyId}/`) && Boolean(archive.sha256)
    if (!archived) return savePoaPdfArchive(scope, await download(previousPath, scope, poa.source === 'partner_api'), evidenceFingerprint(poa))
    if (archive.original_upload || archive.evidence_sha256 === evidenceFingerprint(poa)) return { path: previousPath, pdf: await download(previousPath, scope) }
  }
  if (!['signed', 'active', 'accepted', 'completed', 'expired', 'revoked', 'replaced', 'superseded'].includes(String(poa.status))) {
    throw new Error('Fullmakten har ännu inget registrerat godkännande att skapa PDF från.')
  }
  let proof = poaMailEvidence(poa)
  if (!proof.legalText) {
    // Old portal captures kept immutable document IDs/hashes rather than a
    // rendered body. Resolve that exact acceptance, never today's legal text.
    const snapshot = record(poa.fullmakt_snapshot), evidence = record(poa.evidence_payload)
    const bundleId = clean(snapshot.legal_bundle_version_id) ?? clean(evidence.legal_bundle_version_id)
    const documentId = clean(snapshot.legal_bundle_version_document_id) ?? clean(evidence.legal_bundle_version_document_id)
    const hash = clean(snapshot.document_hash) ?? clean(evidence.legal_document_sha256)
    if (bundleId && documentId && hash) {
      const bundle = await supabaseService.from('legal_bundle_versions').select('id').eq('id', bundleId).eq('company_id', scope.companyId).maybeSingle()
      if (bundle.error) throw bundle.error
      if (!bundle.data) throw new Error('Det godkända juridikpaketet tillhör inte fullmaktens tenant.')
      const document = await supabaseService.from('legal_bundle_version_documents').select('id,title,template_version,rendered_body,content_sha256')
        .eq('id', documentId).eq('legal_bundle_version_id', bundleId).eq('content_sha256', hash).maybeSingle()
      if (document.error) throw document.error
      const body = document.data?.rendered_body
      if (!document.data || typeof body !== 'string' || createHash('sha256').update(body, 'utf8').digest('hex') !== hash.toLowerCase()) throw new Error('Den godkända fullmaktstextens kontrollsumma kunde inte verifieras.')
      proof = { ...proof, legalText: body, legalTextTitle: document.data.title, legalTextVersion: document.data.template_version }
    }
  }
  if (!proof.legalText) throw new Error('Fullmakten saknar den sparade godkända texten. Komplettera originalunderlaget före PDF-generering.')
  const siteId = clean(poa.customer_site_id) ?? clean(poa.site_id)
  const [customerResult, companyResult, siteResult] = await Promise.all([
    supabaseService.from('customers').select('*').eq('company_id', scope.companyId).eq('id', scope.customerId).maybeSingle(),
    supabaseService.from('companies').select('*').eq('id', scope.companyId).maybeSingle(),
    siteId ? supabaseService.from('customer_sites').select('*').eq('company_id', scope.companyId).eq('customer_id', scope.customerId).eq('id', siteId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  for (const result of [customerResult, companyResult, siteResult]) if (result.error) throw result.error
  if (!customerResult.data || !companyResult.data || (siteId && !siteResult.data)) throw new Error('Fullmaktens kund-, tenant- eller anläggningskoppling kunde inte verifieras.')
  const customer = customerResult.data as Row, company = companyResult.data as Row, site = record(siteResult.data)
  const frozen = record(record(poa.fullmakt_snapshot).customer)
  const pdf = renderFullmaktPdf({
    powerOfAttorneyId: scope.powerOfAttorneyId, reference: proof.reference,
    customerName: clean(frozen.name) ?? clean(customer.company_name) ?? clean(customer.full_name),
    customerIdentity: clean(frozen.identity) ?? clean(customer.org_number) ?? clean(customer.personal_number),
    siteAddress: clean(site.street), sitePostalCode: clean(site.postal_code), siteCity: clean(site.city),
    representativeName: clean(company.legal_name) ?? clean(company.name), representativeOrganizationNumber: clean(company.org_number),
    legalTextTitle: proof.legalTextTitle, legalTextVersion: proof.legalTextVersion, legalTextVersionId: clean(poa.legal_text_version_id),
    legalText: proof.legalText, signedScopes: proof.signedScopes, verificationReference: proof.verificationReference,
    signerIpAddress: proof.signerIpAddress, bankidVerified: proof.bankidVerified, bankidReference: proof.bankidReference,
    acceptedAt: clean(poa.accepted_at) ?? clean(poa.signed_at), signerName: clean(poa.signer_name),
    signerIdentityNumber: clean(poa.signer_identity_number), method: clean(poa.method), source: clean(poa.source),
  })
  return savePoaPdfArchive(scope, pdf, evidenceFingerprint(poa))
}
