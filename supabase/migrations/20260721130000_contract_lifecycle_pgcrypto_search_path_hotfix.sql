-- Gridex OPS: restore the pgcrypto schema for canonical contract lifecycle RPCs.
-- The preceding lifecycle migration recreated these functions with
-- search_path=public,pg_temp even though they execute pgcrypto digest() and
-- gen_random_uuid(). Supabase installs pgcrypto in the extensions schema.

begin;

do $$
declare
  v_pgcrypto_schema text;
  v_signature text;
begin
  select n.nspname
  into v_pgcrypto_schema
  from pg_extension e
  join pg_namespace n on n.oid=e.extnamespace
  where e.extname='pgcrypto';

  if v_pgcrypto_schema is null then
    if to_regnamespace('extensions') is null then
      execute 'create schema extensions';
    end if;
    execute 'create extension if not exists pgcrypto with schema extensions';

    select n.nspname
    into v_pgcrypto_schema
    from pg_extension e
    join pg_namespace n on n.oid=e.extnamespace
    where e.extname='pgcrypto';
  end if;

  if v_pgcrypto_schema is null then
    raise exception using
      errcode='3F000',
      message='pgcrypto_extension_schema_not_found';
  end if;

  foreach v_signature in array array[
    'public.gridex_sync_internal_offer_to_canonical(uuid)',
    'public.gridex_publish_contract_channel(uuid,uuid,text,uuid)',
    'public.gridex_backfill_contract_lifecycle(uuid)'
  ]
  loop
    if to_regprocedure(v_signature) is null then
      raise exception using
        errcode='42883',
        message='required_contract_lifecycle_function_missing',
        detail=v_signature;
    end if;

    execute format(
      'alter function %s set search_path = public, %I, pg_temp',
      v_signature,
      v_pgcrypto_schema
    );
  end loop;
end $$;

commit;

-- Re-run the idempotent repair now that digest()/gen_random_uuid() resolve.
do $$
declare
  v_result jsonb;
begin
  v_result:=public.gridex_backfill_contract_lifecycle(null);
  raise notice 'gridex_backfill_contract_lifecycle after pgcrypto hotfix: %',v_result;
end $$;
