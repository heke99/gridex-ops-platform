-- Propagate global Ediel policy changes into tenant configuration snapshots.
--
-- Any change to the global rule-version registry can affect the canonical
-- policy used by every configured Ediel tenant. Existing tenant readiness and
-- production dry-run evidence must therefore be bound to a new configuration
-- snapshot before production sending may resume.

begin;

create or replace function private.ediel_global_policy_change_snapshot_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_company_id uuid;
begin
  if current_setting('gridex.skip_ediel_snapshot_trigger', true) = 'on' then
    return null;
  end if;

  for v_company_id in
    select distinct s.company_id
    from public.ediel_configuration_snapshots s
    union
    select distinct p.company_id
    from public.ediel_production_state p
    where p.company_id is not null
  loop
    perform public.canonical_capture_ediel_configuration_snapshot_v1_unchecked(
      v_company_id,
      auth.uid(),
      'ediel_global_policy_changed'
    );
  end loop;

  return null;
end;
$$;

revoke all on function private.ediel_global_policy_change_snapshot_trigger()
  from public, anon, authenticated;

drop trigger if exists canonical_snapshot_ediel_rule_versions
  on public.ediel_rule_versions;

create trigger canonical_snapshot_ediel_rule_versions
after insert or update or delete on public.ediel_rule_versions
for each statement
execute function private.ediel_global_policy_change_snapshot_trigger();

commit;
