-- View hardening and removal of inert policies.
--
-- F-13: three views were owned by postgres without security_invoker, so they read
--       their base tables with RLS bypassed. Verified before the change that none
--       carried a grant to anon, authenticated, authenticator or PUBLIC, so this
--       was not exploitable -- but it is a trap the moment a grant is added.
--
-- F-14: 1620 of roughly 5600 policies (~29%) targeted roles holding no table
--       grants at all -- supabase_privileged_role (543), dashboard_user (543) and
--       authenticator (534). A policy without a GRANT has no effect. They are not
--       a vulnerability; they are the reason the policy set could not be reasoned
--       about by reading it.
--
-- Forward-only.

begin;

alter view public.gridex_public_contract_offer_api_diagnostics_v set (security_invoker = true);
alter view public.contract_publication_readiness_v set (security_invoker = true);
alter view public.gridex_tenant_contract_readiness_v set (security_invoker = true);

-- Only policies whose entire role list consists of grant-less roles are dropped.
-- A policy that also names authenticated, anon or service_role is left untouched,
-- and dropping an inert policy cannot change any caller's effective access.
do $$
declare
  v_policy record;
  v_dropped integer := 0;
begin
  for v_policy in
    select pol.polname, c.relname
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where pol.polroles <> '{0}'::oid[]
      and not exists (
        select 1
        from unnest(pol.polroles) as role_oid
        join pg_roles r on r.oid = role_oid
        where r.rolname not in ('supabase_privileged_role', 'dashboard_user', 'authenticator')
      )
      and not exists (
        select 1
        from unnest(pol.polroles) as role_oid
        join pg_roles r on r.oid = role_oid
        join information_schema.role_table_grants g
          on g.grantee = r.rolname
         and g.table_schema = 'public'
         and g.table_name = c.relname
      )
  loop
    execute format('drop policy if exists %I on public.%I', v_policy.polname, v_policy.relname);
    v_dropped := v_dropped + 1;
  end loop;

  raise notice 'F-14: dropped % inert policies', v_dropped;
end
$$;

commit;
