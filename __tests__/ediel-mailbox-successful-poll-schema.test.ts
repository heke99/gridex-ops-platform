// EDIEL03.03 prerequisite: successful mailbox polling must have a real nullable
// timestamp column and retain the existing exact-owner/timestamp lease fence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const port = vi.hoisted(() => ({ db: null as PGlite | null }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    if (table !== 'ediel_mailboxes') throw new Error('unexpected table')
    let patch: Record<string, unknown> = {}
    const filters: Array<[string, unknown]> = []
    const q = {
      update(value: Record<string, unknown>) { patch = value; return q },
      eq(key: string, value: unknown) { filters.push([key, value]); return q },
      select() { return q },
      async maybeSingle() {
        const entries = Object.entries(patch)
        // Values are parameters; the test port leaves SQL column and lease
        // semantics to real PostgreSQL, rather than accepting arbitrary fields.
        const identifier = (key: string) => {
          if (!/^[a-z_]+$/.test(key)) throw new Error('invalid identifier')
          return `"${key}"`
        }
        const assignments = entries.map(([key], i) => `${identifier(key)}=$${i + 1}`)
        const where = filters.map(([key], i) => `${identifier(key)}=$${entries.length + i + 1}`)
        try {
          const out = await port.db!.query<{ id: string }>(
            `update public.ediel_mailboxes set ${assignments.join(',')} where ${where.join(' and ')} returning id`,
            [...entries.map(([, value]) => value), ...filters.map(([, value]) => value)],
          )
          return { data: out.rows[0] ?? null, error: null }
        } catch (error) { return { data: null, error } }
      },
    }
    return q
  },
} }))
import { markMailboxPollFinished } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

const migration = () => readFileSync(path.resolve('supabase/migrations/20261103222042_ediel_mailbox_successful_poll_timestamp_forward.sql'), 'utf8')
const claim = { id: '00000000-0000-4000-8000-000000000001', locked_by: 'current:one', locked_at: '2026-11-03T10:00:00.000Z' }
const now = '2026-11-03T10:01:00.000Z'
beforeEach(async () => {
  port.db = new PGlite()
  await port.db.exec(`create table public.ediel_mailboxes (
    id uuid primary key, locked_by text, locked_at timestamptz,
    last_error text, updated_at timestamptz, last_polled_at timestamptz
  ); insert into public.ediel_mailboxes values
    ('${claim.id}', '${claim.locked_by}', '${claim.locked_at}', 'previous failure', '2026-11-03T09:00:00Z', '2026-11-03T09:30:00Z'),
    ('00000000-0000-4000-8000-000000000002', 'other:two', '2026-11-03T09:50:00Z', 'other failure', '2026-11-03T09:00:00Z', '2026-11-03T09:20:00Z');`)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now))
})
afterEach(async () => { vi.useRealTimers(); await port.db?.close(); port.db = null })

describe('canonical mailbox successful-poll forward migration', () => {
  it('adds an initially NULL nullable timestamptz without a default, preserving every existing row', async () => {
    await port.db!.exec(migration())
    const column = await port.db!.query(`select data_type, is_nullable, column_default from information_schema.columns
      where table_schema='public' and table_name='ediel_mailboxes' and column_name='last_successful_poll_at'`)
    expect(column.rows).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null }])
    const rows = await port.db!.query(`select count(*)::int as total, count(last_successful_poll_at)::int as successful from public.ediel_mailboxes`)
    expect(rows.rows).toEqual([{ total: 2, successful: 0 }])
  })

  it('lets the real current owner record success and clear only its own lease/error', async () => {
    await port.db!.exec(migration())
    const otherBefore = await port.db!.query(`select to_jsonb(m) as row from public.ediel_mailboxes m where id='00000000-0000-4000-8000-000000000002'`)
    await expect(markMailboxPollFinished({ claim, ok: true })).resolves.toBe(true)
    const row = await port.db!.query(`select last_successful_poll_at='${now}'::timestamptz as exact_success,
      updated_at='${now}'::timestamptz as exact_update, locked_at is null and locked_by is null as released,
      last_error is null as error_cleared, last_polled_at='2026-11-03T09:30:00Z'::timestamptz as poll_preserved
      from public.ediel_mailboxes where id='${claim.id}'`)
    expect(row.rows).toEqual([{ exact_success: true, exact_update: true, released: true, error_cleared: true, poll_preserved: true }])
    const otherAfter = await port.db!.query(`select to_jsonb(m) as row from public.ediel_mailboxes m where id='00000000-0000-4000-8000-000000000002'`)
    expect(otherAfter.rows).toEqual(otherBefore.rows)
  })

  it('refuses displaced-owner and wrong-timestamp success without changing current state', async () => {
    await port.db!.exec(migration())
    const before = await port.db!.query('select to_jsonb(m) as row from public.ediel_mailboxes m order by id')
    await expect(markMailboxPollFinished({ claim: { ...claim, locked_by: 'stale:old' }, ok: true })).resolves.toBe(false)
    await expect(markMailboxPollFinished({ claim: { ...claim, locked_at: '2026-11-03T09:59:00.000Z' }, ok: true })).resolves.toBe(false)
    const after = await port.db!.query('select to_jsonb(m) as row from public.ediel_mailboxes m order by id')
    expect(after.rows).toEqual(before.rows)
  })

  it('preserves a prior success and lease when the additive migration is applied again', async () => {
    await port.db!.exec(migration())
    await port.db!.exec(`update public.ediel_mailboxes set last_successful_poll_at='2026-11-02T10:00:00Z' where id='${claim.id}'`)
    const before = await port.db!.query('select to_jsonb(m) as row from public.ediel_mailboxes m order by id')
    await port.db!.exec(migration())
    const after = await port.db!.query('select to_jsonb(m) as row from public.ediel_mailboxes m order by id')
    expect(after.rows).toEqual(before.rows)
  })

  it('notifies the existing PostgREST schema listener after the transaction commits', async () => {
    const notifications: string[] = []
    const unlisten = await port.db!.listen('pgrst', payload => { notifications.push(payload) })
    await port.db!.exec(migration())
    expect(notifications).toEqual(['reload schema'])
    await unlisten()
  })
})
