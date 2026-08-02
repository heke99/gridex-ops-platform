begin;

-- Existing Supabase projects may grant ALL table privileges in public through
-- legacy default privileges. RLS still applies to rows, but this internal
-- idempotency registry is intentionally read-only for authenticated platform
-- administrators and writable only through canonical SECURITY DEFINER RPCs.
revoke insert, update, delete, truncate, references, trigger
  on table public.canonical_provisioning_requests
  from authenticated;

revoke all
  on table public.canonical_provisioning_requests
  from anon;

grant select
  on table public.canonical_provisioning_requests
  to authenticated;

do $$
declare
  v_unexpected_privileges text[];
begin
  select array_agg(privilege_type order by privilege_type)
    into v_unexpected_privileges
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'canonical_provisioning_requests'
    and grantee = 'authenticated'
    and privilege_type <> 'SELECT';

  if coalesce(cardinality(v_unexpected_privileges), 0) <> 0 then
    raise exception
      'canonical_provisioning_requests still exposes unexpected authenticated privileges: %',
      v_unexpected_privileges;
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.canonical_provisioning_requests',
    'SELECT'
  ) then
    raise exception
      'canonical_provisioning_requests is missing authenticated SELECT';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'canonical_provisioning_requests'
      and grantee = 'anon'
  ) then
    raise exception
      'canonical_provisioning_requests still exposes privileges to anon';
  end if;
end;
$$;

commit;
