-- OPS API review F33 (2026-10-07): evaluate auth helpers once per statement.
--
-- Same predicates as before; auth.role() and the platform-admin check are
-- wrapped in scalar subqueries so PostgreSQL evaluates them as initplans
-- instead of once per row. gridex_can_read_company(company_id) depends on the
-- row and stays per row.

alter policy inbound_operation_events_read on public.inbound_operation_events
  using (
    ((select auth.role()) = 'service_role'::text)
    or (select public.gridex_user_is_platform_admin())
    or ((company_id is not null) and public.gridex_can_read_company(company_id))
  );

alter policy inbound_operation_events_write on public.inbound_operation_events
  using (((select auth.role()) = 'service_role'::text) or (select public.gridex_user_is_platform_admin()))
  with check (((select auth.role()) = 'service_role'::text) or (select public.gridex_user_is_platform_admin()));
