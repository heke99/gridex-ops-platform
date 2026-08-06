# Error handling and observability

## Evidence

- Auth logs preserve request IDs, status, path, user identifier and timing.
- Auth logs also include full names, email addresses and IP addresses in clear structured fields.
- PostgreSQL logs include full statements for some migration/regression executions and recent constraint errors.
- A current EDIEL cache constraint failure is visible and actionable.
- API service log retrieval failed through the connector; API logging coverage is `NOT_VERIFIED`.
- Application/Vercel logs were not accessible.

## Findings

### PII and statement logging

Current platform logs contain personal identifiers. Full SQL logging can also capture fixture values or future production payloads. This is a privacy/incident-scope issue unless retention, redaction and access controls are formally defined and enforced.

### Request amplification

Auth logs show bursts of many `/user` calls within seconds from server/cloud addresses. This is likely repeated session resolution across server renders/routes, but no application trace was available. It is classified `LIKELY`, not confirmed root cause.

### Error contract risk

The quote integrity error is technically accurate from the current hash comparison but hides that serialization, not customer input, may be the cause. Public responses should remain generic enough for security while logs/events retain a stable error code, mismatch field set, request ID and safe diagnostic version.

## Required error model

Every public/internal operation should use:

- stable machine code;
- correct HTTP status;
- safe user message;
- request ID and correlation ID;
- retryability classification;
- idempotency key/reference where applicable;
- server-side root cause and stack trace only in restricted logs;
- explicit redaction of tokens, keys, person numbers, contacts, documents and raw provider payloads.

## Verification matrix

| Flow | Expected observability | Current status |
|---|---|---|
| Website quote/application | request/correlation/quote/application refs, safe mismatch codes | Partial; root-cause serialization bug confirmed |
| Customer portal sync | tenant/client/request refs, per-resource result and retryability | Source present; live logs not verified |
| EDIEL certificate refresh | job/actor/certificate refs, fingerprint derivation error, attempts | Constraint error visible; structured recovery not verified |
| Email outbox | company/run/message refs, provider result, no body/contact leakage | Not verified end-to-end |
| Webhooks | provider event ID, signature result, replay/idempotency result | Not verified end-to-end |
| RLS denial/security event | actor/company/object/action, no row payload | Dev SQL tests exist for inherited finding; application logs not verified |

## Remediation

Define a field-level logging standard, retention periods, access roles and incident export procedure. Redact/minimize at source, sample high-volume success logs, preserve security/error events, and add tests that assert secrets/PII do not appear in captured logs.