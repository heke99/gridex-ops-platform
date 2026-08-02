# Changed files — V2 emergency-lockdown continuation

Diff basis: exact uploaded archive SHA-256
`e623976d333a3d4686e01ddd3ead83e599c21284a983347efaf7939dbaefd0d3`.
The archive excludes `.git`; generated `node_modules`, `.next`, `next-env.d.ts`
and TypeScript build-info files are not part of the delivery.

| File | Change |
|---|---|
| `supabase/migrations/20260802190000_canonical_emergency_access_lockdown.sql` | New forward-only P0 access-control migration |
| `scripts/canonical-emergency-access-regression.cjs` | New static regression for the emergency migration |
| `scripts/sql/05_emergency_access_lockdown_verification.sql` | New read-only post-apply catalog verification |
| `scripts/migration-history-manifest.json` | Registered migration version and SHA-256 |
| `package.json` | Added `ops:emergency-access-regression` command |
| `docs/canonical-hardening/BASELINE.md` | Corrected archive, environment, ledger and apply baseline |
| `docs/canonical-hardening/MIGRATION_RECONCILIATION.md` | Superseded stale A-C drift with the authoritative current ledger |
| `docs/canonical-hardening/DELIVERY_REPORT.md` | Updated local gates, blockers and controlled next step |
| `docs/canonical-hardening/EMERGENCY_ACCESS_LOCKDOWN.md` | New pre-lockdown exposure and exact blast-radius report |
| `docs/canonical-hardening/SUPABASE_ADVISOR_REPORT.md` | New Security/Performance Advisor baseline |
| `docs/canonical-hardening/V2_STATUS_MATRIX.md` | New phase-by-phase `PASS`/`FAIL`/`NOT VERIFIED` matrix |
| `docs/canonical-hardening/CHANGED_FILES.md` | This exact delivery inventory |
| `.agent-memory/checkpoint.json` | Updated resumable machine checkpoint |
| `.agent-memory/current-state.md` | Updated authoritative state and evidence |
| `.agent-memory/current-task.md` | Updated active phase, next action and blockers |
| `.agent-memory/handover.md` | Added explicit apply boundary and resume order |
| `.agent-memory/open-blockers.md` | Added Phase-40 release blockers and superseded stale ledger blocker |
| `.agent-memory/session-log.md` | Recorded remote read-only evidence and local verification |
| `.agent-memory/verification-matrix.md` | Added V2 verification outcomes |
| `.agent-memory/work-plan.md` | Added WP-040 emergency-lockdown work package |
