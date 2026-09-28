# P1 customer delegation boundary — 2026-09-28

## Current authority

`requireIntegrationApiAccess` authenticates a tenant integration key and checks
its scopes, tenant state, IP/origin and rate limit. `resolvePortalCustomer` then
resolves a customer from identifiers supplied by that client in headers, query
or payload. The consistency guard rejects contradictory canonical identifiers
and aliases within the supported request and payload fields, but
a single identifier still selects any matching customer in that tenant. An API
scope or a stored `match_strength='strong'` is not proof that the current end
user authorized this particular request.

The schema records `customer_portal_identities.provider`,
`external_account_id`, `auth_user_id` and an optional `api_client_id`. It has no
typed issuer/audience/subject binding. The website link writer records a
client-supplied user ID and verification metadata; those fields cannot serve
as an independently verified delegated assertion.

## Required contract before customer-delegated access

1. Pin the trusted issuer and audience for each tenant integration. Verify the
   proof independently of the integration key, including signature/algorithm,
   validity window and revocation semantics. Do not trust a caller-provided
   `verified` flag, email, subject, provider name or unverified token claims.
2. Bind the verified issuer and subject to one active portal identity/account
   and customer within the authenticated API client's tenant. A missing,
   disabled, ambiguous or changed link fails closed. Recheck current link and
   mandate state on idempotent replay and before a protected write.
3. Bind authorization to the operation and resource. Profile contact changes,
   login identity changes, billing recipients, documents and case messages
   require separate field/action policy; sensitive actions may need recent
   step-up proof. Tenant-system events must use a distinct machine authority
   contract rather than impersonating a customer.
4. Return a controlled denial before customer reads or writes. Do not fall back
   from a failed proof to email, number, external ID or cached authorization.
   Record non-sensitive issuer/subject references and decision codes for audit.

## Decision and verification inputs still needed

- Authoritative issuer(s), audiences, key rotation and revocation source for
  each website/integration; which actor is allowed to mint customer proofs.
- Subject-to-customer enrollment and recovery policy, including two providers
  using the same email or subject string, account transfer and revoked links.
- The exact customer actions allowed to a delegated user versus a tenant
  backend, plus step-up requirements for login/billing changes.
- Native tests with two customers in one tenant and another tenant; wrong
  issuer/audience/subject, expired/replayed proof, disabled link, wrong
  customer/resource, direct Data API/RPC and idempotent replay. Browser and
  external API tests must observe the same denial and no business effects.

No token format, trust root or new permission is implied by this note. Until
those inputs exist, T02/T06/T07/T30/T54 and full P1 acceptance remain open.

## P1 checkpoint after the handoff (2026-09-28)

The code now has an opt-in, platform-managed trust boundary for routes using
`requireCustomerPortalApiContext` and the delegated mode of
`requireCustomerPortalApiContextForIdentifiers`. It requires
`x-gridex-customer-assertion` in addition to the integration API key. The
server-only `GRIDEX_CUSTOMER_DELEGATION_TRUST_JSON` maps each integration
client UUID to an HTTPS issuer, audience, pinned **public** RS256 JWKS, and an
issuer/subject-to-customer UUID binding. Example structure with invented
identifiers (no private key or real customer mapping belongs in the repo):

```json
{"<api-client-uuid>":{"issuer":"https://issuer.example.test","audience":"gridex-customer-portal","jwks":{"keys":[{"kty":"RSA","n":"<public-modulus>","e":"AQAB","kid":"<key-id>","alg":"RS256","use":"sig"}]},"bindings":{"https://issuer.example.test":{"<subject>":"<customer-uuid>"}}}}
```

The signed JWT requires `iss`, `aud`, `sub`, `iat`, `exp`, `company_id`,
`api_client_id`, `customer_id`, and exact `action` (`METHOD /api/v1/customer/...`,
including the concrete resource path). `jose` verifies the signature and a
five-minute maximum token age. The platform binding is checked independently
of the client's metadata or supplied customer identifiers. The resolver is
forced onto the signed subject's **active** portal-account path; it must
resolve the same customer before any protected handler proceeds. This happens
again before idempotency replay. Missing configuration or proof fails closed.
`POST /api/v1/customer/sync` uses a separate tenant machine mode and now
requires the literal `customer_sync.write` client scope; a broad legacy
`customer_portal.write` alias alone cannot select the machine mode.

This is a checkpoint, **not a configured production integration**. No real
issuer, key rotation, enrollment/recovery authority or customer bindings were
available here. The in-memory JSON bindings are a deliberately bounded
configuration contract; bulk enrollment and immediate external issuer-session
revocation require an authoritative managed source. JWTs are short lived but
not one-time use. Sensitive write step-up, request-body binding, real two-
customer/two-tenant database replay, OpenAPI release synchronization, native
grants and browser evidence remain open. The current public release spec
`2026-08-22.2` predates this draft runtime gate; do not mark T48 complete.
