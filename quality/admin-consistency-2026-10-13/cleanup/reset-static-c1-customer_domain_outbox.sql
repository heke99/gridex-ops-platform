-- Reviewed C1: customer_domain_outbox. Root only; retain reviewed fingerprint.
begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';
do $reset$ declare ids uuid[];n bigint;h text;k text;begin
lock table public.customers,public.customer_sites,public.metering_points,public.website_customer_applications in share row exclusive mode;lock table public.event_outbox in row exclusive mode;
if exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications) then raise exception 'static_reset_source_not_empty';end if;
if exists(select 1 from pg_constraint where contype='f' and confrelid='public.event_outbox'::regclass) or exists(select 1 from pg_trigger where tgrelid='public.event_outbox'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:event_outbox';end if;
select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into ids,n,h from(select t.* from public.event_outbox t where exists(select 1 from public.domain_events d where d.id=t.domain_event_id and d.aggregate_type in('customer_contract','website_customer_application','invoice_export_run')) for update of t)t;
if n<>17 or h<>'c5172839f84574dd45e2cb2cc58f754c' then raise exception 'static_reset_stale:customer_domain_outbox';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k from public.event_outbox t where t.id<>all(coalesce(ids,'{}'::uuid[]));
delete from public.event_outbox where id=any(ids);get diagnostics n=row_count;
if n<>17 or exists(select 1 from public.event_outbox where id=any(ids)) then raise exception 'static_reset_delete_mismatch:customer_domain_outbox';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.event_outbox t where t.id<>all(coalesce(ids,'{}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:event_outbox';end if;
end $reset$;commit;
select 'static_customer_reset_c1_committed' as result;
