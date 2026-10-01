import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { decisionUser } from './helpers/ediel-decision-original-native-fixture'
import { seedNormalSwitchNativeFixture, nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { attachNetworkRegistrySourceFixture } from './helpers/ediel-network-registry-native-fixture'
import { archiveNetworkRegistrySource, reviewNetworkRegistrySource } from '@/lib/ediel/production/networkRegistrySource'
import { supabaseService } from '@/lib/supabase/service'

// Actual local PostgreSQL, GoTrue sessions, JWT/auth.uid(), Storage and installed
// intake RPCs. Publication/customer signature and network issuer competence in
// the shared fixture are explicit SYNTHETIC mechanisms, never authentic Ediel
// or legal-source evidence. No private approval/qualification/mandate is seeded.
vi.mock('server-only', () => ({}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: async () => null }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: async () => null }))
afterEach(() => vi.unstubAllEnvs())

const permissions = ['communication.read', 'communication.write', 'customers.read', 'customers.write', 'contracts.read', 'contracts.write', 'metering.read', 'metering.write', 'ediel.source.review', 'ediel.supply_rescission.review']
const authenticatedIntakeSignatures = [
  'ediel_contract_intake_scope_v1(uuid,uuid,uuid,text,text)',
  'ediel_archive_contract_original_source_v1(uuid,uuid,uuid,text,text,jsonb)',
  'ediel_review_contract_original_source_v1(uuid,uuid,uuid,jsonb)',
  'ediel_read_contract_original_source_v1(uuid,uuid,uuid)',
  'ediel_list_contract_original_sources_v1(uuid,uuid,uuid)',
  'ediel_signed_brp_declaration_scope_v1(uuid,uuid,jsonb)',
  'ediel_archive_signed_brp_declaration_v1(uuid,uuid,jsonb)',
  'ediel_read_signed_brp_declaration_v1(uuid,uuid,uuid,boolean)',
  'ediel_review_signed_brp_declaration_v1(uuid,uuid,uuid,jsonb)',
  'ediel_revoke_signed_brp_declaration_v1(uuid,uuid,uuid,text)',
  'ediel_supply_rescission_scope_v1(uuid,uuid,jsonb)',
  'ediel_archive_supply_rescission_v1(uuid,uuid,jsonb)',
  'ediel_review_supply_rescission_v1(uuid,uuid,uuid,jsonb)',
  'ediel_read_supply_rescission_artifact_v1(uuid,uuid,uuid,boolean)',
]
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const serviceClient = () => createClient('http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
const anonymousClient = () => createClient('http://127.0.0.1:54321', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
function sourceEffects(company: string) {
  return sql(`SELECT jsonb_build_object(
   'artifacts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM gridex_contract_source_intake.artifacts a WHERE company_id=${literal(company)}),
   'reviews',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM gridex_contract_source_intake.reviews r WHERE company_id=${literal(company)}),
   'qualifications',(SELECT count(*) FROM gridex_contract_source_intake.qualifications WHERE company_id=${literal(company)}),
   'masterdata',(SELECT count(*) FROM gridex_customer_masterdata.signed_declarations WHERE company_id=${literal(company)}),
   'methods',(SELECT count(*) FROM gridex_metering_method_changes.contract_request_declarations WHERE company_id=${literal(company)}),
   'events',(SELECT count(*) FROM gridex_metering_method_changes.events WHERE company_id=${literal(company)}),
   'production',(SELECT count(*) FROM gridex_received_sources.production_contract_events WHERE company_id=${literal(company)}),
   'brpArtifacts',(SELECT count(*) FROM gridex_brp_declaration_intake.artifacts WHERE company_id=${literal(company)}),
   'brpDeclarations',(SELECT count(*) FROM gridex_brp_sources.contract_declarations WHERE company_id=${literal(company)}),
   'brpOrigins',(SELECT count(*) FROM gridex_brp_declaration_intake.origins WHERE company_id=${literal(company)}),
   'hArtifacts',(SELECT count(*) FROM gridex_supply_rescission.artifacts WHERE company_id=${literal(company)}),
   'hReviews',(SELECT count(*) FROM gridex_supply_rescission.reviews WHERE company_id=${literal(company)}),
   'hMandates',(SELECT count(*) FROM gridex_supply_rescission.mandates WHERE company_id=${literal(company)}),
   'audit',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM public.audit_logs a WHERE company_id=${literal(company)} AND action LIKE 'ediel.contract_original.%'),
   'outbound',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(company)} AND direction='outbound'),
   'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(company)}),
   'transport',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE company_id=${literal(company)}))`)
}
function currentDeny(company: string, actor: string, permission: string) {
  const id = randomUUID()
  sql(`INSERT INTO public.user_permission_overrides(id,company_id,user_id,permission_key,effect,is_active,valid_from,valid_to,reason)
    VALUES(${literal(id)},${literal(company)},${literal(actor)},${literal(permission)},'deny',true,clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day','SYNTHETIC native current-authority refusal')`)
  return () => sql(`DELETE FROM public.user_permission_overrides WHERE id=${literal(id)}`)
}
async function actors(company: string) {
  const password = randomUUID() + 'Aa1!'
  const uploader = await decisionUser(company, permissions, password)
  const reviewer = await decisionUser(company, permissions, password)
  const foreignCompany = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreignCompany)},'SYNTHETIC original-intake foreign tenant','active')`)
  const foreign = await decisionUser(foreignCompany, permissions, password)
  return { uploader, reviewer, foreign, foreignCompany }
}

it('installed source producer ACLs require authenticated session actors while execution-only H consumers retain service ownership', () => {
  for (const signature of authenticatedIntakeSignatures) {
    const actual = sql<{ oid: number; securityDefiner: boolean; authenticated: boolean; service: boolean; anonymous: boolean }>(`SELECT jsonb_build_object(
      'oid',p.oid::bigint,'securityDefiner',p.prosecdef,'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
      'service',has_function_privilege('service_role',p.oid,'EXECUTE'),'anonymous',has_function_privilege('anon',p.oid,'EXECUTE'))
      FROM pg_proc p WHERE p.oid=to_regprocedure(${literal('public.' + signature)})`)
    expect(actual, signature).toMatchObject({ securityDefiner: true, authenticated: true, service: false, anonymous: false })
    expect(actual.oid, signature).toBeGreaterThan(0)
  }
  expect(sql(`SELECT jsonb_build_object('service',has_function_privilege('service_role','public.ediel_read_supply_rescission_mandate_v1(uuid,uuid,uuid)','EXECUTE'),
    'authenticated',has_function_privilege('authenticated','public.ediel_read_supply_rescission_mandate_v1(uuid,uuid,uuid)','EXECUTE'))`)).toEqual({ service: true, authenticated: false })
  for (const schema of ['gridex_contract_source_intake', 'gridex_brp_declaration_intake', 'gridex_supply_rescission']) {
    expect(sql(`SELECT to_jsonb(count(*)) FROM pg_proc p WHERE p.pronamespace=${literal(schema)}::regnamespace
      AND(has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))`), schema).toBe(0)
  }
})

it('actual authenticated contract intake preserves unqualified bytes and idempotency, rejects forged/current actors and rolls back a late native deny', async () => {
  const f = await seedNormalSwitchNativeFixture({ deferOriginal: true })
  const network = await attachNetworkRegistrySourceFixture(f)
  const networkArtifact = await archiveNetworkRegistrySource({ ...network.submission('SYNTHETIC network boundary for native intake mechanics', network.pdf('native intake scope only')), companyId: f.companyId, actorUserId: network.uploader.id })
  expect((await reviewNetworkRegistrySource({ ...networkArtifact, companyId: f.companyId, actorUserId: network.reviewer.id,
    decision: 'approve', reason: 'SYNTHETIC separate native network source mechanism', clause: network.clause })).status).toBe('authorized')
  const a = await actors(f.companyId)
  const document = sql<{ bucket: string; path: string }>(`SELECT jsonb_build_object('bucket',storage_bucket,'path',storage_path)
    FROM public.customer_contract_documents WHERE company_id=${literal(f.companyId)} AND customer_contract_id=${literal(f.contractId)}
     AND document_type='signed_contract_pdf' AND document_sha256=${literal(f.documentSha256)} ORDER BY id LIMIT 1`)
  const stored = await supabaseService.storage.from(document.bucket).download(document.path)
  expect(stored.error).toBeNull(); expect(stored.data).not.toBeNull()
  const pdf = Buffer.from(await stored.data!.arrayBuffer())
  expect(digest(pdf)).toBe(f.documentSha256)
  const packet = (reference: string) => Buffer.from(JSON.stringify({ claims: { previousDeclarationId: null, requestedMethod: 'Z04', sourceReference: reference, sourceVersion: '1' } }))
  const submission = (source: Buffer) => ({ agreementBase64: pdf.toString('base64'), sourceBase64: source.toString('base64'), issuerKeyId: null, representationId: null, signatureHex: null })
  const parameters = { p_company_id: f.companyId, p_actor_user_id: a.uploader.id, p_contract_id: f.contractId, p_environment: 'test', p_kind: 'contract_requested_method', p_submission: submission(packet('SYNTHETIC unsigned native staging')) }
  const before = sourceEffects(f.companyId)
  for (const db of [serviceClient(), anonymousClient()]) {
    const refused = await db.rpc('ediel_archive_contract_original_source_v1', parameters)
    expect(refused.data).toBeNull(); expect(refused.error?.code).toBe('42501')
  }
  for (const invalid of [{ ...parameters, p_actor_user_id: a.reviewer.id }, { ...parameters, p_company_id: a.foreignCompany }]) {
    const refused = await a.uploader.client.rpc('ediel_archive_contract_original_source_v1', invalid)
    expect(refused.data).toBeNull(); expect(refused.error?.code).toBe('42501')
  }
  const flags = await a.uploader.client.rpc('ediel_archive_contract_original_source_v1', { ...parameters, p_submission: { ...parameters.p_submission, verified: true, approved: true, actorType: 'system' } })
  expect(flags.data).toBeNull(); expect(flags.error?.message).toContain('contract_intake_exact_submission_required')
  expect(sourceEffects(f.companyId)).toEqual(before)
  const archived = await a.uploader.client.rpc('ediel_archive_contract_original_source_v1', parameters)
  expect(archived.error).toBeNull()
  expect(archived.data).toMatchObject({ status: 'archived', missing: expect.arrayContaining(['current_authentic_issuer_receipt_and_legal_representation', 'independent_current_source_review']) })
  const artifactId: string = archived.data.artifactId
  const frozen = sourceEffects(f.companyId)
  const retry = await a.uploader.client.rpc('ediel_archive_contract_original_source_v1', parameters)
  expect(retry.error).toBeNull(); expect(retry.data).toEqual(archived.data); expect(sourceEffects(f.companyId)).toEqual(frozen)
  const readParameters = { p_company_id: f.companyId, p_actor_user_id: a.uploader.id, p_artifact_id: artifactId }
  const read = await a.uploader.client.rpc('ediel_read_contract_original_source_v1', readParameters)
  expect(read.error).toBeNull(); expect(read.data).toMatchObject({ status: 'archived', sourceId: null, submittedBy: a.uploader.id })
  const review = { sourceHash: archived.data.sourceHash, agreementHash: archived.data.agreementHash, claimsHash: archived.data.claimsHash, decision: 'approve', reason: 'SYNTHETIC independent review cannot replace absent issuer competence' }
  for (const db of [serviceClient(), anonymousClient()]) {
    const result = await db.rpc('ediel_review_contract_original_source_v1', { ...readParameters, p_actor_user_id: a.reviewer.id, p_review: review })
    expect(result.error?.code).toBe('42501'); expect(result.data).toBeNull()
  }
  const claimedReviewer = await a.uploader.client.rpc('ediel_review_contract_original_source_v1', { ...readParameters, p_actor_user_id: a.reviewer.id, p_review: review })
  expect(claimedReviewer.error?.code).toBe('42501'); expect(claimedReviewer.data).toBeNull()
  const self = await a.uploader.client.rpc('ediel_review_contract_original_source_v1', { ...readParameters, p_review: review })
  expect(self.error?.message).toContain('contract_intake_independent_exact_hash_bound_review_required'); expect(self.data).toBeNull()
  expect(sourceEffects(f.companyId)).toEqual(frozen)
  const held = await a.reviewer.client.rpc('ediel_review_contract_original_source_v1', { ...readParameters, p_actor_user_id: a.reviewer.id, p_review: review })
  expect(held.error).toBeNull(); expect(held.data).toMatchObject({ status: 'held', missing: expect.arrayContaining(['current_authentic_issuer_receipt_and_legal_representation']) })
  expect(sql(`SELECT jsonb_build_object('qualified',(SELECT count(*) FROM gridex_contract_source_intake.qualifications WHERE company_id=${literal(f.companyId)}),
    'target',(SELECT count(*) FROM gridex_metering_method_changes.contract_request_declarations WHERE company_id=${literal(f.companyId)}))`)).toEqual({ qualified: 0, target: 0 })
  const unchanged = sourceEffects(f.companyId)
  const clearReview = currentDeny(f.companyId, a.reviewer.id, 'ediel.source.review')
  try {
    const revoked = await a.reviewer.client.rpc('ediel_review_contract_original_source_v1', { ...readParameters, p_actor_user_id: a.reviewer.id, p_review: review })
    expect(revoked.error?.code).toBe('42501'); expect(revoked.data).toBeNull(); expect(sourceEffects(f.companyId)).toEqual(unchanged)
  } finally { clearReview() }
  const foreign = await a.foreign.client.rpc('ediel_read_contract_original_source_v1', { ...readParameters, p_actor_user_id: a.foreign.id })
  expect(foreign.error?.code).toBe('42501'); expect(foreign.data).toBeNull()
  for (const permission of ['communication.read', 'communication.write']) {
    const clear = currentDeny(f.companyId, a.uploader.id, permission)
    try {
      const result = permission.endsWith('.read') ? await a.uploader.client.rpc('ediel_read_contract_original_source_v1', readParameters)
        : await a.uploader.client.rpc('ediel_archive_contract_original_source_v1', parameters)
      expect(result.error?.code).toBe('42501'); expect(result.data).toBeNull()
      expect(sourceEffects(f.companyId)).toEqual(unchanged)
    } finally { clear() }
  }
  sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(f.companyId)} AND user_id=${literal(a.uploader.id)}`)
  try {
    const revoked = await a.uploader.client.rpc('ediel_archive_contract_original_source_v1', parameters)
    expect(revoked.error?.code).toBe('42501'); expect(revoked.data).toBeNull(); expect(sourceEffects(f.companyId)).toEqual(unchanged)
  } finally { sql(`UPDATE public.company_memberships SET is_active=true WHERE company_id=${literal(f.companyId)} AND user_id=${literal(a.uploader.id)}`) }
  const probe = 'native_intake_deny_' + randomUUID().replaceAll('-', '')
  sql(`CREATE FUNCTION public.${probe}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
    IF NEW.company_id=${literal(f.companyId)}::uuid AND NEW.actor_user_id=${literal(a.uploader.id)}::uuid AND NEW.action='ediel.contract_original.archived' THEN
     INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from,valid_to,reason)
      VALUES(${literal(f.companyId)},${literal(a.uploader.id)},'communication.write','deny',true,clock_timestamp()+interval '40 milliseconds',clock_timestamp()+interval '1 day','SYNTHETIC late current native deny');
     PERFORM pg_sleep(0.08);END IF;RETURN NEW;END$$;
    REVOKE ALL ON FUNCTION public.${probe}() FROM PUBLIC,anon,authenticated,service_role;
    CREATE TRIGGER ${probe} AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.${probe}();`)
  try {
    const result = await a.uploader.client.rpc('ediel_archive_contract_original_source_v1', { ...parameters, p_submission: submission(packet('SYNTHETIC late-deny rollback staging')) })
    expect(result.error?.code).toBe('42501'); expect(result.data).toBeNull()
    expect(sourceEffects(f.companyId)).toEqual(unchanged)
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.user_permission_overrides WHERE company_id=${literal(f.companyId)} AND user_id=${literal(a.uploader.id)} AND reason='SYNTHETIC late current native deny'`)).toBe(0)
  } finally { sql(`DROP TRIGGER ${probe} ON public.audit_logs;DROP FUNCTION public.${probe}();`) }
  console.info('EDIEL_ORIGINAL_INTAKE_NATIVE_SCOPE', JSON.stringify({ contractArchiveSession: 'actual GoTrue/JWT', originalAuthority: 'missing issuer', qualifiedTargetEffects: 0,
    syntheticBoundary: 'shared contract acceptance and signed network scope fixture only', authenticEdielIntegration: false }))
}, 240_000)

it('actual BRP/H sessions reject claimed identities/current denies and hold absent native scope without source or mandate effects', async () => {
  const company = randomUUID()
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'SYNTHETIC BRP/H absent-source native staging','active')`)
  const a = await actors(company)
  const contract = randomUUID(), ground = randomUUID(), selector = { environment: 'test', contractId: contract, registryGroundId: ground, identityAgency: '9', agreementHash: 'a'.repeat(64) }
  const hSelector = { environment: 'test', supplyPeriodId: randomUUID(), effectiveAt: '2026-10-15T12:00:00Z', rulePackId: randomUUID() }
  const inputs = [
    { name: 'ediel_signed_brp_declaration_scope_v1', args: { p_company_id: company, p_actor_user_id: a.uploader.id, p_selector: selector }, missing: 'actual_current_signed_contract_document_registry_scope' },
    { name: 'ediel_supply_rescission_scope_v1', args: { p_company_id: company, p_actor_user_id: a.uploader.id, p_selector: hSelector }, missing: 'actual_current_own_supply_signed_contract_and_national_source_grammar' },
  ]
  const before = sourceEffects(company)
  for (const input of inputs) {
    for (const db of [serviceClient(), anonymousClient()]) {
      const result = await db.rpc(input.name, input.args)
      expect(result.error?.code).toBe('42501'); expect(result.data).toBeNull()
    }
    for (const args of [{ ...input.args, p_actor_user_id: a.reviewer.id }, { ...input.args, p_company_id: a.foreignCompany }]) {
      const result = await a.uploader.client.rpc(input.name, args)
      expect(result.error?.code).toBe('42501'); expect(result.data).toBeNull()
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await a.uploader.client.rpc(input.name, input.args)
      expect(result.error).toBeNull(); expect(result.data).toMatchObject({ status: 'held', missing: expect.arrayContaining([input.missing]) })
      expect(sourceEffects(company)).toEqual(before)
    }
    const clear = currentDeny(company, a.uploader.id, 'communication.read')
    try {
      const denied = await a.uploader.client.rpc(input.name, input.args)
      expect(denied.error?.code).toBe('42501'); expect(denied.data).toBeNull(); expect(sourceEffects(company)).toEqual(before)
    } finally { clear() }
  }
  const base = { p_company_id: company, p_actor_user_id: a.uploader.id }
  const brp = { environment: selector.environment, contractId: selector.contractId, registryGroundId: selector.registryGroundId, identityAgency: selector.identityAgency,
    agreementBase64: Buffer.from('%PDF-1.7\nSYNTHETIC no native contract').toString('base64'), sourceBase64: Buffer.from('SYNTHETIC absent issuer/source').toString('base64'), sourceReference: 'SYNTHETIC unqualified', sourceVersion: '1' }
  const h = { ...hSelector, source: { bytesBase64: Buffer.from('SYNTHETIC absent legal original').toString('base64'), mimeType: 'text/plain', reference: 'SYNTHETIC unqualified', version: '1' } }
  for (const input of [{ name: 'ediel_archive_signed_brp_declaration_v1', submission: brp, error: 'signed_brp_archive_shape_required' },
    { name: 'ediel_archive_supply_rescission_v1', submission: h, error: 'supply_rescission_archive_shape_required' }]) {
    const forged = await a.uploader.client.rpc(input.name, { ...base, p_submission: { ...input.submission, verified: true, issuerQualified: true, actorType: 'system' } })
    expect(forged.error?.message).toContain(input.error); expect(forged.data).toBeNull()
    const absent = await a.uploader.client.rpc(input.name, { ...base, p_submission: input.submission })
    if (input.name === 'ediel_archive_signed_brp_declaration_v1') {
      expect(absent.error?.message).toContain('signed_brp_actual_current_contract_document_registry_scope_required'); expect(absent.data).toBeNull()
    } else {
      expect(absent.error).toBeNull(); expect(absent.data).toMatchObject({ status: 'held', missing: expect.arrayContaining(['actual_current_own_supply_signed_contract_and_national_source_grammar']) })
    }
    const clear = currentDeny(company, a.uploader.id, 'communication.write')
    try {
      const denied = await a.uploader.client.rpc(input.name, { ...base, p_submission: input.submission })
      expect(denied.error?.code).toBe('42501'); expect(denied.data).toBeNull()
    } finally { clear() }
    expect(sourceEffects(company)).toEqual(before)
  }
  for (const name of ['ediel_review_signed_brp_declaration_v1', 'ediel_review_supply_rescission_v1']) {
    const args = { ...base, p_actor_user_id: a.reviewer.id, p_artifact_id: randomUUID(), p_review: { decision: 'approve', reason: 'SYNTHETIC nonexistent original cannot be approved' } }
    for (const db of [serviceClient(), anonymousClient(), a.uploader.client]) {
      const result = await db.rpc(name, args)
      expect(result.error?.code).toBe('42501'); expect(result.data).toBeNull(); expect(sourceEffects(company)).toEqual(before)
    }
    const clear = currentDeny(company, a.reviewer.id, name.includes('signed_brp') ? 'ediel.source.review' : 'ediel.supply_rescission.review')
    try {
      const result = await a.reviewer.client.rpc(name, args)
      expect(result.error?.code).toBe('42501'); expect(result.data).toBeNull(); expect(sourceEffects(company)).toEqual(before)
    } finally { clear() }
  }
  sql(`UPDATE public.company_memberships SET is_active=false WHERE company_id=${literal(company)} AND user_id=${literal(a.uploader.id)}`)
  try {
    for (const input of inputs) {
      const result = await a.uploader.client.rpc(input.name, input.args)
      expect(result.error?.code).toBe('42501'); expect(result.data).toBeNull(); expect(sourceEffects(company)).toEqual(before)
    }
  } finally { sql(`UPDATE public.company_memberships SET is_active=true WHERE company_id=${literal(company)} AND user_id=${literal(a.uploader.id)}`) }
  console.info('EDIEL_BRP_H_NATIVE_SCOPE', JSON.stringify({ session: 'actual GoTrue/JWT', absentScope: 'no own signed BRP source / own supply H source', sourceOrMandateEffects: 0,
    positiveBrpOrHMechanism: false, authenticIssuerOrEdielIntegration: false }))
}, 120_000)
