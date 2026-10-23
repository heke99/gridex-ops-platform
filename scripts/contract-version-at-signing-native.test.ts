// reality-defects: F95
// FINDINGS F95 (2026-10-23): a grid owner's PRODAT Z04 confirming our Z03 was held with
// normal_z04_owned_signed_contract_scope_required because no SQL signing path set
// customer_contracts.contract_version. Every SQL signing finalizer now sets it in the same
// update that signs, to exactly the signed_version that update writes (coalesce(terms_version,'v1')),
// keeping a version already present, so signed_version = contract_version as the bilateral PRODAT,
// regulated-supply and BRP gates require.
// Proved by calling the real token, record-retention predecessor, website and admin-import
// finalizers on disposable synthetic tenants, and by evaluating the installed Z04 owned-contract
// condition on the signed rows. Synthetic data only.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { futureNativeSupplyDate, literal, nativeSql as sql, seedNormalSwitchNativeFixture, type NormalSwitchStageNativeFixture } from './helpers/ediel-normal-switch-native-fixture'

let f: NormalSwitchStageNativeFixture
type Versions = { contract_version?: string | null; terms_version?: string | null; price_version?: string | null; campaign_version?: string | null }
type SignedRow = { status: string; signedAt: string | null; contractVersion: string | null; signedVersion: string | null; termsSignedVersion: string | null }

// The owned-contract condition of the Z04 confirm sources, verbatim from the installed bodies.
const OWNED_CONTRACT_CONDITION = `OR (contract.status IN('signed','active')) IS NOT TRUE OR contract.signed_at IS NULL OR nullif(contract.signed_version,'') IS NULL OR nullif(contract.contract_version,'') IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','normal_z04_owned_signed_contract_scope_required')`
const Z04_CONFIRM_SOURCES = ['gridex_received_sources.normal_switch_confirm_v1(uuid,uuid,uuid)', 'gridex_received_sources.normal_switch_confirm_mixed_v1(uuid,uuid,uuid)',
  'gridex_bilateral_prodat.confirm_h_start_v1(uuid,uuid,uuid)', 'gridex_bilateral_prodat.confirm_h_start_mixed_v1(uuid,uuid,uuid)']

/** Evaluates the confirm sources' owned-contract condition on the stored contract: true = held for normal_z04_owned_signed_contract_scope_required. */
const heldForContractScope = (contractId: string) => sql<boolean>(`SELECT to_jsonb((contract.status IN('signed','active')) IS NOT TRUE OR contract.signed_at IS NULL
  OR nullif(contract.signed_version,'') IS NULL OR nullif(contract.contract_version,'') IS NULL) FROM public.customer_contracts contract WHERE contract.id=${literal(contractId)}`)

const signedRow = (contractId: string) => sql<SignedRow>(`SELECT jsonb_build_object('status',status,'signedAt',signed_at,'contractVersion',contract_version,
  'signedVersion',signed_version,'termsSignedVersion',terms_signed_version) FROM public.customer_contracts WHERE id=${literal(contractId)} AND company_id=${literal(f.companyId)}`)

/** The correction ledger captures every UPDATE of the row. The signing UPDATE (into signed) is the
 * only one and the last one, and the stored row is exactly what it wrote, so contract_version was
 * written by the signing update itself, not by a later write. */
const signingUpdate = (contractId: string) => sql<{ signingUpdates: number; lastIsSigning: boolean; rowIsSigningWrite: boolean }>(`WITH u AS (SELECT * FROM gridex_correction_process.facts
  WHERE table_name='customer_contracts' AND row_id=${literal(contractId)} AND operation='UPDATE'), last AS (SELECT * FROM u ORDER BY id DESC LIMIT 1)
  SELECT jsonb_build_object('signingUpdates',(SELECT count(*) FROM u WHERE u.old_fact->>'status' IS DISTINCT FROM 'signed' AND u.new_fact->>'status'='signed'),
   'lastIsSigning',(SELECT last.old_fact->>'status' IS DISTINCT FROM 'signed' AND last.new_fact->>'status'='signed' FROM last),
   'rowIsSigningWrite',(SELECT (last.new_fact->>'updated_at')::timestamptz=c.updated_at AND (last.new_fact->>'signed_at')::timestamptz=c.signed_at FROM last,public.customer_contracts c WHERE c.id=${literal(contractId)}))`)
const SIGNED_BY_ONE_UPDATE = { signingUpdates: 1, lastIsSigning: true, rowIsSigningWrite: true }

/** A draft on the fixture's locked internal publication with the given version columns (all triggers enabled). */
function draftContract(versions: Versions, status = 'draft') {
  const contractId = randomUUID(), v = { contract_version: null, terms_version: null, price_version: null, campaign_version: null, ...versions }
  sql(`INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,contract_offer_id,status,contract_version,terms_version,price_version,campaign_version,
    requested_start_date,starts_at,metadata,created_by,contract_publication_version_id,contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,
    legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot)
   SELECT ${literal(contractId)},${literal(f.companyId)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},original.contract_offer_id,${literal(status)},
    ${literal(v.contract_version)},${literal(v.terms_version)},${literal(v.price_version)},${literal(v.campaign_version)},
    ${literal(f.requestedStartDate)}::date,${literal(f.requestedStartDate)}::date,'{"test_center":{"kind":"invoice_test_customer"}}'::jsonb,${literal(f.actorUserId)},
    v.id,p.contract_product_id,v.contract_product_version_id,v.price_plan_id,v.price_plan_version_id,v.price_book_id,v.legal_bundle_version_id,v.offer_reference,p.commercial_snapshot,l.rendered_snapshot
   FROM public.customer_contracts original JOIN public.contract_publication_versions v ON v.id=original.contract_publication_version_id
   JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id
   WHERE original.id=${literal(f.contractId)} AND original.company_id=${literal(f.companyId)} AND v.status='published' AND v.locked_at IS NOT NULL;`)
  expect(sql(`SELECT jsonb_build_object('status',status,'signed',signed_at IS NOT NULL,'contract_version',contract_version,'terms_version',terms_version,'price_version',price_version,'campaign_version',campaign_version)
    FROM public.customer_contracts WHERE id=${literal(contractId)}`)).toEqual({ status, signed: false, ...v })
  return contractId
}

/** The ordinary secure-link request on the draft (the public prepare RPC freezes the canonical price row). */
async function signatureRequest(contractId: string) {
  const tokenHash = randomBytes(32).toString('hex')
  const prepared = await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1', { p_company_id: f.companyId, p_customer_id: f.customerId, p_contract_id: contractId,
    p_token_hash: tokenHash, p_recipient_email: `synthetic-${f.customerId}@example.invalid`, p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_actor_user_id: f.actorUserId, p_channel: 'internal' })
  expect(prepared.error).toBeNull()
  expect(prepared.data).toMatchObject({ ok: true, status: 'pending_signature' })
  return tokenHash
}

beforeAll(async () => {
  f = await seedNormalSwitchNativeFixture({ deferOriginal: true, requestedStartDate: futureNativeSupplyDate() })
  sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
    SELECT ${literal(f.actorUserId)},${literal(f.companyId)},p.id,p.key FROM public.permissions p WHERE p.key IN('contracts.create','contracts.publish','pricing.publish')
    AND NOT EXISTS(SELECT FROM public.user_permissions u WHERE u.user_id=${literal(f.actorUserId)} AND u.company_id=${literal(f.companyId)} AND (u.permission_id=p.id OR u.permission_key=p.key));`)
}, 300000)

describe('contract_version is set at signing (F95)', () => {
  it('the Z04 confirm sources still hold an owned contract without contract_version', () => {
    for (const source of Z04_CONFIRM_SOURCES) expect(sql(`SELECT to_jsonb(position(${literal(OWNED_CONTRACT_CONDITION)} IN prosrc)>0) FROM pg_proc WHERE oid=${literal(source)}::regprocedure`), source).toBe(true)
    // The evaluated condition holds for a contract without contract_version (the defect's world state).
    const versionless = draftContract({})
    expect(heldForContractScope(versionless)).toBe(true)
  })

  it.each([
    { name: 'no version columns (world token contracts)', versions: {}, expected: 'v1' },
    { name: 'terms version wins over price and campaign', versions: { terms_version: 'f95-terms-3', price_version: 'f95-price-2', campaign_version: 'f95-campaign-1' }, expected: 'f95-terms-3' },
    { name: 'price and campaign versions do not diverge from signed_version', versions: { price_version: 'f95-price-2', campaign_version: 'f95-campaign-1' }, expected: 'v1' },
    { name: 'campaign version only', versions: { campaign_version: 'f95-campaign-1' }, expected: 'v1' },
    { name: 'an existing contract_version is kept', versions: { contract_version: 'f95-kept-7' }, expected: 'f95-kept-7' },
    { name: 'an empty contract_version is replaced', versions: { contract_version: '', terms_version: 'f95-terms-4' }, expected: 'f95-terms-4' },
  ])('token signing ($name) sets contract_version in the signing update', async ({ versions, expected }) => {
    const contractId = draftContract(versions)
    const tokenHash = await signatureRequest(contractId)
    expect(signedRow(contractId).contractVersion).toBe((versions as Versions).contract_version ?? null)
    const result = await supabaseService.rpc('gridex_finalize_customer_contract_signature_v1', { p_token_hash: tokenHash, p_signed_ip_hash: null, p_signed_user_agent: 'SYNTHETIC F95 token signing; TEST ONLY' })
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({ already_signed: false, status: 'signed' })
    const row = signedRow(contractId)
    expect(row).toMatchObject({ status: 'signed', contractVersion: expected, signedVersion: expected })
    // One UPDATE signs and versions the contract; it is not a second write afterwards.
    expect(signingUpdate(contractId)).toEqual(SIGNED_BY_ONE_UPDATE)
    expect(heldForContractScope(contractId)).toBe(false)
    // A replay of the signed link changes nothing.
    const replay = await supabaseService.rpc('gridex_finalize_customer_contract_signature_v1', { p_token_hash: tokenHash, p_signed_ip_hash: null, p_signed_user_agent: 'SYNTHETIC F95 token signing; TEST ONLY' })
    expect(replay.error).toBeNull(); expect(replay.data).toMatchObject({ already_signed: true, status: 'signed' })
    expect(signedRow(contractId)).toEqual(row)
  })

  it('token signing of the world defect: contract_version and signed_version agree on the signed agreement', async () => {
    for (const versions of [{}, { terms_version: 'e2e-v1' }] as Versions[]) {
      const contractId = draftContract(versions)
      const tokenHash = await signatureRequest(contractId)
      expect((await supabaseService.rpc('gridex_finalize_customer_contract_signature_v1', { p_token_hash: tokenHash, p_signed_ip_hash: null, p_signed_user_agent: 'SYNTHETIC F95' })).error).toBeNull()
      const row = signedRow(contractId)
      expect(row.contractVersion).toBe(versions.terms_version ?? 'v1')
      expect(row.signedVersion).toBe(row.contractVersion)
      expect(row.termsSignedVersion).toBe(versions.terms_version ?? 'v1')
    }
  })

  it('the record-retention signing predecessor sets contract_version in its signing update', async () => {
    const contractId = draftContract({ terms_version: 'f95-retention-2' })
    const tokenHash = await signatureRequest(contractId)
    // Not granted to any API role; invoked directly as its owner on the disposable database.
    expect(sql(`SELECT to_jsonb(public.gridex_finalize_signature_before_record_retention_v1(${literal(tokenHash)},NULL,'SYNTHETIC F95 predecessor; TEST ONLY')->>'status')`)).toBe('signed')
    const row = signedRow(contractId)
    expect(row).toMatchObject({ status: 'signed', contractVersion: 'f95-retention-2', signedVersion: 'f95-retention-2' })
    expect(row.signedVersion).toBe(row.contractVersion)
    expect(signingUpdate(contractId)).toEqual(SIGNED_BY_ONE_UPDATE)
    expect(heldForContractScope(contractId)).toBe(false)
  })

  it('website signing sets contract_version in the signing update', async () => {
    const offerId = sql<string>(`SELECT to_jsonb(contract_offer_id) FROM public.customer_contracts WHERE id=${literal(f.contractId)}`)
    const channel = await supabaseService.rpc('gridex_publish_contract_channel', { p_company_id: f.companyId, p_offer_id: offerId, p_channel: 'website', p_actor_user_id: f.actorUserId })
    expect(channel.error, JSON.stringify(channel.error)).toBeNull()
    expect(channel.data, JSON.stringify(channel.data)).toMatchObject({ ok: true })
    // The synthetic tenant lets the portal identity be linked after checkout (tenant setting).
    sql(`UPDATE public.companies SET metadata=coalesce(metadata,'{}'::jsonb)||'{"website_portal_identity_mode":"post_auth_allowed"}'::jsonb WHERE id=${literal(f.companyId)};`)
    const offer = sql<{ id: string; offerReference: string }>(`SELECT jsonb_build_object('id',o.id,'offerReference',v.offer_reference) FROM public.public_contract_offers o
      JOIN public.contract_publication_versions v ON v.id=o.contract_publication_version_id AND v.legacy_public_contract_offer_id=o.id
      WHERE o.company_id=${literal(f.companyId)} AND o.publication_status='published' AND o.website_enabled AND NOT o.is_archived ORDER BY o.created_at DESC LIMIT 1`)
    for (const [terms, expected] of [['e2e-v1', 'e2e-v1'], [null, null]] as const) {
      const created = await supabaseService.rpc('gridex_create_website_customer_contract', { p_company_id: f.companyId, p_customer_number: null, p_contract_payload: {
        customer_id: f.customerId, site_id: f.siteId, customer_site_id: f.siteId, metering_point_id: f.pointId, public_contract_offer_id: offer.id, offer_reference: offer.offerReference,
        status: 'pending_signature', requested_start_date: f.requestedStartDate, starts_at: f.requestedStartDate, ...(terms ? { terms_version: terms } : {}),
        metadata: { test_center: { kind: 'invoice_test_customer' } } } })
      expect(created.error, JSON.stringify(created.error)).toBeNull()
      const contract = (created.data as { contract: Record<string, string | null> }).contract
      expect(contract.contract_version).toBeNull()
      // The website creation path defaults price_version to the publication's price plan version;
      // it does not become the contract version (signed_version would not match it).
      expect(contract.price_version).toBeTruthy()
      const want = expected ?? 'v1'
      const applicationId = randomUUID()
      sql(`INSERT INTO public.website_customer_applications(id,company_id,external_customer_id,customer_id,contract_id,public_contract_offer_id,offer_reference,portal_identity_required)
        VALUES(${literal(applicationId)},${literal(f.companyId)},${literal(`f95-${applicationId}`)},${literal(f.customerId)},${literal(contract.id)},${literal(offer.id)},${literal(offer.offerReference)},true);`)
      const documents = sql<Array<{ id: string; module: string; sha: string }>>(`SELECT jsonb_agg(jsonb_build_object('id',d.id,'module',d.module_key,'sha',d.content_sha256) ORDER BY d.id)
        FROM public.legal_bundle_version_documents d WHERE d.legal_bundle_version_id=${literal(contract.legal_bundle_version_id)}`)
      const legalVersions = documents.map(d => ({ legal_bundle_version_document_id: d.id, module_key: d.module, document_sha256: d.sha }))
      const acceptedAt = new Date().toISOString()
      const snapshot = { schema: 'gridex_website_contract_signature_v2', company_id: f.companyId, customer_id: f.customerId, contract_id: contract.id, application_id: applicationId,
        public_contract_offer_id: offer.id, offer_reference: offer.offerReference, legal_versions: legalVersions, accepted_at: acceptedAt,
        contract_publication_version_id: contract.contract_publication_version_id, contract_product_version_id: contract.contract_product_version_id,
        price_plan_version_id: contract.price_plan_version_id, legal_bundle_version_id: contract.legal_bundle_version_id, contract_price_snapshot_id: contract.contract_price_snapshot_id }
      const signed = await supabaseService.rpc('gridex_finalize_website_contract_signature', { p_company_id: f.companyId, p_contract_id: contract.id, p_application_id: applicationId,
        p_public_contract_offer_id: offer.id, p_offer_reference: offer.offerReference, p_accepted_at: acceptedAt, p_legal_versions: legalVersions, p_signature_snapshot: snapshot,
        p_acceptance_evidence: documents.map(d => ({ legal_bundle_version_document_id: d.id, legal_module_key: d.module, legal_document_sha256: d.sha, legal_document_version: '1' })),
        p_signature_snapshot_sha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), p_signed_ip_hash: null, p_signed_user_agent: 'SYNTHETIC F95 website signing; TEST ONLY' })
      expect(signed.error, JSON.stringify(signed.error)).toBeNull()
      expect(signed.data).toMatchObject({ status: 'signed', contract_id: contract.id })
      const row = signedRow(contract.id!)
      expect(row).toMatchObject({ status: 'signed', contractVersion: want, signedVersion: want, termsSignedVersion: want })
      expect(row.signedVersion).toBe(row.contractVersion)
      expect(signingUpdate(contract.id!)).toEqual(SIGNED_BY_ONE_UPDATE)
      expect(heldForContractScope(contract.id!)).toBe(false)
    }
  })

  it('an imported signed agreement (admin intake) sets contract_version in the signing update', async () => {
    const contractId = draftContract({ terms_version: 'f95-import-5' })
    const imported = await supabaseService.from('customer_authorization_documents').insert({
      company_id: f.companyId, customer_id: f.customerId, site_id: f.siteId, metering_point_id: f.pointId, customer_contract_id: contractId,
      document_type: 'complete_agreement', status: 'active', title: 'Synthetic F95 signed agreement', mime_type: 'application/pdf', storage_bucket: 'customer-documents',
      file_path: `${f.companyId}/${contractId}/signed.pdf`, file_checksum: createHash('sha256').update(`SYNTHETIC F95 ${contractId}`).digest('hex'),
      uploaded_at: new Date().toISOString(), created_by: f.actorUserId, metadata: { source: 'customer_intake', documentRole: 'signed_agreement', channel: 'admin_contract_create' } })
    expect(imported.error, JSON.stringify(imported.error)).toBeNull()
    const row = signedRow(contractId)
    expect(row).toMatchObject({ status: 'signed', contractVersion: 'f95-import-5', signedVersion: 'f95-import-5' })
    expect(row.signedVersion).toBe(row.contractVersion)
    expect(signingUpdate(contractId)).toEqual(SIGNED_BY_ONE_UPDATE)
    expect(heldForContractScope(contractId)).toBe(false)
  })

  it('signed fields stay immutable and every SQL signing finalizer carries the contract_version default', () => {
    const contractId = draftContract({})
    expect(() => sql(`UPDATE public.customer_contracts SET signed_version='f95-forged' WHERE id=${literal(f.contractId)}`)).toThrow(/signed_customer_contract_immutable:signed_version/)
    // Every installed SQL signing finalizer carries exactly one contract_version assignment.
    expect(sql(`SELECT jsonb_object_agg(p.oid::regprocedure::text,(length(p.prosrc)-length(replace(replace(p.prosrc,'contract_version = coalesce(nullif(contract_version, ''''), terms_version, ''v1'')',''),
      'contract_version=coalesce(nullif(contract_version,''''),terms_version,''v1'')','')))>0)
      FROM pg_proc p WHERE p.proname IN('gridex_finalize_website_contract_signature','gridex_finalize_customer_contract_signature_v1','gridex_finalize_signature_before_record_retention_v1','gridex_finalize_admin_imported_signed_agreement_v1')`))
      .toEqual({
        'gridex_finalize_admin_imported_signed_agreement_v1()': true,
        'gridex_finalize_customer_contract_signature_v1(text,text,text)': true,
        'gridex_finalize_signature_before_record_retention_v1(text,text,text)': true,
        'gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb,jsonb,text,text,text)': true,
        'gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb,text,text,text)': true,
      })
    expect(signedRow(contractId)).toMatchObject({ status: 'draft', contractVersion: null })
  })
})
