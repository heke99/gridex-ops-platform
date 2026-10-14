-- A deleted raw row must not erase the identity used to reject provider replay.
-- No existing source is retired/deleted here. Authorized future DELETE commands
-- retire only their OLD row's stable identity; existing source RLS/grants remain.
create schema if not exists gridex_manual_inbound;
revoke all on schema gridex_manual_inbound from public,anon,authenticated,service_role;
grant usage on schema gridex_manual_inbound to service_role;

create table if not exists gridex_manual_inbound.retired_source_keys(
 source_key bytea primary key check(octet_length(source_key)=32),
 retired_at timestamptz not null default now()
);
alter table gridex_manual_inbound.retired_source_keys enable row level security;
revoke all on gridex_manual_inbound.retired_source_keys from public,anon,authenticated,service_role;
grant select on gridex_manual_inbound.retired_source_keys to service_role;
drop policy if exists retired_source_keys_service_read on gridex_manual_inbound.retired_source_keys;
create policy retired_source_keys_service_read on gridex_manual_inbound.retired_source_keys
 for select to service_role using(true);

-- JSON array encoding preserves tuple boundaries, Unicode and escaped content.
-- sha256(bytea) is built into PostgreSQL; no pgcrypto extension is required.
create or replace function gridex_manual_inbound.manual_source_key_v1(p_mailbox text,p_provider_id text)
returns bytea language sql immutable security invoker set search_path=pg_catalog,pg_temp as $$
 select case when nullif(btrim(p_mailbox),'') is null or nullif(btrim(p_provider_id),'') is null then null
  else sha256(convert_to(jsonb_build_array(lower(btrim(p_mailbox)),btrim(p_provider_id))::text,'UTF8')) end
$$;
create or replace function gridex_manual_inbound.lock_manual_source_key_v1(p_key bytea)
returns void language sql volatile security invoker set search_path=pg_catalog,pg_temp as $$
 select pg_advisory_xact_lock(hashtextextended('manual-inbound-source:'||encode(p_key,'hex'),0))
$$;

create or replace function gridex_manual_inbound.reject_retired_source_v1()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare v_key bytea;begin
 v_key:=gridex_manual_inbound.manual_source_key_v1(new.mailbox,new.provider_message_id);
 if v_key is not null then
  perform gridex_manual_inbound.lock_manual_source_key_v1(v_key);
  -- VOLATILE SPI reads take a fresh snapshot after any advisory-lock wait.
  if exists(select 1 from gridex_manual_inbound.retired_source_keys where source_key=v_key) then
   raise exception 'manual_inbound_source_retired' using errcode='23514';
  end if;
 end if;
 return new;
end$$;
create or replace function gridex_manual_inbound.retire_deleted_source_v1()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare v_key bytea;begin
 v_key:=gridex_manual_inbound.manual_source_key_v1(old.mailbox,old.provider_message_id);
 if v_key is not null then
  perform gridex_manual_inbound.lock_manual_source_key_v1(v_key);
  insert into gridex_manual_inbound.retired_source_keys(source_key) values(v_key) on conflict(source_key) do nothing;
 end if;
 return old;
end$$;
create or replace function gridex_manual_inbound.reject_retired_key_mutation_v1()
returns trigger language plpgsql security invoker set search_path=pg_catalog,pg_temp as $$
begin raise exception 'retired_manual_source_keys_immutable' using errcode='55000';end$$;

drop trigger if exists manual_inbound_reject_retired_source on public.manual_inbound_messages;
create trigger manual_inbound_reject_retired_source before insert on public.manual_inbound_messages
 for each row execute function gridex_manual_inbound.reject_retired_source_v1();
drop trigger if exists manual_inbound_retire_deleted_source on public.manual_inbound_messages;
create trigger manual_inbound_retire_deleted_source before delete on public.manual_inbound_messages
 for each row execute function gridex_manual_inbound.retire_deleted_source_v1();
drop trigger if exists retired_source_keys_immutable on gridex_manual_inbound.retired_source_keys;
create trigger retired_source_keys_immutable before update or delete on gridex_manual_inbound.retired_source_keys
 for each row execute function gridex_manual_inbound.reject_retired_key_mutation_v1();
drop trigger if exists retired_source_keys_no_truncate on gridex_manual_inbound.retired_source_keys;
create trigger retired_source_keys_no_truncate before truncate on gridex_manual_inbound.retired_source_keys
 for each statement execute function gridex_manual_inbound.reject_retired_key_mutation_v1();

create or replace function public.gridex_manual_inbound_source_retired_v1(p_mailbox text,p_provider_id text)
returns boolean language plpgsql volatile security definer set search_path=pg_catalog,pg_temp as $$
declare v_key bytea;begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'manual_inbound_service_role_required' using errcode='42501';end if;
 v_key:=gridex_manual_inbound.manual_source_key_v1(p_mailbox,p_provider_id);
 if v_key is null then return false;end if;
 perform gridex_manual_inbound.lock_manual_source_key_v1(v_key);
 return exists(select 1 from gridex_manual_inbound.retired_source_keys where source_key=v_key);
end$$;

revoke all on function gridex_manual_inbound.manual_source_key_v1(text,text),
 gridex_manual_inbound.lock_manual_source_key_v1(bytea),gridex_manual_inbound.reject_retired_source_v1(),
 gridex_manual_inbound.retire_deleted_source_v1(),gridex_manual_inbound.reject_retired_key_mutation_v1()
 from public,anon,authenticated,service_role;
revoke all on function public.gridex_manual_inbound_source_retired_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.gridex_manual_inbound_source_retired_v1(text,text) to service_role;

comment on table gridex_manual_inbound.retired_source_keys is
 'Immutable SHA256 identities of authorized deleted manual-mail sources; no mailbox, provider identifier, body or sender is stored.';
