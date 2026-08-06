# Supabase Security Advisor

Project checked: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`). Production and separate staging were unavailable.

## Raw result normalization

The advisor returned five duplicate warning entries representing one configuration issue: email OTP expiry is `86400` seconds, above the recommended threshold of one hour.

| Advisor issue | Raw rows | Current verification | Classification | Severity | Affected users | Remediation |
|---|---:|---|---|---|---|---|
| OTP expiry exceeds recommended duration | 5 duplicates | Advisor current signal; setting value reported as 86,400 seconds | Confirmed misconfiguration | Medium | Email OTP/login/reset users | Reduce to <=3,600 seconds in non-production, test complete auth flows, then controlled production change. |

Reference: Supabase production security guidance linked by the advisor.

## Exploitation/failure path

An intercepted or exposed OTP remains valid for up to 24 hours, materially extending replay opportunity compared with a one-hour window. Actual exploitability depends on delivery-channel compromise, rate limiting and whether the token has already been consumed.

## Tests

- Negative: an OTP older than configured limit must be rejected without revealing account existence.
- Positive: a fresh OTP must work once; reuse must fail.
- Regression: signup, login, password reset, email change and invitation flows.

## Advisor findings verified as stale or superseded

Security/performance advisor outputs also referenced broad policies on objects that are absent or were replaced in current catalog, including `application_staging`, `integration_inbox` and `integration_outbox` examples. Direct catalog inspection is authoritative for current classification.

## Additional checks not supplied by advisor

- Leaked-password protection setting: `NOT_VERIFIED`.
- MFA enforcement for privileged roles: `NOT_VERIFIED`.
- Auth rate-limit configuration: `NOT_VERIFIED`.
- Production Auth configuration: `NOT_VERIFIED`.
- Storage cross-tenant exposure: found by direct policy review, not advisor.

No advisor item was copied directly into the findings register without current validation.