-- Reviewed B3: customer_site_resolution. Root only; retain reviewed fingerprint.
begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';
do $reset$ declare ids uuid[];n bigint;h text;k text;k0 text;begin
lock table public.customers,public.customer_sites,public.metering_points,public.website_customer_applications in share row exclusive mode;lock table public.customer_site_resolution in share row exclusive mode;
if exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications) then raise exception 'static_reset_source_not_empty';end if;
if exists(select 1 from pg_constraint where contype='f' and confrelid='public.customer_site_resolution'::regclass and conrelid<>all(array['public.canonical_energy_flow_events'::regclass,'public.grid_owner_information_requests'::regclass,'public.metering_points'::regclass,'public.website_contract_quotes'::regclass])) or exists(select 1 from pg_trigger where tgrelid='public.customer_site_resolution'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:customer_site_resolution';end if;
select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into ids,n,h from(select t.* from public.customer_site_resolution t where true for update of t)t;
if n<>39 or h<>'b5f340212b9decb1e2fdab57628acce4' then raise exception 'static_reset_stale:customer_site_resolution';end if;
if exists(select 1 from public.grid_owner_information_requests) then raise exception 'static_reset_child_not_empty:grid_owner_information_requests';end if;
if exists(select 1 from public.metering_points) then raise exception 'static_reset_child_not_empty:metering_points';end if;
if exists(select 1 from public.website_contract_quotes) then raise exception 'static_reset_child_not_empty:website_contract_quotes';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k from public.customer_site_resolution t where t.id<>all(coalesce(ids,'{}'::uuid[]));
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k0 from public.canonical_energy_flow_events t;
delete from public.customer_site_resolution where id=any(ids);get diagnostics n=row_count;
if n<>39 or exists(select 1 from public.customer_site_resolution where id=any(ids)) then raise exception 'static_reset_delete_mismatch:customer_site_resolution';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.customer_site_resolution t where t.id<>all(coalesce(ids,'{}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:customer_site_resolution';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.canonical_energy_flow_events t;if h<>k0 then raise exception 'static_reset_changed_child:canonical_energy_flow_events';end if;
end $reset$;commit;
select 'static_customer_reset_b3_committed' as result;
