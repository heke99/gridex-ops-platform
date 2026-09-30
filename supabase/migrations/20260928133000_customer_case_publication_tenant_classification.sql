-- Finish the publication table's tenant invariant contract. Client roles have
-- no table grants; service-role reads and writes remain tenant-bound in code.
begin;
set local lock_timeout = '10s';

alter table public.customer_case_publications
  drop constraint customer_case_publications_revision_key;
alter table public.customer_case_publications
  add constraint customer_case_publications_revision_key
  unique (company_id, customer_case_id, revision);

drop index public.customer_case_publications_current_key;
create unique index customer_case_publications_current_key
  on public.customer_case_publications(company_id, customer_case_id)
  where revoked_at is null;

insert into public.platform_table_classification
  (table_name, kind, rationale, null_company_meaning, classified_by)
values
  ('customer_case_publications', 'tenant',
   'Tenant-owned authored customer case snapshots; company/customer/case composite ownership, RLS enabled and client table grants revoked.',
   null, 'migration:customer_case_publication_tenant_classification')
on conflict (table_name) do update set
  kind = excluded.kind,
  rationale = excluded.rationale,
  null_company_meaning = excluded.null_company_meaning,
  classified_by = excluded.classified_by,
  classified_at = now();

commit;
