# Task 2b fix round 3/5 — supply graph negative fixture

Base: published `9e28bc1d0daabfcca3ed6377afca3733d7b7b663`. The prior customer-read registry repair is qualified; the actual OPS35947668822 native job107469127017 executed 262 cases, 261 passed and one failed at `scripts/ediel-document-reference-native.test.ts:158`. Expected recorded/unavailable for a purported unlinked same-company supply; actual recorded/verified_at_observation. No production data, earlier migration, generated contract, or authorization code is changed in this round.

## Root cause

The native fixture seeded both `customer_supply_periods.customer_contract_id` and `contract_id` with the same contract ID, then updated only `customer_contract_id=NULL`. The actual before-update trigger `a_customer_supply_periods_contract_alias_v1` in published `20260727010000_contract_flow_integrity_completion.sql` runs `gridex_sync_supply_customer_contract_v1`, which sets `new.customer_contract_id=coalesce(new.customer_contract_id,new.contract_id)`. The original link therefore remained. The published document graph explicitly joins `sp.customer_contract_id=c.id`, so its eligible result and bounded Storage read were correct for the persisted row. The failing assertion did not represent an unresolved graph. The customer chain guard permits both contract aliases to be null while retaining company/customer/metering-point identity.

## Narrow correction and proof

The same native negative now clears both synchronized contract aliases in a single update and asserts that the persisted row has both null. It then checks recorded/unavailable and spies on the Storage boundary to prove that all five unresolved same-company graph variants make no Storage read. It keeps the source, document, customer, site, point, supply and actor fixture and every other assertion; no SQL forward is necessary or permissible for this fixture-only defect.

RED: authentic native 261/262 with the single supply failure above. GREEN local: `npm run typecheck:scripts`, `npm run typecheck:tests`, targeted `npx eslint scripts/ediel-document-reference-native.test.ts`, and staged diff check exit 0 under Node 22.23.2. No local database/Storage service is available; no native PASS is claimed for this changed test. Parent must publish the reviewed exact commit and rerun genuine clean replay/native tests (262 expected), then continue authentic generated schema/types reconciliation and same-head gates. This fix is not document-retention or positive C authority and does not complete E035.

Skill routing: systematic debugging traced persisted DB trigger behavior before changing the fixture; TDD uses the genuine failed native case as RED and now asserts the exact post-mutation row; Supabase/Postgres tenant integrity and verification guidance apply. No broad refactor, UI, performance, or delegated work was triggered.
