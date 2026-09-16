# Native bootstrap and historical ACL fixture receipt — 2026-09-14

Status: PARTIAL. Published to PR310. No main merge, hosted database write,
production deployment, acceptance-baseline change or generated-type refresh.
This receipt supersedes the pending-native wording of DB_NATIVE_BOOTSTRAP_2026-09-14.md.

## Verified native correction

Code c8c3ac5a45895909b539a942679356fddd8ca72c; native lifecycle run34831307938,
job103935045832: SUCCESS. Receipt artifact10342128418 ZIP SHA256:
9ab16dd436658d6f6eebce40c8f9ef00d982012c0ef437ba6fcd349524e814fc.
Official CLI2.101.0 started its own empty unlinked PostgreSQL17.6.1.106 instance.
The complete corrected portable bootstrap matches all48 native table, sequence
and function privilege checks. The exact old bootstrap is a negative control:
it lacks33 client/service table/sequence privileges and has no other difference.
RLS, forced RLS, function security mode and PUBLIC execution are also compared.
Native probe removal, separate vanilla-runtime disposal, the parent native
resources and private workspace cleanup are verified. A real synthetic CLI
migration, idempotent repeat and failed-migration rollback/unchanged ledger pass.

The ordinary historical Gridex chain has NOT been executed by that synthetic
CLI proof. Its report truthfully retains fullReplayAccepted=false,
generatedTypesVerified=false and historicalGridexSourcesExecuted=false.

## Full selected history comparison

Code12ad2b2b9c55aec0160973b470f76fba1c063442; run34830200878,
artifact10341619615. ZIP SHA256:
b2f62de688da891b100f4df4d862229dcebab43350afaa1bb3286f5fa265f25a.
The actual owned shell executes144 foundation and514 timestamp stages, with
privacy, original restoration and disposal verified. The committed reference
is unchanged. Missing reference identities fall as follows:

| Section | Earlier dd0e70a | Correct native defaults |
| --- | ---: | ---: |
| Relation grants | 7761 | 24 |
| Policies | 1886 | 59 |
| Constraints | 38 | 11 |

Added/changed entries and every other comparison section remain visible.
These counts measure identities, not proven runtime vulnerabilities. Full
semantic parity and the unchanged final fingerprint still fail. No observed
result was copied into an expected fingerprint to manufacture equality.

## Correct historical fixture assumptions

Published code ce0bb1b3d24ddaef5024d6fdf04e6a74ec480ebe.
Publication run34833507044: SUCCESS, exact source-tree projection
3466a680ed71e99f9e4cef9ecb4ffc6d8cd8d1df.
Four modified test files and one new regression file; historical migrations
and actual application/authorization functions are unchanged.

- RBAC journal preservation compares both complete metadata sets before/after,
  including owner, ACL, options and RLS flags. It no longer falsely requires a
  NULL ACL. A native rollback-only SELECT revocation must be detected, followed
  by exact restoration. This also corrects the reused downstream legacy check.
- Operations source characterization verifies real initial SELECT grants,
  explicit rollback-only ACL denial and actual anon/authenticated/service-role
  row visibility without granting access during positive tests. Journal
  constraints, orphan rejection, rollback and exact metadata/row preservation
  remain required.
- Readiness source characterization does not pretend that the historical owner-
  context views deny clients. Synthetic branches require the actual original
  client-visible results, and rollback-only revocations test ACL denials. The
  report explicitly marks finalAccessSecurityAccepted=false. This is evidence
  of intermediate history, not a security waiver for the completed system.

Offline:5 real-method regression tests (including denied/missing/incorrect-result
controls),9 operations constructors,10 readiness constructors and the601-file
immutable migration integrity check pass. The focused journal static contract
also passes. The full local aggregate exceeded the execution limit; no local
aggregate pass is claimed. Native OPS reruns are still required for this code.
Permanent read-only fixture CI is installed and both temporary publisher files
are removed from the final branch tree.

## Read-only hosted cross-check

Project piidsfebjqjmnepdpnas was inspected, never mutated. Both
billing_readiness_flags and gridex_tenant_runtime_readiness currently have
security_invoker=true; anon SELECT is false, authenticated/service SELECT true.
customer_lifecycle_events has RLS enabled and anon SELECT false. This catalog
observation is not an end-to-end tenant row-access test. The live ledger still
has279 rows, latest20260904222450. No historical rows were marked applied.

## Remaining release work

1. The supported ordinary native Supabase historical replay path remains
   unimplemented: OPS clean-migration-replay still rejects its unsupported
   direct start. Synthetic lifecycle proof must not be relabelled as history.
2. Reconcile all remaining full-schema differences against independent source
   authority, including complete RLS, policies, keys, indexes and functions.
3. Generate types only from the accepted schema/lifecycle, pass every mandatory
   OPS/E2E check and independently review before merging the exact green head.

Main/release and plan points85/86 are not accepted. Preserve the legitimate
seven companies fields and the white-label relationship; preserve the existing
application work and paused partner/API patch.
