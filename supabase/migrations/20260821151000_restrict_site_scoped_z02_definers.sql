-- Restrict site-scoped Z02 SECURITY DEFINER helpers to the trusted server role.
-- Trigger helpers remain callable by PostgreSQL's trigger mechanism; direct RPC
-- execution by anon/authenticated is intentionally forbidden.

revoke execute on function public.gridex_apply_exact_z02_core(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.gridex_apply_exact_z02_core(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
  to service_role;

revoke execute on function public.gridex_gate_exact_z02_atomic_apply()
  from public, anon, authenticated;
grant execute on function public.gridex_gate_exact_z02_atomic_apply()
  to service_role;

revoke execute on function public.gridex_gate_inbound_z02_operation_job()
  from public, anon, authenticated;
grant execute on function public.gridex_gate_inbound_z02_operation_job()
  to service_role;
