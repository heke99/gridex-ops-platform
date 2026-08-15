-- Keep one-off production restoration and cross-tenant integrity diagnostics
-- outside the authenticated PostgREST RPC surface. Application runtimes use
-- service_role and no tenant user needs direct EXECUTE on either function.

revoke all on function public.canonical_restore_pre_engine_live_ediel_approval(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.canonical_restore_pre_engine_live_ediel_approval(uuid, uuid, text)
  to service_role;

revoke all on function public.gridex_published_website_offer_integrity(uuid)
  from public, anon, authenticated;
grant execute on function public.gridex_published_website_offer_integrity(uuid)
  to service_role;
