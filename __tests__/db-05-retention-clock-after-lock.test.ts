// masterplan: DB-05 (mechanism component only; no coverage approval)
// The behaviour is proven by the three lock-wait probes in
// scripts/db-05-customer-close-due-purge-native.test.ts (R1's native chain).
// This guard pins that the forward migration is the current definitions with
// exactly the clock/authority changes and no other drift.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

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
    const finalReviewer = after.indexOf("permission_v1(p_company_id,r.actor_user_id,'ediel.retention.review')", finalFields)
    const finalClass = after.indexOf("class_permission_v1(p_company_id,r.actor_user_id,'customer_canonical_personal_fields')", finalReviewer)
    const deadline = after.indexOf("(claims->>'retainUntil')::timestamptz>at")
    const firstEffect = after.indexOf('UPDATE public.customer_portal_accounts')
    for (const blocking of ['FROM gridex_ediel_retention.customer_reviews WHERE decision_id=d.id', 'FROM public.company_memberships WHERE company_id=p_company_id AND user_id=r.actor_user_id FOR SHARE'])
      expect(after.indexOf(blocking)).toBeLessThan(lastBlocking)
    expect(replay < lastBlocking && lastBlocking < instant && instant < final && final < finalFields && finalFields < finalReviewer && finalReviewer < finalClass && finalClass < deadline && deadline < firstEffect).toBe(true)
    expect(after.match(/at:=clock_timestamp\(\);/g)).toHaveLength(1)
    // Only the two inserted blocks and the deadline comparison differ.
    const before = current(name)
    const withoutBlocks = after
      .replace(/ -- DB-05: a lock wait[\s\S]*?USING ERRCODE='42501';END IF;\n(?= SELECT \* INTO t FROM)/, '')
      .replace(/ -- DB-05: the review-row[\s\S]*?(?= IF r\.outcome)/, '')
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

// Finite SQL component contrast: the production purge body and actual customer
// columns execute, while auth/receipt dependencies model a permission becoming
// denied during the receipt call. This is not native issuer-lock concurrency,
// JWT/ACL qualification, a legal original or whole DB-05 proof; the ten-case
// same-customer native chain covers the actual lock/time interleaving.
describe('DB-05 final reviewer authority after receipt evaluation', () => {
  it.each(['ediel.retention.review', 'ediel.retention.customer_fields', null])(
    'preserves personal fields when reviewer %s becomes denied at the final boundary', async (denied) => {
      const db = new PGlite()
      const company = '10000000-0000-4000-8000-000000000001'
      const customer = '20000000-0000-4000-8000-000000000002'
      const reviewer = '30000000-0000-4000-8000-000000000003'
      const purger = '40000000-0000-4000-8000-000000000004'
      const decision = '50000000-0000-4000-8000-000000000005'
      const review = '60000000-0000-4000-8000-000000000006'
      try {
        const start = schema.indexOf('CREATE TABLE public.customers (')
        const customerTable = schema.slice(start, schema.indexOf('\n);', start) + 3)
          .replace(/^.* GENERATED ALWAYS AS .*\n/gm, '')
          .replace("public.gridex_new_public_resource_reference('customer'::text)", "'synthetic-component'::text")
        await db.exec(`CREATE SCHEMA gridex_ediel_retention; ${customerTable}
          CREATE TABLE gridex_ediel_retention.customer_decisions(id uuid, company_id uuid, customer_id uuid, source_hash text, retention_class text);
          CREATE TABLE gridex_ediel_retention.customer_reviews(id uuid, decision_id uuid, actor_user_id uuid, outcome text, created_at timestamptz);
          CREATE TABLE gridex_ediel_retention.customer_tombstones(customer_id uuid, company_id uuid, decision_id uuid, review_id uuid, source_hash text, retention_class text, actor_user_id uuid, created_at timestamptz);
          CREATE TABLE public.customer_supply_periods(company_id uuid, customer_id uuid, status text, actual_end_date date, end_date date);
          CREATE TABLE public.customer_portal_accounts(company_id uuid, customer_id uuid, status text, is_active boolean, updated_at timestamptz);
          CREATE TABLE public.customer_portal_claims(company_id uuid, customer_id uuid, status text, updated_at timestamptz);
          CREATE TABLE public.user_profiles(id uuid, user_status text);
          CREATE TABLE public.company_memberships(company_id uuid, user_id uuid, status text, is_active boolean, accepted_at timestamptz);
          CREATE TABLE public.audit_logs(actor_user_id uuid, company_id uuid, entity_type text, entity_id text, action text, metadata jsonb);
          CREATE FUNCTION public.ediel_retention_lock_auth_actor_v1(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
          CREATE FUNCTION gridex_ediel_retention.actor_v1(uuid,uuid,text) RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
          CREATE FUNCTION gridex_ediel_retention.permission_v1(c uuid, actor uuid, wanted text) RETURNS boolean LANGUAGE sql AS $$
            SELECT NOT (actor='${reviewer}'::uuid AND current_setting('test.r1_after_receipt',true)='true' AND wanted=current_setting('test.r1_denied',true))$$;
          CREATE FUNCTION gridex_ediel_retention.class_permission_v1(c uuid, actor uuid, retention_class text) RETURNS boolean LANGUAGE sql AS $$
            SELECT gridex_ediel_retention.permission_v1(c,actor,'ediel.retention.customer_fields')$$;
          CREATE FUNCTION gridex_ediel_retention.customer_personal_fields_v1(public.customers) RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;
          CREATE FUNCTION gridex_ediel_retention.customer_receipt_v1(gridex_ediel_retention.customer_decisions) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
            PERFORM set_config('test.r1_after_receipt','true',false);
            RETURN jsonb_build_object('retainUntil',clock_timestamp()-interval '1 day','legalBasisReference','SYNTHETIC finite component only'); END$$;
          INSERT INTO public.customers(id,company_id,status,full_name,email,personal_number) VALUES('${customer}','${company}','archived','Original Person','original@example.invalid','199001011234');
          INSERT INTO gridex_ediel_retention.customer_decisions VALUES('${decision}','${company}','${customer}',encode(sha256(convert_to('{}','UTF8')),'hex'),'customer_canonical_personal_fields');
          INSERT INTO gridex_ediel_retention.customer_reviews VALUES('${review}','${decision}','${reviewer}','approved',clock_timestamp());
          INSERT INTO public.user_profiles VALUES('${reviewer}','active');
          INSERT INTO public.company_memberships VALUES('${company}','${reviewer}','active',true,clock_timestamp());
          INSERT INTO public.customer_portal_accounts VALUES('${company}','${customer}','active',true,clock_timestamp());
          INSERT INTO public.customer_portal_claims VALUES('${company}','${customer}','active',clock_timestamp());
          ${'CREATE OR REPLACE FUNCTION' + replaced('public.ediel_pseudonymise_customer_retention_v1')}`)
        await db.query("SELECT set_config('test.r1_after_receipt','false',false),set_config('test.r1_denied',$1,false)", [denied ?? ''])
        const result = (await db.query<{ result: { status: string; missing?: string[] } }>(
          'SELECT public.ediel_pseudonymise_customer_retention_v1($1,$2,$3) AS result', [company, purger, decision])).rows[0].result
        const fields = (await db.query<{ full_name: string; email: string | null; personal_number: string | null }>('SELECT full_name,email,personal_number FROM public.customers')).rows[0]
        const effectCounts = (await db.query<{ tombstones: number; audits: number; portals: string[] }>(`SELECT
          (SELECT count(*)::int FROM gridex_ediel_retention.customer_tombstones) AS tombstones,
          (SELECT count(*)::int FROM public.audit_logs) AS audits,
          (SELECT array_agg(status) FROM public.customer_portal_accounts) AS portals`)).rows[0]
        if (denied) {
          expect(result).toMatchObject({ status: 'held', missing: [denied === 'ediel.retention.review'
            ? 'current_retention_reviewer_authority' : 'current_retention_class_reviewer_authority'] })
          expect(fields).toEqual({ full_name: 'Original Person', email: 'original@example.invalid', personal_number: '199001011234' })
          expect(effectCounts).toEqual({ tombstones: 0, audits: 0, portals: ['active'] })
        } else {
          expect(result).toMatchObject({ status: 'pseudonymised' })
          expect(fields).toEqual({ full_name: 'Pseudonymiserad kund', email: null, personal_number: null })
          expect(effectCounts).toEqual({ tombstones: 1, audits: 1, portals: ['revoked'] })
        }
      } finally { await db.close() }
    }, 30_000)
})
