# support123.gridex.se — OPS integration requirements

OPS integration guide for the user-confirmed portal `support123.gridex.se`, with e-mail/password login still to be built. The OPS application corrections are deployed and the database installation is verified. This guide specifies the remaining tenant registration and login integration; it does not claim a working hosted Staff session.

The existing OPS API supports an independent tenant's e-mail/password login through registered **external Supabase Auth**. The tenant authenticates the password; OPS never accepts the password and has no Staff password-login endpoint. Current `registeredStaffTenantAuth` accepts only `https://<20-lowercase-alphanumeric-project-ref>.supabase.co`, distinct from central OPS. A generic local password database would require a separate designed Auth-verification adapter; it is not supported by this existing independent onboarding path.

An external commercial SSO/OIDC provider is not required. `CustomerIdentityProvider.kind='tenant_key'` permits the tenant backend's asymmetric public JWK. The database table's word “provider” describes the registered issuer/audience/signature verification configuration; it does not mandate BankID, Freja or a separate SSO vendor. The tenant Auth access token and this backend-signed OPS assertion are separate credentials.

## Minimum verified facts before OPS registration

| Fact | Needed value/evidence |
| --- | --- |
| Company | Actual OPS company UUID and eligibility; no inference from domain or e-mail suffix. |
| Tenant origin | User-confirmed `https://support123.gridex.se`; Vercel assigns it to a separate project. The deployed login/Auth configuration remains unverified. |
| External Auth | Actual tenant Supabase project URL and public publishable/anon key, distinct from OPS; do not copy an existing project from an example without verification. |
| API client | Active same-company client, explicit required Staff scopes, lifecycle not revoked/deleted/expired; server-only API credential. |
| Origin registration | Exact origin in `allowed_origins` AND exact `metadata.staff_onboarding_origin`. |
| Auth registration | Operator-owned `metadata.staff_tenant_auth.url` and `.public_key`; no browser-supplied URL/key. |
| Signature registration | One active same-company `purpose='staff'` provider, `kind='tenant_key'` for this first-enrollment/invitation flow, `subject_claim='sub'`, `enforcement='enforce'`, exact real issuer/audience and the tenant backend's public verification JWK. Tenant server retains the matching private signing key. No invented issuer/audience/key. |
| First person | Explicit authorized invitation/binding to an OPS non-login actor, followed by active same-company membership and assignable role. No implicit email match or UUID equality. |

Read access to identity resolution requires `staff_users.read`; invitation acceptance requires `staff_users.write`. Ordinary customers/cases requests require their specific `staff_customers.read/write` or `staff_cases.read/write` scopes and the actor's permissions. Wildcard, Website and Customer scope groups do not grant Staff access. A company's role and permission overrides are calculated in OPS; an administrator must not be inferred from an e-mail address.

## Tenant implementation sequence — requirements only

1. Implement tenant-local e-mail/password Auth and server-side session verification with tenant `getUser`. Use the actual registered tenant project; never central OPS Auth for the employee login. A bearer must resolve to an existing, non-anonymous, non-deleted, not currently banned user; onboarding requires verified e-mail.
2. For first enrollment, the existing authorized OPS company-users control selects the actual company, client, recipient and assignable role. Its worker requires the registered tenant delivery endpoint, OPS-to-tenant public request-key registration, matching OPS private delivery key, and tenant signed-receipt configuration. The tenant must implement delivery durability and its invitation callback/password update. Auth redirects and SMTP are separate prerequisites from API origin registration. No real invitation can be claimed qualified before that endpoint and callback exist.
3. After successful first-password update, explicitly POST `/api/v1/staff-onboarding/invitations/accept` with the machine credential, `X-Gridex-Expected-Project-Ref` for **central OPS**, confirmed tenant bearer in `x-gridex-support-auth-token`, fresh assertion `token_use='staff_invitation_acceptance'`, stable `Idempotency-Key`, and closed body `{invitation_token}`. Proof `sub` is the tenant-local Auth user UUID and proof lifetime is at most 60 seconds. Acceptance checks original delivered invitation/client/provider/binding and grants through the canonical OPS engine.
4. For an enrolled login, POST `/api/v1/staff-onboarding/identity/resolve` with closed `{}`, same machine credential and expected central project, verified tenant bearer, and fresh `token_use='staff_identity_resolution'` assertion with local `sub`, correct company, issuer/audience, `iat`, `exp`, unused `jti`, lifetime at most 60 seconds. It only looks up an existing active binding/membership; it cannot bootstrap a new user. Response contains only `actor_user_id`, `binding_id`, `binding_version` inside the contract envelope.
5. For each ordinary Staff operation sign a new asymmetric assertion with central actor `sub` from that response, `token_use='staff_access'`, company, local Auth subject/issuer, binding ID/version, exact registered issuer/audience, `iat`, `exp` (maximum 900-second lifetime), and unique unused `jti`. Backend verifies its local login before signing each request. Send `Authorization: Bearer <server API credential>` and `x-gridex-staff-assertion`. OPS rechecks the current binding/client/provider, central account, membership and RBAC. Normal Staff access does not itself perform a fresh tenant Auth `getUser` request.
6. Qualify the actual company-scoped read, authorized write/audit attribution, logical retry with a fresh assertion, disabled membership, revoked binding/client/provider and invalid proof rejection. Password setup, SMTP delivery and successful callback remain tenant-owned runtime prerequisites; they were not executed in this audit.

Passwords remain with tenant Auth. Onboarding sends the verified tenant bearer to OPS; normal Staff requests send the machine credential and signed Staff assertion. Never send the machine API credential or private signing key to the browser. Central compatibility actors are non-login anchors because existing OPS foreign keys reference `auth.users`; their presence does not mean employees must log in to OPS or share its passwords.

## Contracts and current limits

Ordinary Staff documentation revision is `2026-10-12.1`, response default `2026-10-09.1`, with supported frozen `2026-10-04.1` release. Independent onboarding is separate version `2026-10-05.2`; the prototype `05.1` is not an admission option. Exact selected response profile should follow operator-owned registration and the compatibility guide; documentation dates are not authentication identifiers. Published frozen specs are immutable.

Production API base is documented as `https://app.gridex.se/api/v1/staff`; onboarding paths are under `/api/v1/staff-onboarding`. The expected API project must be verified central OPS, not the tenant project. The public Staff OpenAPI is `/api/v1/openapi/staff-v1.json`, and the independent onboarding specification is `/api/v1/openapi/staff-onboarding-v1.json`.

Confirmed source support is distinct from this tenant's readiness. The intended domain alone does not supply company/client/provider/binding/key identities. No Staff all-green claim is made before genuine configured login/enrollment/session evidence. Read-only OPS inventory found no company row containing this domain and zero Staff providers, clients and bindings. Register the actual company explicitly; do not infer it from a domain or e-mail suffix. The existing Gridex Web project mentioned in earlier examples is not verified as this portal’s Auth registration.
