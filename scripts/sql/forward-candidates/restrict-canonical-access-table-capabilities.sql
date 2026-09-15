-- Staged candidate; selection requires isolated SQL and genuine CLI provenance.
-- Access-source writes belong to canonical commands, including audit and role
-- synchronization. Preserve SELECT, existing I/U/D denial and every other role.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
set local search_path=pg_catalog,public;
do $canonical_access_capabilities$
declare
  names constant text[] := array['company_invitations','user_roles'];
  target_name text;
  target_oid oid;
  target_oids oid[] := array[]::oid[];
begin
  if not exists(select 1 from pg_roles where rolname='authenticated' and not rolsuper and not rolbypassrls) then
    raise exception using errcode='55000',message='ACCESS_CLIENT_ROLE_REQUIRED';
  end if;
  foreach target_name in array names loop
    select c.oid into target_oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=target_name and c.relkind='r'
        and c.relrowsecurity and not c.relforcerowsecurity
        and not pg_has_role('authenticated',c.relowner,'MEMBER');
    if target_oid is null then
      raise exception using errcode='55000',message='ACCESS_RELATION_SHAPE_REQUIRED';
    end if;
    execute format('lock table only public.%I in access exclusive mode',target_name);
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.oid=target_oid and n.nspname='public' and c.relname=target_name and c.relkind='r'
        and c.relrowsecurity and not c.relforcerowsecurity
        and not pg_has_role('authenticated',c.relowner,'MEMBER')) then
      raise exception using errcode='55000',message='ACCESS_RELATION_SHAPE_REQUIRED';
    end if;
    -- Table REVOKE would also change direct column REFERENCES grants. Reject
    -- before any mutation to retain all column ACLs exactly.
    if exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) p
      where a.attrelid=target_oid and a.attnum>0 and not a.attisdropped
        and p.grantee='authenticated'::regrole and p.privilege_type='REFERENCES') then
      raise exception using errcode='55000',message='ACCESS_COLUMN_ACL_PRESERVATION_REQUIRED';
    end if;
    if not has_table_privilege('authenticated',target_oid,'SELECT') or exists(
      select 1 from pg_roles r where pg_has_role('authenticated',r.oid,'MEMBER') and (
        r.rolsuper or r.rolbypassrls or has_table_privilege(r.oid,target_oid,'INSERT,UPDATE,DELETE')
        or has_any_column_privilege(r.oid,target_oid,'INSERT,UPDATE'))) then
      raise exception using errcode='55000',message='ACCESS_CANONICAL_WRITE_BOUNDARY_REQUIRED';
    end if;
    target_oids := array_append(target_oids,target_oid);
  end loop;
  if cardinality(target_oids)<>2 then
    raise exception using errcode='55000',message='ACCESS_EXACT_TARGET_SET_REQUIRED';
  end if;
  revoke truncate,references,trigger,maintain on table public.company_invitations,public.user_roles from authenticated;
  foreach target_oid in array target_oids loop
    -- PUBLIC, column or inherited/SET-only capabilities are not ours to revoke.
    -- Refuse their residual authority and roll back both table changes.
    if exists(select 1 from pg_roles r where pg_has_role('authenticated',r.oid,'MEMBER') and (
      r.rolsuper or r.rolbypassrls
      or has_table_privilege(r.oid,target_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege(r.oid,target_oid,'INSERT,UPDATE,REFERENCES'))) then
      raise exception using errcode='55000',message='ACCESS_CLIENT_AUTHORITY_REMAINS';
    end if;
  end loop;
end
$canonical_access_capabilities$;
commit;
