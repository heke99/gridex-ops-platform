-- CLI-created dependency between immutable 00459 and 00500.
-- 00500 executes private schema DDL as the current migration principal, without
-- SET ROLE. It therefore needs inherited privileges from this one private owner.
BEGIN;
DO $retention_migration_schema$
BEGIN
 IF current_user IN ('anon','authenticated','service_role','authenticator')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolcreaterole)) THEN
  RAISE EXCEPTION 'ediel_retention_migration_role_required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='gridex_ediel_retention_owner'
               AND NOT rolcanlogin AND NOT rolinherit AND rolbypassrls AND NOT rolsuper AND NOT rolcreaterole)
 OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','authenticator')
           AND pg_has_role(oid,'gridex_ediel_retention_owner','MEMBER')) THEN
  RAISE EXCEPTION 'ediel_retention_private_owner_role_required' USING ERRCODE='42501';
 END IF;
 -- No ADMIN option, application member, operational grant or default grant.
 -- This owner has no source decision or external issuer evidence seeded.
 GRANT gridex_ediel_retention_owner TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;
END
$retention_migration_schema$;
COMMIT;
