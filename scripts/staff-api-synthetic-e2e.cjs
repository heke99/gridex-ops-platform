#!/usr/bin/env node
'use strict'

// Preparation and direct HTTP only. The operator applies fixture.sql and always
// runs cleanup.sql with the Supabase connector, including after a failed run.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

const SCOPES = ['staff_users.read', 'staff_users.write', 'staff_customers.read', 'staff_customers.write', 'staff_cases.read', 'staff_cases.write']
const q = value => `'${String(value).replaceAll("'", "''")}'`
const json = value => `${q(JSON.stringify(value))}::jsonb`
const ids = values => values.map(value => `${q(value)}::uuid`).join(',')
const publicRef = (kind, company, id) => `${kind}_${crypto.createHash('sha256').update(`gridex-public-reference:v1:${company}:${kind}:${id}`).digest('base64url').slice(0, 32)}`
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function createState() {
  const runId = crypto.randomUUID()
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', use: 'sig', kid: `synthetic-${runId}` }
  const key = scope => {
    const prefix = `gdxp_${crypto.randomBytes(8).toString('hex').slice(0, 7)}`
    return { id: crypto.randomUUID(), token: `${prefix}.${crypto.randomBytes(32).toString('base64url')}`, prefix, scopes: scope }
  }
  const state = {
    version: 1, runId, createdAt: new Date().toISOString(), issuer: `https://staff-e2e.example.invalid/${runId}`, audience: `gridex-staff-e2e:${runId}`,
    companyA: crypto.randomUUID(), companyB: crypto.randomUUID(), provider: crypto.randomUUID(),
    users: Object.fromEntries(['admin', 'governance', 'target', 'low', 'foreign', 'invite'].map(name => [name, crypto.randomUUID()])),
    customerA: crypto.randomUUID(), customerB: crypto.randomUUID(), keys: { full: key(SCOPES), wildcard: key(['*']), read: key(['staff_customers.read']) },
    publicJwk: jwk, privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }), results: [],
  }
  state.customerRefA = publicRef('customer', state.companyA, state.customerA)
  state.customerRefB = publicRef('customer', state.companyB, state.customerB)
  state.inviteEmail = `staff-e2e-${runId}-invite@example.invalid`
  state.caseTitle = `Synthetic staff E2E ${runId}`
  return state
}

function marker(state) { return { synthetic_staff_api_e2e: true, is_test_tenant: true, is_test_data: true, run_id: state.runId } }
function fixtureSql(s) {
  const tag = json(marker(s))
  const roles = { admin: ['company_admin', 'company_admin'], governance: ['customer_service_agent', 'support'], target: ['finance_readonly', 'viewer'], low: ['partner_api_user', 'member'], foreign: ['company_admin', 'company_admin'] }
  return `-- Synthetic-only committed fixture. No private key or API token is present.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
DO $$ BEGIN
  IF to_regprocedure('public.gridex_staff_active_membership_v1(uuid,uuid)') IS NULL
    OR to_regprocedure('public.gridex_create_staff_support_case_v1(uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Deploy staff API migrations before installing synthetic fixture';
  END IF;
END $$;
INSERT INTO public.companies(id,name,slug,status,is_active,operating_environment,default_environment,metadata,
  live_ediel_enabled,ediel_production_enabled,billing_automation_enabled,invoice_export_enabled,
  ediel_customer_intake_edifact_mode,outbound_frozen,outbound_frozen_channels,outbound_freeze_reason)
VALUES ${[s.companyA, s.companyB].map((id, i) => `(${q(id)},${q(`Synthetic staff API ${s.runId} ${i ? 'B' : 'A'}`)},${q(`staff-e2e-${s.runId}-${i ? 'b' : 'a'}`)},'active',true,'test','test',${tag},false,false,false,false,'disabled',true,ARRAY['ediel','manual_email','customer_email','invoice_export','webhook'],${q(`Synthetic staff API E2E ${s.runId}; no operational traffic`)})`).join(',\n')};
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
VALUES ${Object.entries(s.users).map(([name, id]) => `(${q(id)},'authenticated','authenticated',${q(name === 'invite' ? s.inviteEmail : `staff-e2e-${s.runId}-${name}@example.invalid`)},now(),${json({ provider: 'email', providers: ['email'], ...marker(s) })},${json({ full_name: `Synthetic ${name} ${s.runId}` })},now(),now(),false,false)`).join(',\n')};
INSERT INTO public.user_profiles(id,email,full_name,user_status,auth_email_confirmed_at,must_change_password)
VALUES ${Object.entries(s.users).map(([name, id]) => `(${q(id)},${q(name === 'invite' ? s.inviteEmail : `staff-e2e-${s.runId}-${name}@example.invalid`)},${q(`Synthetic ${name} ${s.runId}`)},'active',now(),false)`).join(',\n')}
ON CONFLICT(id) DO UPDATE SET user_status='active',auth_email_confirmed_at=now(),must_change_password=false;
INSERT INTO public.company_memberships(company_id,user_id,role_key,membership_role,status,is_active,accepted_at,metadata)
VALUES ${Object.entries(roles).map(([name, [role, membership]]) => `(${q(name === 'foreign' ? s.companyB : s.companyA)},${q(s.users[name])},${q(role)},${q(membership)},'active',true,now(),${tag})`).join(',\n')};
INSERT INTO public.user_roles(user_id,company_id,role,status,is_active)
VALUES ${Object.entries(roles).map(([name, [role]]) => `(${q(s.users[name])},${q(name === 'foreign' ? s.companyB : s.companyA)},${q(role)},'active',true)`).join(',\n')};
INSERT INTO public.user_permissions(user_id,company_id,permission_key,effect,status,is_active)
VALUES (${q(s.users.governance)},${q(s.companyA)},'users.read','allow','active',true),(${q(s.users.governance)},${q(s.companyA)},'users.write','allow','active',true);
INSERT INTO public.tenant_customer_identity_providers(id,company_id,purpose,kind,display_name,issuer,audience,public_jwk,subject_claim,enforcement,is_active,created_by)
VALUES(${q(s.provider)},${q(s.companyA)},'staff','tenant_key',${q(`Synthetic staff ${s.runId}`)},${q(s.issuer)},${q(s.audience)},${json(s.publicJwk)},'sub','enforce',true,${q(s.users.admin)});
INSERT INTO public.integration_api_clients(id,company_id,name,status,key_prefix,secret_hash,scopes,profile_key,permission_groups,launch_ready,launch_blockers,rate_limit_per_minute,created_by,expires_at,metadata)
VALUES ${Object.entries(s.keys).map(([name, key]) => `(${q(key.id)},${q(s.companyA)},${q(`Synthetic staff ${s.runId} ${name}`)},'active',${q(key.prefix)},${q(sha256(key.token))},ARRAY[${key.scopes.map(q).join(',')}]::text[],'custom',ARRAY[]::text[],false,'[]',5000,${q(s.users.admin)},now()+interval '1 hour',${tag})`).join(',\n')};
INSERT INTO public.customers(id,company_id,customer_type,status,first_name,last_name,full_name,personal_number,email,phone,is_test_data,source,metadata)
VALUES ${[[s.customerA, s.companyA, 'A'], [s.customerB, s.companyB, 'B']].map(([id, company, label]) => `(${q(id)},${q(company)},'private','active','Synthetic',${q(`Staff E2E ${s.runId} ${label}`)},${q(`Synthetic Staff E2E ${s.runId} ${label}`)},'19121212-1212',${q(`customer-e2e-${s.runId}-${label.toLowerCase()}@example.invalid`)},'+46 70 000 00 00',true,'staff_api_synthetic_e2e',${tag})`).join(',\n')};
DO $$ BEGIN
  IF (SELECT count(*) FROM public.gridex_staff_active_membership_v1(${q(s.companyA)},${q(s.users.admin)}))<>1 THEN RAISE EXCEPTION 'Synthetic admin fixture is not eligible'; END IF;
  IF EXISTS(SELECT FROM public.customer_contracts WHERE customer_id IN (${ids([s.customerA, s.customerB])})) THEN RAISE EXCEPTION 'Synthetic identity test requires zero contracts'; END IF;
END $$;
COMMIT;
SELECT ${q(s.runId)} AS synthetic_run_id,'fixture_ready' AS outcome;
`
}

function auditSql(s) {
  const caseFilter = `company_id=${q(s.companyA)}::uuid AND customer_id=${q(s.customerA)}::uuid`
  const supportResourceFilter = `${caseFilter} AND customer_case_id IN (SELECT id FROM public.customer_cases WHERE ${caseFilter} AND title=${q(s.caseTitle)})`
  const auditFilter = `company_id=${q(s.companyA)}::uuid AND metadata->>'channel'='staff_api' AND created_at>=${q(s.createdAt)}::timestamptz`
  return `-- Read-only synthetic audit verification; retain immutable evidence.
SELECT action,count(*) FROM public.audit_logs WHERE ${auditFilter} GROUP BY action ORDER BY action;
SELECT event_type,count(*) FROM public.customer_case_events WHERE ${supportResourceFilter} GROUP BY event_type ORDER BY event_type;
DO $$ DECLARE v_action text; BEGIN
  IF NOT EXISTS(SELECT FROM public.companies WHERE id=${q(s.companyA)}::uuid AND metadata->>'run_id'=${q(s.runId)} AND metadata->>'synthetic_staff_api_e2e'='true') THEN RAISE EXCEPTION 'Synthetic company marker mismatch'; END IF;
  IF EXISTS(SELECT FROM public.audit_logs WHERE ${auditFilter} AND (actor_user_id IS DISTINCT FROM ${q(s.users.admin)}::uuid OR metadata->>'api_client_id' IS DISTINCT FROM ${q(s.keys.full.id)})) THEN RAISE EXCEPTION 'Staff write audit actor/client attribution mismatch'; END IF;
  FOREACH v_action IN ARRAY ARRAY['customer_profile_updated','customer_identity_change_requested','customer_case_created','support_support_staff_reply','support_support_internal_note','support_support_phone_interaction','customer_case_status_changed','customer_case_assignee_changed','support_attachment_uploaded','STAFF_CHANGE_ROLE','STAFF_DISABLE','STAFF_ENABLE'${s.includeInvite ? ",'STAFF_INVITED'" : ''}] LOOP
    IF NOT EXISTS(SELECT FROM public.audit_logs WHERE ${auditFilter} AND audit_logs.action=v_action) THEN RAISE EXCEPTION 'Missing synthetic staff audit action %',v_action; END IF;
  END LOOP;
  IF EXISTS(SELECT FROM public.customer_case_events WHERE ${supportResourceFilter} AND (created_by IS DISTINCT FROM ${q(s.users.admin)}::uuid OR payload->>'channel' IS DISTINCT FROM 'staff_api' OR payload->>'api_client_id' IS DISTINCT FROM ${q(s.keys.full.id)} OR payload->>'actor_user_id' IS DISTINCT FROM ${q(s.users.admin)})) THEN RAISE EXCEPTION 'Staff case event attribution mismatch'; END IF;
  IF (SELECT count(*) FROM public.customer_cases WHERE ${caseFilter} AND title=${q(s.caseTitle)})<>1 THEN RAISE EXCEPTION 'Case create idempotency did not yield exactly one case'; END IF;
  IF EXISTS(SELECT FROM public.customer_cases WHERE ${caseFilter} AND (case_type<>'other' OR metadata->>'support_case' IS DISTINCT FROM 'true' OR billing_blocked OR billing_manual_review OR cancellation_required)) THEN RAISE EXCEPTION 'Synthetic support case unexpectedly changed operational flags'; END IF;
  IF EXISTS(SELECT FROM public.customer_cases WHERE company_id=${q(s.companyB)}::uuid) THEN RAISE EXCEPTION 'Cross-company test created case in B'; END IF;
  IF EXISTS(SELECT FROM public.customer_identity_change_requests WHERE company_id=${q(s.companyA)}::uuid AND customer_id=${q(s.customerA)}::uuid AND (requested_by IS DISTINCT FROM ${q(s.users.admin)}::uuid OR source_channel<>'staff_api' OR api_client_id IS DISTINCT FROM ${q(s.keys.full.id)}::uuid OR approval_required)) THEN RAISE EXCEPTION 'Synthetic identity request attribution/approval mismatch'; END IF;
  IF NOT EXISTS(SELECT FROM public.customer_identity_change_requests WHERE company_id=${q(s.companyA)}::uuid AND customer_id=${q(s.customerA)}::uuid AND status='applied') THEN RAISE EXCEPTION 'Synthetic no-contract identity change was not applied'; END IF;
  IF NOT EXISTS(SELECT FROM public.customer_case_attachments WHERE ${supportResourceFilter} AND uploaded_by_user_id=${q(s.users.admin)}::uuid AND api_client_id=${q(s.keys.full.id)}::uuid AND scan_status='released') THEN RAISE EXCEPTION 'Missing released attributed attachment'; END IF;
END $$;
SELECT ${q(s.runId)} AS synthetic_run_id,'audit_verified' AS outcome;
`
}

function cleanupSql(s) {
  const users = ids(Object.values(s.users))
  return `-- Exact generated IDs, guarded by synthetic markers. No audit/evidence deletion.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.companies WHERE id IN (${ids([s.companyA, s.companyB])}) AND metadata->>'run_id'=${q(s.runId)} AND metadata->>'synthetic_staff_api_e2e'='true')<>2 THEN RAISE EXCEPTION 'Cleanup marker mismatch; no changes applied'; END IF;
END $$;
UPDATE public.integration_api_clients SET status='revoked',revoked_at=coalesce(revoked_at,now()),revoke_reason=${q(`Synthetic staff E2E ${s.runId} complete`)},updated_at=now()
WHERE id IN (${ids(Object.values(s.keys).map(key => key.id))}) AND company_id=${q(s.companyA)}::uuid AND metadata->>'run_id'=${q(s.runId)};
UPDATE public.tenant_customer_identity_providers SET is_active=false,updated_at=now() WHERE id=${q(s.provider)}::uuid AND company_id=${q(s.companyA)}::uuid AND purpose='staff';
UPDATE public.company_invitations SET status='invitation_revoked',revoked_at=coalesce(revoked_at,now()),updated_at=now()
WHERE company_id=${q(s.companyA)}::uuid AND email=${q(s.inviteEmail)} AND status IN ('pending','sending','sent','delivery_uncertain');
-- Revoke the exact synthetic accounts before their memberships. The unchanged
-- native last-functioning-admin guard deliberately checks account eligibility;
-- reversing this order rejects teardown and rolls back key/provider revocation.
UPDATE public.user_profiles SET user_status='disabled',updated_at=now() WHERE id IN (${users}) AND email LIKE ${q(`staff-e2e-${s.runId}-%@example.invalid`)};
UPDATE auth.users SET banned_until=now()+interval '100 years',updated_at=now() WHERE id IN (${users}) AND raw_app_meta_data->>'run_id'=${q(s.runId)};
UPDATE public.company_memberships SET status='disabled',is_active=false,disabled_at=coalesce(disabled_at,now()),status_reason=${q(`Synthetic staff E2E ${s.runId} complete`)}
WHERE company_id IN (${ids([s.companyA, s.companyB])}) AND user_id IN (${users});
UPDATE public.user_roles SET status='disabled',is_active=false WHERE company_id IN (${ids([s.companyA, s.companyB])}) AND user_id IN (${users});
UPDATE public.user_permissions SET status='disabled',is_active=false WHERE company_id=${q(s.companyA)}::uuid AND user_id=${q(s.users.governance)}::uuid;
UPDATE public.companies SET metadata=metadata||jsonb_build_object('synthetic_e2e_finished_at',now(),'synthetic_e2e_access_revoked',true),outbound_frozen=true
WHERE id IN (${ids([s.companyA, s.companyB])}) AND metadata->>'run_id'=${q(s.runId)};
COMMIT;
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.integration_api_clients WHERE id IN (${ids(Object.values(s.keys).map(key => key.id))}) AND (status<>'revoked' OR revoked_at IS NULL)) OR EXISTS(SELECT FROM public.tenant_customer_identity_providers WHERE id=${q(s.provider)}::uuid AND is_active) OR EXISTS(SELECT FROM public.company_memberships WHERE company_id IN (${ids([s.companyA, s.companyB])}) AND user_id IN (${users}) AND is_active) THEN RAISE EXCEPTION 'Synthetic access revocation incomplete'; END IF;
END $$;
SELECT ${q(s.runId)} AS synthetic_run_id,'synthetic_access_revoked' AS outcome;
`
}

function assertion(s, user = 'admin', claims = {}) {
  const iat = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: s.publicJwk.kid })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: s.issuer, aud: s.audience, sub: s.users[user], iat, exp: iat + 300, jti: crypto.randomUUID(), ...claims })).toString('base64url')
  const signingInput = `${header}.${payload}`
  return `${signingInput}.${crypto.sign('RSA-SHA256', Buffer.from(signingInput), s.privateKey).toString('base64url')}`
}

function writeArtifacts(s, directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  for (const [name, body] of Object.entries({ 'fixture.sql': fixtureSql(s), 'audit.sql': auditSql(s), 'cleanup.sql': cleanupSql(s) })) fs.writeFileSync(path.join(directory, name), body, { mode: 0o600 })
  fs.writeFileSync(path.join(directory, 'state.private.json'), JSON.stringify(s, null, 2), { mode: 0o600 })
  fs.chmodSync(path.join(directory, 'state.private.json'), 0o600)
}

async function runHttp(s, baseUrl, fetchFn = fetch) {
  const origin = new URL(baseUrl)
  assert(!origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/', 'Use an origin without credentials/query/path')
  assert(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)), 'HTTPS is required outside localhost')
  const results = []
  const record = (name, ok, details = {}) => { results.push({ name, ok, ...details }); process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}\n`) }
  async function request(name, method, route, opts = {}) {
    const headers = { Authorization: `Bearer ${s.keys[opts.key || 'full'].token}` }
    if (opts.assertion !== false) headers['x-gridex-staff-assertion'] = opts.token || assertion(s, opts.user || 'admin', opts.claims)
    if (method !== 'GET') headers['Idempotency-Key'] = opts.idempotency || `${s.runId}:${name}`
    let body
    if (opts.binary) { body = opts.binary; Object.assign(headers, opts.headers) }
    else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json' }
    try {
      const response = await fetchFn(new URL(route, origin), { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
      const bytes = Buffer.from(await response.arrayBuffer())
      let data = null
      if (response.headers.get('content-type')?.includes('application/json')) { try { data = JSON.parse(bytes.toString('utf8')) } catch {} }
      const expected = opts.status ?? 200
      const ok = response.status === expected && (!opts.code || data?.error?.code === opts.code)
      record(name, ok, { status: response.status, expected_status: expected, error_code: data?.error?.code ?? null, request_id: response.headers.get('x-request-id'), contract_version: response.headers.get('x-gridex-contract-version') })
      return { ok, data, bytes, response }
    } catch (error) { record(name, false, { transport_error: error?.name || 'Error' }); return { ok: false, data: null } }
  }
  const base = '/api/v1/staff'
  await request('auth_missing_assertion', 'GET', `${base}/roles`, { assertion: false, status: 401, code: 'staff_assertion_missing' })
  await request('auth_wrong_issuer', 'GET', `${base}/roles`, { claims: { iss: `${s.issuer}/wrong` }, status: 401, code: 'staff_assertion_issuer_mismatch' })
  await request('auth_wrong_audience', 'GET', `${base}/roles`, { claims: { aud: `${s.audience}:wrong` }, status: 401, code: 'staff_assertion_audience_mismatch' })
  await request('auth_wrong_company', 'GET', `${base}/roles`, { user: 'foreign', status: 403, code: 'staff_membership_inactive' })
  await request('auth_wildcard_no_opt_in', 'GET', `${base}/roles`, { key: 'wildcard', status: 403, code: 'api_scope_missing' })
  const replay = assertion(s)
  await request('auth_valid_once', 'GET', `${base}/roles`, { token: replay })
  await request('auth_replayed_jti', 'GET', `${base}/roles`, { token: replay, status: 401, code: 'staff_assertion_replayed' })
  await request('auth_low_role', 'GET', `${base}/customers/${s.customerRefA}`, { user: 'low', status: 403, code: 'staff_permission_denied' })
  await request('staff_users_list', 'GET', `${base}/users?page_size=100`)
  await request('staff_role_ceiling', 'PATCH', `${base}/users/${s.users.target}`, { user: 'governance', body: { role_key: 'company_admin' }, status: 403, code: 'staff_role_ceiling_exceeded' })
  await request('staff_self_disable', 'POST', `${base}/users/${s.users.governance}/disable`, { user: 'governance', body: {}, status: 409, code: 'staff_self_disable_forbidden' })
  await request('staff_last_admin_disable', 'POST', `${base}/users/${s.users.admin}/disable`, { user: 'governance', body: {}, status: 409, code: 'staff_last_admin_required' })
  await request('staff_last_admin_demote', 'PATCH', `${base}/users/${s.users.admin}`, { user: 'governance', body: { role_key: 'customer_service_agent' }, status: 409, code: 'staff_last_admin_required' })
  await request('staff_change_role', 'PATCH', `${base}/users/${s.users.target}`, { body: { role_key: 'customer_service_agent' } })
  await request('staff_disable', 'POST', `${base}/users/${s.users.target}/disable`, { body: { reason: `Synthetic E2E ${s.runId}` } })
  await request('staff_disabled_actor_denied', 'GET', `${base}/customers/${s.customerRefA}`, { user: 'target', status: 403, code: 'staff_membership_inactive' })
  await request('staff_enable', 'POST', `${base}/users/${s.users.target}/enable`, { body: {} })
  await request('staff_enabled_actor_read', 'GET', `${base}/customers/${s.customerRefA}`, { user: 'target' })
  await request('staff_invite_ceiling', 'POST', `${base}/users`, { user: 'governance', body: { email: s.inviteEmail, role_key: 'company_admin' }, status: 403, code: 'staff_role_ceiling_exceeded' })
  if (s.includeInvite) await request('staff_invite', 'POST', `${base}/users`, { body: { email: s.inviteEmail, full_name: `Synthetic invite ${s.runId}`, role_key: 'customer_service_agent' }, status: 201 })
  const listing = await request('customer_search', 'GET', `${base}/customers?q=${encodeURIComponent(s.runId)}&page_size=100`)
  if (listing.ok) record('customer_search_company_scope', listing.data?.data?.customers?.some(c => c.customer_reference === s.customerRefA) === true && listing.data?.data?.customers?.every(c => c.customer_reference !== s.customerRefB) === true)
  const detail = await request('customer_detail', 'GET', `${base}/customers/${s.customerRefA}`)
  if (detail.ok) record('customer_personal_number_masked', !JSON.stringify(detail.data).includes('19121212-1212') && typeof detail.data?.data?.customer?.personal_number_masked === 'string')
  await request('customer_cross_company_read', 'GET', `${base}/customers/${s.customerRefB}`, { status: 404 })
  await request('customer_missing_write_scope', 'PATCH', `${base}/customers/${s.customerRefA}/contact`, { key: 'read', body: {}, status: 403, code: 'api_scope_missing' })
  const version = detail.data?.data?.customer?.updated_at
  if (version) {
    const patch = { expectedUpdatedAt: version, phone: '+46 70 123 45 67' }
    const key = `${s.runId}:contact`
    await request('customer_contact_write', 'PATCH', `${base}/customers/${s.customerRefA}/contact`, { body: patch, idempotency: key })
    await request('customer_contact_replay', 'PATCH', `${base}/customers/${s.customerRefA}/contact`, { body: patch, idempotency: key })
    await request('customer_contact_stale_version', 'PATCH', `${base}/customers/${s.customerRefA}/contact`, { body: { ...patch, phone: '+46 70 765 43 21' }, status: 409, code: 'version_conflict' })
    await request('customer_cross_company_contact', 'PATCH', `${base}/customers/${s.customerRefB}/contact`, { body: patch, status: 404 })
  } else record('customer_contact_prerequisite', false)
  await request('customer_identity_request', 'POST', `${base}/customers/${s.customerRefA}/identity-change`, { body: { field: 'personal_number', new_value: '811218-9876', reason: `Synthetic identity correction ${s.runId}` }, status: 201 })
  const createKey = `${s.runId}:case-create`
  const caseBody = { customer_reference: s.customerRefA, title: s.caseTitle, description: 'Synthetic direct API verification', category: 'synthetic', priority: 'normal' }
  await request('case_cross_company_create', 'POST', `${base}/cases`, { body: { ...caseBody, customer_reference: s.customerRefB }, status: 404 })
  const created = await request('case_create', 'POST', `${base}/cases`, { body: caseBody, idempotency: createKey, status: 201 })
  const repeated = await request('case_create_replay', 'POST', `${base}/cases`, { body: caseBody, idempotency: createKey, status: 201 })
  await request('case_cross_actor_replay', 'POST', `${base}/cases`, { user: 'target', body: caseBody, idempotency: createKey, status: 409, code: 'idempotency_conflict' })
  const ref = created.data?.data?.case_reference
  if (ref) {
    record('case_create_same_reference', ref === repeated.data?.data?.case_reference)
    s.caseReference = ref
    const route = `${base}/cases/${ref}`
    await request('case_list', 'GET', `${base}/cases?customer_reference=${s.customerRefA}&limit=100`)
    await request('case_detail', 'GET', route)
    await request('case_customer_reply', 'POST', `${route}/messages`, { body: { message: 'Synthetic reply to customer' }, status: 201 })
    await request('case_internal_note', 'POST', `${route}/notes`, { body: { message: 'Synthetic internal note' }, status: 201 })
    await request('case_phone_interaction', 'POST', `${route}/phone-interactions`, { body: { direction: 'inbound', summary: 'Synthetic call, no customer contacted', verification_method: 'unverified' }, status: 201 })
    await request('case_cross_company_assignee', 'PATCH', `${route}/assignee`, { body: { assignee_user_id: s.users.foreign }, status: 422, code: 'staff_assignee_invalid' })
    await request('case_assign', 'PATCH', `${route}/assignee`, { body: { assignee_user_id: s.users.target } })
    await request('case_unassign', 'PATCH', `${route}/assignee`, { body: { assignee_user_id: null } })
    const file = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
    const upload = await request('case_attachment', 'POST', `${route}/attachments`, { binary: file, headers: { 'Content-Type': 'application/pdf', 'x-file-name': 'synthetic-e2e.pdf', 'x-attachment-visibility': 'internal' }, status: 201 })
    const attachment = upload.data?.data?.attachment_reference
    if (attachment) {
      s.attachmentReference = attachment
      const download = await request('case_attachment_download', 'GET', `${route}/attachments/${attachment}/file`)
      if (download.ok) record('case_attachment_byte_integrity', sha256(download.bytes) === sha256(file))
    } else record('case_attachment_prerequisite', false)
    await request('case_events_page', 'GET', `${route}/events?limit=100`)
    await request('case_attachments_page', 'GET', `${route}/attachments?limit=100`)
    await request('case_status', 'PATCH', `${route}/status`, { body: { status: 'resolved', message: 'Synthetic verification complete' } })
  } else record('case_work_prerequisite', false)
  s.results = results
  return { run_id: s.runId, base_url: origin.origin, passed: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, cleanup_required: true, results }
}

async function main(argv) {
  const [command, ...args] = argv
  const options = Object.fromEntries(args.reduce((all, item, index) => item.startsWith('--') ? [...all, [item.slice(2), args[index + 1]]] : all, []))
  if (command === 'prepare') {
    assert(options['output-dir'], '--output-dir is required and must be outside the repository')
    const directory = path.resolve(options['output-dir'])
    const root = path.resolve(__dirname, '..')
    assert(directory !== root && !directory.startsWith(`${root}${path.sep}`), 'Private artifacts must be outside the repository')
    assert(!fs.existsSync(path.join(directory, 'state.private.json')), 'Use a fresh output directory')
    const s = createState()
    s.includeInvite = options['include-invite'] === 'true'
    writeArtifacts(s, directory)
    process.stdout.write(JSON.stringify({ run_id: s.runId, directory, fixture: path.join(directory, 'fixture.sql'), cleanup: path.join(directory, 'cleanup.sql') }) + '\n')
  } else if (command === 'run') {
    assert(options.state && options['base-url'], '--state and --base-url are required; apply fixture.sql before running')
    const file = path.resolve(options.state)
    assert((fs.statSync(file).mode & 0o077) === 0, 'Private state must be mode 0600')
    const s = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert(s.version === 1 && s.runId && s.privateKey && s.keys?.full, 'Invalid synthetic state')
    try {
      const report = await runHttp(s, options['base-url'])
      fs.writeFileSync(path.join(path.dirname(file), 'results.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
      process.stdout.write(JSON.stringify({ run_id: report.run_id, passed: report.passed, failed: report.failed, cleanup_required: true, audit_sql: path.join(path.dirname(file), 'audit.sql'), cleanup_sql: path.join(path.dirname(file), 'cleanup.sql') }) + '\n')
      if (report.failed) process.exitCode = 1
    } finally { writeArtifacts(s, path.dirname(file)) }
  } else throw new Error('Usage: staff-api-synthetic-e2e.cjs prepare --output-dir DIR | run --state FILE --base-url HTTPS_ORIGIN')
}

module.exports = { createState, fixtureSql, auditSql, cleanupSql, assertion, writeArtifacts, runHttp, sha256 }
if (require.main === module) main(process.argv.slice(2)).catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 })
