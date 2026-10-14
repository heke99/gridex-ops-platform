-- Reviewed B5: bidding_zone_monthly_metrics. Root only; retain reviewed fingerprint.
begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';
do $reset$ declare ids uuid[];n bigint;h text;k text;begin
lock table public.customers,public.customer_sites,public.metering_points,public.website_customer_applications in share row exclusive mode;lock table public.bidding_zone_monthly_metrics in share row exclusive mode;
if exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications) then raise exception 'static_reset_source_not_empty';end if;
if exists(select 1 from pg_constraint where contype='f' and confrelid='public.bidding_zone_monthly_metrics'::regclass) or exists(select 1 from pg_trigger where tgrelid='public.bidding_zone_monthly_metrics'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:bidding_zone_monthly_metrics';end if;
select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into ids,n,h from(select t.* from public.bidding_zone_monthly_metrics t where true for update of t)t;
if n<>48 or h<>'12870fa545eea5e7aa28303a5afecd6b' then raise exception 'static_reset_stale:bidding_zone_monthly_metrics';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k from public.bidding_zone_monthly_metrics t where t.id<>all(coalesce(ids,'{}'::uuid[]));
delete from public.bidding_zone_monthly_metrics where id=any(ids);get diagnostics n=row_count;
if n<>48 or exists(select 1 from public.bidding_zone_monthly_metrics where id=any(ids)) then raise exception 'static_reset_delete_mismatch:bidding_zone_monthly_metrics';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.bidding_zone_monthly_metrics t where t.id<>all(coalesce(ids,'{}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:bidding_zone_monthly_metrics';end if;
end $reset$;commit;
select 'static_customer_reset_b5_committed' as result;
