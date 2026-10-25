// reality-defects: GOR-06
// GOR-06 / owner decision 27: the dispatch guard (zz_supplier_switch_dispatch_readiness) re-ran the full readiness
// check on every write of a switch in a dispatch status, also when its Z03 was already sent; a later withdrawal then
// made the handling of that switch's acks throw. Migration 20261025100000 skips the re-check only for continued
// handling of an already sent switch, and adds gridex_record_switch_final_ack_v1 (prepared -> submitted on the
// positive final ack; compare-and-set, idempotent). These tests run the captured guard pre-image (supabase/schema.sql)
// and the migration in embedded PostgreSQL over the real trigger.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const migration = read('supabase/migrations/20261025100000_gor06_sent_switch_continued_handling.sql')
const C = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999'
const CT = '22222222-2222-4222-8222-222222222222', CT2 = '33333333-3333-4333-8333-333333333333'
const Z03 = '44444444-4444-4444-8444-444444444444', Z03B = '55555555-5555-4555-8555-555555555555'

function guardPreImage() {
  const schema = read('supabase/schema.sql')
  const start = schema.indexOf('CREATE FUNCTION public.gridex_guard_supplier_switch_dispatch(')
  const body = /AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(schema.slice(start))![2]
  expect(sha(body)).toBe('2d19ebb55c7c6327b12b63f345dd53be59e29771284a9095f2723659a7d808cf')
  return body
}

async function freshDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema extensions;
    create table public.supplier_switch_requests(id uuid primary key, company_id uuid not null, status text, contract_id uuid, customer_contract_id uuid,
      metadata jsonb default '{}', outbound_z03_message_id uuid, submitted_at timestamptz, updated_at timestamptz, updated_by uuid,
      readiness_snapshot jsonb, readiness_checked_at timestamptz);
    create table public.supplier_switch_events(id serial, switch_request_id uuid, event_type text, event_status text, message text, payload jsonb, company_id uuid, created_by uuid);
    create table public.ediel_message_ack_state_v(id uuid, company_id uuid, canonical_ack_state text);
    -- Readiness: refused for every contract in public.not_ready (e.g. the customer withdrew after sending).
    create table public.not_ready(contract_id uuid);
    create function public.gridex_assert_supplier_switch_ready(c uuid, ct uuid) returns jsonb language plpgsql as $$
      begin if exists(select from public.not_ready n where n.contract_id=ct) then raise exception using errcode='23514', message='withdrawal_requested'; end if;
      return jsonb_build_object('ready', true); end $$;
    create function public.gridex_assert_switch_writer_v1(c uuid) returns void language plpgsql as $$
      begin if c is null then raise exception 'supplier_switch_company_required'; end if;
      if current_setting('test.writer', true) = 'denied' then raise exception using errcode='42501', message='supplier_switch_write_not_allowed'; end if; end $$;
  `)
  await db.exec(`CREATE FUNCTION public.gridex_guard_supplier_switch_dispatch() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $pre$${guardPreImage()}$pre$;
    CREATE TRIGGER zz_supplier_switch_dispatch_readiness BEFORE INSERT OR UPDATE OF status, contract_id, customer_contract_id, metadata ON public.supplier_switch_requests FOR EACH ROW EXECUTE FUNCTION public.gridex_guard_supplier_switch_dispatch();`)
  return db
}

async function sentSwitch(db: PGlite, id: string, ack: string | null = 'aperak_received_positive') {
  await db.query('delete from public.not_ready where contract_id=$1', [CT]) // ready when it is dispatched
  await db.query("insert into public.supplier_switch_requests(id,company_id,status,contract_id,customer_contract_id) values($1,$2,'queued',$3,$3)", [id, C, CT])
  // Sending binds the original (prepared): not a dispatch status, so no readiness check either way.
  await db.query("update public.supplier_switch_requests set status='prepared', outbound_z03_message_id=$2 where id=$1", [id, Z03])
  if (ack) await db.query('insert into public.ediel_message_ack_state_v values($1,$2,$3)', [Z03, C, ack])
  await db.query('insert into public.not_ready values($1)', [CT]) // the customer withdrew after sending
}
const attempt = async (db: PGlite, sql: string, params: unknown[] = []) => { try { await db.query(sql, params); return 'ok' } catch (e) { return (e as Error).message } }
const recordAck = async (db: PGlite, sw: string, source = Z03, company = C) =>
  (await db.query<{ r: Record<string, unknown> }>('select public.gridex_record_switch_final_ack_v1($1,$2,$3) r', [company, sw, source])).rows[0].r
const events = async (db: PGlite, sw: string) => Number((await db.query<{ n: number }>("select count(*)::int n from public.supplier_switch_events where switch_request_id=$1 and event_status='submitted'", [sw])).rows[0].n)

describe('GOR-06 a sent switch is handled without re-running the dispatch readiness', () => {
  it('before: handling an already sent switch is refused by a readiness change after sending', async () => {
    const db = await freshDb()
    await sentSwitch(db, 'a0000000-0000-4000-8000-000000000001')
    expect(await attempt(db, "update public.supplier_switch_requests set status='submitted' where id='a0000000-0000-4000-8000-000000000001'")).toBe('withdrawal_requested')
    await db.close()
  })

  it('after: continued handling passes; a new dispatch, a new Z03 binding and a contract change are still checked', async () => {
    const db = await freshDb()
    const meta = (await db.query("select to_jsonb(p)-'prosrc'-'oid' m from pg_proc p where proname='gridex_guard_supplier_switch_dispatch'")).rows[0]
    await db.exec(migration)
    expect((await db.query("select to_jsonb(p)-'prosrc'-'oid' m from pg_proc p where proname='gridex_guard_supplier_switch_dispatch'")).rows[0]).toEqual(meta)
    const sw = 'a0000000-0000-4000-8000-000000000002'
    await sentSwitch(db, sw)
    expect(await attempt(db, "update public.supplier_switch_requests set metadata=metadata||'{\"x\":1}' where id=$1", [sw])).toBe('ok')
    expect(await attempt(db, "update public.supplier_switch_requests set status='submitted' where id=$1", [sw])).toBe('ok')
    // A new dispatch is checked: insert, a first Z03 binding, a changed Z03 binding, a changed contract.
    expect(await attempt(db, "insert into public.supplier_switch_requests(id,company_id,status,contract_id) values('a0000000-0000-4000-8000-000000000003',$1,'queued',$2)", [C, CT])).toBe('withdrawal_requested')
    await db.query("insert into public.supplier_switch_requests(id,company_id,status,contract_id,customer_contract_id) values('a0000000-0000-4000-8000-000000000004',$1,'draft',$2,$2)", [C, CT])
    expect(await attempt(db, "update public.supplier_switch_requests set status='queued' where id='a0000000-0000-4000-8000-000000000004'")).toBe('withdrawal_requested')
    expect(await attempt(db, "update public.supplier_switch_requests set outbound_z03_message_id=$2, status='queued' where id=$1", [sw, Z03B])).toBe('withdrawal_requested')
    await db.query('insert into public.not_ready values($1)', [CT2])
    expect(await attempt(db, "update public.supplier_switch_requests set customer_contract_id=$2, contract_id=$2 where id=$1", [sw, CT2])).toBe('withdrawal_requested')
    await db.close()
  })

  it('the final ack moves prepared to submitted once, atomically with one event; a replay is a no-op', async () => {
    const db = await freshDb(); await db.exec(migration)
    const sw = 'a0000000-0000-4000-8000-000000000005'
    await sentSwitch(db, sw)
    expect(await recordAck(db, sw)).toMatchObject({ applied: true, status: 'submitted' })
    expect(await recordAck(db, sw)).toMatchObject({ applied: false, reason: 'status_submitted' })
    expect(await events(db, sw)).toBe(1)
    const row = (await db.query<{ status: string; submitted_at: string | null }>('select status, submitted_at from public.supplier_switch_requests where id=$1', [sw])).rows[0]
    expect(row.status).toBe('submitted'); expect(row.submitted_at).not.toBeNull()
    await db.close()
  })

  it('a positive ack alone never confirms, and nothing moves without the switch\'s own final positive ack', async () => {
    const db = await freshDb(); await db.exec(migration)
    for (const [n, ack] of [[6, 'awaiting_contrl'], [7, 'failed'], [8, null]] as const) {
      const sw = `a0000000-0000-4000-8000-00000000000${n}`
      await db.query('delete from public.ediel_message_ack_state_v')
      await sentSwitch(db, sw, ack)
      expect(await recordAck(db, sw)).toMatchObject({ applied: false, reason: 'final_positive_ack_missing' })
    }
    const sw = 'a0000000-0000-4000-8000-000000000009'
    await sentSwitch(db, sw)
    expect(await recordAck(db, sw, Z03B)).toMatchObject({ applied: false, reason: 'not_the_switch_original' })
    for (const status of ['accepted', 'completed', 'cancellation_requested', 'failed']) {
      await db.query('update public.supplier_switch_requests set status=$2 where id=$1', [sw, status])
      expect(await recordAck(db, sw)).toMatchObject({ applied: false, reason: `status_${status}` })
    }
    expect((await db.query("select count(*)::int n from public.supplier_switch_requests where status='accepted' and id<>$1", [sw])).rows[0]).toEqual({ n: 0 })
    await db.close()
  })

  it('keeps tenant and writer checks', async () => {
    const db = await freshDb(); await db.exec(migration)
    const sw = 'a0000000-0000-4000-8000-000000000010'
    await sentSwitch(db, sw)
    await expect(recordAck(db, sw, Z03, OTHER)).rejects.toThrow('supplier_switch_not_found_for_tenant')
    await db.exec("select set_config('test.writer','denied',false)")
    await expect(recordAck(db, sw)).rejects.toThrow('supplier_switch_write_not_allowed')
    await db.close()
  })

  it('refuses to install over any other guard body', async () => {
    const db = await freshDb()
    await db.exec("create or replace function public.gridex_guard_supplier_switch_dispatch() returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $$begin return new; end$$")
    await expect(db.exec(migration)).rejects.toThrow('gor06_dispatch_guard_pre_image_changed')
    await db.close()
  })
})
