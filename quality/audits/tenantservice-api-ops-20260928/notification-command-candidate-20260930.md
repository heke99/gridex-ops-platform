# Shared notification command candidate — 2026-09-30

Prepared for the existing draft #418, with the API adapter retained in draft #422. This package adds indexed canonical references and one service-only transaction covering mark-read, unchanged compact-hash idempotency and canonical audit. No external delivery is enabled. Old completed results replay only after current authorization; failed/processing legacy claims remain blocked. Forward migration hash: 93dd48ff1bc5d080668a01b939412bc75478e0bc9f782dab2de84c3c540c18ff.

Native rollback, compatibility, reference equivalence/index and concurrent-session suites are wired into the existing disposable clean replay. They have not executed in this local environment, which lacks PostgreSQL/Docker/Supabase CLI. Generated database artifacts must be adopted from the actual replay before qualification; the unchanged generated-types guard intentionally reports the new migration tail until then. The final API candidate additionally requires genuine GET→POST→replay→GET. This candidate does not accept any complete T/U requirement or the masterplan.

Publication preserves the current draft head as parent and uses a non-force ref update. No main merge, production migration, customer communication, Ediel activation or paused #310 change is authorized. Historical event-v2 evidence remains a regression in the API integration branch.
