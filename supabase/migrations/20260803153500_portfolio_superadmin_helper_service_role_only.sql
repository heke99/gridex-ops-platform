-- The portfolio superadmin helper is an internal authorization primitive.
-- Keep it out of the exposed authenticated RPC surface and call it only through
-- trusted server-side service-role actions.

begin;

revoke execute on function public.gridex_portfolio_actor_is_superadmin(uuid)
  from public, anon, authenticated;
grant execute on function public.gridex_portfolio_actor_is_superadmin(uuid)
  to service_role;

commit;
