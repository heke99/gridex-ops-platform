# Database replay gate candidate — 13 September 2026

Status: PARTIAL. Local patch only; NOT pushed, merged, deployed or certified as a complete replay.

## Exact source and attribution

Base commit: `22c923bb59cda3dbf933002b0f05c2b136c99a2f`.
Base tree: `4771786b79dbde13b298ad18648b50cfdbfc8a20`.
The GitHub Actions source export was checksum verified: tar SHA256
`a7f09dbdf7f8b56be21e94d85c812d4b175fe411f4a9db5b3b3c75d9fb40f79a`.

While the local work was in progress, a separate published commit integrated the
seven pinned residual migrations into the shared foundation controller. That
integration is retained byte-for-byte. An overlapping local scheduler was discarded;
it is NOT included in this patch and is NOT claimed as newly delivered work.

Existing native evidence: run34762374742 / job103737335752, head22c923bb,
completed successfully at 2026-09-13T14:25:58Z. Source transformation controls,
selected continuation, full foundation with repository originals absent, and exact
owned cleanup passed. Read through the GitHub connector:
https://github.com/heke99/gridex-ops-platform/actions/runs/34762374742/job/103737335752
This evidence predates this patch. It is not verification of its new gate or full
canonical source-effect, ordinary CLI, ledger, RLS or generated-type acceptance.

## Changes made locally

1. Preserve the existing 18 final replay SQL predicates, but require their result
   to be one bounded JSON object with exactly the known keys and each value true.
   False, NULL, incomplete/invalid/duplicate responses and boolean lookalikes fail.
   The real shell pipeline retains `set -euo pipefail`; a SQL error cannot be
   masked even by valid-looking result JSON. Raw responses are not logged.
2. Bind the timestamp runner to the real modified replay-shell SHA256
   `ba9412f8b2f76604549ee8b49ce0ada6cfcf3ef4e856bad0f0e1a7a33292e513`.
   This is a code-integrity pin, not a refreshed schema or type acceptance manifest.
3. Add the 12-case gate regression suite to OPS hardening. Preserve the published
   residual integration, existing negative controls and diagnostic workflows.
4. Correct stale current-state/checkpoint documentation and restore the exact,
   truthful accounting summaries required by the existing membership selftest.
   The selftest itself is not weakened or modified. The remote PR body is not edited.

## Executed verification on this candidate

156 enumerated unit/regression tests passed, plus the complete membership
selftest program (which reports PASS but does not expose an enumerated case count).
These are 11 successful suites, not 11 native database suites.

| Suite | Result | Enumerated tests |
| --- | --- | --- |
| `gridex-replay-required-checks-selftest.py` | PASS / exit 0 | 12 |
| `gridex-aud-003-clean-replay-selftest.py` | PASS / exit 0 | 20 |
| `canonical-residual-integration-selftest.py` | PASS / exit 0 | 11 |
| `canonical-residual-transition-selftest.py` | PASS / exit 0 | 12 |
| `canonical-db2-reconstruction-selftest.py` | PASS / exit 0 | 6 |
| `canonical-timestamp-frontier-selftest.py` | PASS / exit 0 | 13 |
| `canonical-timestamp-source-selftest.py` | PASS / exit 0 | 9 |
| `canonical-residual-source-selftest.py` | PASS / exit 0 | 19 |
| `canonical-auth-membership-group-selftest.py` | PASS / exit 0 | full script; no case count reported |
| `gridex-replay-input-accounting-selftest.py` | PASS / exit 0 | 38 |
| `gridex-replay-review-groups-selftest.py` | PASS / exit 0 | 16 |

`bash -n scripts/gridex-aud-003-clean-replay.sh` and `git diff --check` passed.
An additional before/after reproduction using the actual old/new shell blocks and
a transport double proves: false and NULL continued before; both stop with exit1
after; all-true still continues. The 18 underlying SQL expressions are byte-identical.
The new tests use a transport double and do not simulate PostgreSQL semantics.

## Gates still blocking

| Gate | Observed candidate result | Meaning |
| --- | --- | --- |
| Ordinary clean replay | exit1: unsupported replay target | Normal CLI/native lifecycle is not admitted. |
| Full-effects accounting | exit1, UNCLASSIFIED_INPUTS; no input-contract errors | 600 inputs: 588 selected, 2 substituted, 5 unclassified, 5 explicitly excluded. |
| Generated types | exit1: migration tail changed | `20260911114443_canonical_user_rbac_customer_alignment_boundary.sql` is not certified in the existing type manifest. |

Input selection is not proof of complete or surviving migration effects. The
seven entries are not declared closed merely because native selected-chain
execution passed. The focused group remains346/334 selected/2 substituted/
5 unclassified/5 excluded. No manifest was altered to hide these gates.

## Preserved work and operational limits

All existing source files were compared against the source export. Historical
Supabase SQL, generated types, type/migration manifests, app/API code and the paused
partner-price patch remain unchanged. No production SQL, production customer data,
main merge or deployment was performed. The source-retaining residual controller
from22c923bb is unmodified by this patch.

The available GitHub connector actions are read-only. No authenticated CLI write
path, Docker, psql or PostgreSQL executable was available in this runtime. Therefore
this patch could be created and locally tested, but not pushed, merged, natively
rerun or used for certified type regeneration here.

Next required engineering work: review/publish this gate patch; reconcile full
source-effect accounting using the new staged evidence; finish supported ordinary
replay and ledger provenance; only then regenerate schema/types, rerun the full
CI/RLS/integration suites, clean temporary diagnostics, update the remote PR summary
and consider merge. Keep all release gates blocking until that evidence exists.

## Verification methods

Activated project practices: systematic debugging, test-driven regression,
verification before completion, PostgreSQL/Supabase security-preservation review.
No app/UI, deployment, managed data or billing behavior was modified. No independent
security review, full production-parity acceptance or dependency remediation is claimed.

The companion delivery contains raw local logs, test-results.json,
blocking-gates.json, boolean-before-after.json and source-preservation.json.
