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
revoke all on function gridex_manual_inbound.reject_retired_source_v1(),gridex_manual_inbound.retire_deleted_source_v1() from public,anon,authenticated,service_role;
drop trigger if exists manual_inbound_reject_retired_source on public.manual_inbound_messages;
create trigger manual_inbound_reject_retired_source before insert on public.manual_inbound_messages
 for each row execute function gridex_manual_inbound.reject_retired_source_v1();
drop trigger if exists manual_inbound_retire_deleted_source on public.manual_inbound_messages;
create trigger manual_inbound_retire_deleted_source before delete on public.manual_inbound_messages
 for each row execute function gridex_manual_inbound.retire_deleted_source_v1();

