# Current task

Last updated: 2026-07-30T02:31:00+02:00  
Branch: UNVERIFIED (uploaded archive excludes `.git`)  
Last verified commit: null

## Active phase

PHASE-32 — canonical OPS/Web API contract, dynamic legal evidence and atomic portal identity.

## Completed locally

- Added the machine-readable OpenAPI release manifest and deterministic finalization.
- Closed the targeted website, quote, portfolio, event and portal sync schemas and synchronized both OpenAPI documents at `2026-07-30.1`.
- Replaced fixed legal-consent assumptions with exact dynamic document evidence.
- Enforced paired portal/auth identities in runtime requests and portal sync headers.
- Added forward migration `20260730120000_atomic_website_portal_identity.sql`.
- Synchronized Gridex Web snapshots/generated types and exposed fail-closed local/live/runtime readiness.
- Verified all TypeScript targets, zero-error lint, 370 tests, API docs/parity, focused tenant/idempotency/portal/webhook regressions and production builds.

## Exact next action

Recover `20260728170000_live_schema_code_canonical_sync.sql` byte-for-byte from the trusted applied source so its SHA-256 is `881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482`. Then require a green migration check, apply pending forward migrations through `20260730120000...` in staging, deploy OPS, verify the live release manifest and execute the complete guest/authenticated portal, webhook, concurrency and two-tenant flow.

## Blockers

- The exact trusted bytes for historical migration `20260728170000...` are not present in the supplied or previously available archives.
- No authorized PostgreSQL staging/live connection is available.
- The new portal-identity migration could not be applied to clean and upgraded databases in this workspace.
- Provider sandbox/credentials, deployment target and Git metadata are absent.
- The live OPS deployment does not yet expose `/api/v1/openapi/release-manifest.json` (HTTP 404).

## Do not repeat

Do not change the historical manifest checksum, run `db push` while integrity is red, claim database/live/staging verification from static checks, or mark live API compatibility ready before the deployed manifest and both SHA-256 values pass.
