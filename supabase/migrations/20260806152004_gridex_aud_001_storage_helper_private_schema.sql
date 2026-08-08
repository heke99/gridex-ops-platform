-- GRIDEX-AUD-001 follow-up: keep the storage authorization helper outside
-- PostgREST-exposed schemas while preserving explicit authenticated policy use.

create schema if not exists gridex_private;

revoke all on schema gridex_private from public, anon;
grant usage on schema gridex_private to authenticated, service_role;

create or replace function gridex_private.customer_document_path_allows(
  p_object_name text,
  p_access text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage, auth, gridex_private, pg_temp
as $function$
declare
  v_parts text[];
  v_company_id uuid;
  v_customer_id uuid;
  v_site_id uuid;
  v_scope text;
  v_document_type text;
  v_file_name text;
  v_has_permission boolean;
begin
  if p_object_name is null
     or p_access not in ('read', 'write')
     or p_object_name <> btrim(p_object_name, '/')
     or p_object_name like '%//%'
  then
    return false;
  end if;

  v_parts := string_to_array(p_object_name, '/');

  if coalesce(array_length(v_parts, 1), 0) <> 7
     or v_parts[1] <> 'companies'
     or v_parts[3] <> 'customers'
  then
    return false;
  end if;

  if v_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_parts[4] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  v_company_id := v_parts[2]::uuid;
  v_customer_id := v_parts[4]::uuid;
  v_scope := v_parts[5];
  v_document_type := v_parts[6];
  v_file_name := v_parts[7];

  if v_document_type not in (
    'power_of_attorney',
    'complete_agreement',
    'grid_invoice_suggested'
  ) then
    return false;
  end if;

  if v_file_name in ('', '.', '..')
     or char_length(v_file_name) > 255
     or v_file_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  then
    return false;
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = v_customer_id
      and c.company_id = v_company_id
  ) then
    return false;
  end if;

  if v_scope = 'customer' then
    null;
  elsif v_scope ~* '^site-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_site_id := substring(v_scope from 6)::uuid;

    if not exists (
      select 1
      from public.customer_sites cs
      where cs.id = v_site_id
        and cs.customer_id = v_customer_id
        and cs.company_id = v_company_id
    ) then
      return false;
    end if;
  else
    return false;
  end if;

  if p_access = 'read' then
    v_has_permission :=
      public.gridex_actor_has_company_permission(
        auth.uid(),
        v_company_id,
        'masterdata.read'
      )
      or public.gridex_actor_has_company_permission(
        auth.uid(),
        v_company_id,
        'switching.read'
      );
  else
    v_has_permission :=
      public.gridex_actor_has_company_permission(
        auth.uid(),
        v_company_id,
        'masterdata.write'
      )
      or public.gridex_actor_has_company_permission(
        auth.uid(),
        v_company_id,
        'switching.write'
      );
  end if;

  return coalesce(v_has_permission, false);
exception
  when others then
    return false;
end;
$function$;

comment on function gridex_private.customer_document_path_allows(text, text)
is 'Fail-closed authorization for canonical customer-documents object keys. Not exposed as a PostgREST RPC.';

revoke all on function gridex_private.customer_document_path_allows(text, text)
from public, anon;
grant execute on function gridex_private.customer_document_path_allows(text, text)
to authenticated, service_role;

drop policy if exists customer_documents_storage_read on storage.objects;
drop policy if exists customer_documents_storage_insert on storage.objects;
drop policy if exists customer_documents_storage_update on storage.objects;
drop policy if exists customer_documents_storage_delete on storage.objects;

create policy customer_documents_storage_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'customer-documents'
  and gridex_private.customer_document_path_allows(name, 'read')
);

create policy customer_documents_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'customer-documents'
  and gridex_private.customer_document_path_allows(name, 'write')
);

create policy customer_documents_storage_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'customer-documents'
  and gridex_private.customer_document_path_allows(name, 'write')
)
with check (
  bucket_id = 'customer-documents'
  and gridex_private.customer_document_path_allows(name, 'write')
);

create policy customer_documents_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'customer-documents'
  and gridex_private.customer_document_path_allows(name, 'write')
);

revoke all on function public.gridex_customer_document_path_allows(text, text)
from public, anon, authenticated, service_role;
drop function public.gridex_customer_document_path_allows(text, text);
