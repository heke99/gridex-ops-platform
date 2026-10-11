-- OPS API review F5 (2026-10-07): make service-only ACLs explicit.
--
-- The canonical snapshot still grants authenticated EXECUTE on two legacy
-- SECURITY DEFINER helpers; convergence migration 20260904120000 revoked
-- PUBLIC and anon but not that explicit grant. Live already denies both roles.
-- This forward migration makes clean restores and upgrades converge to the
-- live, intended state without changing function bodies.

revoke all on function public.gridex_db4b_archive_customer_registry_row(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.gridex_db4b_archive_customer_registry_row(text, text, boolean, text) to service_role;

revoke all on function public.gridex_next_customer_number(uuid) from public, anon, authenticated;
grant execute on function public.gridex_next_customer_number(uuid) to service_role;
