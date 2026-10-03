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

## Subsequent un-switched DDL prerequisite

The next authentic clean/upgrade replay at `6a6ee8` passed SET ownership but
failed 00500 CREATE TABLE: its remaining body runs as the migration principal
without SET ROLE. CLI-created `20261001021000_ediel_retention_migration_schema_privileges.sql`
is explicitly ordered as 00460 after 00459 and before immutable 00500. It enables
INHERIT TRUE for this exact private owner and actual validated migrator only.
There is no ADMIN option, application membership or operational/default grant.

The bounded non-superuser regression now reproduces both failures: missing SET
ownership and missing inherited schema CREATE. After 00459+00460 it executes
REVOKE, CREATE TABLE, ALTER TABLE OWNER, CREATE FUNCTION, ALTER FUNCTION OWNER,
function execution and idempotent reapplication without changing current role.
All application roles remain non-members and lack private schema USAGE. The
extended regression failed red at schema CREATE before 00460 and passed green
after it. The entire genuine 00500 clean/upgrade replay remains **NOT RUN here**;
PGlite does not supply Supabase/native acceptance evidence.

## Public function owner-transfer prerequisite and cleanup

Authentic clean job 110190936723 and ancestor-upgrade job 110190936527 at
`8d60dfec` both passed 00460 and 00500 schema/table creation, then failed
00500 line163: the new private owner lacked CREATE on the public schema during
ALTER FUNCTION OWNER. The historical 00459,00460 and00500 bytes remain unchanged.

CLI-created 23940 is dependency-ordered as00461. Only the validated migration
schema grantor gives CREATE to the exact private NOLOGIN owner, without grant
option or application membership. CLI-created24042 is ordered as22427 after
all current retention function transfers including012305 and22426; it removes
CREATE and fails closed if any inherited public CREATE remains. Future DDL
after that cleanup must explicitly grant/revoke CREATE inside its transaction.

The bounded non-superuser SQL regression rejects the public function transfer
before00461, accepts it afterward and confirms22427 removes CREATE while
execution of the existing private-owned function remains possible. Distinct
Auth/Storage table and function owners are explicitly simulated: the migration
principal has its own SELECT/UPDATE privileges without grant option, and the
retention owner has neither. This confirms that the public fix does not imply
Auth/Storage grantability. Authentic role/ACL diagnostics and a whole genuine
clean/upgrade replay remain required; runtime auth actor locking is unresolved
until those native grants or a separately qualified owner port are implemented.

## Actual captured-source trigger name dependency

Authentic clean110194926478 and upgrade110194926304 at`c163` passed00500 and
00610, then00700 line68 rejected its DROP because original20260922095911
names this specific trigger`received_sources_no_update_delete`. The generic
`no_evidence_update_delete` name belongs to other evidence tables.

CLI-created25430 is ordered00699 before unchanged00700. It validates the exact
installed source trigger's function, BEFORE UPDATE/DELETE ROW mask, non-internal
identity, zero arguments and enabled O/A mode, then renames it with ALTER TRIGGER.
The same OID and complete catalog row except its name must remain unchanged.
No trigger is disabled. The bounded red/green regression proves the old DROP
name fails first, preserves UPDATE/DELETE refusal before and after the rename,
and permits unchanged00700's later named replacement. The full existing SQL
retention mechanism script now uses the original source-table trigger name and
applies00699 before actual00700; all its archive/customer/blob/read phases pass.
These remain synthetic SQL mechanisms. Genuine replay/runtime/browser evidence
is pending; the separate Auth owner dependency is not solved by this rename.
