import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
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

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T = unknown>(command: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('local_only')
  const output = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: command, encoding: 'utf8', timeout: 15_000, maxBuffer: 2_000_000 }).trim()
  return output ? JSON.parse(output) as T : undefined as T
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
  return { user, email }
}

async function writeCase(company: string, customer: string, actor: string) {
  const source = randomUUID()
  const { data, error } = await supabaseService.from('ediel_messages').insert({
    id: source, company_id: company, customer_id: customer, direction: 'inbound', message_standard: 'edifact',
    message_family: 'PRODAT', message_code: 'Z06', message_version: 'E2SE6A', application_reference: '23-DDQ-PRODAT',
    environment: 'test', status: 'received', parsed_payload: { subtype: 'G' }, message_received_at: new Date().toISOString(),
  }).select('*').single()
  expect(error).toBeNull()
  expect(data).not.toBeNull()
  expect(data?.rule_profile_key).toBe('PRODAT:Z06:G:26.A:r3')
  const result = await applyInboundBusinessStateMachine({ message: data as unknown as EdielMessageRow, actorUserId: actor })
  expect(result).toMatchObject({ outcome: 'masterdata_update_received', updated: ['customer_cases'], reviewRequired: true })
  const rows = sql<Array<{ id: string; title: string; description: string; next_action: string; source: string; reason_category: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'next_action',next_action,'source',source,'reason_category',reason_category)),'[]') FROM public.customer_cases WHERE company_id=${quote(company)} AND metadata->>'source_ediel_message_id'=${quote(source)}`)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ source: 'ediel_inbound_state_machine', reason_category: 'masterdata_update_review' })
  return { ...rows[0], sourceMessageId: source }
}

it('provisions real GoTrue and writer cases, then verifies browser triage without business effects', async () => {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== API || !process.env.RUNNER_TEMP) throw new Error('disposable_replay_only')
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
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${quote(customerA)},${quote(companyA)},${quote(`CASE-A-${tag}`)},'Synthetic A','private'),(${quote(customerB)},${quote(companyB)},${quote(`CASE-B-${tag}`)},'Synthetic B','private');`)
  const writer = await createActor(`${tag}-writer`, companyA, ['communication.read', 'cases.read', 'cases.write', 'customers.read', 'switching.read'])
  const readOnly = await createActor(`${tag}-reader`, companyA, ['communication.read', 'cases.read'])
  const noCaseRead = await createActor(`${tag}-nocase`, companyA, ['communication.read'])
  const actorB = await createActor(`${tag}-b`, companyB, ['cases.read'])
  const old = await writeCase(companyA, customerA, writer.user)
  sql(`UPDATE public.customer_cases SET created_at=now()-interval '3 days' WHERE id=${quote(old.id)};
    INSERT INTO public.customer_cases(company_id,customer_id,case_type,status,title,source,metadata,created_at)
      SELECT ${quote(companyA)},${quote(customerA)},'other','open','Synthetic support '||n,'tenant_support_fixture','{"support_case":true}'::jsonb,now()-interval '1 day' FROM generate_series(1,201) AS n;`)
  const recent = await writeCase(companyA, customerA, writer.user)
  const foreign = await writeCase(companyB, customerB, actorB.user)
  const list = await listCustomerCases({ companyId: companyA, source: 'ediel_inbound_state_machine', limit: 200 })
  expect(list.map((row) => row.id)).toEqual(expect.arrayContaining([old.id, recent.id]))
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
  // Real updater also certifies the event/audit path; browser will submit the A status form.
  await updateCustomerCaseStatus({ caseId: foreign.id, companyId: companyB, status: 'resolved', expectedSource: 'ediel_inbound_state_machine', actorUserId: actorB.user })
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_case_events WHERE customer_case_id=${quote(foreign.id)} AND event_type='status_changed'`)).toBe(1)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.audit_logs WHERE entity_id=${quote(foreign.id)} AND action='customer_case_status_changed'`)).toBe(1)
  writeFileSync(manifestPath, JSON.stringify({ companyA, companyB, customerA, customerB, recent, old, foreign, writerId: writer.user, writerEmail: writer.email, readOnlyEmail: readOnly.email, noCaseReadEmail: noCaseRead.email }), { mode: 0o600 })
})
