# Current state

Updated: 2026-08-20

- Active branch: `codex/gridex-production-masterplan-20260820`, based on main `22d2b4834577ad96b31c4373832a0507397c65e3`.
- Billing requires configured provider/environment and supports per-underlay readiness.
- Invoice export requires exact locked pricing in runtime and via a forward-only database trigger.
- Spot settlement cron imports and locks each requested price-area month.
- Customer notification writes use opaque tenant-bound public references, never raw notification UUIDs.
- Public API release `2026-08-20.1` is materialized locally.
- External website API usage telemetry is deferred with Next.js `after` and cannot hold successful responses open.
- Current live public-contract fingerprint is O(1); warm development `EXPLAIN` measured 6.693 ms with no disk/temp I/O.
- Supabase advisor residuals are classified; no exact duplicate indexes or exposed service-only tables were found.
- An authenticated k6 ETag/304 profile is wired for staging execution.
- All 19 legacy monoliths are split behind stable facades; the 1,800-line ratchet has zero grandfathered files.
- Portal claim and continuation reconciliation reads are batched; the public-path N+1 gate reports zero unapproved awaited reads inside loops.
- Browser bundle budgets pass (largest chunk 222,348 bytes) and k6 smoke/load/spike/soak/ETag SLOs share one checked contract.
- Supabase development migration `invoice_export_locked_pricing_guard` is applied and verified.
- Full local verification: 98 test files / 699 tests, typecheck, API docs/release, migration integrity, dependency audit, advisor/tooling regressions, and production build pass.
- Git publication is explicitly authorized. Production database parity, hosted authenticated smoke, and staging load execution remain gated on the PR preview and connected credentials.
