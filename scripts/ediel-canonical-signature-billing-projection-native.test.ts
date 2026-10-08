// Maintenance regression: real canonical signing and its legacy billing hash projection.
// Disposable local tenants only. No private signing/source approval is seeded;
// public prepare/finalize RPCs create every signature and canonical price row.
// The pricing SHA embedded in evidence differs from each full evidence object's SHA.
import {createHash, createHmac, randomBytes, randomUUID} from 'node:crypto'
import {beforeAll, expect, it} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {
  futureNativeSupplyDate,
  literal,
  nativeSql as sql,
  seedNormalSwitchNativeFixture,
  type NormalSwitchStageNativeFixture,
} from './helpers/ediel-normal-switch-native-fixture'
import {createCustomerRecordRetentionNativeUser} from './helpers/ediel-customer-record-retention-native-fixture'

let fixture: NormalSwitchStageNativeFixture
const tenantEffectTables = [
  'public.customer_contracts',
  'public.contract_price_snapshots',
  'public.customer_contract_signature_requests',
  'public.customer_legal_acceptances',
  'public.customer_contract_acceptances',
  'public.customer_contract_evidence',
  'public.customer_contract_events',
  'public.customer_operation_jobs',
  'public.customer_operation_events',
  'public.customer_operation_tasks',
  'public.customer_events',
  'public.domain_events',
  'public.event_outbox',
  'public.audit_logs',
  'gridex_correction_process.facts',
] as const

type PendingContract = {contractId: string; tokenHash: string; requestId: string}
type ProjectionWitness = {
  sameScope: boolean
  signed: boolean
  billingIneligible: boolean
  canonicalDigestMatches: boolean
  cacheMatches: boolean
  signaturePriceMatches: boolean
  metadataPriceMatches: boolean
  signatureDigestMatches: boolean
  acceptancePriceMatches: boolean
  acceptanceSignatureMatches: boolean
  acceptanceDigestMatches: boolean
  evidencePriceMatches: boolean
  evidenceDigestMatches: boolean
  legalSetMatches: boolean
  usedAtMatches: boolean
  signedEventMatches: boolean
  signedFactMatches: boolean
  acceptances: number
  evidence: number
  signedTransitions: number
}

beforeAll(async () => {
  fixture = await seedNormalSwitchNativeFixture({
    deferOriginal: true,
    requestedStartDate: futureNativeSupplyDate(),
  })
  // The shared fixture removes its temporary platform actor at the end. Grant
  // the canonical create permission explicitly to this disposable tenant actor.
  // Missing catalog data is a failure; no permission key or authority is invented.
  sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
    SELECT ${literal(fixture.actorUserId)},${literal(fixture.companyId)},p.id,p.key
    FROM public.permissions p WHERE p.key='contracts.create'
    AND NOT EXISTS(SELECT FROM public.user_permissions u
      WHERE u.user_id=${literal(fixture.actorUserId)} AND u.company_id=${literal(fixture.companyId)}
      AND (u.permission_id=p.id OR u.permission_key=p.key));`)
  expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM public.user_permissions u
    JOIN public.permissions p ON p.id=u.permission_id
    WHERE u.user_id=${literal(fixture.actorUserId)} AND u.company_id=${literal(fixture.companyId)}
    AND p.key='contracts.create' AND u.is_active AND u.status='active' AND u.effect='allow'))`)).toBe(true)
}, 180000)

function tenantEffects(companyId = fixture.companyId): Record<string, string> {
  // A fingerprint of every whole tenant row catches updates as well as counts.
  // SQL returns only digests; no request token, signature snapshot or identity
  // row is printed when an assertion fails.
  return sql(`SELECT jsonb_build_object(${tenantEffectTables.map(table =>
    `${literal(table)},(SELECT encode(extensions.digest(convert_to(
      coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')
      FROM ${table} r WHERE r.company_id=${literal(companyId)})`).join(',')})`)
}

function signingUpdateCount(contractId: string): number {
  return sql(`SELECT to_jsonb(count(*)) FROM gridex_correction_process.facts
    WHERE company_id=${literal(fixture.companyId)} AND table_name='customer_contracts'
    AND row_id=${literal(contractId)} AND operation='UPDATE'`)
}

async function prepare(contractId: string): Promise<PendingContract> {
  const tokenHash = randomBytes(32).toString('hex')
  const result = await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1', {
    p_company_id: fixture.companyId,
    p_customer_id: fixture.customerId,
    p_contract_id: contractId,
    p_token_hash: tokenHash,
    p_recipient_email: `synthetic-${fixture.customerId}@example.invalid`,
    p_expires_at: new Date(Date.now() + 3600000).toISOString(),
    p_actor_user_id: fixture.actorUserId,
    p_channel: 'internal',
  })
  expect(result.error?.code ?? null).toBeNull()
  const receipt = result.data as {ok?: boolean; status?: string; request_id: string}
  expect({ok: receipt?.ok, status: receipt?.status}).toEqual({ok: true, status: 'pending_signature'})
  const requestId = receipt.request_id
  expect(typeof requestId === 'string' && /^[0-9a-f-]{36}$/.test(requestId)).toBe(true)
  return {contractId, tokenHash, requestId}
}

async function pendingContract(): Promise<PendingContract> {
  const contractId = randomUUID()
  // This repeats the shared helper's minimal draft insertion against its actual
  // locked published graph. It copies no signed state, evidence or ledger hash.
  // All publication, tenant, identity, pricing and status triggers remain enabled.
  sql(`INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,
    contract_offer_id,status,contract_version,requested_start_date,starts_at,metadata,created_by,
    contract_publication_version_id,contract_product_id,contract_product_version_id,
    price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,
    offer_reference,commercial_snapshot,legal_snapshot)
    SELECT ${literal(contractId)},${literal(fixture.companyId)},${literal(fixture.customerId)},
      ${literal(fixture.siteId)},${literal(fixture.pointId)},original.contract_offer_id,
      'draft','v1',${literal(fixture.requestedStartDate)}::date,${literal(fixture.requestedStartDate)}::date,
      '{"test_center":{"kind":"invoice_test_customer"}}'::jsonb,${literal(fixture.actorUserId)},
      v.id,p.contract_product_id,v.contract_product_version_id,v.price_plan_id,
      v.price_plan_version_id,v.price_book_id,v.legal_bundle_version_id,v.offer_reference,
      p.commercial_snapshot,l.rendered_snapshot
    FROM public.customer_contracts original
    JOIN public.contract_publication_versions v ON v.id=original.contract_publication_version_id
    JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
    JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id
    WHERE original.id=${literal(fixture.contractId)} AND original.company_id=${literal(fixture.companyId)}
      AND v.status='published' AND v.locked_at IS NOT NULL;`)
  expect(sql(`SELECT to_jsonb(count(*)=1) FROM public.customer_contracts
    WHERE id=${literal(contractId)} AND company_id=${literal(fixture.companyId)}
    AND customer_id=${literal(fixture.customerId)} AND status='draft'
    AND signed_at IS NULL AND locked_at IS NULL AND contract_price_snapshot_id IS NULL`)).toBe(true)
  return prepare(contractId)
}

function finalize(tokenHash: string) {
  return supabaseService.rpc('gridex_finalize_customer_contract_signature_v1', {
    p_token_hash: tokenHash,
    p_signed_ip_hash: null,
    p_signed_user_agent: 'SYNTHETIC native billing projection acceptance; TEST ONLY',
  })
}

function projectionWitness(contractId: string): ProjectionWitness {
  return sql(`SELECT jsonb_build_object(
    'sameScope',s.company_id=c.company_id AND s.contract_id=c.id AND s.customer_id=c.customer_id,
    'signed',c.status='signed' AND c.signed_at IS NOT NULL AND c.locked_at=c.signed_at,
    'billingIneligible',c.billing_eligible_at IS NULL,
    'canonicalDigestMatches',s.snapshot_hash=encode(extensions.digest(convert_to(s.snapshot_json::text,'UTF8'),'sha256'),'hex'),
    'cacheMatches',c.snapshot_hash=s.snapshot_hash,
    'signaturePriceMatches',c.signature_snapshot->>'pricing_snapshot_sha256'=s.snapshot_hash,
    'metadataPriceMatches',c.metadata->>'pricing_snapshot_sha256'=s.snapshot_hash,
    'signatureDigestMatches',c.signature_snapshot_sha256=encode(extensions.digest(convert_to(c.signature_snapshot::text,'UTF8'),'sha256'),'hex'),
    'acceptancePriceMatches',EXISTS(SELECT FROM public.customer_contract_acceptances a
      WHERE a.company_id=c.company_id AND a.customer_contract_id=c.id
      AND a.acceptance_snapshot->>'pricing_snapshot_sha256'=s.snapshot_hash),
    'acceptanceSignatureMatches',EXISTS(SELECT FROM public.customer_contract_acceptances a
      WHERE a.company_id=c.company_id AND a.customer_contract_id=c.id
      AND a.acceptance_snapshot->>'signature_snapshot_sha256'=c.signature_snapshot_sha256),
    'acceptanceDigestMatches',EXISTS(SELECT FROM public.customer_contract_acceptances a
      WHERE a.company_id=c.company_id AND a.customer_contract_id=c.id
      AND a.acceptance_sha256=encode(extensions.digest(convert_to(a.acceptance_snapshot::text,'UTF8'),'sha256'),'hex')),
    'evidencePriceMatches',EXISTS(SELECT FROM public.customer_contract_evidence e
      WHERE e.company_id=c.company_id AND e.customer_contract_id=c.id AND e.evidence_type='online_acceptance'
      AND e.evidence_snapshot->>'pricing_snapshot_sha256'=s.snapshot_hash),
    'evidenceDigestMatches',EXISTS(SELECT FROM public.customer_contract_evidence e
      WHERE e.company_id=c.company_id AND e.customer_contract_id=c.id AND e.evidence_type='online_acceptance'
      AND e.evidence_sha256=c.signature_snapshot_sha256
      AND e.evidence_sha256=encode(extensions.digest(convert_to(e.evidence_snapshot::text,'UTF8'),'sha256'),'hex')),
    'legalSetMatches',EXISTS(SELECT FROM public.legal_bundle_version_documents d WHERE d.legal_bundle_version_id=c.legal_bundle_version_id)
      AND NOT EXISTS(SELECT FROM public.legal_bundle_version_documents d
        WHERE d.legal_bundle_version_id=c.legal_bundle_version_id AND NOT EXISTS(
          SELECT FROM public.customer_legal_acceptances a WHERE a.company_id=c.company_id
          AND a.contract_id=c.id AND a.legal_bundle_version_document_id=d.id
          AND a.metadata->>'pricing_snapshot_sha256'=s.snapshot_hash)),
    'usedAtMatches',EXISTS(SELECT FROM public.customer_contract_signature_requests r
      WHERE r.company_id=c.company_id AND r.customer_contract_id=c.id
      AND r.id::text=c.signature_snapshot->>'signature_request_id' AND r.used_at=c.signed_at),
    'signedEventMatches',EXISTS(SELECT FROM public.customer_contract_events e
      WHERE e.company_id=c.company_id AND e.customer_contract_id=c.id AND e.customer_id=c.customer_id
      AND e.event_type='signed' AND e.metadata->>'pricing_snapshot_sha256'=s.snapshot_hash
      AND e.metadata->>'signature_snapshot_sha256'=c.signature_snapshot_sha256),
    'signedFactMatches',EXISTS(SELECT FROM gridex_correction_process.facts f
      WHERE f.company_id=c.company_id AND f.table_name='customer_contracts' AND f.row_id=c.id
      AND f.operation='UPDATE' AND f.old_fact->>'status'='pending_signature'
      AND f.new_fact->>'status'='signed'
      AND f.old_fact->>'id'=c.id::text AND f.new_fact->>'id'=c.id::text
      AND f.old_fact->>'company_id'=c.company_id::text AND f.new_fact->>'company_id'=c.company_id::text
      AND f.old_fact->>'signed_at' IS NULL
      AND (f.new_fact->>'signed_at')::timestamptz=c.signed_at),
    'acceptances',(SELECT count(*) FROM public.customer_contract_acceptances a WHERE a.company_id=c.company_id AND a.customer_contract_id=c.id),
    'evidence',(SELECT count(*) FROM public.customer_contract_evidence e WHERE e.company_id=c.company_id AND e.customer_contract_id=c.id AND e.evidence_type='online_acceptance'),
    'signedTransitions',(SELECT count(*) FROM gridex_correction_process.facts f WHERE f.company_id=c.company_id
      AND f.table_name='customer_contracts' AND f.row_id=c.id AND f.operation='UPDATE'
      AND f.old_fact->>'status'='pending_signature' AND f.new_fact->>'status'='signed'))
    FROM public.customer_contracts c JOIN public.contract_price_snapshots s
      ON s.id=c.contract_price_snapshot_id AND s.company_id=c.company_id AND s.contract_id=c.id
    WHERE c.id=${literal(contractId)} AND c.company_id=${literal(fixture.companyId)}`)
}

function expectProjection(contractId: string) {
  expect(projectionWitness(contractId)).toEqual({
    sameScope: true, signed: true, billingIneligible: true,
    canonicalDigestMatches: true, cacheMatches: true, signaturePriceMatches: true,
    metadataPriceMatches: true, signatureDigestMatches: true,
    acceptancePriceMatches: true, acceptanceSignatureMatches: true, acceptanceDigestMatches: true,
    evidencePriceMatches: true, evidenceDigestMatches: true, legalSetMatches: true,
    usedAtMatches: true, signedEventMatches: true, signedFactMatches: true,
    acceptances: 1, evidence: 1, signedTransitions: 1,
  })
}

it('the existing published-contract lifecycle projects the actual normalized canonical price SHA into the billing cache and signed evidence', () => {
  expectProjection(fixture.contractId)
})

it('an already-linked pending request with an empty cache signs atomically, preserves its ledger and replays without extra effects', async () => {
  const pending = await pendingContract()
  const priceBefore = sql<string>(`SELECT to_jsonb(contract_price_snapshot_id) FROM public.customer_contracts
    WHERE id=${literal(pending.contractId)} AND company_id=${literal(fixture.companyId)}`)
  expect(sql(`SELECT to_jsonb(status='pending_signature' AND signed_at IS NULL AND locked_at IS NULL
    AND contract_price_snapshot_id IS NOT NULL AND nullif(snapshot_hash,'') IS NULL)
    FROM public.customer_contracts WHERE id=${literal(pending.contractId)} AND company_id=${literal(fixture.companyId)}`)).toBe(true)
  const updatesBefore = signingUpdateCount(pending.contractId)
  const result = await finalize(pending.tokenHash)
  expect(result.error?.code ?? null).toBeNull()
  const receipt = result.data as {already_signed?: boolean; status?: string}
  expect({alreadySigned: receipt?.already_signed, status: receipt?.status}).toEqual({alreadySigned: false, status: 'signed'})
  expectProjection(pending.contractId)
  expect(signingUpdateCount(pending.contractId) - updatesBefore).toBe(1)
  expect(sql(`SELECT to_jsonb(contract_price_snapshot_id=${literal(priceBefore)}::uuid)
    FROM public.customer_contracts WHERE id=${literal(pending.contractId)} AND company_id=${literal(fixture.companyId)}`)).toBe(true)
  const beforeReplay = tenantEffects()
  const replay = await finalize(pending.tokenHash)
  expect(replay.error?.code ?? null).toBeNull()
  const replayReceipt = replay.data as {already_signed?: boolean; status?: string}
  expect({alreadySigned: replayReceipt?.already_signed, status: replayReceipt?.status}).toEqual({alreadySigned: true, status: 'signed'})
  expect(tenantEffects()).toEqual(beforeReplay)
})

it('signing derives its cache from its own ledger rather than a different genuine contract pricing SHA', async () => {
  const pending = await pendingContract()
  sql(`UPDATE public.customer_contracts c SET snapshot_hash=s.snapshot_hash
    FROM public.contract_price_snapshots s JOIN public.customer_contracts original
      ON original.contract_price_snapshot_id=s.id AND original.company_id=s.company_id AND original.id=s.contract_id
    WHERE c.id=${literal(pending.contractId)} AND c.company_id=${literal(fixture.companyId)}
      AND original.id=${literal(fixture.contractId)} AND original.company_id=c.company_id;`)
  expect(sql(`SELECT to_jsonb(c.snapshot_hash IS NOT NULL AND c.snapshot_hash<>s.snapshot_hash)
    FROM public.customer_contracts c JOIN public.contract_price_snapshots s ON s.id=c.contract_price_snapshot_id
      AND s.company_id=c.company_id AND s.contract_id=c.id
    WHERE c.id=${literal(pending.contractId)} AND c.company_id=${literal(fixture.companyId)}`)).toBe(true)
  expect((await finalize(pending.tokenHash)).error?.code ?? null).toBeNull()
  expectProjection(pending.contractId)
})

it.each(['expired','revoked','wrong_token'] as const)('%s link refusal preserves every signing effect', async reason => {
  const pending = await pendingContract()
  if (reason === 'expired') {
    // The request CHECK requires expires_at>created_at. Move both timestamps
    // coherently; do not disable that CHECK or sleep until a test deadline.
    sql(`UPDATE public.customer_contract_signature_requests SET
      created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour'
      WHERE id=${literal(pending.requestId)} AND company_id=${literal(fixture.companyId)};`)
    expect(sql(`SELECT to_jsonb(expires_at<=now() AND expires_at>created_at AND used_at IS NULL)
      FROM public.customer_contract_signature_requests WHERE id=${literal(pending.requestId)}
      AND company_id=${literal(fixture.companyId)}`)).toBe(true)
  } else if (reason === 'revoked') {
    await prepare(pending.contractId)
    expect(sql(`SELECT to_jsonb(revoked_at IS NOT NULL AND used_at IS NULL)
      FROM public.customer_contract_signature_requests WHERE id=${literal(pending.requestId)}
      AND company_id=${literal(fixture.companyId)}`)).toBe(true)
  }
  const before = tenantEffects()
  const result = await finalize(reason === 'wrong_token' ? randomBytes(32).toString('hex') : pending.tokenHash)
  expect(result.error?.code).toBe(reason === 'wrong_token' ? 'P0002' : '55000')
  if (reason !== 'wrong_token') expect(result.error?.message).toBe(`signature_link_${reason}`)
  // Unknown tokens fail in the retained public wrapper's SELECT INTO STRICT;
  // expecting the inner predecessor's signature_link_not_found would be wrong.
  expect(tenantEffects()).toEqual(before)
})

it.each(['missing','wrong_contract'] as const)('%s canonical linkage is refused without partial signing or cache projection', async reason => {
  const pending = await pendingContract()
  sql(reason === 'missing'
    ? `UPDATE public.customer_contracts SET contract_price_snapshot_id=NULL
        WHERE id=${literal(pending.contractId)} AND company_id=${literal(fixture.companyId)};`
    : `UPDATE public.customer_contracts c SET contract_price_snapshot_id=original.contract_price_snapshot_id
        FROM public.customer_contracts original WHERE c.id=${literal(pending.contractId)}
        AND c.company_id=${literal(fixture.companyId)} AND original.id=${literal(fixture.contractId)}
        AND original.company_id=c.company_id;`)
  const before = tenantEffects()
  const result = await finalize(pending.tokenHash)
  expect(result.error?.code).toBe('23514')
  expect(result.error?.message).toBe('signature_pricing_snapshot_missing')
  expect(tenantEffects()).toEqual(before)
})

it('the retention wrapper refuses a different actual tenant before signing preparation can write', async () => {
  const pending = await pendingContract(), otherCompany = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status)
    VALUES(${literal(otherCompany)},'Synthetic billing projection scope control','active');`)
  const before = tenantEffects(), otherBefore = tenantEffects(otherCompany)
  const result = await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1', {
    p_company_id: otherCompany, p_customer_id: fixture.customerId, p_contract_id: pending.contractId,
    p_token_hash: randomBytes(32).toString('hex'), p_recipient_email: 'synthetic@example.invalid',
    p_expires_at: new Date(Date.now()+3600000).toISOString(), p_actor_user_id: fixture.actorUserId,
    p_channel: 'internal',
  })
  expect(result.error?.code).toBe('P0001')
  expect(result.error?.message).toBe('customer_contract_record_scope_required')
  expect(tenantEffects()).toEqual(before)
  expect(tenantEffects(otherCompany)).toEqual(otherBefore)
})

it('a scoped late signed-event failure rolls back projected cache, evidence and token use; removing the fault allows real signing', async () => {
  const pending = await pendingContract()
  const name = `native_billing_fault_${randomUUID().replaceAll('-','')}`
  try {
    sql(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
    IF NEW.company_id=${literal(fixture.companyId)}::uuid
      AND NEW.customer_contract_id=${literal(pending.contractId)}::uuid AND NEW.event_type='signed' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='native_billing_projection_late_signed_event_failure';
    END IF;RETURN NEW;END$$;
    REVOKE ALL ON FUNCTION public.${name}() FROM PUBLIC,anon,authenticated,service_role;
    CREATE TRIGGER ${name} BEFORE INSERT ON public.customer_contract_events
      FOR EACH ROW EXECUTE FUNCTION public.${name}();`)
    const before = tenantEffects()
    const result = await finalize(pending.tokenHash)
    // The specific exception proves the public wrapper reached the event owner
    // after the finalizer's legal/evidence/cache UPDATE and token consumption.
    expect(result.error?.code).toBe('P0001')
    expect(result.error?.message).toBe('native_billing_projection_late_signed_event_failure')
    expect(tenantEffects()).toEqual(before)
  } finally {
    sql(`DROP TRIGGER IF EXISTS ${name} ON public.customer_contract_events;DROP FUNCTION IF EXISTS public.${name}();`)
    expect(sql(`SELECT to_jsonb(NOT EXISTS(SELECT FROM pg_trigger WHERE tgname=${literal(name)})
      AND NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=${literal(name)}))`)).toBe(true)
  }
  expect((await finalize(pending.tokenHash)).error?.code ?? null).toBeNull()
  expectProjection(pending.contractId)
})

it('canonical price rows and protected signed evidence remain immutable while internal signing predecessors stay inaccessible', async () => {
  const pending = await pendingContract()
  expect((await finalize(pending.tokenHash)).error?.code ?? null).toBeNull()
  const before = tenantEffects()
  const priceId = sql<string>(`SELECT to_jsonb(contract_price_snapshot_id) FROM public.customer_contracts
    WHERE id=${literal(pending.contractId)} AND company_id=${literal(fixture.companyId)}`)
  const priceMutation = await supabaseService.from('contract_price_snapshots')
    .update({snapshot_json: {synthetic_tamper: true}}).eq('id',priceId).eq('company_id',fixture.companyId)
  expect(priceMutation.error?.code).toBe('P0001')
  expect(priceMutation.error?.message).toContain('contract_price_snapshots are immutable (UPDATE)')
  expect(tenantEffects()).toEqual(before)
  const signatureMutation = await supabaseService.from('customer_contracts')
    .update({signature_snapshot: {synthetic_tamper: true}}).eq('id',pending.contractId).eq('company_id',fixture.companyId)
  expect(signatureMutation.error?.code).toBe('55000')
  expect(signatureMutation.error?.message).toBe('signed_customer_contract_immutable:signature_snapshot')
  expect(tenantEffects()).toEqual(before)
  expect(sql(`SELECT to_jsonb(bool_and(NOT has_function_privilege(role_name,identity,'EXECUTE')))
    FROM unnest(ARRAY['anon','authenticated','service_role']) role_name
    CROSS JOIN unnest(ARRAY[
      'public.gridex_prepare_signature_before_record_retention_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)',
      'public.gridex_finalize_signature_before_record_retention_v1(text,text,text)']) identity`)).toBe(true)
  expect(sql(`SELECT to_jsonb(bool_and(has_function_privilege('service_role',identity,'EXECUTE')
    AND NOT has_function_privilege('anon',identity,'EXECUTE')
    AND NOT has_function_privilege('authenticated',identity,'EXECUTE')))
    FROM unnest(ARRAY[
      'public.gridex_prepare_customer_contract_signature_request_v1(uuid,uuid,uuid,text,text,timestamptz,uuid,text)',
      'public.gridex_finalize_customer_contract_signature_v1(text,text,text)']) identity`)).toBe(true)
  const privateResult = await supabaseService.rpc('gridex_finalize_signature_before_record_retention_v1', {
    p_token_hash: pending.tokenHash, p_signed_ip_hash: null, p_signed_user_agent: null,
  })
  expect(typeof privateResult.error?.code).toBe('string')
  // PostgREST may hide an ungranted function from its cache or report SQL ACL.
  expect(['42501','PGRST202']).toContain(privateResult.error?.code)
  expect(tenantEffects()).toEqual(before)
  expectProjection(pending.contractId)
  // Deliberately no immutability claim or mutation assertion for c.snapshot_hash.
})

it('a genuine public record-retention transition blocks signing at the outer wrapper without recreating redacted evidence or cache', async () => {
  const pending = await pendingContract()
  const submitter = await createCustomerRecordRetentionNativeUser(fixture.companyId,
    ['ediel.retention.submit','ediel.retention.purge','ediel.retention.signature'])
  const reviewer = await createCustomerRecordRetentionNativeUser(fixture.companyId,
    ['ediel.retention.review','ediel.retention.signature'])
  const issuerId = randomUUID()
  const issuerKey = Buffer.from('SYNTHETIC billing projection retention fixture HMAC key')
  const legal = Buffer.from('SYNTHETIC test competence only; no real legal policy approval')
  const document = Buffer.from('SYNTHETIC exact signature-request retention test decision')
  const retentionClass = 'contract_signature_request_personal'
  const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
  // Explicit synthetic competence is this fixture's boundary, matching the
  // existing retention fixture. No private decision/review/tombstone is seeded.
  sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,
    legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuerId)},${literal(fixture.companyId)},
    'SYNTHETIC COMPETENCE ONLY',decode(${literal(legal.toString('hex'))},'hex'),${literal(digest(legal))},
    decode(${literal(issuerKey.toString('hex'))},'hex'),'2020-01-01','2099-01-01');
    UPDATE public.customers SET status='archived'
      WHERE id=${literal(fixture.customerId)} AND company_id=${literal(fixture.companyId)};`)
  expect(sql(`SELECT to_jsonb(NOT EXISTS(SELECT FROM public.customer_supply_periods
    WHERE company_id=${literal(fixture.companyId)} AND customer_id=${literal(fixture.customerId)}))`)).toBe(true)
  // Observe the actual source row and immutable catalog to derive receipt claims.
  // The real submit/review/purge owners independently recalculate and verify them.
  const basis = sql<Record<string,unknown>>(`SELECT jsonb_build_object(
    'companyId',r.company_id,'retentionClass',k.retention_class,'sourceTable',k.source_table,
    'targetId',r.id,'customerId',r.customer_id,'contractId',r.customer_contract_id,
    'sourceHash',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),
    'targetHash',encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),
    'byteLength',octet_length(convert_to(to_jsonb(r)::text,'UTF8')),'storagePath',NULL,'operation',k.operation)
    FROM public.customer_contract_signature_requests r CROSS JOIN gridex_ediel_retention.record_class_catalog k
    WHERE r.id=${literal(pending.requestId)} AND r.company_id=${literal(fixture.companyId)}
      AND k.retention_class=${literal(retentionClass)}`)
  const payload = Buffer.from(JSON.stringify({
    format: 'ediel_customer_record_retention_policy_v1', ...basis, documentHash: digest(document),
    issuerLegalReference: 'SYNTHETIC COMPETENCE ONLY', legalBasisReference: 'SYNTHETIC test exact request deadline',
    journalPurposeReference: 'SYNTHETIC test continuity', accessRevocationRequired: true,
    issuedAt: new Date(Date.now()-60000).toISOString(), expiresAt: new Date(Date.now()+3600000).toISOString(),
    retainUntil: new Date(Date.now()-1000).toISOString(), journalRetainUntil: new Date(Date.now()+3600000).toISOString(),
  }))
  const submitted = await submitter.client.rpc('ediel_submit_customer_record_retention_v1', {
    p_company_id: fixture.companyId, p_actor_user_id: submitter.id, p_retention_class: retentionClass,
    p_target_id: pending.requestId, p_document_base64: document.toString('base64'),
    p_issuer_receipt: {issuerId,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',issuerKey).update(payload).digest('hex')},
  })
  expect(submitted.error?.code ?? null).toBeNull()
  const submittedReceipt = submitted.data as {status?:string; issuerQualified?:boolean; decisionId:string}
  expect({status:submittedReceipt?.status,issuerQualified:submittedReceipt?.issuerQualified})
    .toEqual({status:'submitted',issuerQualified:true})
  const decisionId = submittedReceipt.decisionId
  const reviewed = await reviewer.client.rpc('ediel_review_customer_record_retention_v1', {
    p_company_id: fixture.companyId, p_actor_user_id: reviewer.id, p_decision_id: decisionId,
    p_outcome: 'approve', p_reason: 'SYNTHETIC separate review of the exact test request',
  })
  expect(reviewed.error?.code ?? null).toBeNull()
  expect((reviewed.data as {status?:string})?.status).toBe('approved')
  const retained = await submitter.client.rpc('ediel_begin_customer_record_retention_v1', {
    p_company_id: fixture.companyId, p_actor_user_id: submitter.id, p_decision_id: decisionId,
  })
  expect(retained.error?.code ?? null).toBeNull()
  const retainedReceipt = retained.data as {status?:string; retentionClass?:string}
  expect({status:retainedReceipt?.status,retentionClass:retainedReceipt?.retentionClass})
    .toEqual({status:'redacted',retentionClass})
  expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM gridex_ediel_retention.record_tombstones
    WHERE company_id=${literal(fixture.companyId)} AND contract_id=${literal(pending.contractId)}
    AND target_id=${literal(pending.requestId)} AND retention_class=${literal(retentionClass)}))`)).toBe(true)
  const before = tenantEffects()
  const result = await finalize(pending.tokenHash)
  expect(result.error?.code).toBe('P0001')
  expect(result.error?.message).toBe('customer_contract_records_retention_tombstoned')
  expect(tenantEffects()).toEqual(before)
}, 180000)
