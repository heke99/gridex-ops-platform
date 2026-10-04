-- CLI-created 20261001023940, dependency-ordered before immutable 00500.
-- PostgreSQL requires the new owner to have CREATE on the containing schema
-- even when the existing function was created by the current migration role.
-- The matching 22427 cleanup follows every current retention owner transfer.
BEGIN;
DO $retention_public_owner_transfer$
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole))
 OR has_schema_privilege(current_user,'public','CREATE WITH GRANT OPTION') IS NOT TRUE THEN
  RAISE EXCEPTION 'ediel_retention_migration_schema_grantor_required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner'
               AND NOT rolcanlogin AND NOT rolinherit AND rolbypassrls AND NOT rolsuper AND NOT rolcreaterole)
 OR pg_has_role(current_user,'gridex_ediel_retention_owner','SET') IS NOT TRUE
 OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator')
           AND pg_has_role(oid,'gridex_ediel_retention_owner','MEMBER')) THEN
  RAISE EXCEPTION 'ediel_retention_private_owner_role_required' USING ERRCODE='42501';
 END IF;
 -- No grant option, default privilege, application member, auth/storage grant,
 -- retention decision or operational capability is supplied by this statement.
 GRANT CREATE ON SCHEMA public TO gridex_ediel_retention_owner;
END
$retention_public_owner_transfer$;
COMMIT;
