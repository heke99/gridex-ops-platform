# F3 D-condition continuation — local candidate, not published

## Baseline and scope

GitHub records PR328 merged as `b916213e83871e9f4d15b9fd52a2b8c19394c9ca`.
The source archive's tree was independently rebuilt by Git as
`54f9cf4fe56e42768ef132a23f6a79baea0632d5`, identical to that main merge.
The existing D branch was identical to main. This work does not redo recovery.
No new remote commit, PR, ordinary CI or merge has been performed.

The first bounded continuation implements **six of 110 original numeric D
cells** at canonical field and outbound send boundaries. The inventory records
all 110 original cells and does not erase previous register/date acceptance.
Runtime's 120 catalogue entries include 10 parent occurrences, not 120 numeric
D cells. The original source package and coverage thresholds are unchanged.

| Cell | Derived requirement | Printed original source |
|---|---|---|
| Z06:508 | F required; E/G optional | P26.A r3 §2.2 p18 |
| Z06:217 | F required; E/G optional | P26.A r3 §2.2 p18 |
| Z06:306 | F/G required; E optional | P26.A r3 §2.2 p19 |
| Z06:254 | F/G required; E optional | P26.A r3 §2.2 p20 |
| Z09:216 | B/E/F/G required; D forbidden | P26.A r3 §2.2 p17 |
| Z09:217 | F/G required; B/D/E forbidden | P26.A r3 §2.2 p18–19 |

The actual wire reason is resolved via the existing subtype registry. Missing,
invalid, duplicate or cross-code reasons remain undetermined. A stored byCell
flag/root snapshot cannot reverse these source-defined outcomes. The base
status union remains compatible, while a selected cell's new requirement
explicitly distinguishes optional from forbidden.

## Consumer and isolation evidence

`validateCanonicalPolicyFields` delegates selected cells to
`validateProdatSubtypePolicy` in both all and dependent_only mode. Shared
register scopes retain exact object/agency identity, first-register authority,
invalid-chain handling and first-message boundaries. The shared matrix still
validates supplied dates and any supplied code-list constraints. Global DTM
placement checks run before narrowing to object scopes.

`validateEdielMessageRowWithRulebook`, row preflight, `assertRulebookAllowsSend`
and `assertEdielSendLock` retain blocking selected-cell issues even with forged
root statuses, a missing root subtype, or the legacy invalid-test flag. A wrong
caller code/reference cannot hide the wire-selected D gate before transport.
Syntax-only inbound row preflight does not activate the new outbound adapter.
No company permissions, tenant filters, graph RPCs or persisted object plans
were weakened or changed; no external message or database write was executed.

## Reproduction and correction record

- Original engine/canonical baseline: **121 tests, 19 pass / 102 fail**.
- Corrected actual-consumer red baseline: **18 tests, 12 pass / 6 fail** before
  guard changes. The preliminary run had fixture mistakes and is not accepted
  as proof of product defects (details in the JSON findings register).
- Self-review found a header-DTM placement regression introduced by narrowing
  scopes. **Four executed red tests** reproduced it; the shared global check
  restores the boundary. Skipped cases in that targeted run are not executions.
- One retained complete-facts fixture used sharing subtype V in Z09. It now uses
  valid F, retaining every existing assertion; V is explicitly rejected by the
  new suite. No old assertion or normative oracle was removed.

## Exact execution-source qualification

**2440/2440 application cases in 235 files** pass,
including **146 new subtype cases in two files** (a subset, not additive).
**851/851 unchanged retained source tests** pass. All three TypeScript projects,
lint (0 errors / 100 existing warnings), specification integrity, mechanical
checks, quality tests, RBAC, tenant service-role ratchet and file-size budget
pass on the same execution-source manifest with no source drift.

Coverage: lines **35.49%** / required 35.32%;
statements **34.06%** / 32.91%; branches
**26.98%** / 25.25%; functions
**40.9%** / 34.81%. No excluded source or
lower threshold was added. Commands, exits, log hashes, staged failures and
execution-source digest are in `f3-d-subtype-qualification-20260918.json`.

**Final local production build passed**, followed by the unchanged browser
bundle budget (largest chunk 201,055 bytes; three route budgets). The first
ordinary local command failed with SIGKILL in the 4 GiB container, and a
2304 MiB retry exhausted its heap during type checking. A full unchanged
Next.js webpack build with a local 3072 MiB process cap completed successfully
(exit 0). All three attempts are preserved; no committed build setting, type
check or acceptance threshold was relaxed. New-head ordinary GitHub CI/build/
replay and independent review still remain mandatory before merge.

## Limits and next action

This is not all 110 D conditions, full F3, generic builder/TGT/admin data
acquisition, national APERAK mapping, live testing or F4–F7 acceptance. Full PDF
bytes were unavailable for a fresh rehash; the selected field notes were
visually read from the supplied original page images, whose hashes are in the
110-cell inventory. Production data/SQL/schema/generated DB types/dependencies
and the paused PR310 were untouched.

The current GitHub connector exposes read operations only. Publish this exact
patch through a write-capable environment after checking main/branch freshness;
run ordinary CI and obtain substantive independent review on that exact head.
Only then merge and continue the remaining source-condition ledger. Do not
mistake the already accepted PR328 checks for this candidate's qualification.

Skill routing and per-finding states are in the qualification JSON. A local
review is not an independent reviewer or a formal acceptance certificate.
