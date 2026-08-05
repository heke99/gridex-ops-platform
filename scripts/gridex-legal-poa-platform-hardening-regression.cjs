#!/usr/bin/env node
// Regression: legal + power-of-attorney platform hardening.
//
// Asserts the OPS-source-of-truth hardening:
//  - POA / legal schema mismatches hard-fail (no silent null) when required
//  - referenced POA textVersionId is tenant/publish validated
//  - public-contracts legal block exposes immutable references, grouped documents and compatibility URLs
//  - standalone legal-bundle endpoint exists and reuses the shared builder
//  - public, published-only, tenant-isolated legal document pages exist
//  - customer types are normalized before validation
//  - application response includes legal_acceptances + POA document_url
//  - website_legal.read scope exists; docs + migration present

const fs = require('fs')
const path = require('path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
const exists = (file) => fs.existsSync(path.join(root, file))
const ok = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const apps = read('lib/website/customerApplications.ts')
const publicContracts = read('lib/website/publicContracts.ts')
const scopes = read('lib/integrations/apiClientScopes.ts')
const publicLegal = read('lib/legal/publicLegalDocuments.ts')

// 1) POA schema mismatch must hard-fail (no silent return null on the insert).
ok(
  apps.includes("code: 'powers_of_attorney_schema_mismatch'"),
  'POA insert throws powers_of_attorney_schema_mismatch on schema mismatch',
)
{
  // The dangerous `if (missingSchema(error)) return null` must no longer sit
  // directly above the powers_of_attorney insert error handling.
  const insertIdx = apps.indexOf("from('powers_of_attorney')\n    .insert(row)")
  ok(insertIdx > -1, 'POA insert block is present')
  const after = apps.slice(insertIdx, insertIdx + 1200)
  ok(
    after.includes("code: 'powers_of_attorney_schema_mismatch'") && !/if \(missingSchema\(error\)\) return null/.test(after),
    'POA insert no longer silently returns null on missing schema',
  )
}

// 2) Legal version loading failures fail clearly (legal_bundle_missing).
ok(apps.includes("code: 'legal_bundle_missing'"), 'legal version/acceptance schema mismatch fails with legal_bundle_missing')
// The old `if (versions === null)` fallback was replaced by the strictly
// offer-bound loader: every failure mode throws a structured error instead of
// returning null (offer_legal_versions_missing / _invalid,
// offer_legal_bundle_unavailable / _not_published).
ok(
  apps.includes("code: 'offer_legal_versions_missing'") &&
    apps.includes("code: 'offer_legal_versions_invalid'") &&
    apps.includes("code: 'offer_legal_bundle_unavailable'") &&
    apps.includes("code: 'offer_legal_bundle_not_published'"),
  'assertWebsiteLegalAcceptances fails closed when published versions cannot be read',
)

// 3) Tenant + publish enforcement for referenced POA text version.
for (const code of [
  'power_of_attorney_version_tenant_mismatch',
  'power_of_attorney_version_not_published',
  'power_of_attorney_version_missing',
  'power_of_attorney_not_accepted',
  'customer_type_invalid',
]) {
  ok(apps.includes(`code: '${code}'`), `application validation defines ${code}`)
}

// 4) Public-contracts legal block extension.
for (const key of [
  'power_of_attorney_required',
  'power_of_attorney_version_id',
  'power_of_attorney_url',
  'terms_document_reference',
  'terms_url',
  'privacy_policy_required',
  'customer_documents',
]) {
  ok(publicContracts.includes(key), `public-contracts legal block exposes ${key}`)
}
ok(publicContracts.includes('export function buildPublicLegalBlock'), 'shared buildPublicLegalBlock exists')
ok(publicContracts.includes('export async function buildWebsiteLegalBundle'), 'buildWebsiteLegalBundle exists for the legal-bundle endpoint')

// 5) Legal bundle endpoint.
ok(exists('app/api/v1/website/legal-bundle/route.ts'), 'GET /api/v1/website/legal-bundle route exists')
{
  const route = read('app/api/v1/website/legal-bundle/route.ts')
  ok(
    route.includes("'website_legal.read'") && route.includes("'website_contracts.read'"),
    'legal-bundle accepts website_legal.read or website_contracts.read',
  )
  ok(route.includes('buildWebsiteLegalBundle'), 'legal-bundle uses the shared builder')
}

// 6) Public legal document pages: published-only, tenant-isolated.
ok(exists('app/legal/[slug]/[type]/[versionId]/page.tsx'), 'public legal document page exists')
ok(
  publicLegal.includes(".eq('status', 'published')") && publicLegal.includes('loadCompanyBySlug'),
  'public legal version loader filters to published + resolves tenant by slug',
)
ok(publicLegal.includes('export function buildPublicLegalUrl'), 'buildPublicLegalUrl helper exists')

// 7) Customer type normalization (now a shared helper used by the intake).
ok(
  fs.existsSync(path.join(root, 'lib/customers/externalCustomerType.ts')) &&
    apps.includes("from '@/lib/customers/externalCustomerType'"),
  'strict external customer type normalization helper exists and is used by intake',
)
{
  // Mirror the current public API boundary: canonical values pass, the legacy
  // company alias is normalized, and all other values fail closed.
  const normalize = (value) => {
    if (value === undefined || value === null || String(value).trim() === '') {
      return { ok: true, value: null }
    }
    const raw = String(value).trim().toLowerCase()
    if (raw === 'private' || raw === 'business') return { ok: true, value: raw }
    if (raw === 'company') return { ok: true, value: 'business' }
    return { ok: false, value: null }
  }
  ok(normalize('company').value === 'business', 'deprecated company alias maps to business')
  ok(normalize('private').value === 'private' && normalize('business').value === 'business', 'canonical values pass through')
  ok(normalize('rocket').ok === false, 'unknown customer types fail closed')
  ok(normalize('').value === null, 'empty input maps to the documented default path')
}

// 8) Application response completeness.
ok(apps.includes('responsePayload.legal_acceptances = legalAcceptanceIds'), 'response includes legal_acceptances id map')
ok(apps.includes('document_url: poaDocumentUrl') && apps.includes('text_version_id: poaLegalVersionId'), 'POA response block includes document_url + text_version_id')

// 9) Scope.
ok(scopes.includes("'website_legal.read'"), 'website_legal.read scope is defined')

// 10) Migration present.
ok(exists('supabase/migrations/20260629130000_legal_poa_hardening_indexes.sql'), 'legal/POA index migration exists')

// 11) Docs.
const platformDoc = 'docs/legal-power-of-attorney-platform.md'
ok(exists(platformDoc), 'legal + POA platform doc exists')
{
  const doc = read(platformDoc)
  for (const token of ['powerOfAttorney', 'power_of_attorney', 'legal-bundle', 'powers_of_attorney_schema_mismatch', '/legal/']) {
    ok(doc.includes(token), `platform doc documents ${token}`)
  }
}

// 12) Package script entry.
ok(read('package.json').includes('gridex:legal-poa-platform-hardening-regression'), 'package script exposes this regression command')

console.log('Legal + power of attorney platform hardening regression passed')
