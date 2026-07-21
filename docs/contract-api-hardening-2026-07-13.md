# Contract/API/signature/mail hardening — 2026-07-13

This release closes the tenant contract visibility gap and makes the website agreement flow use one immutable contract identity from publication through signature, OPS, customer portal and email delivery.

## Canonical contract identities

The platform now keeps these identities separate:

- `contract_offers.id`: internal OPS template.
- `public_contract_offers.id`: public website offer.
- `customer_contracts.id`: customer agreement.
- `offer_reference`: opaque HMAC-signed selector returned to the website.

The website must select an offer only with the exact `offer_reference` returned by `GET /api/v1/website/public-contracts`. Legacy product/price identifiers no longer select an offer. If sent together with `offer_reference`, they are compatibility assertions and must match it.

## Main fixes

- Tenants with `contracts.read` can open the customer contract tab and the tenant-wide signed-contract register.
- `contracts.write` is evaluated separately; read-only users receive no edit actions.
- Contract navigation no longer redirects away from `?tab=contracts` or points to dead anchors.
- Public offer publication fails closed when legal bundle, price book, price-plan version or API client readiness cannot be verified.
- `diagnostics=1` returns tenant-scoped publication blockers for authenticated website API clients.
- Website intake binds five exact legal text version IDs from the selected public offer.
- A security-definer RPC atomically changes the customer agreement from `pending_signature` to `signed` only after exact acceptance evidence exists.
- Browser-supplied `signed_at` is ignored. The server acceptance timestamp controls `signed_at` and the 14-day withdrawal deadline.
- `public_contract_offer_id`, `offer_reference`, legal snapshot, signature snapshot and SHA-256 hash are stored on the agreement and exposed through the customer portal API.
- Historical website applications and external intake rows are backfilled through durable same-tenant links. Overloaded price-plan IDs are removed from `external_contract_intakes.contract_offer_id`.
- Historical `pending_signature` rows are finalized only when all five exact legal acceptances already exist at the same timestamp. Incomplete records remain pending for manual legal review.
- Agreement confirmation is queued immediately after verified signature; it no longer waits for facility lookup, grid-owner resolution or supplier-switch readiness.
- The confirmation contains a frozen agreement PDF with price, term, legal document bodies/version IDs, signing timestamp, withdrawal deadline, offer reference and signature hash.
- Email attachments are persisted in the durable outbox so retries send the same snapshot.
- Existing tenant email rules are no longer overwritten by default seeding. Delay and customer/admin recipient settings are enforced.
- API responses distinguish `queued`, `sent`, `skipped` and `failed`; an event name ending in `.sent` is not treated as delivery proof by itself.

## API changes

### Public offers

```http
GET /api/v1/website/public-contracts?customer_type=private&diagnostics=1
Authorization: Bearer <API_TOKEN>
```

A successful diagnostics response includes:

- authenticated `company_id` and API client ID;
- visible result count;
- one readiness result per candidate public offer;
- source of truth: `public_contract_offers`.

### Website agreement

`POST /api/v1/website/customer-applications` requires:

- exact `offer_reference`;
- all five separate consents;
- an `Idempotency-Key`;
- customer and site data required by the integration contract.

Relevant validation errors include:

- `offer_reference_required`
- `offer_reference_mismatch`
- `offer_legal_versions_missing`
- `offer_legal_versions_invalid`
- `offer_legal_version_mismatch`
- `legal_acceptance_missing`

The response exposes the signed agreement status, server `signed_at`, permanent withdrawal deadline, public offer identity and per-email `dispatch_status`.

## Required deployment order

1. Back up the production database.
2. Set and verify `WEBSITE_OFFER_REFERENCE_SECRET` in production. Do not rotate it without a transition plan for already issued references.
3. Apply `supabase/migrations/20260713203000_contract_api_visibility_signature_mail_hardening.sql`.
4. Confirm migration integrity with `npm run db:migrations:check`.
5. Deploy the application.
6. Confirm each tenant has an active API client with `website_contracts.read` and a verified sender configuration for legal email.
7. Update the external electricity-company website to use the exact `offer_reference` and the documented response fields.

## Required smoke test

1. Call public contracts with `diagnostics=1`; verify `result_count > 0` and no blockers for the selected offer.
2. Submit a new website agreement using the returned `offer_reference` and all five consents.
3. Verify `customer_contracts.status = signed`, server `signed_at`, `public_contract_offer_id`, `offer_reference`, five acceptance rows and `signature_snapshot_sha256`.
4. Log in as a tenant user with `contracts.read`; open `/admin/contracts` and the customer `?tab=contracts#contracts` page.
5. Verify the communication response says `queued` until the outbox worker sends the email.
6. Process the outbox and verify the confirmation becomes `sent`/`delivered` and contains the agreement PDF.
7. Open the customer portal and verify the same agreement identity and signature evidence are returned.

## Verification performed in this workspace

- Public API contract: passed (23 route files).
- Migration integrity: passed (258 files, 163 version groups).
- Full Vitest suite: 18 files, 136 tests passed.
- Test and script TypeScript projects: passed.
- Changed application-file TypeScript check: passed.
- Changed-file ESLint: 0 errors; existing unrelated warnings remain in large legacy files.
- Contract/API/signature/visibility regression: passed.
- Platform/tenant contract API/mail regression: passed.
- Website API/webhook regression: passed.
- Communication source-of-truth regression: passed.
- Final contract regression: passed.

The full Next.js webpack build did not emit an error, but did not finish the existing `Creating an optimized production build` phase within 20 minutes in the constrained workspace. It must therefore be run in CI/Vercel before production deployment and must not be reported as verified green from this workspace.
