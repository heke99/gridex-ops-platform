create or replace function private.normalize_website_application_legal_blockers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is not null
     and exists (
       select 1
       from public.customer_legal_acceptances cla
       where cla.contract_application_id = new.id
         and cla.company_id = new.company_id
         and cla.acceptance_type = 'terms'
         and cla.accepted_at is not null
         and cla.legal_bundle_version_document_id is not null
         and nullif(btrim(cla.legal_document_sha256), '') is not null
     ) then
    if new.missing_fields is not null then
      new.missing_fields := array_remove(new.missing_fields, 'terms_accepted');
    end if;

    if new.blocking_reasons is not null
       and jsonb_typeof(new.blocking_reasons) = 'array' then
      select coalesce(jsonb_agg(item), '[]'::jsonb)
        into new.blocking_reasons
      from jsonb_array_elements(new.blocking_reasons) item
      where item ->> 'field' is distinct from 'terms_accepted';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_website_application_legal_blockers() from public, anon, authenticated;

drop trigger if exists trg_normalize_website_application_legal_blockers on public.website_customer_applications;
create trigger trg_normalize_website_application_legal_blockers
before insert or update of missing_fields, blocking_reasons, company_id, customer_id
on public.website_customer_applications
for each row
execute function private.normalize_website_application_legal_blockers();

create or replace function private.reconcile_website_application_terms_acceptance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contract_application_id is not null
     and new.acceptance_type = 'terms'
     and new.accepted_at is not null
     and new.legal_bundle_version_document_id is not null
     and nullif(btrim(new.legal_document_sha256), '') is not null then
    update public.website_customer_applications app
       set missing_fields = case
             when app.missing_fields is null then null
             else array_remove(app.missing_fields, 'terms_accepted')
           end,
           blocking_reasons = case
             when app.blocking_reasons is null
               or jsonb_typeof(app.blocking_reasons) <> 'array'
               then app.blocking_reasons
             else (
               select coalesce(jsonb_agg(item), '[]'::jsonb)
               from jsonb_array_elements(app.blocking_reasons) item
               where item ->> 'field' is distinct from 'terms_accepted'
             )
           end,
           updated_at = now()
     where app.id = new.contract_application_id
       and app.company_id = new.company_id
       and (
         coalesce('terms_accepted' = any(app.missing_fields), false)
         or coalesce(app.blocking_reasons @> '[{"field":"terms_accepted"}]'::jsonb, false)
       );
  end if;

  return new;
end;
$$;

revoke all on function private.reconcile_website_application_terms_acceptance() from public, anon, authenticated;

drop trigger if exists trg_reconcile_website_application_terms_acceptance on public.customer_legal_acceptances;
create trigger trg_reconcile_website_application_terms_acceptance
after insert or update of acceptance_type, accepted_at, legal_bundle_version_document_id, legal_document_sha256
on public.customer_legal_acceptances
for each row
execute function private.reconcile_website_application_terms_acceptance();

update public.website_customer_applications app
   set missing_fields = case
         when app.missing_fields is null then null
         else array_remove(app.missing_fields, 'terms_accepted')
       end,
       blocking_reasons = case
         when app.blocking_reasons is null
           or jsonb_typeof(app.blocking_reasons) <> 'array'
           then app.blocking_reasons
         else (
           select coalesce(jsonb_agg(item), '[]'::jsonb)
           from jsonb_array_elements(app.blocking_reasons) item
           where item ->> 'field' is distinct from 'terms_accepted'
         )
       end,
       updated_at = now()
 where exists (
   select 1
   from public.customer_legal_acceptances cla
   where cla.contract_application_id = app.id
     and cla.company_id = app.company_id
     and cla.acceptance_type = 'terms'
     and cla.accepted_at is not null
     and cla.legal_bundle_version_document_id is not null
     and nullif(btrim(cla.legal_document_sha256), '') is not null
 )
 and (
   coalesce('terms_accepted' = any(app.missing_fields), false)
   or coalesce(app.blocking_reasons @> '[{"field":"terms_accepted"}]'::jsonb, false)
 );
