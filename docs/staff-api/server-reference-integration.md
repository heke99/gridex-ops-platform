# Independent Staff server reference

The [Node.js reference module](../examples/tenant-staff-reference-client.mjs) connects a future backend to the existing independent Staff API. It uses Node **22+**, built-in crypto/fetch and explicit caller configuration. Importing it, running it without arguments or passing `--help` only displays help or defines the factory; these actions perform no Auth or API calls. Unknown arguments produce a fixed help message and exit code 2 without echoing the arguments.

This kit does **not** create a tenant application, Auth registration, API credential, invitation delivery endpoint, SMTP setup, live login or customer business acceptance. Gridex El AB is the intended future customer; no company UUID, project, account, credential or readiness has been inferred from that name. The operator must supply the actual authorized values. Local tests do not certify a hosted customer integration.

## Registration and project separation

Complete [independent onboarding](independent-onboarding.md) and the [integration prerequisites](support123-integration.md) with the authorized operator first. The central deployment needs the existing `staff_core`, `staff_external_identity` and `staff_session_revocation` features. This reference neither registers providers nor accepts invitations or creates membership.

| Caller-supplied option | Meaning |
| --- | --- |
| `apiOrigin` | Exact HTTPS API origin, without credentials, path, query or fragment. No default. |
| `expectedProjectRef` | The **central OPS database project**, attested by this API deployment; 20 lowercase alphanumeric characters. |
| `companyId` | Canonical company UUID associated with the machine credential and provider. |
| `tenantAuthIssuer` | Exact registered independent issuer, `https://<tenant-project>.supabase.co/auth/v1`. Its project must differ from the central project. |
| `providerIssuer`, `providerAudience`, `providerKeyId` | Exact operator-registered Staff proof issuer, audience and key ID. These are distinct from the tenant Auth issuer. |
| `providerPublicJwk` | Registered public RSA JWK with `alg: "RS256"` and the matching `kid`. No private JWK fields. |
| `signingPrivateKey` | Matching server RSA private `KeyObject` or PEM, at least 2048 bits, obtained from the backend's secret store. |
| `machineCredential` | Server-only Gridex credential. Never a tenant Auth bearer or a service-role key. |
| `getVerifiedTenantSession` | Trusted server callback described below. Called before **each** newly signed proof. |
| `timeoutMs` | Optional API timeout, including response body; default 10,000 ms, permitted range 10–30,000 ms. |
| `fetchImpl` | Optional trusted server transport adapter, principally for local tests. Never browser supplied. |

Grant literal `staff_users.read` for resolution, `staff_customers.read` for listing, `staff_cases.write` for creation and `staff_cases.read` for read-back. Wildcard, website and customer scopes do not substitute for Staff scopes. The acting central user also needs active same-company membership and the route's `customers.read`, `cases.write` or `cases.read` permission. The server checks the current provider, registration, binding, membership and permissions again on ordinary requests, including stored replays.

## Verify the tenant session on the server

Use the registered independent Auth URL and its publishable key (or registered legacy anon key). Do not substitute central OPS Auth or a service-role key. The following adapter uses the installed Supabase JavaScript SDK's actual [`auth.getUser(accessToken)`](https://supabase.com/docs/reference/javascript/auth-getuser), whose network-verified user is the authority for the local subject. `getSession`, a decoded JWT, browser-supplied UUID, email match and `user_metadata` are insufficient.

The variables below are arguments supplied by the future backend: `registration` is trusted operator configuration, `serverSecrets` comes from its secret store, and `readRequestAccessToken` reads the current request's in-memory bearer or protected server session. Nothing here loads environment secrets, dotenv or command-line credentials. Keep the returned client scoped to that backend request/session; do not export it or its configuration to the browser.

```js
import { createClient } from '@supabase/supabase-js'
import { createStaffReferenceClient } from './docs/examples/tenant-staff-reference-client.mjs'

export function staffClientForRequest({ registration, serverSecrets, readRequestAccessToken }) {
  async function getVerifiedTenantSession() {
    const accessToken = await readRequestAccessToken()
    if (typeof accessToken !== 'string' || !accessToken || /\s/.test(accessToken)) {
      throw new Error('Tenant session unavailable')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    try {
      const auth = createClient(registration.tenantAuthUrl, registration.tenantAuthPublicKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (input, init) => fetch(input, {
          ...init, redirect: 'error', signal: controller.signal,
        }) },
      })
      // This call is made again for every resolve, read, write and explicit retry.
      const { data, error } = await auth.auth.getUser(accessToken)
      const user = data.user
      if (error || !user || user.deleted_at != null || user.is_anonymous === true
        || !user.email || !user.email_confirmed_at
        || !Number.isFinite(Date.parse(user.email_confirmed_at))
        || (user.banned_until != null && (!Number.isFinite(Date.parse(user.banned_until))
          || Date.parse(user.banned_until) > Date.now()))) {
        throw new Error('Tenant session unavailable')
      }
      return { user, accessToken, authIssuer: `${registration.tenantAuthUrl}/auth/v1` }
    } finally { clearTimeout(timer) }
  }

  return createStaffReferenceClient({
    apiOrigin: registration.apiOrigin,
    expectedProjectRef: registration.centralProjectRef,
    companyId: registration.companyId,
    tenantAuthIssuer: `${registration.tenantAuthUrl}/auth/v1`,
    providerIssuer: registration.staffProviderIssuer,
    providerAudience: registration.staffProviderAudience,
    providerKeyId: registration.staffProviderKeyId,
    providerPublicJwk: registration.staffProviderPublicJwk,
    signingPrivateKey: serverSecrets.staffSigningPrivateKey,
    machineCredential: serverSecrets.gridexMachineCredential,
    getVerifiedTenantSession,
  })
}
```

The callback must verify the **current** local session on every invocation. The client rejects a different local user until identity is resolved again. It never treats a cached central actor as authority for another local user. The local bearer stays in memory and is sent only to `/api/v1/staff-onboarding/identity/resolve`; ordinary Staff requests carry the machine credential and signed proof only.

## Explicit resolve, read, create and read-back

The example below is imported application code, **not** an automatically executed CLI. The backend calls it only after authorizing the user's operation. `approvedOperation` is a durable backend operation record containing the original closed payload and stable idempotency key, saved before the first write. Its customer reference comes from an authorized same-company API result; internal customer UUIDs are not accepted.

```js
const staff = staffClientForRequest({ registration, serverSecrets, readRequestAccessToken })
const identity = await staff.resolveIdentity()
// identity.data contains exactly actor_user_id, binding_id and binding_version.
// The central actor and the verified tenant Auth user may have different UUIDs.

const customers = await staff.listCustomers() // First bounded page, no arbitrary URL/query API.

// Only these create payload fields are accepted:
// { customer_reference, title, description?, category?, priority? }
// priority: low | normal | high | urgent (server default: normal).
const created = await staff.createCase(approvedOperation.payload, approvedOperation.idempotencyKey)
const readBack = await staff.getCase(created.data.case_reference)
// Each success exposes { status, requestId, replayed, data }.
// Persist safe request IDs and operation state; avoid logging business DTOs or secrets.
```

Resolution sends closed `{}` with a fresh RS256 proof whose `sub` is the getUser-verified **local** UUID and `token_use` is `staff_identity_resolution`. Its lifetime is 60 seconds. It verifies central project attestation, onboarding contract **2026-10-05.2**, correlated safe request ID and the exact three binding fields before retaining a private copy.

Every ordinary request uses a fresh proof with the returned **central** `actor_user_id` as `sub`, `token_use: "staff_access"`, fixed `company_id` and exact `local_auth_subject`, `local_auth_issuer`, `staff_binding_id`, `staff_binding_version`. The reference uses a 60-second lifetime for access too. It requires the current default Staff response contract **2026-10-09.1**, central attestation and correlated request ID. A client pinned by operator metadata to another response profile needs a separately reviewed compatible adapter; this reference fails closed on that version.

## Retry and reconciliation

One method call makes **one API attempt**. There is no automatic retry, redirect following, new-key generation or hidden business write. API work has a bounded timeout covering fetch and body consumption, a 256,000-byte response limit and fixed paths under the configured origin. Invalid JSON, unexpected envelopes/attestation and malformed binding output fail closed. Errors expose only fixed safe messages, status, request ID and an allowlisted code; backend messages, bodies and fetch exception text are discarded.

For an explicit logical retry, load the **same durable operation, identical payload and same key**, verify the current local session and sign a fresh proof. With a fresh backend request, construct a new client and explicitly resolve first. A successful stored replay has the same opaque case reference and `replayed: true`. The server rechecks current access before replaying it. Same key plus changed body returns **409 `idempotency_conflict`**. A **new key is a new operation**, and can create another case; it provides no retry or duplicate-effect protection for the earlier key.

```js
try {
  const result = await staff.createCase(approvedOperation.payload, approvedOperation.idempotencyKey)
  await recordConfirmedOperation({ requestId: result.requestId, replayed: result.replayed,
    caseReference: result.data.case_reference })
} catch (error) {
  // Record only the reference's safe fields; do not stringify arbitrary exceptions.
  await recordUnconfirmedOperation({ code: error.code, status: error.status, requestId: error.requestId })
  // No resend here. A separate explicit reconciliation/retry decision owns the next attempt.
}
```

`transport_outcome_unknown` means the server might already have committed. **503 `idempotency_completion_uncertain`** also preserves that possibility. **409 `idempotency_reconciliation_required`** requires checking the earlier operation's authoritative state before considering another key. `idempotency_in_progress` and `idempotency_previous_attempt_failed` remain distinct. Do not report success without confirmation, delete potentially committed resources, or silently turn any of these into a new operation. Session, binding or membership revocation must be resolved through the authorized onboarding/access process.

## POA intake and incoming-mail continuation

This Staff reference handles identity resolution, customer listing and support cases. Its case-creation method does not create a power of attorney, verify a customer's acceptance or submit an authenticated supplier reply. Existing Staff scopes and actor proofs do not substitute for those business permissions.

Website intake uses the existing structured POA contract, original acceptance evidence and stable retry key described in the [Website integration guide](../external-website-api-integration-guide.md#legal-acceptance-identity-and-power-of-attorney). That guide also describes [automatic reply processing](../external-website-api-integration-guide.md#automatic-poa-replies-facility-data-and-start-dates): OPS owns the archived document, verified tenant/customer/site/request matching, validated facility and commercial facts, and continuation through normal market readiness. Client applications must follow the documented application status rather than treating a read AI result or a successful support-case write as a completed supplier switch.

No new Staff endpoint, proof claim, scope or response version is introduced for this internal mail automation. Its required deployment/migration and operational limits are recorded in the [POA runbook](../manual-poa-mail-runbook.md).

## Evidence and remaining runtime acceptance

Run the existing local quality port, with repository dependencies installed:

```sh
node --check docs/examples/tenant-staff-reference-client.mjs
node docs/examples/tenant-staff-reference-client.mjs --help
./node_modules/.bin/vitest run --config quality/vitest.config.ts quality/tenant-staff-reference-client.test.ts
```

The new test is discovered by the existing ordinary OPS `quality-release-gates`; no workflow or test configuration is changed. Its synthetic Auth fetch executes the installed SDK getUser path and real registration validation. The mounted flow executes real `createStaffIdentityResolutionHandler`, RSA/JTI verification, `createStaffApiContextResolver`, `withStaffApi`, customer/case handlers, DTOs, domain command composition and `executeIdempotentPortalWrite`. Only network/machine, native and storage effects use isolated test ports. It proves local/central separation, exact command attribution, request-ID/log correlation, write/read-back/replay, revocation and foreign-reference denial, transport bounds and offline entrypoints.

The synthetic RPC tuple, case/event/audit records and in-memory replay store are **not new native SQL qualification**. Existing qualified server/native evidence is reused for unchanged source; this kit changes no server, SQL, frozen specification, generated type or gate. Source equality establishes only the stated applicability, not fresh deployed database evidence.

Actual acceptance still requires the authorized operator to resolve the real company and target deployment, confirm source/native applicability, create the future backend and registrations, complete authorized enrollment/delivery, and exercise real getUser → resolve → Staff access on explicitly owned tagged fixtures. Verify read/write/read-back, audit attribution and same-operation replay, then clean up only those authorized fixtures. No customer/provider/database request, invitation email, live login or hosted business acceptance is performed or certified by this kit.
