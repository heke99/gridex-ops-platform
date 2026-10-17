# Tenant invitation delivery — independent Staff onboarding

This is the existing OPS worker contract implemented by `lib/auth/tenantStaffDelivery.ts`. It complements [independent onboarding](independent-onboarding.md) and the separate `2026-10-05.2` OPS onboarding API. The endpoint below belongs to the tenant backend and must be implemented before real invitation delivery. These requirements do not certify a deployed tenant endpoint.

## Registration and signing direction

The authorized operator registers the exact tenant origin, tenant Auth project and Staff client in OPS. The client's `metadata.staff_tenant_delivery` contains:

| Field | Contract |
| --- | --- |
| `url` | Exactly `<registered staff_onboarding_origin>/api/internal/staff/invitations/deliver`; also the delivery audience |
| `audience` | Exactly `url` |
| `issuer` | Registered HTTPS delivery issuer, without whitespace, query or fragment |
| `key_id` | 1–128 letters, digits, underscores, dots or hyphens |
| `request_public_jwk` | RSA public JWK, at least 2048 bits, with `kid=key_id`; no private key fields |

OPS holds the matching RSA private key in server-only `GRIDEX_STAFF_DELIVERY_PRIVATE_KEY`. It checks key capability before creating a durable invitation intent. The tenant validates incoming delivery signatures with the registered **OPS request public key**. It signs outgoing receipts with its own private key, whose public JWK is registered in the active Staff `tenant_key` provider. These signing directions, issuers and audiences are distinct. Keep all private keys and machine credentials off the browser.

## Delivery request

OPS POSTs to the exact registered endpoint with redirects refused, a ten-second timeout, `Content-Type: application/json` and `Idempotency-Key: <delivery_id>`. The body is:

```json
{"assertion":"<OPS-signed compact JWS>"}
```

The JWS header has `alg=RS256`, `typ=JWT`, and the registered request-key `kid`. Claims contain:

| Claim | Meaning |
| --- | --- |
| `iss`, `aud` | Registered delivery issuer and audience |
| `sub` | `invitation_id` |
| `token_use` | `staff_invitation_delivery` |
| `iat`, `exp`, `jti` | Integer issued-at, expiry 60 seconds later, fresh UUID |
| `delivery_id`, `company_id`, `api_client_id`, `provider_id`, `invitation_id` | Original OPS authority and delivery identities |
| `actor_user_id` | OPS non-login compatibility actor; distinct from the tenant Auth user |
| `recipient_email`, `full_name` | Invitation recipient and nullable name |
| `auth_issuer` | Registered tenant Auth issuer |
| `callback_url` | Tenant-origin `/auth/invitation?token=<invitation UUID>`; no fragment or other query parameters |
| `request_hash` | Original 64-character lowercase hexadecimal request fingerprint |

Verify signature, key, issuer, audience, expiry, purpose and original tenant/client authority before any Auth or e-mail effect. Bind the header's delivery ID to the signed `delivery_id`. A different request fingerprint or authority tuple for an already claimed delivery ID is a conflict, not a new invitation.

## Durable delivery and retries

Commit the private tenant delivery claim before calling Auth or the e-mail provider. Establish the existing explicitly authorized recipient's local Auth identity without granting OPS roles locally. Store the original authority, request fingerprint and completed local subject durably.

A completed retry uses stored delivery facts and returns a freshly signed receipt with new `iat`, `exp` and `jti`; it must not resend the invitation. A started delivery whose provider outcome is unknown is indeterminate. Refuse automatic resend and require a trusted operator to reconcile the original delivery with actual provider evidence. Configure the tenant callback and SMTP separately; origin registration alone does not enable either.

## Successful receipt

Return HTTP `200`, JSON content type, and exactly:

```json
{"receipt":"<tenant-signed compact JWS>"}
```

OPS accepts at most 24,576 response bytes and 16,384 receipt characters. Extra response fields or an unsigned success response are rejected. Sign with the tenant Staff provider's registered key and matching issuer/audience; supported verifier algorithms are RS256, PS256 and ES256 with the matching public-key type. Receipt claims must contain **exactly** these fields:

```text
api_client_id, aud, auth_issuer, company_id, delivery_id, email, exp, iat,
invitation_id, iss, jti, local_auth_subject, provider_id, request_hash,
status, sub, token_use
```

Set `token_use=staff_invitation_delivery_receipt`, `status=sent`, and `sub=local_auth_subject`, a valid tenant Auth UUID distinct from `actor_user_id`. The proof lifetime is at most 60 seconds, with current issued-at/expiry and a fresh unused `jti`. `email` must equal the original `recipient_email`; `auth_issuer` must equal the original tenant Auth issuer. Copy `request_hash`, `company_id`, `api_client_id`, `provider_id`, `invitation_id` and `delivery_id` exactly from the signed original request and stored delivery record. Do not add `actor_user_id`, `full_name` or callback fields to the closed receipt.

OPS verifies and consumes the receipt proof, then records the exact original delivery through the canonical native engine. A receipt or provider call alone does not establish completed OPS recording. Enrollment completes through explicit invitation acceptance; returning a delivery receipt does not create an employee login session or grant implicit administrator access.
