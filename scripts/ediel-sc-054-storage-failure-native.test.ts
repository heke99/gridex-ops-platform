// masterplan: SC-054
// SC-054 / U-14 on the real local Supabase stack. A correct UTILTS E66
// transaction is received through the real inbound transport entry
// (processInboundEdifactMessage -> processInboundEdielMessage) while a
// test-only fault trigger, installed by service-role SQL for this one source,
// raises SQLSTATE 53100 (disk_full) inside the real persist transaction after the series
// row exists. Expected: no positive APERAK (nor any APERAK/UTILTS_ERR) and no
// outbox row; the real failure journal (ediel_dead_letter_items) durably holds
// a retryable internal failure; the real aperak_due SLA timer stays open and
// the real checkAckDeadlines sweep (explicit `now`) marks it expired after due;
// a queued reservation alone is never treated as storage. Contrasts: after the
// fault is removed the same source persists and its positive APERAK is bound
// to the source document/transaction; replay is stable; another tenant's
// source, journal and timers are untouched. No runtime code is changed; only
// final metering/billing/completion sinks are observed (as in the ERR gateway suite).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { processInboundEdifactMessage } from '@/lib/ediel/transport/inboundProcessor'
import { processInboundEdielMessage } from '@/lib/ediel/flows/inboundProcessing'
import { checkAckDeadlines } from '@/lib/ediel/sla/checkAckDeadlines'
import { EDIEL_ACK_DEADLINE_MINUTES } from '@/lib/ediel/specRegistry'
import { assertUtiltsPositiveAckAuthorityForSend } from '@/lib/ediel/utilts/positiveAckAuthority'
import * as database from '@/lib/ediel/db'
import { supabaseService } from '@/lib/supabase/service'
import { utiltsErrGatewayFixture, type UtiltsAckFixtureTransaction } from '../__tests__/helpers/utiltsErrGatewayFixture'
import { utiltsNativeSourceFixture } from '../__tests__/helpers/utiltsNativeSourceFixture'
import { seedOriginalMailboxNative, recordOriginalMailboxNativeReception } from './helpers/originalMailboxNative'
import { decisionUser } from './helpers/ediel-decision-original-native-fixture'
import { recordUtiltsTechnicalReception, registerUtiltsIssuer, seedUtiltsIssuerHistoryGround } from './helpers/utiltsConsumptionParties'
import type { EdielMessageRow } from '@/lib/ediel/types'

const sinks = vi.hoisted(() => ({ meter: vi.fn(), bill: vi.fn(), complete: vi.fn() }))
vi.mock('@/lib/metering/normalizeMeteringValues', () => ({ normalizeAndStoreMeteringValue: sinks.meter }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: vi.fn() }))
vi.mock('@/lib/cis/db', async original => ({ ...await original<Record<string, unknown>>(),
  ingestBillingUnderlay: sinks.bill, syncGridOwnerDataRequestReceivedFromEdiel: sinks.complete }))

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal = (value: unknown) => "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''") + "'"
function sql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('local_native_only')
  const result = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', timeout: 10000, maxBuffer: 2_000_000 }).trim()
  return result ? JSON.parse(result) as T : undefined as T
}
beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks()
  sinks.meter.mockResolvedValue({ status: 'stored', meteringValue: { id: 'observed-native-meter' } })
  sinks.bill.mockResolvedValue({ id: 'observed-native-underlay' })
  sinks.complete.mockResolvedValue(null)
})

const RECEIVED_AT = '2026-10-15T20:00:00Z'
async function seed(requestedEdielId: string) {
  const actorEdielId = sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_utilts_err_gateway_identity',0));
    SELECT to_jsonb(min(n)::text) FROM generate_series(${Number(requestedEdielId)},54999) n
     WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=n::text)
      AND NOT EXISTS(SELECT FROM public.ediel_actor_settings x WHERE x.environment='test' AND x.ediel_id=n::text); COMMIT;`)
  const issuer = sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_utilts_consumption_issuer',0));
    SELECT to_jsonb(min(n)::text) FROM generate_series(80000,89999) n WHERE NOT EXISTS(SELECT FROM gridex_utilts_issuer.namespaces x WHERE x.registry_actor_key='SYNTHETIC-NATIVE-ISSUER:'||n::text)
     AND NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=n::text); COMMIT;`)
  vi.stubEnv('EDIEL_SMTP_FROM','native-sc054@example.invalid');vi.stubEnv('EDIEL_SMTP_USER','native-sc054@example.invalid');vi.stubEnv('EDIEL_SMTP_PASS','synthetic-only');vi.stubEnv('EDIEL_SMTP_HOST','smtp.example.invalid');vi.stubEnv('EDIEL_SMTP_PORT','587');vi.stubEnv('EDIEL_EMAIL_PROVIDER','strato')
  const ids = { company: randomUUID(), actor: randomUUID(), route: randomUUID(), profile: randomUUID(),
    customer: randomUUID(), site: randomUUID(), point: randomUUID(), grid: randomUUID(), request: randomUUID() }
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(ids.company)},'Synthetic native SC054','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${literal(ids.actor)},'authenticated','authenticated',${literal(`sc054-${ids.actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(ids.actor)},${literal(`sc054-${ids.actor}@example.invalid`)},'Synthetic SC054 actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(ids.company)},${literal(ids.actor)},'operations','active',now(),'{}','member',true,now(),'operations');
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,status,is_active) SELECT ${literal(ids.actor)},${literal(ids.company)},id,key,'allow','active',true FROM public.permissions WHERE key IN('communication.write','metering.write') AND is_active;
    INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(${literal(ids.company)},'test','electricity',true,clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'EdielId',${literal(actorEdielId)},clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'electricity_supplier',clock_timestamp()-interval '1 day');
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id) VALUES(${literal(ids.company)},'test','Synthetic native legal supplier',${literal(actorEdielId)},${literal(actorEdielId)});
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${literal(ids.route)},${literal(ids.company)},'Native SC054 ACK route','ediel_ack','bilateral_test',true,'counterparty@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,mailbox,smtp_host,smtp_port)
      VALUES(${literal(ids.profile)},${literal(ids.company)},${literal(ids.route)},'Native SC054 ACK profile','test','edifact','edifact',${literal(actorEdielId)},${literal(issuer)},'23-DDQ-E66-T',true,true,'native-sc054@example.invalid','smtp.example.invalid',587);
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${literal(ids.customer)},${literal(ids.company)},${literal(ids.customer)},'Synthetic','private');
    INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${literal(ids.grid)},${literal(ids.company)},${literal(ids.grid)},${literal(issuer)},'test',true,'active');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${literal(ids.site)},${literal(ids.company)},${literal(ids.customer)},'Synthetic','consumption','active','SE','735999260731000007',${literal(ids.grid)});
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id) VALUES(${literal(ids.point)},${literal(ids.company)},${literal(ids.customer)},${literal(ids.site)},${literal(ids.site)},'735999260731000007','735999260731000007',${literal(ids.grid)});
    INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${literal(ids.request)},${literal(ids.company)},${literal(ids.customer)},${literal(ids.site)},${literal(ids.point)},${literal(ids.grid)},'billing_underlay');`)
  registerUtiltsIssuer(sql, literal, issuer, ids.actor)
  const receptionActor = await decisionUser(ids.company, ['communication.send'], randomUUID() + 'Aa1!')
  const insertSource = async (transactions: UtiltsAckFixtureTransaction[]) => {
    const fixture = utiltsErrGatewayFixture({ company: ids.company, receiver: actorEdielId, transactions })
    const physical = fixture.raw_payload!.replaceAll('91100', issuer).replaceAll('GRIDEX2607E66MSG001', `D${randomUUID().replaceAll('-', '').slice(0, 16)}`)
    const { id, raw, parsed } = utiltsNativeSourceFixture(physical, randomUUID())
    const mail = await seedOriginalMailboxNative(sql, literal, { companyId: ids.company, environment: 'test', raw, parsed,
      receivedAt: RECEIVED_AT, smtpFrom: 'native-sc054@example.invalid', senderEmail: 'counterparty@example.invalid' })
    sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,validation_report,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,inbound_email_message_id,mailbox_message_id)
      VALUES(${literal(id)},${literal(ids.company)},${literal(ids.customer)},${literal(ids.site)},${literal(ids.point)},${literal(ids.grid)},${literal(ids.request)},'test','inbound','edifact','UTILTS','E66','received',${literal(raw)},'{}','{}',${literal(RECEIVED_AT)},'{}',${literal(parsed.applicationReference)},${literal(issuer)},${literal(actorEdielId)},${literal(parsed.interchangeReference)},${literal(mail.inboundEmailMessageId)},${literal(mail.inboundEmailMessageId)});`)
    const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', id).single()
    expect(error).toBeNull()
    await recordOriginalMailboxNativeReception({ ...mail, companyId: ids.company, sourceMessageId: id, actorUserId: receptionActor.id })
    await recordUtiltsTechnicalReception(data as EdielMessageRow, ids.actor)
    seedUtiltsIssuerHistoryGround(sql, literal, id, ids.actor)
    return data as EdielMessageRow
  }
  return { ids, insertSource }
}

// Test-only fault: for this one source only, binding the reservation to a stored
// series raises a genuine storage failure (SQLSTATE 53100 disk_full) inside the
// persist transaction. 40001/40P01 are not used: PostgREST transparently retries
// those, so a client-side timeout could be followed by a later server-side commit.
function installFault(sourceId: string) {
  sql(`CREATE OR REPLACE FUNCTION public.sc054_native_fault() RETURNS trigger LANGUAGE plpgsql AS $f$BEGIN
      IF NEW.source_message_id<>${literal(sourceId)}::uuid OR NEW.persisted_series_id IS NULL THEN RETURN NEW; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.meter_reading_series WHERE id=NEW.persisted_series_id) THEN RAISE EXCEPTION 'sc054_fault_before_series'; END IF;
      RAISE EXCEPTION 'sc054 could not extend file: No space left on device' USING ERRCODE='53100'; END$f$;
    DROP TRIGGER IF EXISTS sc054_native_fault ON public.ediel_ack_transaction_results;
    CREATE TRIGGER sc054_native_fault BEFORE INSERT OR UPDATE ON public.ediel_ack_transaction_results FOR EACH ROW EXECUTE FUNCTION public.sc054_native_fault();`)
}
function removeFault() {
  sql(`DROP TRIGGER IF EXISTS sc054_native_fault ON public.ediel_ack_transaction_results; DROP FUNCTION IF EXISTS public.sc054_native_fault();`)
}

type State = { acks: { id: string; family: string; outcome: string; reference: string | null; wire: string; company: string }[]; reservations: Record<string, unknown>[]
  series: { id: string; transaction: string }[]; values: number; outbox: string[]; journal: Record<string, unknown>[]; timers: Record<string, unknown>[] }
function state(company: string, source: string): State {
  return sql(`SELECT jsonb_build_object(
    'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'family',message_family,'outcome',ack_outcome,'reference',parsed_payload->>'relatedTransactionReference','wire',raw_payload,'company',company_id) ORDER BY message_family,id),'[]') FROM public.ediel_messages WHERE related_message_id=${literal(source)} AND direction='outbound'),
    'reservations',(SELECT coalesce(jsonb_agg(jsonb_build_object('transaction',source_transaction_id,'disposition',disposition,'plan',planned_response_type,'final',final_response_type,'persistence',persistence_status,'series',persisted_series_id,'ack',response_message_id,'company',company_id) ORDER BY source_transaction_id),'[]') FROM public.ediel_ack_transaction_results WHERE source_message_id=${literal(source)}),
    'series',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'transaction',source_transaction_reference) ORDER BY id),'[]') FROM public.meter_reading_series WHERE source_ediel_message_id=${literal(source)}),
    'values',(SELECT count(*) FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.source_ediel_message_id=${literal(source)}),
    'outbox',(SELECT coalesce(jsonb_agg(m.message_family ORDER BY o.id),'[]') FROM public.ediel_outbox o JOIN public.ediel_messages m ON m.id=o.ediel_message_id WHERE o.source_message_id=${literal(source)}),
    'journal',(SELECT coalesce(jsonb_agg(jsonb_build_object('company',company_id,'source',source,'code',error_code,'message',error_message,'retryable',retryable,'status',status,'disposition',metadata->'failureDisposition') ORDER BY created_at,id),'[]') FROM public.ediel_dead_letter_items WHERE ediel_message_id=${literal(source)}),
    'timers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'company',company_id,'type',timer_type,'status',status,'due',due_at) ORDER BY timer_type),'[]') FROM public.ediel_sla_timers WHERE ediel_message_id=${literal(source)} AND company_id=${literal(company)}))`)
}
const positiveAuthority = (company: string, source: string, transaction: string) => {
  try { sql(`SELECT public.gridex_require_utilts_positive_ack_authority_v1(${literal(company)},'test',${literal(source)},${literal(transaction)})`); return 'granted' }
  catch (error) { return /utilts_positive_ack_storage_unavailable/.test(String((error as { stderr?: string }).stderr ?? error)) ? 'storage_unavailable' : String(error) }
}

it('SC-054 a correct UTILTS transaction whose persist transaction fails yields no APERAK, a durable retryable journal and an open deadline that the real sweep expires; recovery binds the positive APERAK to the source', async () => {
  const reference = 'SC054-' + randomUUID().slice(0, 8)
  const own = await seed('54540'), other = await seed('54560')
  const source = await own.insertSource([{ reference, outcome: 'accepted' }])
  const foreign = await other.insertSource([{ reference: 'SC054-OTHER', outcome: 'accepted' }])
  const foreignBefore = state(other.ids.company, foreign.id)

  installFault(source.id)
  try {
    const failure = await processInboundEdifactMessage({ actorUserId: own.ids.actor, message: source }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(JSON.stringify({ message: (failure as Error).message, cause: String((failure as { cause?: unknown }).cause ?? '') })).toMatch(/utilts_transaction_persistence_failed:sc054 could not extend file: No space left on device/)
  } finally { removeFault() }

  const failed = state(own.ids.company, source.id)
  // The technical CONTRL is a syntax receipt, not business processing.
  // Prohibited: any APERAK/UTILTS_ERR or its outbox entry or business sink effect before durable storage.
  expect(failed.acks.filter(a => a.family !== 'CONTRL')).toEqual([])
  expect(failed.outbox.filter(family => family !== 'CONTRL')).toEqual([])
  expect(failed.series).toEqual([]); expect(failed.values).toBe(0)
  expect(sinks.meter).not.toHaveBeenCalled(); expect(sinks.bill).not.toHaveBeenCalled(); expect(sinks.complete).not.toHaveBeenCalled()
  // Whatever reservation survives is never persisted, finalized or bound to an ACK.
  for (const row of failed.reservations) expect(row).toMatchObject({ series: null, final: null, ack: null })
  expect(failed.reservations.every(row => row.persistence !== 'persisted')).toBe(true)
  // The real SQL storage authority refuses a positive APERAK for this transaction.
  expect(positiveAuthority(own.ids.company, source.id, reference)).toBe('storage_unavailable')
  // Queue status alone is never storage: a queued planned-positive reservation is still refused.
  // The schema has no 'queued' persistence status; the pre-storage queue states
  // are 'pending' (reserved) and 'failed'. Neither is accepted as storage.
  const probe = (status: string) => sql<string>(`BEGIN;
    INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result,disposition,planned_response_type,persistence_status)
    VALUES(${literal(own.ids.company)},'test',${literal(source.id)},${literal(reference)},'positive','positive','positive','accepted','positive_aperak',${literal(status)})
    ON CONFLICT(company_id,environment,source_message_id,source_transaction_id) DO UPDATE SET persistence_status=EXCLUDED.persistence_status,persisted_series_id=NULL;
    CREATE TEMP TABLE sc054_probe(r text) ON COMMIT DROP;
    DO $p$BEGIN PERFORM public.gridex_require_utilts_positive_ack_authority_v1(${literal(own.ids.company)},'test',${literal(source.id)},${literal(reference)}); INSERT INTO sc054_probe VALUES('granted');
      EXCEPTION WHEN OTHERS THEN INSERT INTO sc054_probe VALUES(SQLERRM); END$p$;
    SELECT to_jsonb(r) FROM sc054_probe; ROLLBACK;`)
  expect(probe('pending')).toMatch(/utilts_positive_ack_storage_unavailable/)
  expect(probe('failed')).toMatch(/utilts_positive_ack_storage_unavailable/)
  expect(state(own.ids.company, source.id)).toEqual(failed)

  // Durable failure journal: one retryable internal failure, not an external rejection.
  expect(failed.journal).toEqual([expect.objectContaining({ company: own.ids.company, source: 'inbound_mail', code: 'EDIEL_INTERNAL_EXECUTION_FAILURE', retryable: true, status: 'open',
    disposition: expect.objectContaining({ kind: 'internal_failure' }) })])
  expect(String(failed.journal[0].message)).toMatch(/utilts_transaction_persistence_failed:sc054 could not extend file: No space left on device/)

  // Monitored deadline: the real aperak_due timer is open, due 30 min after reception.
  const timer = failed.timers.find(t => t.type === 'aperak_due')
  expect(timer).toMatchObject({ company: own.ids.company, status: 'open' })
  const dueAt = Date.parse(String(timer!.due))
  expect(dueAt).toBe(Date.parse(RECEIVED_AT) + EDIEL_ACK_DEADLINE_MINUTES * 60_000)
  const timerStatus = () => sql<string>(`SELECT to_jsonb(status) FROM public.ediel_sla_timers WHERE id=${literal(timer!.id)}`)
  const foreignTimers = () => sql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'updated',updated_at) ORDER BY id),'[]') FROM public.ediel_sla_timers WHERE company_id=${literal(other.ids.company)}`)
  const foreignTimersBefore = foreignTimers()
  await checkAckDeadlines({ actorUserId: own.ids.actor, companyId: own.ids.company, now: new Date(dueAt - 15 * 60_000).toISOString() })
  expect(timerStatus()).toBe('open')
  await checkAckDeadlines({ actorUserId: own.ids.actor, companyId: own.ids.company, now: new Date(dueAt + 1000).toISOString() })
  expect(timerStatus()).toBe('expired')
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_message_events WHERE ediel_message_id=${literal(source.id)} AND event_status='error' AND payload->>'timerId'=${literal(timer!.id)} AND payload->>'status'='expired'`)).toBeGreaterThanOrEqual(1)
  const overdue = state(own.ids.company, source.id)
  expect(overdue.acks.filter(a => a.family !== 'CONTRL')).toEqual([]); expect(overdue.outbox.filter(family => family !== 'CONTRL')).toEqual([])
  // Tenant isolation: the other tenant's source, journal and timers are untouched.
  expect(state(other.ids.company, foreign.id)).toEqual(foreignBefore)
  expect(foreignTimers()).toEqual(foreignTimersBefore)
  expect(foreignBefore.journal).toEqual([])

  // Contrast: with the fault removed, replay of the same source persists and binds the positive APERAK.
  await processInboundEdielMessage({ actorUserId: own.ids.actor, edielMessageId: source.id })
  const recovered = state(own.ids.company, source.id)
  expect(recovered.series).toEqual([{ id: expect.any(String), transaction: reference }])
  expect(recovered.values).toBeGreaterThan(0)
  const aperaks = recovered.acks.filter(a => a.family === 'APERAK')
  expect(aperaks).toMatchObject([{ outcome: 'positive', reference, company: own.ids.company }])
  expect(recovered.acks.filter(a => a.family === 'UTILTS_ERR')).toEqual([])
  expect(recovered.reservations).toMatchObject([{ transaction: reference, disposition: 'accepted', final: 'positive_aperak', persistence: 'persisted', series: recovered.series[0].id, ack: aperaks[0].id, company: own.ids.company }])
  const documentNumber = /BGM\+[^+']*\+([^+']+)/.exec(source.raw_payload!)![1]
  expect(aperaks[0].wire).toContain(`DOC+E66:SVK:260+${documentNumber}'`)
  expect(aperaks[0].wire).toContain(`RFF+ACW:${reference}'`)
  expect(positiveAuthority(own.ids.company, source.id, reference)).toBe('granted')
  const saved = await database.getEdielMessageById(aperaks[0].id)
  await expect(assertUtiltsPositiveAckAuthorityForSend(saved!)).resolves.toBeUndefined()
  // The original failure journal remains as durable history.
  expect(recovered.journal).toEqual(failed.journal)

  // Replay after success is stable: no second series, APERAK or journal row.
  await processInboundEdielMessage({ actorUserId: own.ids.actor, edielMessageId: source.id })
  expect(state(own.ids.company, source.id)).toEqual({ ...recovered, timers: state(own.ids.company, source.id).timers })
  expect(state(other.ids.company, foreign.id)).toEqual(foreignBefore)
}, 180_000)
