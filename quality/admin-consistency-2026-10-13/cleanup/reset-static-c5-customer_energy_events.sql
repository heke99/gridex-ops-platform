-- Reviewed C5: customer_energy_events. Root only; retain reviewed fingerprint.
begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';
do $reset$ declare ids uuid[];n bigint;h text;k text;begin
lock table public.customers,public.customer_sites,public.metering_points,public.website_customer_applications in share row exclusive mode;lock table public.canonical_energy_flow_events in row exclusive mode;
if exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications) then raise exception 'static_reset_source_not_empty';end if;
if exists(select 1 from pg_constraint where contype='f' and confrelid='public.canonical_energy_flow_events'::regclass) or exists(select 1 from pg_trigger where tgrelid='public.canonical_energy_flow_events'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:canonical_energy_flow_events';end if;
select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into ids,n,h from(select t.* from public.canonical_energy_flow_events t where t.event_scope='tenant' and t.event_type in('energy_area.resolved','quote.created','quote.validated') for update of t)t;
if n<>86 or h<>'4b9956744080025910a497f7c3bac045' then raise exception 'static_reset_stale:customer_energy_events';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k from public.canonical_energy_flow_events t where t.id<>all(coalesce(ids,'{}'::uuid[]));
delete from public.canonical_energy_flow_events where id=any(ids);get diagnostics n=row_count;
if n<>86 or exists(select 1 from public.canonical_energy_flow_events where id=any(ids)) then raise exception 'static_reset_delete_mismatch:customer_energy_events';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.canonical_energy_flow_events t where t.id<>all(coalesce(ids,'{}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:canonical_energy_flow_events';end if;
end $reset$;commit;
select 'static_customer_reset_c5_committed' as result;
