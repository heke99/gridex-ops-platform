# Tenantservice P7–P8: threat model, ASVS 5.0.0 L2 matrix and rollout plan

Status: 2026-10-01. Evidence types: **T** = test in the repo, **S** = static code reading, **B** = blocked (live environment or external dependency).

## Threat model (STRIDE, tenant support and customer data)

| # | Threat | Asset / path | Control in this change | Status |
|---|---|---|---|---|
| T1 | Spoofing an end customer via the tenant API (identifier-only) | `/api/v1/customer/*` writes | Binding to an active portal account. `enforce` flag; the support API always enforces | T. Production default is `report` until clients are migrated |
| T2 | Spoofing via first link (customer number + e-mail) | `ensureCustomerPortalUserLink`, `customer-portal/sync` | Blocked/revoked links are not reactivated; identities are not repointed (409) | T. **Independent customer proof (signed, per-tenant JWKS) is open (P1c)** |
| T3 | Read with write side effect (link/reactivation) | `resolvePortalCustomer` | Read-only in `enforce`; `report` logs `portal_identity_would_reject` | T |
| T4 | Cross-tenant/cross-customer access to cases | support API, OPS case view | `tenantDb(companyId)` + customer filter on every query. The public reference grants no access; another customer gets 404 | T (unit + route). **B: live RLS** |
| T5 | Disclosure of internal notes and call logs | support API, DTOs | Fail-closed: public event type **and** `visibility='customer'`; explicit field lists; `assertPublicResponsePayload` | T |
| T6 | Repudiation (who changed what) | profile changes, support entries | `audit_logs` fail-closed with real actor (employee or portal account + API client); events with `created_by` | T/S |
| T7 | Tampering via replayed or conflicting request | API writes | `Idempotency-Key` with payload hash (409 on conflict); unique index for support cases (F9) | T. B: native replay of the index |
| T8 | DoS of the business (support case stops billing) | `createCustomerCase` | `operationalImpact: 'none'` (F16, main #428) | T |
| T9 | Tenant switched in another tab, then save | OPS forms | `expected_company_id` is validated server-side | T (static) |
| T10 | Mass reading/enumeration via the support API | list/detail | Cursor bound to tenant+customer+resource (AES-GCM); limit ≤100; existing rate limit class | S + T. Per-customer quotas: 50 new cases/24 h, 150 messages/h, `429 support_quota_exceeded` |
| T11 | Attachments (malware, SSRF) | – | No attachment endpoint is built. Unknown scan status is never approval | Not exposed |
| T12 | Vulnerable dependencies | next/nodemailer/imapflow | Upgraded (#427) | T (audit 0 high/critical) |

## ASVS 5.0.0 L2 (relevant chapters)

| Area | Requirement (summary) | Status |
|---|---|---|
| V1 Encoding/injection | Parameterised PostgREST queries; no SQL concatenation in new code | Met (S) |
| V2 Validation | Strict JSON parsing (256 KB), field limits, e-mail/phone validation on change | Met (T) |
| V4 API | Explicit scopes; closed response schemas; OpenAPI/runtime parity | Met (T, `api:docs`) |
| V6 Authentication | API key server-side; end customer via linked portal account | Partly met. Independent customer proof is open (P1c) |
| V8 Authorization | Tenant/customer/case bound at every lookup; `cases.write`/`masterdata.write` checked on the server | Met (T). B: live RLS/grants |
| V9 Self-contained tokens | Cursor signed/encrypted and bound to resource | Met (S) |
| V11 Business logic | Idempotency, version lock (409), status allowlist, no side effects from support | Met (T) |
| V12 Files | No attachments exposed | N/A until built |
| V14 Data protection | Diff-based audit (only changed fields); no staff identity in public payload | Met (T) |
| V16 Logging | `portal_identity_would_reject` structured without personal data (code, company, client) | Met (S) |

## Performance (P7)
- Support lists filter in the database (company, customer, `support_case`) before `limit`, and use keyset pagination.
- The invoice export loads customer billing fields in one batched `in()` per 200 customers (no N+1).
- **Baseline p50/p95 not measured.** Blocked: needs a running environment with representative data. No percentage improvements are claimed.

## Rollout plan (P8)

**Merging to main deploys to production** (`vercel-production-deploy.yml`). Defaults keep the current behaviour.

1. **Merge with defaults.** Nothing changes for existing tenant clients or billing. Active immediately:
   - support API (only for clients that are explicitly granted `customer_support.*`);
   - OPS case view and navigation;
   - customer card actions and grouping;
   - F9 index;
   - P1b/F5 guards.
2. **Measure identity.** Gather `portal_identity_would_reject` per API client for at least 7 days.
3. **Migrate tenant clients.**
   - Clients that write with only a customer number or e-mail must send the linked portal user (`x-gridex-customer-portal-user-id`).
   - First linking must go through `/api/v1/customer/sync`.
4. **Enforce identity.** Set `GRIDEX_PORTAL_IDENTITY_ENFORCEMENT=enforce`.
   - Rollback: set back to `report`. There is no data migration.
5. **Billing data.** Run the read-only query below.
   - Each customer is a separate decision: confirm an invoice e-mail or postal address.
   - Do not copy the contact e-mail automatically.
6. **Shared invoice delivery.** Set `GRIDEX_INVOICE_DELIVERY_RESOLVER=shared`.
   - Rollback: `legacy`.
   - Issued invoices and export items are never rewritten; their snapshot is locked at decision time.

```sql
-- Read-only: active contracts whose invoice e-mail today comes only from the contact e-mail.
select c.company_id, count(*) as customers
from public.customers c
where coalesce(nullif(trim(c.invoice_email), ''), null) is null
  and nullif(trim(c.email), '') is not null
  and not (nullif(trim(c.billing_street), '') is not null and nullif(trim(c.billing_postal_code), '') is not null and nullif(trim(c.billing_city), '') is not null)
group by c.company_id;
```

**Migration `20261001210000_customer_contact_change_transaction.sql` (P2b):**
- Adds `customers.invoice_email` only if missing (live databases already have it; clean replay did not). Adds the RPC. Deletes nothing.
- Rollback: `drop function public.gridex_customer_contact_change_v1(uuid,uuid,text,uuid,uuid,text,text,timestamptz,jsonb,jsonb,text)` and redeploy the previous app. Keep the column.
- Behaviour: OPS profile saves are authorized in the database by `masterdata.write` in the customer's company.

**F16 follow-up:**
- In `gridex-ops-dev`, 0 support cases had blocked customers (read-only check 2026-10-01).
- Production: the same query must run against the production database, which was not available in this session.

**Migration `20261001200000_support_case_idempotency_unique.sql`:**
- It is forward-only and deletes nothing. Duplicates keep their key under `support_idempotency_key_original`.
- Rollback: `drop index customer_cases_support_idempotency_key_uidx`. The metadata move is harmless to keep.

## Open (not done in this change)
- **P1c:** independent end-customer proof (per-tenant JWKS/OIDC, aud/iss/exp/jti). Needs a decision on which identity provider each tenant uses.
- Private attachments with quarantine and scanning.
- Browser verification (mobile/keyboard) and live RLS/grant verification. Both are blocked in this session.
