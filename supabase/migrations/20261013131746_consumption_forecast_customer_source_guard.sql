-- The currently deployed producer inserts consumption runs before it calls the
-- guarded monthly builder. Protect that direct write during the app rollout;
-- updated producers skip empty sources before insertion. Other forecast types
-- and existing history are unchanged. Preserve the inserting role's source RLS.
create or replace function private.gridex_require_consumption_forecast_customer_source()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if new.forecast_type='consumption' and
    (new.company_id is null or not public.gridex_company_has_customer_data(new.company_id)) then
  raise exception 'forecast_customer_source_required' using errcode='22023';
 end if;
 return new;
end $$;

revoke all on function private.gridex_require_consumption_forecast_customer_source()
 from public,anon,authenticated,service_role;

drop trigger if exists gridex_consumption_forecast_customer_source on public.forecast_runs;
create trigger gridex_consumption_forecast_customer_source
 before insert on public.forecast_runs for each row
 execute function private.gridex_require_consumption_forecast_customer_source();
