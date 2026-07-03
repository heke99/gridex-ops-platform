# Production Freeze Checklist

In effect from T-3 days before go-live until T+7 days after.

## Change policy

- [ ] No refactors, no dependency upgrades, no schema rewrites
- [ ] Only blocker fixes (Critical/High from the audit or new incidents) merge
- [ ] Every merge requires: green `typecheck`, `build`, `test`,
      `db:migrations:check`, and the regression scripts touching the changed area
- [ ] All migrations reviewed by a second person; additive-only
      (`IF NOT EXISTS`, no DROP/DELETE of business data); NOTICE output read on staging
- [ ] Env var changes verified against `docs/env-production-checklist.md`
      before deploy

## Deploy discipline

- [ ] Staging smoke test (`docs/staging-smoke-test-checklist.md`) passes before
      every production deploy
- [ ] Production post-deploy smoke (marked steps) passes after every deploy
- [ ] Rollback owner + deputy named for every deploy; both have Vercel +
      Supabase access; rollback = promote previous deployment
      (`docs/go-live-cutover-plan.md` §Rollback)

## Watch duty (first 24h after each deploy)

- [ ] Email dispatch, Ediel outbox, inbound polling watched per
      `docs/production-runbook.md` §5
- [ ] On-call person knows the kill switches (§4) and the incident runbook
- [ ] Support/debug surfaces known by the team: `/admin/system-health`,
      `/admin/website-applications`, `/admin/messages`, `/admin/work-queue`,
      go-live page per tenant

## Decision gate

- [ ] GO / NO-GO decided explicitly by the launch owner, recorded in
      `docs/production-readiness-audit.md` §Launch Gate — never implicit
