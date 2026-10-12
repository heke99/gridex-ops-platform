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
  it('purge re-checks the purger after the customer lock and again after the last blocking lock', () => {
    const name = 'public.ediel_pseudonymise_customer_retention_v1'
    const after = replaced(name)
    expect(after).not.toMatch(/\bnow\(\)/)
    const purge = "PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,'ediel.retention.purge');"
    const fields = "permission_v1(p_company_id,p_actor_user_id,'ediel.retention.customer_fields')"
    const lock = after.indexOf('FROM public.customers WHERE id=d.customer_id AND company_id=p_company_id FOR UPDATE;')
    const replay = after.indexOf('FROM gridex_ediel_retention.customer_tombstones WHERE customer_id=c.id')
    // Early re-check: after the customer lock, before a replay answer.
    const early = after.indexOf(purge, lock)
    expect(lock > 0 && early > lock && after.indexOf(fields, early) < replay).toBe(true)
    // Every later blocking lock (review row, reviewer, issuer via the receipt) precedes
    // the decision instant, which precedes the final re-check and every effect.
    const lastBlocking = after.indexOf('claims:=gridex_ediel_retention.customer_receipt_v1(d);')
    const instant = after.indexOf('at:=clock_timestamp();', lastBlocking)
    const final = after.indexOf(purge, instant)
    const finalFields = after.indexOf(fields, final)
    const deadline = after.indexOf("(claims->>'retainUntil')::timestamptz>at")
    const firstEffect = after.indexOf('UPDATE public.customer_portal_accounts')
    for (const blocking of ['FROM gridex_ediel_retention.customer_reviews WHERE decision_id=d.id', 'FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id FOR SHARE'])
      expect(after.indexOf(blocking)).toBeLessThan(lastBlocking)
    expect(replay < lastBlocking && lastBlocking < instant && instant < final && final < finalFields && finalFields < deadline && deadline < firstEffect).toBe(true)
    expect(after.match(/at:=clock_timestamp\(\);/g)).toHaveLength(1)
    // Only the two inserted blocks and the deadline comparison differ.
    const before = current(name)
    const withoutBlocks = after
      .replace(/ -- DB-05: a lock wait[\s\S]*?USING ERRCODE='42501';END IF;\n(?= SELECT \* INTO t FROM)/, '')
      .replace(/ -- DB-05: the review-row[\s\S]*?USING ERRCODE='42501';END IF;\n(?= IF r\.outcome)/, '')
    // Before GEN schema.sql holds the old body; after C2's re-capture it holds this one.
    expect(after === before || withoutBlocks.replace('timestamptz>at', 'timestamptz>now()') === before).toBe(true)
  })

  it('receipt validity is evaluated after the issuer lock and bans at clock_timestamp(), otherwise unchanged', () => {
    const receipt = 'gridex_ediel_retention.customer_receipt_v1'
    const after = replaced(receipt, '$_$;\n')
    expect(after).not.toMatch(/\bnow\(\)/)
    const receiptBefore = current(receipt, '$_$;\n')
    // The instant is sampled after the issuer FOR SHARE, before any validity comparison.
    const issuer = after.indexOf('FROM gridex_ediel_retention.issuers WHERE')
    const sample = after.indexOf('n:=clock_timestamp();')
    expect(issuer > 0 && sample > after.indexOf('FOR SHARE;', issuer) && sample < after.indexOf('n<k.valid_from')).toBe(true)
    expect(after === receiptBefore || after.replace('n timestamptz;', '').replace(/ -- DB-05: the issuer lock[^\n]*\n n:=clock_timestamp\(\);\n/, '').replace(/\bn([<>]=?|\))/g, 'now()$1')
      .replace(/(issued>|expires<=)n\b/g, '$1now()') === receiptBefore).toBe(true)
    const lockActor = 'public.ediel_retention_lock_auth_actor_v1'
    const lockAfter = replaced(lockActor)
    expect(lockAfter === current(lockActor) || lockAfter.replace('banned_until<=clock_timestamp()', 'banned_until<=now()') === current(lockActor)).toBe(true)
  })
})
