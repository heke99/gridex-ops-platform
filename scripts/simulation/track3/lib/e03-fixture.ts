// EDIEL03-hjälpare: skapar en inkommande syntetisk UTILTS E66-källa och låter KODENS EGEN väg
// (createInboundEdielMessage -> processInboundEdielMessage) bygga teknisk CONTRL, outbox-rad och ACK-timers.
// Ersättningssteg (dokumenterat): raden i inbound_email_messages läggs med SQL (inte via IMAP-poll), eftersom appens
// poller inte kan slutföra mottagning utan aktör och fastnar i ImapFlow-bakåttrycket (README, kandidatfynd 1-2).
// Mönster: scripts/ediel-tr-05-recovery-native.test.ts receiveAck() och scripts/helpers/utiltsConsumptionParties.ts
// receiveUtiltsRetry() på 1c0c088c (raw-insert av inbound_email_messages + createParseResult + createInboundEdielMessage).
import { randomUUID } from 'node:crypto'
import { buildUtiltsE66 } from './edifact'
import { lit, sql, sqlJson } from './seed.mjs'

export type E03Source = {
  prefix: string; seq: number; companyId: string; sourceMessageId: string; inboundEmailMessageId: string
  receivedAt: string; raw: string; outboxId: string | null; ackMessageId: string | null
  timers: Array<Record<string, unknown>>
}
export const mode = () => ((process.env.T3_MODE as 'test' | 'production') ?? 'test')
export const actor = () => process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!

export const E03_OWN_ID = process.env.T3_E03_OWN_ID ?? '16703'
export const E03_COMPANY_NAME = 'T3SIM E03 Supplier AB'
export function companyId(): string {
  return sql(`SELECT id FROM public.companies WHERE name=${lit(E03_COMPANY_NAME)} LIMIT 1`)
}
let tenantReady = false
/**
 * Egen tenant för EDIEL03 (Ediel-ID 16703). Ursprung: scripts/simulation/track3/lib/e01-fixture.ts seedE01Tenant() i worktree
 * wt-e01 (adapterad: namn, ID, och ediel_ack-profilen får application_reference '23-DDQ-E66-T direkt, så basprofilen rörs inte).
 * Skäl (prestandaobservation): ackskapandet (ediel_create_outbound_ack_atomic_v1, gridex_read_outbound_acks_for_source_v2)
 * läser alla utgående CONTRL i bolaget och tog 2-8 s mot PostgREST statement_timeout=8s i basbolaget med ~37+ CONTRL. Idempotent.
 */
export function seedE03Tenant(): string {
  const actorUserId = actor()
  const ensure = (table: string, where: string, insert: Record<string, unknown>, rawCols: string[] = []): string => {
    const found = sql(`SELECT id FROM ${table} WHERE ${where} LIMIT 1`)
    if (found) return found
    const cols = Object.keys(insert)
    return sql(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map((c) => (rawCols.includes(c) ? String(insert[c]) : lit(insert[c]))).join(',')}) RETURNING id`).split('\n')[0]
  }
  const id = ensure('public.companies', `name=${lit(E03_COMPANY_NAME)}`, { name: E03_COMPANY_NAME, status: 'active', ediel_id: E03_OWN_ID, default_environment: 'test' })
  sql(`UPDATE public.companies SET ediel_id=${lit(E03_OWN_ID)}, status='active', is_active=true WHERE id=${lit(id)}`)
  const ownerRole = sql(`SELECT id FROM public.roles WHERE key='owner' LIMIT 1`) || null
  ensure('public.company_memberships', `company_id=${lit(id)} AND user_id=${lit(actorUserId)}`,
    { company_id: id, user_id: actorUserId, status: 'active', is_active: true, role: 'owner', role_key: 'owner', membership_role: 'owner', role_id: ownerRole })
  sql(`UPDATE public.company_memberships SET accepted_at=coalesce(accepted_at,now()), joined_at=coalesce(joined_at,now()) WHERE company_id=${lit(id)} AND user_id=${lit(actorUserId)}`)
  sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect)
    SELECT ${lit(actorUserId)},${lit(id)},p.id,p.key,true,'active','allow' FROM public.permissions p
    WHERE (p.key LIKE 'communication.%' OR p.key LIKE 'ediel.%' OR p.key LIKE 'ediel\\_testing.%' OR p.key LIKE 'metering.%')
      AND NOT EXISTS (SELECT 1 FROM public.user_permissions u WHERE u.user_id=${lit(actorUserId)} AND u.company_id=${lit(id)} AND u.permission_key=p.key)`)
  sql(`UPDATE public.company_capabilities SET enabled=true, readiness_status='ready' WHERE company_id=${lit(id)} AND capability_code IN ('ediel_test','ediel_production')`)
  const mailbox = process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid'
  const dso = 'dso@t3.sim.invalid'
  for (const environment of ['test', 'production'] as const) {
    const past = "clock_timestamp()-interval '1 day'"
    ensure('public.tenant_ediel_profiles', `company_id=${lit(id)} AND environment=${lit(environment)} AND market='electricity'`, { company_id: id, environment, market: 'electricity', is_enabled: 'true', valid_from: past }, ['valid_from'])
    ensure('public.tenant_actor_identifiers', `company_id=${lit(id)} AND environment=${lit(environment)} AND identifier_type='EdielId' AND identifier_value=${lit(E03_OWN_ID)}`, { company_id: id, environment, actor_id: actorUserId, identifier_type: 'EdielId', identifier_value: E03_OWN_ID, valid_from: past }, ['valid_from'])
    ensure('public.tenant_actor_roles', `company_id=${lit(id)} AND environment=${lit(environment)} AND actor_id=${lit(actorUserId)} AND role_code='electricity_supplier'`, { company_id: id, environment, actor_id: actorUserId, role_code: 'electricity_supplier', valid_from: past }, ['valid_from'])
    ensure('public.grid_owners', `company_id=${lit(id)} AND environment=${lit(environment)} AND ediel_id='70007'`, { company_id: id, name: 'T3SIM E03 DSO 70007', ediel_id: '70007', environment, is_active: 'true', lifecycle_status: 'active', owner_code: 'TES' })
    ensure('public.ediel_actor_settings', `company_id=${lit(id)} AND environment=${lit(environment)} AND actor_ediel_id=${lit(E03_OWN_ID)}`,
      { company_id: id, actor_name: E03_COMPANY_NAME, actor_ediel_id: E03_OWN_ID, ediel_id: E03_OWN_ID, actor_role: 'supplier', role: 'supplier', environment, is_active: true, sender_name: E03_COMPANY_NAME, default_test_flag: environment === 'test' ? 1 : 0, smtp_from_email: mailbox, mailbox })
    for (const scope of ['ediel_ack', 'meter_values']) {
      const routeName = `T3SIM E03 ${scope} -> DSO 70007 (${environment})`
      const routeId = ensure('public.communication_routes', `company_id=${lit(id)} AND route_name=${lit(routeName)}`,
        { company_id: id, route_name: routeName, route_scope: scope, route_type: 'ediel_partner', is_active: true, target_email: dso, counterparty_ediel_id: '70007', environment_type: environment === 'test' ? 'tgt_test' : 'production', market_party_role: 'grid_owner' })
      ensure('public.ediel_route_profiles', `company_id=${lit(id)} AND communication_route_id=${lit(routeId)}`,
        { company_id: id, communication_route_id: routeId, is_enabled: true, is_active: true, environment, route_name: routeName, sender_ediel_id: E03_OWN_ID, own_ediel_id: E03_OWN_ID, receiver_ediel_id: '70007', counterparty_ediel_id: '70007',
          receiver_email: dso, smtp_to: dso, smtp_from: mailbox, smtp_host: '127.0.0.1', smtp_port: Number(process.env.T3_SMTP_PORT ?? 3125), mailbox, is_test_route: environment === 'test', is_production_route: environment === 'production',
          transport_mode: 'smtp_imap', tls_required: true, encryption_mode: 'none', default_test_flag: environment === 'test' ? 1 : 0,
          ...(scope === 'ediel_ack' ? { application_reference: '23-DDQ-E66-T' } : {}) })
    }
  }
  tenantReady = true
  return id
}

export async function seedInboundSource(o: { prefix: string; seq: number; receivedAt?: Date; process?: boolean }): Promise<E03Source> {
  const { parseEdifactPayload } = await import('@/lib/inbound-mail/edielEmailParser')
  const { createInboundEdielMessage, createParseResult } = await import('@/lib/inbound-mail/inboundStatusUpdater')
  const { processInboundEdielMessage } = await import('@/lib/ediel/flows/inboundProcessing')
  if (!tenantReady) seedE03Tenant()
  const cid = companyId()
  // Harnessfynd (delad lib): buildUtiltsE66 ger ingen UNB-testindikator (element 11), så kuvertet läses som 'production'
  // och den tekniska CONTRL-basen hålls (gridex_ediel_technical_ack.sources.status='held'). Testindikatorn läggs här.
  const e66 = buildUtiltsE66({ prefix: o.prefix, seq: o.seq, receiver: E03_OWN_ID,
    mutate: mode() === 'test' ? (segs) => segs.map((s) => (s.startsWith('UNB+') && !/\+\+1\+\+1$/.test(s) ? `${s}++1` : s)) : undefined })
  const parsed = parseEdifactPayload(e66.raw)
  const mailbox = sql(`SELECT id FROM public.ediel_mailboxes WHERE company_id IS NULL AND environment=${lit(mode())} AND COALESCE(metadata->>'scope','')='platform_shared' LIMIT 1`)
  const mailId = randomUUID()
  const receivedAt = (o.receivedAt ?? new Date()).toISOString()
  sql(`INSERT INTO public.inbound_email_messages(id,company_id,environment,mailbox_id,internet_message_id,received_at,raw_edifact_payload,body_text,processing_status,match_status)
    VALUES(${lit(mailId)},${lit(cid)},${lit(mode())},${lit(mailbox)},${lit(`<${o.prefix}-${o.seq}@t3.sim.invalid>`)},${lit(receivedAt)},${lit(e66.raw)},${lit(e66.raw)},'received','not_checked')`)
  const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now()
    try { return await fn() } catch (e) {
      // PostgREST-fel är vanliga objekt utan stack; märk fasen så att timeout/lås kan lokaliseras.
      const err = e as { message?: string; code?: string; details?: string }
      throw Object.assign(new Error(`e03 seed phase ${name} failed after ${Date.now() - t0} ms: ${err?.message ?? String(e)} (code ${err?.code ?? '-'})`), { cause: e })
    }
  }
  const parseResultId = await phase('createParseResult', () => createParseResult({ companyId: cid, inboundEmailMessageId: mailId, parsed }))
  const sourceId = await phase('createInboundEdielMessage', () => createInboundEdielMessage({ companyId: cid, actorUserId: actor(), environment: mode(), inboundEmailMessageId: mailId, parseResultId, parsed }))
  if (!sourceId) throw new Error('e03: createInboundEdielMessage gav inget id')
  if (o.process !== false) await phase('processInboundEdielMessage', () => processInboundEdielMessage({ actorUserId: actor(), edielMessageId: sourceId }))
  return { prefix: o.prefix, seq: o.seq, companyId: cid, sourceMessageId: sourceId, inboundEmailMessageId: mailId, receivedAt, raw: e66.raw, ...lookup(sourceId) }
}

export function lookup(sourceId: string) {
  const ack = sqlJson(`SELECT to_jsonb(x) FROM (SELECT m.id, (SELECT o.id FROM public.ediel_outbox o WHERE o.ediel_message_id=m.id LIMIT 1) AS outbox_id
    FROM public.ediel_messages m WHERE m.related_message_id=${lit(sourceId)} AND m.direction='outbound' AND m.message_family='CONTRL' ORDER BY m.created_at LIMIT 1) x`) as { id: string; outbox_id: string | null } | null
  const timers = (sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.timer_type),'[]') FROM public.ediel_sla_timers t WHERE t.ediel_message_id=${lit(sourceId)}`) as Array<Record<string, unknown>>) ?? []
  return { ackMessageId: ack?.id ?? null, outboxId: ack?.outbox_id ?? null, timers }
}

export const outboxRow = (id: string) => sqlJson(`SELECT to_jsonb(o) FROM public.ediel_outbox o WHERE id=${lit(id)}`) as Record<string, unknown>
export const attemptsFor = (messageId: string) => (sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at),'[]') FROM gridex_ediel_transport.attempts a WHERE a.message_id=${lit(messageId)}`) as Array<Record<string, unknown>>) ?? []
export const eventsFor = (messageId: string) => (sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.created_at),'[]') FROM public.ediel_message_events e WHERE e.ediel_message_id=${lit(messageId)}`) as Array<Record<string, unknown>>) ?? []
/** Parkera övriga köade/preparerade outbox-rader (andra körningars rester) så att en HTTP-drain bara rör denna rads ID. */
export const otherClaimable = (excludeId: string) => Number(sql(`SELECT count(*) FROM public.ediel_outbox WHERE status IN ('prepared','queued') AND id<>${lit(excludeId)}`))

/** CONTRL-utkast + outbox-rad via kodens egna byggare (samma anropskedja som createAckIfMissing i inboundProcessing.ts). */
export async function queueContrl(sourceMessageId: string, status: 'queued' | 'prepared' = 'queued'): Promise<{ ackMessageId: string; outboxId: string | null }> {
  const { getEdielMessageById } = await import('@/lib/ediel/db')
  const { prepareSourceAckDraft } = await import('@/lib/ediel/ack/prepareSourceAckDraft')
  const { createCanonicalAckMessage } = await import('@/lib/ediel/core/kernel')
  const { createOutboxItem } = await import('@/lib/ediel/outbox/createOutboxItem')
  const source = await getEdielMessageById(sourceMessageId)
  if (!source) throw new Error('e03: källa saknas')
  const prepared = await prepareSourceAckDraft({ actorUserId: actor(), sourceMessage: source, ackFamily: 'CONTRL', outcome: 'positive', messageText: null })
  if (prepared.kind === 'existing') throw new Error('e03: CONTRL fanns redan')
  const ack = await createCanonicalAckMessage({ actorUserId: actor(), sourceMessage: source, ackFamily: 'CONTRL', outcome: 'positive', draft: prepared.draft })
  await createOutboxItem({ actorUserId: actor(), message: ack, sourceMessageId: source.id, status, queueOnlyIfInserted: true,
    payload: { createdBy: 'track3_e03_fixture', ackFamily: 'CONTRL', outcome: 'positive', sourceMessageId: source.id } })
  return { ackMessageId: ack.id, outboxId: lookup(source.id).outboxId }
}
