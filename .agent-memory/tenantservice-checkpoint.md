# Tenantservice side track: checkpoint

This track is separate from the Ediel checkpoint (`checkpoint.json`). Do not overwrite that file.

- Branch: `claude/bold-edison-vgwx65`.
- Draft PR: heke99/gridex-ops-platform#425. It is watched (CI and review events).
- Base: `origin/main` @ `53bf989`.
- Head (2026-10-01): see `git log`. The latest verified commit is `9a2f98d`; the commit that adds this checkpoint comes after it.
- Findings register: `quality/tenantservice/P0-inventory-and-findings.md`.

## Done (commits)
- **P0 + P1a (`6fddd8a`):** inventory; read-only resolver; mutations require a linked portal account.
- **P1b (`a4dbb0a`):** link mode never undoes blocks or rebinds identities; F5 portal sync guard.
- **P2a (`140387a`):** shared contact-change rules in OPS + API; version lock; contact audit.
- **P3 (`75132a1`):** shared effective invoice delivery for readiness, review and export; no contact-email fallback.
- **P4a (`17a56ea`):** support conversation (customer/staff/internal/phone), fail-closed visibility, OPS actions. API handlers are in lib and not mounted.
- **P5a (`b146cb7`):** navigation, case detail view with composer, tenant-switch guard, `updated_at` in customer card (F15).
- **tenantDb (`9a2f98d`):** new queries go through `tenantDb`; ratchet 2402 → 2399.

## Since then (2026-10-01, evening)
- #427 (next 16.3.8 / nodemailer 10 / imapflow 2 / ip-address 10.7.2) was merged to main (`ecc19a2`) on the user's authorisation. main was merged into this branch (`688f672`).
- **F16 fix (`ca1fe43`):** support cases no longer trigger operational stops. The same fix is also opened as a separate PR #428 against main.
- **P6 (`0223b9f`):** contract release 2026-10-01.1; support API mounted.

## CI
- quality-release-gates: green.
- full-e2e and browser-quality-e2e: green.
- `verify` is red on `security:audit-production`: new advisories for next/nodemailer/ip-address. Not this PR's; a separate dependency PR is needed.
- `clean-migration-replay` is red on Ediel native fixtures. Red already on `6fddd8a`; #426 is also red. Commented on the PR.

## Next action (in order)
1. **P6 remaining:** synthetic reference client for the tenant support page.
2. **P1c:** signed customer/delegation proof (iss/aud/exp/tenant/jti) per tenant.
3. **P2b/P4b:** migration with transactional RPC (change + audit + outbox + unique idempotency), private attachments with quarantine. Requires generated types from the clean replay in CI.
4. **P5b:** fixed customer header, consolidated tabs, edit panel with billing impact.
5. **P7/P8:** threat model/ASVS, quotas, baseline measurement; backfill of invoice_email; client transition plan.

## Do not touch
- #310.
- The Ediel branches.
- Main, merge, production migration, real sends.
