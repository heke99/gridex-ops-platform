-- Explicit user-authorized customer-flow reset. Root alone executes this file.
-- Fingerprints pin the reviewed rowsets. No blanket trigger/FK bypass, TRUNCATE,
-- or deletion of companies/users/configuration/technical proof is permitted.
-- Apply before the DQI migration, which changes issue/alert row fingerprints.
begin isolation level repeatable read;
set local lock_timeout='10s';
set local statement_timeout='90s';

-- Prevent a new customer/application producer from entering while roots reset.
-- Technical market/geodata event producers remain able to append unrelated rows.
lock table public.customers,public.website_customer_applications,public.website_contract_quotes,
 public.customer_onboarding_operations,public.customer_site_resolution,
 public.data_quality_issues,public.dashboard_alerts,public.forecast_runs,
 public.customer_portfolio_forecast_snapshots,public.company_monthly_metrics,
 public.bidding_zone_monthly_metrics,public.manual_inbound_messages,public.inbound_operation_events
 in share row exclusive mode;

create temporary table reset_scopes(scope_name text primary key,table_name text,predicate text,expected_count bigint,expected_hash text,delete_order integer) on commit drop;
insert into reset_scopes values
('customer_domain_outbox','event_outbox','exists(select 1 from public.domain_events d where d.id=t.domain_event_id and d.aggregate_type in(''customer_contract'',''website_customer_application'',''invoice_export_run''))',17,'c5172839f84574dd45e2cb2cc58f754c',0),
('customer_canonical_outbox','canonical_event_outbox','exists(select 1 from public.canonical_domain_events d where d.id=t.domain_event_id and d.aggregate_type=''website_customer_application'')',5,'9fca32650fd9e26c1f387b050e45b239',1),
('customer_domain_events','domain_events','t.aggregate_type in(''customer_contract'',''website_customer_application'',''invoice_export_run'')',17,'abe2b4c09c9c504346a83a00e51af15d',2),
('customer_canonical_events','canonical_domain_events','t.aggregate_type=''website_customer_application''',5,'88bcc90ee356efa27f47f5d0cfa4ec9b',3),
('customer_energy_events','canonical_energy_flow_events','t.event_scope=''tenant'' and t.event_type in(''energy_area.resolved'',''quote.created'',''quote.validated'')',86,'4b9956744080025910a497f7c3bac045',4),
('dashboard_alerts','dashboard_alerts','true',350,'e0259fb55af15732bf664bf2c25a0b3c',5),
('data_quality_issues','data_quality_issues','true',18,'79a7fec90f876cfd7c7def5d9756842f',6),
('manual_inbound_messages','manual_inbound_messages','t.request_id is null and t.resolution_status=''unmatched'' and exists(select 1 from public.inbound_operation_events e where e.source_id=t.id::text and e.source_transport=''email'' and e.business_process=''power_of_attorney'' and e.intent=''power_of_attorney_question'' and e.customer_id is null and e.customer_site_id is null and e.metering_point_id is null and e.business_object_id is null)',1,'38ce4b37ae7cea047f146500ef7a6d92',7),
('inbound_operation_events','inbound_operation_events','t.source_transport=''email'' and t.business_process=''power_of_attorney'' and t.intent=''power_of_attorney_question'' and t.customer_id is null and t.customer_site_id is null and t.metering_point_id is null and t.business_object_id is null and exists(select 1 from public.manual_inbound_messages m where m.id::text=t.source_id and m.request_id is null and m.resolution_status=''unmatched'') and not exists(select 1 from public.ediel_messages m where m.id::text=t.source_id)',1,'d9737a11a782b02e4b955d3e2aa8a427',8),
('customer_onboarding_operations','customer_onboarding_operations','true',9,'4da4ad530f72cfc39a0495f5d0246f36',9),
('website_contract_quotes','website_contract_quotes','true',24,'00f41acc1a04c4ab872f27ede9e9f576',10),
('customer_site_resolution','customer_site_resolution','true',39,'b5f340212b9decb1e2fdab57628acce4',11),
('website_customer_applications','website_customer_applications','true',1,'7a4e0bbf7231598bda6daa45d64e70ba',12),
('customer_portfolio_forecast_snapshots','customer_portfolio_forecast_snapshots','true',72,'20c6751a708f923dc17f7097eb11f608',13),
('bidding_zone_monthly_metrics','bidding_zone_monthly_metrics','true',48,'12870fa545eea5e7aa28303a5afecd6b',14),
('company_monthly_metrics','company_monthly_metrics','true',12,'6055fa3dee187a1f1c2ac67cfceb0659',15),
('forecast_runs','forecast_runs','true',38,'cd4f43b887ac211e4d6f0461070adaa4',16);
create temporary table reset_empty(table_name text primary key) on commit drop;
insert into reset_empty values ('ai_list_discrepancies'),('ai_list_import_rows'),('ai_list_imports'),('authorization_scopes'),('billing_adjustment_cases'),('billing_export_run_items'),('billing_underlay_events'),('billing_underlay_items'),('billing_underlays'),('communication_logs'),('contract_charge_ledger'),('contract_price_snapshots'),('customer_addresses'),('customer_application_intakes'),('customer_application_provisioning_steps'),('customer_application_workflow_events'),('customer_application_workflows'),('customer_authorization_documents'),('customer_billing_profile_revisions'),('customer_blockers'),('customer_case_attachments'),('customer_case_events'),('customer_cases'),('customer_communication_events'),('customer_communications'),('customer_contacts'),('customer_contract_acceptances'),('customer_contract_confirmation_deliveries'),('customer_contract_documents'),('customer_contract_events'),('customer_contract_evidence'),('customer_contract_signature_requests'),('customer_contracts'),('customer_correction_requests'),('customer_data_tasks'),('customer_documents'),('customer_duplicate_resolution_events'),('customer_events'),('customer_identity_change_events'),('customer_identity_change_requests'),('customer_info_request_events'),('customer_info_requests'),('customer_internal_notes'),('customer_invoice_documents'),('customer_invoice_lines'),('customer_invoices'),('customer_legal_acceptances'),('customer_lifecycle_decisions'),('customer_lifecycle_events'),('customer_match_review_cases'),('customer_monthly_metrics'),('customer_notifications'),('customer_onboarding_applications'),('customer_onboarding_legal_snapshots'),('customer_operation_events'),('customer_operation_jobs'),('customer_operation_request_snapshots'),('customer_operation_tasks'),('customer_portal_accounts'),('customer_portal_api_access_logs'),('customer_portal_claims'),('customer_portal_completions'),('customer_portal_events'),('customer_portal_identities'),('customer_portal_requests'),('customer_portal_write_idempotency'),('customer_readiness_snapshots'),('customer_site_address_conflicts'),('customer_site_address_history'),('customer_sites'),('customer_supply_periods'),('customers'),('document_ai_extractions'),('ediel_ack_chains'),('ediel_ack_lifecycle'),('ediel_business_correlations'),('ediel_business_errors'),('ediel_business_expectations'),('ediel_business_references'),('ediel_decision_traces'),('ediel_engine_runs'),('ediel_inbound_cases'),('ediel_masterdata_reconciliation_items'),('ediel_match_candidates'),('ediel_message_intents'),('ediel_message_validation_issues'),('ediel_outbound_queue'),('ediel_outbox'),('ediel_permission_cases'),('ediel_permission_events'),('ediel_portal_validation_feedback'),('ediel_process_links'),('ediel_rule_pack_backfill_issues'),('ediel_rule_pack_snapshots'),('ediel_sla_timers'),('ediel_unresolved_items'),('energy_service_permissions'),('external_contract_intakes'),('facility_data_quality_issues'),('forecast_adjustments'),('forecast_run_items'),('grid_owner_data_requests'),('grid_owner_information_requests'),('grid_owner_monthly_metrics'),('invoice_documents'),('invoice_export_attempts'),('invoice_export_items'),('invoice_provider_events'),('invoice_purchase_events'),('meter_reading_series'),('meter_reading_values'),('metering_period_gaps'),('metering_permission_sites'),('metering_permissions'),('metering_point_monthly_consumption'),('metering_points'),('metering_requirements'),('metering_value_batches'),('metering_value_errors'),('metering_value_sources'),('metering_values'),('normalized_metering_values'),('outbound_dispatch_events'),('outbound_requests'),('partner_exports'),('platform_customer_relationship_observations'),('platform_data_quality_issues'),('portfolio_settlement_invoice_bindings'),('power_of_attorney_scopes'),('powers_of_attorney'),('pricing_interval_evidence'),('pricing_preview_lines'),('pricing_run_items'),('pricing_runs'),('route_decision_logs'),('supplier_switch_events'),('supplier_switch_requests'),('tenant_portal_customer_links'),('webhook_deliveries'),('website_application_review_items');
create temporary table reset_preserve(table_name text primary key) on commit drop;
insert into reset_preserve values ('actor_test_attempt_evidence'),('actor_test_attempts'),('actor_test_manual_attestations'),('audit_logs'),('companies'),('company_memberships'),('company_roles'),('ediel_ack_transaction_results'),('ediel_message_events'),('ediel_messages'),('ediel_processing_runs'),('ediel_routing_decisions'),('ediel_test_artifacts'),('ediel_test_run_messages'),('ediel_test_run_steps'),('ediel_test_runs'),('integration_api_client_profiles'),('integration_api_clients'),('permissions'),('platform_usage_event_failures'),('platform_usage_events'),('roles'),('tenant_email_outbox'),('user_roles');
create temporary table reset_ids(scope_name text,id uuid,primary key(scope_name,id)) on commit drop;
create temporary table reset_preserved_rows(table_name text,predicate text,expected_count bigint,expected_hash text) on commit drop;

do $reset$
declare r record;n bigint;h text;removed bigint;sql_text text;
begin
 if exists(select 1 from public.customers) then raise exception 'reset_refused_new_customer_rows';end if;
 if exists(select 1 from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace and not c.convalidated) then raise exception 'reset_refused_unvalidated_fk';end if;

 -- Every reviewed empty graph table remains empty; new external producer rows
 -- abort the complete transaction instead of being discovered and deleted.
 for r in select table_name from reset_empty order by table_name loop
  if to_regclass('public.'||r.table_name) is null then raise exception 'reset_missing_reviewed_table:%',r.table_name;end if;
  execute format('select count(*) from public.%I',r.table_name) into n;
  if n<>0 then raise exception 'reset_refused_new_rows:%:%',r.table_name,n;end if;
 end loop;

 -- Lock only selected old rows of shared event tables, capture exact IDs, and
 -- verify the original approved rowset, never the changing whole event table.
 for r in select * from reset_scopes order by table_name,scope_name loop
  execute format('insert into pg_temp.reset_ids select %L,t.id from public.%I t where %s for update of t',r.scope_name,r.table_name,r.predicate);
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where %s',r.table_name,r.predicate) into n,h;
  if n<>r.expected_count or h<>r.expected_hash then raise exception 'reset_stale_baseline:%',r.scope_name;end if;

  -- Nonmatching technical/publication/actor-proof events must remain byte-for-byte
  -- unchanged by THIS reset. Repeatable read excludes unrelated concurrent work.
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where not coalesce((%s),false)',r.table_name,r.predicate) into n,h;
  insert into reset_preserved_rows values(r.table_name,'not coalesce(('||r.predicate||'),false)',n,h);
 end loop;
 for r in select table_name from reset_preserve order by table_name loop
  if to_regclass('public.'||r.table_name) is not null then
   execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.table_name) into n,h;
   insert into reset_preserved_rows values(r.table_name,'true',n,h);
  end if;
 end loop;

 -- Child-first, pinned-ID deletes. Existing FK and lifecycle triggers stay active.
 for r in select * from reset_scopes order by delete_order loop
  execute format('delete from public.%I t using pg_temp.reset_ids i where i.scope_name=%L and t.id=i.id',r.table_name,r.scope_name);
  get diagnostics removed=row_count;
  if removed<>r.expected_count then raise exception 'reset_row_count_mismatch:%',r.scope_name;end if;
 end loop;

 -- Neither a scoped row nor an exact captured ID may remain.
 for r in select * from reset_scopes order by delete_order loop
  execute format('select count(*) from public.%I t where %s',r.table_name,r.predicate) into n;
  if n<>0 then raise exception 'reset_scoped_residual:%:%',r.scope_name,n;end if;
  execute format('select count(*) from public.%I t join pg_temp.reset_ids i on i.id=t.id where i.scope_name=%L',r.table_name,r.scope_name) into n;
  if n<>0 then raise exception 'reset_captured_id_residual:%',r.scope_name;end if;
 end loop;
 for r in select table_name from reset_empty order by table_name loop
  execute format('select count(*) from public.%I',r.table_name) into n;
  if n<>0 then raise exception 'reset_graph_residual:%:%',r.table_name,n;end if;
 end loop;
 for r in select * from reset_preserved_rows loop
  execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t where %s',r.table_name,r.predicate) into n,h;
  if n<>r.expected_count or h<>r.expected_hash then raise exception 'reset_changed_preserved_rows:%',r.table_name;end if;
 end loop;
 if exists(select 1 from public.customers) then raise exception 'reset_customer_residual';end if;
end
$reset$;

select 'customer_flow_reset_verified' as result,
 (select count(*) from reset_scopes) as reviewed_rowsets,
 (select count(*) from reset_empty) as empty_graph_tables,
 (select count(*) from reset_preserved_rows) as preserved_rowsets;
commit;
select 'customer_flow_reset_committed' as result,
 (select count(*) from public.customers) as customers,
 (select count(*) from public.website_customer_applications) as applications,
 (select count(*) from public.data_quality_issues) as issues,
 (select count(*) from public.dashboard_alerts) as alerts;
