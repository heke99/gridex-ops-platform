-- Customer and live-month analytics share the same uncapped physical-source
-- predicate as the scanner and monthly company/grid-owner builders.
create or replace function public.gridex_missing_metering_points_count_v1(
 p_company uuid,p_month date,p_customer uuid default null
) returns bigint language sql stable security invoker set search_path=public,pg_temp as $$
 select count(*) from public.gridex_missing_metering_points_v1(p_company,date_trunc('month',p_month)::date) missing
 join public.metering_points p on p.id=missing.metering_point_id and p.company_id=p_company
 where p_customer is null or p.customer_id=p_customer
$$;
revoke all on function public.gridex_missing_metering_points_count_v1(uuid,date,uuid) from public,anon;
grant execute on function public.gridex_missing_metering_points_count_v1(uuid,date,uuid) to authenticated,service_role;
