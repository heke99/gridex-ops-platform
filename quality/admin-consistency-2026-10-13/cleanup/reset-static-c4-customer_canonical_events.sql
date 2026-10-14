-- Reviewed C4: customer_canonical_events. Root only; retain reviewed fingerprint.
begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';
do $reset$ declare ids uuid[];n bigint;h text;k text;k0 text;begin
lock table public.customers,public.customer_sites,public.metering_points,public.website_customer_applications in share row exclusive mode;lock table public.canonical_domain_events in row exclusive mode;
if exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications) then raise exception 'static_reset_source_not_empty';end if;
if exists(select 1 from pg_constraint where contype='f' and confrelid='public.canonical_domain_events'::regclass and conrelid<>all(array['public.canonical_event_outbox'::regclass])) or exists(select 1 from pg_trigger where tgrelid='public.canonical_domain_events'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:canonical_domain_events';end if;
select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into ids,n,h from(select t.* from public.canonical_domain_events t where t.aggregate_type='website_customer_application' for update of t)t;
if n<>5 or h<>'88bcc90ee356efa27f47f5d0cfa4ec9b' then raise exception 'static_reset_stale:customer_canonical_events';end if;
if exists(select 1 from public.canonical_event_outbox where domain_event_id=any(ids)) then raise exception 'static_reset_customer_canonical_outbox_remains';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k from public.canonical_domain_events t where t.id<>all(coalesce(ids,'{}'::uuid[]));
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k0 from public.canonical_event_outbox t;
delete from public.canonical_domain_events where id=any(ids);get diagnostics n=row_count;
if n<>5 or exists(select 1 from public.canonical_domain_events where id=any(ids)) then raise exception 'static_reset_delete_mismatch:customer_canonical_events';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.canonical_domain_events t where t.id<>all(coalesce(ids,'{}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:canonical_domain_events';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.canonical_event_outbox t;if h<>k0 then raise exception 'static_reset_changed_child:canonical_event_outbox';end if;
end $reset$;commit;
select 'static_customer_reset_c4_committed' as result;
