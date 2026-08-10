# Gridex OPS — canonical architecture closure report

Date: 2026-08-10  
Repository: `heke99/gridex-ops-platform`  
Pull request: #105  
Decision: **release candidate; merge only after the post-review hosted gates are green**

## Outcome

The 57-point canonical architecture remediation is implemented in the existing platform. The work consolidates tenant access, lifecycle, provisioning, invitation delivery, application repair, reconciliation, release evidence and performance budgets behind canonical, fail-closed boundaries. No parallel platform was introduced.

The original uploaded archive was confirmed to match `main@e8586c1ba112213a0f11da16ee3a5ae15386dc69`. Seven previously deployed migrations were recovered exactly from the connected database and checksum-pinned. Four forward migrations complete the architecture and review hotfixes:

- `20260810213851_canonical_architecture_completion_v2.sql`
- `20260810214927_canonical_architecture_completion_fk_indexes.sql`
- `20260810221500_canonical_invitation_delivery_hotfix.sql`
- `20260810224500_canonical_review_remediation_v1.sql`

## Closure evidence

| Control family | Result |
|---|---|
| Request-scoped authorization | One call to `canonical_authenticated_tenant_context`; split legacy role/permission reads removed; failures deny access. |
| Tenant lifecycle | Admin changes use `canonical_transition_tenant_lifecycle`; the revoked legacy transition is no longer called. |
| Provisioning | Durable jobs use lease claim/completion RPCs, bounded retries and a secured scheduled worker. |
| Invitation integrity | Durable intent commits before external effects; the leased worker is the sole provider-delivery owner; token hashing resolves Supabase's `extensions` schema. |
| Authentication | The competing callback acceptance path is removed; access is created only after verified invitation acceptance. |
| Website applications | Missing workflows are classified and queued for repair; no application remains stranded without an explicit repair state. |
| Reconciliation | Daily fail-closed reconciliation reports query errors as failures instead of treating them as zero. |
| Release identity | `platform_release_receipts` records Git, CI, deployment, environment and schema identity. |
| Performance | Versioned platform performance budgets are database-backed and release-auditable. |
| Migration truth | Historical applied files are immutable, checksums are pinned, generated types are pinned and clean replay is a required hosted job. |
| Regression boundary | `gridex-canonical-architecture-57-point-regression.cjs` and the mechanical verifier lock the canonical paths. |

## Connected database evidence

Connected project: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`).

Latest source migration: `20260810224500_canonical_review_remediation_v1.sql`.

Post-migration invariants:

- memberships without a role: 0
- active clients on non-ready tenants: 0
- due stranded outbox records: 0
- manual reviews over SLA: 0
- applications without repair classification: 0
- reconciliation check errors: 0
- one historical application is explicitly `awaiting_input` with owner, reason and SLA because its legacy payload lacks authoritative API-client and portal identities

The historical application was not fabricated or silently marked repaired.

## Hosted verification

The pre-review-fix candidate passed all three required GitHub jobs in run `31435653056`:

- clean migration replay, exact ledger and schema fingerprint
- verify: migration integrity, memory/provenance, typecheck, regressions and security
- quality release gates: lint, mechanical checks, application/quality tests, API/OpenAPI/RBAC and production build

Code review produced a second remediation pass covering lifecycle version/idempotency guards, multi-company permission aggregation, private credential comparison with secret-free public RPC results, worker lease recovery, audited offboarding, truthful repair jobs and bounded six-check reconciliation. Hosted run `31437386052` passed verify and clean replay on that implementation; the final branch head must still pass every required job before merge.

## External configuration truth

Only the dev Supabase project is exposed through the connected account; a separate staging/production database cannot be compared here. Supabase Auth leaked-password protection is a hosted Auth setting and no connected management action is exposed for changing it. These are environment/configuration controls, not unimplemented application paths, and must not be represented as verified without their authoritative systems.

## Release rule

Merge only when the final PR head is review-clean and every required hosted job passes. After merge, verify that Vercel production is READY for the exact merged SHA, smoke the deployed URL, check runtime errors, and write the release receipt with that same SHA.
