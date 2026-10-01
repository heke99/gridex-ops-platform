import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest'
import type { CustomerCaseRow } from '@/lib/customer-cases/types'
import { createLifecycleDecisionFromCase } from '@/lib/operations/switchLifecycleBlocks'
import { supabaseService } from '@/lib/supabase/service'
import { proofSql, quote } from './customer-read-proof-native'

// Prepared real PostgREST/business writer proof. No Auth/permission grants,
// sessions, provider transport or whole legacy operational-stop transaction.
const financeTables = ['billing_underlays', 'customer_invoices', 'customer_invoice_lines', 'invoice_documents'] as const
function financeFingerprint() {
  return proofSql<Record<string, string>>(`SELECT jsonb_build_object(${financeTables.map(table => `${quote(table)},(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text,'UTF8')),'hex') FROM public.${table} t)`).join(',')});`)
}
let originalFinance: Record<string, string>
let f: { company: string; quiet: string; customer: string; quietCustomer: string; contract: string; quietContract: string; caseId: string; fault: string }
let quietBefore: unknown
beforeAll(() => { originalFinance = financeFingerprint() })
afterAll(() => { expect(financeFingerprint()).toEqual(originalFinance) })
beforeEach(() => {
  f = { company: randomUUID(), quiet: randomUUID(), customer: randomUUID(), quietCustomer: randomUUID(), contract: randomUUID(), quietContract: randomUUID(), caseId: randomUUID(), fault: 'lifecycle_owned_fault_' + randomUUID().replaceAll('-', '') }
  proofSql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(f.company)},'Synthetic sourced lifecycle A','active'),(${quote(f.quiet)},'Synthetic sourced lifecycle B','active');
    INSERT INTO public.customers(id,company_id,first_name,last_name) VALUES(${quote(f.customer)},${quote(f.company)},'Synthetic','Lifecycle A'),(${quote(f.quietCustomer)},${quote(f.quiet)},'Synthetic','Lifecycle B');
    INSERT INTO public.customer_contracts(id,company_id,customer_id,status) VALUES(${quote(f.contract)},${quote(f.company)},${quote(f.customer)},'draft'),(${quote(f.quietContract)},${quote(f.quiet)},${quote(f.quietCustomer)},'draft');
    INSERT INTO public.customer_cases(id,company_id,customer_id,customer_contract_id,case_type,title,billing_blocked,withdrawal_requested_at,metadata)
    VALUES(${quote(f.caseId)},${quote(f.company)},${quote(f.customer)},${quote(f.contract)},'withdrawal','Synthetic sourced withdrawal',true,clock_timestamp(),'{"receivedChannel":"phone","notes":"Synthetic owned staff note"}');
    SELECT to_jsonb(count(*)) FROM public.customer_cases WHERE id=${quote(f.caseId)};`)
  quietBefore = quietGraph()
})
function quietGraph() {
  return proofSql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${quote(f.quietCustomer)}),'contract',(SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${quote(f.quietContract)}),'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]'::jsonb) FROM public.customer_lifecycle_decisions d WHERE company_id=${quote(f.quiet)}));`)
}
function currentCase() { return proofSql<CustomerCaseRow>(`SELECT to_jsonb(c) FROM public.customer_cases c WHERE id=${quote(f.caseId)};`) }
afterEach(() => {
  expect(quietGraph()).toEqual(quietBefore)
  proofSql(`DROP TRIGGER IF EXISTS ${f.fault} ON public.customer_lifecycle_decisions;
    DROP FUNCTION IF EXISTS private.${f.fault}();
    DELETE FROM public.customer_lifecycle_decisions WHERE company_id IN (${quote(f.company)},${quote(f.quiet)});
    DELETE FROM public.customer_cases WHERE company_id IN (${quote(f.company)},${quote(f.quiet)});
    DELETE FROM public.customer_contracts WHERE id IN (${quote(f.contract)},${quote(f.quietContract)});
    DELETE FROM public.customers WHERE id IN (${quote(f.customer)},${quote(f.quietCustomer)});
    DELETE FROM public.companies WHERE id IN (${quote(f.company)},${quote(f.quiet)});
    SELECT to_jsonb(true);`)
})

it('actual PostgREST exported producer creates one durable withdrawal and replays after title edit', async () => {
  const row = currentCase(), decision = await createLifecycleDecisionFromCase(supabaseService, row, null)
  expect(decision).toBeTruthy()
  const stored = proofSql<Record<string, unknown>>(`SELECT to_jsonb(d) FROM public.customer_lifecycle_decisions d WHERE id=${quote(decision!)};`)
  expect(stored).toMatchObject({ source_customer_case_id: f.caseId, company_id: f.company, customer_id: f.customer, decision_type: 'withdrawal', scope_type: 'contract', scope_id: f.contract, billing_blocked: true, received_channel: 'phone', notes: 'Synthetic owned staff note' })
  proofSql(`UPDATE public.customer_cases SET title='Edited current sourced title' WHERE id=${quote(f.caseId)}; SELECT to_jsonb(true);`)
  expect(await createLifecycleDecisionFromCase(supabaseService, currentCase(), null)).toBe(decision)
  expect(proofSql(`SELECT to_jsonb(d) FROM public.customer_lifecycle_decisions d WHERE id=${quote(decision!)};`)).toEqual(stored)
  expect(proofSql(`SELECT to_jsonb(count(*)) FROM public.customer_lifecycle_decisions WHERE source_customer_case_id=${quote(f.caseId)};`)).toBe(1)
  console.log('CUSTOMER_LIFECYCLE_SOURCE_POSTGREST_NATIVE_PASS durable_decision=1 title_not_identity=true quiet_tenant_unchanged=true')
})

it('actual current cancellation cases use cancelled and replay concurrently without duplicate decisions', async () => {
  proofSql(`UPDATE public.customer_cases SET case_type='onboarding_aborted' WHERE id=${quote(f.caseId)}; SELECT to_jsonb(true);`)
  const row = currentCase(), ids = await Promise.all([createLifecycleDecisionFromCase(supabaseService, row, null), createLifecycleDecisionFromCase(supabaseService, row, null)])
  expect(ids[0]).toBeTruthy(); expect(ids[1]).toBe(ids[0])
  expect(proofSql(`SELECT jsonb_build_object('count',count(*),'type',min(decision_type)) FROM public.customer_lifecycle_decisions WHERE source_customer_case_id=${quote(f.caseId)};`)).toEqual({ count: 1, type: 'cancelled' })
  console.log('CUSTOMER_LIFECYCLE_CANCELLED_REPLAY_NATIVE_PASS real_postgrest_concurrent_calls=true decisions=1')
})

it('actual late statement failure preserves existing case, quiet tenant and zero decisions', async () => {
  const before = currentCase()
  proofSql(`CREATE FUNCTION private.${f.fault}() RETURNS trigger LANGUAGE plpgsql AS $fault$ BEGIN
      IF NEW.source_customer_case_id=${quote(f.caseId)}::uuid THEN RAISE EXCEPTION USING ERRCODE='PT500',MESSAGE='owned_lifecycle_native_fault'; END IF; RETURN NEW; END $fault$;
    CREATE TRIGGER ${f.fault} AFTER INSERT ON public.customer_lifecycle_decisions FOR EACH ROW EXECUTE FUNCTION private.${f.fault}(); SELECT to_jsonb(true);`)
  await expect(createLifecycleDecisionFromCase(supabaseService, before, null)).rejects.toMatchObject({ code: 'PT500' })
  expect(currentCase()).toEqual(before)
  expect(proofSql(`SELECT to_jsonb(count(*)) FROM public.customer_lifecycle_decisions WHERE source_customer_case_id=${quote(f.caseId)};`)).toBe(0)
  console.log('CUSTOMER_LIFECYCLE_STATEMENT_ROLLBACK_NATIVE_PASS legacy_whole_graph_atomicity=false')
})
