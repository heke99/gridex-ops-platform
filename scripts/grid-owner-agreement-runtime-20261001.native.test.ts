import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { afterAll, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { agreementSaveCommand, executeAgreementCommand, prepareAgreementDocumentUpload, type AgreementUploadIntent } from '@/lib/routes/gridOwnerAgreements'
import { parseGridOwnerAgreementDocumentKey } from '@/lib/routes/gridOwnerAgreementDocumentKey'

const API = 'http://127.0.0.1:54321', DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', bucket = 'grid-owner-agreements'
const pdf = Buffer.from('%PDF-1.4\n% Synthetic owned agreement runtime fixture, never a customer document.\n%%EOF\n')
const fileSha = createHash('sha256').update(pdf).digest('hex')
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
const fetchOriginal = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['3000', '54321'].includes(url.port)) throw new Error('agreement_runtime_nonlocal_transport_forbidden')
  return fetchOriginal(input, init)
}
afterAll(() => { globalThis.fetch = fetchOriginal })
function sql<T>(statement: string): T {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('agreement_runtime_local_database_required')
  try { return JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim()) as T }
  catch { throw new Error('agreement_runtime_private_database_stage_failed') }
}
const finance = ['customers', 'customer_contracts', 'customer_supply_periods', 'billing_underlays', 'pricing_runs', 'pricing_preview_lines',
  'customer_invoices', 'customer_invoice_lines', 'invoice_documents', 'invoice_export_items', 'invoice_export_runs', 'invoice_export_attempts',
  'billing_export_runs', 'billing_export_run_items', 'invoice_purchase_events', 'partner_exports'] as const
function fingerprint(relation: string, predicate = '') {
  // Hash exact PostgreSQL jsonb/text before JavaScript can round any numeric.
  return sql<string>(`SELECT to_jsonb(encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text,'UTF8')),'hex')) FROM ${relation} r ${predicate};`)
}
function finances() { return Object.fromEntries(finance.map(table => [table, fingerprint('public.' + table)])) }
function identities(actor?: string) {
  const excluded = actor ? `WHERE id<>${quote(actor)}::uuid` : ''
  return { users: fingerprint('auth.users', excluded), profiles: fingerprint('public.user_profiles', excluded),
    sessions: fingerprint('auth.sessions', actor ? `WHERE user_id<>${quote(actor)}::uuid` : ''),
    identities: fingerprint('auth.identities', actor ? `WHERE user_id<>${quote(actor)}::uuid` : '') }
}
type Claim = { uploadIntentId: string; claimToken: string; attempt: number; companyId: string; bucket: string; path: string; leaseExpiresAt: number }
type Fixture = { tag: string; company: string; quiet: string; owner: string; quietOwner: string; actor: { id: string; email: string };
  financialIds: { customer: string; contract: string; underlay: string; invoice: string; line: string };
  originalFinance: Record<string, string>; seededFinance: Record<string, string>; originalIdentity: ReturnType<typeof identities>; originalStorage: string;
  quietBefore: string; mounted?: { id: string; path: string; documentPath: string; revision: number };
  orphan?: AgreementUploadIntent; uncertain?: AgreementUploadIntent; quietAttached?: { id: string; intent: AgreementUploadIntent };
  crash?: Claim; lastFinishedClaim?: { claimToken: string; attempt: number };
  preservedAgreements?: Record<string, string>; clockControls: string[] }
const path = resolve(process.env.GRIDEX_AGREEMENT_RUNTIME_FIXTURE_PATH ?? '')
if (!process.env.RUNNER_TEMP || !path.startsWith(resolve(process.env.RUNNER_TEMP) + sep)) throw new Error('agreement_runtime_private_fixture_required')
function read() { return JSON.parse(readFileSync(path, 'utf8')) as Fixture }
function save(f: Fixture) { writeFileSync(path, JSON.stringify(f), { mode: 0o600 }) }
function quiet(f: Fixture) { return fingerprint('public.grid_owners', `WHERE id=${quote(f.quietOwner)}`) }
function protectedGraphs(f: Fixture) { expect(finances()).toEqual(f.seededFinance); expect(identities(f.actor.id)).toEqual(f.originalIdentity); expect(quiet(f)).toBe(f.quietBefore) }
function attachedAgreements(f: Fixture) {
  if (!f.mounted || !f.quietAttached) throw new Error('agreement_runtime_attached_bindings_required')
  expect(sql(`SELECT jsonb_build_object('mounted',(SELECT count(*) FROM public.grid_owner_access_agreements WHERE id=${quote(f.mounted.id)} AND company_id=${quote(f.company)} AND created_by=${quote(f.actor.id)} AND status='archived' AND revision=2),
    'quiet',(SELECT count(*) FROM public.grid_owner_access_agreements WHERE id=${quote(f.quietAttached.id)} AND company_id=${quote(f.quiet)} AND created_by=${quote(f.actor.id)} AND status='draft' AND revision=1),
    'audit',(SELECT count(*) FROM private.gridex_agreement_audit_v1 WHERE actor_user_id=${quote(f.actor.id)} AND ((agreement_id=${quote(f.mounted.id)} AND company_id=${quote(f.company)} AND revision IN(1,2)) OR (agreement_id=${quote(f.quietAttached.id)} AND company_id=${quote(f.quiet)} AND revision=1))));`)).toEqual({ mounted: 1, quiet: 1, audit: 3 })
  return {
    mounted: fingerprint('public.grid_owner_access_agreements', `WHERE id=${quote(f.mounted.id)} AND company_id=${quote(f.company)} AND created_by=${quote(f.actor.id)}`),
    quiet: fingerprint('public.grid_owner_access_agreements', `WHERE id=${quote(f.quietAttached.id)} AND company_id=${quote(f.quiet)} AND created_by=${quote(f.actor.id)}`),
    uploads: fingerprint('private.gridex_agreement_uploads_v1', `WHERE (object_key=${quote(f.mounted.path)} AND company_id=${quote(f.company)}) OR (id=${quote(f.quietAttached.intent.id)} AND company_id=${quote(f.quiet)})`),
    uncertain: fingerprint('private.gridex_agreement_uploads_v1', `WHERE id=${quote(f.uncertain!.id)} AND company_id=${quote(f.company)}`),
    audit: fingerprint('private.gridex_agreement_audit_v1', `WHERE actor_user_id=${quote(f.actor.id)}`),
    results: fingerprint('private.gridex_agreement_results_v1', `WHERE actor_user_id=${quote(f.actor.id)}`),
  }
}
async function session(f: Fixture) {
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email: f.actor.email, password: process.env.GRIDEX_AGREEMENT_RUNTIME_PASSWORD! })
  expect(login.error).toBeNull(); expect(login.data.user?.id).toBe(f.actor.id)
  const claims = await client.auth.getClaims(), user = await client.auth.getUser()
  expect(claims.error).toBeNull(); expect(user.error).toBeNull(); expect(claims.data?.claims.sub).toBe(f.actor.id)
  const sessionId = claims.data?.claims.session_id
  if (typeof sessionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(sessionId)) throw new Error('agreement_runtime_genuine_session_required')
  const context = await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: f.company })
  expect(context.error).toBeNull(); expect(context.data).toMatchObject({ authorized: true, user_id: f.actor.id, is_platform_admin: true })
  return { actor: { kind: 'ops' as const, userId: f.actor.id, sessionId }, close: async () => { expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull() } }
}
async function upload(intent: AgreementUploadIntent) {
  expect(intent.bucket).toBe(bucket)
  const result = await supabaseService.storage.from(bucket).upload(intent.path, pdf, { upsert: false, contentType: 'application/pdf' })
  expect(result.error).toBeNull()
}
async function physical(intent: Pick<AgreementUploadIntent, 'path'>, present: boolean) {
  const result = await supabaseService.storage.from(bucket).download(intent.path)
  if (present) { expect(result.error).toBeNull(); expect(result.data).toBeTruthy(); expect(createHash('sha256').update(Buffer.from(await result.data!.arrayBuffer())).digest('hex')).toBe(fileSha) }
  else {
    expect(result.data).toBeNull(); expect(result.error?.name).toBe('StorageApiError')
    // A transport/503 fault is not evidence that physical bytes are absent.
    const missing = result.error as { status?: number; statusCode?: string; message?: string } | null
    expect(missing?.status === 404 || missing?.statusCode === '404' || missing?.statusCode === 'NoSuchKey' ||
      (missing?.status === 400 && missing?.message === 'Object not found')).toBe(true)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM storage.objects WHERE bucket_id=${quote(bucket)} AND name=${quote(intent.path)};`)).toBe(0)
  }
}
async function waitActualDue(predicate: string, maxMs: number) {
  const start = Date.now()
  while (!sql<boolean>(`SELECT to_jsonb(${predicate});`)) {
    if (Date.now() - start > maxMs) throw new Error('agreement_runtime_actual_schedule_not_due')
    await new Promise(done => setTimeout(done, 1000))
  }
}
async function schedulingClock(f: Fixture, kind: 'prepared' | 'lease' | 'settlement') {
  if (!f.orphan) throw new Error('agreement_runtime_owned_orphan_required')
  if (kind === 'settlement' && !f.lastFinishedClaim) throw new Error('agreement_runtime_current_finished_claim_required')
  const owned = `u.id=${quote(f.orphan.id)}::uuid AND u.company_id=${quote(f.company)}::uuid AND u.actor_user_id=${quote(f.actor.id)}::uuid AND u.bucket=${quote(bucket)} AND u.object_key=${quote(f.orphan.path)} AND u.result_id IS NULL`
  const invariant = () => sql<string>(`SELECT to_jsonb(encode(sha256(convert_to(jsonb_build_object(
    'upload',to_jsonb(u)${kind === 'prepared' ? "-'created_at'" : ''},
    'claim',to_jsonb(c)${kind === 'lease' ? "-'lease_until'-'next_attempt_at'" : kind === 'settlement' ? "-'next_attempt_at'" : ''})::text,'UTF8')),'hex'))
    FROM private.gridex_agreement_uploads_v1 u LEFT JOIN private.gridex_agreement_cleanup_claims_v1 c ON c.upload_intent_id=u.id WHERE ${owned};`)
  const before = invariant()
  const claim = kind === 'lease' ? f.crash : f.lastFinishedClaim
  const statement = kind === 'prepared'
    ? `UPDATE private.gridex_agreement_uploads_v1 u SET created_at=clock_timestamp()-interval '16 minutes' WHERE ${owned} AND u.status='prepared'`
    : `UPDATE private.gridex_agreement_cleanup_claims_v1 c SET ${kind === 'lease' ? "lease_until=clock_timestamp()-interval '1 second'," : ''} next_attempt_at=clock_timestamp()-interval '1 second' FROM private.gridex_agreement_uploads_v1 u WHERE ${owned} AND c.upload_intent_id=u.id AND c.last_outcome=${quote(kind === 'lease' ? 'claimed' : 'removed')} AND c.claim_token=${quote(claim!.claimToken)}::uuid AND c.attempt=${claim!.attempt}`
  const changed = sql<boolean>(`DO $clock$ DECLARE n integer; BEGIN
    BEGIN ${statement}; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'owned_clock_row_missing'; END IF;
      PERFORM set_config('gridex.agreement.runtime_clock','applied',false);
    EXCEPTION WHEN others THEN IF SQLERRM ILIKE '%immutable%' THEN PERFORM set_config('gridex.agreement.runtime_clock','refused',false); ELSE RAISE; END IF; END;
    END $clock$; SELECT to_jsonb(current_setting('gridex.agreement.runtime_clock')='applied');`)
  expect(invariant()).toBe(before)
  f.clockControls.push(`${kind}:${changed ? 'owned_scheduling_only' : 'immutable_refused_actual_ttl'}`); save(f)
  const predicate = kind === 'prepared'
    ? `(SELECT created_at<=clock_timestamp()-interval '15 minutes' FROM private.gridex_agreement_uploads_v1 WHERE id=${quote(f.orphan.id)})`
    : `(SELECT lease_until<=clock_timestamp() AND next_attempt_at<=clock_timestamp() FROM private.gridex_agreement_cleanup_claims_v1 WHERE upload_intent_id=${quote(f.orphan.id)})`
  await waitActualDue(predicate, kind === 'prepared' ? 16 * 60_000 : kind === 'lease' ? 3 * 60_000 : 61 * 60_000)
}

it('isolated genuine mounted agreement and durable physical cleanup proof phases', async () => {
  const phase = process.env.GRIDEX_AGREEMENT_RUNTIME_PHASE ?? 'seed'
  if (!['seed', 'capture-mounted', 'prepare-orphans', 'expire-crash-lease', 'verify-cleaned', 'prepare-settlement', 'post-browser', 'cleanup'].includes(phase)) throw new Error('agreement_runtime_unknown_phase')
  if (phase === 'seed') {
    if (existsSync(path)) throw new Error('agreement_runtime_fixture_exists')
    const f: Fixture = { tag: 'agreement-runtime-' + randomUUID(), company: randomUUID(), quiet: randomUUID(), owner: randomUUID(), quietOwner: randomUUID(), actor: { id: '', email: '' },
      financialIds: { customer: randomUUID(), contract: randomUUID(), underlay: randomUUID(), invoice: randomUUID(), line: randomUUID() },
      originalFinance: finances(), seededFinance: {}, originalIdentity: identities(), originalStorage: fingerprint('storage.objects'), quietBefore: '', clockControls: [] }
    const ids = f.financialIds
    sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(f.company)},'Synthetic agreement runtime A','active'),(${quote(f.quiet)},'Synthetic agreement runtime B','active');
      INSERT INTO public.grid_owners(id,company_id,name) VALUES(${quote(f.owner)},${quote(f.company)},'Synthetic agreement runtime owner A'),(${quote(f.quietOwner)},${quote(f.quiet)},'Synthetic agreement runtime owner B');
      INSERT INTO public.customers(id,company_id,first_name,last_name) VALUES(${quote(ids.customer)},${quote(f.quiet)},'Synthetic','Unchanged finance');
      INSERT INTO public.customer_contracts(id,company_id,customer_id,status) VALUES(${quote(ids.contract)},${quote(f.quiet)},${quote(ids.customer)},'draft');
      INSERT INTO public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,total_kwh,total_sek_ex_vat,underlay_month,underlay_year) VALUES(${quote(ids.underlay)},${quote(f.quiet)},${quote(ids.customer)},${quote(ids.contract)},${quote(ids.contract)},100,125,9,2026);
      INSERT INTO public.customer_invoices(id,company_id,customer_id,customer_contract_id,billing_underlay_id,status,amount_ex_vat,vat_amount,amount_inc_vat) VALUES(${quote(ids.invoice)},${quote(f.quiet)},${quote(ids.customer)},${quote(ids.contract)},${quote(ids.underlay)},'draft',125,31.25,156.25);
      INSERT INTO public.customer_invoice_lines(id,company_id,customer_id,invoice_id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat) VALUES(${quote(ids.line)},${quote(f.quiet)},${quote(ids.customer)},${quote(ids.invoice)},'Synthetic unchanged energy',100,1.25,125,31.25,156.25); SELECT to_jsonb(true);`)
    f.actor.email = f.tag + '@example.invalid'
    const actor = await supabaseService.auth.admin.createUser({ email: f.actor.email, password: process.env.GRIDEX_AGREEMENT_RUNTIME_PASSWORD!, email_confirm: true, user_metadata: { full_name: 'Synthetic agreement runtime platform actor' } })
    if (actor.error || !actor.data.user) throw new Error('agreement_runtime_genuine_auth_seed_failed')
    f.actor.id = actor.data.user.id
    sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(f.actor.id)},${quote(f.actor.email)},'Synthetic agreement runtime actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
      INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${quote(f.actor.id)},'platform_admin',true);
      INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at) VALUES(${quote(f.company)},${quote(f.actor.id)},'owner','active',true,now()); SELECT to_jsonb(true);`)
    const actual = await session(f); await actual.close()
    f.seededFinance = finances(); f.quietBefore = quiet(f); save(f)
    expect(identities(f.actor.id)).toEqual(f.originalIdentity)
    console.log('AGREEMENT_RUNTIME_GENUINE_SEED_PASS real_gotrue=true canonical_platform=true quiet_finance_nonempty=true')
    return
  }
  const f = read(); if (phase !== 'cleanup') protectedGraphs(f)
  if (phase === 'capture-mounted') {
    const rows = sql<Array<{ id: string; document_path: string; revision: number; status: string }>>(`SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM public.grid_owner_access_agreements a WHERE company_id=${quote(f.company)} AND agreement_reference=${quote(f.tag)} AND created_by=${quote(f.actor.id)};`)
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ status: 'draft', revision: 1 })
    const key = parseGridOwnerAgreementDocumentKey(rows[0].document_path, bucket)
    if (!key || key.bucket !== bucket) throw new Error('agreement_runtime_mounted_document_binding_missing')
    f.mounted = { id: rows[0].id, path: key.path, documentPath: rows[0].document_path, revision: 1 }; save(f)
    await physical(f.mounted, true)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM private.gridex_agreement_uploads_v1 WHERE actor_user_id=${quote(f.actor.id)} AND company_id=${quote(f.company)} AND object_key=${quote(f.mounted.path)} AND status='attached' AND result_id IS NOT NULL;`)).toBe(1)
    console.log('AGREEMENT_RUNTIME_MOUNTED_RECEIPT_PASS revision=1 actual_storage_sha=true attached_receipt=true')
    return
  }
  if (phase === 'prepare-orphans') {
    expect(f.mounted).toBeTruthy()
    expect(sql(`SELECT jsonb_build_object('revision',revision,'status',status) FROM public.grid_owner_access_agreements WHERE id=${quote(f.mounted!.id)};`)).toEqual({ revision: 2, status: 'archived' })
    const prepare = async (actual: Awaited<ReturnType<typeof session>>, kind: 'orphan' | 'uncertain' | 'quiet') => {
        const command = agreementSaveCommand({ actor: actual.actor, companyId: kind === 'quiet' ? f.quiet : f.company, gridOwnerId: kind === 'quiet' ? f.quietOwner : f.owner,
          agreementType: 'metering_access', agreementScope: 'metering_access', status: 'draft', expectedRevision: 0, idempotencyKey: f.tag + '-' + kind,
          agreementReference: f.tag + '-' + kind, documentFile: { bucket, name: 'owned.pdf', sha256: fileSha, size: pdf.length, contentType: 'application/pdf' } })
        const prepared = await prepareAgreementDocumentUpload(command, bucket)
        if (!prepared.intent || prepared.committed) throw new Error('agreement_runtime_fresh_intent_required')
        await upload(prepared.intent)
        if (kind === 'quiet') { const result = await executeAgreementCommand(command, prepared.intent); f.quietAttached = { id: result.agreement.id, intent: prepared.intent } }
        else f[kind] = prepared.intent
        save(f)
    }
    // Age/wait before creating the fresh pending control. A refused fixture
    // scheduling change must not silently age that control past its real grace.
    const first = await session(f)
    try { await prepare(first, 'orphan') } finally { await first.close() }
    await schedulingClock(f, 'prepared')
    const actual = await session(f)
    try {
      await prepare(actual, 'uncertain'); await prepare(actual, 'quiet')
      const claim = await supabaseService.rpc('gridex_claim_agreement_cleanup_v1', { p_company_id: f.company, p_claim_token: randomUUID(), p_limit: 10 })
      expect(claim.error).toBeNull(); expect(claim.data).toHaveLength(1)
      f.crash = (claim.data as Claim[])[0]; expect(f.crash.uploadIntentId).toBe(f.orphan!.id); save(f)
      await physical(f.orphan!, true); await physical(f.uncertain!, true); await physical(f.quietAttached!.intent, true)
      f.preservedAgreements = attachedAgreements(f); save(f)
    } finally { await actual.close() }
    console.log('AGREEMENT_RUNTIME_CRASH_CLAIM_PREPARED_PASS genuine_claim=true fresh_uncertain_preserved=true attached_quiet_preserved=true')
    return
  }
  if (phase === 'expire-crash-lease') { await schedulingClock(f, 'lease'); console.log('AGREEMENT_RUNTIME_OWNED_LEASE_DUE_PASS authority_and_result_unchanged=true'); return }
  if (phase === 'prepare-settlement') {
    await physical(f.orphan!, false)
    // Controlled late local Storage completion models an already in-flight
    // upload. No command, source/actor/attachment/result state is fabricated.
    await upload(f.orphan!); await schedulingClock(f, 'settlement')
    console.log('AGREEMENT_RUNTIME_LATE_UPLOAD_SETTLEMENT_PREPARED_PASS real_local_storage=true scheduling_only=true')
    return
  }
  if (phase === 'verify-cleaned' || phase === 'post-browser') {
    await physical(f.orphan!, false); await physical(f.uncertain!, true); await physical(f.quietAttached!.intent, true); await physical(f.mounted!, true)
    expect(sql(`SELECT jsonb_build_object('status',u.status,'result',u.result_id,'attempt',c.attempt,'outcome',c.last_outcome,'finishes',(SELECT count(*) FROM private.gridex_agreement_cleanup_events_v1 e WHERE e.upload_intent_id=u.id AND phase='finish')) FROM private.gridex_agreement_uploads_v1 u JOIN private.gridex_agreement_cleanup_claims_v1 c ON c.upload_intent_id=u.id WHERE u.id=${quote(f.orphan!.id)};`)).toEqual({ status: 'cleaned', result: null, attempt: phase === 'post-browser' ? 3 : 2, outcome: 'removed', finishes: phase === 'post-browser' ? 2 : 1 })
    expect(sql(`SELECT jsonb_build_object('status',status,'result',result_id) FROM private.gridex_agreement_uploads_v1 WHERE id=${quote(f.uncertain!.id)};`)).toEqual({ status: 'prepared', result: null })
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM private.gridex_agreement_cleanup_claims_v1 WHERE upload_intent_id IN(${quote(f.uncertain!.id)},${quote(f.quietAttached!.intent.id)});`)).toBe(0)
    expect(attachedAgreements(f)).toEqual(f.preservedAgreements)
    f.lastFinishedClaim = sql<{ claimToken: string; attempt: number }>(`SELECT jsonb_build_object('claimToken',claim_token,'attempt',attempt) FROM private.gridex_agreement_cleanup_claims_v1 WHERE upload_intent_id=${quote(f.orphan!.id)} AND last_outcome='removed';`); save(f)
    protectedGraphs(f)
    console.log(phase === 'post-browser' ? 'AGREEMENT_RUNTIME_PERIODIC_SETTLEMENT_PASS attached_and_unselected_prepared_preserved=true no_finance_or_foreign_identity_effect=true' : 'AGREEMENT_RUNTIME_CRASH_RECOVERY_PASS actual_remove_and_durable_finish=true')
    return
  }
  // Explicit fixture teardown after preservation proof, distinct from the
  // consumer. Only exact owned keys are removed. Owned agreement/company/
  // grid-owner rows and public/private receipts remain until stack destruction:
  // the real public audit company FK must not be bypassed to remove evidence.
  const keys = [f.mounted?.path, f.orphan?.path, f.uncertain?.path, f.quietAttached?.intent.path].filter((key): key is string => Boolean(key))
  if (keys.length) expect((await supabaseService.storage.from(bucket).remove(keys)).error).toBeNull()
  const ids = f.financialIds
  sql(`DELETE FROM public.customer_invoice_lines WHERE id=${quote(ids.line)} AND company_id=${quote(f.quiet)};
    DELETE FROM public.customer_invoices WHERE id=${quote(ids.invoice)} AND company_id=${quote(f.quiet)} AND status='draft';
    DELETE FROM public.billing_underlays WHERE id=${quote(ids.underlay)} AND company_id=${quote(f.quiet)};
    DELETE FROM public.customer_contracts WHERE id=${quote(ids.contract)} AND company_id=${quote(f.quiet)};
    DELETE FROM public.customers WHERE id=${quote(ids.customer)} AND company_id=${quote(f.quiet)}; SELECT to_jsonb(true);`)
  expect((await supabaseService.auth.admin.deleteUser(f.actor.id)).error).toBeNull()
  expect(finances()).toEqual(f.originalFinance); expect(identities()).toEqual(f.originalIdentity); expect(fingerprint('storage.objects')).toBe(f.originalStorage)
  console.log('AGREEMENT_RUNTIME_OWNED_TEARDOWN_PASS original_finance_auth_storage_bytes_retained=true owned_receipts_retained_until_stack_destruction=true')
})
