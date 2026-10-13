# C1 projection helper checkpoint

Agent `codex-C1-projection-fix-20261013`; packet `b996413c-5dbd-475d-bfa6-228e85dddb7b`;
epoch `gridex-five-agent-20261012`; delegated by `codex-five-agent-C1-b7e2fae0`.
Branch `codex/c1-projection-fix-20261013`; source `8cc1a153e9edb2971c16f2be86b9b2250563508d`.
Exact five-file custody receipt `ab09534aaab3a9b1e13188ba102184462bd978b5` is root verified;
helper independently read all five refs MATCH (initial unique checkpoint HTTP401
resolved by one later exact authenticated read, with no ownership mutation).
No technical writes before root verified handoff. C3 transferred only `inboundProcessing.ts`.

Skills: systematic-debugging, test-driven-development, using-git-worktrees,
verification-before-completion; relevant local Supabase tenant/currentness principles.
SQL/GEN/native/artifact/ledger and broad audit/UI/performance scope excluded.

Taken: preserve complete DB gate result during actual Z02 worker finalization;
generic linker must omit clearing the authoritative Z02 original relation on replay.
Source findings: worker final result drops original `z02_*` receipt;
generic linker passes explicit null relation. The separate core SQL delegate owns
initial authoritative `related_message_id=v_original.id` assignment.

Completed: read-only tracing and isolated clean worktree setup; five existing
baseline worker/receipt controls pass on Node22. New regressions executed against
unchanged production source: 2 expected failures (canonical result dropped and
original relation cleared), 11 contrasts pass. Applied only two minimal fixes:
spread the original job result before final fields; omit Z02 relation reset.

Verification: new regressions GREEN13/13; affected actual modeled Z02, held-history,
source coordinator, Z01 worker authorization and existing receipt controls
210/210 in eight test files. Full nonincremental app TypeScript passes.
ESLint has zero errors and one existing unrelated `priceArea` unused import
warning in part-2; both new tests lint clean. Large-file budget and diff check pass.
Tests TypeScript caught an incomplete new JobRow fixture; corrected it to a
complete typed lifecycle row, final13/13 rerun and full nonincremental tests
TypeScript both pass. The AST linker regression executes the actual production
private declaration, not a copied implementation or source string assertion.

Limits: root alone collected original native run38313929374; this helper has
read only finite published qualification. Root corrected mutation1521 to
`sourceRules:null` becoming the first immutable receipt, not a timestamp change;
this independent lifecycle/oracle issue is untouched. No whole-ID credit.

Next: hand off exactly these five postimages to root for independent review,
normal integration, sole native publication and current-head gates. This helper
explicitly authorizes root's receipt-matched transfer of only these five file
refs after source freeze; no producer, GEN, ID, slot, ledger or other C3 refs.
No remote push or CI_GREEN/whole approval asserted for this local prepared source.


## 2026-10-12 23:12 UTC — independent review false-positive correction
A/B proved actualdb.ts linkEdielMessage maps BOTH null andundefined to omission. The earlier synthetic link-port treated null as clearing, so that modeledRED/reset claim was false. Root removed behavior-equivalent inboundProcessing source delta and redundant invalidport test; actual core2310 initialrelated_message_id fix and realworker resultretention remain. Earlierhelper210PASS included that synthetic port; it is datedverification, not evidence of a generic-linker defect. Positive firstreceipt oracle now reads exactauthoritative sealed.inboundContext.context.sourceEdition, matching SQLrequire_v1, plus ready/sourceidentity and nonnull checks; no assumptionthat executionContext owns edition. Explicit preconsumer sourceRulesNULL retained, fullbirth/firstnamedreceipt/fullpostcapture replay asserted, alloldnegative regiona085 byteexact. Next exactnewsourcepeerrebind before sole114e GEN; original113/newnative stillNOT_RUN.
