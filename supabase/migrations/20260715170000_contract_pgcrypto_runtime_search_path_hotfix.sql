-- Fix contract/pricing runtime functions when pgcrypto is installed in Supabase's
-- `extensions` schema. The previous functions used a restricted search_path that
-- excluded that schema, causing `digest(text, unknown) does not exist` and rolling
-- back the complete contract transaction.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
set local search_path = public, extensions, pg_temp;

do $$
begin
  if to_regprocedure('public.gridex_create_or_version_contract_pricing(uuid,text,text,text,text,jsonb,date,date,boolean,uuid)') is not null then
    execute 'alter function public.gridex_create_or_version_contract_pricing(uuid,text,text,text,text,jsonb,date,date,boolean,uuid) set search_path = public, extensions, pg_temp';
  end if;

  if to_regprocedure('public.gridex_sync_internal_offer_to_canonical(uuid)') is not null then
    execute 'alter function public.gridex_sync_internal_offer_to_canonical(uuid) set search_path = public, extensions, pg_temp';
  end if;

  if to_regprocedure('public.gridex_sync_public_offer_to_canonical(uuid)') is not null then
    execute 'alter function public.gridex_sync_public_offer_to_canonical(uuid) set search_path = public, extensions, pg_temp';
  end if;

  if to_regprocedure('public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text)') is not null then
    execute 'alter function public.gridex_finalize_website_contract_signature(uuid,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb,text,text,text) set search_path = public, extensions, pg_temp';
  end if;

  if to_regprocedure('public.gridex_publish_contract_publication_version(uuid,uuid)') is not null then
    execute 'alter function public.gridex_publish_contract_publication_version(uuid,uuid) set search_path = public, extensions, pg_temp';
  end if;

  if to_regprocedure('public.gridex_capture_signed_contract_evidence()') is not null then
    execute 'alter function public.gridex_capture_signed_contract_evidence() set search_path = public, extensions, pg_temp';
  end if;
end $$;

-- Fail the migration immediately if pgcrypto still cannot be resolved through
-- the runtime search path used by the functions above.
do $$
declare
  v_hash text;
begin
  select encode(digest('gridex-contract-runtime-self-test'::text, 'sha256'), 'hex')
    into v_hash;

  if v_hash is null or length(v_hash) <> 64 then
    raise exception 'pgcrypto_digest_runtime_unavailable';
  end if;
end $$;

commit;
