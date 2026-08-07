# Executive summary

## Scope and conclusion

The review followed the chain:

`database -> RLS/grants -> functions/triggers/RPC -> server code -> API routes -> OpenAPI -> generated types -> client/UI -> integrations -> documentation -> CI/CD -> deployment evidence`.

The audit verified current GitHub `main` at `bb877506fb176d61095eb90e7af7df968e88f432` and the only connected Supabase project, `gridex-ops-dev`. Production and a separate staging database were unavailable and are not inferred from dev.

## Finding totals

| Severity | Total | Confirmed | Likely | Blocked/verification gap |
|---|---:|---:|---:|---:|
| Critical | 0 | 0 | 0 | 0 |
| High | 3 | 3 | 0 | 0 |
| Medium | 8 | 6 | 1 | 1 |
| Low | 2 | 1 | 1 | 0 |
| Informational | 2 | 2 | 0 | 0 |
| **Total** | **15** | **12** | **2** | **1** |

One inherited High finding, `GRIDEX-OPS-BL-002`, is code-remediated on `main` and verified in dev, but not production-closed.

## Stop-ship

| ID | Reason |
|---|---|
| `GRIDEX-AUD-001` | Cross-tenant read/write exposure in `storage.objects` for `customer-documents`. |
| `GRIDEX-AUD-002` | Quote hash can change solely because the same timestamp is serialized as `Z` versus `+00:00`, blocking customer applications. |
| `GRIDEX-AUD-003` | No complete, unified and checksum-verifiable database replay chain exists across repo ledger/manifest evidence. Do not make production schema changes until provenance is reconciled. |

## Positive controls verified

- 489 public tables; RLS enabled on all 489.
- 358 tables carry `company_id` or `tenant_id`; RLS enabled on all 358.
- 419 public tables expose grants to `anon` or `authenticated`; none lack RLS.
- 155 public views; 154 use `security_invoker`. The sole exception is service-role-only diagnostics.
- 507 functions; 299 are `SECURITY DEFINER`; none are executable by `anon`; all 11 authenticated-executable definers reviewed have pinned `search_path`.
- No current tenant-bearing table policy was found using an unscoped `auth.uid() IS NOT NULL` predicate.
- Latest dev migration is `20260806122255_gridex_ops_bl_002_global_read_isolation`, matching current `main`.
- OpenAPI `2026-08-05.2` current and immutable files/routes exist in the reviewed tree.
- Exact-head GitHub Actions run for current `main` succeeded for the checks present in the workflow.

## Material gaps

- Production database, separate staging database, Vercel configuration and deployed runtime parity were not accessible.
- Current CI does not run lint, production build, full test suite, script/test typechecks, OpenAPI release verification, generated-type consistency, SAST, history secret scan, bundle analysis or browser E2E.
- `main` is not protected.
- Full Git history secret scanning and deployment token/branch-protection policy were not verifiable.
- Browser performance, Core Web Vitals, bundle output, production p95/p99 and controlled load testing were unavailable.

## Immediate remediation order

1. Isolate the `customer-documents` bucket by company and customer ownership, with two-tenant negative tests.
2. Canonicalize every timestamp and nullable/case-insensitive field included in quote hashes; run live quote-create -> read -> validate -> application E2E.
3. Reconcile migration inventory, official ledger and canonical manifest; prove a clean rebuild in an isolated branch database.
4. Protect `main` and expand exact-head CI.
5. Repair EDIEL certificate cache fingerprint writes and add integration regression.
6. Fix OTP expiry and document log retention/redaction.
7. Profile the grid-owner view/RPC and geodata lifecycle before changing indexes.