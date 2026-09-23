import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

// This suite only runs against the disposable local replay. External customer
// workflow/notification dispatch is outside the case writer being qualified.
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: async () => null }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: async () => null }))

import { supabaseService } from '@/lib/supabase/service'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachine'
import { listCustomerCases, updateCustomerCaseStatus } from '@/lib/customer-cases/db'
import { listTenantSupportCases } from '@/lib/customer-cases/support'

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T = unknown>(command: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('local_only')
  const output = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: command, encoding: 'utf8', timeout: 15_000, maxBuffer: 2_000_000 }).trim()
  return output ? JSON.parse(output) as T : undefined as T
}

function readVerifiedCaseRestorationMigration(): string {
  const migrationName = '20260923180557_restore_customer_case_events_atomic_status.sql'
  const expectedChecksum = '290357346253461628c6d341ba383d16690b62613dc8ce913eb3044965cd59a8'
  const migrationPath = process.env.GRIDEX_EDIEL_CASE_RESTORATION_SQL
  if (!migrationPath || !isAbsolute(migrationPath)) throw new Error('restoration_migration_path_required')
  if (basename(migrationPath) !== migrationName) throw new Error('restoration_migration_name_mismatch')
  const manifest = JSON.parse(readFileSync(resolve('scripts/migration-history-manifest.json'), 'utf8')) as { files: Record<string, string> }
  if (manifest.files[migrationName] !== expectedChecksum) throw new Error('restoration_migration_registration_mismatch')
  const bytes = readFileSync(migrationPath)
  if (createHash('sha256').update(bytes).digest('hex') !== expectedChecksum) throw new Error('restoration_migration_checksum_mismatch')
  return bytes.toString('utf8')
}

async function createActor(tag: string, company: string, keys: string[]) {
  const email = `e035-case-${tag}@example.invalid`
  const password = process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD!
  const { data, error } = await supabaseService.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error('gotrue_user_missing')
  const user = data.user.id
  const role = randomUUID()
  const permissions = keys.map(quote).join(',')
  sql(`
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(user)},${quote(email)},'Disposable case operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.roles(id,key,name,scope) VALUES(${quote(role)},${quote(`e035_case_${tag}`)},'Disposable case role','company');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at) VALUES(${quote(company)},${quote(user)},'operations','active',now());
    INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${quote(user)},${quote(company)},${quote(role)},${quote(`e035_case_${tag}`)},'active',true);
    INSERT INTO public.permissions(key,name,description,category)
      SELECT permission_keys.key,permission_keys.key,'Disposable local case role permission','test' FROM unnest(ARRAY[${permissions}]::text[]) AS permission_keys(key)
      ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key)
      SELECT ${quote(role)},${quote(`e035_case_${tag}`)},id,key FROM public.permissions WHERE key IN (${permissions});
  `)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.role_permissions WHERE role_id=${quote(role)}`)).toBe(keys.length)
  const client = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const login = await client.auth.signInWithPassword({ email, password })
  expect(login.error).toBeNull()
  const context = await client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: company })
  expect(context.error).toBeNull()
  expect(context.data).toMatchObject({ authorized: true, selected_company_id: company })
  for (const key of keys) expect((context.data as { permissions: string[] }).permissions).toContain(key)
  return { user, email, client }
}

async function writeCase(company: string, customer: string, actor: string) {
  const source = randomUUID()
  // The inbound binding trigger selects by message code, not subtype. Z06 has
  // three valid profiles, so bind the exact dated registry row as the existing
  // native source-owner fixtures do; no profile or trigger is fabricated.
  const profile = 'PRODAT:Z06:G:26.A:r3'
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_message_profiles profile
    JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
    WHERE profile.profile_key=${quote(profile)} AND profile.is_enabled AND profile.direction IN ('inbound','both')
      AND profile.message_code='Z06' AND profile.transaction_subtype='G' AND profile.profile->>'family'='PRODAT'
      AND pack.status IN ('active','future') AND pack.valid_from<=current_date
      AND (pack.valid_to IS NULL OR pack.valid_to>=current_date)`)).toBe(1)
  expect(sql<string>(`INSERT INTO public.ediel_messages(
    id,company_id,customer_id,direction,message_standard,message_family,message_code,message_version,
    application_reference,environment,status,parsed_payload,message_received_at,
    canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${quote(source)},${quote(company)},${quote(customer)},'inbound','edifact','PRODAT','Z06','E2SE6A',
      '23-DDQ-PRODAT','test','received','{"subtype":"G"}'::jsonb,clock_timestamp(),
      pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile
    FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id
    WHERE profile.profile_key=${quote(profile)} AND profile.is_enabled AND profile.direction IN ('inbound','both')
      AND profile.message_code='Z06' AND profile.transaction_subtype='G' AND profile.profile->>'family'='PRODAT'
      AND pack.status IN ('active','future') AND pack.valid_from<=current_date
      AND (pack.valid_to IS NULL OR pack.valid_to>=current_date) RETURNING to_jsonb(id)`)).toBe(source)
  const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', source).single()
  expect(error).toBeNull()
  expect(data).not.toBeNull()
  expect(data?.rule_profile_key).toBe(profile)
  const result = await applyInboundBusinessStateMachine({ message: data as unknown as EdielMessageRow, actorUserId: actor })
  expect(result).toMatchObject({ outcome: 'masterdata_update_received', updated: ['customer_cases'], reviewRequired: true })
  const rows = sql<Array<{ id: string; title: string; description: string; next_action: string; source: string; reason_category: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'next_action',next_action,'source',source,'reason_category',reason_category)),'[]') FROM public.customer_cases WHERE company_id=${quote(company)} AND metadata->>'source_ediel_message_id'=${quote(source)}`)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ source: 'ediel_inbound_state_machine', reason_category: 'masterdata_update_review' })
  return { ...rows[0], sourceMessageId: source }
}

it('provisions real GoTrue and writer cases, then verifies browser triage without business effects', async () => {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== API || !process.env.RUNNER_TEMP) throw new Error('disposable_replay_only')
  // The sourced replay owns original SQL in HOLD until shell EXIT. Verify
  // that explicit input before any case mutation, including the browser pass.
  const migration = readVerifiedCaseRestorationMigration()
  const manifestPath = resolve(process.env.GRIDEX_EDIEL_CASE_FIXTURE_PATH!)
  if (!manifestPath.startsWith(resolve(process.env.RUNNER_TEMP) + sep)) throw new Error('fixture_must_stay_in_runner_temp')
  if (process.env.GRIDEX_EDIEL_CASE_VERIFY_AFTER_BROWSER === '1') {
    const fixture = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      companyA: string; companyB: string; recent: { id: string; sourceMessageId: string }; old: { id: string }; foreign: { id: string }; writerId: string
    }
    expect(sql<{ status: string; updated_by: string }>(`SELECT jsonb_build_object('status',status,'updated_by',updated_by) FROM public.customer_cases WHERE id=${quote(fixture.recent.id)} AND company_id=${quote(fixture.companyA)}`)).toEqual({ status: 'resolved', updated_by: fixture.writerId })
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_case_events WHERE customer_case_id=${quote(fixture.recent.id)} AND company_id=${quote(fixture.companyA)} AND event_type='status_changed' AND message='Ediel-ärendestatus uppdaterad till resolved.'`)).toBe(1)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.audit_logs WHERE entity_id=${quote(fixture.recent.id)} AND company_id=${quote(fixture.companyA)} AND action='customer_case_status_changed' AND actor_user_id=${quote(fixture.writerId)}`)).toBe(1)
    expect(sql<string>(`SELECT to_jsonb(status) FROM public.customer_cases WHERE id=${quote(fixture.old.id)} AND company_id=${quote(fixture.companyA)}`)).toBe('open')
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_ack_chains WHERE company_id IN (${quote(fixture.companyA)},${quote(fixture.companyB)})`)).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_ack_lifecycle WHERE company_id IN (${quote(fixture.companyA)},${quote(fixture.companyB)})`)).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.validation_assessments WHERE company_id IN (${quote(fixture.companyA)},${quote(fixture.companyB)})`)).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.object_assessments WHERE company_id IN (${quote(fixture.companyA)},${quote(fixture.companyB)})`)).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id IN (${quote(fixture.companyA)},${quote(fixture.companyB)})`)).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.billing_underlays WHERE company_id IN (${quote(fixture.companyA)},${quote(fixture.companyB)})`)).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_outbound_queue WHERE company_id IN (${quote(fixture.companyA)},${quote(fixture.companyB)})`)).toBe(0)
    expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id IN (${quote(fixture.companyA)},${quote(fixture.companyB)}) AND direction='outbound'`)).toBe(0)
    expect(sql<{ contrl_status: string | null; aperak_status: string | null; ack_outcome: string | null }>(`SELECT jsonb_build_object('contrl_status',contrl_status,'aperak_status',aperak_status,'ack_outcome',ack_outcome) FROM public.ediel_messages WHERE id=${quote(fixture.recent.sourceMessageId)} AND company_id=${quote(fixture.companyA)}`)).toEqual({ contrl_status: null, aperak_status: null, ack_outcome: null })
    return
  }
  const tag = randomUUID().slice(0, 12)
  const companyA = randomUUID(), companyB = randomUUID(), customerA = randomUUID(), customerB = randomUUID()
  sql(`DO $$ BEGIN IF EXISTS(SELECT FROM public.companies WHERE id IN (${quote(companyA)},${quote(companyB)})) THEN RAISE EXCEPTION 'fixture_collision'; END IF; END $$;
    INSERT INTO public.companies(id,name,status) VALUES(${quote(companyA)},${quote(`Case A ${tag}`)},'active'),(${quote(companyB)},${quote(`Case B ${tag}`)},'active');
    INSERT INTO public.customers(id,company_id,customer_number,name,full_name,email,customer_type) VALUES(${quote(customerA)},${quote(companyA)},${quote(`CASE-A-${tag}`)},'Synthetic A','Synthetic A','case-a@example.invalid','private'),(${quote(customerB)},${quote(companyB)},${quote(`CASE-B-${tag}`)},'Synthetic B','Synthetic B','case-b@example.invalid','private');`)
  const writer = await createActor(`${tag}-writer`, companyA, ['communication.read', 'cases.read', 'cases.write', 'customers.read', 'switching.read'])
  const readOnly = await createActor(`${tag}-reader`, companyA, ['communication.read', 'cases.read'])
  const noCaseRead = await createActor(`${tag}-nocase`, companyA, ['communication.read'])
  const actorB = await createActor(`${tag}-b`, companyB, ['cases.read', 'cases.write'])
  const old = await writeCase(companyA, customerA, writer.user)
  sql(`UPDATE public.customer_cases SET created_at=now()-interval '3 days' WHERE id=${quote(old.id)};
    INSERT INTO public.customer_cases(company_id,customer_id,case_type,status,title,source,metadata,created_at)
      SELECT ${quote(companyA)},${quote(customerA)},'other','open','Synthetic support '||n,'tenant_support_fixture','{"support_case":true}'::jsonb,now()-interval '1 day' FROM generate_series(1,201) AS n;`)
  const recent = await writeCase(companyA, customerA, writer.user)
  const foreign = await writeCase(companyB, customerB, actorB.user)
  const list = await listCustomerCases({ companyId: companyA, source: 'ediel_inbound_state_machine', limit: 200 })
  expect(list).toHaveLength(2)
  expect(list.map((row) => row.id)).toEqual(expect.arrayContaining([old.id, recent.id]))
  for (const row of list) expect(row).toMatchObject({ company_id: companyA, customer_id: customerA, customer_name: 'Synthetic A', customer_email: 'case-a@example.invalid', customer_number: `CASE-A-${tag}` })
  const foreignList = await listCustomerCases({ companyId: companyB, source: 'ediel_inbound_state_machine', offset: 0, limit: 201 })
  expect(foreignList).toHaveLength(1)
  expect(foreignList[0]).toMatchObject({ id: foreign.id, company_id: companyB, customer_id: customerB, customer_name: 'Synthetic B', customer_email: 'case-b@example.invalid', customer_number: `CASE-B-${tag}` })
  // Exercise the actual default-list Support consumer against the same schema.
  // The newest Ediel case consumes one of the unchanged 200 default-list slots.
  const supportList = await listTenantSupportCases({ companyId: companyA, limit: 200 })
  expect(supportList).toHaveLength(199)
  for (const row of supportList) expect(row).toMatchObject({ source: 'tenant_support_fixture', company_id: companyA, customer_id: customerA, customer_name: 'Synthetic A', customer_email: 'case-a@example.invalid', customer_number: `CASE-A-${tag}` })
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_cases WHERE company_id=${quote(companyA)} AND created_at>(SELECT created_at FROM public.customer_cases WHERE id=${quote(old.id)})`)).toBeGreaterThan(200)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id IN (${quote(companyA)},${quote(companyB)})`)).toBe(0)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.billing_underlays WHERE company_id IN (${quote(companyA)},${quote(companyB)})`)).toBe(0)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id IN (${quote(companyA)},${quote(companyB)}) AND direction='outbound'`)).toBe(0)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_outbound_queue WHERE company_id IN (${quote(companyA)},${quote(companyB)})`)).toBe(0)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_ack_chains WHERE company_id IN (${quote(companyA)},${quote(companyB)})`)).toBe(0)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_ack_lifecycle WHERE company_id IN (${quote(companyA)},${quote(companyB)})`)).toBe(0)
  expect(sql<Array<{ contrl_status: string | null; aperak_status: string | null; ack_outcome: string | null }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('contrl_status',contrl_status,'aperak_status',aperak_status,'ack_outcome',ack_outcome)),'[]') FROM public.ediel_messages WHERE id IN (${quote(old.sourceMessageId)},${quote(recent.sourceMessageId)},${quote(foreign.sourceMessageId)})`)).toEqual([
    { contrl_status: null, aperak_status: null, ack_outcome: null },
    { contrl_status: null, aperak_status: null, ack_outcome: null },
    { contrl_status: null, aperak_status: null, ack_outcome: null },
  ])
  const supportId = sql<string>(`SELECT to_jsonb(id) FROM public.customer_cases WHERE company_id=${quote(companyA)} AND source='tenant_support_fixture' LIMIT 1`)
  await expect(updateCustomerCaseStatus({ caseId: supportId, companyId: companyA, status: 'resolved', expectedSource: 'ediel_inbound_state_machine', actorUserId: writer.user })).rejects.toBeDefined()
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_case_events WHERE customer_case_id=${quote(supportId)}`)).toBe(0)
  // The production RPC must reject tenant/source/actor/permission mistakes
  // before committing any status, event or audit. The reader fixture remains
  // read-only; B's positive writer explicitly holds cases.write in B.
  const statusSnapshot = (id: string) => sql(`SELECT jsonb_build_object(
    'case',(SELECT to_jsonb(c) FROM public.customer_cases c WHERE id=${quote(id)}),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') FROM public.customer_case_events e WHERE customer_case_id=${quote(id)}),
    'audits',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]') FROM public.audit_logs a WHERE entity_id=${quote(id)} AND action='customer_case_status_changed'))`)
  expect(sql<string>(`SELECT to_jsonb(status) FROM public.customer_cases WHERE id=${quote(supportId)}`)).toBe('open')
  const beforeSupport = statusSnapshot(supportId)
  for (const input of [
    { caseId: supportId, companyId: companyA, actorUserId: writer.user, expectedSource: 'ediel_inbound_state_machine' },
    { caseId: supportId, companyId: companyB, actorUserId: actorB.user },
    { caseId: supportId, companyId: companyA, actorUserId: actorB.user },
    { caseId: supportId, companyId: companyA, actorUserId: readOnly.user },
    { caseId: supportId, companyId: companyA, actorUserId: null },
    { caseId: supportId, companyId: companyA, actorUserId: randomUUID() },
  ]) {
    await expect(updateCustomerCaseStatus({ ...input, status: 'resolved' })).rejects.toBeDefined()
    expect(statusSnapshot(supportId)).toEqual(beforeSupport)
  }
  await expect(updateCustomerCaseStatus({ caseId: supportId, companyId: companyA, actorUserId: writer.user, status: 'not_a_case_status' })).rejects.toMatchObject({ code: '23514' })
  expect(statusSnapshot(supportId)).toEqual(beforeSupport)
  // Permission in A must not authorize B even when the same actor belongs to B.
  const scopedActor = await createActor(`${tag}-scoped`, companyA, ['cases.write'])
  sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at) VALUES(${quote(companyB)},${quote(scopedActor.user)},'operations','active',now())`)
  const beforeForeign = statusSnapshot(foreign.id)
  await expect(updateCustomerCaseStatus({ caseId: foreign.id, companyId: companyB, actorUserId: scopedActor.user, status: 'resolved' })).rejects.toMatchObject({ code: '42501' })
  expect(statusSnapshot(foreign.id)).toEqual(beforeForeign)

  // Actual PostgreSQL failure injection proves transaction rollback at both
  // later writes, including a successfully inserted event before audit failure.
  for (const target of ['customer_case_events', 'audit_logs'] as const) {
    sql(`CREATE FUNCTION public.e035_case_status_reject_test() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN RAISE EXCEPTION 'disposable_status_write_rejected'; END $body$;
      CREATE TRIGGER e035_case_status_reject_test BEFORE INSERT ON public.${target}
      FOR EACH ROW EXECUTE FUNCTION public.e035_case_status_reject_test();`)
    try {
      await expect(updateCustomerCaseStatus({ caseId: supportId, companyId: companyA, actorUserId: writer.user, status: 'resolved' })).rejects.toMatchObject({ code: 'P0001', message: 'disposable_status_write_rejected' })
      expect(statusSnapshot(supportId)).toEqual(beforeSupport)
    } finally {
      sql(`DROP TRIGGER e035_case_status_reject_test ON public.${target}; DROP FUNCTION public.e035_case_status_reject_test();`)
    }
  }

  // Grants are exercised through actual authenticated and anon Data API calls,
  // including a writer JWT: neither frontend role may bypass the server action.
  const anon = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  for (const client of [anon, writer.client]) {
    const read = await client.from('customer_case_events').select('id').eq('customer_case_id', supportId)
    expect(read.error?.code).toBe('42501')
    const insert = await client.from('customer_case_events').insert({ company_id: companyA, customer_id: customerA, customer_case_id: supportId, event_type: 'status_changed', message: 'Forged frontend event' })
    expect(insert.error?.code).toBe('42501')
    const mutation = await client.rpc('gridex_update_customer_case_status', { p_case_id: supportId, p_company_id: companyA, p_status: 'resolved', p_actor_user_id: writer.user })
    expect(mutation.error?.code).toBe('42501')
    expect(statusSnapshot(supportId)).toEqual(beforeSupport)
  }
  expect(sql<boolean>(`SELECT to_jsonb(relrowsecurity) FROM pg_class WHERE oid='public.customer_case_events'::regclass`)).toBe(true)

  for (const owner of [
    { company: companyB, customer: customerA },
    { company: companyA, customer: customerB },
    { company: companyB, customer: customerB },
  ]) {
    const result = await supabaseService.from('customer_case_events').insert({ company_id: owner.company, customer_id: owner.customer, customer_case_id: supportId, event_type: 'test', message: 'Disposable invalid owner' })
    expect(result.error?.code).toBe('23503')
    expect(statusSnapshot(supportId)).toEqual(beforeSupport)
  }

  // Existing Support caller omits expectedSource. Keep its message/event shape
  // and verify canonical audit context is supplied by the real audit trigger.
  await updateCustomerCaseStatus({ caseId: supportId, companyId: companyA, actorUserId: writer.user, status: 'resolved', message: '  Support resolved.  ' })
  expect(sql(`SELECT jsonb_build_object('company',company_id,'customer',customer_id,'actor',created_by,'status',event_status,'message',message,'payload',payload)
    FROM public.customer_case_events WHERE customer_case_id=${quote(supportId)}`)).toEqual({ company: companyA, customer: customerA, actor: writer.user, status: 'success', message: 'Support resolved.', payload: { status: 'resolved' } })
  expect(sql(`SELECT jsonb_build_object('company',company_id,'actor',actor_user_id,'customer',metadata->>'customer_id','old',previous_status,'new',new_status,'actor_type',actor_type,'resource',resource_type,'resource_id',resource_id,'context_present',request_id<>'' AND correlation_id<>'')
    FROM public.audit_logs WHERE entity_id=${quote(supportId)} AND action='customer_case_status_changed'`)).toEqual({ company: companyA, actor: writer.user, customer: customerA, old: 'open', new: 'resolved', actor_type: 'user', resource: 'customer_case', resource_id: supportId, context_present: true })

  // Support permits a real platform admin who belongs to the selected company;
  // Ediel remains tenant-write only even without an expected-source argument.
  const platformActor = await createActor(`${tag}-platform`, companyA, ['cases.read'])
  sql(`INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${quote(platformActor.user)},'platform_admin',true)`)
  expect(sql<boolean>(`SELECT to_jsonb(public.canonical_actor_is_platform_admin(${quote(platformActor.user)}))`)).toBe(true)
  const beforeEdiel = statusSnapshot(old.id)
  await expect(updateCustomerCaseStatus({ caseId: old.id, companyId: companyA, actorUserId: platformActor.user, status: 'resolved' })).rejects.toMatchObject({ code: '42501', message: 'ediel_case_status_requires_tenant_actor' })
  expect(statusSnapshot(old.id)).toEqual(beforeEdiel)
  const platformSupportId = sql<string>(`SELECT to_jsonb(id) FROM public.customer_cases WHERE company_id=${quote(companyA)} AND source='tenant_support_fixture' AND id<>${quote(supportId)} LIMIT 1`)
  const platformResult = await updateCustomerCaseStatus({ caseId: platformSupportId, companyId: companyA, actorUserId: platformActor.user, status: 'resolved' })
  expect(platformResult).toMatchObject({ id: platformSupportId, company_id: companyA, customer_id: customerA, updated_by: platformActor.user, status: 'resolved' })
  const beforePlatformDenied = statusSnapshot(platformSupportId)
  sql(`UPDATE public.company_memberships SET status='removed',is_active=false WHERE company_id=${quote(companyA)} AND user_id=${quote(platformActor.user)}`)
  await expect(updateCustomerCaseStatus({ caseId: platformSupportId, companyId: companyA, actorUserId: platformActor.user, status: 'closed' })).rejects.toMatchObject({ code: '42501' })
  expect(statusSnapshot(platformSupportId)).toEqual(beforePlatformDenied)

  // Run the actual restoration against a populated preexisting relation in a
  // rolled-back disposable transaction; preserved rows must remain byte equal.
  const preserved = sql(`SELECT to_jsonb(e) FROM public.customer_case_events e WHERE customer_case_id=${quote(supportId)}`)
  expect(sql(`BEGIN; ${migration}
    SELECT to_jsonb(e) FROM public.customer_case_events e WHERE customer_case_id=${quote(supportId)}; ROLLBACK;`)).toEqual(preserved)
  // Simulate the original table without the added composite constraint. A
  // preexisting wrong-company event must make restoration fail, never be moved.
  expect(() => sql(`BEGIN; ALTER TABLE public.customer_case_events DROP CONSTRAINT customer_case_events_case_owner_fk;
    UPDATE public.customer_case_events SET company_id=${quote(companyB)},customer_id=${quote(customerB)} WHERE customer_case_id=${quote(supportId)};
    ${migration} ROLLBACK;`)).toThrow(/customer_case_events_case_owner_fk/)
  expect(sql(`SELECT to_jsonb(e) FROM public.customer_case_events e WHERE customer_case_id=${quote(supportId)}`)).toEqual(preserved)
  // Real updater also certifies the event/audit path; browser will submit the A status form.
  await updateCustomerCaseStatus({ caseId: foreign.id, companyId: companyB, status: 'resolved', expectedSource: 'ediel_inbound_state_machine', actorUserId: actorB.user })
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_case_events WHERE customer_case_id=${quote(foreign.id)} AND event_type='status_changed'`)).toBe(1)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.audit_logs WHERE entity_id=${quote(foreign.id)} AND action='customer_case_status_changed'`)).toBe(1)
  writeFileSync(manifestPath, JSON.stringify({ companyA, companyB, customerA, customerB, recent, old, foreign, writerId: writer.user, writerEmail: writer.email, readOnlyEmail: readOnly.email, noCaseReadEmail: noCaseRead.email }), { mode: 0o600 })
})
