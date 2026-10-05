# PR327 — DTM review remediation

## Authority, isolation and skill routing

Active unit: the published DTM PR327, not the older local ZIP candidate.
Main31b4 contains PR326; review base bb3e8301/tree f5419951 was recovered from
ordinary CI artifact10507943040. The ZIP digest, inner source digest and complete
Git tree were checked before changing code. The retained dependency archive's
package-lock matches exactly. No concurrent/newer branch is overwritten.
PR310 stays paused at e9611351; original normative files, schemas, generated
types, privileges and production data remain untouched.

Activated differential/source-to-code review, receiving-code-review, fp-check,
TDD, systematic debugging, variant analysis, verification-before-completion and
branch-finishing workflows. The existing quality/security/tenant CI is retained.
No UI/framework/dependency/schema/SQL/performance optimization task is present;
those installation and deployment workflows are not invoked. Tests use actual
application modules with existing in-memory boundaries, not live market access.

## Findings and evidence

| Review finding | State at this checkpoint | Verification |
|---|---|---|
| 4039380735: subtype-forbidden dates accepted by validators | fixed locally; normal CI/review pending | Original field register notes for210/211/216/302/321/326/508; appended boundary tests exercise every exclusion under three UNA alphabets, the date helper, the common canonical matrix, legacy validation, preflight and TGT draft validation. |
| 4039380743: explicit snapshot null replaced with stale context | fixed locally; normal CI/review pending | Direct alias tests plus actual historical-report, Z18 and Z04 profile builders prove cleared values stay absent and missing required values block. Undefined-only compatibility fallback and valid explicit values remain positive controls. |
| 4039380729: concatenated count labels in old archived memory | addressed by readable companion; reviewer confirmation pending | `archive/20260917-before-dtm-f3g/verification-readable.md` reformats the exact historical counts for both archived state/task records. The originals remain unchanged as the archive README requires. These are not current DTM results. |
| 4039380751: missing finding-level audit states | fixed documentation; reviewer confirmation pending | `f3-date-fields.md` now maps every listed finding to a state and concrete source/test evidence. Aggregate test results and release gates remain separate. |

The structural R/D/O/- matrix is unchanged. The renderer's existing subtype
exclusions have moved into one shared predicate. The common matrix converts
inapplicable fields to forbidden rules using original field223 from each LIN
object, so all its consumers reject supplied fields instead of merely omitting
them on output. It never borrows subtype authority from another object/message.
Missing general national D facts are not turned into unconditional required
fields. Complete dependent-rule evaluation remains the next masterplan unit.

For date inputs the first own, defined alias wins, including explicit null.
An undefined/absent alias may fall back; a cleared primary alias cannot be
repaired from a lower-priority alias in the same snapshot or stale source.
Invalid non-string values still throw. Header creation/timezone generation
retains its existing explicit defaults; cleared business dates are not generated.

## Executed local verification

The 113 new cases were first run against unchanged bb3e8301 source:45passed,
68failed. The enclosing boundary file had30 retained cases, so its baseline
was75passed/68failed out of143; these are not68 distinct production incidents.
After repair all143 pass. Full application suite:1814/1814 in213 files, including
the113 new cases. The full DTM suite has380 cases and passes in UTC, Stockholm
and Apia; these repetitions do not create1140 unique tests. Retained source
harnesses pass848/848. Application/script/test TypeScript groups pass.

An earlier full-suite invocation hit the tool's time bound without producing a
verdict. The same complete suite with two workers completed in64 seconds; no
tests, assertions or coverage gates were removed. Initial tool-bounded tsc had
no verdict; separately bounded reruns of all three groups completed successfully.
Build/audit/replay/live acceptance is not inferred from these local results.
Individual log digests are retained in `f3-date-review-qualification.json`.

## Required gate and next unit

Publish only after verifying the current PR still descends from review base.
Run every normal OPS, Ediel, Browser/Quality and FullE2E gate on the exact new
head, including build, budgets, API/RBAC/security and current-main replay.
Resolve the substantive review findings against that new source, not the old
success/skipped status. Only then merge with an expected-head SHA guard.

After this gate, begin register/dependent rules on the new main. This record
is not approval of every74field/110D/UNSM/F3/F5/F7 requirement or live release.
No SQL, generated database type, production storage write, explicit deployment
or external Ediel message is included.
