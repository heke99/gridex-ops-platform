import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { generateIntegrationApiToken } from '@/lib/integrations/apiClientSecrets'

const API = 'http://127.0.0.1:54321'
const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql<T>(command: string): T {
  if (process.env.CI !== 'true' || process.env.NEXT_PUBLIC_SUPABASE_URL !== API) throw new Error('disposable_local_only')
  return JSON.parse(execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: command, encoding: 'utf8', timeout: 15_000,
  }).trim()) as T
}
function snapshot(companies: string[]): string {
  const filter = companies.map(quote).join(',')
  return createHash('sha256').update(JSON.stringify(sql(`
    SELECT jsonb_build_object(
      'customer_events', (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.customer_events e WHERE company_id IN (${filter})),
      'domain_events', (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.domain_events e WHERE company_id IN (${filter}))
    );
  `))).digest('hex')
}
type EventRow = { id: string; source_table: string; event_type: string; event_version: number; source: string; occurred_at: string }

it('seeds the actual event read model and verifies unchanged sources after real HTTP reads', async () => {
  const fixturePath = resolve(process.env.GRIDEX_EVENT_V2_FIXTURE_PATH!)
  if (!process.env.RUNNER_TEMP || !fixturePath.startsWith(resolve(process.env.RUNNER_TEMP) + sep)) {
    throw new Error('event_fixture_must_stay_in_runner_temp')
  }
  if (process.env.GRIDEX_EVENT_V2_VERIFY_AFTER_HTTP === '1') {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      companies: string[]; sourceHash: string; customers: Array<{ companyId: string; customerId: string }>
    }
    expect(snapshot(fixture.companies)).toBe(fixture.sourceHash)
    for (const customer of fixture.customers) {
      expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.customer_portal_api_access_logs
        WHERE company_id=${quote(customer.companyId)} AND customer_id=${quote(customer.customerId)}
          AND route='/api/v1/customer/events' AND action='read_events_page';`)).toBeGreaterThan(0)
    }
    console.log('EVENT_V2_HTTP_POST_NATIVE_PASS source_rows_unchanged=true customers=3')
    return
  }

  const companyA = randomUUID(), companyB = randomUUID()
  const customers = [
    { companyId: companyA, customerId: randomUUID(), tag: 'A1' },
    { companyId: companyA, customerId: randomUUID(), tag: 'A2' },
    { companyId: companyB, customerId: randomUUID(), tag: 'B1' },
  ]
  sql(`
    INSERT INTO public.companies(id,name,status) VALUES
      (${quote(companyA)},'Synthetic event HTTP A','active'),(${quote(companyB)},'Synthetic event HTTP B','active');
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES
      ${customers.map(c => `(${quote(c.customerId)},${quote(c.companyId)},${quote(`EV2-${c.tag}-${c.customerId.slice(0, 8)}`)},'Synthetic event customer','private')`).join(',')};
    SELECT to_jsonb(count(*)) FROM public.customers WHERE company_id IN (${quote(companyA)},${quote(companyB)});
  `)
  const issuer = 'https://identity.example.test/disposable-event-v2'
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const jwk = { ...await exportJWK(publicKey), kid: 'disposable-event-v2', alg: 'RS256', use: 'sig' }
  const subjects: Record<string, string> = {}
  for (const customer of customers) {
    const email = `event-v2-${customer.customerId.slice(0, 8)}@example.invalid`
    const user = await supabaseService.auth.admin.createUser({
      email, password: randomBytes(24).toString('base64url'), email_confirm: true,
    })
    if (user.error || !user.data.user) throw user.error ?? new Error('event_fixture_auth_user_missing')
    subjects[customer.tag] = user.data.user.id
    sql(`INSERT INTO public.customer_portal_accounts(company_id,customer_id,user_id,portal_user_id,status,is_active,role,email)
      VALUES(${quote(customer.companyId)},${quote(customer.customerId)},${quote(user.data.user.id)},${quote(user.data.user.id)},'active',true,'owner',${quote(email)});
      SELECT to_jsonb(count(*)) FROM public.customer_portal_accounts WHERE customer_id=${quote(customer.customerId)};`)
  }
  const trust: Record<string, unknown> = {}
  const clients: Array<{ id: string; companyId: string; key: string; tag: string }> = []
  for (const [tag, companyId, scopes] of [
    ['A', companyA, ['customer_events.read']], ['B', companyB, ['customer_events.read']],
    ['noScope', companyA, ['customer_profile.read']],
  ] as const) {
    const id = randomUUID(), receiptId = randomUUID(), key = generateIntegrationApiToken()
    const scopeSql = scopes.map(quote).join(',')
    sql(`
      INSERT INTO public.company_capabilities(company_id,capability_code,enabled,readiness_status)
        VALUES(${quote(companyId)},'api_sales',true,'ready')
        ON CONFLICT(company_id,capability_code) DO UPDATE SET enabled=true,readiness_status='ready';
      INSERT INTO public.integration_api_clients(id,company_id,name,key_prefix,secret_hash,status,scopes,launch_ready,launch_blockers,metadata)
        VALUES(${quote(id)},${quote(companyId)},'Synthetic event HTTP client',${quote(key.keyPrefix)},${quote(key.secretHash)},'active',
          ARRAY[${scopeSql}]::text[],true,'[]'::jsonb,jsonb_build_object('provisioning_receipt_id',${quote(receiptId)}));
      INSERT INTO public.tenant_website_installation_receipts(id,company_id,api_client_id,environment,idempotency_key,state,scopes,receipt_sha256,completed_at)
        VALUES(${quote(receiptId)},${quote(companyId)},${quote(id)},'development',${quote(`synthetic-event-${receiptId}`)},'completed',
          ARRAY[${scopeSql}]::text[],${quote(createHash('sha256').update(receiptId).digest('hex'))},now());
      SELECT to_jsonb(count(*)) FROM public.integration_api_clients WHERE id=${quote(id)};
    `)
    trust[id] = {
      issuer, audience: 'gridex-customer-portal', jwks: { keys: [jwk] },
      bindings: { [issuer]: Object.fromEntries(customers.filter(c => c.companyId === companyId)
        .map(c => [subjects[c.tag], c.customerId])) },
    }
    clients.push({ id, companyId, key: key.token, tag })
  }
  const sign = (client: typeof clients[number], customer: typeof customers[number], action = 'GET /api/v1/customer/events', customerId = customer.customerId) =>
    new SignJWT({ company_id: client.companyId, api_client_id: client.id, customer_id: customerId, action })
      .setProtectedHeader({ alg: 'RS256', kid: 'disposable-event-v2' }).setIssuer(issuer)
      .setAudience('gridex-customer-portal').setSubject(subjects[customer.tag])
      .setIssuedAt().setExpirationTime('15m').sign(privateKey)

  // Remove only synthetic trigger-authored events before the hand-derived timeline.
  const filter = [companyA, companyB].map(quote).join(',')
  const [a1, a2, b1] = customers
  const tieHigh = '00000000-0000-4000-8000-0000000e3302'
  const tieLow = '00000000-0000-4000-8000-0000000e3301'
  sql(`
    DELETE FROM public.customer_events WHERE company_id IN (${filter});
    DELETE FROM public.domain_events WHERE company_id IN (${filter});
    INSERT INTO public.customer_events(id,company_id,customer_id,event_type,source,occurred_at,payload) VALUES
      ('00000000-0000-4000-8000-0000000e3310',${quote(companyA)},${quote(a1.customerId)},'customer.fixture_latest','event-v2-http','2026-09-30 11:00:00+00','{"internal":"must not project"}'),
      (${quote(tieHigh)},${quote(companyA)},${quote(a1.customerId)},'customer.fixture_tie_high','event-v2-http','2026-09-30 10:00:00.123456+00','{}'),
      (${quote(tieLow)},${quote(companyA)},${quote(a1.customerId)},'customer.fixture_tie_low','event-v2-http','2026-09-30 10:00:00.123456+00','{}'),
      ('00000000-0000-4000-8000-0000000e3401',${quote(companyA)},${quote(a2.customerId)},'customer.fixture_other_customer','event-v2-http','2026-09-30 12:00:00+00','{}'),
      ('00000000-0000-4000-8000-0000000e3501',${quote(companyB)},${quote(b1.customerId)},'customer.fixture_other_tenant','event-v2-http','2026-09-30 12:00:00+00','{}');
    INSERT INTO public.domain_events(id,company_id,subject_customer_id,event_type,aggregate_type,aggregate_id,source,event_version,occurred_at,payload) VALUES
      (${quote(tieHigh)},${quote(companyA)},${quote(a1.customerId)},'customer.fixture_tie_high','customer','synthetic-a1','event-v2-http',7,'2026-09-30 10:00:00.123456+00','{"internal":"must not project"}'),
      (${quote(tieLow)},${quote(companyA)},${quote(a1.customerId)},'customer.fixture_tie_low','customer','synthetic-a1','event-v2-http',3,'2026-09-30 10:00:00.123456+00','{}'),
      ('00000000-0000-4000-8000-0000000e3303',${quote(companyA)},${quote(a1.customerId)},'customer.fixture_older','customer','synthetic-a1','event-v2-http',2,'2026-09-30 09:00:00+00','{}'),
      ('00000000-0000-4000-8000-0000000e3304',${quote(companyA)},${quote(a1.customerId)},'customer.fixture_tail','customer','synthetic-a1','event-v2-http',4,'2026-09-30 08:00:00.123456+00','{}'),
      ('00000000-0000-4000-8000-0000000e3305',${quote(companyA)},${quote(a1.customerId)},'customer.fixture_tail','customer','synthetic-a1','event-v2-http',4,'2026-09-30 08:00:00.123456+00','{}'),
      ('00000000-0000-4000-8000-0000000e3402',${quote(companyA)},${quote(a2.customerId)},'customer.fixture_other_customer','customer','synthetic-a2','event-v2-http',9,'2026-09-30 12:00:00+00','{}'),
      ('00000000-0000-4000-8000-0000000e3502',${quote(companyB)},${quote(b1.customerId)},'customer.fixture_other_tenant','customer','synthetic-b1','event-v2-http',11,'2026-09-30 12:00:00+00','{}');
    SELECT to_jsonb(count(*)) FROM public.domain_events WHERE company_id IN (${filter});
  `)
  const savedCustomers = []
  for (const customer of customers) {
    const client = clients.find(c => c.companyId === customer.companyId && c.tag !== 'noScope')!
    const nativeRows = sql<EventRow[]>(`SET ROLE service_role;
      SELECT jsonb_agg(to_jsonb(e)) FROM public.portal_customer_events_page_v2(${quote(customer.companyId)},${quote(customer.customerId)},p_limit=>101) e;
      RESET ROLE;`)
    expect(nativeRows.map(e => e.event_version)).toEqual(customer.tag === 'A1' ? [1, 1, 1, 7, 3, 2, 4, 4] : [1, customer.tag === 'A2' ? 9 : 11])
    if (customer.tag === 'A1') expect(nativeRows.slice(0, 6).map(e => e.id)).toEqual([
      '00000000-0000-4000-8000-0000000e3310', tieHigh, tieLow, tieHigh, tieLow,
      '00000000-0000-4000-8000-0000000e3303',
    ])
    savedCustomers.push({ ...customer, key: client.key, assertion: await sign(client, customer),
      expected: nativeRows.map(({ event_type, event_version, occurred_at, source }) => ({ event_type, event_version, occurred_at, source })) })
  }
  const noScope = clients.find(c => c.tag === 'noScope')!
  const clientA = clients.find(c => c.tag === 'A')!
  writeFileSync(fixturePath, JSON.stringify({
    companies: [companyA, companyB], customers: savedCustomers, trust,
    sourceHash: snapshot([companyA, companyB]),
    wrongActionAssertion: await sign(clientA, a1, 'GET /api/v1/customer/me'),
    wrongCustomerAssertion: await sign(clientA, a1, 'GET /api/v1/customer/events', a2.customerId),
    noScopeKey: noScope.key, noScopeAssertion: await sign(noScope, a1),
  }), { mode: 0o600 })
  console.log('EVENT_V2_HTTP_SEED_NATIVE_PASS customers=3 sources=2 domain_versions=7,3,2,4,9,11')
})
