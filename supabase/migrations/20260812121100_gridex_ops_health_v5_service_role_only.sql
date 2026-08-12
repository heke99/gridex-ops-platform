-- Restrict Health v5 to the server-side service role.
-- The application health access layer uses supabaseService; authenticated clients do not need direct EXECUTE.

revoke execute on function public.gridex_ops_health_checks_v5() from public;
revoke execute on function public.gridex_ops_health_checks_v5() from anon;
revoke execute on function public.gridex_ops_health_checks_v5() from authenticated;
grant execute on function public.gridex_ops_health_checks_v5() to service_role;
