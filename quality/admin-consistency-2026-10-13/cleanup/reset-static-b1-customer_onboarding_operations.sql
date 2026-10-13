-- Reviewed B1: customer_onboarding_operations. Root only; retain reviewed fingerprint.
begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';
do $reset$ declare ids uuid[];n bigint;h text;k text;begin
lock table public.customers,public.customer_sites,public.metering_points,public.website_customer_applications in share row exclusive mode;lock table public.customer_onboarding_operations in share row exclusive mode;
if exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications) then raise exception 'static_reset_source_not_empty';end if;
if exists(select 1 from pg_constraint where contype='f' and confrelid='public.customer_onboarding_operations'::regclass and conrelid<>all(array['public.customer_match_review_cases'::regclass,'public.customer_onboarding_applications'::regclass,'public.customer_onboarding_legal_snapshots'::regclass])) or exists(select 1 from pg_trigger where tgrelid='public.customer_onboarding_operations'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:customer_onboarding_operations';end if;
select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into ids,n,h from(select t.* from public.customer_onboarding_operations t where true for update of t)t;
if n<>9 or h<>'4da4ad530f72cfc39a0495f5d0246f36' then raise exception 'static_reset_stale:customer_onboarding_operations';end if;
if exists(select 1 from public.customer_match_review_cases) then raise exception 'static_reset_child_not_empty:customer_match_review_cases';end if;
if exists(select 1 from public.customer_onboarding_applications) then raise exception 'static_reset_child_not_empty:customer_onboarding_applications';end if;
if exists(select 1 from public.customer_onboarding_legal_snapshots) then raise exception 'static_reset_child_not_empty:customer_onboarding_legal_snapshots';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k from public.customer_onboarding_operations t where t.id<>all(coalesce(ids,'{}'::uuid[]));
delete from public.customer_onboarding_operations where id=any(ids);get diagnostics n=row_count;
if n<>9 or exists(select 1 from public.customer_onboarding_operations where id=any(ids)) then raise exception 'static_reset_delete_mismatch:customer_onboarding_operations';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.customer_onboarding_operations t where t.id<>all(coalesce(ids,'{}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:customer_onboarding_operations';end if;
end $reset$;commit;
select 'static_customer_reset_b1_committed' as result;
