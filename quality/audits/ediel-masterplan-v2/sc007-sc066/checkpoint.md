# SC-007 / SC-066 bounded proof packet

Owner `/root/review_ten06`; reservation [#4915985559317](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985559317).
Branch `codex/ediel-sc007-sc066-proof-20261004`, isolated worktree
`/workspace/gridex-masterplan-sc007-sc066`, stacked base #541 exact
`fbd76d6dfadf9ae9b06d75629f0a4ddef47bb61c` (actual main baseline56192d16).
Status: SC-007 independently APPROVED at dc3 and SC-066 independently APPROVED
at corrected fd0c3613; both are PASSED. This final approval changes only SC066's
row relative to fd0, leaving all other351 rows identical. No technical input,
production, source authority, migration or shared memory change.

Skills: spec-to-code-compliance for the entire frozen scenarios;
using-git-worktrees for isolation; verification-before-completion for executed
assertions and source-qualified historical reuse; requesting-code-review via
root's separately assigned reviewer. Supabase guidance applies to the actual
SQL consumer and its explicit finite schema/authority substitutes. fp-check
is conditional on a real product divergence; none was observed. No broad
audit, new security/performance tool, UI redesign, issuer implementation or
subagent delegation is needed for this bounded packet.

Frozen literals: `annex/D_Acceptanskontrakt.md:83` and:850, identical canonical
SC-007/SC-066 acceptance register entries. Parent cleared the exact paths
before edits; earlier claimed P/U/OPS/GOV/DB/IMP source owners remain untouched.

| Complete literal effect | Actual path / asserting behavior | Boundary |
| --- | --- | --- |
| SC007: another active tenant knows the same GSRN but lacks a grant; API/export denies | Actual `ediel_beneficiary_series_page_v1` consumer in the supported scoped SQL17 wrapper refuses the active same-object ungranted beneficiary. The source-qualified native ESCO positive case separately creates an active read-authorized company with the same physical GSRN/shared SMTP, invokes `projectEdielSeriesToBeneficiary` against the owner's received series and proves denial with the owner state unchanged. | Existing native #497 case reused only after relevant blob equality; external issuer/SMTP facts remain synthetic. Finite SQL upstream acceptance/review ports remain declared substitutes. |
| SC007: deny without customer data; global GSRN match grants nothing | Actual HTTP GET/request parser binds authenticated company/user to exact grant/version/series/purpose/window. The strengthened existing error case now asserts exact403 public body with no rows/source diagnostics. Actual SQL source/output/owner preservation assertions and native same-GSRN denial prove no global identifier fallback. | API auth/project ports are mocked; actual route/error boundary executes. Separate14 outbound copy checks are retained but are not the incoming data-access proof. |
| SC066: installation changes within a partially supplied reporting period | Existing history fixture helpers now represent report Oct01–Nov01, actual supply Oct05–Oct25 and an address transition Oct10. Real `projectAiListHistory` returns exact two dated address rows and source references; no input source/supply mutation occurs. | The existing source/readset business declarations test dated selection, not genuine private source-owner authority. |
| SC066: export correct physical detail rows/validity periods | That projection enters real `buildAiListIntentDraft` → `buildAiListOutboundDraft` → CSV serialization, using the actual header reader's normal binding object from a declared RPC port. Full physical columns assert object/address/customer/dates,22 columns/final delimiter, and source evidence. Prefilled forged intent details are absent; current origin-read failure holds rather than exporting stale intent rows. | Current origin read is a declared upstream port; this does not execute `loadAiListOriginBasis` or fabricate its private snapshot JSON. The unchanged real loader reaches this projection/intent exporter; live qualification remains with its protected owners. |
| SC066: incoming discrepant list leads to investigation | Exact final committed PostgreSQL reconciliation/header bodies import the sealed finite source, retain current vs physical imported values, create exactly two open investigation rows with company/import/row links, and mark the import review_required. Their source bodies, real import trigger and current decision bridge/auth chain are checked against installed pg_proc and final schema. Receipt binds actual source hash/result; unchanged exact replay creates no new investigations. Actual explicit operator decisions audit own-company/id status/note/actor/time. | Reduced SQL schemas and named current actor/purpose/network ports are explicit substitutes. The bootstrap pre-storage gate is tested held and disabled locally for sealed fixture insertion; the final reception/personal-storage owner is not executed. This is finite current-consumer transaction behavior, not genuine legal/source reception or native RLS. |
| SC066: never automatically overwrite masterdata | Every row in customers, customer_sites, metering_points, contracts, customer_contracts and supplier_switch_requests—including foreign sentinels—is snapshotted before and after actual import and replay. All rows remain identical; raw source and receipt/investigation outcomes remain identical. Even explicit accepted/manual-apply discrepancy decisions call only the own scoped discrepancy update and no masterdata writer. | Full rows of the declared finite schemas are asserted, not completeness of the deployed schema or authentic customer contracts. No destructive action or live schema mutation occurs. |

Production callers traced read-only: `loadAiListOriginBasis` opens current
decision/party/site/supply/snapshot/customer/applied-history reads; the actual
intent renderer calls it and forwards only the returned history to the real
outbound draft. Incoming `processAiBiInboundReconciliation` seals source/hash
before `importAiBiListCsv`; its actual service RPC delegates to the SQL atomic
reconciliation owner, which records open rows/review_required without writes
to protected masterdata. `approveAiBiDiscrepancy` records an explicit audit
decision independently of applying any business data.

SC007 qualified historical evidence: run37219122360/artifact11310821113,
source `f4a0fb4398a79f5777824123142c82aeeb8338ec`, ZIP SHA256
`470c1eed5afd99678c2d5ab2c7fa108bc33384cc873fb5ecab5cf9cb4f820076`.
Its selected ESCO case passed without skip/failure/error. All14 relevant
qualified blobs from the independently reviewed #541 receipt remain exact;
the native first tag is metadata-only and its complete asserting body is
unchanged. No fresh current native or SC066 native execution is claimed.

Verification receipt records exact source/input/log hashes. The preceding
unchanged targeted TS66/66 in6 suites and independent TS47/47 in3 suites PASS;
scoped17 and separate outbound-copy14 wrapper effects PASS. Those results are
reused only for unchanged asserting inputs. The original AI probe PASS executed
an obsolete consumer and is superseded for SC066 by the corrected wrapper.
Fresh corrected AI wrapper1/1 PASS, tests TypeScript, scoped ESLint and Node
syntax PASS. verify_spec.py PASS29 checks across the frozen121 rules and231
acceptance contracts. No heavy full suite or native replay was repeated.
The earlier new API expectation used an
incorrect generic Forbidden string; it was corrected to the unchanged real
public response. This was a test-author error, not a product RED or fix.

Published [stacked draft PR #547](https://github.com/heke99/gridex-ops-platform/pull/547)
on #541. Technical freeze `c7121808bc2dbcbe3b63eff6ee68d4118b0b834e`, tree
`7c9a220f2edd797b04069cd1ca175a217369b6b9`: exactly nine bounded test/evidence
files, with all asserting inputs recorded in the receipt. Documentation freeze
dc3b733562ec36d0d94458247f3546b3ca5bdc94 was independently reviewed. The full
record is copied byte-identically to independent-review.md; public approval is
[#5475985697401](https://github.com/heke99/gridex-ops-platform/pull/547#issuecomment-5985697401).
SC007's actual API, scoped SQL and native asserting inputs remain unchanged
from that approved freeze; only its coverage row is promoted.

The sole SC066 blocker was obsolete SQL consumer evidence, not a product defect.
The same existing probe now extracts final reconciliation/header statements
from20261001023514, installs five current decision bridge/auth functions from
their immutable source migrations, and retains the actual current import gate.
All eight complete bodies equal pg_proc and committed full schema. Trimmed
reconcile SHA256 is bef7a445874b7a7d8870b45a54e435ae954e26528c488c8e61ca2f72ef33f0d1;
header is820748b4460a6a7b673eaf847791426c418e1718d687f97cf4cc73e5a0a64340.
No copied validator or production statement is changed. A synthetic unqualified
decision row supplies only the existing import/receipt foreign key; it has no
private purpose artifact, review or origin. Its presence cannot authorize the
missing/unqualified current port cases.

The positive call trace asserts exact company/actor/read/method_contract,
origination/test purpose consumption, AI/reconciliation/test purpose selection,
54321/test current network, then the real import-trigger decision read with
NULL environment. Missing purpose, unqualified purpose, refused current
consumer, held network and revoked read actors reject before import. Exact
historical replay after prospective purpose/network hold adds only the current
read check and preserves source, investigations, receipt and all six tables;
revoked read still rejects replay. Atomic second-row fault rollback is retained.
Initial correction runs exposed missing bridge dependencies and the schema's
named dollar delimiter; those fixture/extractor errors were corrected without
changing production or weakening assertions. The final pre-storage owner is a
separate upstream boundary; no legal reception/custody claim is inferred.

Final independent review at fd0c361398d7ddb5dbaffdd08cab28c185baf53e/tree
106bed84c098bdc411f4d5377f9b703ef8a08a08 APPROVED the whole SC066 criterion.
The reviewer independently checked all eight installed/migration/schema bodies
and reran only the changed supported wrapper on Node22.23.3:1/1 PASS0SKIP,
exit0, logSHA73dac7996ef5a381e521b277f6940c88527c622f0f65db2f5cfc851a5eb14478.
Six other asserting inputs and all16 production sources were qualified unchanged;
no unit/full/native rerun was required. The copied updated full independent
record SHA is ca582b18097871cad37440924337c69fb44db49cf9c5bc1fc4a6a691899792d7.
Public whole-card approval:
[#5475985865262](https://github.com/heke99/gridex-ops-platform/pull/547#issuecomment-5985865262).
All finite upstream and final reception/storage limits above remain explicit.
Only SC066's row is now promoted; SC007 and all other350 rows retain exact
content from fd0. This evidence-only approval delta changes no asserting input.

Next: mark the published PR ready and inventory the latest full ownership boards,
open PR paths and published coverage before selecting/reserving the next two
unowned scenarios. Root owns current mandatory CI, actual-main composition and
merge window; readiness and code-behavior approval do not imply merge.
