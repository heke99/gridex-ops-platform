# F3-G — source-exact PRODAT DTM fields and consumers

## State and scope

Implementation candidate, not ordinary-CI/review/merge approval. Base main
`31b4dbeb764874e252e8b6b510bf1fa78832f148` after merged PR326; source tree
`d69e471e597ddf4817a402ce165fbad214184c7c`. New branch
`codex/ediel-v2-prodat-date-fields-20260917`. No PR310 content is imported.
Code/test qualification below is bounded to PRODAT's twelve mapped DTM fields;
it is not full F3, 74 fields, 110 D predicates, full UNSM, F5, F7 or live/TGT approval.

## Source authority and independent expected values

The unchanged original package under docs/ediel/masterplan-v2 has33files,
121rules and231contracts. The canonical runtime matrix continues to own field
identity and all13 usage columns. Original source manifest identifies
260630_Ediel_PRODAT_APERAK_Anvisning_version_26-A_16-B(6).pdf,
SHA25683c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95.
P26.A revision3 §2.6 pp43,49–52 and the independent original field register were
cross-checked against table/page images from the uploaded June30 guide. Matching
page content is not a claim that a differently named library copy has the manifest hash.
No original document, table, fixture or hash was rewritten.

| Field | Qualifier | Scope | Wire format / meaning |
|---|---|---|---|
|205|137|header|203 application creation minute|
|206|ZZZ|header|805, exactly1; standard UTC+1 throughout the year|
|210|92|LIN|203 contract start|
|211|93|LIN|203 contract stop|
|212|51|LIN|203 first meter reading; previous runtime locator9 was wrong|
|216|157|LIN|203 validity start|
|249|329|LIN|102 birth date|
|302|90|LIN|203 reporting start|
|321|91|LIN|203 reporting end|
|326|693|LIN|203 permission creation|
|327|164|LIN|203 service/reporting termination|
|508|354|LIN|positive integer with unit801/802/804/806; not a calendar date|

203 is exactly YYYYMMDDHHmm on wire,102 exactly YYYYMMDD. No rollover dates,
year0000, invalid clocks, empty/extra components, extra data elements or ambiguous
duplicates may become usable business values. Parser calendars do not depend on
host timezone. Explicit ISO instants at API boundaries convert to fixed UTC+1;
compact/offset-free inputs are market wall times. API seconds are deliberately
projected to minute precision; wire values may not be truncated to pass validation.
Birth dates are not inferred from customer identifiers. Period units remain part
of the comparison; format validity alone does not authorize a bilateral resolution.

## Confirmed defects and repair paths

High-impact data-integrity defects were reproduced in actual application modules:
contract92/93, validity157, report90/91 and permission164 had interchangeable aliases;
wrong field212 qualifier9; date102/midnight truncation of contract clocks; permissive
calendar/text normalization; wrong UTC/DST rendering; later-object/stale data fallback;
missing required date accepted because another date existed; old TGT date fabrication;
permission-state DATE persistence reading a contract/report date rather than164.
The captured failing test cases are descriptor/input assertions, not a count of
production incidents. No live incident or data corruption is asserted.

- prodatDateFields uses the existing matrix, declared UNA and original raw components.
  Header and per-LIN scopes are distinct, with first-message isolation. Scalar readers
  remain first-object scoped. Matrix evaluation visits every object; correct values in
  the first cannot satisfy missing required values in another. Supplied malformed
  optional/dependent fields are invalid rather than silently absent.
- render/dates implements strict Gregorian calendars and fixed standard-time conversion.
  render/dateSegments is shared by both normal builders and the old TGT builder. It
  preserves clock precision, separates explicit business meanings, and resolves only
  documented message-specific legacy API aliases. Canonical subtype aliases are
  obtained from the existing registry, including Z14N and Z09D.
- validateProdatDateFields composes the canonical matrix's structural R/forbidden
  requirements and strict date syntax; it is used by legacy/profile/TGT builders and
  preflight. National D requirements remain conditional in the existing condition
  engine; this unit does not claim every national predicate verified.
- Parser, canonical facts, compatibility and transport projections, customer staging,
  production customer-masterdata builder and TGT comparison consume these same fields.
  A genuine no-wire legacy record may retain its explicit structured fallback; an
  invalid/missing value in nonempty wire may not borrow a cached value.
- Z14N emits no positive report/permission dates. Finite reporting end91 is not proof
  of historical S18. Z09D renders92 XOR93, not157.693 is optional for Z15/Z18;
  it cannot be invented or required as a prerequisite to an otherwise valid Z18.
- Old TGT row lookup now uses the exact field number and selected object column, not
  fuzzy start/end labels. Imported historical periods and non-midnight minutes survive.
  Only explicitly recognized sender-generated symbolic inputs are generated. Bad
  supplied calendar strings do not fall back to arbitrary now/midnight. Exact original
  optional/period presentation annotations are decoded without general text stripping.
- The single-permission Z15 persistence path requires one object's valid164 evidence,
  rejects ambiguous/missing/bad source before DB access, writes its explicit DATE
  projection and retains the source minute and timezone in metadata. Existing tenant
  filters and reversal behavior are retained. Full permission-correlation/time/state
  certification remains the subsequent F5 work, not implied here.

## Executed tests and provenance

Verified restoration: ordinary PR326 archive10503474895 ZIP SHA256
9a309a9a5a9024f5b65f3a731f379ded636044b41f84d1fbe22e770d52f81d43,
inner source SHA256d3bb1f4c7bddef6b3188bd5372d05ccb7d0cada2657c0d65a9275cd8365e2742;
restored Git tree exactly d69e471e. Locked dependency archive10496783500 ZIP
9efe8762508b0ff6e80c95b1a16d7d744f4d104f745bd3d510d2479462424dd2,
inner module archiveec448a0bc67303d21b875dba29c2ddce839935c163c327d59323a01870afd2e0;
package-lock88f4f36c97b4896442c3ce9cb837ea7f93a0fee55e6b63b477421b33b4b73d6b
matched byte-for-byte. This is source/dependency provenance, not a release certificate.

- Final unchanged-base reproduction:237 actual-module tests against pristine main
  source with only the two new test files:66pass/171fail. These tests run real modules;
  database boundaries are explicit in-memory mocks. No credentials or market messages.
- Final three-file new suite267 cases (178 field +59 consumer +30 boundary cases).
  The30 boundary cases include new APIs unavailable on the old base and are not
  incorrectly included in the237 baseline count. An intermediate new-code reproduction
  separately exposed two composite-subtype alias defects before correction.
- Full local Vitest1701/1701 in213 files.267new are included, not added to1701 again.
- Retained source harness848/848 after preserving positive/negative source fixtures.
- Application/script/test TypeScript pass. Full lint0errors/98warnings, immutable integrity and unchanged source budget pass.
  All267 new tests pass in each of UTC/Stockholm/Apia. Exact log digests appear in
  the adjacent machine-readable summary; ordinary CI is still mandatory.
- Permanent Ediel workflow runs the new field/consumer/boundary suite in UTC,
  Europe/Stockholm and Pacific/Apia. Repeats are the same267 cases, not801 unique tests.

Synthetic fixtures changed, not normative fixtures or assertions weakened:
1. Two retained NAD/legacy-builder positive test fixtures and the BGM source fixture
   lacked required contract210; an explicit valid contract start was added so those
   tests still exercise legal/document behavior with a source-valid message. A new
   negative control proves creation137 does not substitute for missing210.
2. Retained observation508 test treated `000015:610` as usable. The independent
   P26.A table requires the numeric period/unit contract; positive now uses15:806,
   and the original malformed value is retained as an explicit negative alongside
   old-meter and empty-component controls. No assertion was removed.
3. Retained complete NAD profile fixture lacked required210/508 forZ04; both are
   explicitly supplied. New negative controls cover missing210 and missing508.
4. No original TGT spreadsheet row, annex, normative table or supplied PDF was edited.

A normative-authority regression initially stopped direct matrix import in the core
AST. The fix moved qualifier selection behind the canonical prodatDateFields facade;
the authority guard itself was not changed. Tests, source-size budgets and CI gates
remain intact. Full lint may have pre-existing warnings; never claim warning-free.

## Required before merge

Publish from exact main31b4, preserve later work, and run all ordinary OPS hardening,
Ediel, Browser/Quality and FullE2E on the exact candidate. Includes types, full tests,
lint, API/RBAC/security audit, build, unchanged budgets and ordinary-main replay.
Request substantive source/code review (generic CodeRabbit success/skipped is not
acceptance), address genuine findings, then merge guarded by the tested head SHA.
Pre-merge memory must be reconciled with actual PR/CI state, not treated as approval.

## Explicit boundaries / following units

No SQL, generated DB types, grants, live DB/storage writes or external messages.
PR310 remains pausede9611351 with backup untouched. Ordinary-main replay success
would not approve PR310. APERAK's own date fields and UTILTS are different profiles
and are not certified by this twelve-field PRODAT unit. Full SG8/UNSM grammar,
register2+ overlays, all110 conditional business rules, bilateral resolution rights,
historical/future period decisions and F5 transitions retain their separate gates.
Following this exact-head approved merge: register and dependent-rule unit from the
new main, not a parallel patch that reintroduces date aliases.

## Skill routing

Activated using-superpowers, acquire-codebase-knowledge, writing-plans/executing-plans,
spec-to-code-compliance, quality-playbook, TDD, property-based-testing (calendars,
separators and scope invariants), systematic-debugging, variant-analysis, fp-check,
differential-review, requesting-code-review, verification-before-completion and
finishing-a-development-branch. Isolated worktree is used for unchanged-base tests.
Receiving-code-review activates when actual feedback arrives. Existing tenant filters
and supply-chain/source hashes were inspected. No UI/React routes or performance
optimization claim: design/React-performance/benchmark overlays are inapplicable.
No schema/migration work or live DB changes: SQL optimization and schema execution
are deferred with PR310. No multi-agent service available, new hooks, skills, scanner
configuration, SARIF output or new dependency: those installation/orchestration paths
were not invented or run. Existing security/tenant release gates are preserved.
