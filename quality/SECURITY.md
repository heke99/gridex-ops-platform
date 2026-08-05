# Gridex OPS — Security Review

## Scope and method

Reviewed exact-branch source for integration authentication, tenant context, service-role access, website intake, customer portal sync, billing/manual/Resend webhooks and analytics cron. Queried the live Supabase PostgreSQL catalog for RLS, grants, policies, function definitions and migration history.

Automated repository security scripts and dependency audit were not run because a clean checkout/dependency installation is unavailable.

## Assets

- Customer identity and contact data
- Personal/organization identifiers
- Facilities and metering points
- Contracts, prices and immutable snapshots
- Legal acceptances and powers of attorney
- Invoices and billing provider references
- EDIEL messages, certificates and routing state
- Tenant API keys and webhook secrets
- Audit/domain events and operational logs

## Actors

- Anonymous website/customer
- Authenticated customer
- Tenant administrator/operator
- Platform administrator
- External API client
- Billing/mail/EDIEL provider
- Scheduled worker/cron
- Service-role application process
- Malicious tenant or compromised credential

## Trust boundaries

1. Public internet to Next.js routes.
2. Browser session to tenant/user authorization.
3. External API key to tenant context.
4. Webhook signature to provider event processing.
5. Application/service role to PostgreSQL.
6. Tenant data to another tenant.
7. OPS to external market, mail, billing and EDIEL systems.

## Verified controls

- External tenant identity is derived from an authenticated API-client record.
- API clients are checked for status, expiry, scope, company status, IP/origin and atomic rate limit.
- Payload tenant claims are rejected/removed rather than trusted.
- Reviewed customer/portal queries include `company_id`.
- Public DTOs are explicitly serialized; reviewed website responses do not expose internal IDs.
- Current public tables found in `pg_catalog` have RLS enabled.
- `anon`/`authenticated` lack CREATE privilege in `public`.
- Reviewed security-definer helpers set constrained `search_path` and enforce session/membership or service-role semantics.
- Manual inbound and Resend webhooks authenticate before processing business effects.
- Billing webhooks use bounded bodies, timestamp windows, timing-safe HMAC and idempotent event persistence.
- Cron authentication fails closed and compares secrets timing-safely.

## Findings

### SEC-001 — Billing webhook reference oracle

See `BUG-002`. Unknown target and invalid signature produce distinguishable external response classes. No data access was demonstrated. Normalize external failures after provider compatibility review.

### SEC-002 — Leaked-password protection reported disabled

See `SEC-001` in `quality/BUGS.md`. This is an advisor finding that requires independent Supabase Auth configuration verification.

### SEC-003 — Full dependency/supply-chain audit blocked

`npm audit --omit=dev --audit-level=high` was not run. The dependency tree cannot be declared clean.

## Advisor discrepancies

Supabase advisor/list output included stale objects/policies that were absent from direct `pg_catalog` and `pg_policies` queries. Examples included an alleged hardcoded legal-override policy and service tables reported without RLS. These are not classified as live vulnerabilities.

Direct database catalogs are the evidence source for schema facts. Advisor discrepancies should be rechecked after advisor refresh.

## Threat assessment

| Threat | Assessment |
|---|---|
| Cross-tenant BOLA/IDOR | No verified bypass in reviewed core flows; broader repository-wide runtime tests remain blocked |
| Privilege escalation | No verified helper-function escalation; superadmin and all service-role callers still require complete audit |
| SQL injection | Supabase query builder used in reviewed paths; one dynamic `.or(...)` string uses normalized digits only |
| SSRF/path traversal | No verified instance in reviewed paths |
| XSS/CSRF | Not comprehensively verified; UI/session routes require targeted review |
| Webhook spoofing | Manual/Resend controls verified; billing has response-oracle concern but HMAC enforcement exists |
| Replay | Timestamp and idempotency controls found in reviewed webhook paths |
| Secret leakage | No secret returned in reviewed public responses; dependency/log scan incomplete |
| Rate limiting/enumeration | API-key rate limit fails closed; public/auth endpoints require broader runtime review |
| Audit attribution | Reviewed integration logging carries client/tenant/request metadata; complete actor-attribution review pending |

## Security verdict

No Critical or High vulnerability was verified in the reviewed paths. This does not establish production safety because full command execution, dependency audit, UI/session review, all service-role callers and deployment-dependent two-tenant tests are blocked.

Current security status: `READY_FOR_FURTHER_TESTING`, not production-ready.
