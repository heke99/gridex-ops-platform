-- Correct Health v5 PRODAT evidence so certificate blockers are counted from
-- the role-aware blocking reasons, not inferred from a generic certificate
-- status that also happens to be empty for missing-route/manual-review actors.
--
-- Keep this forward-only and fail closed if the previous function definition
-- is not the expected version.

do $$
declare
  v_definition text;
  v_old text := $$count(*) filter (where coalesce(certificate_status,'') not in ('valid','active','renewal_available'))$$;
  v_new text := $$count(*) filter (where 'missing_or_invalid_certificate'=any(coalesce(role_aware_blocking_reasons,'{}'::text[])))$$;
begin
  select pg_get_functiondef('public.gridex_ops_health_checks_v5()'::regprocedure)
    into v_definition;

  if position(v_new in v_definition) > 0 then
    -- Already on the corrected definition. Keep replay/idempotency safe.
    null;
  elsif position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  else
    raise exception 'gridex_ops_health_checks_v5 definition is not the expected pre-remediation version';
  end if;
end
$$;

-- CREATE OR REPLACE normally preserves the ACL, but make the intended boundary
-- explicit so future replay cannot accidentally expose this SECURITY DEFINER
-- health function to browser roles.
revoke execute on function public.gridex_ops_health_checks_v5() from public;
revoke execute on function public.gridex_ops_health_checks_v5() from anon;
revoke execute on function public.gridex_ops_health_checks_v5() from authenticated;
grant execute on function public.gridex_ops_health_checks_v5() to service_role;
