# Canonical tenant backfill parent agreement — 2026-10-01

## Actual defect and resulting behavior

The existing repair scripts independently joined each registered parent. A historical metering_points row with company_id NULL, customer parent A and site parent B was classified twice as safe_fill_from_parent, then filled from the first parent. Missing parent rows and parents with unknown company could also be ignored while another relation filled the child. Existing non-null tenant mismatches were preserved at company_id but still acquired correlation_id and an audit entry. These are actual PostgreSQL-core results from the unmodified scripts, not hypothetical external blockers.

The bounded repair preserves the original **18 relation triples exactly** in both scripts. Before any persistent write, both gather every non-null linked parent reference and classify once per child. Exactly one known parent tenant and no unresolved reference is required for a null fill. Different tenant parents remain ambiguous_cross_tenant_conflict; missing rows, absent linked parent surfaces and unknown parent tenants become manual_review_unresolved_parent. A nullable optional reference does not invent another parent. Existing non-null mismatches remain untouched. Dry-run outputs the detailed conflict/relation list without persistent mutation.

Apply holds ordinary SHARE ROW EXCLUSIVE locks on all inspected existing parent/child tables in sorted order for the complete transaction. This stabilizes the evidence before writes; it does not switch role, disable RLS, grant access or bypass constraints. One grouped null-to-agreed-company update emits one original canonical_multitenant_company_id_backfill audit with old/new values, safe_derivation and all source parent relations. The existing UUID correlation repair remains, but skips every child classified for manual review. Correct repairs add one audit per actual effect; repeated execution adds none. A late audit failure rolls back the whole transaction. Both scripts remain standalone operator scripts; no migration, global schema object, production grant, workflow or hosted data mutation was added.

## Executed RED and GREEN

Repository TDD and writing-good-tests guidance were applied to real SQL execution. Initial exact original-source run: **3/10 PASS, 7/10 FAIL**. Failures were false-safe classification and actual company/correlation/audit effects for differing, missing or unknown parents, plus correlation mutation for a known non-null mismatch. After the first bounded repair, **10/10 PASS**. Adding absent linked parent surface exposed an additional actual **10/12 PASS, 2/12 FAIL**; retaining placeholder unresolved evidence instead of skipping the registered parent fixed both. Final exact-source verification is **12/12 PASS**.

Command: NODE_PATH=/tmp/ediel-service-check/node_modules /tmp/gridex-event-v2-node22-cache/_npx/52027bd8fc0022aa/node_modules/node/bin/node --test scripts/canonical-multitenant-backfill-agreement-20261001.postgres.test.cjs. PGlite0.3.14 executes the complete dry-run and apply SQL, with only psql presentation directives removed. The minimal typed historical fixture has nullable UUID company_id and real PostgreSQL transaction/audit behavior; it does not alter or disable any production constraint. Cases assert dry-run no mutation, manual rows no company/correlation/audit effects, agreeing parents one company and one correlation audit, replay exact unchanged state, authenticated caller's actual42501 table denial and injected late audit rollback. Original18 relation inventory equality, Node22 syntax and git diff --check PASS. Existing canonical-multitenant-platform-regression.cjs static regression also PASS.

## Honest acceptance boundary

Native/Supabase runs **0 / NOT_EXECUTED**. The fixture is an old nullable shape, not a claim that current NOT NULL/composite tenant guards permit dirty new rows. No real historical tenant inventory was read, repaired or approved. Full historical replay, native RLS/grants, independent-connection lock behavior, all customer/contract/invoice/partner business semantics and production-scale lock timing remain to be exercised in their proper corridor. The lock syntax is executed in core; concurrent blocking is not certified by a single connection.

The current explicit 18-relation tenant inventory remains the scope. Unlisted relations and customer-resource identity consistency beyond tenant equality are not inferred. A child whose linked parent tenant is unknown is left for manual review; resolving/repairing its parent can make it eligible on a later fresh invocation. Existing conflicts are never moved automatically. This packet is a concrete local advance for P8 backfill/conflict-list proof and T49 tenant relations, not blanket completion of P8/T49 or permission to run a hosted backfill. Feature rollback, issued-history preservation, logical/hosted restore, incident drill and tenant pilot remain separate evidence requirements.

## Frozen source manifest

| Path | Git blob | SHA256 |
| --- | --- | --- |
| scripts/canonical-multitenant-backfill-dry-run.sql | a445e68641b7a01f3388739c96470f62464a8f81 | 9c23172b13bf27d28a2f84ed9c2b0141b286e56052b673226667a9db06b0b3a9 |
| scripts/canonical-multitenant-backfill-apply.sql | a8796cacde556a865a7a91957aad694f54130534 | ba07547e3e9983738db2345f08aec15d65c094acdedd63364fd820c5c9bdafe3 |
| scripts/canonical-multitenant-backfill-agreement-20261001.postgres.test.cjs | 43da2548578352d3571f4551e0f51b35eba96b05 | 4939b042a116e7f5fad3b4292ed7a7879f3c24b8f7e56a17e267dc4e812f02a0 |

Report hash is provided separately. Only these explicitly reserved repair scripts and new test/report were written for this correction.
