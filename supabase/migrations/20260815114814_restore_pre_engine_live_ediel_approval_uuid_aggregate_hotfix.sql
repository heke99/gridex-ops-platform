-- PostgreSQL does not define min(uuid). Patch the just-added compatibility restore to use
-- deterministic UUID array aggregation instead. The migration is idempotent so clean replay
-- also succeeds if the base function was already created with the corrected expression.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'canonical_restore_pre_engine_live_ediel_approval'
    and pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid, p_actor_user_id uuid, p_reason text';

  if v_definition is null then
    raise exception 'canonical_restore_pre_engine_live_ediel_approval_missing';
  end if;

  if position('min(a.id)' in v_definition) > 0 then
    execute replace(v_definition, 'min(a.id)', '(array_agg(a.id order by a.id))[1]');
  elsif position('(array_agg(a.id order by a.id))[1]' in v_definition) = 0 then
    raise exception 'canonical_restore_pre_engine_live_ediel_approval_unexpected_definition';
  end if;
end;
$$;
