# Independent SC-046 / SC-047 contract review

Reviewer Codex sc046-sc047-review-20261005; review-only claim [5305991659194](https://github.com/heke99/gridex-ops-platform/issues/530#issuecomment-5991659194).
Main `01b11f55af710c3e6aad1f5a433631a88c702047`, tree `cc0b6412e13c04f6baa3413957c7b609aeba74be`.
Exact answer delivered to the sole product owner in [5305991719119](https://github.com/heke99/gridex-ops-platform/issues/530#issuecomment-5991719119).
Claude retains implementation/tests/coverage. Retained coordinator owns main composition and integration. Both scenario rows stay PARTIAL.

## SC-046: timestamp branch and actual effect proof

Frozen given: a newer accepted data version exists; later arrival has an older registration/update timestamp, field512 or532, and is otherwise correct.
Expected: prescribed positive APERAK and no overwrite of the newer active version.
Prohibited: no UTILTS-ERR or silent rebilling solely from arrival order.
Rule U-04; frozen U25-A-4 §3.6.14/5.2; scope includes the actual source-family/profile and SG5 timestamp owner. Guide register identifies512 at DTM597 and532 at DTM368; native UTC conversion witnesses remain separately scoped.

**Answer to the owner's 512/532 question: test the two applicable physical source shapes independently.** The current helper assigns both dates to the same value; the guard's `coalesce(latestUpdateDate,registrationDate)` selects532. It cannot prove the fallback512 behavior. An E66 fixture with512-only and an applicable source such as the existing accepted S01 with532-only are already available; no new timestamp authority or test harness is needed.

| Required effect | Existing proof | Exact open predicate |
|---|---|---|
| Newer first, older last leaves newer current and older history | `scripts/ediel-utilts-late-version-sql-regression.mjs` and `ediel-utilts-u04-u14-effects-sql-regression.mjs` execute real persistence SQL with reduced fixtures; current NEWER/value10 and noncurrent OLDER/value7 are asserted; a truly newer correction still replaces current. | Separate512-only/532-only cases with the opposite field genuinely absent/null. |
| Correct physical timestamp parsing/source scope | Qualified native E66 test at `scripts/ediel-utilts-consumption-native.test.ts:529` stores512 and absent532; S01 at567 stores532 and absent512; retries preserve each. | Neither performs the newer-then-older arrival scenario. Do not turn these individual timestamp witnesses into late-arrival approval. |
| Positive APERAK | Reduced persistence returns accepted/positive_aperak/persisted and binds its reservation/series. | Actual positive U-APERAK through the current protected ACK consumer after durable storage. The SQL test asserts zero outbound messages; ACK intent is not the physical response. |
| No ERR and no current overwrite | No negative intent/issue codes; no outbound rows; current data/value checks. | No actual UTILTS_ERR through the same completed consumer and stable replay. |
| No silent rebilling | No billing tables or consumers in the reduced SQL fixture. | Snapshot existing current metering/normalized/billing-underlay effects and relevant invoice/readiness state, consume the late source through real bound sinks and compare. It is sufficient to prove the effects the actual path can cause; no unrelated billing rewrite/audit is requested. |

Actual chain: public `processInboundUtiltsMessageByCanonicalPolicy` dispatches E30/E66 to the actual-metering path. Bound sink wrappers in `utiltsDataRequest.part-1.ts:507,521` call `ingestBoundUtiltsMetering` / `createBoundUtiltsBilling`. `consumptionSinks.ts:22` traverses accepted stored contracts; metering writer calls `gridex_consume_utilts_metering_v1` in `normalizeMeteringValues.ts:233` and updates readiness. Billing uses the source-bound underlay consumer. A storage-only series query cannot prove those later effects.

This is an evidence gap, not a reproduced rebilling defect. There is no authorization here to change current guards, sinks, invoices, or another owner's source code. Extend the existing legitimate fixture, retain positive new-correction contrast and original history, and qualify the current consumer on the corrected head.

## SC-047: join actual receiver, matching and final E10

Frozen given: syntax and national guide pass; right legal receiver and role are established; object is unknown under the applicable functional control.
Expected: UTILTS-ERR E10 where that is the prescribed outcome.
Prohibited: no new customer object and no other-tenant search to make the result green.
Rules U-03/TEN-11. A local routing/entitlement uncertainty alone must not become an E10 sender fault.

| Existing assertion | What it proves | What it does not prove |
|---|---|---|
| `__tests__/ediel-sc-044-047-utilts-scenarios.test.ts:31` injects a missing own transaction match and contrasts a matched ID. | Actual runtime returns E10 only for the supplied unknown snapshot. | No actual legal-receiver/role producer, tenant resolver or DB matching is executed in that case. |
| Same suite directly calls `matchMeteringPointIdByIdentifier` with an always-empty DB mock. | Query contains own company_id; insert/upsert calls are absent for that isolated lookup. | No foreign-only real record is tested; matching is not joined to final runtime/ERR or its customer effects. |
| `lib/ediel/matching.ts:43` scopes the read and returns no match when absent. | Actual source contains the intended tenant filter and read-only lookup. | Source inspection is not an integration test. |
| `utiltsEngine.part-1.ts:342` applies unknown-point E10 to eligible E30/E66 transaction and retains its own TN. | Control ordering and family/physical-transaction attribution can be traced. | No physical ERR was built/persisted by the SC047 test. |
| Existing TEN11 unresolved/stale-local identity regressions | Local configuration failure can remain a hold without fabricated protocol error. | Those cases do not establish this scenario's positive known-receiver/role prerequisite. |

Missing complete case: genuine scoped source admission and legal receiver/role → syntax/guide acceptance → actual matching of unknown object → canonical functional disposition → final physical E10 ERR/TN. Keep a matched positive contrast. The same external ID available only in another tenant must remain unavailable for this reception; compare own/foreign customers and points before/after/replay and prove no create/upsert/fallback. Use the existing source-owned native/gateway fixture and legitimate public producers, not a caller accepted marker, private receipt insertion or forged parsed snapshot.

No cross-tenant or product defect was reproduced. Do not make a second matcher/importer/ERR builder. Product owner must preserve all protected source/tenant/ACK behavior while closing these missing assertions.

## Qualified evidence and checks

Reused OPS37281693425/head445bf509; quality job111671247914 passes SC044/0473 and TEN112, within full unit10304/807. Targeted tagged gate reports the existing SC046 runner green; that does not close missing expected/prohibited effects.
Nine direct inspected source/test blobs independently match local/main and CI. Main has unchanged PARTIAL rows. Shared frozen contracts and earlier qualified engine/gateway witnesses are retained from the first review packet.

The same clean artifact11334955859 independently matches SHA25633b1207eb2efda48feebfaa7c048bc6e1f0f7a7ea9f863e36aed79bd10b0f597. Two exact native timestamp cases pass without errors/failures/skips, extracted in qualified-timestamp-native.xml. Their scope is individual timestamp parsing/storage and retry, not late arrival or SC047. Full original XML SHA256ca5fc23a667f91a8e538c53a85bf6386a08f91f9f6dd554891d7802256b02ec1 retains609cases/0failure/0error/1unrelatedskip; no all609-pass claim.

Fresh specification/reference integrity33/121/231 and two Node syntax checks pass. New local behavior/native runs were not executed: dependencies/canonical Node22 are absent and the configured shell proxy is unavailable. No green result is inferred from those limitations; prior failures remain in the first checkpoint/receipt.

Skills: using-superpowers, using-git-worktrees, code-review, verification-before-completion and cloud-environment-runtime. Existing frozen requirements and original source-owned fixtures define this bounded review; no production remediation, new architecture, database modification, broad security/performance/UI assessment or hook installation is in scope. No subagents spawned.
