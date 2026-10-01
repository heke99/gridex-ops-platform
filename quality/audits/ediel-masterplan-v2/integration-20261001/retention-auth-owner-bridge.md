# Retention Auth owner boundary — 2026-10-01

Authentic clean110194926478 / upgrade110194926304 at root`c163` emitted the actual
Supabase PostgreSQL17.6 role/ACL registry before00500. Migration`postgres` is
NOSUPERUSER and has Auth schema USAGE without grant option. `auth.users` is owned
by`supabase_auth_admin`: postgres may SELECT and UPDATE/row-lock but cannot
delegate UPDATE. `auth.uid()` has PUBLIC EXECUTE, which still requires Auth
schema USAGE. There is no usable SET membership to AuthAdmin/StorageAdmin/Super.
The old00500 GRANT statements warn rather than granting all required access.
Storage objects instead have grantable existing privileges; no invented
Storage delegation or Auth role escalation is introduced by this package.

CLI-created forward25642 preserves that owner boundary. A closed postgres-owned
session-identity function and Auth-user row-lock/active-status function expose
only UUID/boolean results to the private NOLOGIN retention owner. They retain
actual deleted/banned/profile-active/disabled checks and FOR SHARE locks. No
application role receives EXECUTE or private-role membership. Company/current
grant/DENY/class/issuer/legal-policy/deadline/source/hash/immutable graph checks
remain in each complete installed retention function.

The forward replaces only recognised Auth expressions in functions already
owned by the private retention owner, including00710 and installed012305/15940
consumers. It rejects any unrecognised expression; actual function OID, owner,
ACL and search_path must remain unchanged. No frozen migration is rewritten.
Future consumers must use this owner port explicitly or require another forward
review before using inaccessible Auth objects.

Executed bounded regression uses distinct Auth schema/table/function owners and
a NOSUPERUSER migration principal with its own non-delegable Auth privileges.
The actual00500 actor and00710 permission bodies fail red before the bridge and
pass afterward. Wrong session, foreign company, absent membership, deleted,
banned, disabled and current DENY cases fail closed; all application roles are
denied direct bridge calls. Consumer OID/owner/ACL/search_path are identical.
The actual full archive/customer/blob/read SQL mechanism script also applies the
forward and preserves document reads and foreign denial with zero residual
Auth expressions in private-owned consumers.

These are synthetic SQL/role mechanisms, not authentic legal decisions, real
Auth/session qualification or native Supabase replay. Genuine clean/upgrade,
installed012305/15940 integration, HTTP/browser/current readonly archived
scenarios and final exact-head CI remain separate mandatory receipts.
