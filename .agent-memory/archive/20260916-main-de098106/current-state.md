# Current state

Updated: 2026-09-15

Active task: user-authorized partial main merge, deferring PR310 database/native/schema/types blockers. Independent branch codex/ediel-independent-main-20260915 starts from main eb9a25bc. It contains bounded Ediel protocol/UTILTS/DSN/SMTP fixes and the masterplan v2 package, without PR310 migrations or replay machinery.

Fresh local verification and scope are recorded in quality/audits/ediel-masterplan-v2/partial-main-merge.md. PR310 remains open, PR311 was merged into its feature branch only; full PR310 has not been merged to main. Next action: publish and inspect independent PR checks/review, merge exact reviewed head if allowed, then retain the database blocker for later per user instruction. Do not mark the full masterplan complete.
