-- Reviewed B7: forecast_runs. Root only; retain reviewed fingerprint.
begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';
do $reset$ declare ids uuid[];n bigint;h text;k text;begin
lock table public.customers,public.customer_sites,public.metering_points,public.website_customer_applications in share row exclusive mode;lock table public.forecast_runs in share row exclusive mode;
if exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications) then raise exception 'static_reset_source_not_empty';end if;
if exists(select 1 from pg_constraint where contype='f' and confrelid='public.forecast_runs'::regclass and conrelid<>all(array['public.forecast_adjustments'::regclass,'public.forecast_run_items'::regclass])) or exists(select 1 from pg_trigger where tgrelid='public.forecast_runs'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:forecast_runs';end if;
select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into ids,n,h from(select t.* from public.forecast_runs t where true for update of t)t;
if n<>38 or h<>'cd4f43b887ac211e4d6f0461070adaa4' then raise exception 'static_reset_stale:forecast_runs';end if;
if exists(select 1 from public.forecast_run_items) then raise exception 'static_reset_child_not_empty:forecast_run_items';end if;
if exists(select 1 from public.forecast_adjustments) then raise exception 'static_reset_child_not_empty:forecast_adjustments';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k from public.forecast_runs t where t.id<>all(coalesce(ids,'{}'::uuid[]));
delete from public.forecast_runs where id=any(ids);get diagnostics n=row_count;
if n<>38 or exists(select 1 from public.forecast_runs where id=any(ids)) then raise exception 'static_reset_delete_mismatch:forecast_runs';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.forecast_runs t where t.id<>all(coalesce(ids,'{}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:forecast_runs';end if;
end $reset$;commit;
select 'static_customer_reset_b7_committed' as result;
