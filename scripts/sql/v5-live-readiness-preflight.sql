-- V5 production preflight. Read-only by construction; this script performs no
-- repair, retry, queueing, status change or deletion.
begin transaction read only;

select now() as inspected_at,
       current_database() as database_name,
       current_user as database_user;

-- Exact signature chain and distinct lifecycle readiness.
select lifecycle_stage,
       count(*) as contracts,
       count(*) filter (where agreement_signed) as signed_exact,
       count(*) filter (where switch_ready) as switch_ready,
       count(*) filter (where billing_ready) as billing_ready
from public.customer_contract_lifecycle_readiness_v
group by lifecycle_stage
order by lifecycle_stage;

select blocker, count(*) as affected_contracts
from public.customer_contract_lifecycle_readiness_v r
cross join lateral unnest(r.blockers) blocker
group by blocker
order by affected_contracts desc, blocker;

select c.company_id,c.id as contract_id,c.customer_id,c.status,c.created_at,
       c.metadata->>'website_application_id' as website_application_id
from public.customer_contracts c
where c.status in ('pending_signature','signature_failed')
order by c.created_at
limit 500;

-- Supplier-switch rows that are queued/sending without fresh exact evidence
-- should be zero after the DB trigger is installed.
select s.company_id,s.id as supplier_switch_request_id,s.status,
       coalesce(s.customer_contract_id,s.contract_id) as contract_id,
       s.readiness_checked_at,s.created_at
from public.supplier_switch_requests s
where s.status in ('ready','queued','submitted','sent','processing')
  and (
    coalesce(s.customer_contract_id,s.contract_id) is null
    or s.readiness_checked_at is null
    or coalesce(s.readiness_snapshot->>'ready','false')<>'true'
  )
order by s.created_at
limit 500;

-- Canonical settlement uniqueness/revision_no/status checks.
select company_id,portfolio_id,price_area_code,delivery_month,
       price_plan_version_id,count(*) as current_rows
from public.portfolio_monthly_settlements
where is_current
group by company_id,portfolio_id,price_area_code,delivery_month,price_plan_version_id
having count(*)<>1;

select status,count(*) as settlements,
       count(*) filter (where is_current) as current_settlements
from public.portfolio_monthly_settlements
group by status
order by status;

select company_id,id as settlement_id,status,revision_no
from public.portfolio_monthly_settlements
where status in ('final','locked')
  and (
    portfolio_price_ore_per_kwh is null
    or calculation_snapshot_sha256 is null
    or calculated_at is null or reviewed_at is null or approved_at is null
  )
order by company_id,delivery_month,revision_no;

-- No issued invoice may lack the exact locked settlement snapshot.
select company_id,id as customer_invoice_id,status,portfolio_id,
       portfolio_monthly_settlement_id,portfolio_settlement_revision
from public.customer_invoices
where status in ('issued','sent','exported','paid')
  and portfolio_id is not null
  and (
    portfolio_monthly_settlement_id is null
    or portfolio_settlement_status<>'locked'
    or nullif(portfolio_settlement_sha256,'') is null
    or coalesce(portfolio_settlement_snapshot,'{}'::jsonb)='{}'::jsonb
  )
order by company_id,id;

-- Durable queues: inspect before any controlled retry or cleanup.
select status,count(*) as events,
       min(created_at) as oldest_created_at,
       max(created_at) as newest_created_at
from public.event_outbox
group by status
order by status;

select status,count(*) as applications,
       min(created_at) as oldest_created_at,
       max(created_at) as newest_created_at
from public.website_customer_applications
group by status
order by status;

-- Only real open transactions: idle sessions without xact_start are excluded.
select pid,usename,application_name,client_addr,state,xact_start,
       now()-xact_start as transaction_age,left(query,500) as query
from pg_stat_activity
where datname=current_database()
  and pid<>pg_backend_pid()
  and xact_start is not null
order by xact_start;

-- Repository/live migration identity. Compare this output with
-- scripts/migration-history-manifest.json; duplicate versions must be zero.
select version,count(*) as applied_rows
from supabase_migrations.schema_migrations
group by version
having count(*)<>1
order by version;
select count(*) as applied_migration_rows,
       min(version) as first_version,max(version) as last_version
from supabase_migrations.schema_migrations;

-- Scheduler ownership and Vault exposure inventory (metadata/grants only;
-- decrypted secrets are intentionally never selected).
select extname,extversion
from pg_extension
where extname in('pg_cron','pg_net','vault','supabase_vault')
order by extname;
select to_regclass('cron.job') as cron_job_table,
       to_regclass('vault.secrets') as vault_secrets_table,
       to_regclass('vault.decrypted_secrets') as vault_decrypted_secrets_view;
select grantee,table_schema,table_name,privilege_type
from information_schema.role_table_grants
where table_schema='vault'
order by grantee,table_name,privilege_type;
select grantee,routine_schema,routine_name,privilege_type
from information_schema.role_routine_grants
where routine_schema='vault'
order by grantee,routine_name,privilege_type;

-- Do not retry these rows from this report. Inspect tenant, payload,
-- idempotency, attempts, last error and external reference first.
select company_id,id,status,request_type,attempts_count,queued_at,failed_at,
       failure_reason,external_reference,dispatch_batch_key,automation_key,
       payload
from public.outbound_requests
where status='failed'
   or (status='queued' and queued_at<now()-interval '1 hour')
order by coalesce(failed_at,queued_at)
limit 500;

select company_id,id,status,email_type,attempts,max_attempts,next_attempt_at,
       failed_at,failure_reason,provider_message_id,provider_idempotency_key,
       created_at
from public.tenant_email_outbox
where status='failed'
   or (status='queued' and created_at<now()-interval '1 hour')
order by created_at
limit 500;

select company_id,id,status,event_type,attempts,max_attempts,next_attempt_at,
       last_attempt_at,failed_at,response_status,failure_reason,
       idempotency_key,created_at
from public.webhook_deliveries
where status in('failed','dead_letter','skipped')
   or (status='queued' and created_at<now()-interval '1 hour')
order by created_at
limit 500;

-- API-client least privilege and origin/expiry diagnostics. Public website
-- clients must never have settlement administration permissions or wildcards.
select company_id,id,name,status,scopes,allowed_origins,expires_at,last_used_at,
       scopes && array[
         'portfolio_settlement.create','portfolio_settlement.import',
         'portfolio_settlement.calculate','portfolio_settlement.review',
         'portfolio_settlement.approve','portfolio_settlement.lock',
         'portfolio_settlement.correct','portfolio_settlement.manage_access','*'
       ]::text[] as has_forbidden_portfolio_scope,
       coalesce(array_length(allowed_origins,1),0)=0 as origins_missing,
       expires_at is not null and expires_at<=now() as expired_now
from public.integration_api_clients
order by company_id,name;

-- Existing data distribution. These counts need an operational explanation;
-- the preflight never fabricates links, signatures or snapshots.
select
  (select count(*) from public.customer_legal_acceptances) as legal_acceptances,
  (select count(*) from public.powers_of_attorney) as powers_of_attorney,
  (select count(*) from public.contract_price_snapshots) as contract_price_snapshots,
  (select count(*) from public.customer_contracts where status in('signed','active')) as signed_or_active_contracts;
select company_id,status,count(*) as contracts,
       count(*) filter(where coalesce(metadata->>'test_data','false')='true') as marked_test_data
from public.customer_contracts
group by company_id,status
order by company_id,status;
select company_id,status,count(*) as supplier_switches,
       count(*) filter(where coalesce(metadata->>'test_data','false')='true') as marked_test_data
from public.supplier_switch_requests
group by company_id,status
order by company_id,status;

rollback;
