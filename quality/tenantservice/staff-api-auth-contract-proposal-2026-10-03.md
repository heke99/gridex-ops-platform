# Staff API authentication proposal — 2026-10-03

Status: design only, awaiting root review and a frozen wire contract. No source,
migration, environment, domain or publication changes implement this proposal.
The source baseline inspected is OPS `2c8e283e4fb6b232fe4e249352e33e8baeff14b1`.

The user's clarified boundary is that the Web staff frontend, including its
separate login, accesses OPS through documented OPS APIs. Hosting the native OPS
console at `support123.gridex.se`, direct Web calls to OPS Supabase Auth, and Web
database reads of customer records do not satisfy that boundary.

## Existing evidence and gaps

- `lib/integrations/apiAuth.ts` already authenticates the integration key,
  selects its company, checks scopes and lifecycle, and atomically rate limits.
  `Authorization: Bearer` remains this machine credential.
- `lib/admin/apiGuards.ts` verifies native Auth, resolves
  `canonical_authenticated_tenant_context` and checks the current company
  permissions. It is cookie-bound and cannot be exposed unchanged as the new
  external staff guard.
- The canonical context rejects deleted, banned, unconfirmed and inactive
  accounts and resolves active roles/memberships for the selected company.
  `is_platform_admin` comes from the database, never from a role label or JWT
  user metadata. Passing the API-key company explicitly avoids unioned rights.
- `gridex_is_current_session_allowed` also checks disabled account state, but
  does not prove that the JWT's native `session_id` still exists after logout.
  The inspected login/proxy/admin API paths contain no staff MFA/AAL gate.
- The legacy password-change redirect reads
  `user_metadata.must_change_password`, which is not a trustworthy permission
  claim. A `user_profiles.must_change_password` column also exists. The staff
  contract must verify a server-protected policy source and its write grants,
  or identify that missing enforcement as a blocker; it must not inherit an
  authorization decision from editable metadata.
- Published `/api/v1/customer/support/**` is for one verified linked customer.
  It provides no staff login, cross-customer queue, internal notes or staff
  authorization contract. Customer assertions and caller-supplied staff UUIDs
  must never authenticate staff.
- The native console is `/admin/customer-cases`, not `/admin/support`.
  Its list/detail/download currently use unrelated `operations.tasks` read
  permissions. The dedicated `customer.cases` requirement is
  `cases.read | customers.read`; writes require `cases.write`. A frozen local
  behavioral test reproduces this independent native console defect. It is not
  included as an implementation of the API-first feature.

## Recommended personal proof

OPS retains native Auth access and refresh credentials in an encrypted,
server-only staff-session vault. It returns its own short-lived staff JWT and
an opaque rotating refresh token to the trusted Web BFF. Native provider
credentials never enter the browser, Web Supabase, URLs, logs or response DTOs.

Every staff resource request supplies both:

```http
Authorization: Bearer <tenant integration API key>
X-Gridex-Staff-Authorization: Bearer <OPS staff JWT>
```

The JWT has a fixed OPS issuer, `aud: gridex-staff-api`, a pinned signing
algorithm/key ID, short expiry (proposed five minutes), and opaque `sub`, `sid`,
`organization_reference` and `api_client_reference` claims. Its session record
binds the authoritative native user ID and native session ID to that exact API
client/company, authentication stage, current revision and expiry. JWT claims
are not a permission source. The refresh token is high entropy, stored as a
hash, and rotated with a serialized session revision. The vault's native
credentials and any retry receipts containing credentials are encrypted.

Refresh, password and MFA verification require stable operation references and
serialized session operation leases. Exact authenticated retries may replay an
encrypted receipt for that operation; unrelated reuse of an old refresh token
fails. A provider call and a database transaction are not atomic together. If
the provider may have consumed a credential but its result cannot be recovered,
the session is blocked pending fresh authentication instead of blindly repeating
password, refresh or OTP submissions. Logout revokes the API proof locally even
if the native provider is unavailable; native revocation can then be completed
without restoring resource access.

This requires one bounded server-only session table and a session-validation
RPC, plus server-only signing/encryption keys. Those are future implementation
work, not changes made by this design. A raw native JWT without API-client
binding or an unsigned `staff_user_id` is not the recommended substitute.

The shared resource guard runs, in order:

1. Existing integration authentication, scope, lifecycle and traffic protection.
2. Staff JWT signature/issuer/audience/expiry and active vault lookup; require
   exact API-client/company/session-revision binding.
3. Fresh native Auth verification and a live native `auth.sessions` row whose
   ID/user match the verified native token. Inspect the deployed Auth schema
   before choosing its expiry/revocation predicates; never accept missing or
   indeterminate session evidence.
4. `gridex_is_current_session_allowed === true`, current account eligibility,
   native assurance level and password-change policy. Provider/database failures
   produce 503 and no customer read/write.
5. Canonical context with `p_selected_company_id = API-key company`; require
   `authorized === true`, verified user equality and exact company equality.
   Tenant staff need an active eligible membership/non-customer role. A native
   platform administrator may read only this API-key tenant, never all tenants.
6. Fresh per-operation native permission. Staff writes require tenant-staff
   context and the actual write permission; platform administration does not
   confer a staff write exception. Derive actor/company/customer ownership on
   the server and recheck at the transactional command boundary.

## Proposed wire surface

Names/scopes below are proposals to freeze with the resource contract before
implementation; none currently exist or should be advertised as available.

| Method/path under `/api/v1/staff` | Input and successful result | Machine scope |
| --- | --- | --- |
| `POST /sessions` | `{email,password}` → session receipt with `authenticated`, `mfa_required` or `password_change_required`, staff JWT, opaque refresh token, expiry and safe factor references | `staff_sessions.write` |
| `POST /sessions/refresh` | `{refresh_token}` → rotated session receipt; same client/company; serialized revision | `staff_sessions.write` |
| `POST /sessions/logout` | Current personal proof or this client's opaque refresh credential → revoked API session, native revocation and cleared refresh credential; idempotent receipt | `staff_sessions.write` |
| `POST /sessions/mfa/challenge` | `{factor_reference}` → actor-owned challenge reference, method and expiry | `staff_sessions.write` |
| `POST /sessions/mfa/verify` | `{challenge_reference,code}` → upgraded native assurance and session receipt | `staff_sessions.write` |
| `POST /sessions/password` | Limited personal proof plus `{password}` → native password changed, restricted stage cleared only after verified success | `staff_sessions.write` |
| `POST /sessions/recovery` | `{email}` → generic 202 regardless of account existence/eligibility | `staff_sessions.write` |
| `POST /sessions/recovery/verify` | `{token_hash}` → restricted native recovery session; no resource access before password change and required MFA | `staff_sessions.write` |
| `GET /me` | Current proof → staff reference, display name, organization reference, freshly evaluated permissions and capabilities | `staff_context.read` |

Pending MFA, password-change or recovery sessions can complete only their
authentication steps or logout. They have zero customer-data capabilities.
An enrolled/required native MFA factor must not be bypassed by accepting the
password session's `aal1`. Unsupported native factor methods fail closed with
a documented blocker; an MVP cannot claim support for methods it does not
implement. Recovery verification uses the native returned hashed token and an
explicit user action, rather than relying on implicit URL fragments that the
server callback cannot read.

Resource paths, operation permissions and public DTOs are a separate finite
matrix being inventoried by the resource reviewer. The intended families are
`/staff/customers` and `/staff/support/cases`; do not replace their missing
contract with existing own-customer endpoints or native console SQL reads from
Web. Existing customer/website immutable OpenAPI releases stay byte-identical.
Publish a separately versioned staff specification/capabilities contract only
after schemas, route inventory, runtime behavior and tests agree.

## Web boundary, errors and operational requirements

- `support123.gridex.se` belongs to the Web staff frontend. Its host-specific
  login and BFF call these OPS APIs exclusively. Ordinary customer sessions do
  not authorize staff. The root serves staff login/workspace, and marketing,
  registration and customer-portal paths are unavailable on this host.
- Keep personal proof in a host-only `Secure`, `HttpOnly`, `SameSite` cookie,
  preferably a `__Host-` cookie, encrypted with a Web server-only key. Never
  return credential receipts from the BFF to client JavaScript. No parent-domain
  cookie sharing or browser credentialed CORS dependency is needed.
- Require exact allowed Origin and session-bound CSRF protection for BFF
  mutations, including login, refresh, logout and recovery verification. Use a
  fixed approved staff recovery origin, not `Host`/`X-Forwarded-Host` supplied
  by a caller. Preserve the primary OPS app URL and its existing auth flows.
- A dedicated integration client/key for staff is recommended, with explicit
  staff scopes and only the approved staff frontend origin. It selects the
  same intended OPS tenant; no tenant/company ID supplied by Web is authoritative.
- All staff responses use `private, no-store`; Web responses vary by Cookie.
  Bounded login/reset/MFA rate limits are additional to existing atomic API-key
  limits and native Auth protection. Limits use client plus trusted IP/account
  hash; an unavailable limiter fails closed. Return `Retry-After` on 429.
- Use the canonical error envelope with `code`, safe `message`, `request_id`,
  `correlation_id`, `retryable` and `blockers`. Invalid credentials and ordinary
  customer/nonmember login attempts are indistinguishable 401. Resource proof
  absence/expiry is 401; permission/stage denial is 403; inaccessible references
  are 404; conflicts are 409; provider/guard outages are retryable 503.
- Never log passwords, OTP/recovery values, JWTs, refresh tokens or full headers.
  Existing route/status/client telemetry can remain; redact provider errors and
  ensure command audit derives the verified staff actor. Writes retain stable
  actor/client/tenant-bound idempotency and re-authorize before replaying any
  receipt that contains protected data.

## Minimum executable acceptance

1. Actual API-key guard rejects absent/revoked/expired keys, missing staff scopes,
   inactive tenant and limiter outage before Auth or business reads.
2. Wrong password, customer-only account, wrong tenant, inactive membership,
   inactive role, unconfirmed/deleted/banned/disabled account cannot create a
   usable staff session. Provider outages remain 503, not credential errors.
3. Forged/expired/wrong-audience JWTs, mismatched user/native session, missing
   session row, revoked logout session, wrong API client and cross-tenant proof
   fail before data access. No actor UUID/header can replace personal proof.
4. Permission revocation/expiry after login is effective on the next operation;
   a dual-company user cannot borrow another company's rights. Read-only staff
   can read but cannot mutate. Native platform-admin reads stay API-key tenant
   scoped and staff writes remain denied.
5. MFA/password/recovery restricted stages cannot read resources; factor and
   challenge substitutions fail; required MFA is upgraded only by native proof.
6. Concurrent refresh/logout/replay tests prove one current revision, atomic
   credential rotation, invalidation and no repeated password/OTP submission
   after an uncertain provider result.
7. Two-tenant customer/case/attachment/action tests assert ownership, role
   denial, closed-case behavior, safe DTO projections, actor audit, idempotency
   and rollback at the actual command path.
8. Web host, cookie, CSRF, login/logout/recovery and outage behavior tests invoke
   the real BFF paths; staff flow makes no Web Supabase/DB customer-data calls.
   Schema, immutable release and live deployment tests remain distinct gates.

Source/behavior inventory alone is not live authentication, tenant, MFA or
production configuration verification. Root owns those settings and cutover.
