# Independent SC-007 / SC-066 review checkpoint

Reviewer `/root/sc007_sc066_review`, 2026-10-04 UTC. Independent review only;
owner `/root/review_ten06` retains all implementation. Root owns GitHub,
coverage, composition and integration. No owner/shared memory, source, tests,
schema, authority, push or merge changes are authorized for this reviewer.

Status: frozen dc3 independently reviewed; SC066 current-consumer evidence
gap must be repaired by owner before approval. Current parent base #541 is
`fbd76d6dfadf9ae9b06d75629f0a4ddef47bb61c`, actual main baseline
`56192d16d1eac7fb0e716a3e2770bac8e58be115`.

## Routing and scope

Read root AGENTS.md, memory README/current-state/current-task/checkpoint/
handover/open-blockers/active work-plan, searched decisions and known-failures,
read relevant masterplan owner checkpoint and SC008/SC017 independent record.
Long memory contains historical superseded contexts: the parent's current
assignment, actual Git state, frozen cards, and fresh evidence are controlling.

Active skills: spec-to-code-compliance (complete frozen literals, delegated
bounded per-requirement review); code-review (test validity and effects);
differential-review (seven test/script changes and evidence; no production
security removals); verification-before-completion (fresh bounded commands and
hash-qualified historical reuse); using-git-worktrees (explicit separate
detached ordinary clone instead of owner worktree); Supabase (actual SQL/RPC
review, no live writes; current-doc implementation rule has no new feature
implementation trigger). using-superpowers explicitly says dispatched
subagents ignore it. acquire-codebase-knowledge explicitly excludes narrow
reviews without repository mapping; its seven-document bootstrap is skipped.
Postgres best-practices read; no SQL/schema authoring, performance diagnosis or
RLS changes planned. Conditional fp-check/systematic-debugging if a concrete
divergence appears. Skipped UI/browser/performance/property generation,
static/supply-chain/hook/skill-authoring, implementation/TDD/branch-finishing,
and new delegation: no corresponding action/trigger in this read-only review.

## Frozen literals read in full

SC007: K2 knows the installation ID without grant; calling API/export must
deny authorization without customer data; global GSRN matching cannot confer
access. SC066: installation changed during period AND delivery covers only
part; export must contain correct detail rows and validity; discrepant inbound
list leads to investigation; AI must not automatically overwrite masterdata.
Canonical acceptance register matches frozen annex entries at lines 83/850.
Related TEN12/AI03/AI04 read to trace the designated actual owners; approval
scope remains only these two scenarios.

Historical native ZIP locally rehashed:
`470c1eed5afd99678c2d5ab2c7fa108bc33384cc873fb5ecab5cf9cb4f820076`.
Source f4a0fb4398a79f5777824123142c82aeeb8338ec/run37219122360/
artifact11310821113 is reusable only after selected testcase and relevant
source blob qualification. No fresh native/current-candidate claim.

## Published freeze and independent verification

PR547: https://github.com/heke99/gridex-ops-platform/pull/547 . Independent
GitHub GET confirms draft/open head
`dc3b733562ec36d0d94458247f3546b3ca5bdc94`, tree
`e38730ec5c88b56f9a44f13049a0943fde72448b`, base fbd76d6d. Nine changed
test/evidence files; no lib/app/supabase/coverage/shared-memory delta.
Technical c7121808/tree7c9a220f was cloned with `git clone --no-local
--no-checkout`; detached clone at
`/workspace/agent-review-checkouts/sc007-sc066` moved to dc3 after publication.
Only an ignored existing node_modules symlink is present; Git status clean.
All seven technical packet inputs are byte-identical c712 -> dc3 and equal
the owner's stored SHA256s. Production source and native fourteen relevant
body hashes were independently checked, not merely trusted.

Fresh reviewer execution at dc3, Node22.23.3 and
`NODE_OPTIONS=--require=./scripts/lib/unit-loopback-network-boundary.cjs`:

- `node node_modules/vitest/vitest.mjs run __tests__/ediel-beneficiary-projection-api.test.ts __tests__/ediel-ai-list-history.test.ts __tests__/ediel-ai-bi-processing-decision.test.ts --maxWorkers=2 --reporter=dot`
  —47/47 PASS,3/3 files,exit0. Log SHA256
  `721680c89b3ed981f5c3d4f690bac96235db0e31c8baf017b74a121b9bfe25b5`.
- `node --test scripts/test-ediel-ten-07-scoped-projection.cjs scripts/test-ediel-ai-history-and-reconciliation.cjs`
  —3/3 PASS,0 skips/failures,exit0; supported wrappers execute scoped17,
  separate outbound-copy14 and AI probe. Narrow child network permission;
  no external mutation. Log SHA256
  `df3fc3d27e4572d7695a95bbefd3338223fc4bf353fdd17757fc0534945c71ec`.
- `git diff --check fbd76d6d..HEAD` —exit0; clean detached checkout.
- Git/ZIP/JUnit comparisons —fourteen relevant native bodies equal native
  f4 -> stacked base -> c712 -> dc3, native test first-line tag difference
  only; all seven technical input and ten declared production hashes match.

Independent GitHub run GET confirms run37219122360 completed/success at f4
and treee53ca50c. Dedicated artifact tool confirms artifact11310821113 belongs
to that run/head and digest equals locally rehashed ZIP470c1eed. Direct generic
artifact GET was unsupported by connector; dedicated read succeeded. Selected
exact ESCO10 testcase exists once in rem002-native-junit.xml and has no
failure/error/skip. XML SHA256e3d61b376c876c49fc2aed4f6ed61c6f9f16b8dfb110141a65fd94479c9ccb73.
It directly tests active read-authorized no-grant stranger with same physical
GSRN/shared synthetic SMTP, real projection refusal and full owner state
preservation. No fresh dc3 native or SC066 native claim is made.

## Confirmed evidence gap SC066-CURRENT-CONSUMER (approval blocker)

Claim: the existing SQL probe executes an older reconciliation consumer, not
the final installed owner. This is a test-evidence gap, not an alleged product
security defect. `scripts/ediel-ai-reconciliation-embedded-check.mjs:29–30`
loads only20260930165219 and20260930174145. Its `apply` at53 calls the private
function created by174145, and its authorized/held substitutes at59/60/93
replace obsolete current_decision_v1/network_registry_basis_v1 ports.

Search across all migration references found the replacement in
`20261001023514_ediel_network_registry_original_source_owner.sql:169`.
Its exact current reconcile body equals committed full schema at1902;
SHA256 of trimmed body
`bef7a445874b7a7d8870b45a54e435ae954e26528c488c8e61ca2f72ef33f0d1`.
Current header body also equals final schema, trimmed body SHA256
`820748b4460a6a7b673eaf847791426c418e1718d687f97cf4cc73e5a0a64340`.
Current reconcile adds a read actor call to gridex_requested_changes.actor_v1
before even replay, replaces current_decision with purpose consumer/current
scope, and current header calls network_for_company_v1. Thus green old probe
does not reach current installed source consumer. This refutes both a guessed
schema-format difference and an assumption that only comments changed.
The original comparison script first expected a different dollar delimiter;
after correcting reviewer extraction, exact body comparison exposed and then
confirmed the genuine latest-definition difference.

Minimal owner-only correction: in the SAME existing SQL script, install exact
latest reconciliation/header definitions from the immutable final migration,
using declared finite current actor/purpose/network upstream ports. Retain
actual migration bodies unmodified, own/foreign six-table snapshots, exact
open/current/imported investigation provenance, source/receipt preservation,
and exact replay checks. Keep the supported wrapper executing that same script.
Update packet hashes/limits and publish a new immutable freeze. No production,
migration, private authority, helper or second implementation is requested.

## Finalized independent verdict on published dc3

**SC-007: APPROVE, complete frozen code-behavior criterion.**
**SC-066: REQUEST CHANGES / NOT APPROVED, current SQL evidence gap only.**
SC007 may be promoted immediately and independently; SC066 must remain pending
until the owner correction above runs. No production vulnerability or required
production repair is established. Exact-head required CI/publication/coverage
and integration are root's gates, and this verdict does not approve external
legal authenticity, market activation, customer custody or unrelated cards.

## Full literal effect matrix at dc3

| Card and exact effect | Actual reachable owner and asserting behavior | Verdict and boundary |
|---|---|---|
| SC007 given: K2 knows same GSRN without grant | Scoped SQL17 fixture adds active uid4 beneficiary with point-a and no grant; actual final public projection consumer refuses beneficiary uid4. Source-qualified native ESCO10 case adds active read-authorized stranger, same actual physical GSRN and shared synthetic SMTP; then calls real `projectEdielSeriesToBeneficiary` for owner's known series using another beneficiary's grant. | Given asserted in finite SQL and selected genuine local native owner test. External issuer/SMTP inputs remain synthetic. |
| SC007 when: calls API/export with known id | Actual HTTP GET/request parser binds selected company/user and exact grant/version/series/purpose/fields/window. SQL public `ediel_beneficiary_series_page_v1` delegates `beneficiary_series_page_filtered_v2`, which selects exact grant and beneficiary before owned series/object validation. Native real adapter calls that RPC. | PASS. API auth/projection ports are declared substitutes; separate SQL/native asserting consumer closes actual denial path. Known series/object identity never substitutes for grant. |
| SC007 expected: authorization denial without customer data | Fresh actual route error case returns exact403 body `{error:'Projekteringen kunde inte auktoriseras eller läsas.'}`—no rows/source/customer diagnostics—and blocks caller scope/raw overrides. Actual SQL no-grant case rejects; native no-grant case rejects with full source/series/value/contract/ACK/projection state unchanged. | PASS,47/47 bounded TS plus scoped17 wrapper and hash-qualified selected native case. Error denial is actual route behavior, not inferred from metadata. |
| SC007 prohibited: global GSRN match must not give access | `beneficiary_series_page_filtered_v2`239 exact grant+beneficiary `SELECT INTO STRICT`, owned source/series reads and g.object_ids/product/window filters precede output. Stranger case has identical GSRN and SMTP yet fails; owner originals and prior projection still equal. Public projection copies only whitelisted fields, and route denial contains no diagnostic data. | PASS. Separate14 outbound copies are not used as incoming customer data-access authority. No native blanket claim beyond same unchanged relevant case/body. |
| SC066 given: installation changes AND supply covers part of report | Real `projectAiListHistory` case uses reportOct01–Nov01, deliveryOct05–25 and address transitionOct10, with finite declared dated source/readset business inputs. | Given combined explicitly. No authentic private source-owner/history custody claim. |
| SC066 when/expected: export correct detail rows and validity periods | Pure projection produces exact two rows Oct05–10/Oct10–25 and dated addresses; result enters actual `buildAiListIntentDraft` -> normal WeakSet-qualified `readAiListPartyBasis` object -> `buildAiListOutboundDraft` -> physical CSV. Tests assert actual GSRN/address/customer/date columns,22 columns/final delimiter and source provenance; forged intent payload details excluded; current origin failure holds. Production `renderAndQueueAiList` calls same renderer; actual `loadAiListOriginBasis` reads tenant/site/supply/snapshot/customer/applied-history and calls this projection. | Export half PASS. Current origin-read/headerRPC and upstream chronology business ownership are explicitly substituted; current loader/private finalizer not executed by this scenario test. No unreachable helper or intent metadata used as exported-row proof. |
| SC066 incoming discrepancy must lead to investigation | Current production path is actual canonical registration or `processInboundEdielMessage` -> `processAiBiInboundReconciliation` sealed hash -> `importAiBiListCsv` actual serviceRPC -> public wrapper -> latest private reconciliation owner. Old finite probe asserts exact2 open company/import/row-linked investigations with current/imported values and review_required plus source/hash/receipt. | NOT VERIFIED on installed owner: probe creates earlier private function, not latest01023514 owner. Port substitution may be finite, but must happen around the current function. |
| SC066 prohibited: no automatic masterdata overwrite | Probe snapshots every full row in all6 reduced schemas—customers/customer_sites/metering_points/contracts/customer_contracts/supplier_switch_requests—including own+foreign sentinels; equality after import and exact replay. Actual decision adapter tests3 decisions with own company/id audit and only ai_list_discrepancies update, no RPC/masterdata call. Current SQL body contains inserts to imports/import_rows/discrepancies/receipts and update only own import status; no protected-table writer. | Old-core assertions/decision adapter PASS; full installed-consumer execution remains pending. Reduced schemas prove declared whole rows, not deployed-schema completeness/native triggers. No current no-overwrite approval inferred from old probe or defensive unused helper. |
| SC066 source evidence/replay strengthens investigation criterion | Probe exact receipt source_payload_hash/importId/result, retained rawsource and investigation full rows, exact same result/idempotent replay and unchanged snapshots; rollback fault leaves zero partial imports/rows/investigations/receipts. Current real owner rechecks actor before receipt and returns retained result without new writes. | Current actor/purpose/network version must be installed before this evidence can close the card. Real pre-storage legal/purpose owner remains independently held; test substitutes must be disclosed. |

Next: owner-only SQL correction and immutable new freeze; reviewer then reads
latest body equality/current port assertions and reruns only changed SQL
wrapper. SC007 is already complete and does not wait for SC066.
