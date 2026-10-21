import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migration = fs.readFileSync(path.resolve(import.meta.dirname, '../supabase/migrations/20261020152428_public_password_reset_budget.sql'), 'utf8')
const key = (value: string) => createHash('sha256').update(`synthetic-fixture:${value}`).digest('hex')
let db: PGlite
async function consume(email: string, client: string) {
  const result = await db.query<{ allowed: boolean }>('select public.gridex_consume_public_password_reset_budget_v1($1, $2) as allowed', [key(email), key(client)])
  return result.rows[0].allowed
}
async function ageEmail(email: string) {
  await db.query("update gridex_private.public_password_reset_budget set next_allowed_at = clock_timestamp() - interval '1 second' where scope = 'email' and bucket_key = $1", [key(email)])
}

beforeEach(async () => {
  db = new PGlite()
  await db.exec('create role anon; create role authenticated; create role service_role; create schema gridex_private; grant usage on schema gridex_private to authenticated;')
  await db.exec(migration)
}, 20_000)
afterEach(async () => { await db.close() })

describe('real public password reset budget migration', () => {
  it('reserves once and enforces address cooldown despite changing client keys', async () => {
    expect(await consume('address', 'client-1')).toBe(true)
    expect(await consume('address', 'client-2')).toBe(false)
    expect(await consume('address', 'client-3')).toBe(false)
    const rows = await db.query<{ scope: string; request_count: number }>('select scope, request_count from gridex_private.public_password_reset_budget order by scope')
    expect(rows.rows).toEqual([{ scope: 'client', request_count: 1 }, { scope: 'email', request_count: 1 }, { scope: 'global', request_count: 1 }])
  })

  it('caps one address at five accepted reservations per hour even with rotating clients', async () => {
    for (let n = 0; n < 5; n++) {
      await ageEmail('address')
      expect(await consume('address', `client-${n}`)).toBe(true)
    }
    await ageEmail('address')
    expect(await consume('address', 'new-client')).toBe(false)
    await db.exec("update gridex_private.public_password_reset_budget set window_started_at = clock_timestamp() - interval '2 hours' where scope = 'email'")
    expect(await consume('address', 'new-client')).toBe(true)
  })

  it('caps a client or shared unknown-client bucket across different addresses and resets its window', async () => {
    for (let n = 0; n < 10; n++) expect(await consume(`address-${n}`, 'shared-client')).toBe(true)
    expect(await consume('address-11', 'shared-client')).toBe(false)
    await db.exec("update gridex_private.public_password_reset_budget set window_started_at = clock_timestamp() - interval '11 minutes' where scope = 'client'")
    expect(await consume('address-11', 'shared-client')).toBe(true)
  })

  it('caps global accepted reservations before allocating attacker-controlled address/client rows', async () => {
    for (let n = 0; n < 120; n++) expect(await consume(`address-${n}`, `client-${n}`)).toBe(true)
    const before = await db.query('select count(*)::int as n from gridex_private.public_password_reset_budget')
    for (let n = 120; n < 135; n++) expect(await consume(`address-${n}`, `spoofed-${n}`)).toBe(false)
    expect((await db.query('select count(*)::int as n from gridex_private.public_password_reset_budget')).rows).toEqual(before.rows)
    await db.exec("update gridex_private.public_password_reset_budget set window_started_at = clock_timestamp() - interval '2 minutes' where scope = 'global'")
    expect(await consume('fresh-address', 'fresh-client')).toBe(true)
  })

  it('does not charge the address or global tier when the client tier denies admission', async () => {
    for (let n = 0; n < 10; n++) expect(await consume(`address-${n}`, 'full-client')).toBe(true)
    expect(await consume('not-yet-admitted', 'full-client')).toBe(false)
    const result = await db.query<{ request_count: number }>("select request_count from gridex_private.public_password_reset_budget where scope = 'global'")
    expect(result.rows[0].request_count).toBe(10)
    const address = await db.query('select 1 from gridex_private.public_password_reset_budget where scope = $1 and bucket_key = $2', ['email', key('not-yet-admitted')])
    expect(address.rows).toEqual([])
    expect(await consume('not-yet-admitted', 'different-client')).toBe(true)
  })

  it('preserves the address cooldown across an hourly window boundary', async () => {
    expect(await consume('address', 'client')).toBe(true)
    await db.exec("update gridex_private.public_password_reset_budget set window_started_at = clock_timestamp() - interval '2 hours' where scope = 'email'")
    expect(await consume('address', 'other-client')).toBe(false)
    await ageEmail('address')
    expect(await consume('address', 'other-client')).toBe(true)
  })

  it('serializes repeated reservations to one admission in a queued local burst', async () => {
    // PGlite executes actual SQL but queues one connection. Native multi-session
    // lock contention is a separate producer check, not claimed by this test.
    const results = await Promise.all(Array.from({ length: 20 }, (_, n) => consume('same-address', `client-${n}`)))
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('cleans expired private counters in bounded batches without removing the stable global lock', async () => {
    await db.exec("insert into gridex_private.public_password_reset_budget(scope, bucket_key, window_started_at, request_count, next_allowed_at, expires_at) select 'email', lpad(to_hex(n), 64, '0'), clock_timestamp() - interval '2 hours', 1, '-infinity', clock_timestamp() - interval '1 hour' from generate_series(1, 150) n")
    expect(await consume('fresh-address', 'fresh-client')).toBe(true)
    const result = await db.query<{ expired: number; global: number }>("select count(*) filter(where expires_at < clock_timestamp())::int as expired, count(*) filter(where scope='global')::int as global from gridex_private.public_password_reset_budget")
    expect(result.rows).toEqual([{ expired: 50, global: 1 }])
  })

  it('rejects malformed keys without creating counter rows', async () => {
    for (const value of [null, '', 'raw-address@example.test', 'a'.repeat(63), 'A'.repeat(64)]) {
      const result = await db.query<{ allowed: boolean }>('select public.gridex_consume_public_password_reset_budget_v1($1, $2) as allowed', [value, key('client')])
      expect(result.rows[0].allowed).toBe(false)
    }
    const result = await db.query<{ n: number }>('select count(*)::int as n from gridex_private.public_password_reset_budget')
    expect(result.rows[0].n).toBe(1)
  })

  it('denies anon/authenticated execution and private reads, while allowing only the service RPC', async () => {
    const privileges = await db.query<{ role: string; execute: boolean; read: boolean }>("select role, has_function_privilege(role, 'public.gridex_consume_public_password_reset_budget_v1(text,text)', 'EXECUTE') as execute, has_table_privilege(role, 'gridex_private.public_password_reset_budget', 'SELECT') as read from unnest(array['anon','authenticated','service_role']) role order by role")
    expect(privileges.rows).toEqual([{ role: 'anon', execute: false, read: false }, { role: 'authenticated', execute: false, read: false }, { role: 'service_role', execute: true, read: false }])
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await expect(consume('address', 'client')).rejects.toThrow(/permission denied/)
      await expect(db.query('select * from gridex_private.public_password_reset_budget')).rejects.toThrow(/permission denied/)
      await db.exec('reset role')
    }
    await db.exec('set role service_role')
    expect(await consume('address', 'client')).toBe(true)
    await db.exec('reset role')
    const security = await db.query<{ relrowsecurity: boolean; prosecdef: boolean; proconfig: string[] }>("select c.relrowsecurity, p.prosecdef, p.proconfig from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join pg_proc p where n.nspname = 'gridex_private' and c.relname = 'public_password_reset_budget' and p.oid = 'public.gridex_consume_public_password_reset_budget_v1(text,text)'::regprocedure")
    expect(security.rows).toEqual([{ relrowsecurity: true, prosecdef: true, proconfig: ['search_path=pg_catalog', 'lock_timeout=2s', 'statement_timeout=3s'] }])
  })
})
