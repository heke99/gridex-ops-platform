# Tenantservice side track: checkpoint

This track is separate from the Ediel checkpoint (`checkpoint.json`). Do not overwrite that file.

- Branch: `claude/bold-edison-vgwx65`.
- Base: `origin/main` @ `53bf989`.
- Specification: the user's tenantservice prompt (2026-10-01). The masterplan file is missing from the repo.
- Packages P0–P8. See `quality/tenantservice/P0-inventory-and-findings.md`.

## Done
- **P0:** inventory and findings register.
- **P1a:** read-only resolver and binding gate for end-customer mutations. Tested.

## Next action
**P1b: identity proof and explicit link.**
- Signed customer/delegation proof verifying iss, aud, exp, tenant and active relation.
- Blocking check in link mode.
- Fix F5 (identity upsert in `customer-portal/sync`).
- Assess the `ensureCustomerPortalUserLink` calls in `lib/website/customerApplication*`.

**After that, P2:** shared contact-change command for OPS and API (version, audit, outbox).

## Do not touch
- #310.
- The Ediel branches.
- Main, merge, production migration, real sends.
