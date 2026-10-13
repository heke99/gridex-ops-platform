import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const company = '11111111-1111-4111-8111-111111111111'
const otherCompany = '22222222-2222-4222-8222-222222222222'
const manual = '33333333-3333-4333-8333-333333333333'
const secondManual = '44444444-4444-4444-8444-444444444444'
const migration = readFileSync('supabase/migrations/20261013123314_manual_inbound_event_source_consistency.sql', 'utf8')
let db: PGlite

async function raw(id = manual, owner: string | null = null) {
  await db.query('insert into public.manual_inbound_messages(id,company_id) values($1,$2)', [id, owner])
}

async function event(source = manual, owner: string | null = null, transport = 'email') {
  await db.query(`insert into public.inbound_operation_events
    (source_transport,source_id,company_id,tenant_resolution_status,idempotency_key,evidence)
    values($1,$2,$3,$4,$1||':'||$2,'{"fixture":"retained"}')
    on conflict(idempotency_key) do update set company_id=excluded.company_id,
      tenant_resolution_status=excluded.tenant_resolution_status`,
  [transport, source, owner, owner ? 'matched' : 'unmatched'])
}

async function rejected(action: () => Promise<unknown>, code: string) {
  await db.exec('savepoint rejected_write')
  await expect(action()).rejects.toMatchObject({ code })
  await db.exec('rollback to savepoint rejected_write')
}

describe('manual-email event source identity and tenant integrity', () => {
  beforeAll(async () => {
    db = new PGlite()
    await db.exec('create table public.companies(id uuid primary key)')
    const schema = readFileSync('supabase/schema.sql', 'utf8')
    for (const table of ['manual_inbound_messages', 'inbound_operation_events']) {
      const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0]
      if (!ddl) throw new Error('Missing production DDL: ' + table)
      await db.exec(ddl)
      await db.exec(`alter table public.${table} add primary key(id);
        alter table public.${table} add foreign key(company_id) references public.companies(id) on delete set null;`)
    }
    await db.exec('create unique index inbound_operation_events_idempotency_uidx on public.inbound_operation_events(idempotency_key)')
    await db.exec(migration)
    await db.exec(migration)
  }, 30_000)
  beforeEach(async () => {
    await db.exec('begin')
    await db.query('insert into public.companies(id) values($1),($2)', [company, otherCompany])
  })
  afterEach(async () => { await db.exec('rollback;delete from public.companies') })
  afterAll(async () => { await db.close() })

  it('rejects a late in-flight event insert after its previously read manual source was deleted', async () => {
    await raw()
    const observedSource = (await db.query<{ id: string }>('select id from public.manual_inbound_messages')).rows[0].id
    await db.query('delete from public.manual_inbound_messages where id=$1', [manual])
    await db.exec('commit;begin') // the source reset committed before the stale retry
    await rejected(() => event(observedSource), '23503')
    expect((await db.query('select id from public.inbound_operation_events')).rows).toEqual([])
  })

  it('rejects cross-company inserts and upsert reassignment while preserving the owned event', async () => {
    await raw(manual, company)
    await rejected(() => event(manual, otherCompany), '23503')
    await event(manual, company)
    await rejected(() => event(manual, otherCompany), '23503')
    expect((await db.query('select company_id,manual_inbound_message_id from public.inbound_operation_events')).rows)
      .toEqual([{ company_id: company, manual_inbound_message_id: manual }])
  })

  it('anchors unresolved NULL-company sources and supports their later owned resolution', async () => {
    await raw()
    await event()
    await raw(secondManual, company)
    await event(secondManual)
    expect((await db.query<{ n: number }>('select count(*)::int n from public.inbound_operation_events where company_id is null')).rows[0].n).toBe(2)
    await rejected(() => event(manual, company), '23503') // parent ownership still unresolved
    await db.query('update public.manual_inbound_messages set company_id=$1 where id=$2', [company, manual])
    await event(manual, company)
    expect((await db.query<{ n: number }>('select count(*)::int n from public.inbound_operation_events')).rows[0].n).toBe(2)
  })

  it('deletes only derived email events and retains identical-source Ediel and other-transport history', async () => {
    await raw(manual, company)
    await event(manual, company)
    await event(manual, company, 'edifact')
    await event('provider:legacy/reference', company, 'api')
    await event('webhook:non-uuid', null, 'webhook')
    const retained = (await db.query("select * from public.inbound_operation_events where source_transport<>'email' order by id")).rows
    await db.query('delete from public.manual_inbound_messages where id=$1', [manual])
    expect((await db.query("select id from public.inbound_operation_events where source_transport='email'")).rows).toEqual([])
    expect((await db.query("select * from public.inbound_operation_events where source_transport<>'email' order by id")).rows).toEqual(retained)
  })

  it.each(['not-a-uuid', '', 'provider:message-id'])('rejects malformed email source %j without restricting other transports', async source => {
    await rejected(() => event(source), '22P02')
    await event(source, null, 'api')
    expect((await db.query('select manual_inbound_message_id from public.inbound_operation_events')).rows)
      .toEqual([{ manual_inbound_message_id: null }])
  })

  it('checks source and ownership again when an event transport changes to email', async () => {
    await raw(manual, company)
    await event(manual, otherCompany, 'edifact')
    await rejected(() => db.query("update public.inbound_operation_events set source_transport='email'"), '23503')
    await db.query('update public.inbound_operation_events set company_id=$1', [company])
    await db.query("update public.inbound_operation_events set source_transport='email'")
    expect((await db.query('select manual_inbound_message_id from public.inbound_operation_events')).rows)
      .toEqual([{ manual_inbound_message_id: manual }])
  })
})
