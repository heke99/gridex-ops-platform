# Gridex OPS — Security Review

## Verdict

`READY_FOR_FURTHER_TESTING`, not production-certified.

No Critical or High vulnerability was verified in the reviewed source paths, direct Supabase catalog checks or executed CI controls. This does not establish repository-wide absence because deployed two-tenant/provider/EDIEL tests, complete service-role call-site review, SAST, history secret scanning and browser testing remain incomplete.

## Assets and trust boundaries

Critical assets:

- tenant/customer/contract/billing data;
- legal evidence and powers of attorney;
- API-client credentials and scopes;
- Supabase service credentials;
- email/EDIEL/provider secrets;
- immutable OpenAPI and contract releases;
- audit/event/actor records.

Primary boundaries:

- browser/user session → Next.js server;
- tenant API client → integration routes;
- cron scheduler → internal automation routes;
- provider/webhook sender → webhook routes;
- server/service role → Supabase/PostgreSQL;
- tenant/company boundary enforced by server context and RLS.

## Authentication and authorization

Verified in reviewed paths:

- integration tenant/company identity is loaded from the authenticated API client, not trusted request fields;
- client status, tenant status, scopes, origin/IP and rate limits fail closed;
- scheduled-request secrets are compared timing-safely and no configured accepted secret means unauthorized;
- Customer Portal candidate and write paths include authenticated company scope;
- manual inbound and Resend webhook signatures are checked before event processing;
- UI visibility was not accepted as authorization evidence.

No cross-tenant read/write was reproduced.

## Direct Supabase catalog verification

Fresh V3 catalog inspection covered these `SECURITY DEFINER` helpers:

- `anonymize_user_account`
- `gridex_can_read_company`
- `gridex_can_write_company`
- `gridex_contract_platform_readiness`
- `gridex_current_user_context`
- `gridex_is_current_session_allowed`
- `gridex_portfolio_actor_has_permission`
- `gridex_required_legal_modules`
- `gridex_user_company_ids`
- `gridex_user_is_platform_admin`

Observed:

- constrained `search_path` configuration (`public, auth, pg_temp`);
- no `anon` execute privilege;
- `authenticated`/`service_role` access where expected;
- explicit session, membership, permission, admin or service-role checks;
- no verified cross-tenant bypass.

Supabase advisor search-path warnings were not treated as authoritative when contradicted by direct current catalog definitions.

Advisor notices about RLS-enabled tables without policies were also not automatically classified as vulnerabilities. A table with RLS and no policy can intentionally deny all client-role access; grants and actual call paths must be established first.

## Security findings

### SEC-001 — Leaked-password protection

- Severity: `Medium`
- Status: `unverified`
- Evidence: Supabase advisor reports the protection disabled; repository checklist requires it before go-live.
- Blocker: current tools cannot independently read/change the Auth dashboard setting.
- Next step: authorized administrator verifies/enables it and performs a safe non-production test.

### Billing webhook response distinction

Tracked as `BUG-002`, `Medium`, `unverified`.

Source review indicates unknown provider references and bad signatures for known references may produce distinguishable status classes. No data bypass was reproduced. Provider retry semantics must be verified before normalization.

## Error and data-leak controls

Verified patterns:

- unexpected API faults receive generic client messages;
- stable codes and request IDs support diagnosis;
- controlled input errors retain safe 4xx details;
- no audit-added secret or raw credential was committed;
- API/public DTO tests assert internal IDs do not leak;
- immutable legal/publication evidence requires hashes for modern snapshots.

The expanded V3 test run exposed stale test fixtures that attempted unhashed modern legal modules. The tests were corrected; production validation was not weakened.

## Supply-chain and secrets

Covered in `quality/DEPENDENCY_SECURITY.md`.

Current remaining gaps:

- GitHub Dependabot alert access returned 403/unavailable;
- no repository-approved SAST run;
- no complete current-tree and full-history secret scan;
- GitHub Actions still use mutable major action tags;
- external deployment/provider credentials were not inspected.

The repository's production security audit script is included in the expanded CI matrix, but it does not replace SAST or full secret-history scanning.

## Threats reviewed

| Threat | Result |
|---|---|
| BOLA/IDOR/cross-tenant access | no verified exploit in reviewed paths; live two-tenant E2E blocked |
| Privilege escalation | no verified route/helper bypass; complete call-site coverage incomplete |
| SQL injection | no verified raw-input injection path in reviewed critical areas |
| SSRF/path traversal/file upload | not exhaustively cleared repository-wide; no verified critical path found |
| Webhook spoof/replay | inspected paths use signatures/timestamps; provider matrix incomplete |
| Secrets/client exposure | no new exposure verified; deployed configuration/history scan blocked |
| Error leakage | controlled/generic envelope patterns verified; portal error bug fixed |
| Contract tampering | immutable release and legal hashes enforced; missing release material fixed |
| Denial of service | payload/rate-limit controls exist in reviewed APIs; load testing blocked |

## Required security validation

1. Run repository-approved SAST and full current-tree/history secret scanning.
2. Verify Supabase leaked-password protection.
3. Execute two-tenant negative tests across API, database, storage, exports, documents, jobs and notifications.
4. Exercise API-client revocation, disabled tenant/client and stale session cases.
5. Validate provider/webhook replay, duplicate, invalid-signature and retry behavior.
6. Audit all service-role call sites and storage paths.
7. Confirm deployed logs redact PII/secrets and retention is approved.

## Readiness impact

Security does not justify staging or production approval by itself. It supports further controlled testing only.
