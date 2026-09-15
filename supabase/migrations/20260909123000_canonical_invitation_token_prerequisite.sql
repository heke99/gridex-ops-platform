-- Source prerequisite for 20260519_final_saas_hardening's token index.
-- No historical credentials are minted, copied, converted or repaired.
-- Nullable compatibility does not satisfy final invitation runtime readiness.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- Deparse defaults against the builtin namespace: a same-named custom function
-- remains qualified and is rejected. No custom/extension wrapper is assumed equivalent.
set local search_path = pg_catalog;

do $$
declare
  invitation_oid oid := to_regclass('public.company_invitations');
  token_attribute record;
  id_number smallint;
  token_number smallint;
  index_oid oid;
  token_default text;
begin
  if invitation_oid is null or not exists (
    select 1 from pg_class where oid=invitation_oid and relkind='r'
      and relnamespace='public'::regnamespace and not relispartition
  ) or exists(select 1 from pg_inherits where inhrelid=invitation_oid or inhparent=invitation_oid) then
    raise exception 'Invitation token prerequisite: relation' using errcode='23514';
  end if;
  -- Blocks concurrent INSERT/UPDATE/DDL until this transaction ends. Both the
  -- emptiness branch and duplicate admission run only after this lock is held.
  lock table public.company_invitations in access exclusive mode;
  -- The unlocked check gives a controlled diagnostic. This check is authoritative:
  -- every admitted relation property must still hold after acquiring the lock.
  if to_regclass('public.company_invitations') is distinct from invitation_oid or not exists (
    select 1 from pg_class where oid=invitation_oid and relkind='r'
      and relnamespace='public'::regnamespace and not relispartition
  ) or exists(select 1 from pg_inherits where inhrelid=invitation_oid or inhparent=invitation_oid) then
    raise exception 'Invitation token prerequisite: relation' using errcode='23514';
  end if;
  select attnum into id_number from pg_attribute
    where attrelid=invitation_oid and attname='id' and not attisdropped
      and atttypid='uuid'::regtype and attnotnull and attgenerated='' and attidentity='';
  if id_number is null or not exists (
    select 1 from pg_constraint c join pg_index i on i.indexrelid=c.conindid
    where c.conrelid=invitation_oid and c.contype='p' and c.conkey=array[id_number]
      and c.convalidated and not c.condeferrable and i.indisvalid and i.indisready and i.indislive
  ) then
    raise exception 'Invitation token prerequisite: identity' using errcode='23514';
  end if;

  select * into token_attribute from pg_attribute
    where attrelid=invitation_oid and attname='token' and not attisdropped;
  token_number := token_attribute.attnum;
  if token_number is not null then
    if token_attribute.atttypid <> 'uuid'::regtype or token_attribute.attgenerated <> ''
       or token_attribute.attidentity <> '' then
      raise exception 'Invitation token prerequisite: type' using errcode='23514';
    end if;
    select pg_get_expr(adbin,adrelid) into token_default from pg_attrdef
      where adrelid=invitation_oid and adnum=token_number;
    if token_default is not null and token_default <> 'gen_random_uuid()' then
      raise exception 'Invitation token prerequisite: default' using errcode='23514';
    end if;
    if exists(select 1 from public.company_invitations where token is not null group by token having count(*)>1) then
      raise exception 'Invitation token prerequisite: duplicates' using errcode='23514';
    end if;
  end if;

  index_oid := to_regclass('public.company_invitations_token_key');
  if index_oid is not null and not exists (
    select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
    join pg_am am on am.oid=c.relam
    join pg_opclass op on op.oid=i.indclass[0]
    where i.indexrelid=index_oid and i.indrelid=invitation_oid and c.relkind='i'
      and am.amname='btree' and i.indisunique and not i.indisprimary and not i.indisexclusion
      and i.indimmediate and not i.indnullsnotdistinct
      and i.indisvalid and i.indisready and i.indislive
      and i.indnatts=1 and i.indnkeyatts=1 and i.indkey[0]=token_number
      and i.indpred is null and i.indexprs is null and i.indoption[0]=0 and i.indcollation[0]=0
      and op.opcnamespace='pg_catalog'::regnamespace and op.opcname='uuid_ops'
      and op.opcdefault and op.opcintype='uuid'::regtype and op.opcmethod=am.oid
  ) then
    raise exception 'Invitation token prerequisite: index' using errcode='23514';
  end if;

  -- All admission precedes mutation. The later complete source owns the index.
  if token_number is null then
    if exists(select 1 from public.company_invitations) then
      -- Explicit existing-row compatibility: preserve every historical NULL.
      alter table public.company_invitations add column token uuid;
    else
      alter table public.company_invitations add column token uuid not null default gen_random_uuid();
    end if;
  end if;
end;
$$;
commit;
