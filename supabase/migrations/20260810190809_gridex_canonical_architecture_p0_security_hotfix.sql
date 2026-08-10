-- Trigger-only bridge functions must never be callable through the Data API.

begin;

revoke all on function public.gridex_bridge_deprecated_canonical_event_bus()
  from public, anon, authenticated, service_role;

-- The trigger executes as its owning role and does not require an RPC grant.
-- Keep service_role explicit only for controlled diagnostics.
grant execute on function public.gridex_bridge_deprecated_canonical_event_bus()
  to service_role;

commit;

