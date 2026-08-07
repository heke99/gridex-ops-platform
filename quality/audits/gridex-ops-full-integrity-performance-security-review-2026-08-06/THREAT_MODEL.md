# Threat model

## Assets

Customer identity/contact data, metering points and consumption; contracts/quotes/pricing/legal evidence; powers of attorney and customer documents; company/API keys and tenant configuration; EDIEL actors/routes/certificates; financial/billing data; audit logs; platform-admin and service-role authority.

## Trust boundaries

1. Browser/customer/tenant website -> public API.
2. Authenticated user -> company-scoped server/RLS.
3. API client key -> company/integration scope.
4. Next.js server -> Supabase service role.
5. Worker/cron/webhook -> queue/RPC/external provider.
6. Storage object path -> company/customer ownership.
7. Repository/CI -> deployment -> database migration.

## Priority threats

| Threat | Entry/path | Current control | Gap | Risk | Required mitigation/test |
|---|---|---|---|---|---|
| Cross-tenant document IDOR | Direct/listed `storage.objects` path | Bucket + global permission | No company/path ownership check | High | Company path parser + active company/permission + two-tenant CRUD tests. |
| Quote tampering false positive | DB timestamp serialization | SHA hash and validation | Incomplete canonicalization | High availability/integrity | Canonical payload function and round-trip E2E. |
| Unauthorized platform data read | Authenticated RLS | Platform-admin helper/service policies | Production apply unverified | High inherited | Production policy inspection and role matrix. |
| Privilege escalation | `SECURITY DEFINER`/RPC | Pinned path, self/company checks | 299 definers require continuous inventory | Medium | Deny-by-default grants, function contract tests, diff gate. |
| Service-role exposure | Client bundle/env/log | Server env modules | Vercel/current-history scan unavailable | Critical potential | Secret/history scan, bundle scan, rotation procedure. |
| Webhook replay/forgery | Provider callback | Provider-specific handlers | Full signature/idempotency E2E unverified | High potential | Signed raw-body verification, timestamp window, replay key. |
| Duplicate customer/application | Retry/race | Idempotency/status logic | Concurrency load proof unavailable | High integrity | Parallel same/different tenant key tests and unique constraints. |
| Unsafe schema deploy | Migration tooling | repo checks + ledger/manifest | Incomplete unified replay/provenance | High operational | Immutable inventory, clean branch replay, forward-fix plan. |
| Sensitive logging | Auth/database/application logs | Restricted platform logs assumed | Names/email/IP/full SQL visible; retention not evidenced | Medium privacy | Redaction, minimization, retention and access audit. |
| Resource exhaustion | Quote/application/geodata/admin views | rate limits/bounds vary | 2.5 GB staging table and slow view/RPC | Medium | Request limits, job batching, query plans, capacity tests. |
| Supply-chain compromise | npm/GitHub Actions | lockfile, production audit | no SAST/history secret/full workflow gate | Medium | pin actions, least permissions, full security gates. |

## Abuse cases

- A company-A operator with `masterdata.read` lists or overwrites company-B customer documents.
- An attacker replays a still-valid email OTP after mailbox compromise.
- A retry arrives while application side effects are partly complete and creates duplicate or inconsistent rows.
- A malicious tenant supplies another tenant's contract/quote/application reference.
- A forged webhook drives a status transition twice.
- A direct push deploys code without build/full tests/OpenAPI/type checks.

## Security invariants

Every tenant-owned row/object must prove company ownership at the final enforcement layer; every privileged function must authenticate the actor and target; every external state transition must be authenticated, idempotent and auditable; every schema/API release must be reproducible from immutable source.