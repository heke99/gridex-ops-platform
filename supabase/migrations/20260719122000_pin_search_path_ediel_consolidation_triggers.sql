-- Supabase advisor hardening: 20260712110000_ediel_canonical_consolidation.sql
-- created two trigger functions without pinning search_path. Applied
-- migrations are immutable, so the pin is added forward. Both functions only
-- reference schema-qualified objects, so the pin is behavior-neutral.

alter function public.gridex_require_tenant_owned_ediel_route() set search_path=public,pg_temp;
alter function public.gridex_validate_ediel_outbox_tenant_and_snapshot() set search_path=public,pg_temp;
