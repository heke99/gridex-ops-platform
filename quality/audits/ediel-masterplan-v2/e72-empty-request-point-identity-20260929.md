# E72 empty request: physical point authority at the durable boundary

Base verified draft #421 `d8fea0975a8e8812c130e765afcc3e5e1086e580`; main `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`. E73's completed gate is retained unchanged.

## Source, scope and hypothesis

Frozen U25-A-4 request table p63 **UF-request-209-63** makes E72 LOC+172 required. Appendix p123 **UG-123-10/11/12** specifies qualifier172, nonblank ID/GS1 checksum where applicable and agency9 or89. The guide permits an agency89 distributor ID; it does not supply its issuer/tenant/point ownership. `UCASE-E72-SUPPLIER/ESCO-disabled` and masterplan §9 keep E72 outside normal DDQ/DGI production activation. This probe concerns an existing diagnostic service boundary, without enabling that market role.

`canonicalEdielPolicy` → `resolveCanonicalMessagePolicy` / runtime validation → `processInboundUtiltsMessageByCanonicalPolicy` → `qualifyReceivedUtiltsStructure` → `prepareUtiltsConsumptionContracts(allowConsumption:false)` → `persistUtiltsTransactionResults` → service-only SQL `gridex_persist_utilts_consumption_v1` / private `persist_series_v1` → typed per-IDE ACK finalizer is the reviewed path. Request contracts have empty observations. The current TypeScript point qualification lists S01/E73/S06 but omits E72. The current SQL point predicate lists E30/E66/S07 or nonempty observations, plus non-object S01/E73, also omitting E72. The private selector refuses agency89 without a qualified assignment. Hypothesis: a guide-valid E72 can therefore mint positive durable point-request authority.

Threat/privilege boundary: these are synthetic local test inputs to a service-role RPC, not an unauthenticated remote exploit claim. Receiver tenant/raw/code locking and immutable source context remain required. Caller validity is insufficient without durable revalidation. Wrong-tenant, changed original, negative guide outcomes and existing object-owner precedence must stay protected.

## Test-first evidence

The independent synthetic fixture is a minimal E72→E30 request with no quantities or optional grid-area facts. On inherited product code, the new ordinary actual-consumer test passed national validation and reached the processor but failed at the expected internal hold: `internalReviewRequired` was **false**. No product change has been made. This proves the ordinary consumer gap; the SQL authority claim remains pending native execution.

Four native tests are added before SQL changes. The first verifies accepted request/empty contract and null private point selection, wrong-tenant rejection, two direct atomic refusals with zero source receipt/ACK reservation/series/contract, actual agency89 hold and immutable receipt/ACK retry, and actual clean agency9 positive point-request persistence/final ACK with stable retry. Three independent cases cover missing LOC+172, invalid GS1 checksum and invalid agency as genuine field209 guide-negative APERAKs, with no series/contracts/meter/billing/completion and stable retry. No new national error code is invented for missing ownership. Existing E73/S01/object/mixed/Storage controls remain unchanged.

Local native DB/Docker are unavailable. This commit is test/evidence only. Read the first exact native failing assertion before a product correction; a fixture/guide failure is not SQL defect confirmation. The locally failing ordinary test is retained for the subsequent correction commit.

## Requirements and lifecycle

| ID | Specified | Implemented | Locally tested | PR verified | Merged | Production activated |
| --- | --- | --- | --- | --- | --- | --- |
| UF-request-209-63, UG-123-10/11/12 (E72 wire) | Frozen source | Existing national validator | New actual-consumer RED; genuine negatives native pending | New native pending | No new delivery | No |
| U-02/U-03/U-14, ACK-03/ACK-08, DB-03 | Partial bounded owner/ACK/atomic evidence | E72 durable guard unconfirmed | Consumer RED only | Pending | No | No |
| AT-U-02/03/14, AT-ACK-03/08, AT-DB-03 | Existing planned contracts | No whole-ID closure | Not formally executed | Not whole-ID verified | No whole-ID closure | No |
| DB-05 / AT-DB-05 | Retention/history remains blocked | No new implementation | No | No | No | No |

Relevant calls: CALL-08 original receipt/tenant attribution, CALL-09 canonical inbound validation, CALL-11 qualified context, CALL-12 durable per-IDE disposition and ACK, CALL-13 prohibited request meter/billing effects, CALL-15 immutable original retry. CALL-16 activation remains blocked. Frozen 121 rule cards and 231 contracts are unchanged and do not acquire an overall completion percentage.

## Routing and next action

Skills: using-superpowers for routing; systematic-debugging and test-driven-development for reproduction before correction; Supabase/Postgres for locked tenant/raw/grants/atomicity and forward migrations; verification-before-completion plus code/differential review for exact-head evidence. UI, performance, supply-chain changes, full baseline-audit workflows and parallel agent work have no changed surface in this bounded task. One author.

Publish this substantive test/helper/evidence from the unchanged remote parent with no force update. If native confirms positive authority on agency89, add the smallest forward SQL predicate and ordinary E72 point qualification; verify real positive/negative consumers, retry, zero forbidden effects, exact-head native/replay/types/schema and five workflows. Historical BGM203/IDE505 legal issuer/original/deletion/retention, positive LOC175 registry/mandate/sink/ACK and full E035 coverage remain blocked. Older Storage delete/before_witness cause remains unknown. PR stays draft; #310 and traffic remain untouched; no staging, TGT/AGT, counterparty trial or real send.

## Confirmed RED and forward correction checkpoint

Test-only remote/local `ab8e12c6b8610d834adb407b6b12e40d881614e6`, OPS **36624954925**, clean replay job **109599440587**: **406/407** native passed. The first direct agency89 E72 request RPC unexpectedly resolved with `accepted`, `persisted`, `positive_aperak` and a series ID, after guide acceptance, empty observations, null private point selection and successful wrong-tenant refusal. This confirms the durable defect. Later hold/positive assertions in that test did not execute; the three genuine guide-negative E72 controls passed. OPS verify/quality and the four other mandatory workflows succeeded on this test-only head.

Authentic RED replay artifact **11060510982**, ZIP SHA256 `9155cc70140fd2265358800583d255cb3c594183cf721bb3eab552d6f585a4a1`, retains that first failure. The prior E73 final head `d8fea097` has five green workflows and 403/403 native; earlier pending E73 memory is historical.

The forward migration `20260929202207_utilts_e72_empty_request_point_identity.sql` adds only E72 to the unconditional physical LOC+172 prewrite predicate. Existing signature, tenant/raw/source locking, independent LOC+175 refusal, privileges and atomic transaction remain intact. The ordinary canonical consumer adds E72 to the existing unsupported-point hold. Its unchanged RED test now passes with all **51/51** tests in the actual-consumer file, including agency9 acceptance. No guide error or market activation is added. Native corrected hold/positive/retry/zero-effect assertions and exact-head final gates remain pending.
