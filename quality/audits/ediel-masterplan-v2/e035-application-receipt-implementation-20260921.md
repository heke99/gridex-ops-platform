# PR366: bounded Ediel application receipt admission

Date: 2026-09-21. Status: IMPLEMENTED_NOT_VERIFIED. Parent 0b3170f999c725f1b38afefaf4179cfd5bd33c07; resolve the actual published child before final review. Base main b6bb10328b173267882238804bbbeefd048040c4 is verified PR365 publication of accepted runtime840720c7, not a new E035 completion.

## Qualification and observed RED

Retain e035-application-receipt-plan-20260921.md. Independent review5761807242 qualified the finite lower RPC return-contract gap, requiring additional JSON/discriminant controls. Supplemental test-first0b3170f added9 cases without modifying the initial42. Resolution5761874417 approved SOURCE/SPEC, DESIGN/oracle and TENANT-BOUNDARY, conditional on real RED. Root observed initial8eae ordinary OPS35609967994/job106366332421:5195 tests,5167 passed,28 failed;324 files,323 passed,1 failed; Node22.23.2, both scripts/tests typechecks passed. All28 failures are actual service calls resolving malformed receipts, not import/setup failures:21 missing requested identities,6 wrong discriminants,1 multirow. All5153 old tests and14 positive/boundary controls passed. Verify106366332563 and replay106366332584 succeeded. Root receipt/authorization5761924346. At publication, the supplemental0b workflow lookup returned no runs; its execution result is not inferred.

## Minimum implementation

Only lib/customers/canonicalOnboarding.ts changes production behavior, gated by command.channel === ediel_inbound. Preserve existing company/actor validation and command validation before RPC. Materialize one JSON snapshot of the Ediel command, send that same snapshot, and capture nonempty JSON-object site/meter requirements before awaiting. This matches SQL rather than pre-serialization Object.keys: undefined-only objects become {}, whereas a null-valued property survives. The snapshot is local, not a new stored source or shared cache. Other channels retain their original command handling.

Admit only a single result (object or existing one-row compatibility), with exact true/committed or false/ambiguous discriminator pair. Ediel success additionally requires nonblank application_id and graph ids for requested nonempty object payloads. Retain original customer/number/operation checks, returned object and values, ambiguity, correlation on idempotent replay, RPC error handling and all non-Ediel behavior. Do not add UUID syntax, fresh-correlation equality, queries, retries, compensating writes or national ACK errors.

This rejects an incomplete or inconsistent client receipt. It does NOT prove the current SQL emits bad results, establish an exploit, roll back an already committed RPC, validate every return field, or turn application snapshots into qualified dated meter/register structure. The existing single-object caller and multi-object extra guards are unchanged. No application/operation schema, SQL, input matching, source projection, parser, migration, workflow, dependency, threshold or old test is changed.

## Tests and final gates

Both published files remain unchanged: ediel-onboarding-application-receipt.test.ts (42 cases), ediel-onboarding-receipt-wire-contract.test.ts (9 cases). They exercise the real public service with only external RPC mocked. Positive controls include object/one-row returns, ambiguity, replay, customer-only/empty optional requests, one-sided graph requests, non-Ediel compatibility, error correlation and pre-RPC company/actor holds. The wire suite actually JSON-round-trips the RPC request. These are not live database or persistence-atomicity tests.

Required next: actual exact-head ordinary CI and final independent TASK/SPEC, QUALITY, TENANT-BOUNDARY, WHOLE-PR review; expected-head guarded merge only after all mandatory checks; then actual-main full73/73 plus OPS and independently inspected artifact/commit/rows/JUnit/unit log. No current corrected-head GREEN is claimed. Save final acceptance in the PR discussion and continuation memory, not another receipt-only publication loop.

## Remaining plan and applied workflow

E035B still requires qualified independent dated structure, actor/environment/object/agency binding, disposition, supersession and completeness; then actual loader/comparator/E61/E62/guide/ACK/persistence behavior. Existing observed PRODAT JSON must not be duplicated or mislabeled as authority. Full E035, F3 and masterplan remain NOT_COMPLETE. D110/110+parents10/10 and accepted361/363/364 work are retained.

Applied workflow: retained execution plan, bounded source-to-code and false-positive/root-cause trace, TDD after independently qualified oracles and observed RED, differential review and verification-before-completion. No unavailable slash/subagent scripts are claimed executed. Unrelated UI, schema, infrastructure, security-wide or performance remediation is out of scope. PR310 stays OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a, untouched. No live DB/provider/market/settings/explicit deployment operations.
