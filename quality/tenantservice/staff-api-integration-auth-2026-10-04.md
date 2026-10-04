# Staff API integration machine guard

Skills: differential-review (existing PR482 overlap), fp-check (proven sales
provisioning barrier), test-driven-development (actual SQL RED/GREEN), Supabase
and verification-before-completion. No UI, performance or Ediel work applies.

Baseline `fa4147b33dd3215c150cbe91d755db30e5ae6c62`; read-only PR482 review at
`86d2a86e6bc34adbe7e13a97069964a4ccab314c`. PR482 remains open/draft and its
dedicated credentials, OPS HS256 session proof and `staff_support` paths differ
from this request's external RS/PS/ES256 assertions, provider purpose and scopes.
No PR482 source, credentials, branch or activation was changed.

Confirmed blocker: the existing `authenticate_integration_request_v1` always
requires Website launch readiness, a completed installation receipt and
`api_sales` for ordinary traffic. A valid staff-only key therefore fails before
staff assertion verification. The actual pre-change SQL regression failed with
`api_client_not_launch_ready` on `/api/v1/staff/users` and `staff_users.read`.

Forward migration `20261004083809_staff_api_integration_auth.sql` preserves the
existing RPC signature and credential core. Only the finite new staff routes
with nonempty, explicitly requested matching staff scopes and explicit matching
client scopes bypass Website sales readiness. Empty/OR-only/mixed/wildcard scope
requests and unknown staff paths fail closed. Legacy wildcard keys do not opt
into staff. Company activation, key validity/expiry/revocation, IP/origin and
atomic rate limits remain authoritative. The Website/customer and exact
provisioning-smoke receipt rules stay unchanged. Function grants remain
service-role-only.

`scripts/staff-api-integration-auth-regression.sql` runs against the actual SQL
RPC with synthetic company/client/receipt/capability data and rolls back. It
exercises all 21 staff route/scope pairs, denied scope/path combinations,
credential/lifecycle/network failures, customer launch/receipt/api_sales gates,
metadata-linked receipts, smoke authorization, rate exhaustion and actual caller
role grants. Root wires it into the ordinary clean Supabase replay.

Executed locally: two Vitest SQL behavior tests PASS (real source SQL in PGlite),
standalone SQL diagnostic PASS; migration checksum/version gate PASS (1042 files,
945 groups). Scoped TypeScript lint PASS. This is diagnostic SQL proof, not native
PostgreSQL/replay acceptance. Starting native PG16 was blocked because this
container cannot change root ownership/UID (`chown` Invalid argument, `runuser`
Operation not permitted, `setpriv` Invalid argument). Native CI, authentic schema
artifacts, final-head whole-suite verification and production rollout remain
root-owned gates.
