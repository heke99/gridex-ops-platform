# Checkpoint update — 2026-09-17 partial implementation

This supersedes the preparation-only state below without claiming all checkboxes complete. Original source mapping and partial implementation/local verification are now done. The single next task is TGT source grouping/rendering, followed by all other explicit blockers in `quality/audits/ediel-masterplan-v2/f3-register-progress.md`. Ordinary final-head CI, substantive review and merge remain pending. PR310 stays paused. The historical plan follows unchanged.

---

# PRODAT register rules implementation plan

**State:** IN_PROGRESS — source mapping and acceptance design only. No new register runtime implementation or passing register certificate is claimed.

**Goal:** Preserve every register while applying the original first-register and additional-register rules through parsing, validation, rendering and downstream consumers.

**Base:** main `51c73950515d771d2c2edcb97fde28ab087437a3` after completed PR327. Work on `codex/ediel-v2-prodat-register-rules-20260917`, not PR310.

**Architecture:** Extend the existing canonical parser/AST and composed field-matrix paths; do not add a parallel rule authority. Keep original wire values and their source/object/register locations separate from any permitted inherited projection. Apply base profile, subtype, parent and register overlay in source-defined precedence.

**Stack:** Existing TypeScript modules, Vitest and source harnesses, unchanged normal GitHub CI. No new package or database migration is assumed.

## Authority and boundaries

The unchanged `docs/ediel/masterplan-v2/registers/rules.json` identifies GOV-02, P-01, P-03 and P-05; `acceptance_tests.json` identifies AT-GOV-02, AT-P-03 and AT-P-05. GOV-02 cites P section2.2 page15 and annex2. P-05 cites annex2 pages114–116 and requires separate field314 global LIN sequence and field258 per-object register index for Z04/Z06/Z10. Read the actual original pages before deriving the complete overlay; these summaries alone are not a per-field implementation oracle. Original package hashes, 13 usage columns, 74 numeric descriptors and 110 base D cells are not to be rewritten.

PR310 stays paused at e9611351. No SQL/generated types/grants, production mutations or outbound market messages belong to this unit. Missing original evidence is a specific blocker to record, not permission to invent a rule. A green prior DTM/NAD PR does not certify register behavior.

## Skill routing

Planning and execution use writing-plans/executing-plans and verification-before-completion. Source-to-code mapping, actual bug reproduction, test-driven and variant checks apply before runtime changes. Request substantive differential review after normal CI. The repository's multi-agent spec-compliance command is not claimed executed where no such runner is available. Database, migration, UI and GPU/infrastructure skill groups do not apply to this preparation-only change; activate relevant groups if later scope genuinely reaches them, without resuming PR310 implicitly.

## Unit A — register overlays and all affected consumers

- [ ] Read exact P section2.2/annex2 pages and build a per-field first/additional-register table with source locators and explicit allowed inheritance/ignored repetition rules.
- [ ] Trace the actual paths in `lib/ediel/prodat/parser.ts`, `lib/ediel/core/canonicalEdifactAst.ts`, `lib/ediel/prodat/prodat26AFieldMatrix.ts`, `lib/ediel/rulebook/fieldMatrix.ts`, `lib/ediel/rulebook/canonicalPolicyFieldValidator.ts`, both PRODAT builders, preflight, compatibility ingress, TGT matching and staging. Record direct and indirect consumers; a name search alone does not prove absence.
- [ ] Add source-backed positive and negative tests before changing runtime code. Distinguish global sequence314, register258, object identity, first-register authority, register2+ core fields and allowed repetition. Include interleaved/multiple objects, unequal register counts, missing/duplicate/invalid indices, custom UNA, escaped identifiers and forbidden cross-object inheritance. Determine expected rejection/acceptance from the original text, not from current code.
- [ ] Reproduce each material divergence on this unchanged base; classify confirmed defects separately from unverified gaps. Do not count failing parameter assertions as production incidents.
- [ ] Implement in the existing parser/AST/composed policy. Do not flatten all line groups into one identity, drop extra registers or apply every base R cell unconditionally to register2+. Preserve exact raw data and audit locations.
- [ ] Propagate through every identified builder/reader/validator and relevant staging/TGT consumer. Scope any new helper to register semantics rather than duplicating DTM/NAD/RFF/BGM parsing.
- [ ] Run new and retained actual-module/source suites, application/script/test typechecks, lint, immutable package integrity and unchanged size budgets. Run normal OPS/Ediel/BrowserQuality/FullE2E against the exact published head, including build, security, ordinary-main replay and certificate jobs.
- [ ] Resolve genuine review findings with reproductions and regression evidence. Merge only the tested head after current main/review/checks are re-read. Record the precise accepted scope in the evidence ledger; do not mark all F3 verified.

## Unit B — remaining dependent-condition semantics, after Unit A merge

- [ ] Map every original110 base D cell and register overlay to true/false/unknown outcomes and original source notes; prioritize section2.2 over contradictory annex4 wording as GOV-02 requires.
- [ ] Inspect `lib/ediel/prodat/prodatDependentConditionEngine.ts` and its actual consumers. Its current required/not_required/undetermined representation is a review target, not itself proof of a defect.
- [ ] Prove source-specific false outcomes: optional and forbidden must remain distinct; unknown local authority blocks own outbound generation where required. Do not infer a condition from the presence of the field being tested.
- [ ] Build positive/negative/unknown evidence for each condition and integration path; implement only after the independent source oracle is established. Preserve all original usage classes and frozen source artifacts.
- [ ] Publish, run ordinary exact-head CI and substantive review, then guarded merge as a separate complete unit.

## Checkpoint

PR327 is merged and its old publication/review blockers are closed. Unit A source mapping is the next action. No new runtime file, test count or requirement is accepted by this preparation record.
