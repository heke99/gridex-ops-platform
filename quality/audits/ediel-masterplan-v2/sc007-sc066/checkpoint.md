# SC-007 / SC-066 bounded proof packet

Owner `/root/review_ten06`; reservation [#4915985559317](https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985559317).
Branch `codex/ediel-sc007-sc066-proof-20261004`, isolated worktree
`/workspace/gridex-masterplan-sc007-sc066`, stacked base #541 exact
`fbd76d6dfadf9ae9b06d75629f0a4ddef47bb61c` (actual main baseline56192d16).
Status: implemented and bounded tests passing; independent complete-scenario
review pending. SC-007/SC-066 coverage stays NOT_EXECUTED. No production,
source authority, migrations, shared memory or coverage change.

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
| SC066: incoming discrepant list leads to investigation | Existing actual installed PostgreSQL reconciliation functions import the sealed finite source, retain current vs physical imported values, create exactly two open investigation rows with company/import/row links, and mark the import review_required. Receipt binds actual source hash/result; unchanged exact replay creates no new investigations. Actual explicit operator decisions audit own-company/id status/note/actor/time. | Reduced SQL schemas and pre-existing legal/network decision substitutes are explicit; pre-storage legal guard remains separately held/tested. This is finite transaction behavior, not genuine legal/source reception or native RLS. |
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

Verification receipt records exact source/input/log hashes. Fresh final
targeted TS66/66 in6 suites PASS; supported actual AI SQL wrapper PASS;
unchanged scoped17 and separate outbound-copy14 wrapper effects PASS;
tests TypeScript, changed-TS ESLint, Node syntax and diff checks PASS. Frozen
integrity33 originals/121 rules/231 acceptance contracts PASS. No heavy full
suite or native replay was repeated. The earlier new API expectation used an
incorrect generic Forbidden string; it was corrected to the unchanged real
public response. This was a test-author error, not a product RED or fix.

Next: publish this exact packet as a stacked draft PR based on #541 and send
its immutable head to root. Independent reviewer must assess both complete
expected/prohibited contracts before only these two rows can be promoted.
Root owns current mandatory CI, actual-main composition and merge window.
