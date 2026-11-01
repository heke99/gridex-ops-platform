// executionScope: ISOLATED_NATIVE
// masterplan-sim: EVENT01.01-.05
// Spår 5, EVENT01: affärshändelse -> utgående signerad webhook till lokal mottagare, samt signerad inbound-webhook.
// Normala ingångar: partner-API (subscription, kund), /api/internal/webhooks/dispatch (cron-secret), /api/webhooks/resend.
// Nätverkssubstitution: mottagarnamnen pekar på en publik test-IP som DNAT:as lokalt till lib/webhook-receiver.mjs
// (lokal CA via NODE_EXTRA_CA_CERTS). Produktens https-/publik-IP-skydd är oförändrat och prövas i EVENT01.05.
// Kontrollerad klocka: där backoff ska löpa ut sätts next_attempt_at = now() i DB; det är inte verklig väntan.
import { createHmac, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { psql, psqlRows, requireEnv, sim } from '../lib'
import { brief, createPartnerClient, partner, type PartnerClient } from '../lib/partner'
import { createCompany, createCustomer, lit } from '../lib/t5-world'
import { receipt, sha256 } from '../lib/receipts'

const ctrl = () => requireEnv('SIM_RECEIVER_CTRL_URL')
const [HOST_A, HOST_B] = requireEnv('SIM_RECEIVER_HOSTS').split(',')
type Received = { at: string; host: string | null; name: string; headers: Record<string, string>; bodyBase64: string; sha256: string; respondedStatus: number }
async function received(name: string): Promise<Received[]> {
  return (await (await fetch(`${ctrl()}/__requests?name=${encodeURIComponent(name)}`)).json()) as Received[]
}
async function mode(name: string, status: number, delayMs = 0) {
  const r = await fetch(`${ctrl()}/__mode`, { method: 'POST', body: JSON.stringify({ name, status, delayMs }) })
  expect(r.status).toBe(200)
}
async function dispatch(): Promise<{ status: number; text: string }> {
  const res = await fetch(new URL('/api/internal/webhooks/dispatch?limit=50', sim.appUrl), {
    method: 'POST', headers: { authorization: `Bearer ${requireEnv('CRON_SECRET')}` },
  })
  return { status: res.status, text: await res.text() }
}
type Delivery = { id: string; company_id: string; webhook_subscription_id: string; domain_event_id: string; event_type: string; status: string
  attempts: number; max_attempts: number; next_attempt_at: string | null; response_status: number | null; public_delivery_id: string | null
  request_body_hash: string | null; idempotency_key: string; secs_to_next: number | null }
const deliveries = (subId: string) => psqlRows<Delivery>(`select id, company_id, webhook_subscription_id, domain_event_id, event_type, status,
  attempts, max_attempts, next_attempt_at, response_status, public_delivery_id, request_body_hash, idempotency_key,
  round(extract(epoch from next_attempt_at - now()))::int secs_to_next
  from public.webhook_deliveries where webhook_subscription_id='${subId}' order by created_at`)

const SCOPES = ['partner_webhooks.manage', 'partner_sites.write', 'customer_sites.read']
function verifyGridexSignature(r: Received, secret: string): boolean {
  const body = Buffer.from(r.bodyBase64, 'base64').toString('utf8')
  const ts = r.headers['x-gridex-timestamp']
  const expected = `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`
  return r.headers['x-gridex-signature'] === expected
}

describe('EVENT01 webhooks', () => {
  let A: string, B: string
  let keyA: PartnerClient, keyB: PartnerClient
  const secretA = `simA-${randomUUID()}-${randomUUID()}`
  const secretB = `simB-${randomUUID()}-${randomUUID()}`
  let subA = '', subB = '', subRetry = ''
  let eventA = ''
  let custRefA = '', custRefB = ''

  // Subscription skapas som SQL-fixtur efter mönstret i gridex_create_partner_webhook_subscription_v1 (migration
  // 20260816170000): secret i Supabase Vault, signing_secret_ref = vault-id, hash = sha256(secret). Kolumnerna
  // api_client_id/description/metadata saknas i basens schema (fynd 002) och utelämnas; HTTP-vägen ger dessutom 500
  // (fynd 001, steg SETUP). Backendersättning: det som prövas är händelse -> kö -> dispatch -> signerat kvitto.
  async function subscribe(key: PartnerClient, host: string, name: string, secret: string): Promise<string> {
    const id = psql(`with s as (select vault.create_secret(${lit(secret)}, 'gridex_webhook_'||replace(gen_random_uuid()::text,'-',''), 'sim t5') id)
      insert into public.webhook_subscriptions(company_id,name,endpoint_url,event_types,status,signing_algorithm,signing_secret_ref,signing_secret_hash,custom_headers,timeout_ms,max_attempts)
      select '${key.companyId}', ${lit(`sim ${name}`)}, ${lit(`https://${host}/hook/${name}`)}, array['site.created'], 'active', 'HMAC-SHA256', s.id::text,
        encode(extensions.digest(convert_to(${lit(secret)},'utf8'),'sha256'),'hex'), '{}'::jsonb, 10000, 8 from s returning id`)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    return id
  }
  /** Affärshändelse via normal ingång: partner-API POST customer/{ref}/site -> site.created. */
  async function createSite(key: PartnerClient, customerRef: string, n: number) {
    const r = await partner(key, 'POST', `customer/${customerRef}/site`, { address: `Eventvägen ${n}`, zip_code: '12345', city: 'Teststad', country: 'SE', site_electricity_type: 'CONSUMPTION' })
    expect(r.status, brief(r)).toBe(201)
    return String((r.json as { entity_id: string }).entity_id)
  }

  beforeAll(async () => {
    expect((await fetch(`${ctrl()}/__reset`, { method: 'POST' })).status).toBe(200)
    A = createCompany('Sim T5 EVENT bolag A')
    B = createCompany('Sim T5 EVENT bolag B')
    keyA = createPartnerClient(A, SCOPES)
    keyB = createPartnerClient(B, SCOPES)
    // Tenantkonfiguration (sätts annars av plattformen): capability 'webhooks' (canonical_tenant_operation_decision, webhook.deliver) aktiverad för A och B. Utan den blir
    // leveransen blocked_tenant_state/capability_not_ready (observerat i försök 2, korrekt spärr).
    for (const company of [A, B]) {
      psql(`UPDATE public.company_capabilities SET enabled=true, readiness_status='ready' WHERE company_id='${company}' AND capability_code='webhooks';
        INSERT INTO public.company_capabilities(company_id,capability_code,enabled,readiness_status)
        SELECT '${company}','webhooks',true,'ready' WHERE NOT EXISTS (SELECT 1 FROM public.company_capabilities WHERE company_id='${company}' AND capability_code='webhooks');`)
    }
    custRefA = psql(`select customer_reference from public.customers where id='${createCustomer(A, 'EventA')}'`)
    custRefB = psql(`select customer_reference from public.customers where id='${createCustomer(B, 'EventB')}'`)
    // Isolering före dispatch: mottagarnamnen löser upp till test-IP:n och den nås bara via lokal DNAT.
    expect(HOST_A && HOST_B).toBeTruthy()
  }, 120_000)

  it('SETUP webhook-subscription via partner-API POST webhooks/subscriptions (normal väg; fynd 001/002)', async () => {
    const r = await partner(keyA, 'POST', 'webhooks/subscriptions', {
      name: 'sim setup', endpoint_url: `https://${HOST_A}/hook/setup`, event_types: ['site.created'], signing_secret: secretA, description: 'sim t5',
    })
    receipt('SETUP', 'POST webhooks/subscriptions', { status: r.status, bodySha256: sha256(r.text), errorCode: (r.json as { error?: { code?: unknown } } | null)?.error?.code ?? null })
    expect(r.status, brief(r)).toBe(201)
  })

  it('EVENT01.01 affärshändelse ger exakt ett korrekt signerat lokalt kvitto och leveransen blir sent', async () => {
    subA = await subscribe(keyA, HOST_A, 'a1', secretA)
    subB = await subscribe(keyB, HOST_B, 'b1', secretB)
    const siteRef = await createSite(keyA, custRefA, 1)
    const d = await dispatch()
    expect(d.status, d.text.slice(0, 300)).toBe(200)
    const got = await received('a1')
    expect(got, 'mottagna POST till A').toHaveLength(1)
    const r = got[0]
    expect(r.host).toBe(HOST_A)
    expect(verifyGridexSignature(r, secretA), 'HMAC-SHA256 över ts.body med A:s secret').toBe(true)
    const [row] = deliveries(subA)
    expect(row).toMatchObject({ company_id: A, status: 'sent', attempts: 1, response_status: 200, event_type: 'site.created' })
    expect(row.request_body_hash).toBe(r.sha256)
    expect(r.headers['x-gridex-delivery-id']).toBe(row.public_delivery_id)
    expect(r.headers['x-gridex-event-type']).toBe('site.created')
    const body = JSON.parse(Buffer.from(r.bodyBase64, 'base64').toString('utf8')) as Record<string, unknown>
    expect(body.delivery_id).toBe(row.public_delivery_id)
    expect(JSON.stringify(body)).toContain(siteRef)
    eventA = row.domain_event_id
    receipt('EVENT01.01', 'delivery', { eventId: r.headers['x-gridex-event-id'], deliveryId: row.public_delivery_id, payloadSha256: r.sha256,
      requestBodyHash: row.request_body_hash, signatureVerified: true, receivedCount: got.length, status: row.status, attempts: row.attempts, siteRef })
  })

  it('EVENT01.02 fel eller saknad signatur nekas utan effekt; korrekt signatur godtas', async () => {
    const whsec = requireEnv('RESEND_WEBHOOK_SECRET')
    const key = Buffer.from(whsec.replace(/^whsec_/, ''), 'base64')
    const payload = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: `sim-${randomUUID()}` } })
    const id = `msg_sim_${randomUUID()}`
    const ts = String(Math.floor(Date.now() / 1000))
    const good = `v1,${createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64')}`
    const bad = `v1,${createHmac('sha256', Buffer.from('fel-nyckel')).update(`${id}.${ts}.${payload}`).digest('base64')}`
    const post = (headers: Record<string, string>) => fetch(new URL('/api/webhooks/resend', sim.appUrl), {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: payload,
    })
    const count = () => Number(psql(`select count(*) from public.communication_log_events where provider='resend' and provider_event_id='${id}'`))
    const r1 = await post({ 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': bad })
    expect(r1.status, await r1.text()).toBe(401)
    const r2 = await post({ 'svix-id': id, 'svix-timestamp': ts })
    expect(r2.status).toBe(400)
    const r3 = await fetch(new URL('/api/webhooks/resend', sim.appUrl), { method: 'POST', headers: { 'content-type': 'application/json',
      'svix-id': id, 'svix-timestamp': ts, 'svix-signature': good }, body: payload.replace('delivered', 'bounced') })
    expect(r3.status, 'giltig signatur över annan kropp').toBe(401)
    expect(count()).toBe(0)
    const ok = await post({ 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': good })
    expect(ok.status, await ok.text()).toBe(200)
    expect(count()).toBe(1)
    receipt('EVENT01.02', 'inbound resend', { badSignature: r1.status, missingHeaders: r2.status, signatureOverOtherBody: r3.status, valid: ok.status, rowsForId: count() })
    // Mottagarsidans kontroll: A:s kvitto verifieras inte med fel secret.
    const [r] = await received('a1')
    expect(verifyGridexSignature(r, secretB)).toBe(false)
  })

  it('EVENT01.03 replay är idempotent: ny dispatch, omköning och samma inbound-id ger ingen ny effekt', async () => {
    const before = deliveries(subA)
    expect(before).toHaveLength(1)
    const d = await dispatch()
    expect(d.status).toBe(200)
    expect(await received('a1')).toHaveLength(1)
    const strip = (x: Delivery) => ({ ...x, secs_to_next: null })
    expect(deliveries(subA).map(strip)).toEqual(before.map(strip))
    // Unikvillkoret på idempotency_key (webhook:<sub>:<event>) prövas direkt i DB: en andra rad för samma (sub, event)
    // kan inte skapas. (enqueueWebhookDeliveriesForEvent använder samma nyckel med upsert ignoreDuplicates.)
    const dup = psql(`insert into public.webhook_deliveries(company_id,webhook_subscription_id,domain_event_id,event_type,status,attempts,max_attempts,payload,target_url,idempotency_key)
      select company_id,webhook_subscription_id,domain_event_id,event_type,'queued',0,max_attempts,payload,target_url,idempotency_key from public.webhook_deliveries where id='${before[0].id}'
      on conflict do nothing returning id`)
    expect(dup, 'dubblett av samma (sub, event) får inte skapas').toBe('')
    await dispatch()
    expect(await received('a1')).toHaveLength(1)
    // Inbound: samma svix-id och signatur igen är en dubblett utan ny rad.
    const whsec = requireEnv('RESEND_WEBHOOK_SECRET')
    const key = Buffer.from(whsec.replace(/^whsec_/, ''), 'base64')
    const payload = JSON.stringify({ type: 'email.delivered', created_at: new Date().toISOString(), data: { email_id: `sim-${randomUUID()}` } })
    const id = `msg_sim_${randomUUID()}`
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = `v1,${createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64')}`
    const send = () => fetch(new URL('/api/webhooks/resend', sim.appUrl), { method: 'POST', headers: { 'content-type': 'application/json',
      'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig }, body: payload })
    const first = await send(); expect(first.status).toBe(200); await first.text()
    const second = await send(); expect(second.status).toBe(200)
    expect(((await second.json()) as { duplicate?: boolean }).duplicate).toBe(true)
    expect(Number(psql(`select count(*) from public.communication_log_events where provider='resend' and provider_event_id='${id}'`))).toBe(1)
    receipt('EVENT01.03', 'replay', { deliveriesForEvent: deliveries(subA).length, receivedCount: (await received('a1')).length, duplicateInsertRejected: dup === '', inboundDuplicate: true })
  })

  it('EVENT01.04 4xx, 5xx och timeout ger föreskriven status, backoff och till sist dead_letter', async () => {
    const keyR = createPartnerClient(A, SCOPES)
    subRetry = await subscribe(keyR, HOST_A, 'retry', `simR-${randomUUID()}-${randomUUID()}`)
    // Kontrollerad fixtur: snabbare timeout och färre försök än standard (partner-API:t exponerar dem inte).
    psql(`update public.webhook_subscriptions set timeout_ms=1000, max_attempts=4 where id='${subRetry}'`)
    // Bara retry-subscriptionen ska få nästa event: pausa övriga i A via DB (dokumenterad fixtur).
    psql(`update public.webhook_subscriptions set status='paused' where company_id='${A}' and id<>'${subRetry}'`)
    await mode('retry', 500)
    await createSite(keyA, custRefA, 2)
    await dispatch()
    let [row] = deliveries(subRetry)
    expect(row).toMatchObject({ status: 'failed', attempts: 1, response_status: 500, max_attempts: 4 })
    expect(row.secs_to_next).toBeGreaterThan(240); expect(row.secs_to_next).toBeLessThanOrEqual(300)

    const expireBackoff = () => psql(`update public.webhook_deliveries set next_attempt_at=now() where id='${row.id}'`)
    await dispatch()
    expect(deliveries(subRetry)[0].attempts, 'ingen ny attempt före backoff').toBe(1)

    await mode('retry', 404); expireBackoff(); await dispatch()
    ;[row] = deliveries(subRetry)
    expect(row).toMatchObject({ status: 'failed', attempts: 2, response_status: 404 })
    expect(row.secs_to_next).toBeGreaterThan(1700); expect(row.secs_to_next).toBeLessThanOrEqual(1800)

    await mode('retry', 200, 3000); expireBackoff(); await dispatch()
    ;[row] = deliveries(subRetry)
    expect(row).toMatchObject({ status: 'failed', attempts: 3 })
    expect(row.response_status, 'timeout har ingen HTTP-status').toBeNull()
    expect(row.secs_to_next).toBeGreaterThan(7100); expect(row.secs_to_next).toBeLessThanOrEqual(7200)

    await mode('retry', 503); expireBackoff(); await dispatch()
    ;[row] = deliveries(subRetry)
    expect(row).toMatchObject({ status: 'dead_letter', attempts: 4, response_status: 503 })
    await new Promise((r) => setTimeout(r, 3500))
    const posts = await received('retry')
    expect(posts.length, 'en POST per försök').toBe(4)
    const ids = new Set(posts.map((p) => p.headers['x-gridex-delivery-id']))
    expect(ids.size, 'samma leverans-ID över alla försök').toBe(1)
    const health = psqlRows<{ failure_count: number; last_failure_at: string | null }>(
      `select failure_count, (to_jsonb(s)->>'last_failure_at') last_failure_at from public.webhook_subscriptions s where id='${subRetry}'`)[0]
    receipt('EVENT01.04', 'retry', { deliveryId: [...ids][0], attempts: row.attempts, finalStatus: row.status, posts: posts.map((p) => p.respondedStatus), health })
    psql(`update public.webhook_subscriptions set status='active' where company_id='${A}' and id<>'${subRetry}' and status='paused'`)
    // Föreskriven status omfattar subscriptionens hälsa (webhooks.ts updateSubscriptionFailure): fyra fel ger failure_count 4.
    expect(health.failure_count, 'failure_count efter 4 misslyckade försök (fynd 002)').toBe(4)
    expect(health.last_failure_at, 'last_failure_at (fynd 002)').not.toBeNull()
  })

  it('EVENT01.05 tenant och hemligheter: B får bara egna händelser, ingen klartext-secret, privat mål nekas', async () => {
    expect(await received('b1'), 'A:s händelse får inte nå B').toHaveLength(0)
    await createSite(keyB, custRefB, 3)
    await dispatch()
    const gotB = await received('b1')
    expect(gotB).toHaveLength(1)
    expect(verifyGridexSignature(gotB[0], secretB)).toBe(true)
    expect(verifyGridexSignature(gotB[0], secretA)).toBe(false)
    expect(deliveries(subB).every((d) => d.company_id === B)).toBe(true)
    expect(deliveries(subA).every((d) => d.company_id === A)).toBe(true)
    expect(Number(psql(`select count(*) from public.webhook_deliveries where webhook_subscription_id='${subB}' and domain_event_id='${eventA}'`))).toBe(0)

    for (const [secret, sub] of [[secretA, subA], [secretB, subB]] as const) {
      expect(psql(`select count(*) from public.webhook_subscriptions s where s.id='${sub}' and (row_to_json(s)::text like '%${secret}%')`)).toBe('0')
      expect(psql(`select count(*) from public.webhook_deliveries d where d.webhook_subscription_id='${sub}' and (row_to_json(d)::text like '%${secret}%')`)).toBe('0')
    }
    for (const r of [...await received('a1'), ...gotB]) {
      const raw = Buffer.from(r.bodyBase64, 'base64').toString('utf8') + JSON.stringify(r.headers)
      expect(raw.includes(secretA) || raw.includes(secretB), 'secret i mottagen kropp/headers').toBe(false)
    }
    // B:s nyckel kan inte se A:s kund, och produktens SSRF-skydd står kvar: privat/loopback-mål nekas.
    const loop = await partner(keyB, 'POST', 'webhooks/subscriptions', { name: 'sim loop', endpoint_url: 'https://127.0.0.1/hook/x',
      event_types: ['site.created'], signing_secret: secretB, description: 'sim' })
    expect(loop.status, brief(loop)).toBe(422)
    expect(loop.text).toContain('webhook_target_not_public')
    const http = await partner(keyB, 'POST', 'webhooks/subscriptions', { name: 'sim http', endpoint_url: `http://${HOST_B}/hook/x`,
      event_types: ['site.created'], signing_secret: secretB, description: 'sim' })
    expect(http.status, brief(http)).toBe(422)
    expect(http.text).toMatch(/webhook_target_not_public|webhook_https_required/)
    receipt('EVENT01.05', 'tenant+secrets', { receivedB: gotB.length, deliveriesB: deliveries(subB).length, loopback: loop.status, plainHttp: http.status })
  })
})
