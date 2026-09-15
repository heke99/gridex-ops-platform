-- Reconstruct the catalog-verified live grant identity before historical SaaS seeds.
-- This only restores UNIQUE(role_id, permission_id), NULLS DISTINCT, immediate.
-- Nullable IDs and RESTRICT foreign keys in core differ from live and remain open;
-- do not silently change deletion semantics or choose survivors for duplicate data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.role_permissions in access exclusive mode;
do $$
declare
  expected_keys smallint[];
  existing_constraint pg_catalog.pg_constraint%rowtype;
begin
  select array[
    (select attnum from pg_catalog.pg_attribute where attrelid='public.role_permissions'::regclass and attname='role_id' and not attisdropped),
    (select attnum from pg_catalog.pg_attribute where attrelid='public.role_permissions'::regclass and attname='permission_id' and not attisdropped)
  ]::smallint[] into expected_keys;
  if array_position(expected_keys, null) is not null then
    raise exception 'role_permissions requires role_id and permission_id' using errcode='23514';
  end if;

  select * into existing_constraint from pg_catalog.pg_constraint
  where conrelid='public.role_permissions'::regclass
    and conname='role_permissions_role_id_permission_id_key';
  if found then
    if existing_constraint.contype <> 'u'
       or existing_constraint.conkey is distinct from expected_keys
       or not existing_constraint.convalidated
       or existing_constraint.condeferrable or existing_constraint.condeferred
       or pg_catalog.pg_get_constraintdef(existing_constraint.oid) <> 'UNIQUE (role_id, permission_id)'
       or not exists (
         select 1 from pg_catalog.pg_index i
         join pg_catalog.pg_class c on c.oid=i.indexrelid
         join pg_catalog.pg_am am on am.oid=c.relam
         where i.indexrelid=existing_constraint.conindid
           and i.indrelid='public.role_permissions'::regclass
           and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
           and not i.indnullsnotdistinct and i.indnkeyatts=2 and i.indnatts=2
           and i.indexprs is null and i.indpred is null and am.amname='btree'
           and pg_catalog.pg_get_indexdef(i.indexrelid) =
             'CREATE UNIQUE INDEX role_permissions_role_id_permission_id_key ON public.role_permissions USING btree (role_id, permission_id)'
       ) then
      raise exception 'Conflicting role_permissions_role_id_permission_id_key definition' using errcode='23514';
    end if;
  else
    if to_regclass('public.role_permissions_role_id_permission_id_key') is not null then
      raise exception 'Conflicting role_permissions_role_id_permission_id_key relation' using errcode='23514';
    end if;
    -- PostgreSQL validates all existing rows; duplicate nonnull pairs abort this
    -- transaction. No DELETE, UPDATE, or arbitrary duplicate survivor is allowed.
    alter table public.role_permissions
      add constraint role_permissions_role_id_permission_id_key unique (role_id, permission_id);
  end if;
end;
$$;
commit;
