import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync('supabase/migrations/20261010120000_upsert_targets_full_unique_indexes.sql', 'utf8')

async function db() {
  const pg = new PGlite()
  await pg.exec(`
    create table public.customer_invoices (id uuid primary key default gen_random_uuid(), company_id uuid not null, invoice_export_item_id uuid, status text);
    create unique index customer_invoices_company_export_item_uidx on public.customer_invoices (company_id, invoice_export_item_id) where invoice_export_item_id is not null;
    create table public.ediel_inbound_business_decisions (id uuid primary key default gen_random_uuid(), ediel_message_id uuid, decision text);
    create unique index ediel_inbound_business_decisions_message_uidx on public.ediel_inbound_business_decisions (ediel_message_id) where ediel_message_id is not null;
    create table public.customer_invoice_documents (id uuid primary key default gen_random_uuid(), company_id uuid, invoice_id uuid, file_path text);
    create table public.ediel_manual_review_items (id uuid primary key default gen_random_uuid(), ediel_message_id uuid, issue_type text, note text);
    create unique index ediel_manual_review_items_message_issue_uidx on public.ediel_manual_review_items (ediel_message_id, issue_type) where ediel_message_id is not null;
  `)
  return pg
}

const company = '11111111-1111-4111-8111-111111111111'
const item = '22222222-2222-4222-8222-222222222222'
const message = '33333333-3333-4333-8333-333333333333'

const upserts = [
  `insert into public.customer_invoices (company_id, invoice_export_item_id, status) values ('${company}', '${item}', 'paid')
     on conflict (company_id, invoice_export_item_id) do update set status = excluded.status`,
  `insert into public.ediel_inbound_business_decisions (ediel_message_id, decision) values ('${message}', 'accept')
     on conflict (ediel_message_id) do update set decision = excluded.decision`,
  `insert into public.ediel_manual_review_items (ediel_message_id, issue_type, note) values ('${message}', 'missing_site', 'x')
     on conflict (ediel_message_id, issue_type) do update set note = excluded.note`,
]

const invoiceDocumentUpsert = `insert into public.customer_invoice_documents (company_id, invoice_id, document_type, title, file_path)
  values ('${company}', '${item}', 'invoice_pdf', 'Faktura', 'a.pdf')
  on conflict (invoice_id, document_type) do update set file_path = excluded.file_path`

describe('upsert conflict targets need full unique indexes', () => {
  it('partial unique indexes reject the plain ON CONFLICT targets the app sends', async () => {
    const pg = await db()
    for (const sql of upserts) {
      await expect(pg.exec(sql)).rejects.toThrow(/no unique or exclusion constraint/)
    }
    await expect(pg.exec(invoiceDocumentUpsert)).rejects.toThrow(/document_type/)
  })

  it('invoice PDF documents upsert once per invoice and document type', async () => {
    const pg = await db()
    await pg.exec(migration)
    await pg.exec(invoiceDocumentUpsert)
    await pg.exec(invoiceDocumentUpsert)
    const rows = await pg.query<{ n: number }>('select count(*)::int as n from public.customer_invoice_documents')
    expect(rows.rows[0].n).toBe(1)
  })

  it('after the migration each upsert inserts once and then updates in place', async () => {
    const pg = await db()
    await pg.exec(migration)
    for (const sql of upserts) {
      await pg.exec(sql)
      await pg.exec(sql)
    }
    const counts = await pg.query<{ n: number }>(`
      select (select count(*) from public.customer_invoices)::int
           + (select count(*) from public.ediel_inbound_business_decisions)::int
           + (select count(*) from public.ediel_manual_review_items)::int as n`)
    expect(counts.rows[0].n).toBe(3)
  })

  it('rows without a reference may still repeat, as before', async () => {
    const pg = await db()
    await pg.exec(migration)
    await pg.exec(`insert into public.customer_invoices (company_id, invoice_export_item_id) values ('${company}', null), ('${company}', null)`)
    await pg.exec(`insert into public.ediel_inbound_business_decisions (ediel_message_id) values (null), (null)`)
    const rows = await pg.query<{ n: number }>('select count(*)::int as n from public.customer_invoices')
    expect(rows.rows[0].n).toBe(2)
  })
})
