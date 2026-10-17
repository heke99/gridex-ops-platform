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
revoke all on function public.gridex_manual_inbound_source_retired_v1(text,text) from public,anon,authenticated,service_role;
grant execute on function public.gridex_manual_inbound_source_retired_v1(text,text) to service_role;
