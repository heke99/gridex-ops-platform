-- Forward hardening for the already-applied Operations Foundation V1 migration.
-- The helper is pure SQL, but pinning search_path keeps the public-schema RPC
-- contract explicit and clears Supabase's mutable-search-path security warning.

alter function public.gridex_customer_operation_outcome_class(text, integer, integer)
  set search_path = pg_catalog;
