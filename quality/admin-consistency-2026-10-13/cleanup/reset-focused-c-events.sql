-- Authorized customer-flow reset c-events; root-only execution. Run C, B, A, D.
-- Original reviewed counts/hashes remain fixed; no blanket FK/trigger bypass.
begin isolation level repeatable read;
set local lock_timeout='10s'; set local statement_timeout='90s';
do $focused$
declare r record;n bigint;h text;v_ids uuid[];pinned jsonb:='{}';kept jsonb:='[]';
begin
 lock table public.customer_sites,public.customers,public.metering_points,public.website_customer_applications in share row exclusive mode;
 if exists(select 1 from public.customers) or exists(select 1 from public.website_customer_applications)
  or exists(select 1 from public.metering_points) or exists(select 1 from public.customer_sites) then raise exception 'focused_reset_source_not_empty';end if;
 if exists(select 1 from pg_constraint where contype='f' and connamespace='public'::regnamespace and not convalidated) then raise exception 'focused_reset_unvalidated_fk';end if;
 for r in select * from(values
  ('customer_domain_outbox','event_outbox','exists(select 1 from public.domain_events d where d.id=t.domain_event_id and d.aggregate_type in(''customer_contract'',''website_customer_application'',''invoice_export_run''))',17,'c5172839f84574dd45e2cb2cc58f754c',0),
  ('customer_canonical_outbox','canonical_event_outbox','exists(select 1 from public.canonical_domain_events d where d.id=t.domain_event_id and d.aggregate_type=''website_customer_application'')',5,'9fca32650fd9e26c1f387b050e45b239',1),
  ('customer_domain_events','domain_events','t.aggregate_type in(''customer_contract'',''website_customer_application'',''invoice_export_run'')',17,'abe2b4c09c9c504346a83a00e51af15d',2),
  ('customer_canonical_events','canonical_domain_events','t.aggregate_type=''website_customer_application''',5,'88bcc90ee356efa27f47f5d0cfa4ec9b',3),
  ('customer_energy_events','canonical_energy_flow_events','t.event_scope=''tenant'' and t.event_type in(''energy_area.resolved'',''quote.created'',''quote.validated'')',86,'4b9956744080025910a497f7c3bac045',4)
 ) s(scope_name,table_name,predicate,expected_count,expected_hash,delete_order) order by delete_order loop
  execute format('select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from(select t.* from public.%I t where %s for update of t)t',r.table_name,r.predicate) into v_ids,n,h;
  if n<>r.expected_count or h<>r.expected_hash then raise exception 'focused_reset_stale:%',r.scope_name;end if;
  pinned:=jsonb_set(pinned,array[r.table_name],jsonb_build_object('ids',to_jsonb(coalesce(v_ids,'{}'::uuid[])),'predicate',r.predicate));
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where not coalesce((%s),false)',r.table_name,r.predicate) into n,h;
  kept:=kept||jsonb_build_array(jsonb_build_object('t',r.table_name,'p','not coalesce(('||r.predicate||'),false)','n',n,'h',h));
 end loop;
 for r in select unnest(array['actor_test_attempt_evidence','actor_test_attempts','actor_test_manual_attestations','audit_logs','communication_log_events','companies','company_memberships','ediel_ack_transaction_results','ediel_message_events','ediel_messages','ediel_processing_runs','ediel_routing_decisions','ediel_test_artifacts','ediel_test_run_messages','ediel_test_run_steps','ediel_test_runs','inbound_operation_events','integration_api_client_profiles','integration_api_clients','manual_email_outbox','manual_inbound_messages','permissions','platform_usage_event_failures','platform_usage_events','roles','tenant_email_outbox','user_roles']) as table_name loop
  if to_regclass('public.'||r.table_name) is null then raise exception 'focused_reset_missing_preserved_table:%',r.table_name;end if;
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.table_name) into n,h;
  kept:=kept||jsonb_build_array(jsonb_build_object('t',r.table_name,'p','true','n',n,'h',h));
 end loop;
 for r in select * from(values
  ('customer_domain_outbox','event_outbox','exists(select 1 from public.domain_events d where d.id=t.domain_event_id and d.aggregate_type in(''customer_contract'',''website_customer_application'',''invoice_export_run''))',17,'c5172839f84574dd45e2cb2cc58f754c',0),
  ('customer_canonical_outbox','canonical_event_outbox','exists(select 1 from public.canonical_domain_events d where d.id=t.domain_event_id and d.aggregate_type=''website_customer_application'')',5,'9fca32650fd9e26c1f387b050e45b239',1),
  ('customer_domain_events','domain_events','t.aggregate_type in(''customer_contract'',''website_customer_application'',''invoice_export_run'')',17,'abe2b4c09c9c504346a83a00e51af15d',2),
  ('customer_canonical_events','canonical_domain_events','t.aggregate_type=''website_customer_application''',5,'88bcc90ee356efa27f47f5d0cfa4ec9b',3),
  ('customer_energy_events','canonical_energy_flow_events','t.event_scope=''tenant'' and t.event_type in(''energy_area.resolved'',''quote.created'',''quote.validated'')',86,'4b9956744080025910a497f7c3bac045',4)
 ) s(scope_name,table_name,predicate,expected_count,expected_hash,delete_order) order by delete_order loop
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_ids from jsonb_array_elements_text(pinned->r.table_name->'ids');
  execute format('delete from public.%I where id=any($1)',r.table_name) using v_ids;
  get diagnostics n=row_count;if n<>r.expected_count then raise exception 'focused_reset_deleted_count:%',r.scope_name;end if;
 end loop;
 for r in select value->>'t' as t,value->>'p' as p,(value->>'n')::bigint as n,value->>'h' as h from jsonb_array_elements(kept) loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where %s',r.t,r.p) into n,h;
  if n<>r.n or h<>r.h then raise exception 'focused_reset_changed_preserved:%',r.t;end if;
 end loop;
 for r in select key as t,value->'ids' as ids,value->>'predicate' as predicate from jsonb_each(pinned) loop
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_ids from jsonb_array_elements_text(r.ids);
  execute format('select count(*) from public.%I where id=any($1)',r.t) into n using v_ids;
  if n<>0 then raise exception 'focused_reset_pinned_residual:%',r.t;end if;
  execute format('select count(*) from public.%I t where %s',r.t,r.predicate) into n;
  if n<>0 then raise exception 'focused_reset_scope_residual:%',r.t;end if;
 end loop;
 if exists(select 1 from public.customers) or exists(select 1 from public.website_customer_applications)
  or exists(select 1 from public.metering_points) or exists(select 1 from public.customer_sites) then raise exception 'focused_reset_new_source';end if;
end $focused$;
commit;
select 'focused_customer_reset_c-events_committed' as result;
