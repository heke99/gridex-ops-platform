# Permission322/324 ACK runtime — correction round1

Status: implemented and locally verified; scoped independent rereview and exact
Node22 CI remain root gates. Runtime/test correction: `69b0ce52`. Root memory-only
head before correction: `81bc68b5`; reviewed runtime candidate: `f30bcf63`.

## R-PACK-1 — selected-policy internal finding leak

The independent review confirmed a medium selected-policy API defect. The
canonical adapter requested both permission fields, then filtered only typed
national field issues. Local/internal issues from excluded322/324 escaped that
filter and could cause an internal-review hold. No live denial, unauthorized
grant or production caller using these partial policies was demonstrated.

The bounded fix passes optional `selectedFields` from the canonical policy into
the pure owner. The owner intersects that selection with own-function field
applicability before header, object placement, value and readiness assessment.
It retains shared own-message/BGM qualification, no-owning-LIN findings and all
ambiguity for selected fields. It does not parse reason strings or filter away
internal diagnostics. Full manual, registry, direct and classifier consumers
omit this option and retain the previous full assessment. Only two runtime files
changed; the typed diagnostic/projection/composer schemas remain untouched.

Durable new tests cover both directions (322 excludes324;324 excludes322), each
with duplicate, header, late placement and text-capacity variants. Selected-field
and full-owner opposing controls retain their holds. Valid partial controls and
shared ambiguous-BGM/no-LIN controls complete the fourteen-case matrix. No old
test assertion was changed in this round.

Fresh TDD before production:14 tests,8PASS/6FAIL, exactly the reciprocal duplicate,
header and late leaks. Final affected suite136/136 PASS. The independently authored
reviewer-v4 seven tests replay unchanged assertions:7/7 PASS, including manual
pre-prior/event stop with ready322, distinct physical registry rows/replay,
explicit-empty-C829 hold, direct positive controls and accepted-main comparison.
Only the copied afterAll observation path and config include path were redirected;
original reviewer sources/results were never executed as writers. The accepted-main
function copy still uses current dependencies; this is not a full baseline replay.

The first new-test typecheck failed on union field-rule and nullable fixture type
annotations. The new test's annotations were corrected without changing its
assertions; the failed log is retained. Final all three typechecks pass.

## R-PACK-N1 — append-only provenance correction

The historical ledger's performance gate hash
`c58e164e88291eeb5910c2b24ad5fc633c84067f8b955e19ecde8b6c43c0d629`
identifies original `permission-ack-runtime-20260920/final-performance.log`.
It does **not** identify that directory's `corrected-final-performance.log`, whose
actual hash is
`78bcb6957d850c6b213099fb2cc7baf9e004afe967288c2f53671b0c33b4953a`.
The latter omits the final SLO success line. This correction supersedes the old
claim that the stale gate metadata identifies the corrected log. The old logs,
ledger and runtime audit remain byte-identical, preserving the discrepancy.

The reviewer's fresh performance receipt exited0 and includes the SLO success
line; archived as `original-reviewer-performance.log`. This round's required
final performance gate also exited0 and has its own path/hash in
`final-performance.json`. Identical c58e log content across successful runs is
not evidence of identical execution: command, candidate and receipt path identify
the runs. No optional broad gate was run solely for N1; runtime correction required
the final Task2 gates.

## Final verification

All commands, exits and log hashes are in the R1 `final-gates.json` and individual
records. Hashes are computed after subprocess completion and log closure.

| Check | Fresh result |
| --- | --- |
| Full npm test, prescribed NODE_OPTIONS |4703/4703 PASS,307 files,50.18s |
| All3 typechecks |PASS |
| Lint |PASS,0errors/100 existing repository warnings |
| Source integrity |33 originals/121 rules/231 contracts PASS |
| Existing8 Ediel strip-only scripts |818/818 PASS |
| Tenant integrity/shutdown/ratchet |PASS;actual2401,unchanged baseline2402 |
| Large-file/performance/route-readiness |PASS |
| Implementation diff check from81bc68b5 |exit0 |
| Exact packaged quality suite |45/45 PASS,2 files |
| Reviewer-v4 unchanged oracle replay |7/7 PASS |
| Focused actual owner/consumers/inbound/partial-policy |136/136 PASS |

Node24.19.0 locally. The14 added tests increase the final full total from4689 to4703.
Affected136 precedes the type-only new-test correction; final full covers that
correction. Runtime and durable tests remain unchanged since final full. The
quality suite ran after all archived source/config/probe files were packaged as
non-executable `.txt`; subsequent packaging added only Markdown/JSON/log evidence.
Initial PR ddd37 Node22 CI4689 is historical after this fix; new exact CI is pending.

## Evidence preservation and scope

`prior-hashes.json` snapshots121 existing files, including all original reviewer
v1–v4 sources/results/observations and historical runtime receipts.120 remain
byte-identical. The only authorized append is the ignored task report, retaining
its exact2814byte prefix SHA256
`18bad091405f9bb1db5062ce62eeaa9e4b68226a62647a7747a1e1e1b7e23e29`.
The original tracked task report remains unchanged; the new appended report has a
separate tracked R1 recovery copy.22 original source artifacts also rehash exactly.
Reviewer v1's missing-subtype fixture error remains distinguishable from the
qualified v4 two failures; the older API/fixture/full-failure histories are not
relabeled as normative passes or failures. `archive-map.json` ties original and
replayed scratch files to their byte-identical, non-executable tracked archives.
Raw log EOF whitespace is retained; no whole-branch whitespace-clean claim.

Skill routing: receiving-code-review and systematic-debugging for direct cause
verification; TDD and verification-before-completion for RED/GREEN/final proof;
existing executing-plans and quality-playbook task workflow for the approved
bounded correction and packaged suite. The dispatched-agent exemption and explicit
no-subdelegation apply. No broad baseline regeneration, database/schema work,
security scanner campaign, UI/React, dependency, optimization or deployment skill
workflow is triggered by this two-file selection correction. Root retains memory,
plan, independent review, publication and acceptance responsibilities.

Source/architecture and registry amendment approvals remain unchanged. No source,
schema, codec, grouping, registry258 predicate, loader, workflow, gate or budget
change; no live calls, mutation, grant/state activation or deployment. P-ACK-R1 HIGH
prior-flow authority remains separately open, along with generic209/261,
registry40/105, canonical equal-reference258 and populated-scenario comparator
limits. Ready-nationalF business invocation is unchanged; no new workflow or
production-linkage acceptance follows. Counts98/110+10 and PR310-paused unchanged.
