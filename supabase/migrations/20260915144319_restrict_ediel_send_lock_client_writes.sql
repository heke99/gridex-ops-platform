-- Staged candidate; not selected migration or schema acceptance.
-- Canonical commands own the send-lock projection. Keep authenticated SELECT,
-- authorized SECURITY DEFINER RPCs and all other principals unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local search_path = pg_catalog, public;

do $send_lock_client_writes$
declare
  target_oid oid;
begin
  if not exists (select 1 from pg_roles where rolname='authenticated'
                 and not rolsuper and not rolbypassrls) then
    raise exception using errcode='55000', message='SEND_LOCK_CLIENT_ROLE_REQUIRED';
  end if;
  select c.oid into target_oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname='ediel_send_locks' and c.relkind='r'
    and c.relrowsecurity and not c.relforcerowsecurity
    and not pg_has_role('authenticated',c.relowner,'MEMBER');
  if target_oid is null then
    raise exception using errcode='55000', message='SEND_LOCK_RELATION_SHAPE_REQUIRED';
  end if;
  lock table only public.ediel_send_locks in access exclusive mode;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.oid=target_oid and n.nspname='public' and c.relname='ediel_send_locks' and c.relkind='r'
      and c.relrowsecurity and not c.relforcerowsecurity
      and not pg_has_role('authenticated',c.relowner,'MEMBER')) then
    raise exception using errcode='55000', message='SEND_LOCK_RELATION_SHAPE_REQUIRED';
  end if;

  -- Table REVOKE also removes matching direct column grants in PostgreSQL.
  -- Reject those before mutation so the promised column ACL preservation is
  -- real; table-inclusive has_any_column_privilege cannot serve this precheck.
  if exists (select 1 from pg_attribute a
    cross join lateral aclexplode(a.attacl) privilege
    where a.attrelid=target_oid and a.attnum>0 and not a.attisdropped
      and privilege.grantee='authenticated'::regrole
      and privilege.privilege_type in ('INSERT','UPDATE','REFERENCES')) then
    raise exception using errcode='55000', message='SEND_LOCK_COLUMN_ACL_PRESERVATION_REQUIRED';
  end if;

  revoke insert, update, delete, truncate, references, trigger, maintain
    on table public.ediel_send_locks from authenticated;

  -- Do not silently revoke PUBLIC, inherited, SET-role or column grants. Their
  -- residual authority rejects the entire transaction, including the revoke.
  if exists (
    select 1 from pg_roles r
    where pg_has_role('authenticated',r.oid,'MEMBER') and (
      r.rolsuper or r.rolbypassrls
      or has_table_privilege(r.oid,target_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
      or has_any_column_privilege(r.oid,target_oid,'INSERT,UPDATE,REFERENCES')
    )
  ) then
    raise exception using errcode='55000', message='SEND_LOCK_CLIENT_AUTHORITY_REMAINS';
  end if;
end
$send_lock_client_writes$;
commit;
