# Independent scoped review — fix round1

Reviewer: /root/retry_binding_review. Frozen range
32d441116db7a2d8051cf732e1d967bef4a98ea8..cd5fc33cfc8a5eb2a6c0930a58eb3f714695c539.
Supplied diff read once; focused frozen dependencies checked. No edits, test
reruns or hosted actions. SPEC: issues remain. QUALITY: needs fixes.

Prior findings: original syntax ADDRESSED by approved parentheses correction;
billing ownership/read-write race ADDRESSED in code by bound RPC and ownership
locks; requestScope null mismatch ADDRESSED by null-safe validator; actual E30
multi-value projection ADDRESSED in code/focused tests by per-quantity expansion
using normalized resolution. Native positive qualification remained pending at
handoff. Actual later native result is separately recorded in
retry-fix1-native-20260923.md and does not qualify the four blocked positives.

## Important new finding: existing billing period/currency equality

New forward20260923150649 lines210–221 looks up an existing billing underlay by
company and source, then compares attribution and total only. It does not compare
underlay_month, underlay_year or currency with the stored contract context,
although the subsequent INSERT derives those fields from that context.

Concrete path: insert bound underlay, stop before completion, authorized update
changes month/year/currency without changing attribution/total, retry validates
stored contracts/ownership but returns the altered underlay as success. The
schema does not make these fields immutable. Business integrity, not a claimed
public-client privilege escalation.

Required fix: compare immutable business fields represented by the frozen
billing projection, including period/currency, and retained contributor-contract
provenance where applicable. Legitimately mutable workflow status and audit
actor must not be required to equal creation values. Regression must mutate
each omitted field after insertion/completion gap and assert internal conflict,
no replacement write/completion; unchanged retry returns the same row.

Strengths: service-only writers independently load stored authority and reject
unequal expected contracts; ownership locks persist through writing, site order
is deterministic; source/raw/series equality retained; actual writer and lock
contention tests added; mixed-held behavior and internal-vs-national failures
preserved.

Local5939/364coverage,52/5focused,types/lint/migration/provenance/tenant receipts
were inspected as reported claims, not rerun. Remaining gates: repair finding,
actual native positive matrix, authentic artifact reconciliation, final same-head
whole-E035 review. This is not whole-task acceptance.
