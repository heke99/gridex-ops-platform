-- Restore trigger-internal execution after RPC-surface hardening without
-- reopening private helpers to API/client roles.
--
-- These functions are trigger-only and owned by postgres. They must execute
-- with their owner's privileges because they call a private helper whose
-- EXECUTE permission is intentionally revoked from request roles.

alter function private.normalize_website_application_legal_blockers()
  security definer;

alter function private.reconcile_website_application_terms_acceptance()
  security definer;

-- Keep SECURITY DEFINER lookup deterministic and protected from search-path
-- shadowing. Function bodies use schema-qualified object references.
alter function private.normalize_website_application_legal_blockers()
  set search_path = '';

alter function private.reconcile_website_application_terms_acceptance()
  set search_path = '';

-- The trigger functions and nested helper are internal implementation details;
-- do not expose them as callable RPCs to client roles.
revoke all on function private.normalize_website_application_legal_blockers()
  from public, anon, authenticated;

revoke all on function private.reconcile_website_application_terms_acceptance()
  from public, anon, authenticated;

revoke all on function private.remove_terms_accepted_from_application_response(jsonb)
  from public, anon, authenticated;
