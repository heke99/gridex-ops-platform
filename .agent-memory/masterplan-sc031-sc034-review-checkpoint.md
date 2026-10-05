# SC-031 / SC-034 independent contract review

Status: UNDER_REVIEW_SOURCE_OWNER_ACTION_REQUIRED. Agent: Codex current session.
Scope: independent static review plus bounded actual-module reproduction.
Branch: `codex/ediel-sc031-sc034-review-20261005`.
Worktree: `/workspace/gridex-ediel-sc031-sc034-review-20261005`.
Date: 2026-10-05 (Europe/Stockholm).
Exact baseline: `985724f58ef15e222cf4d3b2e1c643c674852106`.
Main tree: `0b8ad8d2272f77a346781a13b909aa0cdcc9b8d1`.
Live main API and default-branch coverage blob independently match the checkout.

## Ownership

Owner request: #530 comment 5990498953 asks for precise unproven clauses.
Review-only claim: #530 comment 5991247216. Claude retains implementation,
tests and coverage. Our only paths are this checkpoint and
`quality/audits/ediel-masterplan-v2/sc031-sc034-review-20261005/`.
No shared memory, production, migrations, schemas, existing tests or coverage
may be edited under this claim. No transfer of implementation ownership.

## Skill routing

Active: cloud-environment-runtime (runtime access), using-superpowers (routing),
using-git-worktrees (isolation), spec-to-code-compliance (two separate literal
reviews), code-review (real callers and asserting tests),
verification-before-completion (scope-qualified results).
Conditional: fp-check for a specific alleged defect, systematic-debugging/TDD
only after an owner-cleared confirmed defect. Supabase/SQL/security baseline,
UI, performance, deployment, supply-chain and hook workflows have no trigger
in this bounded read-only contract-evidence review.

## Current evidence and limitations

Pinned review baseline985: 121 rules (91 VERIFIED, 25 NOT_VERIFIED, 5 PARTIAL);
231 contracts (111 PASSED, 99 NOT_EXECUTED, 21 PARTIAL). Total approved: 202/352.
These are pinned-main-only counts, not sums across branches. Latest observed
main advanced through #563 to `01b11f55af710c3e6aad1f5a433631a88c702047`: 91
VERIFIED rules +113 PASSED contracts =204/352. The five changed paths exclude
every input listed in both review hash inventories. CI receipts stay pinned to985.
Specification/evidence-reference integrity: PASS, 33 original files,
121 rules, 231 contracts. This does not assert application conformance.
Dependencies are absent; focused Vitest suites have not been run locally.
Shell `git ls-remote origin refs/heads/main` failed: proxy:8080 unreachable.
`gh auth status` failed for configured GH_TOKEN. No credentials were printed.
GitHub connector reads and the explicit review-only board comment succeeded.
Current main full E2E run 37281682654 failed; do not infer all-green status.
Current unchanged ordinary witnesses are reused from exact985 Actions logs:
SC03113+20 cases, energy-product8; SC03432+50 cases. Those executions do not
close whole scenarios. Root additionally reproduced the actual syntax/matrix/
register-wrapper discrepancy with two syntax-valid controls. A second reviewer
independently failed to refute the bounded missing-direction finding. No native,
whole-scenario, market or production acceptance is claimed.

## Completed review and saved receipts

SC031: actual wrapper wrongly blocks guide-valid extra213 because inbound
context is lost. The case throw and authenticated DB/ACK effects are traced
statically; they were not executed. Owner notice: #530 comment5991392412.
SC034: no established product defect; missing full processor/physicalBGM27
firstLIN2 and globalwrongorder proof, plus discriminating native sibling checks.
Both statuses remain PARTIAL; all coverage rows are unchanged.

Reports, original input hashes, current CI excerpts, the bounded probe/source
and verification outcomes are under the own review directory. Root independently
verified all44 SC031 and17 SC034 input hashes. The first root verification parser
failed because it assumed Markdown rows for SC031's JSON hash map; corrected
parsing passes without changing an input or weakening an assertion. Failed shell
access and current release8/73 failure remain recorded; no green status replaces
those results.

## Published packet and exact commit

Draft PR: https://github.com/heke99/gridex-ops-platform/pull/571
Verified published report commit: `713b781781695fef56db01818ab70e3761539d14`.
Verified local/API tree: `6ceff9327654313f74f8609676f5c5adcea11a5b`.
The exact remote commit object was imported into the local Git object database
and the own branch advanced with an expected-old-ref check; the worktree was
clean at that commit. Original main parents and other checkouts were preserved.
Initial import assumed +0000 header offsets and failed without changing branch
or files; verifying the commit hash with actual +0200 offsets succeeded. Source
and report bytes were not rewritten to fit a receipt.
The current document-only follow-up records this publication; its HEAD is read
from Git. The report commit above remains the pinned review version.
Current draft/new-head CI is unverified; no merge or approval is claimed.

## Next action and ownership

Deliver the published full-clause handoff on #530. Shell git publication remains
unavailable, but connector GitData publication succeeded without force updates.
Claude owns the existing inbound case/source fix and new coupled scenario tests.
The retained coordinator owns source/capture composition, native qualification,
release failures and any eventual merge. No source takeover or merge is performed
by this review lane. No user ownership clarification arrived while this independent
work proceeded; the safe review-only lane was kept.

The full masterplan remains incomplete. Source-owner fixes, complete native effect
proofs, required review/CI and integration are outstanding, with external market
proofs separate. The documentation packet is under review; source approval
and main integration are not inferred from its publication.


## Supplementary owner question, no additional implementation claim

Claude's #530 comment5991330206 acknowledged the SC031/034 review and asked
about native clock control for SC037. Read-only reply5991607205 found no existing
sanctioned DB-clock control in the bounded helper/native/workflow search; JS fake
timers do not control pg_catalog.now. Existing future/past-period SQL plus TS
readiness are component witnesses. Whole same-period before/start native effects
remain unproved; no production clock parameter, protected timestamp mutation or
new clock harness was approved or implemented. The retained native coordinator
owns any isolated DB timing qualification. The existing normal-switch SQL fixture
uses synthetic activation effects and must not be represented as native proof.
This reply introduces no SC037 coverage edit or ownership transfer.

## Independent review corrections (2026-10-05)

CodeRabbit review5412816395 at c25a1a73 raised two minor evidence-integrity issues.
Applied receiving-code-review workflow: verified both against retained bytes.
SC034 now labels failed FullE2E37281682654 as historical985 baseline, not current
PR head. The exact previously executed probe source is archived byte-identically
(d65352eb...) separately; original sc031-probe.json remains ee567670... unchanged.
The capture recipe checks exact clean HEAD before loading and before writing,
records that checked revision, and uses exclusive creation to refuse overwrite.
Syntax passed; refusal invocation hit sandbox spawnSync git EPERM before its
assertion. No refusal assertion success or full probe rerun is claimed.
Technical packet713b781 remains immutable historical evidence. No product/test,
coverage or shared memory edit; retained owners keep implementation/integration.
Latest observed mainfb11952 records206/352 approved entries; SC036 whole approval
is disputed by its independent reviewer in #5305992400012 and is not endorsed
by this review lane. SC031/034 remainPARTIAL; merge not performed.
