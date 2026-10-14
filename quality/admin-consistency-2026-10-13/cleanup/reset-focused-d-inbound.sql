-- Authorized customer-flow reset d-inbound; root-only execution. Run C, B, A, D.
-- Original reviewed counts/hashes remain fixed; no blanket FK/trigger bypass.
begin isolation level repeatable read;
set local lock_timeout='10s'; set local statement_timeout='90s';
do $focused$
declare r record;n bigint;h text;v_ids uuid[];pinned jsonb:='{}';kept jsonb:='[]';
begin
 lock table public.customer_sites,public.customers,public.inbound_operation_events,public.manual_inbound_messages,public.metering_points,public.website_customer_applications in share row exclusive mode;
 if exists(select 1 from public.customers) or exists(select 1 from public.website_customer_applications)
  or exists(select 1 from public.metering_points) or exists(select 1 from public.customer_sites) then raise exception 'focused_reset_source_not_empty';end if;
 if exists(select 1 from pg_constraint where contype='f' and connamespace='public'::regnamespace and not convalidated) then raise exception 'focused_reset_unvalidated_fk';end if;
 for r in select * from(values
  ('manual_inbound_messages','manual_inbound_messages','t.request_id is null and t.resolution_status=''unmatched'' and exists(select 1 from public.inbound_operation_events e where e.source_id=t.id::text and e.source_transport=''email'' and e.business_process=''power_of_attorney'' and e.intent=''power_of_attorney_question'' and e.customer_id is null and e.customer_site_id is null and e.metering_point_id is null and e.business_object_id is null)',1,'38ce4b37ae7cea047f146500ef7a6d92',7),
  ('inbound_operation_events','inbound_operation_events','t.source_transport=''email'' and t.business_process=''power_of_attorney'' and t.intent=''power_of_attorney_question'' and t.customer_id is null and t.customer_site_id is null and t.metering_point_id is null and t.business_object_id is null and exists(select 1 from public.manual_inbound_messages m where m.id::text=t.source_id and m.request_id is null and m.resolution_status=''unmatched'') and not exists(select 1 from public.ediel_messages m where m.id::text=t.source_id)',1,'d9737a11a782b02e4b955d3e2aa8a427',8)
 ) s(scope_name,table_name,predicate,expected_count,expected_hash,delete_order) order by delete_order loop
  execute format('select array_agg(t.id order by t.id),count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from(select t.* from public.%I t where %s for update of t)t',r.table_name,r.predicate) into v_ids,n,h;
  if n<>r.expected_count or h<>r.expected_hash then raise exception 'focused_reset_stale:%',r.scope_name;end if;
  pinned:=jsonb_set(pinned,array[r.table_name],jsonb_build_object('ids',to_jsonb(coalesce(v_ids,'{}'::uuid[])),'predicate',r.predicate));
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where not coalesce((%s),false)',r.table_name,r.predicate) into n,h;
  kept:=kept||jsonb_build_array(jsonb_build_object('t',r.table_name,'p','not coalesce(('||r.predicate||'),false)','n',n,'h',h));
 end loop;
 for r in select unnest(array['actor_test_attempt_evidence','actor_test_attempts','actor_test_manual_attestations','audit_logs','canonical_domain_events','canonical_energy_flow_events','canonical_event_outbox','communication_log_events','companies','company_memberships','domain_events','ediel_ack_transaction_results','ediel_message_events','ediel_messages','ediel_processing_runs','ediel_routing_decisions','ediel_test_artifacts','ediel_test_run_messages','ediel_test_run_steps','ediel_test_runs','event_outbox','integration_api_client_profiles','integration_api_clients','manual_email_outbox','permissions','platform_usage_event_failures','platform_usage_events','roles','tenant_email_outbox','user_roles']) as table_name loop
  if to_regclass('public.'||r.table_name) is null then raise exception 'focused_reset_missing_preserved_table:%',r.table_name;end if;
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.table_name) into n,h;
  kept:=kept||jsonb_build_array(jsonb_build_object('t',r.table_name,'p','true','n',n,'h',h));
 end loop;
 for r in select * from(values
  ('manual_inbound_messages','manual_inbound_messages','t.request_id is null and t.resolution_status=''unmatched'' and exists(select 1 from public.inbound_operation_events e where e.source_id=t.id::text and e.source_transport=''email'' and e.business_process=''power_of_attorney'' and e.intent=''power_of_attorney_question'' and e.customer_id is null and e.customer_site_id is null and e.metering_point_id is null and e.business_object_id is null)',1,'38ce4b37ae7cea047f146500ef7a6d92',7),
  ('inbound_operation_events','inbound_operation_events','t.source_transport=''email'' and t.business_process=''power_of_attorney'' and t.intent=''power_of_attorney_question'' and t.customer_id is null and t.customer_site_id is null and t.metering_point_id is null and t.business_object_id is null and exists(select 1 from public.manual_inbound_messages m where m.id::text=t.source_id and m.request_id is null and m.resolution_status=''unmatched'') and not exists(select 1 from public.ediel_messages m where m.id::text=t.source_id)',1,'d9737a11a782b02e4b955d3e2aa8a427',8)
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
select 'focused_customer_reset_d-inbound_committed' as result;
