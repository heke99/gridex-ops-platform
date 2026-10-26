// reality-defects: J2 (reality scenario J2 "inbound UTILTS": J2-03 an estimated value is replaced by the measured one (fixed, 20261026180000); J2-05 a partial-period correction is refused)
// The real inbound UTILTS processor (processInboundUtiltsMessage), canonical persistence, SQL binding and the real
// metering sink (normalizeAndStoreMeteringValue → gridex_consume_utilts_metering_v1 → gridex_ingest_metering_value_atomic)
// against the local disposable replay database. Seeding follows scripts/ediel-utilts-err-gateway-native.test.ts
// (SC046): every source is a genuine original with its own mailbox reception, technical reception and the
// project's synthetic issuer ground. Only the billing-gate matcher is observed (it needs a supply period), the
// billing underlay sink stays real. Each test owns a fresh tenant and issuer. Synthetic data only.
//
// Grid-owner practice: when the meter cannot be read the grid owner sends the day's values flagged estimated
// (STS+8+56 as the observation status, consumptionPreparation → quality 56, reading type 'estimated'); the billing gate
// holds them ('quality_not_final'). When the meter is read the same period is sent again with a later
// registration time (DTM+597/U-04) and no estimate flag. Both open defects are it.fails: the first assertion
// block states the required outcome, the evidence test pins today's refusal.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { utiltsErrGatewayFixture } from '../__tests__/helpers/utiltsErrGatewayFixture'
import { utiltsNativeSourceFixture, utiltsRecountUnt } from '../__tests__/helpers/utiltsNativeSourceFixture'
import { seedOriginalMailboxNative, recordOriginalMailboxNativeReception } from './helpers/originalMailboxNative'
import { decisionUser } from './helpers/ediel-decision-original-native-fixture'
import { processInboundUtiltsMessage } from '@/lib/ediel/flows/utiltsDataRequest'
import { supabaseService } from '@/lib/supabase/service'
import { recordUtiltsTechnicalReception, registerUtiltsIssuer, seedUtiltsIssuerHistoryGround } from './helpers/utiltsConsumptionParties'
import type { EdielMessageRow } from '@/lib/ediel/types'

const sinks = vi.hoisted(() => ({ gate: vi.fn() }))
vi.mock('@/lib/billing/meterValueBillingMatcher', () => ({ updateMeterValueBillingReadiness: sinks.gate }))

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const literal = (value: unknown) => "'" + String(typeof value === 'object' ? JSON.stringify(value) : value).replaceAll("'", "''") + "'"
function sql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('local_native_only')
  const result = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', timeout: 20_000, maxBuffer: 4_000_000 }).trim()
  return result ? JSON.parse(result) as T : undefined as T
}
beforeEach(() => { vi.clearAllMocks(); sinks.gate.mockResolvedValue('blocked') })

/** A fresh supplier tenant with one customer, facility and billing data request, and a fresh synthetic issuer. */
async function seed() {
  const actorEdielId = sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_utilts_err_gateway_identity',0));
    SELECT to_jsonb(min(n)::text) FROM generate_series(56000,56999) n
     WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=n::text)
      AND NOT EXISTS(SELECT FROM public.ediel_actor_settings x WHERE x.environment='test' AND x.ediel_id=n::text); COMMIT;`)
  const issuer = sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_utilts_consumption_issuer',0));
    SELECT to_jsonb(min(n)::text) FROM generate_series(80000,89999) n WHERE NOT EXISTS(SELECT FROM gridex_utilts_issuer.namespaces x WHERE x.registry_actor_key='SYNTHETIC-NATIVE-ISSUER:'||n::text)
     AND NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=n::text); COMMIT;`)
  vi.stubEnv('EDIEL_SMTP_FROM', 'native-j2@example.invalid'); vi.stubEnv('EDIEL_SMTP_USER', 'native-j2@example.invalid'); vi.stubEnv('EDIEL_SMTP_PASS', 'synthetic-only')
  vi.stubEnv('EDIEL_SMTP_HOST', 'smtp.example.invalid'); vi.stubEnv('EDIEL_SMTP_PORT', '587'); vi.stubEnv('EDIEL_EMAIL_PROVIDER', 'strato')
  const ids = { company: randomUUID(), actor: randomUUID(), route: randomUUID(), profile: randomUUID(), customer: randomUUID(), site: randomUUID(), point: randomUUID(), grid: randomUUID(), request: randomUUID() }
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(ids.company)},'Synthetic native J2 inbound UTILTS','active');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${literal(ids.actor)},'authenticated','authenticated',${literal(`j2-${ids.actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(ids.actor)},${literal(`j2-${ids.actor}@example.invalid`)},'Synthetic J2 actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(ids.company)},${literal(ids.actor)},'operations','active',now(),'{}','member',true,now(),'operations');
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,effect,status,is_active) SELECT ${literal(ids.actor)},${literal(ids.company)},id,key,'allow','active',true FROM public.permissions WHERE key IN('communication.write','metering.write') AND is_active;
    INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(${literal(ids.company)},'test','electricity',true,clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'EdielId',${literal(actorEdielId)},clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${literal(ids.company)},'test',${literal(ids.actor)},'electricity_supplier',clock_timestamp()-interval '1 day');
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id) VALUES(${literal(ids.company)},'test','Synthetic J2 supplier',${literal(actorEdielId)},${literal(actorEdielId)});
    INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,environment_type,is_active,target_email) VALUES(${literal(ids.route)},${literal(ids.company)},'J2 ACK route','ediel_ack','bilateral_test',true,'counterparty@example.invalid');
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,is_active,mailbox,smtp_host,smtp_port)
      VALUES(${literal(ids.profile)},${literal(ids.company)},${literal(ids.route)},'J2 ACK profile','test','edifact','edifact',${literal(actorEdielId)},${literal(issuer)},'23-DDQ-E66-T',true,true,'native-j2@example.invalid','smtp.example.invalid',587);
    INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${literal(ids.customer)},${literal(ids.company)},${literal(ids.customer)},'Synthetic','private');
    INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status) VALUES(${literal(ids.grid)},${literal(ids.company)},${literal(ids.grid)},${literal(issuer)},'test',true,'active');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${literal(ids.site)},${literal(ids.company)},${literal(ids.customer)},'Synthetic','consumption','active','SE','735999260731000007',${literal(ids.grid)});
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id) VALUES(${literal(ids.point)},${literal(ids.company)},${literal(ids.customer)},${literal(ids.site)},${literal(ids.site)},'735999260731000007','735999260731000007',${literal(ids.grid)});
    INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${literal(ids.request)},${literal(ids.company)},${literal(ids.customer)},${literal(ids.site)},${literal(ids.point)},${literal(ids.grid)},'billing_underlay');`)
  registerUtiltsIssuer(sql, literal, issuer, ids.actor)
  const receptionActor = await decisionUser(ids.company, ['communication.send'], randomUUID() + 'Aa1!')
  let minute = 0
  /** One E66 for 1 July 00:00–00:30 (+0200, the fixture's offset): `values` per quarter (null = quarter absent), registered at `registered`. */
  const send = async (label: string, input: { registered: string; values: Array<string | null>; estimated?: boolean; periodStart?: string }) => {
    const reference = `J2-${label}`
    const receivedAt = `2026-10-15T20:${String(minute++).padStart(2, '0')}:00Z`
    const template = utiltsErrGatewayFixture({ company: ids.company, receiver: actorEdielId, transactions: [{ reference, outcome: 'accepted' }] })
    const quarters = ['202607010000', '202607010015']
    const present = input.values.map((value, q) => ({ value, start: quarters[q] })).filter(entry => entry.value !== null)
    const periodStart = input.periodStart ?? present[0].start, periodEnd = present[present.length - 1].start === '202607010000' ? '202607010015' : '202607010030'
    const lines = template.raw_payload!.replaceAll('91100', issuer).replaceAll('GRIDEX2607E66MSG001', `D${randomUUID().replaceAll('-', '').slice(0, 16)}`)
      .replace('202607010000202607010015:719', `${periodStart}${periodEnd}:719`).replace('DTM+597:202607010020:203', `DTM+597:${input.registered}:203`).split('\n')
    const first = lines.findIndex(line => line.startsWith('SEQ+')), unt = lines.findIndex(line => line.startsWith('UNT+'))
    // UNSM order QTY, DTM, STS; an estimate carries STS+8+56 in place of the ordinary observation status
    // (as __tests__/ediel-utilts-consumption-contract.test.ts derives quality 56).
    const observations = present.flatMap((entry, index) => [`SEQ++${index + 1}'`, `QTY+136:${entry.value}'`, `DTM+597:${entry.start}:203'`, input.estimated ? "STS+8+56'" : "STS+7++21::260'"])
    const raw = utiltsRecountUnt([...lines.slice(0, first), ...observations, ...lines.slice(unt)].join('\n'))
    const physical = utiltsNativeSourceFixture(raw, randomUUID())
    const mail = await seedOriginalMailboxNative(sql, literal, { companyId: ids.company, environment: 'test', raw: physical.raw, parsed: physical.parsed, receivedAt,
      smtpFrom: 'native-j2@example.invalid', senderEmail: 'counterparty@example.invalid' })
    sql(`INSERT INTO public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,grid_owner_data_request_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,parsed_payload,validation_report,message_received_at,execution_context_snapshot,application_reference,sender_ediel_id,receiver_ediel_id,interchange_reference,inbound_email_message_id,mailbox_message_id)
      VALUES(${literal(physical.id)},${literal(ids.company)},${literal(ids.customer)},${literal(ids.site)},${literal(ids.point)},${literal(ids.grid)},${literal(ids.request)},'test','inbound','edifact','UTILTS','E66','received',${literal(physical.raw)},'{}','{}',${literal(receivedAt)},'{}',${literal(physical.parsed.applicationReference)},${literal(issuer)},${literal(actorEdielId)},${literal(physical.parsed.interchangeReference)},${literal(mail.inboundEmailMessageId)},${literal(mail.inboundEmailMessageId)});`)
    const { data, error } = await supabaseService.from('ediel_messages').select('*').eq('id', physical.id).single()
    expect(error).toBeNull()
    const source = data as EdielMessageRow
    await recordOriginalMailboxNativeReception({ ...mail, companyId: ids.company, sourceMessageId: physical.id, actorUserId: receptionActor.id })
    await recordUtiltsTechnicalReception(source, ids.actor)
    seedUtiltsIssuerHistoryGround(sql, literal, physical.id, ids.actor)
    return { source, reference }
  }
  const consume = (source: EdielMessageRow) => processInboundUtiltsMessage({ actorUserId: ids.actor, edielMessageId: source.id })
  /** The current value per quarter as the billing engine and Mina sidor read it. */
  const current = () => sql<Array<{ start: string; kwh: string; quality: string | null; reading: string; revision: number }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'start',to_char(m.period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI"Z"'),'kwh',m.value_kwh::text,'quality',m.quality_code,'reading',m.reading_type,'revision',m.revision_number) ORDER BY m.period_start),'[]')
    FROM public.metering_values m WHERE m.company_id=${literal(ids.company)} AND m.is_current`)
  const outcome = (source: EdielMessageRow) => sql<{ status: string; acks: Array<{ family: string; outcome: string }> }>(`SELECT jsonb_build_object('status',m.status,
      'acks',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',a.message_family,'outcome',a.ack_outcome)),'[]') FROM public.ediel_messages a WHERE a.related_message_id=m.id AND a.message_family IN ('APERAK','UTILTS_ERR')))
    FROM public.ediel_messages m WHERE m.id=${literal(source.id)}`)
  return { ids, send, consume, current, outcome }
}

/** The processor's error for one source, or null when it completed. */
async function attempt(f: Awaited<ReturnType<typeof seed>>, source: EdielMessageRow) {
  try { await f.consume(source); return null } catch (error) { return error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error) }
}

describe('J2-03 estimated values replaced by measured values', () => {
  it('control: a later measured correction of a measured value replaces it (scenario E/F78 path)', async () => {
    const f = await seed()
    expect(await attempt(f, (await f.send('MEASURED', { registered: '202607010040', values: ['500', '400'] })).source)).toBeNull()
    expect(await attempt(f, (await f.send('MEASURED-CORR', { registered: '202607010100', values: ['520', '400'] })).source)).toBeNull()
    expect(f.current()).toEqual([
      { start: '2026-06-30T22:00Z', kwh: '520', quality: null, reading: 'consumption', revision: 2 },
      { start: '2026-06-30T22:15Z', kwh: '400', quality: null, reading: 'consumption', revision: 1 },
    ])
  })

  it('the estimated day is stored as estimated and held from billing', async () => {
    const f = await seed()
    expect(await attempt(f, (await f.send('ESTIMATED', { registered: '202607010040', values: ['500', '400'], estimated: true })).source)).toBeNull()
    expect(f.current()).toEqual([
      { start: '2026-06-30T22:00Z', kwh: '500', quality: '56', reading: 'estimated', revision: 1 },
      { start: '2026-06-30T22:15Z', kwh: '400', quality: '56', reading: 'estimated', revision: 1 },
    ])
  })

  it('the measured values replace the estimates (changed and unchanged quantity alike)', async () => {
    const f = await seed()
    await f.consume((await f.send('ESTIMATED', { registered: '202607010040', values: ['500', '400'], estimated: true })).source)
    const measured = (await f.send('MEASURED', { registered: '202607010100', values: ['520', '400'] })).source
    expect(await attempt(f, measured)).toBeNull()
    expect(f.current()).toEqual([
      { start: '2026-06-30T22:00Z', kwh: '520', quality: null, reading: 'consumption', revision: 2 },
      { start: '2026-06-30T22:15Z', kwh: '400', quality: null, reading: 'consumption', revision: 2 },
    ])
  })

  it('an estimate never replaces a measured value', async () => {
    const f = await seed()
    expect(await attempt(f, (await f.send('MEASURED', { registered: '202607010040', values: ['500', '400'] })).source)).toBeNull()
    const estimated = (await f.send('ESTIMATED', { registered: '202607010100', values: ['520', '400'], estimated: true })).source
    expect(await attempt(f, estimated)).toMatch(/utilts_consumption_existing_metering_conflict/)
    expect(f.current()).toEqual([
      { start: '2026-06-30T22:00Z', kwh: '500', quality: null, reading: 'consumption', revision: 1 },
      { start: '2026-06-30T22:15Z', kwh: '400', quality: null, reading: 'consumption', revision: 1 },
    ])
  })

  it('a measured file that is not newer than the estimate does not replace it', async () => {
    const f = await seed()
    await f.consume((await f.send('ESTIMATED', { registered: '202607010100', values: ['500', '400'], estimated: true })).source)
    const older = (await f.send('MEASURED', { registered: '202607010040', values: ['520', '400'] })).source
    // The processor keeps an older registration out of the current values (late history); the estimate stays.
    await attempt(f, older)
    expect(f.current().map(row => [row.kwh, row.quality, row.revision])).toEqual([['500', '56', 1], ['400', '56', 1]])
  })
})

describe('J2-05 a correction for part of the original period', () => {
  it('evidence: a correction of only the second quarter-hour is refused', async () => {
    const f = await seed()
    expect(await attempt(f, (await f.send('ORIGINAL', { registered: '202607010040', values: ['500', '400'] })).source)).toBeNull()
    const partial = (await f.send('PARTIAL-CORR', { registered: '202607010100', values: [null, '450'], periodStart: '202607010015' })).source
    const error = await attempt(f, partial)
    // The correction's series period (00:15–00:30) is a different cohort than the original's (00:00–00:30).
    expect(error).toMatch(/utilts_consumption_correction_binding_invalid/)
    expect(f.current().map(row => row.kwh)).toEqual(['500', '400'])
  })

  it.fails('a correction of only the second quarter-hour replaces just that quarter', async () => {
    const f = await seed()
    await f.consume((await f.send('ORIGINAL', { registered: '202607010040', values: ['500', '400'] })).source)
    await f.consume((await f.send('PARTIAL-CORR', { registered: '202607010100', values: [null, '450'], periodStart: '202607010015' })).source)
    expect(f.current().map(row => [row.kwh, row.revision])).toEqual([['500', 1], ['450', 2]])
  })
})
