import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
// Only the Next import marker changes. Real emitter, local PostgREST and the
// exact migration execute; no provider transport/template is called or mocked.
vi.mock('server-only', () => ({}))
import { emitCustomerOperationEvent } from '@/lib/customers/customerOperationEvents'
import { proofSql, quote } from './customer-read-proof-native'

const API = 'http://127.0.0.1:54321'
const service = createClient(API, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const anonymous = createClient(API, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
const actualFetch = globalThis.fetch
const fixtureCompanies: string[] = []
let forbiddenFetches = 0
beforeAll(() => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== API) { forbiddenFetches++; throw new Error('lifecycle_atomic_external_delivery_forbidden') }
    return actualFetch(input, init)
  }) as typeof fetch
})
afterAll(() => {
  globalThis.fetch = actualFetch
  // Hold only these disposable fixture intents. This is fixture cleanup, not
  // an assertion that the application sent or completed a notification.
  if (fixtureCompanies.length) proofSql(`UPDATE public.customer_operation_jobs SET status='cancelled',locked_at=NULL,locked_by=NULL,lock_token=NULL
    WHERE company_id IN (${fixtureCompanies.map(quote).join(',')}) AND job_type='dispatch_lifecycle_notification'
      AND status IN('queued','running','waiting_response'); SELECT to_jsonb(true);`)
})
function fixture() {
  const f = { company: randomUUID(), customer: randomUUID(), sibling: randomUUID(), site: randomUUID(), otherSite: randomUUID(),
    point: randomUUID(), otherPoint: randomUUID(), contract: randomUUID(), otherContract: randomUUID(), operation: randomUUID(), key: `lifecycle-atomic-${randomUUID()}` }
  fixtureCompanies.push(f.company)
  proofSql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(f.company)},'Synthetic atomic lifecycle','active');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES
      (${quote(f.customer)},${quote(f.company)},${quote(f.customer)},'Synthetic own customer','private'),
      (${quote(f.sibling)},${quote(f.company)},${quote(f.sibling)},'Synthetic sibling customer','private');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,status,street,postal_code,city,country) VALUES
      (${quote(f.site)},${quote(f.company)},${quote(f.customer)},'Synthetic own site','draft','Testgatan 1','12345','Teststad','SE'),
      (${quote(f.otherSite)},${quote(f.company)},${quote(f.sibling)},'Synthetic sibling site','draft','Testgatan 2','12345','Teststad','SE');
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,status) VALUES
      (${quote(f.point)},${quote(f.company)},${quote(f.customer)},${quote(f.site)},${quote(f.site)},'draft'),
      (${quote(f.otherPoint)},${quote(f.company)},${quote(f.sibling)},${quote(f.otherSite)},${quote(f.otherSite)},'draft');
    INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,status) VALUES
      (${quote(f.contract)},${quote(f.company)},${quote(f.customer)},${quote(f.site)},${quote(f.site)},${quote(f.point)},'draft'),
      (${quote(f.otherContract)},${quote(f.company)},${quote(f.sibling)},${quote(f.otherSite)},${quote(f.otherSite)},${quote(f.otherPoint)},'draft');
    SELECT to_jsonb(true);`)
  return f
}
type Fixture = ReturnType<typeof fixture>
function input(f: Fixture) {
  return { companyId: f.company, customerId: f.customer, customerSiteId: f.site, meteringPointId: f.point,
    operationId: f.operation,
    eventType: 'supplier_switch.requested', title: 'Approved switch prepared', message: 'Unsent intent only',
    idempotencyKey: f.key, payload: { contract_id: f.contract, marker: 'approved' } }
}
function command(f: Fixture) {
  return { company_id: f.company, customer_id: f.customer, customer_site_id: f.site, metering_point_id: f.point,
    contract_id: f.contract, customer_operation_job_id: null, operation_id: f.operation, actor_user_id: null,
    aggregate_type: 'customer_site', aggregate_id: f.site, event_code: 'supplier_switch.requested',
    title: 'Approved switch prepared', message: 'Unsent intent only', status: 'waiting_response', severity: 'info',
    action_required: false, action_url: null, source: 'customer_operations', visibility: 'tenant',
    payload: input(f).payload, idempotency_key: f.key, source_event_id: f.key, notification_template: 'switch.started' }
}
type EffectRow = Record<string, unknown>
type EffectState = Record<'timeline' | 'domain' | 'fanout' | 'intents', EffectRow[]> &
  Record<'communication' | 'emailOutbox' | 'webhookDeliveries' | 'switchRequests' | 'edielMessages', number>
function effects(f: Fixture) {
  return proofSql<EffectState>(`SELECT jsonb_build_object(
    'timeline',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.customer_operation_events t WHERE company_id=${quote(f.company)}),
    'domain',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.domain_events t WHERE company_id=${quote(f.company)}),
    'fanout',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.event_outbox t WHERE company_id=${quote(f.company)}),
    'intents',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.customer_operation_jobs t WHERE company_id=${quote(f.company)} AND job_type='dispatch_lifecycle_notification'),
    'communication',(SELECT count(*) FROM public.communication_logs WHERE company_id=${quote(f.company)}),
    'emailOutbox',(SELECT count(*) FROM public.tenant_email_outbox WHERE company_id=${quote(f.company)}),
    'webhookDeliveries',(SELECT count(*) FROM public.webhook_deliveries WHERE company_id=${quote(f.company)}),
    'switchRequests',(SELECT count(*) FROM public.supplier_switch_requests WHERE company_id=${quote(f.company)}),
    'edielMessages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${quote(f.company)}));`)
}
// BEGIN_LIFECYCLE_PACKAGE_ASSERTION
function assertApprovedPackage(f: Pick<Fixture, 'company' | 'customer' | 'site' | 'point' | 'contract' | 'operation' | 'key'>,
  baseline: EffectState, saved: EffectState) {
  const selected = {} as Record<'timeline' | 'domain' | 'fanout' | 'intents', EffectRow>
  for (const key of ['timeline', 'domain', 'fanout', 'intents'] as const) {
    const ids = new Set(baseline[key].map(row => row.id))
    assert.deepEqual(saved[key].filter(row => ids.has(row.id)), baseline[key], `lifecycle_baseline_preserved:${key}`)
    const delta = saved[key].filter(row => !ids.has(row.id))
    assert.equal(delta.length, 1, `lifecycle_delta_count:${key}`)
    selected[key] = delta[0]
  }
  function bound(key: keyof typeof selected, expected: EffectRow) {
    assert.deepEqual(Object.fromEntries(Object.keys(expected).map(name => [name, selected[key][name]])),
      expected, `lifecycle_binding:${key}`)
  }
  const payload = { contract_id: f.contract, marker: 'approved' }
  bound('timeline', { company_id: f.company, customer_id: f.customer, customer_site_id: f.site, metering_point_id: f.point,
    customer_operation_job_id: null, operation_id: f.operation, event_code: 'supplier_switch.requested', source: 'customer_operations',
    idempotency_key: f.key, payload: { ...payload, operation_id: f.operation } })
  bound('domain', { company_id: f.company, subject_customer_id: f.customer, aggregate_type: 'customer_site', aggregate_id: f.site,
    event_type: 'supplier_switch.requested', source: 'customer_operations', idempotency_key: f.key,
    payload: { title: 'Approved switch prepared', message: 'Unsent intent only', operation_id: f.operation, ...payload } })
  bound('fanout', { company_id: f.company, domain_event_id: selected.domain.id, destination_type: 'webhook',
    destination_key: 'webhook_fanout_v1', status: 'queued', attempts: 0, sent_at: null,
    payload: { event_type: 'supplier_switch.requested', aggregate_type: 'customer_site', aggregate_id: f.site } })
  bound('intents', { company_id: f.company, customer_id: f.customer, customer_site_id: f.site, metering_point_id: f.point,
    job_type: 'dispatch_lifecycle_notification', status: 'queued', attempts: 0,
    idempotency_key: `lifecycle_notification:${f.key}:switch.started`, request_snapshot: payload,
    payload: { event_type: 'supplier_switch.requested', source_event_id: f.key, contract_id: f.contract, payload } })
  for (const key of ['communication', 'emailOutbox', 'webhookDeliveries', 'switchRequests', 'edielMessages'] as const) {
    assert.equal(saved[key], baseline[key], `lifecycle_side_effect_unchanged:${key}`)
  }
  return selected
}
// END_LIFECYCLE_PACKAGE_ASSERTION
function unsent(state: Record<string, unknown>) {
  expect(state).toMatchObject({ communication: 0, emailOutbox: 0, webhookDeliveries: 0, switchRequests: 0, edielMessages: 0 })
  expect(forbiddenFetches).toBe(0)
}

describe.sequential('actual lifecycle emitter -> atomic local transaction', () => {
  it('commits one real event package and replays completed intent without independent fanout or sender calls', async () => {
    const f = fixture()
    const baseline = effects(f)
    await emitCustomerOperationEvent(input(f))
    const state = effects(f)
    const selected = assertApprovedPackage(f, baseline, state)
    expect(selected.intents).toEqual(expect.objectContaining({ status: 'queued', attempts: 0,
      customer_id: f.customer, customer_site_id: f.site, metering_point_id: f.point,
      idempotency_key: `lifecycle_notification:${f.key}:switch.started` }))
    expect(selected.fanout).toEqual(expect.objectContaining({ status: 'queued', attempts: 0, sent_at: null }))
    unsent(state)
    proofSql(`UPDATE public.customer_operation_jobs SET status='completed',completed_at=clock_timestamp(),result='{"synthetic_terminal_fixture":true}'
      WHERE company_id=${quote(f.company)} AND job_type='dispatch_lifecycle_notification'
        AND idempotency_key=${quote(`lifecycle_notification:${f.key}:switch.started`)}; SELECT to_jsonb(true);`)
    const before = effects(f)
    await emitCustomerOperationEvent(input(f))
    expect(effects(f)).toEqual(before); unsent(before)
    console.log('CUSTOMER_LIFECYCLE_ATOMIC_NATIVE_PASS actual_emitter_rpc=true timeline=1 domain=1 fanout_intent=1 notification_intent=1 terminal_replay_preserved=true external_delivery=0')
  })

  it('rolls back domain/outbox/timeline on a genuine late-intent trigger failure and clean retry commits once', async () => {
    const f = fixture(), suffix = randomUUID().replaceAll('-', ''), name = `proof_lifecycle_fault_${suffix}`
    proofSql(`CREATE FUNCTION private.${name}() RETURNS trigger LANGUAGE plpgsql AS $proof$ BEGIN
      IF NEW.company_id=${quote(f.company)}::uuid AND NEW.job_type='dispatch_lifecycle_notification' THEN
        RAISE EXCEPTION 'synthetic_lifecycle_late_intent_fault' USING ERRCODE='P0001'; END IF; RETURN NEW; END $proof$;
      CREATE TRIGGER ${name} BEFORE INSERT ON public.customer_operation_jobs FOR EACH ROW EXECUTE FUNCTION private.${name}(); SELECT to_jsonb(true);`)
    const before = effects(f)
    try {
      await expect(emitCustomerOperationEvent(input(f))).rejects.toMatchObject({ code: 'P0001', message: 'synthetic_lifecycle_late_intent_fault' })
      expect(effects(f)).toEqual(before); unsent(before)
    } finally { proofSql(`DROP TRIGGER ${name} ON public.customer_operation_jobs; DROP FUNCTION private.${name}(); SELECT to_jsonb(true);`) }
    await emitCustomerOperationEvent(input(f))
    const committed = effects(f)
    assertApprovedPackage(f, before, committed)
    unsent(committed)
    console.log('CUSTOMER_LIFECYCLE_ATOMIC_ROLLBACK_NATIVE_PASS late_required_intent_fault=true prior_effects_rolled_back=true clean_retry=1 external_delivery=0')
  })

  it('concurrent real Data API calls create exactly one permanent receipt and three current replays', async () => {
    const f = fixture()
    const baseline = effects(f)
    const results = await Promise.all(Array.from({ length: 4 }, () => service.rpc('gridex_record_customer_operation_event_v1', { p_event: command(f) })))
    for (const result of results) expect(result.error).toBeNull()
    const receipts = results.map(result => result.data as { replayed: boolean; operationEventId: string; domainEventId: string; notificationJobId: string })
    expect(receipts.filter(row => !row.replayed)).toHaveLength(1)
    for (const property of ['operationEventId','domainEventId','notificationJobId'] as const) expect(new Set(receipts.map(row => row[property])).size).toBe(1)
    const state = effects(f)
    const selected = assertApprovedPackage(f, baseline, state)
    expect(selected.timeline.id).toBe(receipts[0].operationEventId)
    expect(selected.domain.id).toBe(receipts[0].domainEventId)
    expect(selected.intents.id).toBe(receipts[0].notificationJobId)
    unsent(state)
    console.log('CUSTOMER_LIFECYCLE_ATOMIC_CONCURRENCY_NATIVE_PASS actual_postgrest_parallel=4 fresh=1 replay=3 event_and_intent_duplicates=0 external_delivery=0')
  })

  it('preserves a real site-owned supplier parent whose point is selected at continuation time', async () => {
    const f = fixture(), parent = randomUUID(), operation = randomUUID()
    proofSql(`INSERT INTO public.customer_operation_jobs(id,company_id,customer_id,customer_site_id,job_type,status,idempotency_key,operation_id)
      VALUES(${quote(parent)},${quote(f.company)},${quote(f.customer)},${quote(f.site)},'start_supplier_switch','completed',${quote(`${f.key}:parent`)},${quote(operation)});
      SELECT to_jsonb(true);`)
    await emitCustomerOperationEvent({ ...input(f), customerOperationJobId: parent, operationId: operation })
    const before = effects(f)
    expect(before.timeline).toEqual([expect.objectContaining({ customer_operation_job_id: parent, operation_id: operation })])
    expect(before.intents).toHaveLength(1); unsent(before)
    await emitCustomerOperationEvent({ ...input(f), customerOperationJobId: parent, operationId: operation })
    expect(effects(f)).toEqual(before)
    console.log('CUSTOMER_LIFECYCLE_PARENT_CONTINUATION_NATIVE_PASS site_owned_parent=true initially_unbound_point_allowed=true verified_selected_graph=true exact_replay=true external_delivery=0')
  })

  it('current graph and exact intent are rechecked before replay; anon and authenticated cannot call directly', async () => {
    const f = fixture()
    await emitCustomerOperationEvent(input(f))
    const before = effects(f)
    await expect(emitCustomerOperationEvent({ ...input(f), payload: { contract_id: f.contract, marker: 'changed' } })).rejects.toMatchObject({ code: '23505', message: 'lifecycle_event_idempotency_conflict' })
    expect(effects(f)).toEqual(before)
    for (const patch of [{ customer_site_id: f.otherSite },{ metering_point_id: f.otherPoint },{ contract_id: f.otherContract }]) {
      const denied = await service.rpc('gridex_record_customer_operation_event_v1', { p_event: { ...command(f), ...patch } })
      expect(denied.error?.code).toBe('23503'); expect(effects(f)).toEqual(before)
    }
    const unscoped = await service.rpc('gridex_record_customer_operation_event_v1', { p_event: {
      ...command(f), aggregate_type: 'unscoped_custom_resource', aggregate_id: f.otherContract,
    } })
    expect(unscoped.error?.code).toBe('22023'); expect(effects(f)).toEqual(before)
    const anonymousDenied = await anonymous.rpc('gridex_record_customer_operation_event_v1', { p_event: command(f) })
    expect(anonymousDenied.error?.code).toBe('42501')
    proofSql(`DO $proof$ BEGIN BEGIN SET LOCAL ROLE authenticated;
      PERFORM public.gridex_record_customer_operation_event_v1(${quote(JSON.stringify(command(f)))}::jsonb);
      RAISE EXCEPTION 'expected_lifecycle_low_role_denial';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $proof$; SELECT to_jsonb(true);`)
    expect(effects(f)).toEqual(before); unsent(before)
    console.log('CUSTOMER_LIFECYCLE_ATOMIC_AUTHORITY_NATIVE_PASS current_graph_before_replay=true changed_payload=conflict sibling_resources=denied low_roles=denied persisted_event_package_unchanged=true external_delivery=0')
  })
})
