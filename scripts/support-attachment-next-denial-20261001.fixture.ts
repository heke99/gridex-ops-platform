import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

export const API = 'http://127.0.0.1:54321'
export const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
export const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
export function invariant(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code)
}
export function localStatus() {
  invariant(process.env.CI === 'true' && process.env.GRIDEX_NATIVE_STATUS, 'attachment_journey_disposable_ci_required')
  const status = JSON.parse(readFileSync(process.env.GRIDEX_NATIVE_STATUS, 'utf8')) as Record<string, string>
  invariant(status.API_URL === API && status.ANON_KEY && status.SERVICE_ROLE_KEY, 'attachment_journey_disposable_stack_required')
  invariant(!process.env.GRIDEX_E2E_BROWSER_BASE_URL, 'attachment_journey_external_next_forbidden')
  return status
}
export function fixturePath() {
  localStatus()
  invariant(process.env.RUNNER_TEMP && process.env.GRIDEX_SUPPORT_NEXT_FIXTURE, 'attachment_journey_private_path_required')
  const path = resolve(process.env.GRIDEX_SUPPORT_NEXT_FIXTURE)
  invariant(realpathSync(dirname(path)) === realpathSync(process.env.RUNNER_TEMP)
    && basename(path).endsWith('.json'), 'attachment_journey_private_runner_temp_only')
  return path
}
export function readFixture(): NextDenialFixture {
  const path = fixturePath(), stat = lstatSync(path)
  invariant(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0, 'attachment_journey_private_fixture_mode_required')
  return JSON.parse(readFileSync(path, 'utf8')) as NextDenialFixture
}
export function saveFixture(fixture: NextDenialFixture, fresh = false) {
  writeFileSync(fixturePath(), JSON.stringify(fixture), { mode: 0o600, flag: fresh ? 'wx' : 'w' })
}
export function sql<T>(command: string): T {
  localStatus()
  try {
    return JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
      input: command, encoding: 'utf8', timeout: 20_000,
    }).trim()) as T
  } catch { throw new Error('attachment_journey_native_sql_failed') }
}
export const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
type Snapshot = Record<string, { count: number; sha256: string }>
const FINANCE = ['customer_invoices', 'invoice_export_items', 'billing_underlays', 'pricing_runs',
  'customer_invoice_lines', 'customer_invoice_documents', 'pricing_preview_lines', 'contract_price_snapshots',
  'customer_contracts', 'billing_provider_connections'] as const
export function financeSnapshot(): Snapshot {
  const tables = sql<string[]>(`select jsonb_agg(c.relname order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in('r','p') and (c.relname ~ '^(billing_|invoice_|pricing_|customer_invoice)' or c.relname in('customer_contracts','contract_price_snapshots'));`)
  invariant(FINANCE.every(table => tables.includes(table)), 'attachment_journey_complete_financial_surface_required')
  return Object.fromEntries(tables.map(table => {
    invariant(/^[a-z0-9_]+$/.test(table), 'attachment_journey_financial_table_identifier_invalid')
    // Hash PostgreSQL's complete JSONB text inside PostgreSQL: JavaScript
    // numeric parsing must not round historical decimal/bigint evidence.
    const snapshot = sql<{ count: number; sha256: string }>(`select jsonb_build_object('count',count(*),'sha256',
      encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex')) from public.${table} t;`)
    return [table, snapshot]
  }))
}
export function publicSnapshot(company: string): string {
  const tables = ['companies', 'customers', 'customer_cases', 'customer_support_threads', 'customer_support_messages',
    'customer_case_events', 'customer_support_attachments', 'canonical_command_results', 'canonical_audit_events',
    'domain_events', 'canonical_event_outbox', 'audit_logs']
  const data = tables.map(table => sql<string>(`select to_jsonb(encode(sha256(convert_to(
    coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'UTF8')),'hex'))
    from public.${table} t where ${table === 'companies' ? 'id' : 'company_id'}=${quote(company)};`))
  return sha(JSON.stringify(data))
}
export function attachmentSnapshot(company: string): string {
  return sql<string>(`select to_jsonb(encode(sha256(convert_to(jsonb_build_object('attachments',
    (select jsonb_agg(to_jsonb(t) order by id) from public.customer_support_attachments t where company_id=${quote(company)}),
    'objects',(select jsonb_agg(to_jsonb(t) order by id) from storage.objects t
      where bucket_id='customer-support-quarantine' and name like ${quote(company + '/%')}))::text,'UTF8')),'hex'));`)
}
export function identitySnapshot(): string {
  // GoTrue login legitimately changes these two timestamps and creates sessions.
  // Everything else, including credential/confirmed-email/identity/profile data,
  // remains part of the complete comparison; no Auth session is fabricated.
  return sql<string>(`select to_jsonb(encode(sha256(convert_to(jsonb_build_object('users',
    (select jsonb_agg(to_jsonb(t)-array['last_sign_in_at','updated_at'] order by id) from auth.users t),
    'identities',(select jsonb_agg(to_jsonb(t)-array['last_sign_in_at','updated_at'] order by id) from auth.identities t),
    'profiles',(select jsonb_agg(to_jsonb(t) order by id) from public.user_profiles t),
    'roles',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.user_roles t))::text,'UTF8')),'hex'));`)
}
export type Actor = { id: string; email: string; company: string; seedSession: string }
export type Attachment = { id: string; caseId: string; objectKey: string; bytes: string; sha256: string }
export type NextDenialFixture = {
  version: 1; company: string; quietCompany: string; customer: string; sibling: string; quietCustomer: string;
  password: string; writer: Actor; reader: Actor; denied: Actor; foreign: Actor;
  signed: Attachment; defaultAttachment: Attachment; quietAttachment: Attachment;
  trust: string; callbackSecret: string; processSecret: string; signedNonce: string; signedToken: string;
  finance: Snapshot; publicOwn: string; quiet: string; attachments: string; identities: string;
  baselineSessions: string[]; baselineSessionRows: Array<{ id: string }>; initialMemberships: unknown[];
  completed?: { checks: string[]; sessions: Array<{ userId: string; sessionId: string }>; revokedSession: string; revokedMember: string };
}
export function service() {
  const status = localStatus()
  return createClient(API, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}
async function actor(company: string, password: string, permissions: string[], tag: string): Promise<Actor> {
  const status = localStatus(), admin = service(), email = `attachment-next-${tag}-${randomUUID()}@example.invalid`
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  invariant(!created.error && created.data.user?.email_confirmed_at, 'attachment_journey_gotrue_confirmed_user_required')
  const id = created.data.user.id, role = randomUUID(), key = `attachment_next_${randomUUID().replaceAll('-', '')}`
  const keys = permissions.map(quote).join(',')
  sql(`insert into public.user_profiles(id,email,full_name,user_status) values(${quote(id)},${quote(email)},'Synthetic attachment Next actor','active')
      on conflict(id) do update set user_status='active';
    insert into public.roles(id,key,name,scope) values(${quote(role)},${quote(key)},'Synthetic attachment Next role','company');
    insert into public.company_memberships(company_id,user_id,membership_role,status,accepted_at)
      values(${quote(company)},${quote(id)},'operations','active',clock_timestamp());
    insert into public.user_roles(user_id,company_id,role_id,role,status,is_active) values(${quote(id)},${quote(company)},${quote(role)},${quote(key)},'active',true);
    insert into public.permissions(key,name,description,category) select key,key,'Synthetic attachment Next proof','test'
      from unnest(array[${keys}]::text[]) p(key) on conflict(key) do nothing;
    insert into public.role_permissions(role_id,role_key,permission_id,permission_key)
      select ${quote(role)},${quote(key)},id,key from public.permissions where key in(${keys});select to_jsonb(true);`)
  const auth = createClient(API, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const signed = await auth.auth.signInWithPassword({ email, password })
  const claims = await auth.auth.getClaims(), user = await auth.auth.getUser()
  invariant(!signed.error && !claims.error && !user.error && user.data.user?.id === id
    && claims.data?.claims.sub === id && typeof claims.data.claims.session_id === 'string', 'attachment_journey_actual_gotrue_session_required')
  const seedSession = claims.data.claims.session_id
  invariant(sql<boolean>(`select to_jsonb(exists(select 1 from auth.sessions where id=${quote(seedSession)} and user_id=${quote(id)}));`),
    'attachment_journey_gotrue_session_missing_in_db')
  const context = await auth.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: company })
  invariant(!context.error && context.data?.authorized === true && context.data.is_platform_admin === false
    && context.data.selected_company_id === company && context.data.user_id === id
    && permissions.every(p => context.data.permissions.includes(p)), 'attachment_journey_current_canonical_actor_required')
  return { id, email, company, seedSession }
}
async function attachment(company: string, customer: string, owner: Actor, tag: string): Promise<Attachment> {
  const { executeSupportCommand } = await import('@/lib/customer-operations/supportCommand')
  const { intakeSupportAttachment } = await import('@/lib/customer-cases/attachments')
  const context = { companyId: company, customerId: customer, actor: { kind: 'ops' as const, userId: owner.id, sessionId: owner.seedSession } }
  const created = await executeSupportCommand({ ...context, operation: 'create', expectedRevision: 0,
    idempotencyKey: `attachment-next-case:${randomUUID()}`, payload: { title: `Synthetic Next ${tag}`, body: 'Inert private attachment; no approved malware scanner.' } })
  const bytes = `SYNTHETIC_PRIVATE_ATTACHMENT_${tag}_${randomUUID()}\n`
  await intakeSupportAttachment({ context, caseId: created.caseId, expectedRevision: 1,
    idempotencyKey: `attachment-next-intake:${randomUUID()}`, visibility: 'internal', file: new File([bytes], 'inert.txt', { type: 'text/plain' }) })
  const row = sql<{ id: string; object_key: string; sha256: string; scan_status: string }>(`select to_jsonb(t) from public.customer_support_attachments t
    where company_id=${quote(company)} and customer_case_id=${quote(created.caseId)};`)
  invariant(row.scan_status === 'quarantined' && row.sha256 === sha(bytes), 'attachment_journey_actual_intake_lineage_required')
  const stored = await service().storage.from('customer-support-quarantine').download(row.object_key)
  invariant(!stored.error && stored.data && sha(new Uint8Array(await stored.data.arrayBuffer())) === sha(bytes), 'attachment_journey_actual_storage_bytes_required')
  return { id: row.id, caseId: created.caseId, objectKey: row.object_key, bytes, sha256: sha(bytes) }
}
export async function seedJourney(): Promise<NextDenialFixture> {
  localStatus()
  const finance = financeSnapshot()
  for (const table of FINANCE.slice(0, 6)) invariant(finance[table].count > 0, 'attachment_journey_nonempty_financial_graph_required_' + table)
  const company = randomUUID(), quietCompany = randomUUID(), customer = randomUUID(), sibling = randomUUID(), quietCustomer = randomUUID()
  sql(`insert into public.companies(id,name,status) values(${quote(company)},'Synthetic Next attachment tenant','active'),(${quote(quietCompany)},'Synthetic quiet Next tenant','active');
    insert into public.customers(id,company_id,customer_number,name,customer_type) values
      (${quote(customer)},${quote(company)},${quote(customer)},'Synthetic Next customer','private'),
      (${quote(sibling)},${quote(company)},${quote(sibling)},'Synthetic Next sibling','private'),
      (${quote(quietCustomer)},${quote(quietCompany)},${quote(quietCustomer)},'Synthetic quiet Next customer','private');select to_jsonb(true);`)
  const password = randomBytes(24).toString('base64url') + '-aA1!'
  const writer = await actor(company, password, ['cases.read', 'cases.write', 'customers.read'], 'writer')
  const reader = await actor(company, password, ['cases.read', 'customers.read'], 'reader')
  const denied = await actor(company, password, ['customers.read'], 'denied')
  const foreign = await actor(quietCompany, password, ['cases.read', 'cases.write', 'customers.read'], 'foreign')
  const signed = await attachment(company, customer, writer, 'signed')
  const defaultAttachment = await attachment(company, customer, writer, 'absent-adapter')
  const quietAttachment = await attachment(quietCompany, quietCustomer, foreign, 'quiet')
  const { prepareSupportAttachmentScan } = await import('@/lib/customer-cases/attachmentScan')
  const { scanBinding, scannerTrustEntry, SUPPORT_SCAN_PURPOSE } = await import('@/lib/customer-cases/scannerProof')
  const pair = await generateKeyPair('RS256'), kid = 'synthetic-' + randomUUID()
  const trust = JSON.stringify({ [company]: { issuer: 'https://synthetic-scanner.example.invalid', audience: 'isolated-next-denial',
    subject: 'synthetic-evidence-only', kid, purpose: SUPPORT_SCAN_PURPOSE, jwks: { keys: [{ ...await exportJWK(pair.publicKey), kid, alg: 'RS256', use: 'sig' }] } } })
  process.env.GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST = trust
  const entry = await scannerTrustEntry(company, trust)
  invariant(entry, 'attachment_journey_synthetic_trust_invalid')
  sql(`insert into private.support_attachment_scanner_roots(company_id,issuer_hash,subject_hash,key_hash)
    values(${quote(company)},${quote(entry.trust.issuerHash)},${quote(entry.trust.subjectHash)},${quote(entry.trust.keyHash)});select to_jsonb(true);`)
  const claimToken = randomUUID(), claimed = await service().rpc('gridex_claim_support_attachment_scans_v1', { p_company_id: company, p_limit: 1, p_claim_token: claimToken })
  invariant(!claimed.error && claimed.data?.length === 1 && claimed.data[0].attachmentId === signed.id, 'attachment_journey_exact_signed_job_claim_required')
  const challenge = await prepareSupportAttachmentScan({ companyId: company, attachmentId: signed.id })
  const bound = await service().rpc('gridex_bind_support_attachment_scan_claim_v1', { p_intent_id: challenge.scanIntentId, p_claim_token: claimToken, p_nonce_id: challenge.nonceId })
  invariant(!bound.error && bound.data === true, 'attachment_journey_nonce_claim_binding_required')
  const signedToken = await new SignJWT({ purpose: SUPPORT_SCAN_PURPOSE, binding_sha256: sha(scanBinding(challenge)), verdict: 'clean' })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'gridex-support-attachment-scan+jwt' }).setIssuer(entry.issuer).setSubject(entry.subject)
    .setAudience(entry.audience).setIssuedAt(challenge.issuedAt).setExpirationTime(challenge.expiresAt).setJti(challenge.nonceId).sign(pair.privateKey)
  const ids = [writer.id, reader.id, denied.id, foreign.id]
  const f: NextDenialFixture = { version: 1, company, quietCompany, customer, sibling, quietCustomer, password, writer, reader, denied, foreign,
    signed, defaultAttachment, quietAttachment, trust, callbackSecret: randomBytes(32).toString('hex'), processSecret: randomBytes(32).toString('hex'),
    signedNonce: challenge.nonceId, signedToken, finance, publicOwn: publicSnapshot(company), quiet: publicSnapshot(quietCompany),
    attachments: attachmentSnapshot(company), identities: identitySnapshot(),
    baselineSessions: sql<string[]>(`select coalesce(jsonb_agg(id order by id),'[]') from auth.sessions;`),
    baselineSessionRows: sql<Array<{ id: string }>>(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from auth.sessions t;`),
    initialMemberships: sql<unknown[]>(`select jsonb_agg(to_jsonb(t) order by user_id) from public.company_memberships t where user_id in(${ids.map(quote).join(',')});`) }
  invariant(JSON.stringify(financeSnapshot()) === JSON.stringify(finance), 'attachment_journey_seed_financial_mutation')
  saveFixture(f, true)
  return f
}
export async function verifiedBrowserSession(cookies: Array<{ name: string; value: string }>, actor: Actor) {
  const status = localStatus(), cookieWrites: unknown[] = [], client = createServerClient(API, status.ANON_KEY, {
    cookies: { getAll: () => cookies, setAll: values => { cookieWrites.push(...values) } },
    auth: { autoRefreshToken: false },
  })
  const claims = await client.auth.getClaims(), user = await client.auth.getUser()
  invariant(!claims.error && !user.error && user.data.user?.id === actor.id && user.data.user.email_confirmed_at
    && claims.data?.claims.sub === actor.id && typeof claims.data.claims.session_id === 'string', 'attachment_journey_next_cookie_current_verified_auth_required')
  const sessionId = claims.data.claims.session_id
  invariant(sessionId !== actor.seedSession && sql<boolean>(`select to_jsonb(exists(select 1 from auth.sessions where id=${quote(sessionId)}
    and user_id=${quote(actor.id)} and (not_after is null or not_after>clock_timestamp())));`), 'attachment_journey_next_login_new_live_session_required')
  const context = await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: actor.company })
  invariant(!context.error && context.data?.authorized === true && context.data.is_platform_admin === false
    && context.data.user_id === actor.id && context.data.selected_company_id === actor.company, 'attachment_journey_next_cookie_canonical_context_required')
  invariant(cookieWrites.length === 0, 'attachment_journey_login_cookie_refreshed_during_verification')
  return { client, sessionId, permissions: context.data.permissions as string[] }
}
export function lateExpiryHook(nonce: string, actor: Actor, sessionId: string) {
  invariant(sql<boolean>(`select to_jsonb(exists(select 1 from private.support_attachment_read_nonces where nonce_id=${quote(nonce)}
    and actor_context->>'actorUserId'=${quote(actor.id)} and actor_context->>'sessionId'=${quote(sessionId)} and consumed_at is null));`), 'attachment_journey_exact_owned_nonce_required')
  const name = 'attachment_next_expiry_' + randomUUID().replaceAll('-', ''), sequence = name + '_seen'
  // This fault is private to the exact synthetic nonce. It changes only an
  // already GoTrue-issued session, inside the final consume transaction.
  // Its nontransactional sequence proves the post-physical hook was reached.
  sql(`create sequence private.${sequence};revoke all on sequence private.${sequence} from public,anon,authenticated,service_role;
    create function private.${name}() returns trigger language plpgsql security definer set search_path=pg_catalog as $fault$
    begin if new.nonce_id=${quote(nonce)} and new.consumed_at is not null then
      perform nextval('private.${sequence}'::regclass);
      update auth.sessions set not_after=clock_timestamp()-interval '1 microsecond' where id=${quote(sessionId)} and user_id=${quote(actor.id)};
    end if;return new;end;$fault$;
    revoke all on function private.${name}() from public,anon,authenticated,service_role;
    create trigger ${name} before update on private.support_attachment_read_nonces for each row execute function private.${name}();select to_jsonb(true);`)
  return { name, reached: () => sql<{ called: boolean; calls: number }>(`select jsonb_build_object('called',is_called,'calls',last_value) from private.${sequence};`),
    cleanup: () => sql(`drop trigger if exists ${name} on private.support_attachment_read_nonces;
      drop function if exists private.${name}();drop sequence if exists private.${sequence};select to_jsonb(true);`) }
}
export async function postcheckJourney(f: NextDenialFixture) {
  invariant(f.completed?.checks.length === 12, 'attachment_journey_real_browser_receipt_required')
  invariant(f.completed.sessions.length === 5 && new Set(f.completed.sessions.map(s => s.sessionId)).size === 5
    && f.completed.sessions.every(s => !f.baselineSessions.includes(s.sessionId)
      && [f.writer.id, f.reader.id, f.denied.id, f.foreign.id].includes(s.userId)), 'attachment_journey_five_actual_next_sessions_required')
  for (const session of f.completed.sessions.filter(s => s.sessionId !== f.completed?.revokedSession)) {
    invariant(sql<boolean>(`select to_jsonb(exists(select 1 from auth.sessions where id=${quote(session.sessionId)}
      and user_id=${quote(session.userId)} and (not_after is null or not_after>clock_timestamp())));`), 'attachment_journey_actual_next_session_missing_after_browser')
  }
  invariant(JSON.stringify(financeSnapshot()) === JSON.stringify(f.finance), 'attachment_journey_full_financial_graph_changed')
  invariant(attachmentSnapshot(f.company) === f.attachments, 'attachment_journey_attachment_or_storage_lineage_changed')
  invariant(publicSnapshot(f.company) === f.publicOwn, 'attachment_journey_public_business_audit_or_event_changed')
  invariant(publicSnapshot(f.quietCompany) === f.quiet, 'attachment_journey_quiet_tenant_changed')
  invariant(identitySnapshot() === f.identities, 'attachment_journey_identity_or_roles_changed')
  const priorSessions = sql<Array<{ id: string }>>(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from auth.sessions t
    where id in(${f.baselineSessions.map(quote).join(',')});`)
  invariant(JSON.stringify(priorSessions) === JSON.stringify(f.baselineSessionRows), 'attachment_journey_preexisting_auth_sessions_changed')
  // Generic scan processing may change its outbox status, but no public command,
  // customer/case/message/audit or domain row may be added by a denied download.
  const own = sql<Record<string, number>>(`select jsonb_build_object('cases',(select count(*) from customer_cases where company_id=${quote(f.company)}),
    'messages',(select count(*) from customer_support_messages where company_id=${quote(f.company)}),
    'attachments',(select count(*) from customer_support_attachments where company_id=${quote(f.company)}),
    'receipts',(select count(*) from private.support_attachment_scan_receipts where company_id=${quote(f.company)}),
    'nonces',(select count(*) from private.support_attachment_read_nonces where company_id=${quote(f.company)}),
    'consumed',(select count(*) from private.support_attachment_read_nonces where company_id=${quote(f.company)} and consumed_at is not null));`)
  invariant(own.cases === 2 && own.messages === 2 && own.attachments === 2 && own.receipts === 1 && own.nonces === 6 && own.consumed === 2,
    'attachment_journey_exact_private_effect_counts_changed')
  invariant(sql<boolean>(`select to_jsonb((select count(*) from private.support_attachment_scan_jobs where company_id=${quote(f.company)})=2
    and exists(select 1 from private.support_attachment_scan_jobs where company_id=${quote(f.company)} and attachment_id=${quote(f.signed.id)}
      and status='evidence_recorded' and scan_nonce_id=${quote(f.signedNonce)} and claim_token is null and claim_count=1)
    and exists(select 1 from private.support_attachment_scan_jobs where company_id=${quote(f.company)} and attachment_id=${quote(f.defaultAttachment.id)}
      and status='blocked_scanner_qualification' and claim_token is null and claim_count=1)
    and exists(select 1 from private.support_attachment_scan_receipts where company_id=${quote(f.company)} and nonce_id=${quote(f.signedNonce)}
      and attachment_id=${quote(f.signed.id)} and verdict='clean' and binding->>'sha256'=${quote(f.signed.sha256)})
    and not exists(select 1 from private.support_attachment_read_nonces where company_id=${quote(f.company)} and
      (attachment_id<>${quote(f.signed.id)} or actor_context->>'customerId'<>${quote(f.customer)}))
    and not exists(select 1 from public.customer_support_attachments where company_id in(${quote(f.company)},${quote(f.quietCompany)}) and scan_status<>'quarantined')
    and not exists(select 1 from private.support_attachment_scan_jobs where company_id=${quote(f.quietCompany)})
    and not exists(select 1 from private.support_attachment_read_nonces where company_id=${quote(f.quietCompany)}));`),
  'attachment_journey_exact_current_private_job_receipt_quarantine_changed')
  invariant(sql<boolean>(`select to_jsonb(not exists(select 1 from auth.sessions where id=${quote(f.completed.revokedSession)}));`), 'attachment_journey_gotrue_revoke_not_current')
  const currentMemberships = sql<Array<Record<string, unknown>>>(`select jsonb_agg(to_jsonb(t) order by user_id) from public.company_memberships t
    where user_id in(${[f.writer.id, f.reader.id, f.denied.id, f.foreign.id].map(quote).join(',')});`)
  for (const row of currentMemberships) {
    const initial = f.initialMemberships.find(value => (value as Record<string, unknown>).user_id === row.user_id) as Record<string, unknown>
    invariant(initial, 'attachment_journey_original_membership_missing')
    if (row.user_id === f.completed.revokedMember) invariant(row.is_active === false
      && JSON.stringify({ ...row, is_active: initial.is_active, updated_at: initial.updated_at }) === JSON.stringify(initial), 'attachment_journey_unexpected_member_mutation')
    else invariant(JSON.stringify(row) === JSON.stringify(initial), 'attachment_journey_quiet_membership_changed')
  }
  for (const attachment of [f.signed, f.defaultAttachment, f.quietAttachment]) {
    const bytes = await service().storage.from('customer-support-quarantine').download(attachment.objectKey)
    invariant(!bytes.error && bytes.data && sha(new Uint8Array(await bytes.data.arrayBuffer())) === attachment.sha256, 'attachment_journey_actual_physical_bytes_changed')
  }
  invariant(sql<boolean>(`select to_jsonb(not exists(select 1 from pg_trigger where tgname like 'attachment_next_expiry_%')
    and not exists(select 1 from pg_proc where pronamespace='private'::regnamespace and proname like 'attachment_next_expiry_%'));`), 'attachment_journey_fault_hook_not_cleaned')
}
