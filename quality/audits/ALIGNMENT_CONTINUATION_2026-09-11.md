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
