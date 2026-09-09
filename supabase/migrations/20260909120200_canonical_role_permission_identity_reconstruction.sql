-- Mandatory UUID grant identity; compatibility admission follows the reviewed
-- ROLE_PERMISSION_IDENTITY_OWNERSHIP_EVIDENCE_2026-09-09 rules 1-4 exactly.
-- No FK replacement or parent-delete retention policy is introduced here.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public;

-- Consistent order: join first (also used by uniqueness reconstruction), then
-- permissions, roles, user_roles. SHARE freezes every reader-derived candidate
-- set; the join takes its eventual DDL lock upfront to avoid a lock upgrade.
lock table public.role_permissions in access exclusive mode;
lock table public.permissions, public.roles, public.user_roles in share mode;

do $$
declare
  relation_id oid;
  parent_id oid;
  reference_name text;
  expected_name text;
  reference_att smallint;
  parent_att smallint;
  pair_atts smallint[];
  fk pg_catalog.pg_constraint%rowtype;
begin
  foreach relation_id in array array['public.role_permissions'::regclass,
      'public.permissions'::regclass,'public.roles'::regclass,'public.user_roles'::regclass] loop
    if not exists(select 1 from pg_catalog.pg_class where oid=relation_id and relkind='r')
       or exists(select 1 from pg_catalog.pg_inherits where inhrelid=relation_id or inhparent=relation_id) then
      raise exception 'Identity repair requires ordinary non-inherited tables' using errcode='23514';
    end if;
  end loop;

  -- UUID row identity is an existing primary key, never inferred from text.
  foreach relation_id in array array['public.role_permissions'::regclass,
      'public.permissions'::regclass,'public.roles'::regclass] loop
    select attnum into parent_att from pg_catalog.pg_attribute
      where attrelid=relation_id and attname='id' and not attisdropped
        and atttypid='uuid'::regtype and attnotnull;
    if parent_att is null or not exists(
      select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_index i on i.indexrelid=c.conindid
      where c.conrelid=relation_id and c.contype='p' and c.conkey=array[parent_att]::smallint[]
        and c.convalidated and not c.condeferrable and not c.condeferred
        and i.indisprimary and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
        and i.indnkeyatts=1 and i.indnatts=1 and i.indexprs is null and i.indpred is null
    ) then
      raise exception 'Identity repair requires UUID id primary keys' using errcode='23514';
    end if;
  end loop;

  select array[
    (select attnum from pg_catalog.pg_attribute where attrelid='public.role_permissions'::regclass and attname='role_id' and not attisdropped and atttypid='uuid'::regtype),
    (select attnum from pg_catalog.pg_attribute where attrelid='public.role_permissions'::regclass and attname='permission_id' and not attisdropped and atttypid='uuid'::regtype)
  ]::smallint[] into pair_atts;
  if array_position(pair_atts,null) is not null then
    raise exception 'Identity repair requires UUID role_id and permission_id' using errcode='23514';
  end if;
  if (select count(*) from pg_catalog.pg_constraint where conrelid='public.role_permissions'::regclass
      and conname='role_permissions_role_id_permission_id_key')<>1 or not exists(
    select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_index i on i.indexrelid=c.conindid
    join pg_catalog.pg_class ic on ic.oid=i.indexrelid join pg_catalog.pg_am am on am.oid=ic.relam
    where c.conrelid='public.role_permissions'::regclass
      and c.conname='role_permissions_role_id_permission_id_key' and c.contype='u'
      and c.conkey=pair_atts and c.convalidated and not c.condeferrable and not c.condeferred
      and pg_catalog.pg_get_constraintdef(c.oid)='UNIQUE (role_id, permission_id)'
      and i.indrelid=c.conrelid and i.indisunique and i.indisvalid and i.indisready and i.indimmediate
      and not i.indnullsnotdistinct and i.indnkeyatts=2 and i.indnatts=2
      and i.indexprs is null and i.indpred is null and am.amname='btree'
  ) then
    raise exception 'Identity repair requires reconstructed immediate UUID pair uniqueness' using errcode='23514';
  end if;

  foreach reference_name in array array['role_id','permission_id'] loop
    parent_id := case when reference_name='role_id' then 'public.roles'::regclass else 'public.permissions'::regclass end;
    expected_name := 'role_permissions_' || reference_name || '_fkey';
    select attnum into reference_att from pg_catalog.pg_attribute
      where attrelid='public.role_permissions'::regclass and attname=reference_name and not attisdropped;
    select attnum into parent_att from pg_catalog.pg_attribute
      where attrelid=parent_id and attname='id' and not attisdropped;
    if (select count(*) from pg_catalog.pg_constraint
        where conrelid='public.role_permissions'::regclass and conname=expected_name)<>1 then
      raise exception 'Identity repair requires named FK %',expected_name using errcode='23514';
    end if;
    select * into fk from pg_catalog.pg_constraint
      where conrelid='public.role_permissions'::regclass and conname=expected_name;
    if fk.contype<>'f' or fk.confrelid<>parent_id
       or fk.conkey is distinct from array[reference_att]::smallint[]
       or fk.confkey is distinct from array[parent_att]::smallint[]
       or not fk.convalidated or fk.condeferrable or fk.condeferred
       or fk.confmatchtype<>'s' or fk.confupdtype<>'a' or fk.confdeltype not in ('r','c')
       or not fk.conislocal or fk.coninhcount<>0 or fk.conparentid<>0
       or fk.confdelsetcols is not null
       or pg_catalog.pg_get_constraintdef(fk.oid) is distinct from
         format('FOREIGN KEY (%s) REFERENCES %s(id) ON DELETE %s',reference_name,
           case when reference_name='role_id' then 'roles' else 'permissions' end,
           case when fk.confdeltype='r' then 'RESTRICT' else 'CASCADE' end) then
      raise exception 'Unrecognized identity FK %',expected_name using errcode='23514';
    end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_constraint where conrelid='public.role_permissions'::regclass
      and contype='f' and (conkey && pair_atts or confrelid in ('public.roles'::regclass,'public.permissions'::regclass))
      and conname not in ('role_permissions_role_id_fkey','role_permissions_permission_id_fkey')) then
    raise exception 'Competing identity relationship constraint' using errcode='23514';
  end if;

  if exists(select 1 from public.role_permissions g
      left join public.roles r on r.id=g.role_id left join public.permissions p on p.id=g.permission_id
      where g.role_id is null or g.permission_id is null or r.id is null or p.id is null)
     or exists(select 1 from public.role_permissions group by role_id,permission_id having count(*)>1) then
    raise exception 'NULL, orphan or duplicate grant UUID identity requires reviewed reconciliation' using errcode='23514';
  end if;

  -- Rule 1: every referenced parent has one nonempty folded key target.
  if exists(select 1 from public.role_permissions g
      join public.roles r on r.id=g.role_id join public.permissions p on p.id=g.permission_id
      where lower(coalesce(r.key,''))='' or lower(coalesce(p.key,''))=''
        or (select count(*) from public.roles candidate where lower(coalesce(candidate.key,''))=lower(coalesce(r.key,'')))<>1
        or (select count(*) from public.permissions candidate where lower(coalesce(candidate.key,''))=lower(coalesce(p.key,'')))<>1) then
    raise exception 'Empty or ambiguous referenced parent key' using errcode='23514';
  end if;
  -- Rules 2-3: optional keys may be absent, but present values must resolve to
  -- the exact UUID parent. Do not trim, normalize aliases, or skip empty values.
  if exists(select 1 from public.role_permissions g
      join public.roles r on r.id=g.role_id join public.permissions p on p.id=g.permission_id
      where (g.role_key is not null and (
        lower(coalesce(g.role_key,''))<>lower(coalesce(r.key,''))
        or exists(select 1 from public.roles candidate where candidate.id<>r.id and (
          lower(coalesce(candidate.key,''))=lower(coalesce(g.role_key,''))
          or lower(coalesce(candidate.key,candidate.name,''))=lower(coalesce(g.role_key,''))))))
        or (g.permission_key is not null and lower(coalesce(g.permission_key,''))<>lower(coalesce(p.key,'')))) then
    raise exception 'Conflicting or ambiguous grant compatibility key' using errcode='23514';
  end if;
  -- Rule 4 is the real helper OR join, including its LEFT JOIN null extension.
  -- All assignment statuses and grant effects participate in this admission.
  if exists(select 1 from public.user_roles u
      left join public.roles r on r.id=u.role_id or lower(coalesce(r.key,''))=lower(coalesce(u.role,''))
      join public.role_permissions g on g.role_id=r.id or lower(coalesce(g.role_key,''))=lower(coalesce(u.role,r.key,''))
      where r.id is null or g.role_id<>r.id)
     or exists(select 1 from public.user_roles u
       join public.roles r on r.id=u.role_id or lower(coalesce(r.key,''))=lower(coalesce(u.role,''))
       where u.role_id is not null and u.role_id<>r.id) then
    raise exception 'Conflicting legacy assignment grant resolution' using errcode='23514';
  end if;

  if exists(select 1 from pg_catalog.pg_attribute where attrelid='public.role_permissions'::regclass and attname='role_id' and not attnotnull and not attisdropped) then
    alter table public.role_permissions alter column role_id set not null;
  end if;
  if exists(select 1 from pg_catalog.pg_attribute where attrelid='public.role_permissions'::regclass and attname='permission_id' and not attnotnull and not attisdropped) then
    alter table public.role_permissions alter column permission_id set not null;
  end if;
end;
$$;
commit;
