# Retention migration owner prerequisite — 2026-10-01

Authentic clean and ancestor-upgrade replay at root `adc1` failed at the
unchanged `20261001000500` CREATE SCHEMA AUTHORIZATION statement: the PostgreSQL
17 migration role could administer the private owner but could not SET ROLE.

The Supabase CLI created `20261001015614_ediel_retention_migration_owner_prerequisite.sql`.
It is deliberately ordered as `20261001000459_ediel_retention_migration_owner_prerequisite.sql`
before that dependency. The historical 00500 bytes are unchanged. This
prospective candidate has not been applied to production.

The prerequisite admits only an actual role administrator/superuser, rejects
anon/authenticated/service_role/authenticator, verifies the private NOLOGIN,
NOINHERIT, BYPASSRLS owner and rejects any application membership. Its grant is
to CURRENT_USER only, WITH INHERIT FALSE and SET TRUE; it grants no ADMIN option
and does not change any operational permission or retention decision.

`scripts/ediel-retention-owner-role-regression.mjs` ran against PGlite PostgreSQL
17.5 with a bounded NOSUPERUSER CREATEROLE migration principal. The actual
ownership statement was first rejected with SET FALSE, then succeeded after
the prerequisite. Reapplication, application-principal rejection, unchanged
existing administration and absence of application membership passed. The
equivalent table ownership check avoids PGlite's database-ACL catalog limitation;
this is bounded SQL mechanism evidence, not a native Supabase replay receipt.

Native clean/upgrade replay and schema generation at the integrated candidate
are **NOT RUN here** and remain mandatory. Other 20261001 role declarations were
inspected: TR09 creates a publisher role without assigning schema/object
ownership, so it does not have this specific SET ownership prerequisite.
