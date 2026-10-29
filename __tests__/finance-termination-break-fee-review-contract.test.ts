import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const C = '11111111-1111-4111-8111-111111111111'
const CU = '22222222-2222-4222-8222-222222222222'
const A = '33333333-3333-4333-8333-333333333333'
const CT = '44444444-4444-4444-8444-444444444444'

// Real review producer and real approval consumer. Minimal storage/auth fixture only;
// no manufactured break_fee_review metadata and no mocked financial functions.
describe('termination review feeds the normal break-fee approval contract', () => {
  it('approves a fee from the actual registered-termination review without editing its metadata', async () => {
    const db = new PGlite()
    try {
      await db.exec(`
        create role anon; create role authenticated; create role service_role;
        create schema auth; create schema extensions;
        create function auth.role() returns text language sql as $$ select 'service_role' $$;
        create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
        create function public.gridex_actor_has_company_permission(a uuid,c uuid,p text) returns boolean language sql as $$ select a='${A}'::uuid and c='${C}'::uuid $$;
        create function public.gridex_can_write_company(c uuid) returns boolean language sql as $$ select c='${C}'::uuid $$;
        create table companies(id uuid primary key);
        create table customers(id uuid primary key,company_id uuid,customer_type text);
        create table customer_contracts(id uuid primary key,company_id uuid,customer_id uuid,contract_type text,fixed_price_ore_per_kwh numeric,binding_months int,
          contract_version text,terms_version text,signed_version text,snapshot_hash text,signature_snapshot_sha256 text,metering_point_id uuid,
          termination_notice_date date,ended_at timestamptz,status text,termination_reason text,actual_start_at date,confirmed_start_at date,starts_at date,expected_start_at date);
        create table customer_supply_periods(company_id uuid,customer_id uuid,customer_contract_id uuid,contract_id uuid,status text,actual_start_date date,start_date date);
        create table customer_operation_tasks(id uuid primary key default gen_random_uuid(),company_id uuid,customer_id uuid,metering_point_id uuid,task_type text,status text,priority text,title text,description text,metadata jsonb,
          created_by uuid,updated_by uuid,resolved_at timestamptz,updated_at timestamptz);
        create table billing_underlays(id uuid primary key);
        insert into companies values('${C}');
        insert into customers values('${CU}','${C}','private');
        insert into customer_contracts(id,company_id,customer_id,contract_type,fixed_price_ore_per_kwh,binding_months,contract_version,terms_version,signed_version,snapshot_hash,signature_snapshot_sha256,
          termination_notice_date,ended_at,status,actual_start_at)
        values('${CT}','${C}','${CU}','fixed',120,12,'v3','t2','s1','hash','signature','2026-10-01','2026-10-23T10:00:00Z','active','2026-09-01');
      `)
      const source = read('supabase/migrations/20261024100000_h3d_termination_notice_end_fee_review_z08_lead.sql')
      const match = /create function public\.gridex_termination_break_fee_review_v1\([\s\S]*?\n\$\$;/.exec(source)
      if (!match) throw new Error('Actual termination review producer missing')
      await db.exec(match[0])
      await db.exec(read('supabase/migrations/20261025110000_d11_break_fee_charges.sql'))
      const forward = 'supabase/migrations/20261029130000_finance_termination_review_supply_end.sql'
      if (existsSync(path.join(root, forward))) {
        const before = (await db.query<{ metadata: Record<string, unknown> }>(
          "select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='public.gridex_termination_break_fee_review_v1(uuid,uuid,uuid)'::regprocedure")).rows[0].metadata
        await db.exec(read(forward))
        await db.exec(read(forward))
        expect((await db.query<{ metadata: Record<string, unknown> }>(
          "select to_jsonb(p)-'prosrc' metadata from pg_proc p where oid='public.gridex_termination_break_fee_review_v1(uuid,uuid,uuid)'::regprocedure")).rows[0].metadata).toEqual(before)
        await db.exec('set role authenticated')
        await expect(db.exec(read(forward))).rejects.toThrow('finance_termination_review_owner_session_required')
        await db.exec('rollback; reset role')
      }
      // A served binding creates no review and never charges automatically.
      await db.exec("update customer_contracts set ended_at='2027-10-23T10:00:00Z' where id='" + CT + "'")
      const served = await db.query<{ r: { review_due: boolean; reason: string } }>('select public.gridex_termination_break_fee_review_v1($1,$2,$3) r', [C, CT, A])
      expect(served.rows[0].r).toMatchObject({ review_due: false, reason: 'binding_served' })
      expect((await db.query('select id from customer_operation_tasks')).rows).toHaveLength(0)
      await db.exec("update customer_contracts set ended_at='2026-10-23T10:00:00Z' where id='" + CT + "'")
      const review = await db.query<{ r: { created: boolean; review_due: boolean } }>(
        'select public.gridex_termination_break_fee_review_v1($1,$2,$3) r', [C, CT, A])
      expect(review.rows[0].r).toMatchObject({ created: true, review_due: true })
      const tasks = await db.query<{ id: string; metadata: Record<string, unknown> }>(
        "select id,metadata from customer_operation_tasks where company_id=$1 and task_type='break_fee_review'", [C])
      expect(tasks.rows).toHaveLength(1)
      expect(tasks.rows[0].metadata).toMatchObject({ contract_id: CT, binding_ends_at: '2027-09-01', contract_end_date: '2026-10-23', charged_automatically: false })
      expect((await db.query('select id from break_fee_charges')).rows).toHaveLength(0)
      const repeated = await db.query<{ r: { created: boolean } }>('select public.gridex_termination_break_fee_review_v1($1,$2,$3) r', [C, CT, A])
      expect(repeated.rows[0].r.created).toBe(false)
      expect((await db.query('select id from customer_operation_tasks')).rows).toHaveLength(1)
      const input = { customer_category: 'consumer', category_basis: { type: 'private' }, amount_ex_vat: 300,
        loss_basis: { source: 'synthetic replacement and volume evidence' },
        calculation: { components: ['price_difference'], fixed_price_ore_per_kwh: 120, replacement_price_ore_per_kwh: 90, remaining_expected_kwh: 1500 },
        vat_classification: { code: 'synthetic', vat_rate: 0.25, account: '3990', verified_by: A, verified_at: '2026-10-29', source: 'synthetic fixture classification' } }
      const approved = await db.query<{ r: { applied: boolean; chargeId: string } }>(
        'select public.gridex_approve_break_fee_v1($1,$2,$3,$4) r', [C, tasks.rows[0].id, JSON.stringify(input), A])
      expect(approved.rows[0].r.applied).toBe(true)
      const charges = await db.query<{ amount_ex_vat: string; status: string }>('select amount_ex_vat,status from break_fee_charges')
      expect(charges.rows).toEqual([{ amount_ex_vat: '300.00', status: 'approved' }])
    } finally {
      await db.close()
    }
  })
})
