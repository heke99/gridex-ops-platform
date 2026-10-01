import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { quote, session, sql, until } from './partner-queue-continuation-20260930-native'

type Queue = 'provider_event' | 'tenant_email' | 'approved_invoice_retry'
type Claim = { id: string; company_id: string; status: string; claim_token?: string; lock_token?: string; processing_token?: string }
type Budget = { allowed: boolean; request_count: number; limit_value: number }
const queues: Queue[] = ['provider_event','tenant_email','approved_invoice_retry']
const tables: Record<Queue,string> = { provider_event: 'invoice_provider_events',tenant_email: 'tenant_email_outbox',approved_invoice_retry: 'invoice_export_items' }
function claim(queue: Queue, limit = 20, token = randomUUID(), company: string | null = null) {
  const tenant = company ? quote(company) + '::uuid' : 'NULL::uuid'
  if (queue === 'provider_event') return `SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) FROM
    public.gridex_claim_invoice_provider_events(${tenant},ARRAY['received'],${limit},${quote(token)}::uuid,365) j;`
  if (queue === 'tenant_email') return `SELECT coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) FROM
    public.gridex_claim_tenant_email_outbox_fair_v1(${tenant},${limit},${quote(token)}::uuid) j;`
  return `SELECT coalesce(jsonb_agg(j),'[]'::jsonb) FROM
    public.gridex_claim_approved_invoice_retries_fair_v1(${tenant},${limit},${quote(token)}::uuid) j;`
}
function queueFixture(queue: Queue, noisyCount = 250, quietCount = 1) {
  // This suite must run before other suites leave eligible retry/outbox work.
  // Never rewrite another fixture's queue to satisfy this precondition.
  const eligibility: Record<Queue,string> = {
    provider_event: "company_id IS NOT NULL AND received_at>=clock_timestamp()-interval '365 days' AND (status='received' OR (status='processing' AND processing_started_at<clock_timestamp()-interval '15 minutes'))",
    tenant_email: "status='queued' AND dead_letter_at IS NULL AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp())",
    approved_invoice_retry: "status='failed_retryable' AND next_retry_at<=clock_timestamp() AND metadata#>>'{approval,status}'='approved' AND jsonb_typeof(metadata#>'{approval,approved_by}')='string' AND nullif(btrim(metadata#>>'{approval,approved_by}'),'') IS NOT NULL",
  }
  expect(sql<number>(`SELECT count(*)::int FROM public.${tables[queue]} WHERE ${eligibility[queue]};`)).toBe(0)
  const noisy = randomUUID(), quiet = randomUUID(), companies = [noisy,quiet].map(quote).join(',')
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(noisy)},'Synthetic residual noisy','active'),
    (${quote(quiet)},'Synthetic residual quiet','active'); SELECT to_jsonb(true);`)
  for (const [company,count,age] of [[noisy,noisyCount,2],[quiet,quietCount,1]] as const) {
    if (queue === 'provider_event') sql(`INSERT INTO public.invoice_provider_events(company_id,provider,environment,event_type,received_at)
      SELECT ${quote(company)},'capway_aptic','test','invoice.unpaid',clock_timestamp()-interval '${age} hours'
      FROM generate_series(1,${count}); SELECT to_jsonb(true);`)
    else if (queue === 'tenant_email') sql(`INSERT INTO public.tenant_email_outbox(company_id,email_type,to_email,subject,html_body,created_at)
      SELECT ${quote(company)},'synthetic_claim_only','no-dispatch@example.invalid','Synthetic claim only','Synthetic',
      clock_timestamp()-interval '${age} hours' FROM generate_series(1,${count}); SELECT to_jsonb(true);`)
    else {
      const customer = randomUUID(), contract = randomUUID(), underlay = randomUUID(), pricing = randomUUID(), run = randomUUID()
      // Ordinary canonical, unconfirmed graph. Claiming does not call a sender,
      // approve a document, fabricate an issued invoice or change financial data.
      sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type)
        VALUES(${quote(customer)},${quote(company)},${quote(customer)},'Synthetic retry customer','private');
        INSERT INTO public.customer_contracts(id,company_id,customer_id,status)
        VALUES(${quote(contract)},${quote(company)},${quote(customer)},'draft');
        INSERT INTO public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,status)
        VALUES(${quote(underlay)},${quote(company)},${quote(customer)},${quote(contract)},${quote(contract)},'pending');
        INSERT INTO public.pricing_runs(id,company_id,billing_underlay_id,customer_id,status,locked_at,total_ex_vat,vat_amount,total_inc_vat)
        VALUES(${quote(pricing)},${quote(company)},${quote(underlay)},${quote(customer)},'locked',clock_timestamp(),100,25,125);
        INSERT INTO public.invoice_export_runs(id,company_id,billing_month,environment,financing_mode)
        VALUES(${quote(run)},${quote(company)},'2026-09','test','invoice_service');
        INSERT INTO public.invoice_export_items(company_id,export_run_id,customer_id,customer_contract_id,billing_underlay_id,
          pricing_run_id,status,idempotency_key,next_retry_at,metadata,amount_ex_vat,vat_amount,amount_inc_vat,
          total_kwh,period_start,period_end)
        SELECT ${quote(company)},${quote(run)},${quote(customer)},${quote(contract)},${quote(underlay)},${quote(pricing)},
          'failed_retryable',gen_random_uuid()::text,clock_timestamp()-interval '${age} hours',
          '{"approval":{"status":"approved","approved_by":"synthetic-persisted-business-decision"}}'::jsonb,
          100,25,125,1,'2026-09-01','2026-10-01' FROM generate_series(1,${count}); SELECT to_jsonb(true);`)
    }
  }
  return { noisy,quiet,companies,
    rows: () => sql<Claim[]>(`SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY id),'[]') FROM public.${tables[queue]} q WHERE company_id IN (${companies});`),
    snapshot: () => sql(`SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(q) ORDER BY id) FROM public.${tables[queue]} q WHERE company_id IN (${companies})),
      'turns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY queue_key,company_id) FROM private.partner_dispatch_tenant_turns t WHERE company_id IN (${companies})),
      'leases',(SELECT jsonb_agg(to_jsonb(l) ORDER BY item_id) FROM private.approved_invoice_retry_leases l WHERE company_id IN (${companies})));`),
    // Delete only own unconfirmed/unsent synthetic queue rows and ephemeral
    // leases/turns. Retain companies, automatic legal versions and locked
    // pricing/customer/contract graphs until disposable stack teardown.
    cleanup: () => sql(`DELETE FROM private.approved_invoice_retry_leases WHERE company_id IN (${companies});
      DELETE FROM public.${tables[queue]} WHERE company_id IN (${companies});
      DELETE FROM private.partner_dispatch_tenant_turns WHERE company_id IN (${companies}); SELECT to_jsonb(true);`),
  }
}
function budgetFixture() {
  const noisy = randomUUID(), quiet = randomUUID(), companies = [noisy,quiet].map(quote).join(',')
  const clients = Array.from({ length: 4 },() => randomUUID())
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(noisy)},'Synthetic budget noisy','active'),
    (${quote(quiet)},'Synthetic budget quiet','active');
    INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,rate_limit_per_minute)
    VALUES ${clients.map((id,index) => `(${quote(id)},${quote(index === 3 ? quiet : noisy)},'Synthetic budget only',${quote(id)},${quote(randomUUID())},10)`).join(',')};
    SELECT to_jsonb(true);`)
  const request = (client = clients[0], route = '/synthetic/resource', limit = 10) =>
    `SELECT to_jsonb(r) FROM public.integration_api_rate_limit_check(${quote(client)}::uuid,${quote(route)},${limit},3600) r;`
  return { noisy,quiet,companies,clients,request,
    snapshot: () => sql(`SELECT jsonb_build_object('client',(SELECT jsonb_agg(to_jsonb(b) ORDER BY api_client_id,route,window_started_at)
      FROM public.integration_api_rate_limit_buckets b WHERE company_id IN (${companies})),
      'tenant',(SELECT jsonb_agg(to_jsonb(b) ORDER BY company_id,window_seconds,window_started_at)
      FROM private.integration_api_tenant_budget_buckets b WHERE company_id IN (${companies})));`),
    cleanup: () => sql(`DELETE FROM public.integration_api_rate_limit_buckets WHERE company_id IN (${companies});
      DELETE FROM private.integration_api_tenant_budget_buckets WHERE company_id IN (${companies});
      DELETE FROM private.integration_api_tenant_budget_policies WHERE company_id IN (${companies}); SELECT to_jsonb(true);`),
  }
}

describe.sequential('native residual queues and aggregate tenant request budget', () => {
  for (const queue of queues) {
    it(`${queue}: real fair claim caps noisy work and serves the quiet tenant; stored turns rotate`, () => {
      const f = queueFixture(queue)
      try {
        const before = f.rows(), token = randomUUID()
        const rows = sql<Claim[]>(`SET ROLE service_role; ${claim(queue,20,token)}`)
        expect(rows.filter(row => row.company_id === f.noisy)).toHaveLength(5)
        expect(rows.filter(row => row.company_id === f.quiet)).toHaveLength(1)
        expect(rows.every(row => (row.claim_token ?? row.lock_token ?? row.processing_token) === token)).toBe(true)
        if (queue === 'approved_invoice_retry') expect(f.rows()).toEqual(before)
      } finally { f.cleanup() }
      const rotation = queueFixture(queue)
      try {
        expect(sql<Claim[]>(`SET ROLE service_role; ${claim(queue,1)}`)[0].company_id).toBe(rotation.noisy)
        expect(sql<Claim[]>(`SET ROLE service_role; ${claim(queue,1)}`)[0].company_id).toBe(rotation.quiet)
      } finally { rotation.cleanup() }
    })
    it(`${queue}: low roles and a late tenant-turn fault leave every row and lease unchanged`, () => {
      const f = queueFixture(queue,1), fault = 'synthetic_residual_turn_' + randomUUID().replaceAll('-','')
      try {
        const before = f.snapshot()
        for (const role of ['anon','authenticated']) expect(() => sql(`SET ROLE ${role}; ${claim(queue)}`)).toThrow(/permission denied/)
        sql(`CREATE FUNCTION private.${fault}() RETURNS trigger LANGUAGE plpgsql AS $fault$
          BEGIN IF NEW.company_id IN (${f.companies}) THEN RAISE EXCEPTION 'synthetic_residual_turn_fault'; END IF; RETURN NEW; END; $fault$;
          CREATE TRIGGER ${fault} BEFORE INSERT OR UPDATE ON private.partner_dispatch_tenant_turns
          FOR EACH ROW EXECUTE FUNCTION private.${fault}(); SELECT to_jsonb(true);`)
        expect(() => sql(`SET ROLE service_role; ${claim(queue)}`)).toThrow(/synthetic_residual_turn_fault/)
        expect(f.snapshot()).toEqual(before)
      } finally {
        sql(`DROP TRIGGER IF EXISTS ${fault} ON private.partner_dispatch_tenant_turns;
          DROP FUNCTION IF EXISTS private.${fault}(); SELECT to_jsonb(true);`)
        f.cleanup()
      }
    })
    it(`${queue}: two real transactions return disjoint claims`, async () => {
      const f = queueFixture(queue), first = session('residual_first_' + randomUUID()), name = 'residual_second_' + randomUUID(), second = session(name)
      try {
        first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${claim(queue,1)}\n\\echo RESIDUAL_FIRST_HELD\n`)
        await until(() => first.output().stdout.includes('RESIDUAL_FIRST_HELD'), 'residual_first_not_held')
        const a = JSON.parse(first.output().stdout.split('\n').find(line => line.startsWith('['))!) as Claim[]
        second.child.stdin.end(`SET ROLE service_role; ${claim(queue,1)}`)
        await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)}
          AND wait_event_type='Lock'));`), 'residual_second_not_waiting')
        first.child.stdin.end('COMMIT;\n')
        expect(await first.exited,first.output().stderr).toBe(0); expect(await second.exited,second.output().stderr).toBe(0)
        const b = JSON.parse(second.output().stdout.split('\n').find(line => line.startsWith('['))!) as Claim[]
        expect(a).toHaveLength(1); expect(b).toHaveLength(1); expect(b[0].id).not.toBe(a[0].id)
      } finally {
        for (const connection of [first,second]) if (connection.child.exitCode === null) connection.child.kill('SIGTERM')
        await Promise.allSettled([first.exited,second.exited]); f.cleanup()
      }
    })
  }
  it('approved current-row lease CAS preserves a fresh competitor token and protects exact expiry cutoff', () => {
    const f = queueFixture('approved_invoice_retry',1,0), competingToken = randomUUID(), token = randomUUID()
    try {
      const id = f.rows()[0].id
      sql(`INSERT INTO private.approved_invoice_retry_leases(company_id,item_id,claim_token,claimed_at)
        VALUES(${quote(f.noisy)},${quote(id)},${quote(competingToken)},clock_timestamp()); SELECT to_jsonb(true);`)
      const source = sql<string>(`SELECT to_jsonb(pg_get_functiondef('private.gridex_claim_partner_queue_fair_v1(text,uuid,integer,uuid,text[],integer)'::regprocedure));`)
      const fragment = source.match(/v_lease:=\$fragment\$, leases as \(([\s\S]*?)\n    \)\$fragment\$/)?.[1]
      expect(fragment).toBeTruthy()
      const write = fragment!.replaceAll('$7',quote(token) + '::uuid').replaceAll('$4','clock_timestamp()')
      expect(sql<number>(`SET ROLE service_role; WITH applied AS(SELECT * FROM public.invoice_export_items WHERE id=${quote(id)}),
        leases AS(${write}) SELECT count(*)::int FROM leases;`)).toBe(0)
      expect(sql<string>(`SELECT to_jsonb(claim_token) FROM private.approved_invoice_retry_leases WHERE item_id=${quote(id)};`)).toBe(competingToken)
      expect(sql<Claim[]>(`SET ROLE service_role; ${claim('approved_invoice_retry',1,token)}`)).toEqual([])
      // Evaluate the production write against a bound, exact cutoff rather
      // than a moving clock. This receipt is CAS, not two-session scheduling.
      const cutoffWrite = fragment!.replaceAll('$7',quote(token) + '::uuid').replaceAll('$4',"'2026-09-30T12:00:00Z'::timestamptz")
      sql(`UPDATE private.approved_invoice_retry_leases SET claimed_at='2026-09-30T10:00:00Z' WHERE item_id=${quote(id)}; SELECT to_jsonb(true);`)
      expect(sql<number>(`SET ROLE service_role; WITH applied AS(SELECT * FROM public.invoice_export_items WHERE id=${quote(id)}),
        leases AS(${cutoffWrite}) SELECT count(*)::int FROM leases;`)).toBe(0)
    } finally { f.cleanup() }
  })
  it('three clients and differing resource paths share one finite budget, independent of another tenant', () => {
    const f = budgetFixture()
    try {
      const results = Array.from({ length: 20 },(_,index) => sql<Budget>(`SET ROLE service_role; ${f.request(f.clients[index%3],'/synthetic/invoices/' + randomUUID())}`))
      expect(results.filter(row => row.allowed)).toHaveLength(10)
      expect(results.filter(row => !row.allowed)).toHaveLength(10)
      expect(sql<Budget>(`SET ROLE service_role; ${f.request(f.clients[3])}`).allowed).toBe(true)
      expect(sql<number>(`SELECT request_count::int FROM private.integration_api_tenant_budget_buckets WHERE company_id=${quote(f.noisy)};`)).toBe(20)
    } finally { f.cleanup() }
  })
  it('different clients in two real transactions serialize the shared tenant ceiling', async () => {
    const f = budgetFixture(), first = session('budget_first_' + randomUUID()), name = 'budget_second_' + randomUUID(), second = session(name)
    try {
      sql(`INSERT INTO private.integration_api_tenant_budget_policies VALUES(${quote(f.noisy)},3600,1); SELECT to_jsonb(true);`)
      first.child.stdin.write(`BEGIN; SET LOCAL ROLE service_role; ${f.request()}\n\\echo BUDGET_FIRST_HELD\n`)
      await until(() => first.output().stdout.includes('BUDGET_FIRST_HELD'), 'budget_first_not_held')
      second.child.stdin.end(`SET ROLE service_role; ${f.request(f.clients[1],'/synthetic/different-client')}`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${quote(name)}
        AND wait_event_type='Lock'));`), 'budget_second_not_waiting')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.exited,first.output().stderr).toBe(0); expect(await second.exited,second.output().stderr).toBe(0)
      expect(JSON.parse(first.output().stdout.split('\n').find(line => line.startsWith('{'))!) as Budget).toMatchObject({ allowed: true })
      expect(JSON.parse(second.output().stdout.trim()) as Budget).toMatchObject({ allowed: false,request_count: 2,limit_value: 1 })
      expect(sql<Budget>(`SET ROLE service_role; ${f.request(f.clients[3])}`).allowed).toBe(true)
    } finally {
      for (const connection of [first,second]) if (connection.child.exitCode === null) connection.child.kill('SIGTERM')
      await Promise.allSettled([first.exited,second.exited]); f.cleanup()
    }
  })
  it('revoked, expired, paused-company and low-role requests consume no counter; a late write fault rolls both writes back', () => {
    const f = budgetFixture(), fault = 'synthetic_residual_budget_' + randomUUID().replaceAll('-','')
    try {
      const before = f.snapshot()
      sql(`UPDATE public.integration_api_clients SET revoked_at=clock_timestamp() WHERE id=${quote(f.clients[0])};
        UPDATE public.integration_api_clients SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${quote(f.clients[1])};
        UPDATE public.companies SET status='paused' WHERE id=${quote(f.quiet)}; SELECT to_jsonb(true);`)
      for (const client of [f.clients[0],f.clients[1],f.clients[3]]) expect(() => sql(`SET ROLE service_role; ${f.request(client)}`)).toThrow(/active_api_(client|company)_unavailable/)
      for (const role of ['anon','authenticated']) expect(() => sql(`SET ROLE ${role}; ${f.request(f.clients[2])}`)).toThrow(/permission denied/)
      sql(`CREATE FUNCTION private.${fault}() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN IF NEW.company_id IN (${f.companies}) THEN RAISE EXCEPTION 'synthetic_residual_budget_fault'; END IF; RETURN NEW; END; $fault$;
        CREATE TRIGGER ${fault} BEFORE INSERT ON public.integration_api_rate_limit_buckets FOR EACH ROW EXECUTE FUNCTION private.${fault}(); SELECT to_jsonb(true);`)
      expect(() => sql(`SET ROLE service_role; ${f.request(f.clients[2])}`)).toThrow(/synthetic_residual_budget_fault/)
      expect(f.snapshot()).toEqual(before)
    } finally {
      sql(`DROP TRIGGER IF EXISTS ${fault} ON public.integration_api_rate_limit_buckets;
        DROP FUNCTION IF EXISTS private.${fault}(); SELECT to_jsonb(true);`)
      f.cleanup()
    }
  })
  it('a client that expires during a real PostgreSQL wait cannot retain either counter increment', () => {
    const f = budgetFixture(), fault = 'synthetic_residual_expiry_' + randomUUID().replaceAll('-','')
    try {
      sql(`CREATE FUNCTION private.${fault}() RETURNS trigger LANGUAGE plpgsql AS $fault$
        BEGIN IF NEW.company_id=${quote(f.noisy)} THEN PERFORM pg_sleep(0.3); END IF; RETURN NEW; END; $fault$;
        CREATE TRIGGER ${fault} BEFORE INSERT ON public.integration_api_rate_limit_buckets FOR EACH ROW EXECUTE FUNCTION private.${fault}(); SELECT to_jsonb(true);`)
      const before = f.snapshot()
      const started = Date.now()
      expect(() => sql(`UPDATE public.integration_api_clients SET expires_at=clock_timestamp()+interval '0.2 seconds'
        WHERE id=${quote(f.clients[0])}; SET ROLE service_role; ${f.request()}`)).toThrow(/active_api_client_unavailable/)
      expect(Date.now()-started).toBeGreaterThanOrEqual(250)
      expect(f.snapshot()).toEqual(before)
    } finally {
      sql(`DROP TRIGGER IF EXISTS ${fault} ON public.integration_api_rate_limit_buckets;
        DROP FUNCTION IF EXISTS private.${fault}(); SELECT to_jsonb(true);`)
      f.cleanup()
    }
  })
})
