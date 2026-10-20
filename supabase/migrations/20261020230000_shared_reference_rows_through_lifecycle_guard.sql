-- FINDINGS F53: 20260814162500 added a restrictive lifecycle guard to every
-- company-scoped table: platform admin OR company_id IN (the user's companies).
-- On the four tables where company_id IS NULL means a row shared by the whole
-- platform (registry grid owners, their contact channels and routes, standard
-- consumption profiles) the existing permissive policy grants those rows, but
-- NULL IN (...) is never true, so no tenant user could ever see a shared grid
-- owner: manual customer intake listed no grid owner to choose. A shared row
-- has no tenant lifecycle; it passes the guard while the session is allowed.
-- Tenant-owned rows keep the exact membership/lifecycle rule. Only the guard's
-- USING expression changes, and only after it is confirmed to be unchanged.
BEGIN;
DO $guard$DECLARE t text;actual text;
 expected CONSTANT text:='(( SELECT gridex_is_current_session_allowed() AS gridex_is_current_session_allowed) AND (( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin) OR (company_id IN ( SELECT gridex_user_company_ids() AS gridex_user_company_ids))))';
BEGIN
 FOREACH t IN ARRAY ARRAY['public.grid_owners','public.grid_owner_contact_channels','public.grid_owner_contact_routes','public.consumption_profiles'] LOOP
  SELECT pg_get_expr(polqual,polrelid) INTO actual FROM pg_policy WHERE polrelid=t::regclass AND polname='tenant_lifecycle_select_guard' AND NOT polpermissive AND polcmd='r';
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'shared_reference_guard_predecessor_required:%',t;END IF;
  EXECUTE format('ALTER POLICY tenant_lifecycle_select_guard ON %s USING ((SELECT public.gridex_is_current_session_allowed()) AND ((SELECT public.gridex_user_is_platform_admin()) OR company_id IS NULL OR company_id IN (SELECT public.gridex_user_company_ids())))',t);
 END LOOP;
END$guard$;
COMMIT;
