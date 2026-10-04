-- CLI-created prerequisite, ordered before immutable 20261001000500.
-- Supabase's migration postgres role need not be a superuser. Object ownership
-- requires its explicit membership in this private, non-login owner role.
-- No authenticated application principal receives this membership.
BEGIN;
DO $retention_migration_owner$
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole)) THEN
  RAISE EXCEPTION 'ediel_retention_migration_role_required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner') THEN
  CREATE ROLE gridex_ediel_retention_owner NOLOGIN NOINHERIT BYPASSRLS;
 END IF;
 IF EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner'
           AND (rolcanlogin OR rolinherit OR NOT rolbypassrls OR rolsuper OR rolcreaterole))
 OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator')
           AND pg_has_role(oid,'gridex_ediel_retention_owner','MEMBER')) THEN
  RAISE EXCEPTION 'ediel_retention_private_owner_role_required' USING ERRCODE='42501';
 END IF;
 -- PostgreSQL 17 grants ADMIN but not SET to a non-superuser role creator.
 -- Preserve that existing administration; enable only explicit SET ownership.
 GRANT gridex_ediel_retention_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
END
$retention_migration_owner$;
COMMIT;
