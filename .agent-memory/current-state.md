# Current state

Updated: 2026-09-12.
Status: IN_PROGRESS.

## Scope and active task

Finish the existing work and masterplan77–85; stop before86. The user has explicitly authorized necessary commits, pushes, migrations and merge to main, subject to actual verification. No new approval is needed for already authorized work. Never infer whole-plan completion from a bounded application/native proof. No production database mutation or main merge has been performed by this continuation.

Active task: Task10b2a, closed JSON contracts for seven internal billing/pricing/spot POST routes. Implementation and local verification passed; publish the atomic batch, collect supported hosted CI, then continue the six invoice/Ediel and five platform JSON routes. Current record: `quality/audits/ADMIN_JSON_SEVEN_ROUTE_REMEDIATION_2026-09-12.md`. Independent review is not claimed for this new implementation.

The previous Task10b2auth implementation is already published at6e4d2190478329b5565bcf7ec6820ce15fef5009. GitHub quality-release-gates job103575728105 (OPS34702159960) passed lint, script/test types, tests, API contracts, RBAC, build and budgets. Its 71 real-route tests also pass locally with the new JSON changes. Do not redo the accepted authority correction or confuse it with the new schema task.

## Local workspace and verification

The current working environment has a source+dependency snapshot from owned CI artifact10301238629/run34704968297, GitHub commit9c4e93f6/tree232663b021a581e1eb22ce6aba91af5f94e37294. SHA256 receipts and the exact Git tree matched. Local Git history is a synthetic offline snapshot, not upstream commit history. No deployment secrets or customer data were fetched. The temporary workspace-export workflow is removed after its artifact is retrieved.

New seven-route tests: 165 total, 78 expected failures against original route bodies; all165 pass with the fix. Existing company-authority71 also pass. Full local suite:210 files/1840 tests PASS using two workers. Test typecheck and targeted ESLint PASS. Local Node22.16.0; dependency archive Node22.23.2. Hosted CI must be checked on the exact published head before acceptance.

## Accepted work retained

- Task10a body/auth and Task10b1 strict public schemas were accepted on their exact recorded CI heads;1604 tests/build on d731b76d belongs to that earlier head, not later candidates.
- Task4 monthly company failure isolation and global-schema propagation; Tasks6/13 application billing evidence and tenant wrapper guards; Task7 manual-email fencing and company pagination; Task9 API company authority; Task14 server-action authority are bounded accepted application work.
- Task11a source-composed canonical permissions/private-Storage metadata behavior and Task11c diagnostics have bounded native/application receipts. They are not a deployed migration or full RLS matrix.
- Actual migration prefix77 has bounded native acceptance only. It is NOT masterplan77 (RLS tests), and does not prove a complete600-input replay.

## Open merge blockers

1. Full clean replay rejects the unsupported CLI/native target; reviewed ownership/reference/private logging and complete migration source effects remain incomplete. Keep the fail-closed guard.
2. Generated types/manifest tail check fails at20260911114443. Generate from the complete accepted canonical replay; never update the tail/hash from partial replay or the live database merely to pass CI.
3. Accounting remains600 inputs:558 selected/23 substituted/14 unclassified/5 excluded;37 global and30 focused dispositions unresolved.
4. Remaining Task10 JSON routes, partner-price idempotency and move-out contract release.
5. Task11b complete two-tenant CRUD/ACL/RLS; Task12 atomic invoice events; Task15 native billing evidence and dispatch reservation; Tasks16–18 ownership, scale, recovery and native job contracts.

Task12's current-observed normal/Partner/portfolio prerequisite graph was ready to author a bounded fixture (53 relations/105 functions); no transaction fixture or migration was authored. Historical source admission remains blocked. Task11b's current-observed dependency profile was ready to author separately from historical source authority. Task15's21-relation/33-function observation remained under dependency assessment. All trigger/ACL/parent/setup effects and separately timed observations must be preserved. Full details and source pins are retained in the archive below and the existing audit contracts.

## Connected runtime observations

Vercel projectprj_xA3EDI1xztkkyx21e3LY4UhgYrWt is linked to heke99/gridex-ops-platform; production deploymentdpl_6qevcw57wT7X2p5yd5rQA7hzRq8c is READY. Supabase projectpiidsfebjqjmnepdpnas is named gridex-ops-dev and ACTIVE_HEALTHY; do not infer deployment-to-database binding solely from these names.

Read-only runtime error inspection and matching catalog constraint reads confirmed two additional defects to remediate: platform market/geodata events omit event_scope and hit canonical_energy_flow_events_scope_check; the DQ metering_points→customers embed is ambiguous between two tenant-composite FKs. No row data or secret is needed in the durable record. Preserve tenant checks; do not remove constraints to hide either failure.

## Continuity

The complete superseded state (including all acceptance receipts, historical source boundaries and pinned observations) is preserved at `.agent-memory/archive/pre-api-json-20260912/current-state.md`. It is history, not the active task. Continue using `quality/plans/2026-09-12-current-and-plan77-85.md` and its linked native contracts. No changes to immutable migrations, manifests or SQL candidates have been made in the JSON batch.
