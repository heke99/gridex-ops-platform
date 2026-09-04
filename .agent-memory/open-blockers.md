# Open blockers

Updated: 2026-09-04

1. No production Supabase project is visible; production migration parity is unverified and production promotion is blocked.
2. Authenticated resolver/end-to-end smoke and k6 execution require the hosted preview plus the configured scoped test credentials.
3. Auth uses an absolute 10-connection allocation; production-project capacity configuration is unverified.
4. Production load testing remains forbidden; smoke/load/spike/ETag/soak are staging/preview only.
5. No canonical schema baseline is committed. `supabase/schema.sql` and
   `supabase/schema.fingerprint.json` must be captured from a clean replay,
   which needs the Supabase CLI. That CLI is not installed in the agent
   container, so the capture has to come from the `clean-migration-replay` CI
   job artifact `rem002-schema-snapshot/`. Until then the guarded CI
   verification step does not run.

