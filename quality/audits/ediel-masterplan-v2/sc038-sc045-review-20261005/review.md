# Independent SC-038 / SC-045 contract review

Reviewer: Codex sc038-sc045-review-20261005. Review-only claim [#5305991409356](https://github.com/heke99/gridex-ops-platform/issues/530#issuecomment-5991409356).
Reviewed main: `01b11f55af710c3e6aad1f5a433631a88c702047`, tree `cc0b6412e13c04f6baa3413957c7b609aeba74be`.
Product/test/coverage ownership remains with Claude; common composition and merge remain with the retained coordinator.
Final findings delivered in [#5305991575077](https://github.com/heke99/gridex-ops-platform/issues/530#issuecomment-5991575077).

## SC-045: complete code-contract evidence; recommend approval

Frozen literal: mandatory national header fault plus later faults; negative header-level U-APERAK; no subsequent functional checks, invented original transaction references, or earlier E10 selection.
Rules: U-03 and ACK-03; frozen U25-A-4, effective 2026-10-01, U §5.2–5.5. Original source hash is in the frozen source manifest. This review uses the frozen contract and installed guide owner; it does not reinterpret an unseen newer edition.

| Required effect | Actual witness |
|---|---|
| Later fault is genuine before header failure | `scripts/ediel-utilts-err-gateway-native.test.ts:319`: valid-header contrast accepts IDE1, rejects IDE2 functionally; real native consumer stores only IDE1 and creates IDE2 ERR. |
| Syntax first; mandatory header failure blocks later functional processing | Same case removes206, repairs UNT count, asserts syntax accepted and no functional issues. Engine performs guide-only pass before eligible functional pass (`lib/ediel/utiltsEngine.ts:903`). |
| Real header-level negative U-APERAK | Native intake/owner/DB path creates exactly one APERAK: D04A/E5SE5A, BGM313, ERC41, FTX206, DOC to physical original E66/BGM and one own DM. |
| No invented IDE/ACW; no premature E10/ERR | Exact native wire has no ACW; no UTILTS_ERR, no accepted reservations, series, contracts or outbox. Unit `__tests__/ediel-sc-045-048-utilts-scenarios.test.ts:12` also covers present-but-invalid206 plus object fault and ERC42 without transaction reference. |
| Correct original ownership and stable persistent result | Every own native reservation is finalized to the same ACK; tenant and inherited source policy are asserted; second actual consume yields identical snapshot. |
| No forbidden downstream calls | Metering/billing/completion observation spies receive no calls. These mocks prove exclusion of calls, not the sinks' positive writes. |

Additional unit gateway case `__tests__/ediel-utilts-err-gateway.test.ts:264` covers actual gateway/renderer and stable replay with finite source/transport/DB ports. Header facet suite covers decoded wire and provenance. Native reservations, ACK writes and source ownership are real. External issuer inputs remain synthetic; no transport worker or market acceptance is claimed.

Qualified evidence was reused, not rerun: OPS run37281693425 on `445bf50942818495f7edc09f52a2288be81ad176`; quality job111671247914 passes gateway22, scenario2, header3 and complete unit10304/807. Clean job111671247602 succeeds. Artifact11334955859 SHA256 `33b1207eb2efda48feebfaa7c048bc6e1f0f7a7ea9f863e36aed79bd10b0f597` matches downloaded bytes. Exact selected SC045 native case passes without skip/error/failure; full native XML contains609 cases, zero errors/failures and one unrelated skip. We do not report all609 as passed.

21 reviewed current-main blobs match local files; 19 direct witness/consumer blobs independently match the qualified CI source and main. The review does not certify unrelated future compositions.

Next owner action: add SC045 tags to the existing gateway/native suites, union their evidence with the existing SC045 row and set that row PASSED in the owner's small PR after applicable exact-head checks. No additional production implementation, duplicate test or fresh native run is requested for unchanged witnesses. Main still has PARTIAL; this reviewer does not edit its row.

## SC-038: positive D and installed-consumer proof remain open

Frozen literal: correct distinct grounds for assignment and production receipt obligation; receive each message; use its special process/controls; no general own-Z03 prerequisite may block the valid processes.
Rule P-12 requires respective role, contract, grid area and production linkage; frozen P26.A/16.B and HB26A. Frozen plan ST-S08/ST-S09 and message-case rows distinguish Z26 assignment and Z70 production/field319; production must not overwrite consumption.

| Existing evidence | Proven scope and limit |
|---|---|
| `scripts/test-ediel-p-12-z04ad-scope.cjs` → `ediel-p-12-z04ad-scope-sql-regression.mjs` | Uses the actual older regulated scope/archive/review/apply bodies. Positive selector is assigned_supply; wrong role/contract/area/D-capability/source-reference hold. |
| `ediel-regulated-supply-ground-sql-regression.mjs:61,100` | Signed synthetic assigned ground produces Z26 period without switches/outbox; replay and current-ground invalidation are asserted. Its final D selector is held, not positively applied. |
| `__tests__/ediel-supply-market-consumers.test.ts` | Assigned caller exclusion of ordinary Z03/client mutation is tested, with lifecycle and RPC results mocked. Those mocks do not prove SQL checks or D registration. |
| Regulated native archive/review suite and browser-native receipt | Qualifies assigned ground, custody, permissions and rollback; no positive Z70 application. |
| D product implementation | Ground scope lines86–90 and regulated apply lines259–263 check production point, same-tenant/customer consumption relation and physical linkage. This code is not a D-positive asserting test. |

Unproven predicates:
1. Produce a valid separately reviewed D scope through the existing public ground producers, with a current qualified consumption supply and physical319 for that same tenant/customer.
2. Pass an actual Z04D/Z70 original with no own Z03 through the currently installed public supply consumer, assert separate production relation/source receipt and correct start; preserve the existing consumption relation.
3. Prove missing/wrong/revoked production linkage/ground/role holds without ordinary-Z03 fallback or unauthorized mutation.
4. Qualify the A witness through the current wrapper/own-object partition chain, or demonstrate its unchanged execution path precisely. The referenced PGlite suite installs20261001004331; later public wrappers include own partition20261001043234, bilateral closures and20261001115000. It does not directly execute that installed entry chain.

Keep SC038 PARTIAL. No unsafe product behavior was reproduced; this is missing effect proof. Extend the existing source-owned integration/native fixture. Do not directly seed private approved ground/receipt rows or create another validator/harness.

## Verification and scope

Fresh local integrity command passes33 original files/121 rules/231 contracts, with specification/reference scope only. Two scripts pass Node syntax checks. The local P12 behavior attempt fails before SQL because PGlite is absent; default Node is24.19.0, not canonical Node22. Git fetch fails before network access because the configured proxy is unreachable. These failures remain recorded in `source-and-ci-receipt.json`; they were not converted to green.

GitHub reads supplied the current merge, changed files and signed commit. The independently reconstructed source tree and authentic commit hash match current main; only this isolated review branch was advanced. Shared source/memory/coverage are baseline imports, not new proposed edits.

Skill routing: using-superpowers (task routing), using-git-worktrees (required isolation), code-review (whole contract/call-chain), verification-before-completion (actual receipts), cloud-environment-runtime (access/network evidence). No architecture ambiguity or production remediation is requested here, so brainstorming/TDD/refactor and database modification workflows do not activate. This is a bounded contract review, not a repository-wide audit/security/performance/UI/hook assessment; those groups are not run. No subagents were spawned.
