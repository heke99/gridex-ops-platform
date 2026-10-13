-- Reviewed B2: website_contract_quotes. Root only; retain reviewed fingerprint.
begin isolation level repeatable read;set local lock_timeout='10s';set local statement_timeout='90s';
do $reset$ declare ids uuid[];n bigint;h text;k text;k0 text;begin
lock table public.customers,public.customer_sites,public.metering_points,public.website_customer_applications in share row exclusive mode;lock table public.website_contract_quotes in share row exclusive mode;
if exists(select 1 from public.customers) or exists(select 1 from public.customer_sites) or exists(select 1 from public.metering_points) or exists(select 1 from public.website_customer_applications) then raise exception 'static_reset_source_not_empty';end if;
if exists(select 1 from pg_constraint where contype='f' and confrelid='public.website_contract_quotes'::regclass and conrelid<>all(array['public.canonical_energy_flow_events'::regclass])) or exists(select 1 from pg_trigger where tgrelid='public.website_contract_quotes'::regclass and not tgisinternal and (tgtype&8)=8) then raise exception 'static_reset_schema_changed:website_contract_quotes';end if;
select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into ids,n,h from(select t.* from public.website_contract_quotes t where true for update of t)t;
if n<>24 or h<>'00f41acc1a04c4ab872f27ede9e9f576' then raise exception 'static_reset_stale:website_contract_quotes';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k from public.website_contract_quotes t where t.id<>all(coalesce(ids,'{}'::uuid[]));
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into k0 from public.canonical_energy_flow_events t;
delete from public.website_contract_quotes where id=any(ids);get diagnostics n=row_count;
if n<>24 or exists(select 1 from public.website_contract_quotes where id=any(ids)) then raise exception 'static_reset_delete_mismatch:website_contract_quotes';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.website_contract_quotes t where t.id<>all(coalesce(ids,'{}'::uuid[]));if h<>k then raise exception 'static_reset_changed_preserved:website_contract_quotes';end if;
select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.canonical_energy_flow_events t;if h<>k0 then raise exception 'static_reset_changed_child:canonical_energy_flow_events';end if;
end $reset$;commit;
select 'static_customer_reset_b2_committed' as result;
