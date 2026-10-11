-- The application upserts these rows with ON CONFLICT on plain column lists
-- (PostgREST onConflict). Postgres cannot infer a partial unique index for such
-- a target, so every upsert failed with 42P10. NULLs stay distinct in a full
-- unique index, so replacing the partial "where x is not null" indexes keeps
-- the same uniqueness rule while making the conflict target inferable.

create unique index if not exists customer_invoices_company_export_item_key
  on public.customer_invoices (company_id, invoice_export_item_id);
drop index if exists public.customer_invoices_company_export_item_uidx;

create unique index if not exists ediel_inbound_business_decisions_message_key
  on public.ediel_inbound_business_decisions (ediel_message_id);
drop index if exists public.ediel_inbound_business_decisions_message_uidx;

-- customer_invoice_documents: production already has these columns and the
-- unique key the partner invoice upsert targets; the repository schema did not,
-- so a clean database rejected every invoice PDF write. Idempotent in production.
alter table public.customer_invoice_documents
  add column if not exists document_type text not null default 'invoice_pdf',
  add column if not exists title text,
  add column if not exists public_url text,
  add column if not exists source_system text;
create unique index if not exists customer_invoice_documents_invoice_id_document_type_key
  on public.customer_invoice_documents (invoice_id, document_type);

create unique index if not exists ediel_manual_review_items_message_issue_key
  on public.ediel_manual_review_items (ediel_message_id, issue_type);
drop index if exists public.ediel_manual_review_items_message_issue_uidx;
