// masterplan: DB-02 (step 1: inventory + ratchet gate only; not a VERIFIED claim)
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
// @ts-ignore plain ESM script without type declarations (allowJs may or may not apply)
import { BASELINE_PATH, compareToBaseline, fkKey, runInventoryQuery } from '../scripts/tenant-fk-inventory.mjs'

vi.setConfig({ testTimeout: 60_000 })

type Fk = { child: string; col: string; parent: string; conname: string }
type Inventory = {
  single_tenant_fks: Fk[]
  composite_tenant_fks: { child: string; cols: string[]; parent: string; conname: string }[]
  company_id_id_unique: { table: string; index: string }[]
  period_tables_without_exclude: { table: string; columns: string }[]
}

async function schemaDb() {
  const db = new PGlite()
  await db.exec(`
    create table public.companies (id uuid primary key);
    create table public.customers (id uuid primary key, company_id uuid not null references public.companies(id),
      unique (company_id, id));
    create table public.facilities (id uuid primary key, company_id uuid not null references public.companies(id),
      customer_id uuid,
      constraint facilities_customer_tenant_fkey foreign key (company_id, customer_id)
        references public.customers (company_id, id));
    create table public.contracts (id uuid primary key, company_id uuid not null references public.companies(id),
      valid_from date, valid_to date);
    create table public.global_lookup (id uuid primary key);
  `)
  return db
}

describe('DB-02 tenant FK inventory', () => {
  it('classifies composite FK, (company_id,id) unique and period tables; ignores company_id->companies', async () => {
    const db = await schemaDb()
    const inv: Inventory = await runInventoryQuery(db)
    expect(inv.single_tenant_fks).toEqual([])
    expect(inv.composite_tenant_fks.map((f) => [f.conname, f.cols])).toEqual([
      ['facilities_customer_tenant_fkey', ['company_id', 'customer_id']],
    ])
    expect(inv.company_id_id_unique.map((u) => u.table)).toEqual(['customers'])
    expect(inv.period_tables_without_exclude).toEqual([{ table: 'contracts', columns: 'valid_from/valid_to' }])
    await db.close()
  })
})

describe('DB-02 ratchet gate', () => {
  it('passes on the baseline and fails when a new single-column tenant->tenant FK appears', async () => {
    const db = await schemaDb()
    const baseline: Inventory = await runInventoryQuery(db)
    expect(compareToBaseline(baseline, baseline)).toEqual({ ok: true, added: [], removed: [] })

    await db.exec(`alter table public.contracts add column customer_id uuid
      constraint contracts_customer_id_fkey references public.customers(id);`)
    // FK to a non-tenant table is not a tenant->tenant FK.
    await db.exec(`alter table public.contracts add column lookup_id uuid references public.global_lookup(id);`)
    const after: Inventory = await runInventoryQuery(db)
    const result = compareToBaseline(after, baseline)
    expect(result.ok).toBe(false)
    expect(result.added).toEqual(['contracts.customer_id -> customers (contracts_customer_id_fkey)'])

    // Removing an entry (migrating to composite FK) keeps the gate green: the baseline may only shrink.
    await db.exec(`alter table public.contracts drop constraint contracts_customer_id_fkey;`)
    const shrunk = compareToBaseline(await runInventoryQuery(db), after)
    expect(shrunk.ok).toBe(true)
    expect(shrunk.removed).toEqual(['contracts.customer_id -> customers (contracts_customer_id_fkey)'])
    await db.close()
  })

  it('committed baseline is well-formed and free of duplicates', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
    const keys: string[] = baseline.single_tenant_fks.map(fkKey)
    expect(keys.length).toBe(baseline.summary.single_tenant_fks)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
