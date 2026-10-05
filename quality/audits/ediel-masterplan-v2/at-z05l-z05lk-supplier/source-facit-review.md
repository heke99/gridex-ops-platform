# AT-Z05L / AT-Z05LK SUPPLIER: independent source facit

Read-only delegated review, 2026-10-05. Base `3dff03dd8bb8c251b1613d35ce6fc7e66e6ee686`, tree `e222e54afb45d25f2988eaf283274527ad413f0c`. Parent reports explicit test-only claim #530 comment `5996398059`; root is the sole test writer. This reviewer writes only this new review. The earlier Z02 PR593 and its source repair are separate: this base still contains original Legacy SHA `1d3e51de…`. No tests, DB, native replay, typecheck, accepted outer flow or physical ACK were executed for this review. Both whole AT rows remain unapproved.

Routing: `spec-to-code-compliance` for the delegated frozen pair; `code-review` and read-only Supabase source/authority inspection; `verification-before-completion` for custody and honest limits. `fp-check` applies if forthcoming exact probes support a divergence. Implementation/TDD, native runners, browser work and unrelated security/performance scans are outside this assignment. No linked-rule implementation, shared source, fixture, native registration, SQL or coverage edits are authorized here.

## Complete frozen requirements

`docs/ediel/masterplan-v2/registers/acceptance_tests.json` entries `AT-Z05L-SUPPLIER` (line2808) and `AT-Z05LK-SUPPLIER` (line2888), joined to `CASE-Z05L-SUPPLIER` / `CASE-Z05LK-SUPPLIER` in `prodat_message_cases.json` (lines75/165):

- Given, both: **SUPPLIER; Z05L kan referera till Z08H; Z05LK kan vara följd av utflytt efter Z09E men är inte Z09E-svar.**
- When, both: **Nätägarens information till tidigare leverantör.**
- Expected L: **23-DDQ-PRODAT; BGM=Z05; fält223=Z22; CONTRL och tillämplig APERAK; normalt ingen egen affärsbekräftelse tillbaka.; Avsluta berörd leveransperiod vid angivet giltigt slut, planera slutvärden/slutunderlag; behåll historik.**
- Expected LK: **23-DDQ-PRODAT; BGM=Z05; fält223=Z23; CONTRL och tillämplig APERAK; normalt ingen egen affärsbekräftelse tillbaka.; Avsluta berörd leveransperiod vid angivet giltigt slut, planera slutvärden/slutunderlag; behåll historik.**
- Prohibited, both: **Fel roll, fel riktning, saknade R/D-fält, felaktig korrelation eller mutation ska inte verkställas.**

Cases specify `SUPPLIER`, inbound, `P §2.1–2.2,2.6; HB kap.4,10,11`; linked rules are TEN-05, P-01, ENV-06. L is old-supplier notice normally following supplier change, potentially the actual Z08H business response. LK terminates the old grid/customer relation; Z09E alone is no closure authority. Frozen rows currently say `Inte körd mot systemet` with empty evidence. This facit does not promote any row or linked rule.

## Original-source custody and limits

Retained original-P excerpt bytes independently rehashed against their existing evidence manifests: `permission-prior-flow-source-20260920/original-pdf-relevant-pages.txt` SHA `2c47643e08f555df3a53f1983fcd4bd6c51c698b08f65762e5097ee3eebdf23d` (99929 bytes), and `permission-ack-source-20260920/original-relevant-pages.txt` SHA `444c11045bdd5a9e1a6bd7735f16e13a42e5f03ed01eafe4e8a4d14053b91db6` (102742 bytes). The manifests identify original P PDF SHA `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`, 140 pages, electricity26.A revision3, effective2026-04-01, updated2026-06-30. The historical PDF path `/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf` is absent here. This is independently checked retained-text custody, not a fresh original-PDF hash or visual reread; gas16.B is excluded.

Retained full P pages13–15 establish grid-owner→old supplier, Z22=L/Z23=LK, BGM function without subtype and CCI/CAV subtype, the first-register R/D/O scope and §2.2 precedence over conflicting annex4. P122–123 establish code eligibility, field260 known recipient network area, LI for Z05L matching corresponding **eventual** Z08H, and LK/general LI nonblank. They do not require the old supplier to possess a new supplier's Z03. Field211 DTM93/format203 and 262 old-BRP facts are also in the frozen field table with original segment evidence/locators; this review does not claim a fresh full PDF page50 reread.

HB is inherited scoped source analysis: `e035-source-ledger/handbook-source-scope-20260923.md` and `handbook-lifecycle-design-addendum.md` cite recovered HB26A original SHA `3e30d38b5cea1682a210dcd9ec08e4d77091baa87a234baeb07b4e4789a0e9b3` (241 PDF pages). Its historical PDF `/workspace/scratch/db7cad0629c3/sources/elmarknadshandboken-26A.pdf` is absent here. The scoped analysis supports L supplier handover at00:00, LK move-out/decommissioning context and changed-end cancellation then new-LI flow. A00:00 LK control is a conservative supported subset, not a universal national LK-midnight rejection. Valid rescission/payment restart and erroneous-end correction must remain distinct. No fresh HB chapters10/11 reread or numerical national deadline qualification is claimed.

## R/D profile and positive-control requirements

Frozen Z05 first-register R fields: **311,312,202,203,313,205,206,207,208,314,209,211,223,260,226,227,228,231,232,316,233,234,262**. D fields: **310,229,250,251,252,253,317,318**. UD and IT parents are required; IV is dependent. This is not a blanket repeat of first-register requirements on later registers: actual annex2 register overlay must be respected.

| Control fact | Exact boundary / limit |
| --- | --- |
| Full physical L and LK | 23-DDQ-PRODAT, version association, legal FR/DO and country, BGM Z05, CCI Z13→Z22/Z23, sequential LIN and object identity, DTM93 valid stop, DTM137 and declared UTC offset, LI and valid three-character area. Syntax acceptance precedes any business credit. |
| Stop date / BRP | Field211 uses DTM93, format203. Field262 is NADZ02 old balance-responsible registered Ediel ID, qualifier160:SVK; it is not a Z02 message and is not automatically the tenant's current BRP. Field217 measuring method is not a Z05 R field. |
| UD / IT | Complete mandatory ID/name/postcode/city/country and installation ID/address. IT address is sent even when identical to UD. Field229 requires available end-user address; absence is not unconditionally a national error. |
| Death / IV | PC-310-Z05 requires death **and LK**, false→X. IV parent requires invoicee address differing from UD; active IV then requires250/251/253/317/318, plus252 when applicable. Derive conditions from qualified structure/source facts, not cached root metadata. Unknown local facts do not automatically prove external protocol error. |
| Correlation | L with an actual corresponding Z08H must share its LI and valid end. L without that optional prior request and LK use their qualified supply lineage/known nonblank LI; never demand a foreign new supplier's Z03 as a universal prerequisite. |
| No unwanted response | Policy/lifecycle may establish no own business response; genuine CONTRL/applicable APERAK rendering, durable completion and transport still need actual outer/native/ACK evidence. |

Reusable `prodat-register.ts` / `prodat-identity.ts` provide real encoding primitives. `closureWireFixtures.ts:6–22` defaults to stop12:34 and hardcoded `NET-1`, so its bytes alone are not a fully valid national positive: use an owned complete three-character-area body and source-qualified00:00 control without editing the shared helper. `supabaseMock.ts` supplies finite eq/in/count behavior; its unsupported `.or` semantics cannot certify real correlation. `closureOwnerFixtures.ts` is a serialized test shape, not permission to mint genuine accepted private source ownership.

## Source-to-effect mapping and probe priorities

| Frozen effect / prohibition | Actual consumer and highest-value app probe | Remaining boundary |
| --- | --- | --- |
| Correct L/LK meaning, no own business confirmation | `businessSemantics.ts:184–185`, `prodatRulebook.ts:108`, canonical parser/policy and actual `prodatLifecycle.ts:194–195`: termination / supply_ended / supply_terminated, endSupplyPeriod true, createSupplyPeriod false, correlation required. Use full valid physical controls through actual parsing/policy/lifecycle before calling the facade. | A lifecycle projection is not a role/direction or authorization gate; test those at the actual gated entry/adapter. |
| Affected supply only, valid source; rejected correlation/mutation does not execute | `supplyMarketTransition.ts:50–75` calls actual `ediel_apply_supply_source_v1` with only company/sourceMessageId/actorUserId. Alter caller hints and assert exact RPC arguments, genuine refused-result→manual_review/no final-case effect, unrelated role/direction/source refusal at supported boundaries. | RPC/table/authorization IO may be finite synthetic ports. App calls do not establish native source admission, valid lineage, lock/atomicity or persisted period end. |
| Final values/billing follow-up and preserved targets | Actual facade `inboundBusinessStateMachine.ts:183`→Legacy `272–303`; `endingPeriodScopes:97–103` selects company + returned ending/ended IDs; `createReviewCase:106–138` writes operational case. Compare genuine own period lookup control with lookup absence/error and stale cached hints; verify customer/point/site/switch/source provenance and idempotent no duplicate cases. No deletion or supply-start/grant-revival authority follows from an operational task. | Original Legacy `291–294` bypasses returned-period lookup when message.customer_id exists; `296–297` retains cached site/switch and point fallback. This is a **static probe candidate**, not a confirmed defect, exploit or accepted-flow finding. A fabricated native state/result cannot establish reachable wrongdoing. |
| Real committed end follow-up | `supplyEndFollowup.ts:9–20` passes only effectReceiptId/company/actor to real receipt projection and checks result identity. Existing adapter tests already cover this contract; avoid duplicating them. | Native `20261001054018…:15–74` derives task from committed effect, checks actor/source/current state, binds period/customer/point/site and persists once. Its source locks/receipt checks must remain the sole authoritative port. No native execution here. |
| Wrong R/D/role/direction/correlation/mutation has no business effect | Parameterized actual parser/field/policy diagnostic probes for selected omissions and role/direction/application-reference contrasts, plus real consumer source refusal and exact side-effect observations. Include corresponding legitimate controls and declare which boundary actually stopped each case. | Selected app probes are not complete R/D enumeration, native persistence/tenant/env approval or physical ACK proof. Diagnostic strings/metadata are not authority. |

Accepted outer flow is separate: `inboundProcessing.ts:1114–1169` invokes native source apply, projects each actual effectReceiptId, finishes source-owner session, then creates committed domain ACKs. It calls Legacy only for `fullyApplied && domainObjectCount===1` at1153–1157 and holds ancillary projection errors. A direct facade call with multiple physical objects or a fabricated accepted owner cannot be promoted to accepted-pipeline reachability.

SQL implementation handoff remains with existing source/native/coordinator owners. Static locations include `20260930161624_ediel_supply_market_source_lifecycle.sql` (base lifecycle), `20261001043234_ediel_prodat_supply_own_effect_partition.sql:168–248` (own complete-source object partition/receipts), `20261001115000_ediel_national_supply_rescission_atomic_original_and_matched_end.sql:189–245` (actual matched Z08H end and public wrapper), and `20261001142550_ediel_supply_wrapper_chain_union_order.sql` (canonical/union wrapper order normalization). These are source pointers, not a newly replayed current catalog. Existing `ediel-supply-market-consumers.test.ts` mocks lifecycle and has a bounded idempotent future-end case; `ediel-supply-end-followup.test.ts` is receipt-adapter coverage; `ediel-p-13-end-preserves-sql-regression.mjs` already covers bounded P13 preservation with declared PGlite ports and explicitly no native/legal approval. New profile probes must not recast these as fresh native evidence or duplicate another owner's producer/harness.

## Exact reviewed input hashes

SHA256 below was recomputed on this base for static facit/fixture and source-boundary provenance. It is not a complete transitive runtime receipt.

| Path | SHA256 |
| --- | --- |
| `docs/ediel/masterplan-v2/registers/acceptance_tests.json` | `e9aa623c8b54fabaedca1096fe1516a29a11569b65ee6e95736c82748c541a10` |
| `docs/ediel/masterplan-v2/registers/prodat_message_cases.json` | `77c5023457d8e405d6a560b2d2515679c2d7b59bf968800f35c16070e5f8eeee` |
| `docs/ediel/masterplan-v2/registers/prodat_fields.json` | `e1248f8f4ec025aa5d71e3b3249ee70b6e9e0d8e0e48a4ec6f0db11e31178354` |
| `docs/ediel/masterplan-v2/registers/prodat_conditional_cells.json` | `55d44fcf337b5a7c9508c50bd25b9f204128ae2939ee36e49e74072b031a4b5d` |
| `docs/ediel/masterplan-v2/registers/prodat_parent_groups.json` | `89d3d00ae091f85a11b88aff5761f63328023e7f553e1d44b04ff74a736a95c7` |
| `lib/ediel/rulebook/businessSemantics.ts` | `89037706cdf2433f0c3f5e08dcb079bbc564b2da5b2c8dd5b3e9d87dc4ab235d` |
| `lib/ediel/rulebook/prodatRulebook.ts` | `bc8a47b4e2b8860026ae179e65163986039b1838c802dea7aada7f346ce4336b` |
| `lib/ediel/rulebook/canonicalEdielPolicy.ts` | `b0029c768fd81edced23b829732aa534b27fa8e81a8b803d21a63783ec432ec9` |
| `lib/ediel/rulebook/messageFormatParser.ts` | `b13d4831eec16922e25cf009add1abe48b17ef29cf164f50210664d6112d255d` |
| `lib/ediel/rulebook/messageParser.ts` | `6f9d71114759e49f5c6245a88252d54ed75dae9c4e549580089d2580c5dccbb6` |
| `lib/ediel/core/edifactParser.ts` | `ae7d4c52730bb00a6a77eb59d61ca1cefc8086ad3e1c66d08347fb44b6646df2` |
| `lib/ediel/core/edifactValidation.ts` | `fde3d220220ee541e6e6b884921a1289eedcf14afa1f7e99a416e565c8cb0fcd` |
| `lib/ediel/core/runtimeDecision.ts` | `1d206dc599be538fa23af1fd555ca283f86f607187ae36ea17682ec06a3e64ce` |
| `lib/ediel/prodat/parser.ts` | `2deb1745cf6054b8ea7741b63d5acbcc9f62ea81e10f2001556bb8ee4c25354e` |
| `lib/ediel/prodat/prodat26AFieldMatrix.ts` | `a96b7dcddb564aad04d3be6ee7aef1117601eccd893b47869a8ddc60b3794382` |
| `lib/ediel/prodat/prodatApplicationObjectValidation.ts` | `72dd6d730ff55a55cde0969f4bb7465619b5a2a91439104f5365fbf939d36b3d` |
| `lib/ediel/rulebook/prodatDeathStatusPolicy.ts` | `84c73ac0287f060ca78d812aa73012c293a0309c426f355baf5171d4f27a8bdd` |
| `lib/ediel/rulebook/prodatInvoiceePolicy.ts` | `146eb7cf60e118ab5961f865290b03194eec1d13b209eb5236aaf7a34de1e110` |
| `lib/ediel/stateMachines/prodatLifecycle.ts` | `93ce2fbb1196b97a0148edcf9b20cf49d2bac6b9eefa1176fffbf5c5abb56887` |
| `lib/ediel/flows/inboundBusinessStateMachine.ts` | `d296385e2dcc5e8ad74eb8a9bf376d31fe0b5ca188331f5e6014a764eace80a6` |
| `lib/ediel/flows/inboundBusinessStateMachineLegacy.ts` | `1d3e51de42176234867d4e1546447c36eae44222e8d0ae04bed6e2db36f5d3be` |
| `lib/ediel/flows/inboundProcessing.ts` | `8ea6ffc72ff5d2bcfab1e89979afd4f35f1d103ce09247578a5cf34c99f502b2` |
| `lib/ediel/flows/supplyMarketTransition.ts` | `584e51953ca5da03ad9d216ce8e0e88cc09720b5dd1e7e8f6bcc7e4ec5995829` |
| `lib/ediel/flows/supplyEndFollowup.ts` | `01e00f9e60bfd06a3e3ad7758ae9da5531848344fde7c70e83408b1122221213` |
| `__tests__/fixtures/prodat-register.ts` | `14ee8729c0a2c020182791f0ef8aab3a1f7c6936313c39f6fd7556887a4ecec2` |
| `__tests__/fixtures/prodat-identity.ts` | `d590eeb86518b472943b70b4a09bc29a7c376e2aadf52c52e40ad6e46121fe9c` |
| `__tests__/helpers/supabaseMock.ts` | `d6da21184457bfe00bd31674ee5a58445ad9a67e50388fe97c0ccb5d6397775b` |
| `__tests__/helpers/closureWireFixtures.ts` | `118a13c22250002af48055fd09b7dcc089347c315ba837b4c92db4fde74eb4e5` |
| `__tests__/ediel-supply-market-consumers.test.ts` | `13fbf9d00f4458dd9892b286193208f2b2b2cca8b05a9124c69c7572e0c89ea2` |
| `__tests__/ediel-supply-end-followup.test.ts` | `843f9657101a88285c635175df950a9f52bd71558664ced411c310e757a91c6f` |
| `scripts/ediel-p-13-end-preserves-sql-regression.mjs` | `e0fdba4dabe049ed624ed7bff3a66dad4bca7d1f492c57151e1d64992bd97009` |
| `supabase/migrations/20260930161624_ediel_supply_market_source_lifecycle.sql` | `38a50e4f52293755553eeab543e9831ed53f03277b24d7bd5bfc2a41e2efd7e7` |
| `supabase/migrations/20261001043234_ediel_prodat_supply_own_effect_partition.sql` | `a9e0a3e12f4c0df878259799e2d00ea248ab542dea9929c1be692b50f07ec2d2` |
| `supabase/migrations/20261001054018_ediel_supply_end_followup_receipt_command.sql` | `faec77f0cadcc85e77605e2be902755aea76f64fbb91d9c0926eba5847dc5084` |
| `supabase/migrations/20261001115000_ediel_national_supply_rescission_atomic_original_and_matched_end.sql` | `758889e9bfa112fe2fbe3417bbd3755394bc81c6de9b735720950af4f3102217` |
| `supabase/migrations/20261001142550_ediel_supply_wrapper_chain_union_order.sql` | `52674722fd38d9dd60132417a445fe1e2f7e383440e191e0b37d1393a040ee9d` |
| `quality/audits/ediel-masterplan-v2/f3-permission-prior-flow-source-20260920.evidence.json` | `219090eb7419796126f6d00b0aeac891583d2c61339876dac865e1def57a675c` |
| `quality/audits/ediel-masterplan-v2/f3-permission-ack-source-20260920.evidence.json` | `0e6ff6432afbdc3c73f8523b6a498c0ab6d2f15e11da0af534b09dd3f9e5d95f` |
| `quality/audits/ediel-masterplan-v2/e035-source-ledger/handbook-source-scope-20260923.md` | `2d4c5c4a2fbc42b4542564d6cb73744bf9c086fbfb13a4928fb874db7a212d32` |
| `quality/audits/ediel-masterplan-v2/e035-source-ledger/handbook-lifecycle-design-addendum.md` | `6903216b49ca97f240823a6ea8b046ef5426dee98a912611d1ce82c7c110fbd2` |

Checks performed: read-only `git status` / `git rev-parse`; exact JSON entry extraction; `rg` searches for Z05 consumers, exported policy/parser entry points and `ediel_apply_supply_source_v1` / `ediel_project_supply_end_followup_v1`; numbered source reads; Python SHA256 and historical-PDF existence checks. Earlier scout custody outside repo: `scout-next-free-pair-20261005T135319Z/scout-z05l-z05lk-and-z02-writer-ownership.json` SHA `5d557e226d8117cee360f705237fdb3659ed884f887159d134dc817b55d902fd`; that preclaim inventory is historical and is superseded for ownership by parent's explicit new claim. Current source/app probes, accepted/native persistence, physical ACK, all R/D conditions and whole-contract result remain NOT_RUN / unqualified by this review. No missing implementation or product vulnerability is inferred from those limits.
