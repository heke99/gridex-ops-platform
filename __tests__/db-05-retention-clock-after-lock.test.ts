// masterplan: DB-05 (mechanism component only; no coverage approval)
// The behaviour is proven by the three lock-wait probes in
// scripts/db-05-customer-close-due-purge-native.test.ts (R1's native chain).
// This guard pins that the forward migration is the current definitions with
// exactly the clock/authority changes and no other drift.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const schema = readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
const migration = readFileSync(path.join(root, 'supabase/migrations/20261012193000_db05_retention_clock_after_lock.sql'), 'utf8')

function definition(sql: string, prefix: string, name: string, end: string): string {
  const start = sql.indexOf(`${prefix} ${name}(`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  const as = sql.indexOf('AS $', start)
  return sql.slice(start + prefix.length, sql.indexOf(end, as + 6) + end.length)
}
const current = (name: string, end = '$$;\n') => definition(schema, 'CREATE FUNCTION', name, end)
const replaced = (name: string, end = '$$;\n') => definition(migration, 'CREATE OR REPLACE FUNCTION', name, end)

describe('DB-05 retention decides at the post-lock instant', () => {
  it('purge re-checks the purger after the customer lock and compares the deadline with that instant', () => {
    const name = 'public.ediel_pseudonymise_customer_retention_v1'
    const after = replaced(name)
    expect(after).not.toMatch(/\bnow\(\)/)
    const lock = after.indexOf('FROM public.customers WHERE id=d.customer_id AND company_id=p_company_id FOR UPDATE;')
    const instant = after.indexOf('at:=clock_timestamp();', lock)
    const recheck = after.indexOf("PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');", lock)
    const fields = after.indexOf("permission_v1(p_company_id,p_actor_user_id,'ediel.retention.customer_fields')", lock)
    const replay = after.indexOf('FROM gridex_ediel_retention.customer_tombstones WHERE customer_id=c.id')
    expect([lock, instant, recheck, fields].every((i) => i > 0)).toBe(true)
    expect(lock < instant && instant < recheck && recheck < fields && fields < replay).toBe(true)
    expect(after).toContain("(claims->>'retainUntil')::timestamptz>at")
    // Only the inserted block and the deadline comparison differ.
    const before = current(name)
    const withoutBlock = after.replace(/ -- DB-05: a lock wait[\s\S]*?USING ERRCODE='42501';END IF;\n(?= SELECT \* INTO t FROM)/, '')
    // Before GEN schema.sql holds the old body; after C2's re-capture it holds this one.
    expect(after === before || withoutBlock.replace("timestamptz>at", 'timestamptz>now()') === before).toBe(true)
  })

  it('receipt validity and bans are evaluated at clock_timestamp(), otherwise unchanged', () => {
    const receipt = 'gridex_ediel_retention.customer_receipt_v1'
    const after = replaced(receipt, '$_$;\n')
    expect(after).not.toMatch(/\bnow\(\)/)
    const receiptBefore = current(receipt, '$_$;\n')
    expect(after === receiptBefore || after.replace('n timestamptz:=clock_timestamp();', '').replace(/\bn([<>]=?|\))/g, 'now()$1')
      .replace(/(issued>|expires<=)n\b/g, '$1now()') === receiptBefore).toBe(true)
    const lockActor = 'public.ediel_retention_lock_auth_actor_v1'
    const lockAfter = replaced(lockActor)
    expect(lockAfter === current(lockActor) || lockAfter.replace('banned_until<=clock_timestamp()', 'banned_until<=now()') === current(lockActor)).toBe(true)
  })
})
