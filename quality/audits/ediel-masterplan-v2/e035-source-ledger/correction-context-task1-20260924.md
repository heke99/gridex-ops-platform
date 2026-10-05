# Correction-context Task 1 — pure hold projection (2026-09-24)

Status: implemented and locally verified as a pure, hold-only primitive. This receipt does not qualify a service-owned source reader, historical completeness, or positive Z05C authority.

## Behavior and boundary

- `projectCorrectionContextBlocker` validates the observation instants, source identity and explicit tenant/environment/object/party/supply scope. It preserves the two boundary observations. Two known dates use the earlier instant; a known date paired with a positive `not_asserted` uses the known date. Either candidate `unknown` produces a null lower bound, which holds the whole matching interval. The proposed date is a hold hint only.
- `selectStructuralSources` applies visible, overlapping correction-context blockers before source comparison and returns `structural_correction_context_hold`. Observations after the saved cutoff do not alter an earlier view. A missing comparison or blocker scope component cannot exclude an otherwise matching concern; concrete mismatches can. Both current and closing points at the boundary hold.
- Existing `closureBlockerMatches` and `boundCoverageByClosures` remain unchanged. No proposed stop is emitted as a `ClosureVersion`; raw C/BGM5/rejected or unwitnessed concerns do not create a closure edge. The readset exposes an empty typed array for future service-owned producer integration, not provenance from callers.

## TDD and verification

- RED: the first `npx vitest run __tests__/ediel-correction-context-hold.test.ts` failed because the missing projector could not be imported. After adding the projector and selection path, three assertions initially exposed a test-fixture object identity mismatch; that mismatch was corrected before GREEN.
- GREEN: Node v22.23.2, focused correction/closure/structural/readset suite: 5 files, 67 tests passed. The final run followed the matcher extraction and added boundary assertions.
- Full `npx vitest run`: 373 files, 6007 tests passed (before the matcher extraction and two additional assertions; the focused suite was rerun afterward).
- `npm run typecheck`, `npm run typecheck:tests`, scoped ESLint on all five changed TypeScript files, and `git diff --check`: passed after the final changes. Initial test typecheck exposed three test-only unsafe union property accesses, corrected before the final pass.
- No native PostgreSQL/SQL execution was attempted or claimed; this pure task introduces no migration.

## Interface resolution and remaining work

`StructuralSelectionInput` previously lacked company, environment, customer and supply-period context. Optional pure comparison fields now exclude a blocker only if both sides contain conflicting concrete values. The parent approved this conservative interface resolution. It does not establish tenant authority: later service-owned acquisition must enforce company/environment and source provenance before passing blockers. A bare C can positively omit a changed end; an artifact that mentions an unspecified changed end must be classified `unknown`, not `not_asserted`. Capture and classification belong to subsequent tasks.

Skill routing: used repository TDD and verification-before-completion for this narrow runtime change. Repository knowledge/quality and source-design documents supplied the constraints. SQL, Supabase, UI, browser and migration skills are inapplicable here; code review/publication and CI remain with the parent.
