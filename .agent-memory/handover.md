# Handover

Updated: 2026-09-04

Branch `claude/gridex-ops-production-hardening-lrknxa`, four commits, additive
tooling only. No migration, no runtime code, no database mutation.

Delivered (master remediation plan P0-C, plus the Fas 3 artifacts it needs):

1. `npm run db:parity` — canonical/live schema parity in both directions.
2. `npm run db:parity:selftest` — the gate that guards that engine, running in
   the `clean-migration-replay` CI job.
3. `npm run db:schema:snapshot` / `db:schema:check` — canonical `schema.sql`
   and a schema-wide fingerprint.
4. `db:types:gen` fixed to generate from the local shadow, not a linked
   project.

Pick up here:

- Take `rem002-schema-snapshot/` from a green `clean-migration-replay` run on
  this branch and commit it as `supabase/schema.sql` and
  `supabase/schema.fingerprint.json`. The CI verification step is already
  written and guarded on those files existing, so committing them turns the
  gate on. This cannot be done off CI: the Supabase CLI is not installed in
  the agent container, so clean replay cannot produce a canonical baseline
  locally.
- Only after that baseline exists, consider retiring the narrow
  `scripts/gridex-aud-003-schema-fingerprint.sql` and the pinned
  `EXPECTED_FINGERPRINT` in `scripts/gridex-aud-003-clean-replay.sh`. That
  expected hash can only be recomputed by a real clean replay — do not guess it.
- Do not attempt production parity until a production Supabase project is
  identified. The engine exists and supports `--mode blocking`; the plan's own
  §7.3 says blocking is switched on only once live drift is remediated.

Read `.agent-memory/current-task.md` first — it carries the code-verified
findings register, every design decision and the exact verification that was
executed, rather than a summary of it.
