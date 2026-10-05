# F1-A: selected source identity at the activation-evidence boundary

Base main: `de098106c26d90069758cf1f753a94b073789ef2`.
Independent branch: `codex/ediel-v2-f1-source-integrity-20260916`.
Qualified code commit: `66d51ec087e8855e1c672c09e13764f6c008d921`.
Code tree: `f851b9dd04c4e0b784ed2d131d66f4b37b5551f5`.
PR310 is paused; see `pr310-paused-resume.md`.
This is a bounded F1/section3.4 continuation, NOT completion of F1, the masterplan or release.

## Findings reproduced on pristine main

F1-A01: `resolveCanonicalRulePack` bootstrapped every family as outbound without the
already selected Application Reference. Actual E66 policy rejects this before the
RPC despite valid inbound context. Both real callers already held the reference
but did not forward it. Inbound single-valued S02 instead silently inferred one.

F1-A02: evidence comparison accepted any match of DB guideVersion/guideRevision
against the source guide or shared association. Real S02 resolution accepted
25-A-3/revision4 or E5SE5A as a version, then overwrote canonical metadata. Conflicting
profile version/revision fields were not checked. This is evidence misbinding,
not a demonstrated cross-tenant exploit or a new normative certification finding.

## Correction and unchanged boundaries

UTILTS retains explicit Application Reference and optional request target with its
actual direction. Both existing runtime/validator callers forward the selected
policy reference. PRODAT's established source fallback remains unchanged.
Require complete UTILTS guide version AND numeric revision in row and profile.
The existing `20260813120500_ediel_utilts_25a3_semantics_alignment.sql` already defines
that row/profile contract. Shared E5SE5A is not a revision identity.

No new RPC arguments, SQL, permission/grant, guide date, source-document hash,
wire field, activation bypass, migration, schema, type or PR310 dependency added.
Wrong evidence, missing reference and incomplete readiness remain blocking.
No hosted database mutation, production deployment or external message was performed.

## Executed verification

Run https://github.com/heke99/gridex-ops-platform/actions/runs/35133517653 succeeded.
Artifact10462311090 SHA256 `8fbfda03a3788f8b070db46768afb7077bf9ad0dac08ff86979e1c89b12b20a9`.
Its tested five-file tree was published intact to the independent branch.

- Same23 source tests on pristine main:14 failed,9 passed; corrected source23 passed.
  Real Ediel modules run under Node22; only the RPC is synthetic. Type stripping is not typechecking.
- Real runtime/public-validator integration and retained regressions:62 passed in7 files,
  including four new caller cases around opposite document/receipt dates.
- Complete Vitest:201 files/1220 tests passed (baseline1216).
- Application and tests TypeScript:passed. Changed TypeScript ESLint:zero errors.
  Existing config ignores the CJS harness (one warning); no CJS lint coverage asserted.
- Immutable package:33 files/121 rules/231 contracts preserved. This is integrity, not conformity.

Systematic debugging, TDD, source/spec review and verification-before-completion
were applied. No independent reviewer is asserted. Local npm cache was incomplete;
locked dependency-backed tests ran on GitHub without altering package files.

## Remaining work

Normal PR CI/build after documentation/persistent-workflow additions remains required;
this note does not pre-approve it. Then continue F1 source-hash/provenance and
missing-profile review, or independent F3 locator/field checks. G01–G07 remain open.
No F0/F2/F7 or whole-masterplan completion is claimed. Existing certified strings
are not new proof. Historical progress records are archived byte-for-byte to avoid
conflicting current instructions while preserving earlier evidence.
