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
import { enqueueWebhookDeliveriesForEvent } from '@/lib/integrations/webhooks'
import type { DomainEventRow } from '@/lib/events/domainEvents'
import { PARTNER_API_VERSION } from '@/lib/partner-api/openApi'
import { publicOrganizationReference } from '@/lib/integrations/publicReferences'

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
  request_body_hash: string | null; idempotency_key: string; secs_to_next: number | null; target_url: string }
const deliveries = (subId: string) => psqlRows<Delivery>(`select id, company_id, webhook_subscription_id, domain_event_id, event_type, status,
  attempts, max_attempts, next_attempt_at, response_status, public_delivery_id, request_body_hash, idempotency_key, target_url,
  round(extract(epoch from next_attempt_at - now()))::int secs_to_next
  from public.webhook_deliveries where webhook_subscription_id='${subId}' order by created_at`)

const SCOPES = ['partner_webhooks.manage', 'partner_sites.write', 'customer_sites.read']
function verifyGridexSignature(r: Received, secret: string): boolean {
  const body = Buffer.from(r.bodyBase64, 'base64')
  const ts = r.headers['x-gridex-timestamp']
  const expected = `sha256=${createHmac('sha256', secret).update(Buffer.from(`${ts}.`, 'utf8')).update(body).digest('hex')}`
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

  type Subscription = { id: string; company_id: string; api_client_id: string; webhook_subscription_reference: string; name: string; endpoint_url: string;
    event_types: string[]; status: string; signing_algorithm: string; signing_secret_hash: string; metadata: { source?: string } }
  type Site = { id: string; company_id: string; customer_id: string; facility_reference: string; status: string; data_quality_status: string | null }
  type Customer = { id: string; company_id: string; customer_reference: string; customer_number: string | null }
  type Source = { site: Site; customer: Customer; tenantReference: string; event: DomainEventRow }
  const subscriptions = new Map<string, { key: PartnerClient; host: string; name: string; secret: string; reference: string }>()
  const sources = new Map<string, { key: PartnerClient; customerReference: string; source: Source }>()
  function one<T>(rows: T[], label: string): T { expect(rows, `EVENT_HARNESS_PRECONDITION: ${label}`).toHaveLength(1); return rows[0] }
  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('EVENT_HARNESS_PRECONDITION: malformed public object')
    return value as Record<string, unknown>
  }
  function readSubscription(idOrReference: string): Subscription {
    return one(psqlRows<Subscription>(`select id,company_id,api_client_id,webhook_subscription_reference,name,endpoint_url,event_types,status,
      signing_algorithm,signing_secret_hash,metadata from public.webhook_subscriptions where webhook_subscription_reference=${lit(idOrReference)} or id::text=${lit(idOrReference)}`), 'exact subscription')
  }
  async function subscribe(key: PartnerClient, host: string, name: string, secret: string): Promise<string> {
    const endpoint = `https://${host}/hook/${name}`, displayName = `sim ${name}`
    const result = await partner(key, 'POST', 'webhooks/subscriptions', { name: displayName, endpoint_url: endpoint, event_types: ['site.created'], signing_secret: secret, description: 'sim t5' })
    expect(result.status, 'EVENT_HARNESS_PRECONDITION: actual partner subscription create').toBe(201)
    const reference = object(object(result.json).data).webhook_subscription_reference
    expect(typeof reference, 'EVENT_HARNESS_PRECONDITION: subscription public reference').toBe('string'); expect(reference).not.toBe('')
    const row = readSubscription(reference as string)
    expect(row, 'exact subscription client/source identity').toMatchObject({ company_id: key.companyId, api_client_id: key.id, webhook_subscription_reference: reference, name: displayName,
      endpoint_url: endpoint, event_types: ['site.created'], status: 'active', signing_algorithm: 'HMAC-SHA256', signing_secret_hash: sha256(secret), metadata: { source: 'partner_api' } })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    const listed = await partner(key, 'GET', 'webhooks/subscriptions')
    expect(listed.status, 'EVENT_HARNESS_PRECONDITION: same-client subscription read').toBe(200)
    const publicRows = object(object(listed.json).data).subscriptions
    expect(Array.isArray(publicRows)).toBe(true)
    expect((publicRows as Array<Record<string, unknown>>).filter(value => value.webhook_subscription_reference === reference)).toHaveLength(1)
    const visible = (publicRows as Array<Record<string, unknown>>).find(value => value.webhook_subscription_reference === reference)!
    expect(visible).toMatchObject({ name: displayName, endpoint_url: endpoint, event_types: ['site.created'], status: 'active' })
    subscriptions.set(row.id, { key, host, name, secret, reference: reference as string })
    return row.id
  }
  function readSource(key: PartnerClient, customerReference: string, siteReference: string): Source {
    const site = one(psqlRows<Site>(`select id,company_id,customer_id,facility_reference,status,data_quality_status from public.customer_sites where facility_reference=${lit(siteReference)}`), 'exact created site')
    expect(site).toMatchObject({ company_id: key.companyId, facility_reference: siteReference })
    const customer = one(psqlRows<Customer>(`select id,company_id,customer_reference,customer_number from public.customers where id=${lit(site.customer_id)}`), 'exact source customer')
    expect(customer).toMatchObject({ company_id: key.companyId, customer_reference: customerReference })
    const company = one(psqlRows<{ id: string; status: string; external_tenant_reference: string }>(`select id,status,external_tenant_reference from public.companies where id=${lit(key.companyId)}`), 'exact source company')
    expect(company).toMatchObject({ id: key.companyId, status: 'active' }); expect(typeof company.external_tenant_reference).toBe('string'); expect(company.external_tenant_reference.trim()).not.toBe('')
    const event = one(psqlRows<DomainEventRow>(`select * from public.domain_events where aggregate_id=${lit(siteReference)} and aggregate_type='site' and event_type='site.created'`), 'exact originating site event')
    expect(event, 'EVENT_HARNESS_PRECONDITION: originating source identity').toMatchObject({ company_id: key.companyId, event_type: 'site.created', aggregate_type: 'site', aggregate_id: siteReference,
      subject_customer_id: customer.id, source: 'partner_api_resource_trigger_v2' })
    expect(event.payload).toEqual({ site_reference: siteReference, status: site.status, data_quality_status: site.data_quality_status })
    expect(Number.isFinite(Date.parse(event.occurred_at))).toBe(true)
    return { site, customer, tenantReference: company.external_tenant_reference.trim(), event }
  }
  function sourceFor(siteReference: string): Source {
    const original = sources.get(siteReference)
    if (!original) throw new Error('EVENT_HARNESS_PRECONDITION: site has no assigned source')
    const current = readSource(original.key, original.customerReference, siteReference)
    expect(current, 'originating event/source changed').toEqual(original.source)
    return current
  }
  function verifyReceipt(subId: string, siteReference: string, row: Delivery, received: Received) {
    const assigned = subscriptions.get(subId)
    if (!assigned) throw new Error('EVENT_HARNESS_PRECONDITION: subscription not assigned')
    const sub = readSubscription(subId), source = sourceFor(siteReference)
    expect(sub).toMatchObject({ id: subId, company_id: assigned.key.companyId, api_client_id: assigned.key.id, webhook_subscription_reference: assigned.reference, metadata: { source: 'partner_api' } })
    expect(row, 'exact delivery source/subscription identity').toMatchObject({ company_id: source.site.company_id, webhook_subscription_id: subId, domain_event_id: source.event.id,
      event_type: source.event.event_type, target_url: `https://${assigned.host}/hook/${assigned.name}`, idempotency_key: `webhook:${subId}:${source.event.id}` })
    expect(received.host).toBe(assigned.host); expect(received.name).toBe(assigned.name)
    const raw = Buffer.from(received.bodyBase64, 'base64'), bodyHash = sha256(raw)
    expect(received.sha256, 'receiver exact byte hash').toBe(bodyHash)
    expect(row.request_body_hash, 'stored exact byte hash').toBe(bodyHash)
    expect(verifyGridexSignature(received, assigned.secret), 'HMAC over original bytes').toBe(true)
    const body = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))
    const eventId = `event_${sha256(`${source.tenantReference}:event:${source.event.id}`).slice(0, 32)}`
    const organization = publicOrganizationReference(source.tenantReference)
    expect(organization).not.toBeNull()
    const deliveryId = `delivery_${sha256(`${organization}:delivery:${row.id}`).slice(0, 32)}`
    expect(received.headers['x-gridex-event-id'], 'public source event ID').toBe(eventId)
    expect(received.headers['x-gridex-event-type']).toBe(source.event.event_type)
    expect(received.headers['x-gridex-delivery-id']).toBe(deliveryId)
    expect(row.public_delivery_id).toBe(deliveryId)
    expect(body.event_id, 'body source event ID').toBe(eventId); expect(body.event_type).toBe(source.event.event_type)
    expect(body.delivery_id).toBe(deliveryId); expect(body.api_version).toBe(PARTNER_API_VERSION)
    expect(Date.parse(String(body.created_at))).toBe(Date.parse(source.event.occurred_at))
    expect(body.resource, 'exact source resource').toEqual({ type: 'site', reference: siteReference })
    // The site event carries no customer_reference/number in its payload. The
    // public builder derives the customer identity from this exact tenant and
    // subject, rather than exporting the database customer's separate reference.
    expect(body.customer, 'exact source customer').toEqual({
      customer_reference: `customer_${sha256(`${source.tenantReference}:customer:${source.customer.id}`).slice(0, 32)}`,
      customer_number: null,
    })
    expect(body.data).toEqual(source.event.payload)
    const environment = String(source.event.payload.environment ?? '').trim().toLowerCase()
    if (environment === 'test' || environment === 'production') { expect(body.environment).toBe(environment); expect(received.headers['x-gridex-environment']).toBe(environment) }
    else { expect(body.environment).toBeUndefined(); expect(received.headers['x-gridex-environment']).toBeUndefined() }
    expect(Object.keys(body).sort()).toEqual(['api_version','created_at','customer','data','delivery_id','event_id','event_type','resource', ...(environment === 'test' || environment === 'production' ? ['environment'] : [])].sort())
    return { eventId, deliveryId, bodyHash }
  }
  /** Affärshändelse via normal ingång: partner-API POST customer/{ref}/site -> site.created. */
  async function createSite(key: PartnerClient, customerRef: string, n: number) {
    const r = await partner(key, 'POST', `customer/${customerRef}/site`, { address: `Eventvägen ${n}`, zip_code: '12345', city: 'Teststad', country: 'SE', site_electricity_type: 'CONSUMPTION' })
    expect(r.status, brief(r)).toBe(201)
    const siteReference = object(r.json).entity_id
    expect(typeof siteReference).toBe('string'); expect(siteReference).not.toBe('')
    const source = readSource(key, customerRef, siteReference as string)
    sources.set(siteReference as string, { key, customerReference: customerRef, source })
    return siteReference as string
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
    const r = got[0], row = one(deliveries(subA), 'one delivery for assigned subscription')
    expect(row).toMatchObject({ status: 'sent', attempts: 1, response_status: 200 })
    const verified = verifyReceipt(subA, siteRef, row, r)
    eventA = row.domain_event_id
    receipt('EVENT01.01', 'delivery', { eventId: verified.eventId, deliveryId: verified.deliveryId, payloadSha256: verified.bodyHash,
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
    // Exercise the supported own-event enqueue, not only a SQL unique index.
    const assigned = [...sources.values()].find(value => value.source.event.id === eventA)
    if (!assigned) throw new Error('EVENT_HARNESS_PRECONDITION: replay source missing')
    const source = sourceFor(assigned.source.site.facility_reference)
    expect(await enqueueWebhookDeliveriesForEvent(source.event, { strict: true, subscriptionIds: [subA] })).toBe(1)
    expect(deliveries(subA).map(strip)).toEqual(before.map(strip))
    await dispatch()
    const replayReceipts = await received('a1')
    expect(replayReceipts).toHaveLength(1)
    verifyReceipt(subA, source.site.facility_reference, one(deliveries(subA), 'one replay delivery'), replayReceipts[0])
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
    receipt('EVENT01.03', 'replay', { deliveriesForEvent: deliveries(subA).length, receivedCount: (await received('a1')).length, supportedOwnEventEnqueueReplay: true, inboundDuplicate: true })
  })

  it('EVENT01.04 4xx, 5xx och timeout ger föreskriven status, backoff och till sist dead_letter', async () => {
    const keyR = createPartnerClient(A, SCOPES)
    subRetry = await subscribe(keyR, HOST_A, 'retry', `simR-${randomUUID()}-${randomUUID()}`)
    // Kontrollerad fixtur: snabbare timeout och färre försök än standard (partner-API:t exponerar dem inte).
    psql(`update public.webhook_subscriptions set timeout_ms=1000, max_attempts=4 where id='${subRetry}'`)
    // Bara retry-subscriptionen ska få nästa event: pausa övriga i A via DB (dokumenterad fixtur).
    psql(`update public.webhook_subscriptions set status='paused' where company_id='${A}' and id<>'${subRetry}'`)
    await mode('retry', 500)
    const retrySite = await createSite(keyA, custRefA, 2)
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
    for (const post of posts) verifyReceipt(subRetry, retrySite, row, post)
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
    const siteB = await createSite(keyB, custRefB, 3)
    await dispatch()
    const gotB = await received('b1')
    expect(gotB).toHaveLength(1)
    verifyReceipt(subB, siteB, one(deliveries(subB), 'one B delivery'), gotB[0])
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
