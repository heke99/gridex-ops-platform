-- Authoritative customer writes enter through guarded server commands or
-- existing trusted service workflows. Session table grants cannot substitute
-- for the command's current session, permission, tenant and revision checks.
begin;
set local lock_timeout='10s';
set local search_path=pg_catalog;

-- Keep existing reads and RLS predicates. In particular, do not grant callers
-- a new definer path or change the semantics of existing revision triggers.
revoke insert,update,delete,truncate,references,trigger on table
  public.customers,public.customer_contacts,public.customer_addresses,public.customer_sites
  from public,anon,authenticated;

do $writer_fences$
declare
  target record;
  columns text;
  untrusted text;
begin
  -- Table REVOKE does not remove column-specific INSERT/UPDATE/REFERENCES.
  -- Remove only writer ACL; existing column SELECT remains available.
  for target in select c.oid,c.relname
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(array[
      'customers','customer_contacts','customer_addresses','customer_sites'])
      and c.relkind in ('r','p') order by c.relname
  loop
    select string_agg(quote_ident(a.attname),',' order by a.attnum) into columns
    from pg_attribute a where a.attrelid=target.oid and a.attnum>0
      and not a.attisdropped and a.attacl is not null;
    if columns is not null then
      execute format('revoke insert (%s),update (%s),references (%s) on table public.%I from public,anon,authenticated',
        columns,columns,columns,target.relname);
    end if;
    foreach untrusted in array array['anon','authenticated'] loop
      if has_table_privilege(untrusted,target.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(untrusted,target.oid,'INSERT,UPDATE,REFERENCES') then
        raise exception 'authoritative_untrusted_writer_acl: % %',untrusted,target.relname;
      end if;
    end loop;
  end loop;

  -- These existing functions mutate the same customer/site domains. Fence
  -- every installed overload, including the obsolete global archive helper.
  -- Preserve their owner/service execution for canonical onboarding, market
  -- response and address intake workflows; add no new service privileges.
  for target in select p.oid,p.oid::regprocedure signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.proname=any(array[
      'gridex_db4b_archive_customer_registry_row',
      'gridex_commit_customer_site_address','gridex_create_customer_site_with_address',
      'gridex_complete_facility_response','gridex_apply_exact_z02_core',
      'gridex_finalize_supplier_switch_activation','gridex_refresh_customer_process_summary',
      'canonical_onboard_customer_graph','gridex_onboard_customer_graph',
      'gridex_onboard_customer_graph_core','gridex_onboard_customer_graph_quote_commit_v2',
      'gridex_create_partner_contract_v1']) order by p.oid
  loop
    execute format('revoke all on function %s from public,anon,authenticated',target.signature);
    foreach untrusted in array array['anon','authenticated'] loop
      if has_function_privilege(untrusted,target.oid,'EXECUTE') then
        raise exception 'authoritative_untrusted_writer_rpc_acl: % %',untrusted,target.signature;
      end if;
    end loop;
  end loop;
end;
$writer_fences$;
commit;
