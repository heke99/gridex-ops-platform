# E035 Task 2b fix round 3 — independent scoped review

Base `9e28bc1d0daabfcca3ed6377afca3733d7b7b663`; reviewed head `1443d03e01f23e79da7c93db47417b25abf2e6c2`. Reviewed the supplied diff/report, the native fixture, the published supply triggers and the document graph. No runtime edits or commit made.

**SPEC: APPROVE. QUALITY: APPROVE. No blocking findings.** Approval is for the fixture correction and its publication for actual native qualification, not a native PASS or Task 2b acceptance.

The actual 261/262 run failed because the fixture's former `customer_contract_id=NULL` mutation left `contract_id` populated. The before-update alias trigger in `supabase/migrations/20260727010000_contract_flow_integrity_completion.sql:355–377` sets `new.customer_contract_id=coalesce(new.customer_contract_id,new.contract_id)`, so the persisted supply remained linked. The same migration's chain guard at `:287–318` permits both aliases to be null while company/customer and metering-point checks remain. The document graph at `supabase/migrations/20260924013820_document_reference_context.sql:78–86` requires `sp.customer_contract_id=c.id`; a null/null supply therefore cannot qualify. This traces the failure to the test input without weakening the production graph.

The changed case at `scripts/ediel-document-reference-native.test.ts:155–164` clears both aliases atomically and checks the persisted null/null row. It retains the `recorded/unavailable` expectation for each of the five same-company graph variants. Its Storage spy starts after the fixture setup and before capture; `lib/ediel/sources/documentReferenceCapture.ts:31–36` only calls bounded download when the SQL attempt says `eligible===true`. Thus `storage.from` untouched is a useful no-read assertion for each negative capture, alongside the unavailable outcome. Existing fixture and other cases remain unchanged. No production SQL changed in this diff.

`git diff --check 9e28bc1d..1443d03e` passed. The author reports Node 22 scripts/tests typechecks and targeted ESLint passing. The actual native replay of this changed fixture (262 expected), authentic generated schema/types reconciliation and same-head gates remain **pending**; the 261/262 prior run is RED evidence, not a GREEN result for this head.

Skill routing: differential/code review, scoped spec-to-code and Supabase/Postgres trigger reasoning, and verification-before-completion. A broad audit and unrelated UI/performance/security sweeps were outside this fixture-only review. No suspected material security finding required false-positive triage.
