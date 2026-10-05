create or replace function private.remove_terms_accepted_from_application_response(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb := p_payload;
  v_clean jsonb;
begin
  if v_result is null or jsonb_typeof(v_result) <> 'object' then
    return v_result;
  end if;

  if jsonb_typeof(v_result -> 'missing_fields') = 'array' then
    select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
      into v_clean
    from jsonb_array_elements_text(v_result -> 'missing_fields') value
    where value <> 'terms_accepted';
    v_result := jsonb_set(v_result, '{missing_fields}', v_clean, true);
  end if;

  if jsonb_typeof(v_result -> 'blocking_reasons') = 'array' then
    select coalesce(jsonb_agg(item), '[]'::jsonb)
      into v_clean
    from jsonb_array_elements(v_result -> 'blocking_reasons') item
    where item ->> 'field' is distinct from 'terms_accepted';
    v_result := jsonb_set(v_result, '{blocking_reasons}', v_clean, true);
  end if;

  return v_result;
end;
$$;

revoke all on function private.remove_terms_accepted_from_application_response(jsonb) from public, anon, authenticated;

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

    new.response_payload := private.remove_terms_accepted_from_application_response(new.response_payload);
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_website_application_legal_blockers() from public, anon, authenticated;

drop trigger if exists trg_normalize_website_application_legal_blockers on public.website_customer_applications;
create trigger trg_normalize_website_application_legal_blockers
before insert or update of missing_fields, blocking_reasons, response_payload, company_id, customer_id
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
           response_payload = private.remove_terms_accepted_from_application_response(app.response_payload),
           updated_at = now()
     where app.id = new.contract_application_id
       and app.company_id = new.company_id
       and (
         coalesce('terms_accepted' = any(app.missing_fields), false)
         or coalesce(app.blocking_reasons @> '[{"field":"terms_accepted"}]'::jsonb, false)
         or coalesce(app.response_payload->'missing_fields' @> '["terms_accepted"]'::jsonb, false)
         or coalesce(app.response_payload->'blocking_reasons' @> '[{"field":"terms_accepted"}]'::jsonb, false)
       );
  end if;

  return new;
end;
$$;

revoke all on function private.reconcile_website_application_terms_acceptance() from public, anon, authenticated;

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
       response_payload = private.remove_terms_accepted_from_application_response(app.response_payload),
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
   or coalesce(app.response_payload->'missing_fields' @> '["terms_accepted"]'::jsonb, false)
   or coalesce(app.response_payload->'blocking_reasons' @> '[{"field":"terms_accepted"}]'::jsonb, false)
 );
