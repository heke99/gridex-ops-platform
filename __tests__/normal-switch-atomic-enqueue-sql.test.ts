import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// NEW coordinator component proof, not native/GEN/provider qualification.
// Existing private source guards are finite dependency stubs here. The
// incumbent database producer must qualify those real guards and concurrency.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const co = id(1), customer = id(2), site = id(3), point = id(4), sw = id(5), actor = id(6), message = id(7), intent = id(8), outbound = id(9), contract = id(10)
const raw = 'Synthetic already bound original', hash = createHash('sha256').update(raw).digest('hex'), contractHash = 'b'.repeat(64)
type Row = Record<string, unknown>
let db: PGlite
async function run(overrides: unknown[] = []) {
  const args = [co, sw, intent, message, outbound, actor, hash]
  overrides.forEach((value, index) => { if (value !== undefined) args[index] = value as string })
  return (await db.query<{ result: Row }>('select public.gridex_enqueue_normal_supplier_switch_v1($1,$2,$3,$4,$5,$6,$7) as result', args)).rows[0].result
}
async function flag(mode: string, data: Row | null = null) { await db.query('insert into public.fixture_flags values($1,$2)', [mode, data]) }
async function snapshot() {
  const result: Record<string, Row[]> = {}
  for (const table of ['supplier_switch_requests', 'ediel_messages', 'ediel_message_intents', 'outbound_requests', 'ediel_outbox']) {
    result[table] = (await db.query<Row>(`select * from public.${table} order by id`)).rows
  }
  return result
}
async function queuedOutbox(status = 'queued') {
  await db.query(`insert into public.ediel_outbox(id,company_id,ediel_message_id,intent_id,environment,status,lock_key,route_profile_id,payload,immutable_payload_hash)
    values($1,$2,$3,$4,'production',$5,$6,$7,$8,$9)`, [id(12), co, message, intent, status, `outbound:${outbound}:${message}`, id(11), { outboundRequestId: outbound, unrelated: 'keep' }, hash])
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema gridex_ediel_transport; create schema gridex_outbound_dispatch; create schema gridex_received_sources;
    create schema gridex_bilateral_prodat; create schema gridex_ediel_ack_replay;
    create table public.fixture_flags(mode text,data jsonb);
    create table public.user_profiles(id uuid primary key,user_status text);
    create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
    create table public.customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,metering_point_id uuid,status text,signed_at timestamptz,signed_version text,metadata jsonb);
    create table public.supplier_switch_requests(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,customer_site_id uuid,metering_point_id uuid,
      customer_contract_id uuid,contract_id uuid,request_type text,prodat_variant text,prodat_reason text,requested_start_date date,outbound_z03_message_id uuid,
      inbound_z04_message_id uuid,status text,lifecycle_blocked boolean,lifecycle_block_id uuid,paused_at timestamptz,power_of_attorney_id uuid,authorization_document_id uuid);
    create table public.ediel_messages(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,switch_request_id uuid,source_operation_id text,
      intent_id uuid,outbound_request_id uuid,direction text,message_standard text,message_family text,message_code text,environment text,status text,
      route_profile_id uuid,communication_route_id uuid,related_message_id uuid,external_reference text,immutable_payload_hash text,immutable_rendered_at timestamptz,raw_payload text,updated_by uuid,updated_at timestamptz default now());
    create table public.ediel_message_intents(id uuid primary key,company_id uuid,customer_id uuid,customer_site_id uuid,supplier_switch_request_id uuid,operation_id uuid,
      ediel_message_id uuid,outbound_request_id uuid,direction text,message_family text,message_code text,environment text,validation_status text,render_status text,
      outbox_status text,requested_effective_date date,route_profile_id uuid,communication_route_id uuid,payload jsonb,updated_by uuid,updated_at timestamptz default now());
    create table public.outbound_requests(id uuid primary key,company_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,source_type text,source_id uuid,operation_id uuid,
      request_type text,payload jsonb,communication_route_id uuid,status text,external_reference text,response_payload jsonb,updated_by uuid,updated_at timestamptz default now());
    create table public.ediel_outbox(id uuid primary key default gen_random_uuid(),company_id uuid,ediel_message_id uuid,intent_id uuid,source_message_id uuid,
      environment text,status text,lock_key text unique,route_profile_id uuid,message_family text,message_code text,priority integer,payload jsonb,
      immutable_payload_hash text,attempts integer not null default 0,send_attempt_count integer not null default 0,current_send_attempt_id uuid,
      locked_by text,locked_at timestamptz,blocked_at timestamptz,blocked_reason text,last_error text,queued_at timestamptz,created_by uuid,updated_by uuid,updated_at timestamptz default now());
    create table gridex_received_sources.switch_originals(message_id uuid primary key,company_id uuid,switch_id uuid,intent_id uuid,outbound_request_id uuid,
      payload_hash text,contract_id uuid,contract_hash text,recovery_operation_id uuid);
    create table gridex_ediel_transport.attempts(id uuid primary key default gen_random_uuid(),company_id uuid,environment text,message_id uuid,classification text,entered_at timestamptz,observed_at timestamptz);
    create table gridex_outbound_dispatch.attempts(id uuid primary key default gen_random_uuid(),company_id uuid,environment text,message_id uuid);
    create table gridex_outbound_dispatch.events(id uuid primary key default gen_random_uuid(),company_id uuid,environment text,message_id uuid,kind text);
    create table gridex_outbound_dispatch.originals(message_id uuid primary key,company_id uuid,environment text,raw_payload text,payload_hash text);
    create function public.fixture_guard(name text) returns void language plpgsql as $$begin
      if exists(select from public.fixture_flags where mode=name||'_fail') then raise exception 'synthetic_guard_failure:%',name; end if;
    end$$;
    create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as $$select not exists(select from public.fixture_flags where mode='permission_denied')$$;
    create function gridex_ediel_ack_replay.lock_current_graph_v2() returns void language sql as $$select public.fixture_guard('graph')$$;
    create function gridex_bilateral_prodat.lock_source_receipts_v1() returns void language sql as $$select public.fixture_guard('source_lock')$$;
    create function gridex_bilateral_prodat.lock_outbound_v1() returns void language sql as $$select public.fixture_guard('outbound_lock')$$;
    create function gridex_ediel_transport.require_message_intent_v1(public.ediel_messages) returns void language sql as $$select public.fixture_guard('intent')$$;
    -- Actual saved ABI: (COMPANY, message, actor), not (contract, message, actor).
    -- Reject a wrong dependency invocation instead of hiding an early native RETURN.
    create function public.fixture_native_args(c uuid,m uuid,a uuid) returns void language plpgsql as $$begin
      if not exists(select from public.ediel_messages where company_id=c and id=m)
        or not exists(select from public.user_profiles where id=a and user_status='active') then
        raise exception 'synthetic_native_argument_mismatch'; end if;
    end$$;
    create function gridex_received_sources.require_switch_contract_request_current_v1(c uuid,m uuid,a uuid) returns void language plpgsql as $$begin
      perform public.fixture_native_args(c,m,a); perform public.fixture_guard('contract_source'); end$$;
    create function gridex_received_sources.require_switch_brp_source_current_v1(c uuid,m uuid,a uuid) returns void language plpgsql as $$begin
      perform public.fixture_native_args(c,m,a); perform public.fixture_guard('brp_source'); end$$;
    create function gridex_bilateral_prodat.outbound_required_v1(text) returns boolean language sql as $$select exists(select from public.fixture_flags where mode='bilateral')$$;
    create function gridex_bilateral_prodat.require_outbound_original_v1(public.ediel_messages,boolean) returns void language sql as $$select public.fixture_guard('bilateral')$$;
    create function gridex_received_sources.production_contract_hash_v1(public.customer_contracts) returns text language sql as $$select ($1).metadata->>'fixtureHash'$$;
    create function public.gridex_assert_supplier_switch_ready(uuid,uuid) returns void language sql as $$select public.fixture_guard('readiness')$$;
    create function public.gridex_ediel_accepted_transport_projection_v1(uuid,text,uuid,uuid) returns jsonb language plpgsql as $$begin
      perform public.fixture_guard('accepted'); return (select data from public.fixture_flags where mode='accepted_projection'); end$$;
    create function public.gridex_ediel_repair_accepted_transport_projection_v1(uuid,text,uuid,uuid) returns jsonb language plpgsql as $$begin
      perform public.fixture_guard('repair'); if exists(select from public.fixture_flags where mode='repair_null') then return null; end if; update public.ediel_messages set status='sent' where company_id=$1 and environment=$2 and id=$4;
      return (select data from public.fixture_flags where mode='accepted_projection'); end$$;
    create function public.fixture_write_failure() returns trigger language plpgsql as $$begin
      perform public.fixture_guard(tg_table_name||'_write'); return new; end$$;
    create trigger fixture_outbox_failure before insert or update on public.ediel_outbox for each row execute function public.fixture_write_failure();
    create trigger fixture_message_failure before update on public.ediel_messages for each row execute function public.fixture_write_failure();
    create trigger fixture_intent_failure before update on public.ediel_message_intents for each row execute function public.fixture_write_failure();
    create trigger fixture_outbound_failure before update on public.outbound_requests for each row execute function public.fixture_write_failure();`)
  await db.exec(readFileSync('supabase/migrations/20261022120000_normal_supplier_switch_atomic_enqueue.sql', 'utf8'))
})
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec(`reset role; truncate public.fixture_flags,public.user_profiles,public.company_memberships,public.customer_contracts,public.supplier_switch_requests,
    public.ediel_messages,public.ediel_message_intents,public.outbound_requests,public.ediel_outbox,gridex_received_sources.switch_originals,
    gridex_ediel_transport.attempts,gridex_outbound_dispatch.attempts,gridex_outbound_dispatch.events,gridex_outbound_dispatch.originals`)
  await db.query("insert into public.user_profiles values($1,'active')", [actor])
  await db.query("insert into public.company_memberships values($1,$2,'active',true,now())", [co, actor])
  await db.query("insert into public.customer_contracts values($1,$2,$3,$4,'signed',now(),'v1',$5)", [contract, co, customer, point, { fixtureHash: contractHash }])
  await db.query(`insert into public.supplier_switch_requests values($1,$2,$3,$4,$4,$5,$6,$6,'switch','L','Z22','2027-04-01',$7,null,'prepared',false,null,null,null,null)`, [sw, co, customer, site, point, contract, message])
  await db.query(`insert into public.ediel_messages(id,company_id,customer_id,site_id,metering_point_id,switch_request_id,source_operation_id,intent_id,outbound_request_id,
    direction,message_standard,message_family,message_code,environment,status,route_profile_id,communication_route_id,immutable_payload_hash,immutable_rendered_at,raw_payload)
    values($1,$2,$3,$4,$5,$6::uuid,$6::text,$7,$8,'outbound','edifact','PRODAT','Z03','production','draft',$9,$10,$11,now(),$12)`, [message, co, customer, site, point, sw, intent, outbound, id(11), id(13), hash, raw])
  await db.query(`insert into public.ediel_message_intents(id,company_id,customer_id,customer_site_id,supplier_switch_request_id,operation_id,ediel_message_id,outbound_request_id,
    direction,message_family,message_code,environment,validation_status,render_status,outbox_status,requested_effective_date,route_profile_id,communication_route_id,payload)
    values($1,$2,$3,$4,$5,$5,$6,$7,'outbound','PRODAT','Z03','production','validated','rendered','not_queued','2027-04-01',$8,$9,$10)`,
    [intent, co, customer, site, sw, message, outbound, id(11), id(13), { transactionSubtype: 'L', reasonForTransaction: 'Z22', requestType: 'switch', power_of_attorney_id: null, documentReference: 'original-wire-reference' }])
  await db.query(`insert into public.outbound_requests(id,company_id,customer_id,site_id,metering_point_id,source_type,source_id,operation_id,request_type,payload,communication_route_id,status,response_payload)
    values($1,$2,$3,$4,$5,'supplier_switch_request',$6,$6,'supplier_switch','{"environment":"production"}',$7,'queued',$8)`, [outbound, co, customer, site, point, sw, id(13), { unrelated: 'keep' }])
  await db.query('insert into gridex_received_sources.switch_originals values($1,$2,$3,$4,$5,$6,$7,$8,null)', [message, co, sw, intent, outbound, hash, contract, contractHash])
})

describe('atomic same-original enqueue coordinator', () => {
  it('commits one outbox and all queue projections together without changing original bytes or wire references', async () => {
    const result = await run(); expect(result).toMatchObject({ status: 'queued', messageId: message, authorizesProviderEntry: false, deliveryProven: false })
    const rows = await snapshot(); expect(rows.ediel_outbox).toHaveLength(1)
    expect(result.outboxId).toBe(rows.ediel_outbox[0].id)
    expect(rows.ediel_messages[0]).toMatchObject({ id: message, status: 'queued', raw_payload: raw, immutable_payload_hash: hash })
    expect(rows.ediel_message_intents[0]).toMatchObject({ outbox_status: 'queued', payload: { documentReference: 'original-wire-reference' } })
    expect(rows.outbound_requests[0]).toMatchObject({ status: 'prepared', response_payload: { unrelated: 'keep', edielMessageId: message, edielOutboxQueued: true } })
  })
  it('reuses every durable row on lost-response replay without timestamp, attempts or identity resets', async () => {
    const first = await run(), before = await snapshot(); const second = await run()
    expect(second).toMatchObject({ status: 'queued', outboxId: first.outboxId }); expect(await snapshot()).toEqual(before)
  })
  it('repairs the genuine legacy queued-message/missing-outbox gap only for the same bound unattempted original', async () => {
    await db.exec("update public.ediel_messages set status='queued'")
    expect(await run()).toMatchObject({ status: 'queued', messageId: message })
    expect((await snapshot()).ediel_outbox).toHaveLength(1)
  })
  it.each(['ediel_outbox', 'ediel_messages', 'ediel_message_intents', 'outbound_requests'])('rolls back ALL projections if %s write fails', async table => {
    await flag(table + '_write_fail'); const before = await snapshot()
    await expect(run()).rejects.toThrow('synthetic_guard_failure')
    expect(await snapshot()).toEqual(before)
  })
  it.each(['intent', 'contract_source', 'brp_source', 'readiness'])('cannot omit the existing %s authority guard', async guard => {
    await flag(guard + '_fail'); const before = await snapshot()
    await expect(run()).rejects.toThrow('synthetic_guard_failure'); expect(await snapshot()).toEqual(before)
  })
  it('retains the existing bilateral-original guard for H', async () => {
    await flag('bilateral'); await flag('bilateral_fail')
    await db.exec(`update public.supplier_switch_requests set prodat_variant='H',prodat_reason='Z25';
      update public.ediel_message_intents set payload=payload||'{"transactionSubtype":"H","reasonForTransaction":"Z25"}'::jsonb`)
    const before = await snapshot(); await expect(run()).rejects.toThrow('synthetic_guard_failure'); expect(await snapshot()).toEqual(before)
  })
  it.each(['unknown', 'rejected', 'accepted', 'reserved'])('holds generic journal history %s without a separately qualified accepted receipt', async classification => {
    await db.query("insert into gridex_ediel_transport.attempts(company_id,environment,message_id,classification) values($1,'production',$2,$3)", [co, message, classification])
    const before = await snapshot(); expect(await run()).toMatchObject({ status: 'held', authorizesProviderEntry: false })
    expect(await snapshot()).toEqual(before)
  })
  it.each(['attempt', 'event'])('holds sealed dispatch %s history rather than resetting/resending', async kind => {
    const table = kind === 'attempt' ? 'attempts' : 'events'
    await db.query(`insert into gridex_outbound_dispatch.${table}(company_id,environment,message_id) values($1,'production',$2)`, [co, message])
    const before = await snapshot(); expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it('uses the existing accepted repair and NEVER creates a new outbox or attempt', async () => {
    await db.query("insert into gridex_ediel_transport.attempts(company_id,environment,message_id,classification) values($1,'production',$2,'accepted')", [co, message])
    await flag('accepted_projection', { status: 'accepted_projection', companyId: co, environment: 'production', messageId: message,
      originalHash: hash, attemptId: id(20), observedAt: '2026-10-21T12:00:00Z', authorizesProviderEntry: false, deliveryProven: false })
    expect(await run()).toMatchObject({ status: 'accepted', messageId: message, deliveryProven: false, authorizesProviderEntry: false })
    const rows = await snapshot(); expect(rows.ediel_outbox).toHaveLength(0); expect(rows.ediel_messages[0].status).toBe('sent')
    expect((await db.query('select id from gridex_ediel_transport.attempts')).rows).toHaveLength(1)
  })
  it.each(['failed', 'blocked', 'superseded', 'sent', 'delivery_uncertain'])('does not reset an existing %s outbox', async status => {
    await queuedOutbox(status); const before = await snapshot(); expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it('does not arbitrarily choose an ambiguous original queue entry', async () => {
    await queuedOutbox(); await db.exec("insert into public.ediel_outbox select gen_random_uuid(),company_id,ediel_message_id,intent_id,source_message_id,environment,status,lock_key||':other',route_profile_id,message_family,message_code,priority,payload,immutable_payload_hash,attempts,send_attempt_count,current_send_attempt_id,locked_by,locked_at,blocked_at,blocked_reason,last_error,queued_at,created_by,updated_by,updated_at from public.ediel_outbox")
    const before = await snapshot(); expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it.each(['completed', 'cancelled', 'failed', 'superseded'])('does not change current source state %s', async status => {
    await db.query('update public.supplier_switch_requests set status=$1', [status]); const before = await snapshot()
    expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it('does not mint a missing native original binding', async () => {
    await db.exec('delete from gridex_received_sources.switch_originals'); const before = await snapshot()
    expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it.each(['company_id', 'customer_id', 'site_id', 'metering_point_id', 'intent_id', 'outbound_request_id'])('holds a wrong original %s without assigning another scope', async key => {
    await db.query(`update public.ediel_messages set ${key}=$1`, [id(99)]); const before = await snapshot()
    expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it('holds changed raw bytes, expected hash or current contract hash', async () => {
    const before = await snapshot(); expect(await run([undefined, undefined, undefined, undefined, undefined, undefined, 'c'.repeat(64)])).toMatchObject({ status: 'held' })
    expect(await snapshot()).toEqual(before)
    await db.exec("update public.ediel_messages set raw_payload='changed original'"); expect(await run()).toMatchObject({ status: 'held' })
    await db.query('update public.ediel_messages set raw_payload=$1', [raw]); await db.query('update public.customer_contracts set metadata=$1', [{ fixtureHash: 'changed' }])
    expect(await run()).toMatchObject({ status: 'held' }); expect((await snapshot()).ediel_outbox).toHaveLength(0)
  })
  it('refuses an inactive or unauthorized actor before any queue write', async () => {
    await db.exec("update public.user_profiles set user_status='inactive'")
    await expect(run()).rejects.toMatchObject({ code: '42501' }); expect((await snapshot()).ediel_outbox).toHaveLength(0)
    await db.exec("update public.user_profiles set user_status='active'"); await flag('permission_denied')
    await expect(run()).rejects.toMatchObject({ code: '42501' }); expect((await snapshot()).ediel_outbox).toHaveLength(0)
  })
  it.each([
    "update public.supplier_switch_requests set requested_start_date='2027-04-02'",
    "update public.supplier_switch_requests set customer_site_id='00000000-0000-4000-8000-000000000099'",
    "update public.supplier_switch_requests set contract_id='00000000-0000-4000-8000-000000000099'",
    "update public.supplier_switch_requests set inbound_z04_message_id='00000000-0000-4000-8000-000000000099'",
    "update public.customer_contracts set signed_version=null",
    "update public.supplier_switch_requests set power_of_attorney_id='00000000-0000-4000-8000-000000000099'",
    "update public.supplier_switch_requests set authorization_document_id='00000000-0000-4000-8000-000000000099'",
    "update public.supplier_switch_requests set lifecycle_blocked=true",
    "update public.supplier_switch_requests set lifecycle_block_id='00000000-0000-4000-8000-000000000099'",
    "update public.supplier_switch_requests set paused_at=now()",
    "update public.supplier_switch_requests set prodat_variant='C'",
    "update public.supplier_switch_requests set request_type='withdrawal'",
    "update public.supplier_switch_requests set prodat_reason='Z25'",
    "update public.supplier_switch_requests set outbound_z03_message_id=null",
    "update public.ediel_messages set status='failed'",
    "update public.ediel_message_intents set outbox_status='sent'",
    "update public.ediel_message_intents set render_status='not_rendered'",
    "update public.outbound_requests set status='cancelled'",
    "update public.outbound_requests set payload='{}'",
    "update public.customer_contracts set status='cancelled'",
    "update gridex_received_sources.switch_originals set recovery_operation_id='00000000-0000-4000-8000-000000000099'",
  ])('holds a current source change without repairing it: %s', async change => {
    await db.exec(change); const before = await snapshot()
    expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it('does not treat a null explicit request document as removal of the real POA-derived original document', async () => {
    await db.query('update public.ediel_message_intents set payload=payload||$1::jsonb', [{ authorization_document_id: id(99) }])
    expect(await run()).toMatchObject({ status: 'queued' })
  })
  it('queues an untouched prepared outbox without replacing its payload or identity', async () => {
    await queuedOutbox('prepared'); expect(await run()).toMatchObject({ status: 'queued', outboxId: id(12) })
    expect((await snapshot()).ediel_outbox[0]).toMatchObject({ payload: { unrelated: 'keep' }, attempts: 0, send_attempt_count: 0 })
  })
  it.each([
    'attempts=1', 'send_attempt_count=1', "current_send_attempt_id='00000000-0000-4000-8000-000000000099'",
    "locked_by='previous-worker'", 'locked_at=now()', "last_error='previous failure'", 'blocked_at=now()', "blocked_reason='hold'",
  ])('never clears prior queue state: %s', async change => {
    await queuedOutbox(); await db.exec('update public.ediel_outbox set '+change); const before = await snapshot()
    expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it('refuses a sealed original from a different scope/hash even without an attempt', async () => {
    await db.query("insert into gridex_outbound_dispatch.originals values($1,$2,'production',$3,$4)", [message, id(99), raw, hash])
    const before = await snapshot(); expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it.each(['accepted', 'repair'])('rolls back accepted-path failures without creating transport: %s', async guard => {
    await db.query("insert into gridex_ediel_transport.attempts(company_id,environment,message_id) values($1,'production',$2)", [co, message])
    await flag('accepted_projection', { status: 'accepted_projection', companyId: co, environment: 'production', messageId: message,
      originalHash: hash, attemptId: id(20), observedAt: '2026-10-21T12:00:00Z', authorizesProviderEntry: false, deliveryProven: false })
    await flag(guard+'_fail'); const before = await snapshot()
    await expect(run()).rejects.toThrow('synthetic_guard_failure'); expect(await snapshot()).toEqual(before)
  })
  it('refuses absent signed-contract hash even when both current and binding values are null', async () => {
    await db.exec("update public.customer_contracts set metadata='{}'; update gridex_received_sources.switch_originals set contract_hash=null")
    const before=await snapshot(); expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it.each(['response_payload', 'payload'])('refuses a nonobject outbound %s', async column => {
    await db.query(`update public.outbound_requests set ${column}=$1::jsonb`, [['bad']])
    const before=await snapshot(); expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it.each([0, 599000, 600000, 1200000, -60000])('observes a current claim only inside strict ten-minute lease: age %s ms', async age => {
    await queuedOutbox('sending')
    await db.exec("update public.ediel_messages set status='queued'; update public.ediel_message_intents set outbox_status='queued'; update public.outbound_requests set status='prepared'")
    await db.query("update public.ediel_outbox set attempts=1,send_attempt_count=1,current_send_attempt_id=$2,locked_by='existing-worker',locked_at=clock_timestamp()-($1::integer*interval '1 millisecond')", [age,id(25)])
    const before=await snapshot(); expect(await run()).toMatchObject({ status: age>=0&&age<600000?'in_progress':'held' }); expect(await snapshot()).toEqual(before)
  })
  it('cannot claim accepted when the existing authoritative repair no longer returns a receipt', async () => {
    await db.query("insert into gridex_ediel_transport.attempts(company_id,environment,message_id) values($1,'production',$2)", [co, message])
    await flag('accepted_projection', { status: 'accepted_projection', companyId: co, environment: 'production', messageId: message,
      originalHash: hash, attemptId: id(20), observedAt: '2026-10-21T12:00:00Z', authorizesProviderEntry: false, deliveryProven: false })
    await flag('repair_null'); const before=await snapshot()
    await expect(run()).rejects.toThrow('normal_switch_enqueue_accepted_repair_unconfirmed'); expect(await snapshot()).toEqual(before)
  })
  it.each(['contract_source','brp_source'])('passes exact COMPANY/message/actor to the native %s boundary', async guard => {
    await flag(guard+'_fail')
    await expect(run()).rejects.toThrow('synthetic_guard_failure:'+guard)
    expect((await snapshot()).ediel_outbox).toHaveLength(0)
  })
  it('does not invent an active claim from a worker/time with no attempt or incremented counters', async () => {
    await queuedOutbox('sending'); await db.exec("update public.ediel_messages set status='queued'; update public.ediel_message_intents set outbox_status='queued'; update public.outbound_requests set status='prepared'; update public.ediel_outbox set locked_by='invented',locked_at=now()")
    const before=await snapshot(); expect(await run()).toMatchObject({ status: 'held' }); expect(await snapshot()).toEqual(before)
  })
  it('is service-only with fixed searchpath and no public or authenticated execution grant', async () => {
    const rows = (await db.query<Row>(`select prosecdef,proconfig,
      has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as staff,
      has_function_privilege('service_role',oid,'execute') as service from pg_proc
      where oid='public.gridex_enqueue_normal_supplier_switch_v1(uuid,uuid,uuid,uuid,uuid,uuid,text)'::regprocedure`)).rows
    expect(rows[0]).toMatchObject({ prosecdef: true, anon: false, staff: false, service: true, proconfig: ['search_path=pg_catalog'] })
    await db.exec('set role authenticated'); await expect(run()).rejects.toMatchObject({ code: '42501' }); await db.exec('reset role')
  })
})
