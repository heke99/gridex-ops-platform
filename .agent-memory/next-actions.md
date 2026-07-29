# Next actions

1. Recover the trusted bytes for `20260728170000_live_schema_code_canonical_sync.sql`; do not change its manifest hash.
2. Require `npm run db:migrations:check` to pass.
3. Apply pending forward migrations through `20260729200000_contract_commercial_selection_completion.sql` to a clean and a realistically upgraded staging database.
4. Run channel and commercial post-apply SQL plus two-tenant/concurrency denial tests.
5. Exercise fixed 12/24/36 across SE1–SE4 and variable monthly/hourly/quarterly through quote, sign, locked snapshot, billing and invoice lines.
6. Prove paper 39 kr applies only to paper, customer/admin options cannot be manipulated, and once/annual/event components do not double-charge.
7. Repeat internal customer selection → signed snapshot → invoice parity.
8. Repeat the production build under declared Node 22, deploy runtime and migration together, then verify live API `2026-07-29.1`.
