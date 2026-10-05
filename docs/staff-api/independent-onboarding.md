# Independent staff onboarding

This additive contract is separate from the immutable Staff API release
`2026-10-04.1`. Its schema is
[`staff-onboarding-v1.json`](../openapi/staff-onboarding-v1.json), version
`2026-10-05.1`. The frozen Staff/Website/Customer documents and their release
manifest remain unchanged.

The implementation requires the **named `gridex-prod` project,
`ayiuxjlfazkjmmtlvhsl`**. The new migration is source-only; it has not been
applied to a hosted database. Production activation remains blocked until the
actual Prod dependency baseline, forward migrations, Auth/tenant/client/provider
registration, native CI and real callback delivery are qualified. Previous OPS
deployment evidence against `piidsfebjqjmnepdpnas` is not Prod acceptance.

## Registered portal and invitation delivery

An authorized operator registers one active integration client for the actual
Prod tenant. `metadata.staff_onboarding_origin` must be a canonical HTTPS
origin, also literally present in the client's **column** `allowed_origins`.
Credentials, paths, query strings, fragments, ports, IP literals and local
hostnames are rejected. Metadata origin-list fallback grants no authority.

```json
{
  "allowed_origins": ["https://support123.gridex.se"],
  "metadata": {
    "staff_onboarding_origin": "https://support123.gridex.se"
  }
}
```

The client must have explicit `staff_users.write`, be active, unexpired and
neither revoked nor deleted. The example does not authorize copying a tenant
UUID from another project or creating the Gridex tenant without verified Prod
identity. The tenant's purpose=`staff` provider remains separately registered.

Staff invitations validate this registration **before** the canonical intent
RPC. Existing staff clients without this registration can retain their other
authorized operations, but invitation creation fails closed with
`staff_onboarding_registration_invalid`. No browser-supplied callback is
accepted and the global OPS URL is not changed.

The leased worker remains the sole Auth/email-delivery owner. The delivery
helper resolves the original `tenant.invitation.create` command by company and
invitation ID, then reads its immutable `channel` and `api_client_id` binding.
For a staff API invitation it uses the registered portal's
`/auth/invitation?token=...`. Normal canonical OPS invitations keep their existing
callback. A missing durable binding cannot silently redirect staff to OPS.
The original pending invitation API response does not claim email delivery.

Supabase Auth's allowed redirect URLs must separately include the registered
portal's `/auth/invitation` callback (for Gridex, the verified
`https://support123.gridex.se/auth/invitation` callback and its invitation query).
Client metadata and `allowed_origins` alone do not configure Auth email
redirects: an unallowlisted `redirectTo` can fall back to the Auth Site URL and
send the employee to OPS. SMTP, Auth redirect allowlisting and actual invite/OTP
email callback delivery are deployment prerequisites. This implementation does
not edit Auth configuration or global email templates, and sends no real email.

## Explicit acceptance

`POST /api/v1/staff-onboarding/invitations/accept` requires all of:

- An authenticated registered client with explicit `staff_users.write`.
- `x-gridex-expected-project-ref: ayiuxjlfazkjmmtlvhsl`.
- `x-gridex-support-auth-token`: the user's access token, sent only by the
  portal server and verified using Prod Auth `getUser`, with confirmed email.
- `x-gridex-staff-assertion`: a fresh signed assertion from the current active
  purpose=`staff` provider, matching the verified Auth subject, registered
  issuer/audience and company, lifetime at most 60 seconds, unused JTI.
- A stable `Idempotency-Key`, 8–200 allowed characters.
- The closed JSON body `{ "invitation_token": "<invitation UUID>" }`.

The invite must belong to the same company, original client and staff API
channel. Its email and delivered Auth identity must match the verified user.
Company, user, role and callback fields cannot be supplied in the JSON body.
No active membership is required before this narrowly bound acceptance; the
normal Staff API context and all its membership/RBAC checks remain unchanged.

The mandatory Prod check occurs before machine authentication can rate-limit,
update telemetry or write audit records. Machine authentication precedes body
processing; unauthenticated requests cannot write an audit with no tenant.

The new service-only `gridex_accept_staff_invitation_v1` boundary locks and
rechecks current company/client/provider/Auth/invitation authority, including
credential rotation, expiry and the durable originating-client command. It
compares the verified public provider configuration/key with the locked row.
For OIDC providers, remote JWKS retrieval still follows the existing verifier;
the native snapshot proves the registered configuration, not external key
server history. The dedicated support app signs with its registered tenant key.

Only stable company/invitation/user/client/channel/idempotency fields reach the
unchanged canonical acceptance RPC. Verification snapshots and credential
hashes are not copied into command receipts, audits or public responses.
Canonical acceptance alone writes memberships, roles, domain events and outbox.
Repeated acceptance does not reactivate a previously disabled staff membership.
The legacy OPS acceptance adapter refuses staff API invitations, preserving the
independent flow and preventing a same-invitation lock cycle through that adapter.
Direct privileged service-role calls are outside this application-route claim.
The Auth user row is locked; active `user_profiles` is checked as a current
snapshot. Supported same-company Staff disable shares the company lock and
later Staff requests recheck profile status. Global profile writers are not
serialized by this wrapper, and these tests do not claim that wider concurrency
guarantee.

The receipt returns only `status: accepted`, request ID and this contract's
version. Retrying requires the same idempotency key and a fresh signed proof;
there is no automatic write retry.

## Independent portal callback

The support app renders its own invitation/password form. GET creates no
membership or role. On explicit POST it handles token-hash links, PKCE links or
default Auth fragment tokens. Fragment credentials are verified before storing
the portal's host-only session. URL credentials are removed locally and reset
after submission; an established verified session can retry without consuming
the email credential twice.

The user completes a password of at least 12 characters **before** submitting
canonical acceptance. A failed password update creates no membership through
the onboarding API. A failed acceptance may leave the user's legitimately
updated own Prod Auth password, without granting tenant access. The callback
does not call the membership-dependent workspace session probe before accepting.

Legacy user-editable `must_change_password` metadata remains a UX hint, not an
authoritative forced-rotation policy. It confers no membership or RBAC grant.

## Verification boundaries

Targeted tests execute real RSA/JTI verification, actual request adapters,
closed schemas, early wrong-project refusal and independent Auth handling.
Embedded PostgreSQL tests import the new wrapper and the unchanged canonical
acceptance/hash function bodies from source. Their minimal synthetic fixture
and SHA256 compatibility primitive do not replace native replay, concurrency,
RLS or hosted acceptance.

`scripts/staff-onboarding-acceptance-regression.sql` is hooked into the required
native clean-replay workflow and rolls back all synthetic effects. Native CI
must pass on the final published source before its execution can be claimed.
No hosted Prod migration, credential enrollment, provider enrollment, email,
tenant-data copy or domain move is part of these source tests.
