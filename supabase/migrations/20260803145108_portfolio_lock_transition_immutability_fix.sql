-- Preserve final settlement immutability when moving final -> locked.
-- The lock transition may only change status and lock metadata.
begin;

do $$
declare
  v_oid oid;
  v_definition text;
  v_patched text;
begin
  select p.oid
    into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'gridex_transition_portfolio_settlement'
    and pg_get_function_identity_arguments(p.oid) =
      'p_actor_user_id uuid, p_settlement_id uuid, p_action text, p_reason text';

  if v_oid is null then
    raise exception 'gridex_transition_portfolio_settlement_not_found';
  end if;

  v_definition := pg_get_functiondef(v_oid);
  v_patched := regexp_replace(
    v_definition,
    'locked_at = v_now,\s*updated_at = v_now',
    'locked_at = v_now',
    'n'
  );

  if v_patched = v_definition then
    if v_definition !~
      'set[[:space:]]+status[[:space:]]*=[[:space:]]*''locked''[[:space:]]*,[[:space:]]*locked_by[[:space:]]*=[[:space:]]*p_actor_user_id[[:space:]]*,[[:space:]]*locked_at[[:space:]]*=[[:space:]]*v_now[[:space:]]+where[[:space:]]+id[[:space:]]*=[[:space:]]*v_row[.]id' then
      raise exception 'portfolio_lock_transition_patch_not_applied';
    end if;
  else
    execute v_patched;
  end if;
end $$;

commit;
