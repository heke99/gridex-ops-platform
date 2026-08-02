\set ON_ERROR_STOP on
\pset pager off

select * from public.canonical_run_hardening_preflight();

select reason_code, source_table, count(*) as row_count
from public.ediel_tenant_relation_quarantine
where resolved_at is null
group by reason_code, source_table
order by source_table, reason_code;

select conrelid::regclass as table_name, conname, convalidated
from pg_constraint
where conname in (
  'companies_canonical_status_check',
  'ediel_test_run_messages_company_run_fk_v2',
  'ediel_test_run_messages_company_message_fk_v2',
  'ediel_test_runs_company_id_required_v2',
  'ediel_test_run_messages_company_id_required_v2',
  'ediel_test_run_steps_company_id_required_v2',
  'ediel_test_artifacts_company_id_required_v2',
  'ediel_actor_settings_application_reference_sync_v2',
  'ediel_production_state_configuration_snapshot_fk'
)
order by table_name::text, conname;

select company_id, state, configuration_snapshot_id, state_version, blocked_reason
from public.ediel_production_state
order by company_id;
