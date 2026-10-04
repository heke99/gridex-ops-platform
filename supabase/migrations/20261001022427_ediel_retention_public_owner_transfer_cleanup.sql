-- CLI-created 20261001024042, ordered after current owner transfers through
-- 22426. A later retention DDL migration must explicitly grant/revoke CREATE
-- in its own transaction if it transfers another public function to this role.
BEGIN;
DO $retention_public_owner_cleanup$
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole))
 OR has_schema_privilege(current_user,'public','CREATE WITH GRANT OPTION') IS NOT TRUE THEN
  RAISE EXCEPTION 'ediel_retention_migration_schema_grantor_required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner'
               AND NOT rolcanlogin AND NOT rolinherit AND rolbypassrls AND NOT rolsuper AND NOT rolcreaterole)
 OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator')
           AND pg_has_role(oid,'gridex_ediel_retention_owner','MEMBER')) THEN
  RAISE EXCEPTION 'ediel_retention_private_owner_role_required' USING ERRCODE='42501';
 END IF;
 REVOKE CREATE ON SCHEMA public FROM gridex_ediel_retention_owner;
 IF has_schema_privilege('gridex_ediel_retention_owner','public','CREATE') IS TRUE THEN
  RAISE EXCEPTION 'ediel_retention_public_create_still_inherited' USING ERRCODE='42501';
 END IF;
END
$retention_public_owner_cleanup$;
COMMIT;
