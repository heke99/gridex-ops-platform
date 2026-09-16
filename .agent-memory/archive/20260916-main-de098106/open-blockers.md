# Open blockers

Updated: 2026-09-04

1. No production Supabase project is visible; production migration parity is unverified and production promotion is blocked.
2. Authenticated resolver/end-to-end smoke and k6 execution require the hosted preview plus the configured scoped test credentials.
3. Auth uses an absolute 10-connection allocation; production-project capacity configuration is unverified.
4. Production load testing remains forbidden; smoke/load/spike/ETag/soak are staging/preview only.
5. CLOSED 2026-09-04. The canonical schema baseline is committed, captured
   from the green `clean-migration-replay` artifact of run 33874124560
   (`supabase/schema.sql`, `supabase/schema.fingerprint.json`, overall
   fingerprint `3b0dd50e...`). The guarded verification step activates on the
   next run.

