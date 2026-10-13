-- Reviewed C3: customer_domain_events. Root only; retain reviewed fingerprint.
begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';
do $reset$ declare ids uuid[];n bigint;h text;k text;k0 text;begin
lock table public.customers,public.customer_sites,public.metering_points,public.website_customer_applications in share row exclusive mode;lock table public.domain_events in row exclusive mode;
if exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications) then raise exception 'static_reset_source_not_empty';end if;
if exists(select 1 from pg_constraint where contype='f' and confrelid='public.domain_events'::regclass and conrelid<>all(array['public.event_outbox'::regclass,'public.webhook_deliveries'::regclass])) or exists(select 1 from pg_trigger where tgrelid='public.domain_events'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:domain_events';end if;
select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into ids,n,h from(select t.* from public.domain_events t where t.aggregate_type in('customer_contract','website_customer_application','invoice_export_run') for update of t)t;
if n<>17 or h<>'abe2b4c09c9c504346a83a00e51af15d' then raise exception 'static_reset_stale:customer_domain_events';end if;
if exists(select 1 from public.webhook_deliveries) then raise exception 'static_reset_child_not_empty:webhook_deliveries';end if;
if exists(select 1 from public.event_outbox where domain_event_id=any(ids)) then raise exception 'static_reset_customer_outbox_remains';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k from public.domain_events t where t.id<>all(coalesce(ids,'{}'::uuid[]));
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k0 from public.event_outbox t;
delete from public.domain_events where id=any(ids);get diagnostics n=row_count;
if n<>17 or exists(select 1 from public.domain_events where id=any(ids)) then raise exception 'static_reset_delete_mismatch:customer_domain_events';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.domain_events t where t.id<>all(coalesce(ids,'{}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:domain_events';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.event_outbox t;if h<>k0 then raise exception 'static_reset_changed_child:event_outbox';end if;
end $reset$;commit;
select 'static_customer_reset_c3_committed' as result;
