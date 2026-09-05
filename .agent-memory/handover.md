# Handover

Updated: 2026-09-04

Branch `claude/gridex-ops-production-hardening-lrknxa`.
**PR #307 is open and GREEN**: https://github.com/heke99/gridex-ops-platform/pull/307
`mergeable_state: clean`, all three OPS hardening jobs pass on head `f685d42`.
It has NOT been merged — the user has not authorised a merge. Do not merge.

## Done and verified in CI (do not redo)

1. `npm run db:parity` + `db:parity:selftest` — canonical/live schema parity in
   both directions, and the gate that proves the engine still detects drift.
2. `npm run db:schema:snapshot` / `db:schema:check`, and the canonical baseline
   `supabase/schema.sql` + `supabase/schema.fingerprint.json` (`3b0dd50e...`)
   captured from the green replay artifact. **The baseline IS committed and the
   check IS active and passing.**
3. Dockerless clean replay via `GRIDEX_REPLAY_DB_URL`.
4. `20260904120000_canonical_tenant_invariant_convergence.sql` — the tenant
   isolation gate now passes against a database replayed from this repository.
   It reported 21 breaches there before.
5. The tenant gate, parity self-test and schema snapshot run inside the replay
   step in `clean-migration-replay`.
6. `security:audit-production` distinguishes a vulnerability from an unreachable
   npm registry. `db:types:gen` generates from the local shadow.

## Pick up here, smallest first

- **Readiness policy versioning (Fas 10, §13).** No readiness relation binds a
  snapshot to the policy version it was computed against.
  `platform_runtime_readiness` already carries `schema_version` and
  `migration_version`, so there is a precedent to copy. See current-task.md
  Stage 18.
- **Typed Supabase clients (P0-E, Fas 5 §8).** No client factory is typed with
  `<Database>`. 487 files use the service client, 197 `.rpc(` call sites, and
  only one `as any` in the whole app. Re-run the typecheck probe on its own
  branch to get a real error count first; the one attempted here was abandoned
  without a result. See Stage 17.
- **Trace the Z02 activation rule properly (Fas 12, §36).** Recorded as
  UNVERIFIED, not satisfied: no Z02-driven activation was found, but the path
  through `lib/ediel/flows/inboundBusinessStateMachineLegacy.ts` was never
  traced. See Stage 20.
- **Production parity in blocking mode** stays blocked on the production
  Supabase project, which is not visible from the agent environment.

## Rules a later session must not break

- Do NOT change `EXPECTED_FINGERPRINT` in the replay script. CI's clean replay
  verifies `c70fa2f...` and is authoritative; see Stage 10.
- Do NOT generate the canonical baseline locally. The dockerless harness is not
  byte-equivalent to the Supabase stack — same relations, columns, functions,
  indexes and triggers, but 714 policies against 2548 and 5546 relation grants
  against 13307. Refresh it from a green CI artifact; the procedure is in
  `database-and-migrations.md`.
- Never edit `gridex-aud-003-migration-provenance-regression.cjs` to make a
  replay change pass; see Stage 9.
- The schema check is byte-for-byte, so any migration touching the public schema
  turns it red until the baseline is refreshed. That is by design.

## Already checked and correct — do not re-audit

- Fas 13 billing integrity: every unique index on billing and invoice relations
  is company-scoped (Stage 19).
- Fas 9.2 SLA timestamps: deadlines derive from `message_sent_at` and the
  watchdog index excludes unsent messages (Stage 19).
- Cron jobs DO have concurrency control, via claim-based `FOR UPDATE SKIP
  LOCKED` and named automation locks, not via route-level keywords. See
  `known-failures.md`.

Read `.agent-memory/current-task.md` first. It carries the findings register,
every design decision, the experiments that were run, and the ones that were
disproved.


## 2026-09-04 — after Steg 3

Production (`piidsfebjqjmnepdpnas`) has been reconciled with the canonical
migration chain except for one migration. Do NOT re-apply the three below —
they are in the production ledger and verified:

    20260904221046  gridex_inbound_operations_foundation
    20260904221936  z02_snapshot_market_context_guard
    20260904222045  canonical_tenant_invariant_convergence

`20260904222450  admin_signed_contract_import_canonicalization` is applied too.
That one is behavioural: admin imports can no longer INSERT a contract straight
into `signed`/`active`, and a `complete_agreement` / `signed_agreement` upload
now runs full evidence finalization or raises a named error. It was preflighted
to a blast radius of zero existing rows.

Canonical is now a subset of production: every canonical table and function
exists there. Do not re-apply any of the four.

Next: classify the production-only surface (74 relations / 546
policies / 57 functions) per plan 3.4/3.5, then Steg 4 (make `db:parity
production` blocking — only after classification), then Steg 5+.


## 2026-09-05 — #308 merged

PR #308 is merged to main as `15e6b48`, all seven relevant gates green
(`verify`, `quality-release-gates`, `clean-migration-replay`, `coverage`,
`smoke`, `browser-public`, `pr-certificate`). It is FINISHED — do not push
follow-up work onto it. The branch has been restarted from main; a follow-up
needs a new pull request.

What is on main now: the parity register
(`quality/audits/GRIDEX-PROD-PARITY-2026-09-04.md`) and the project memory. No
source or migration changes; the production work went through migrations that
were already on main.

What is still open, highest severity first:

1. F-PARITY-4 (critical) — the canonical chain does not build the six
   tenant-attribution guard triggers. Fix this before anything else in the
   register.
2. The fail-closed replay guard, so an unclassified `.sql` under
   `supabase/migrations/` aborts the replay instead of being ignored.
3. The 546 production-only policies are UNMEASURED. 3.4 is not finished until
   they are.
4. Steg 4 (blocking `db:parity production`) stays blocked until 1-3 are done.
