# Masterdata Production Checklist

Verify before go-live — platform level once, tenant level per launching company.

## Platform

- [ ] `platform_market_actors` / actor registry loaded (grid owners, suppliers,
      BRPs with Ediel IDs)
- [ ] `platform_grid_areas` complete (grid area codes → grid owners); grid-area
      import cron green
- [ ] Grid owner contact channels (`grid_owner_contact_channels`) populated for
      manual info requests (recipient email + domain for sender credibility)
- [ ] Spot price import green (`/api/cron/pricing/spot-prices`, price areas SE1–SE4)
- [ ] Postal-code → price-area lookup working (`PAPILITE_*`,
      `/api/public/energy-area`)
- [ ] Platform legal master templates published
      (`app/admin/platform/legal-templates`: terms, privacy, withdrawal,
      power_of_attorney)
- [ ] Manual operations mailbox configured + verified per environment
      (`manual_communication_mailboxes`, production row)
- [ ] Shared Ediel mailbox configured (`ediel_mailboxes`, production row,
      IMAP/SMTP secret refs resolve)
- [ ] Expisoft/LDAP certificate lookup reachable (`EDIEL_EXPISOFT_LDAP_*`)

## Per tenant

- [ ] Company row: name, org number, slug, **customer number prefix (unique)**,
      support/billing contact
- [ ] Active price plans + published contract offers
      (`GET /api/v1/website/public-contracts` returns them)
- [ ] Tenant legal versions published (terms/privacy/withdrawal/POA) — legal
      readiness page green
- [ ] Email sender verified (see email checklist)
- [ ] Website API key + customer portal API client with correct scopes; webhook
      secret exchanged with the website team
- [ ] Production Ediel identity: `ediel_actor_settings` (environment=production)
      with Ediel ID, sender name, subaddresses, application reference
- [ ] Production route profiles materialized + `is_production_ready`
      (PRODAT required; UTILTS if the tenant consumes metering values)
- [ ] Certificates/encryption: S/MIME certificate matched for the tenant lane
- [ ] AGT/actor test: required test cases passed (or explicitly waived with
      reason recorded)
- [ ] Test/live route mapping sanity: no production route with
      `target_system` = test portal; no AGT receiver in production profiles
- [ ] Portal URLs / public URLs configured (site URL, portal links in emails)
- [ ] Production readiness dry-run: `allowed` (go-live page)
