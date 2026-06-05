# Send Readiness and Environments

## Outbound send readiness

Before sending any outbound Ediel message, backend must verify:

- company/tenant resolved
- actor setting exists
- sender Ediel ID exists
- sender subaddress is correct for route
- receiver Ediel ID exists
- receiver subaddress is correct for route
- environment is correct: test or production
- route profile is active
- transport channel is configured
- encryption requirement is satisfied
- receiver public certificate exists if encryption is required
- certificate is valid for environment/purpose
- generated EDIFACT has correct UNB/UNH/BGM
- UNT segment count is correct
- message family/test suite matches generated message
- message has not already been sent unless resend is explicitly allowed
- audit event will be created

If any check fails, block send with a clear admin-readable reason.

## Draft vs send

Creating an outbound draft is not the same as sending.

The system may generate:

- recommended response
- outbound draft
- validation result
- send readiness result

Actual send must require:

- backend readiness check
- correct route
- correct encryption state
- audit log
- explicit action or approved automation rule

Never auto-send newly generated messages unless the flow explicitly supports automation and all readiness checks pass.

## Production environment safety

Production Ediel send must be stricter than test.

In production:

- never use Edielportal test counterpart 91100 unless route explicitly says so
- never use test BRP/test data
- never use test certificates unless explicitly configured and documented for that route
- never send unencrypted message if route requires encryption
- never allow missing receiver subaddress if required by actor route
- never create fake/test metering point references
- never bypass send readiness
- all sends must be auditable

## Environment boundary

Test and production data must not be mixed.

Each Ediel actor setting, route profile, certificate, mailbox and SMTP/IMAP config must have an environment:

- test
- production

A test run must not use production route unless explicitly configured and documented.

A production send must not use test route/certificate/counterparty.

## Runtime / deployment rule

Production runs on Vercel.

Do not rely on local machine-only binaries or local self-hosted services.

For crypto, S/MIME, CMS, parsing, polling, routing and scheduled jobs:

- use server-compatible libraries/APIs
- avoid dependencies that require local CLI binaries unless verified on Vercel
- document required environment variables
- make failures visible in admin diagnostics
