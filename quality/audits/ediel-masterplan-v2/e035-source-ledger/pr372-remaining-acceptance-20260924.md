# PR372 remaining acceptance — 2026-09-24

## 2026-09-25 replay checkpoint

Published `4c05b146` passed verify, quality/build and 335/335 native tests in OPS `36127254985` (job `108046110819`), including the scoped `cases.write` denial/allow path and six Storage mutation cases. The clean replay then stopped at stale generated types, before tenant/parity/schema completion. Authenticated artifact `10860308328` (ZIP SHA256 `40f63743c7454f3de7abb9ad2085f0060194a322350f96d42b4e9a3a767ab849`) produced types SHA256 `36e98937` and schema fingerprint `c3ec834f`; exact files are copied locally pending publication and same-head replay. The older Storage `unconfirmed` failures remain without a reproduced failed stage or causal repair. Task 3b/4 historical and negative-case qualifications and independent final review remain open. `complete:false` is retained. This checkpoint supersedes the older head label below for current state.

Current verified head: `691184408b56231978e469e71d26f05ee31a5dff`.
OPS `36053110405` passed verify, quality/build and clean replay with 322/322 native tests; tenant, Ediel, browser and full E2E workflows passed. This is a bounded checkpoint, not Task3b/Task4 or PR acceptance. PR310 is excluded.

| Requirement | Implemented | Relevant verification | Final acceptance |
|---|---|---|---|
| Prospective twelve-table facts, scoped gaps, witness/readset and immutable archive transitions | Yes | Native 322 includes graph CRUD, cascade/SET NULL, actual archive, swallowed event, real claim, rollback and cancelled-contract guard | Open: signed finalization and remaining producer classes, history/retention limits need explicit qualification. Pre-epoch history remains `complete:false`. |
| Five-owner combined saved receipt | Yes: source, process, concern, outbound and document in one SQL SELECT | Native populated Z08H and actual document attempt; concurrent uncommitted process and concern excluded, later same-cutoff read includes them; saved bytes/hash checked | Open: actual UTILTS consumption on a witnessed C, further cutoff/overflow/failed-read and tenant negatives. |
| Actual E30/E66/S07 hold-only behavior | Comparison hook invokes combined RPC and holds on unavailable source | Existing focused unit regressions and prior native Z04/closure tests | Open: native correction C on an otherwise matched actual UTILTS path, decision receipt and business effects. |
| Whole-PR delivery | Draft, 139 changed files against main | Same-head CI on 6911844 | Open: independent full-diff review, all blocking findings resolved, final-head CI and merge check. |

The next local candidate adds real Z04 supply/switch, legacy end process assertions and witnessed C → E66 internal hold. It has local type/lint checks only; do not count it as native evidence until a later published head passes.

Skill routing: `using-superpowers`, `executing-plans`, `acquire-codebase-knowledge`, `supabase`, `supabase-postgres-best-practices`, `test-driven-development`, `systematic-debugging`, `spec-to-code-compliance`, `differential-review`, `verification-before-completion` and `finishing-a-development-branch` apply. `requesting-code-review` is pending frozen final diff. UI/design/performance and skill-authoring groups do not apply to this bounded data-path batch. No parallel agents were dispatched.
