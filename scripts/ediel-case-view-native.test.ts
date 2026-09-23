import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
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
  sql(`
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(user)},${quote(email)},'Disposable case operator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.roles(id,key,name,scope) VALUES(${quote(role)},${quote(`e035_case_${tag}`)},'Disposable case role','company');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at) VALUES(${quote(company)},${quote(user)},'operations','active',now());
    INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${quote(user)},${quote(company)},${quote(role)},${quote(`e035_case_${tag}`)},'active',true);
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key)
      SELECT ${quote(role)},${quote(`e035_case_${tag}`)},id,key FROM public.permissions WHERE key IN (${keys.map(quote).join(',')});
  `)
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
    message_family: 'PRODAT', message_code: 'Z08', environment: 'test', status: 'received',
    parsed_payload: { subtype: 'H' }, message_received_at: new Date().toISOString(),
  }).select('*').single()
  expect(error).toBeNull()
  expect(data).not.toBeNull()
  const result = await applyInboundBusinessStateMachine({ message: data as unknown as EdielMessageRow, actorUserId: actor })
  expect(result).toMatchObject({ outcome: 'unexpected_direction_review', updated: ['customer_cases'], reviewRequired: true })
  const rows = sql<Array<{ id: string; title: string; description: string; next_action: string; source: string; reason_category: string }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'description',description,'next_action',next_action,'source',source,'reason_category',reason_category)),'[]') FROM public.customer_cases WHERE company_id=${quote(company)} AND metadata->>'source_ediel_message_id'=${quote(source)}`)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ source: 'ediel_inbound_state_machine', reason_category: 'ediel_unexpected_direction' })
  return { ...rows[0], sourceMessageId: source }
}

it('provisions real GoTrue operators and real Ediel writer cases for the protected local browser route', async () => {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== API || !process.env.RUNNER_TEMP) throw new Error('disposable_replay_only')
  const manifestPath = resolve(process.env.GRIDEX_EDIEL_CASE_FIXTURE_PATH!)
  if (!manifestPath.startsWith(resolve(process.env.RUNNER_TEMP) + sep)) throw new Error('fixture_must_stay_in_runner_temp')
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
  const supportId = sql<string>(`SELECT to_jsonb(id) FROM public.customer_cases WHERE company_id=${quote(companyA)} AND source='tenant_support_fixture' LIMIT 1`)
  await expect(updateCustomerCaseStatus({ caseId: supportId, companyId: companyA, status: 'resolved', expectedSource: 'ediel_inbound_state_machine', actorUserId: writer.user })).rejects.toBeDefined()
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_case_events WHERE customer_case_id=${quote(supportId)}`)).toBe(0)
  // Real updater also certifies the event/audit path; browser will submit the A status form.
  await updateCustomerCaseStatus({ caseId: foreign.id, companyId: companyB, status: 'resolved', expectedSource: 'ediel_inbound_state_machine', actorUserId: actorB.user })
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_case_events WHERE customer_case_id=${quote(foreign.id)} AND event_type='status_changed'`)).toBe(1)
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.audit_logs WHERE entity_id=${quote(foreign.id)} AND action='customer_case_status_changed'`)).toBe(1)
  writeFileSync(manifestPath, JSON.stringify({ companyA, companyB, customerA, customerB, recent, old, foreign, writerEmail: writer.email, readOnlyEmail: readOnly.email, noCaseReadEmail: noCaseRead.email }), { mode: 0o600 })
})
