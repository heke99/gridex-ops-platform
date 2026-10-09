// ops-api-review: F31 (duplicate index pairs)
import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const migration = fs.readFileSync('supabase/migrations/20261009170000_ops_api_drop_duplicate_indexes.sql', 'utf8')

async function indexes(db: PGlite) {
  return (await db.query<{ name: string }>(`select indexname name from pg_indexes where schemaname='public' order by 1`)).rows.map((r) => r.name)
}

it('drops only exact duplicates and keeps uniqueness', async () => {
  const db = new PGlite()
  await db.exec(`
    create table public.customers(id serial primary key, company_id uuid, customer_number text);
    create unique index customers_company_customer_number_uk on public.customers(company_id, customer_number) where customer_number is not null;
    create unique index ux_customers_company_customer_number on public.customers(company_id, customer_number) where customer_number is not null;
    create table public.customer_case_events(id serial primary key, customer_id uuid);
    create index customer_case_events_customer_idx on public.customer_case_events(customer_id);
    create index idx_fk_customer_case_events_b634ce08bab5 on public.customer_case_events(customer_id);
  `)
  await db.exec(migration)
  expect(await indexes(db)).toEqual(['customer_case_events_customer_idx', 'customer_case_events_pkey', 'customers_company_customer_number_uk', 'customers_pkey'])
  await db.exec(`insert into customers(company_id, customer_number) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '1')`)
  await expect(db.exec(`insert into customers(company_id, customer_number) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '1')`)).rejects.toThrow()
  await db.exec(migration) // idempotent
  await db.close()
})

it('keeps a non-identical "duplicate"', async () => {
  const db = new PGlite()
  await db.exec(`
    create table public.customers(id serial primary key, company_id uuid, customer_number text);
    create unique index customers_company_customer_number_uk on public.customers(company_id, customer_number) where customer_number is not null;
    create unique index ux_customers_company_customer_number on public.customers(company_id, customer_number);
    create table public.customer_case_events(id serial primary key, customer_id uuid);
  `)
  await db.exec(migration)
  expect(await indexes(db)).toContain('ux_customers_company_customer_number')
  await db.close()
})
