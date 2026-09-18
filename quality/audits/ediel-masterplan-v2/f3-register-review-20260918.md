# PR328 register review remediation — 2026-09-18

Base: `06493a26d4cb320ed31f38de8e308bf87b50bb1c`, tree
`f0a60721506c92171e2a15df9e5d8ac8a56e702d`. The recovered continuation was
already published. The old `2c11f27` checkpoint and interrupted local counts
were not reapplied or treated as the current branch. PR310 remains paused.

## Skill routing and method

The active work is bounded review/CI remediation, not a new architecture or
repository-wide audit. Applied receiving-code-review, systematic-debugging,
test-driven-development, verification-before-completion and quality-playbook:
read exact-head code and CI logs; reproduce findings before fixes; exercise
real caller chains with only external boundaries mocked; retain ordinary gates.
Read AGENTS/memory and the installed Next data-security documentation. Supabase
filter semantics were checked against the official `using-filters-is` reference.
Equivalent direct false-positive and variant checks covered both builders,
admin-to-orchestrator calls, database null comparisons and source selection.
Requesting-code-review/finishing-the-branch apply at publication/acceptance.
No skill creation, dependencies, hooks, broad refactor, SQL migration, UI redesign,
performance tuning, production observability, or new architecture is involved;
those groups are not activated. No parallel agents or external code execution
were available or represented as independent review. CodeRabbit provides the
separate substantive review; local testing remains local evidence.

## Confirmed findings and corrections

| Finding | Severity / impact | Reproduction and correction |
| --- | --- | --- |
| 4045191630 | Minor; false-positive test acceptance | Nonempty local-register error is now required in test-mode preflight. Production without a canonical snapshot is explicitly asserted to fail at its earlier snapshot gate. No send guard was removed. |
| 4045191645 | Major; missing company permission on fact writes | Denied company-scoped permission now rejects before evidence construction/persistence. Added existing company action guard while retaining global, membership, operational and source checks. |
| 4045191650 | Major; every multi-object admin approval rejected | Real form codec supplies the legacy update mode for absent input. Action now omits all legacy selection fields with object choices. Real action-to-orchestrator test exercises A commit, B failure and B-only resume. |
| 4045191661 | Major; unresolved-company reprocessing fails | Database double now models `eq(null)` as no match. Nullable tenant CAS uses `is(null)` while non-null tenant/id/revision/status restrictions remain. |
| 4045191681 | Major; runtime identity qualifier injection/invalid output | Both generic and profile builders reject invalid runtime agencies through one shared allow-list. Nullish defaults and 9/89 are preserved; no character stripping or coercion. |
| 4045191686 | Major; unsupported coded attribute emitted | Generic builder rejects a nonempty attribute without an applicable existing matrix descriptor. Valid component positions and empty omission remain. |
| 4045191696 | Minor; wrong expected identity in diagnostics | Field209 mismatch displays the unique expected facility identity, not a register ordinal. Ambiguous inventories do not invent an association. |
| 4045191706 | Major; wrong Z05 draft identity | Actual source lookup uses separate 233-first and 209-fallback lookups. Reordering selector strings alone was insufficient because row order previously won. Other PRODAT remains 209-first. |
| 4045191715 | Minor; misleading historical qualification | Old retained-source exit1 and source-drift records are retained. Unsupported 851/0 summary is explicitly retracted in the historical JSON; fresh same-source results are separate. |
| Local S1 | Major; registered TGT source rejected by old code-prefix heuristic | Registry-defined message/role steps supply candidate applicability. Unregistered legacy cases retain compatibility fallback. |
| Local S3 | Major; source-only registry inspection loaded database execution | New registry-based source selection exposed a pre-existing constants-to-filmotor import dependency. The existing constants are moved verbatim to one pure module and re-exported compatibly; all851 retained source tests now execute unchanged. |
| Local S2 | Major; wrong source bound by prefix | Source-message markers match complete, escaped identifiers and supported marker spellings, not ID prefixes or arbitrary field substrings. |

The refined review baseline had 14 failing and 128 passing cases across the
selected suites. This was after the separate source-selection reproductions,
not a claim that all new tests ran against one unchanged original head.
The 14 errors were fixed without weakening production guards. Added real-path
TGT workflow/autopilot tests cover drafts vs sent messages, acknowledgements,
source-bound facts, waiting/error states and explicit simulation boundaries.

## Narrow dependency correction

`parseInboundCaseMode` is now a pure form codec under `lib/ediel/inboundCaseForm.ts`.
The old action module retains its compatibility export. Importing a trivial codec
must not pull the unrelated 1,100-line action module and its execution graph into
the approval caller. Tests use the actual codec instead of a mock that hid its
legacy default. This is a production dependency boundary correction, not a
coverage exclude, stubbed production module, changed baseline or threshold.

The registry likewise reads pure file-engine constants instead of importing the
whole execution module. The constant declarations are byte-identical to the old
block and all public file-engine exports remain. The failed source run (358 pass,
493 fail with unexpected `@/lib/errors` import) is preserved separately; no source
harness, assertion or external dependency allow-list was relaxed to pass it.

## Rejected assumptions and test-oracle corrections

A speculative new test expected supplier outbound Z04/Z06/Z10. The actual
capability registry prohibits those directions; the tests were corrected to
assert the existing prohibition, with supported Z03 exercised through the real
compatibility adapter/engine/envelope. No capability guard was changed. Z15 is
an applicable characteristic for Z04, so the new inapplicable-code fixture uses
Z25 instead. These fixture corrections are not counted as product defects.
Initial test-double permission failures leaked a one-shot rejection across
cases; resetting mocks per case fixed isolation without changing runtime code.

## Qualification and remaining acceptance

Fresh machine-readable results are in `f3-register-review-20260918.json`.
They include command exit codes, log digests and checks for source drift.
Initial CI06493 passed all2157 tests but failed unchanged coverage thresholds;
restarting that run was not treated as a solution. Added actual-path tests and
the pure-codec correction address the measured gap. No existing assertion,
coverage include/exclude, threshold, gate, dependency or immutable source was
relaxed. A successful local run is not ordinary final-head CI or independent
review acceptance. Both are required before guarded merge.

All existing register-unit boundaries remain: per-object (not whole-batch)
atomicity, original-actor retry, unsafe legacy masterdata identity namespaces
blocked, no invented negative/positive APERAK authority, no live certification.
No SQL/schema/types/grants/storage or real customer/market operations occurred.
No content from PR310 was imported. Separate110D review follows register merge.
