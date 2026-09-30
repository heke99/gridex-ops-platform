import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { quote, session, sql, until } from './partner-queue-continuation-20260930-native'

type Receipt = { eventId: string; outcome: string; reason: string | null }
type Event = { id: string; company: string; item: string; guid: string; type: string; state: string; payload: Record<string, unknown> }
function fixture(options: { missingMirror?: boolean; mismatch?: boolean } = {}) {
  const token = randomUUID()
  const tenants = [0,1].map(() => ({ company: randomUUID(), customer: randomUUID(), contract: randomUUID(),
    underlay: randomUUID(), pricing: randomUUID(), run: randomUUID(), item: randomUUID(), invoice: randomUUID(), guid: 'synthetic-' + randomUUID() }))
  const events: Event[] = [
    { id: randomUUID(), company: tenants[0].company, item: tenants[0].item, guid: tenants[0].guid,
      type: 'invoice.overdue', state: 'overdue', payload: { amount_inc_vat: 125, currency: 'SEK' } },
    { id: randomUUID(), company: tenants[0].company, item: tenants[0].item, guid: tenants[0].guid,
      type: 'invoice.paid', state: 'paid', payload: { amount_inc_vat: options.mismatch ? 999 : 125, currency: 'SEK', paid_at: '2026-09-30T10:00:00Z' } },
    { id: randomUUID(), company: tenants[1].company, item: tenants[1].item, guid: tenants[1].guid,
      type: 'invoice.paid', state: 'paid', payload: { amount_inc_vat: 125, currency: 'SEK', paid_at: '2026-09-30T10:00:00Z' } },
  ]
  const companies = tenants.map(t => quote(t.company)).join(',')
  for (const [index,t] of tenants.entries()) {
    // Build an ordinary, non-portfolio canonical graph. The pricing, issued
    // invoice, provider request and automatic legal history remain immutable.
    sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(t.company)},'Synthetic provider ordering','active');
      INSERT INTO public.customers(id,company_id,customer_number,name,customer_type,metadata)
        VALUES(${quote(t.customer)},${quote(t.company)},${quote(t.customer)},'Synthetic provider customer','private','{"synthetic_profile":"unchanged"}');
      INSERT INTO public.customer_contracts(id,company_id,customer_id,status)
        VALUES(${quote(t.contract)},${quote(t.company)},${quote(t.customer)},'draft');
      INSERT INTO public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,status)
        VALUES(${quote(t.underlay)},${quote(t.company)},${quote(t.customer)},${quote(t.contract)},${quote(t.contract)},'pending');
      INSERT INTO public.pricing_runs(id,company_id,billing_underlay_id,customer_id,status,locked_at,total_ex_vat,vat_amount,total_inc_vat)
        VALUES(${quote(t.pricing)},${quote(t.company)},${quote(t.underlay)},${quote(t.customer)},'locked',clock_timestamp(),100,25,125);
      INSERT INTO public.invoice_export_runs(id,company_id,billing_month,environment,financing_mode)
        VALUES(${quote(t.run)},${quote(t.company)},'2026-09','test','invoice_service');
      INSERT INTO public.invoice_export_items(id,company_id,export_run_id,customer_id,customer_contract_id,billing_underlay_id,
        pricing_run_id,status,provider_status,provider_invoice_guid,provider_invoice_id,provider_confirmed_at,
        idempotency_key,provider_request_id,provider_idempotency_key,request_payload,response_payload,
        amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,period_start,period_end)
        VALUES(${quote(t.item)},${quote(t.company)},${quote(t.run)},${quote(t.customer)},${quote(t.contract)},${quote(t.underlay)},
          ${quote(t.pricing)},'sent','unpaid',${quote(t.guid)},${quote(t.guid)},clock_timestamp(),${quote(t.item)},${quote(t.item)},
          ${quote(t.item)},'{"immutable":"original-provider-request"}','{"create_invoice":{"evidence":"original"},"purchase":{"evidence":"original"}}',
          100,25,125,1,'2026-09-01','2026-10-01'); SELECT to_jsonb(true);`)
    if (!(options.missingMirror && index === 0)) sql(`INSERT INTO public.customer_invoices(id,company_id,customer_id,
      contract_id,customer_contract_id,billing_underlay_id,invoice_export_item_id,canonical_export_item_id,status,
      issued_at,due_date,period_start,period_end,amount_ex_vat,vat_amount,amount_inc_vat,total_kwh,source_system,
      raw_payload,calculation_snapshot,calculation_snapshot_sha256)
      VALUES(${quote(t.invoice)},${quote(t.company)},${quote(t.customer)},${quote(t.contract)},${quote(t.contract)},${quote(t.underlay)},
        ${quote(t.item)},${quote(t.item)},'sent','2026-09-01T10:00:00Z','2026-09-21','2026-09-01','2026-10-01',100,25,125,1,
        'capway_aptic','{"create_invoice":{"evidence":"original"},"purchase":{"evidence":"original"}}',
        '{"immutable":"original-calculation"}',${quote('a'.repeat(64))}); SELECT to_jsonb(true);`)
  }
  for (const event of events) sql(`INSERT INTO public.invoice_provider_events(id,company_id,matched_invoice_export_item_id,
    provider,environment,provider_invoice_guid,event_type,payload,status,processing_token,processing_started_at)
    VALUES(${quote(event.id)},${quote(event.company)},${quote(event.item)},'capway_aptic','test',${quote(event.guid)},${quote(event.type)},
      ${quote(JSON.stringify(event.payload))}::jsonb,'processing',${quote(token)},clock_timestamp()); SELECT to_jsonb(true);`)
  const apply = (event: Event, override: { company?: string; token?: string; payload?: Record<string, unknown> } = {}) => {
    const payload = override.payload ?? event.payload
    return `SELECT public.gridex_apply_invoice_provider_event_v1(${quote(override.company ?? event.company)}::uuid,
      ${quote(event.id)}::uuid,${quote(override.token ?? token)}::uuid,${quote(event.type)},${quote(JSON.stringify(payload))}::jsonb,
      ${quote(event.state)},NULL,${Number(payload.amount_inc_vat)},${quote(String(payload.currency))});`
  }
  const snapshot = () => sql<Record<string, Array<Record<string, unknown>> | null>>(`SELECT jsonb_build_object(
    'items',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.invoice_export_items i WHERE company_id IN (${companies})),
    'invoices',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.customer_invoices i WHERE company_id IN (${companies})),
    'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.invoice_provider_events e WHERE company_id IN (${companies})),
    'profiles',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.customers c WHERE company_id IN (${companies})),
    'underlays',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.billing_underlays b WHERE company_id IN (${companies})),
    'domain',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM public.domain_events d WHERE company_id IN (${companies})),
    'outbox',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.event_outbox o WHERE company_id IN (${companies})));`)
  return { tenants, events, companies, apply, snapshot,
    // Retain immutable financial and legal graphs until disposable teardown.
    cleanup: () => sql(`DELETE FROM public.invoice_provider_events WHERE id IN (${events.map(e => quote(e.id)).join(',')}); SELECT to_jsonb(true);`),
  }
}

describe.sequential('native provider current-row atomic application', () => {
  it('two real transactions serialize the paid decision before delayed overdue and keep original financial evidence', async () => {
    const f = fixture(), first = session('provider_paid_first_' + randomUUID()), name = 'provider_old_second_' + randomUUID(), second = session(name)
    try {
      const before = f.snapshot()
      first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${f.apply(f.events[1])}\n\\echo PROVIDER_PAID_HELD\n`)
      await until(() => first.output().stdout.includes('PROVIDER_PAID_HELD'), 'provider_paid_not_held')
      second.child.stdin.end(`SET ROLE service_role; ${f.apply(f.events[0])}`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)}
        AND wait_event_type='Lock'));`), 'provider_old_not_waiting')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.exited, first.output().stderr).toBe(0)
      expect(await second.exited, second.output().stderr).toBe(0)
      const receipt = JSON.parse(second.output().stdout.trim()) as Receipt
      expect(receipt).toMatchObject({ eventId: f.events[0].id, outcome: 'processed', reason: 'stale_provider_state_ignored' })
      const after = f.snapshot()
      const item = after.items!.find(row => row.id === f.tenants[0].item)!
      const invoice = after.invoices!.find(row => row.id === f.tenants[0].invoice)!
      expect(item.provider_status).toBe('paid'); expect(invoice.status).toBe('paid')
      const previousItem = before.items!.find(row => row.id === item.id)!
      const previousInvoice = before.invoices!.find(row => row.id === invoice.id)!
      for (const key of ['company_id','customer_id','customer_contract_id','billing_underlay_id','pricing_run_id',
        'request_payload','response_payload','provider_invoice_guid','provider_request_id','provider_idempotency_key',
        'amount_ex_vat','vat_amount','amount_inc_vat','total_kwh']) expect(item[key],key).toEqual(previousItem[key])
      for (const key of ['company_id','customer_id','contract_id','customer_contract_id','billing_underlay_id','issued_at','due_date',
        'amount_ex_vat','vat_amount','amount_inc_vat','total_kwh','calculation_snapshot','calculation_snapshot_sha256','raw_payload']) {
        expect(invoice[key],key).toEqual(previousInvoice[key])
      }
      expect(after.profiles).toEqual(before.profiles)
      const completed = f.snapshot()
      expect(sql<Receipt>(`SET ROLE service_role; ${f.apply(f.events[1])}`).reason).toBe('provider_event_already_processed')
      expect(f.snapshot()).toEqual(completed)
      const ownKeys = after.domain!.filter(row => String(row.idempotency_key).startsWith('invoice-provider-state:') ||
        String(row.idempotency_key).startsWith('invoice-public-state:'))
      expect(ownKeys).toHaveLength(2)
      expect(after.outbox!.filter(row => ownKeys.some(event => event.id === row.domain_event_id))).toHaveLength(2)
    } finally {
      for (const connection of [first,second]) if (connection.child.exitCode === null) connection.child.kill('SIGTERM')
      await Promise.allSettled([first.exited,second.exited]); f.cleanup()
    }
  })
  it('wrong tenant, stale token, changed snapshot and low roles have zero database effects', () => {
    const f = fixture()
    try {
      const before = f.snapshot(), event = f.events[1]
      for (const role of ['anon','authenticated']) expect(() => sql(`SET ROLE ${role}; ${f.apply(event)}`))
        .toThrow(/permission denied for function gridex_apply_invoice_provider_event_v1/)
      expect(() => sql(`SET ROLE service_role; ${f.apply(event,{ company: f.tenants[1].company })}`)).toThrow(/provider_event_unavailable/)
      expect(() => sql(`SET ROLE service_role; ${f.apply(event,{ token: randomUUID() })}`)).toThrow(/provider_event_claim_unavailable/)
      expect(() => sql(`SET ROLE service_role; ${f.apply(event,{ payload: { ...event.payload,amount_inc_vat: 999 } })}`)).toThrow(/provider_event_snapshot_changed/)
      expect(f.snapshot()).toEqual(before)
    } finally { f.cleanup() }
  })
  it('a drifted export projection cannot regress an explicitly paid canonical invoice', () => {
    const f = fixture()
    try {
      sql(`SET ROLE service_role; UPDATE public.customer_invoices SET status='paid',paid_at='2026-09-29T10:00:00Z'
        WHERE company_id=${quote(f.tenants[0].company)} AND id=${quote(f.tenants[0].invoice)}; SELECT to_jsonb(true);`)
      const before = f.snapshot()
      expect(sql<Receipt>(`SET ROLE service_role; ${f.apply(f.events[0])}`)).toMatchObject({ outcome: 'processed', reason: 'stale_canonical_invoice_state_ignored' })
      const after = f.snapshot()
      for (const key of ['items','invoices','profiles','underlays','domain','outbox']) expect(after[key],key).toEqual(before[key])
    } finally { f.cleanup() }
  })
  it('a late outbox failure rolls all canonical projections, event completion and durable intent back', () => {
    const f = fixture(), fault = 'synthetic_provider_outbox_' + randomUUID().replaceAll('-', '')
    try {
      const before = f.snapshot()
      sql(`CREATE FUNCTION private.${fault}() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN IF NEW.company_id IN (${f.companies}) THEN RAISE EXCEPTION 'synthetic_provider_outbox_fault'; END IF; RETURN NEW; END; $fault$;
        CREATE TRIGGER ${fault} BEFORE INSERT ON public.event_outbox FOR EACH ROW EXECUTE FUNCTION private.${fault}(); SELECT to_jsonb(true);`)
      expect(() => sql(`SET ROLE service_role; ${f.apply(f.events[1])}`)).toThrow(/synthetic_provider_outbox_fault/)
      expect(f.snapshot()).toEqual(before)
    } finally {
      sql(`DROP TRIGGER IF EXISTS ${fault} ON public.event_outbox; DROP FUNCTION IF EXISTS private.${fault}(); SELECT to_jsonb(true);`)
      f.cleanup()
    }
  })
  it('a mismatched first tenant remains reviewable while a second tenant completes independently', () => {
    const f = fixture({ mismatch: true })
    try {
      const before = f.snapshot()
      expect(sql<Receipt>(`SET ROLE service_role; ${f.apply(f.events[1])}`)).toMatchObject({ outcome: 'needs_review', reason: 'provider_amount_or_currency_mismatch' })
      expect(sql<Receipt>(`SET ROLE service_role; ${f.apply(f.events[2])}`)).toMatchObject({ outcome: 'processed', reason: null })
      const after = f.snapshot()
      expect(after.items!.find(row => row.id === f.tenants[0].item)).toEqual(before.items!.find(row => row.id === f.tenants[0].item))
      expect(after.invoices!.find(row => row.id === f.tenants[0].invoice)).toEqual(before.invoices!.find(row => row.id === f.tenants[0].invoice))
      expect(after.invoices!.find(row => row.id === f.tenants[1].invoice)!.status).toBe('paid')
      expect(after.profiles).toEqual(before.profiles)
    } finally { f.cleanup() }
  })
  it('a missing canonical mirror produces review without fabricating financial provenance', () => {
    const f = fixture({ missingMirror: true })
    try {
      const before = f.snapshot()
      expect(sql<Receipt>(`SET ROLE service_role; ${f.apply(f.events[1])}`)).toMatchObject({ outcome: 'needs_review', reason: 'provider_invoice_canonical_snapshot_missing' })
      const after = f.snapshot()
      for (const key of ['items','invoices','profiles','underlays','domain','outbox']) expect(after[key],key).toEqual(before[key])
    } finally { f.cleanup() }
  })
})
