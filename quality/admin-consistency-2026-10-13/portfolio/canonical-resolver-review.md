# Canonical identity and mature-builder review

Reviewed the unapplied canonical and empty-statistics migrations locally; no live writes.

## Canonical resolver repair

The original OR predicate allowed an explicit website application ID to link the same external intake to another application through its key. A repeated intake ID also suppressed the external row despite having multiple canonical owners. Both behavioral SQL regressions failed before the repair.

The single identity CTE now resolves by explicit application ID, otherwise unique intake ID, otherwise unique company/key. An unresolved or ambiguous stronger identifier remains an external work item. The same resolved identity controls both linking and mirror suppression, preserving tenant RLS and list/count parity.

- `canonical-admin-application-work-items.test.ts`, `website-application-read-model.test.ts`, `website-application-detail-identity.test.ts`: **17 passed**.
- ESLint for the changed SQL test and `git diff --check`: passed.
- Migration SHA-256: `6a8a0b9ecb0736f722beebb05ab203b2c966135adf56ba8031909d9096b25a06`.
- Test SHA-256: `ddf02c4ca00d58873e376a32eec89ecc7c3fee98c92d2ab782781d341d65cddd`.

The migration remains unapplied and is handed back to the root agent. This resolver is now a coauthored fix rather than an independent final review of root code.

## Mature monthly builder defect (reported for root-owned repair)

The actual original monthly builder plus portfolio repair and empty-statistics migration were executed in PGlite using timestamp-shaped production PoA columns. The empty customer-source branch returned `skipped: no_customer_data` and produced zero company metric rows.

With one real customer, five open missing-meter issues were seeded: two valid selected-month/legacy issues, one previous-month issue, one orphaned meter, and one archived meter. The mature September builder counted **5**; the authoritative rule/source-existence helpers plus selected-month condition counted **2**.

Both raw missing-meter counts in the mature builder need the source-valid predicate and `(q.period_month IS NULL OR q.period_month = v_month)`. The current-month actionable view is unsuitable for a historical builder. When performing this dynamic replacement, do not skip the DQI repair merely because the empty-source guard is already installed. Require the expected two predicate matches and fail visibly on an unfamiliar native body.

Fixture and output are saved alongside this report as `mature-builder-review.mjs` and `mature-builder-review.log`. These are read-only local SQL evidence; they never connect to the live project.

The second count also has a distinct owner-attribution defect: its company-wide `missing` CTE is copied to every grid owner. Adding a second owner with no customer sites, points or issues produced missing counts of **5 / 5**, although the source-valid selected-month counts belong to the first owner only (**2 / 0**). The owner CTE must group through a company-owned metering point's `grid_owner_id` and join that count to the current owner. The company-level count stays global. Additional fixture/output: `mature-builder-owner-review.mjs` and `.log`.
