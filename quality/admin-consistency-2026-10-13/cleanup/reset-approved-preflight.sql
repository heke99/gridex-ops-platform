-- Read-only scoped row fingerprints after explicit customer-domain provenance verification.
select 'dashboard_alerts' as scope_name,'dashboard_alerts' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.dashboard_alerts t where true
union all
select 'data_quality_issues' as scope_name,'data_quality_issues' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.data_quality_issues t where true
union all
select 'customer_onboarding_operations' as scope_name,'customer_onboarding_operations' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.customer_onboarding_operations t where true
union all
select 'forecast_runs' as scope_name,'forecast_runs' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.forecast_runs t where true
union all
select 'customer_portfolio_forecast_snapshots' as scope_name,'customer_portfolio_forecast_snapshots' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.customer_portfolio_forecast_snapshots t where true
union all
select 'company_monthly_metrics' as scope_name,'company_monthly_metrics' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.company_monthly_metrics t where true
union all
select 'bidding_zone_monthly_metrics' as scope_name,'bidding_zone_monthly_metrics' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.bidding_zone_monthly_metrics t where true
union all
select 'website_contract_quotes' as scope_name,'website_contract_quotes' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.website_contract_quotes t where true
union all
select 'customer_site_resolution' as scope_name,'customer_site_resolution' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.customer_site_resolution t where true
union all
select 'website_customer_applications' as scope_name,'website_customer_applications' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.website_customer_applications t where true
union all
select 'manual_inbound_messages' as scope_name,'manual_inbound_messages' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.manual_inbound_messages t where t.request_id is null and t.resolution_status='unmatched' and exists(select 1 from public.inbound_operation_events e where e.source_id=t.id::text and e.source_transport='email' and e.business_process='power_of_attorney' and e.intent='power_of_attorney_question' and e.customer_id is null and e.customer_site_id is null and e.metering_point_id is null and e.business_object_id is null)
union all
select 'inbound_operation_events' as scope_name,'inbound_operation_events' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.inbound_operation_events t where t.source_transport='email' and t.business_process='power_of_attorney' and t.intent='power_of_attorney_question' and t.customer_id is null and t.customer_site_id is null and t.metering_point_id is null and t.business_object_id is null and exists(select 1 from public.manual_inbound_messages m where m.id::text=t.source_id and m.request_id is null and m.resolution_status='unmatched') and not exists(select 1 from public.ediel_messages m where m.id::text=t.source_id)
union all
select 'customer_domain_outbox' as scope_name,'event_outbox' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.event_outbox t where exists(select 1 from public.domain_events d where d.id=t.domain_event_id and d.aggregate_type in('customer_contract','website_customer_application','invoice_export_run'))
union all
select 'customer_canonical_outbox' as scope_name,'canonical_event_outbox' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.canonical_event_outbox t where exists(select 1 from public.canonical_domain_events d where d.id=t.domain_event_id and d.aggregate_type='website_customer_application')
union all
select 'customer_domain_events' as scope_name,'domain_events' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.domain_events t where t.aggregate_type in('customer_contract','website_customer_application','invoice_export_run')
union all
select 'customer_canonical_events' as scope_name,'canonical_domain_events' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.canonical_domain_events t where t.aggregate_type='website_customer_application'
union all
select 'customer_energy_events' as scope_name,'canonical_energy_flow_events' as table_name,count(*) as exact_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.canonical_energy_flow_events t where t.event_scope='tenant' and t.event_type in('energy_area.resolved','quote.created','quote.validated');
