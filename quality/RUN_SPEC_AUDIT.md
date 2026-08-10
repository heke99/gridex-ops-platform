# Specification Audit Protocol: Gridex OPS remediation

## Inputs

Read the original 75-point specification, quality/REQUIREMENTS.md, quality/CONTRACTS.md, current OpenAPI/release artifacts, relevant routes/runtime modules, migration source and environment-labelled live evidence.

## Independent passes

Perform three sequential, independent audits and keep their notes separate: (1) public API/privacy/compatibility, (2) multi-tenant runtime/database/webhooks, and (3) release/operations/evidence. Do not reuse a conclusion without rechecking its cited source. The environment prohibits parallel agents, so independence is procedural rather than multi-model and this limitation must be recorded.

For every master point 1–75, record IMPLEMENTED, PARTIAL, VIOLATED, EXTERNAL BLOCKER or NOT ASSESSABLE with source/test/live evidence. Challenge both the specification and code: classify disagreements as real code bug, specification ambiguity, documentation drift, intentional design choice or unavailable environment evidence.

## Verification probes and triage

When review and audit disagree, isolate the exact factual claim, read the complete implementation path and run the smallest deterministic probe. Neither artifact wins by default. Confirmed code bugs require executable regression tests; overturned findings require removing or moving their stale regression tests.

Write individual pass files and quality/spec_audits/2026-08-10-triage.md. The triage must contain counts, all confirmed bugs with test references, all external blockers with required owner/system, and a point-by-point closure matrix.
