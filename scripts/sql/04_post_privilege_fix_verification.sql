-- Read-only verification for 20260802180000.

begin read only;

select exists (
  select 1
  from supabase_migrations.schema_migrations
  where version = '20260802180000'
) as privilege_fix_migration_applied;

with expected(table_name, privilege_type) as (
  values
    ('canonical_audit_events', 'SELECT'),
    ('canonical_domain_events', 'SELECT'),
    ('canonical_provisioning_requests', 'SELECT'),
    ('ediel_active_test_configurations', 'SELECT'),
    ('ediel_configuration_snapshots', 'SELECT'),
    ('ediel_production_state', 'SELECT')
),
actual as (
  select table_name::text, privilege_type::text
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in (
      'canonical_command_results',
      'canonical_audit_events',
      'canonical_domain_events',
      'canonical_event_outbox',
      'ediel_production_state',
      'ediel_configuration_snapshots',
      'ediel_active_test_configurations',
      'canonical_provisioning_requests'
    )
    and grantee in ('anon', 'authenticated')
),
unexpected as (
  select * from actual
  except
  select * from expected
),
missing as (
  select * from expected
  except
  select * from actual
)
select
  (select count(*) from unexpected) as unexpected_grant_count,
  (select count(*) from missing) as missing_grant_count,
  not exists (select 1 from unexpected)
    and not exists (select 1 from missing) as grants_exactly_match;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'canonical_command_results',
    'canonical_audit_events',
    'canonical_domain_events',
    'canonical_event_outbox',
    'ediel_production_state',
    'ediel_configuration_snapshots',
    'ediel_active_test_configurations',
    'canonical_provisioning_requests'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

commit;
