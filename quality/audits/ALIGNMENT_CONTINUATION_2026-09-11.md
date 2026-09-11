# Alignment continuation

Scope: continue the failing P0-C alignment proof in PR310 from54ce97ab.

Skills: using-superpowers/executing-plans for the existing plan; systematic-
debugging and test-driven-development for reproduced diagnostic loss; requesting-
code-review and verification-before-completion for publication. Supabase and
Vercel API skills cover read-only baseline identity. Quality-playbook inspected:
no new whole-system audit is restarted while this bounded existing task is open.
Next.js/UI/performance/supply-chain skills are conditional on subsequent actual
application/dependency changes; this batch changes only proof diagnostics.

Confirmed issue: hosted alignment103342579053 fails at behavior_cases without
a case or guard, despite the exact failure existing inside the private process.
Correction:16 fixed case names,63 fixed guard names, eleven fixed SQL assertion
names, source attribution only from a primary psql header at stderr start.
No raw SQL, identifiers, query payload or arbitrary error text are published.
Original SQL, fixtures, ordering, success predicates and disposal are preserved.

Validation: new privacy/attribution suite4 cases, observed3 RED failures then
4 GREEN; existing25 constructors GREEN; whitespace check PASS. Independent
review and hosted native acceptance are separately required.

No schema migration or customer-data change. Forward repair, full native replay,
generated types and production parity are not claimed complete by this work.

Independent scoped review identified that normal IF NOT EXISTS NOTICE messages
would obscure later primary headers. The private input session now sets and
asserts client_min_messages=error before sources execute. Error acceptance and
server private logging remain unchanged.4+25 tests PASS after this correction.
Cleanup regression proves outer-context preservation, not a new guarantee for
an exception replaced by a case's own finally block.

Independent scoped review: APPROVED after NOTICE correction, no material
findings. Reviewer independently ran4 tests and diffcheck; AST comparison
confirms unchanged success predicate,16 ordered calls and other case functions.

Hosted ba728a8a: alignment103410251604/OPS34643991621 passes empty baseline
and fails populated/assertions/ALIGNMENT_FINAL_CATALOG_MISMATCH. CleanupPASS.
Follow-up exposes only finite field/count mismatch through captured private
output, with unchanged rejecting assertion. New regression1RED->GREEN;5+25PASS.
Source/HOT flag is a hypothesis until actual receipt, not a justified fix yet.

Finite catalog receipt scoped review APPROVED; reviewer independently5PASS
and verified PIPE/memory-only raw catalog path and unchanged rejecting gates.

## Proved populated catalog false positive

98027a81/OPS34644416888/alignment103411642582: precisely18 alignment_index
objects differ solely in check_xmin. No other schema fields differ. Empty
baseline passed, owned cleanupPASS.

PG17 indcheckxmin marks index visibility against HOT chains. A updates parsed
payload before creating the unique index; B/C also build indexes following
backfills. The independent empty DDL oracle cannot reproduce that heap history.
Documentation: https://www.postgresql.org/docs/17/catalog-pg-index.html .
Exact REL_17_STABLE sources reviewed: heapam_handler.c lines1589–1600 (blob
6f8b1b79298f3a364b95b76f93bd7d3814f362dd), catalog/index.c lines3099–3120
(blob192d614434c23c3c6e1eb3c43138ad570bb51c46).

The fix qualifies only False->True on newly selected pinned-source indexes with
valid/ready/liveTrue and exact remaining fields. It does not remove this field
from snapshots or normalize admission/rollback/origin/repeat comparisons.
Simultaneous unknown drift, existing indexes, reverse changes and nonbooleans
reject. Python matrixRED->GREEN;26constructors+5diagnosticsPASS. The same cases
are executed against native SQL before corrected behavior acceptance.

Directional HOT correction independently APPROVED with no material findings.
Reviewer ran the32-case constructor and diagnostics5, verified SQL FULL JOIN
and true-only null handling, source pins, same final predicates and raw rollback.
Predecessor ba728a8a OPS34643991621 now completes all prior bounded/native
auth/legacy/repair/dedupe/fixed/continuation/Ediel/quality gates successfully;
alignment, types and unsupported full-native gates remain failures as recorded.

## Guard fixture dependency localization

1c979ecf/OPS34645171060/alignment103414093339 passes native catalog_controls
and all nine behavior cases before guard_sources. The prior populated catalog
false positive is resolved in native PG17. The next failure is fixture setup:
ALIGNMENT_GUARD_SETUP_SOURCE_DEPENDENCY; no B/C execution in that variant.

A bounded preflight attempts all43 source-derived setups in separate rollback
transactions on a disposable actual63 clone. Exact original catalog+rows must
remain after every attempt. Any failure still blocks all whole-source variants;
the receipt includes only fixed0..42 ordinals and known SQLSTATE categories.
No dependency removal, CASCADE, source change or selection advancement.
New receipt regression observed1RED->GREEN;6diagnostics+26constructorsPASS.
The earlier attempted --constructors-only flag was rejected by argparse; actual
successful constructor command is --selection-only. Hosted setup receipt pending.

Independent setup diagnostic review APPROVED: exact rollback/preservation and
fail-closed43-case receipt retained; reviewer diagnostics6+diffcheckPASS.

## Source-bound omission fixture correction

87135839/OPS34645977547/alignment103416745939 measured all43 original setups.
Seventeen reject with2BP01:0,2,4,6,8,10,12,13,15,17,20,23,25,29,31,33,39.
All26 others succeed; every attempt rolls back with exact catalog+row equality.
CleanupPASS. This directly verifies the invalid omission-fixture construction.

Independent source review mapped the17 variants to eleven views,87policies,
and13 UPDATE OF company_id triggers. Source03 lines675–725 creates the48 DB1
select/insert/update policies. Source6e lines214–298 creates39 later tenant
policies; final tenant_delete policies use platform-admin expressions and must
remain. Source6d2 lines357–401 creates the13 column-specific operational triggers.
Repair W restores S2 policy preimages; introduced gridex_debug2 policies are
therefore excluded. Five exact predecessor files/hashes bind the implementation.

View sources:02 Ediel ack/overdue/duplicate-ack;03 tenant-gap, three duplicate
candidate views and backfill-readiness;6d platform tenant governance;6d2 metering
billing audit;6e company billing volume. Backfill-readiness must drop before its
tenant-gap/duplicate parents; overdue-ack must drop before ack-state. Ordinal39
needs only metering_billing_audit_overview, which references created_at.
The complete per-variant map is explicit in the new guard-fixtures module.

These are counterfactual disposable fixtures for original guard behavior, never
an alternative admitted actual63 migration schema. The complete fixture starts
identical to the independently source-bound origin. Every mapped object must
exist with the original descriptor. Explicit RESTRICT statements replace no
source bytes or runtime policy. An unknown-dependency native negative control
requires2BP01 and exact rollback after prior named removals. The identical
prepared setup is applied on the independent oracle. Every prepared case must
still pass its original whole-source SQLSTATE/catalog/row/rollback assertions.

Constructor RED->GREEN;27constructor+6diagnosticsPASS. Controls cover all17
mapped cases, exact11/87/13 global identities, dependency order, preserved tenant
DELETE, unchanged unblocked setups and source/target/preimage/absence/ordinal
rejections. Hosted correction remains unverified until published execution.

Concrete fixture correction independently APPROVED with no material findings.
Reviewer verified every per-variant source map and exact11/87/13identities,
shared setup path, unchanged source/admission/rollback and unknown-dependency
rejection control; single new constructor+diffcheckPASS. Hosted native pending.

## Staged-source continuation prerequisite

The real shell relocates originals to HOLD before controller execution. The
alignment constructors previously inspected/read only original paths, so they
could not participate legitimately in actual staged continuation. Optional exact
StagedSources now propagates through validate_sources, diagnostic_source,
expected_ddl, new_index_keys and prelude. Every physical source retains owner,
non-symlink/canonical-path checks before read; repair.read_source additionally
checks private HOLD and immutable manifests. No fallback to existing live files.

New constructor observed TypeError RED thenGREEN;28constructors+6diagnosticsPASS.
It proves direct/staged source, DDL and prelude equality plus absent/corrupt/
symlink staged files, missing diagnostic and foreign-stage rejections while valid
originals remain available. Independent review APPROVED, no material findings;
reviewer single constructor+diffcheckPASS. This is a read prerequisite only.

Next integration boundary is after FIXED_COMPLETE and before child release on
the same owned replay database. AlignmentProof requires closed accepted inputs
and SUCCEEDED state and must not be imported as production execution authority.
A runtime executor must retain live input/stage bindings, one P/A/B/C/W
transaction, source-only independent final oracle and linked completion/final
snapshot. Existing fixed release cannot be bypassed by setting full=True.

After native actual68/once-only/fault/controller/child-after-commit/HOLD/privacy/
predecessor gates, five whole entries may register at foundation64–68. Existing
selector removes P/W from later timestamps. Expected accounting then109foundation,
508timestamp,549selected/23unclassified/23substituted/5excluded;46 still unresolved.
No registration or accounting change is made by this prerequisite.
