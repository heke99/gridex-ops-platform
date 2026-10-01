import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { afterAll, it, vi } from 'vitest'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { proofSql, quote } from './customer-read-proof-native'

// Prepared phased fixture only. No cookie/cache/module/DB/Auth mocks, no product
// command invocation here: the separate browser submits the actual mounted form.
const API = 'http://127.0.0.1:54321'
const originalFetch = globalThis.fetch
if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API || !process.env.RUNNER_TEMP) {
  throw new Error('account_mounted_disposable_local_required')
}
if (['RESEND_API_KEY', 'SENDGRID_API_KEY', 'MAILGUN_API_KEY', 'EDIEL_SMTP_PASS', 'EDIEL_SMTP_PASSWORD', 'SMTP_PASSWORD']
  .some(key => Boolean(process.env[key]?.trim()))) throw new Error('account_mounted_provider_credentials_forbidden')
const runner = realpathSync(process.env.RUNNER_TEMP)
const path = resolve(process.env.GRIDEX_ACCOUNT_MOUNTED_FIXTURE_PATH ?? '')
if (!path.startsWith(runner + sep) || realpathSync(dirname(path)) !== runner) {
  throw new Error('account_mounted_private_fixture_required')
}
vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '54321' || url.username || url.password) {
    throw new Error('account_mounted_nonlocal_transport_forbidden')
  }
  return originalFetch(input, { ...init, redirect: 'error' })
})
afterAll(() => vi.unstubAllGlobals())
const uuid = z.string().uuid()
const hashes = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
const actor = z.object({ id: z.union([uuid, z.literal('')]), email: z.string().email() }).strict()
const fixtureSchema = z.object({
  version: z.literal(1), tag: z.string().regex(/^mounted-account-[a-f0-9-]{36}$/), company: uuid, quiet: uuid, slug: z.string(),
  customer: uuid, site: uuid, customerNumber: z.string(), fullName: z.literal('Synthetic Mounted Account'),
  personalNumber: z.string().regex(/^\d{12}$/), facility: z.string().regex(/^\d{15}$/),
  customerActor: actor, platformActor: actor,
  quietIds: z.object({ customer: uuid, contract: uuid, underlay: uuid, invoice: uuid, line: uuid }).strict(),
  originalIdentities: hashes, publicBaseline: hashes.optional(), privateBaseline: hashes.optional(), financeBaseline: hashes.optional(),
  sessionWitnesses: z.object({ created: uuid.optional(), replayed: uuid.optional() }).strict(),
  storedGraphHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict()
type Fixture = z.infer<typeof fixtureSchema>
function save(f: Fixture) {
  writeFileSync(path, JSON.stringify(fixtureSchema.parse(f)), { mode: 0o600 })
}
function read() {
  if (realpathSync(path) !== path || (statSync(path).mode & 0o077) !== 0) throw new Error('account_mounted_private_fixture_required')
  return fixtureSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}
function must(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error('account_mounted_' + code)
}
function fingerprint(relation: string, predicate = ''): string {
  return proofSql(`SELECT to_jsonb(encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text,'UTF8')),'hex')) FROM ${relation} r ${predicate};`)
}
function identities(owned: string[] = []) {
  const ids = owned.filter(Boolean).map(quote).join(',')
  const exclude = (column: string) => ids ? `WHERE ${column}::text NOT IN (${ids})` : ''
  return { users: fingerprint('auth.users', exclude('id')), profiles: fingerprint('public.user_profiles', exclude('id')),
    sessions: fingerprint('auth.sessions', exclude('user_id')), identities: fingerprint('auth.identities', exclude('user_id')),
    refreshTokens: fingerprint('auth.refresh_tokens', exclude('user_id')) }
}
const finance = ['customers', 'customer_contracts', 'customer_supply_periods', 'billing_underlays', 'pricing_runs', 'pricing_preview_lines',
  'customer_invoices', 'customer_invoice_lines', 'invoice_documents', 'invoice_export_items', 'invoice_export_runs', 'invoice_export_attempts',
  'billing_export_runs', 'billing_export_run_items', 'invoice_purchase_events', 'partner_exports'] as const
function finances(f: Fixture) {
  return Object.fromEntries(finance.map(table => [table, fingerprint('public.' + table,
    table === 'customers' ? `WHERE id<>${quote(f.customer)}::uuid` : '')]))
}
function allTables(schema: 'public' | 'private', f: Fixture): Record<string, string> {
  // Exact PostgreSQL canonical text is hashed before JSON parsing. Includes
  // every table, including financial/identity rows without company_id.
  return proofSql(`CREATE TEMP TABLE mounted_account_snapshot(name text PRIMARY KEY,hash text);
    DO $snapshot$ DECLARE r record;v_hash text;v_filter text;BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname=${quote(schema)} ORDER BY tablename LOOP
        v_filter:='';
        IF (${quote(schema)}='public' AND r.tablename IN('customer_portal_accounts','customer_portal_claims','customer_portal_events')) OR
           (${quote(schema)}='private' AND r.tablename='customer_portal_account_completion_receipts') THEN
          v_filter:=' WHERE company_id IS DISTINCT FROM '||quote_literal(${quote(f.company)}::uuid);
        END IF;
        EXECUTE format('SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb)::text,''UTF8'')),''hex'') FROM %I.%I t%s',${quote(schema)},r.tablename,v_filter) INTO v_hash;
        INSERT INTO mounted_account_snapshot VALUES(r.tablename,v_hash);
      END LOOP;
    END $snapshot$;
    SELECT coalesce(jsonb_object_agg(name,hash),'{}'::jsonb) FROM mounted_account_snapshot;`)
}
function equalHashes(actual: Record<string, string>, expected: Record<string, string> | undefined, code: string) {
  must(expected && Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(actual).every(([key, value]) => expected[key] === value), code)
}
function protectedGraphs(f: Fixture) {
  equalHashes(allTables('public', f), f.publicBaseline, 'public_graph_changed')
  equalHashes(allTables('private', f), f.privateBaseline, 'private_graph_changed')
  equalHashes(finances(f), f.financeBaseline, 'financial_graph_changed')
  equalHashes(identities([f.customerActor.id, f.platformActor.id]), f.originalIdentities, 'original_identity_changed')
}
function graph(f: Fixture): Record<string, Array<Record<string, unknown>>> {
  return proofSql(`SELECT jsonb_build_object(
    'accounts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_portal_accounts t WHERE company_id=${quote(f.company)}),
    'claims',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_portal_claims t WHERE company_id=${quote(f.company)}),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_portal_events t WHERE company_id=${quote(f.company)}),
    'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM private.customer_portal_account_completion_receipts t WHERE company_id=${quote(f.company)}));`)
}
function graphHash(f: Fixture): string {
  return fingerprint(`(SELECT jsonb_build_object(
    'accounts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_portal_accounts t WHERE company_id=${quote(f.company)}),
    'claims',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_portal_claims t WHERE company_id=${quote(f.company)}),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.customer_portal_events t WHERE company_id=${quote(f.company)}),
    'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM private.customer_portal_account_completion_receipts t WHERE company_id=${quote(f.company)})) AS graph)`)
}
function verifyStored(f: Fixture) {
  const g = graph(f)
  must(Object.values(g).every(rows => rows.length === 1), 'expected_one_stored_effect')
  const account = g.accounts[0], claim = g.claims[0], event = g.events[0], receipt = g.receipts[0]
  for (const row of [account, claim, event, receipt]) must(row.company_id === f.company && row.customer_id === f.customer &&
    row.user_id === f.customerActor.id, 'stored_tuple_changed')
  must(account.role === 'owner' && account.portal_user_id === null && account.external_account_id === null &&
    account.status === 'active' && account.is_active === true && account.match_method === 'self_claim_strict_identity', 'stored_account_changed')
  const evidence = account.verified_identity_snapshot as Record<string, unknown>
  must(evidence.inputName === f.fullName && evidence.inputInstallationId === f.facility &&
    evidence.personalNumberLast4 === f.personalNumber.slice(-4) && evidence.userEmail === f.customerActor.email, 'saved_account_evidence_changed')
  const metadata = claim.metadata as Record<string, unknown>
  must(claim.status === 'approved' && metadata.schemaVersion === 1 && metadata.source === 'native_account_completion_reconstructed_v1' &&
    metadata.user_email === f.customerActor.email && metadata.matched_site_id === f.site && metadata.matched_metering_point_id === null &&
    ['email_matched', 'name_matched', 'personal_number_matched', 'installation_matched'].every(key => metadata[key] === true), 'saved_claim_evidence_changed')
  must(event.event_type === 'portal_account_verified' && receipt.account_id === account.id && receipt.claim_id === claim.id &&
    receipt.event_id === event.id && receipt.creating_session_id === f.sessionWitnesses.created, 'saved_receipt_changed')
  must(!JSON.stringify(g).includes(f.personalNumber), 'full_identity_number_persisted')
  const current = f.sessionWitnesses.replayed ?? f.sessionWitnesses.created
  must(current && proofSql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM auth.sessions WHERE id=${quote(current)}::uuid AND user_id=${quote(f.customerActor.id)}::uuid AND (not_after IS NULL OR not_after>clock_timestamp())));`), 'current_browser_session_missing')
}

async function runPhase() {
  const phase = process.env.GRIDEX_ACCOUNT_MOUNTED_PHASE ?? 'seed'
  must(['seed', 'capture-created', 'capture-replayed', 'post-browser', 'cleanup'].includes(phase), 'unknown_phase')
  if (phase === 'seed') {
    must(!existsSync(path), 'fixture_exists')
    const tag = 'mounted-account-' + randomUUID()
    const f: Fixture = { version: 1, tag, company: randomUUID(), quiet: randomUUID(), slug: tag, customer: randomUUID(), site: randomUUID(),
      customerNumber: tag, fullName: 'Synthetic Mounted Account', personalNumber: '199001011234', facility: '735999000000001',
      customerActor: { id: '', email: tag + '@example.invalid' }, platformActor: { id: '', email: tag + '-ops@example.invalid' },
      quietIds: { customer: randomUUID(), contract: randomUUID(), underlay: randomUUID(), invoice: randomUUID(), line: randomUUID() },
      originalIdentities: identities(), sessionWitnesses: {} }
    save(f)
    const q = f.quietIds
    proofSql(`BEGIN;
      INSERT INTO public.companies(id,name,slug,status,is_active) VALUES(${quote(f.company)},'Synthetic mounted account A',${quote(f.slug)},'active',true),(${quote(f.quiet)},'Synthetic quiet account B',${quote(f.slug + '-quiet')},'active',true);
      INSERT INTO public.customers(id,company_id,customer_number,first_name,last_name,full_name,personal_number,email,customer_type,status) VALUES(${quote(f.customer)},${quote(f.company)},${quote(f.customerNumber)},'Synthetic','Mounted Account',${quote(f.fullName)},${quote(f.personalNumber)},${quote(f.customerActor.email)},'private','active');
      INSERT INTO public.customer_sites(id,company_id,customer_id,facility_id,site_name) VALUES(${quote(f.site)},${quote(f.company)},${quote(f.customer)},${quote(f.facility)},'Synthetic mounted facility');
      INSERT INTO public.customers(id,company_id,first_name,last_name) VALUES(${quote(q.customer)},${quote(f.quiet)},'Synthetic','Quiet financial graph');
      INSERT INTO public.customer_contracts(id,company_id,customer_id,status) VALUES(${quote(q.contract)},${quote(f.quiet)},${quote(q.customer)},'draft');
      INSERT INTO public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,total_kwh,total_sek_ex_vat,underlay_month,underlay_year) VALUES(${quote(q.underlay)},${quote(f.quiet)},${quote(q.customer)},${quote(q.contract)},${quote(q.contract)},100,125,9,2026);
      INSERT INTO public.customer_invoices(id,company_id,customer_id,customer_contract_id,billing_underlay_id,status,amount_ex_vat,vat_amount,amount_inc_vat) VALUES(${quote(q.invoice)},${quote(f.quiet)},${quote(q.customer)},${quote(q.contract)},${quote(q.underlay)},'draft',125,31.25,156.25);
      INSERT INTO public.customer_invoice_lines(id,company_id,customer_id,invoice_id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat) VALUES(${quote(q.line)},${quote(f.quiet)},${quote(q.customer)},${quote(q.invoice)},'Synthetic quiet energy',100,1.25,125,31.25,156.25);
      COMMIT; SELECT to_jsonb(true);`)
    f.financeBaseline = finances(f); save(f)
    for (const [kind, name] of [['customerActor', 'Synthetic mounted customer'], ['platformActor', 'Synthetic mounted evidence reader']] as const) {
      const created = await supabaseService.auth.admin.createUser({ email: f[kind].email, password: process.env.GRIDEX_ACCOUNT_MOUNTED_PASSWORD!,
        email_confirm: true, user_metadata: { full_name: name } })
      must(!created.error && created.data.user, 'genuine_gotrue_seed_failed')
      f[kind].id = created.data.user.id; save(f)
    }
    proofSql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(f.platformActor.id)},${quote(f.platformActor.email)},'Synthetic mounted evidence reader','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
      INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${quote(f.platformActor.id)},'platform_admin',true);
      INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,is_active,accepted_at) VALUES(${quote(f.company)},${quote(f.platformActor.id)},'owner','active',true,now()); SELECT to_jsonb(true);`)
    must(Object.values(graph(f)).every(rows => rows.length === 0), 'completion_must_start_empty')
    f.publicBaseline = allTables('public', f); f.privateBaseline = allTables('private', f); save(f)
    equalHashes(identities([f.customerActor.id, f.platformActor.id]), f.originalIdentities, 'original_identity_changed')
    console.log('ACCOUNT_MOUNTED_SEED_PASS completion_empty=true quiet_finance_nonempty=true')
    return
  }
  const f = read()
  if (phase !== 'cleanup') protectedGraphs(f)
  if (phase === 'capture-created') {
    must(f.sessionWitnesses.created && !f.sessionWitnesses.replayed && !f.storedGraphHash, 'creation_witness_required')
    verifyStored(f); f.storedGraphHash = graphHash(f); save(f)
    console.log('ACCOUNT_MOUNTED_CREATED_PASS account=1 claim=1 event=1 receipt=1 saved_evidence=true')
  } else if (phase === 'capture-replayed' || phase === 'post-browser') {
    must(f.sessionWitnesses.created && f.sessionWitnesses.replayed && f.sessionWitnesses.created !== f.sessionWitnesses.replayed, 'new_current_login_required')
    verifyStored(f); must(graphHash(f) === f.storedGraphHash, 'replay_rewrote_stored_graph')
    console.log(phase === 'post-browser' ? 'ACCOUNT_MOUNTED_POSTCHECK_PASS stored_unchanged=true quiet_graph_unchanged=true' : 'ACCOUNT_MOUNTED_REPLAY_PASS new_current_session=true creating_provenance_unchanged=true')
  } else {
    // Preserve immutable receipt/company/published legal children AND the quiet
    // financial graph until stack disposal. Never delete/unpublish those parents.
    if (f.publicBaseline) protectedGraphs(f)
    proofSql(`DELETE FROM public.customer_portal_events WHERE company_id=${quote(f.company)} AND customer_id=${quote(f.customer)};
      DELETE FROM public.customer_portal_claims WHERE company_id=${quote(f.company)} AND customer_id=${quote(f.customer)};
      DELETE FROM public.customer_portal_accounts WHERE company_id=${quote(f.company)} AND customer_id=${quote(f.customer)};
      DELETE FROM public.customer_sites WHERE id=${quote(f.site)} AND company_id=${quote(f.company)};
      DELETE FROM public.customers WHERE id=${quote(f.customer)} AND company_id=${quote(f.company)};
      DELETE FROM public.company_memberships WHERE user_id=${quote(f.platformActor.id || '00000000-0000-0000-0000-000000000000')} AND company_id=${quote(f.company)};
      DELETE FROM public.admin_users WHERE user_id=${quote(f.platformActor.id || '00000000-0000-0000-0000-000000000000')}; SELECT to_jsonb(true);`)
    for (const owned of [f.customerActor, f.platformActor]) if (owned.id) {
      const removed = await supabaseService.auth.admin.deleteUser(owned.id)
      must(!removed.error, 'genuine_gotrue_cleanup_failed')
    }
    equalHashes(finances(f), f.financeBaseline, 'cleanup_financial_graph_changed')
    equalHashes(identities(), f.originalIdentities, 'cleanup_original_identity_changed')
    console.log('ACCOUNT_MOUNTED_CLEANUP_PASS immutable_parents_retained=true quiet_finance_unchanged=true')
  }
}
it('owned mounted account fixture phase retains real authority, stored graph and quiet rows', async () => {
  try { await runPhase() }
  catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/^account_mounted_[a-z_]+$/.test(message) ||
        /^customer_api_proof_database_failed stage=customer_sql sqlstate=(?:[0-9A-Z]{5}|UNKNOWN)$/.test(message)) {
      throw new Error(message)
    }
    throw new Error('account_mounted_native_phase_failed')
  }
})
