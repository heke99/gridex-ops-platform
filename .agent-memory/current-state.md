# Current state

Last updated: 2026-08-09T09:45:00Z

- Branch: `cursor/codebase-health-and-stability-8f9d`
- Base main SHA: `6c86e547131f50472def8893ce2861c6e06a7ba2` (PR #90 merged)
- Active remediation: `GRIDEX-OPS-BL-006`

## Post-merge health follow-up

PR #90 landed the integrity/performance campaign. Post-merge inspection found
that closed PR #89 (BL-006) never merged, so broad authenticated SELECT policies
remain on:

- `platform_actor_contacts`
- `platform_address_lookup_cache`
- `platform_energy_lookup_cache`

and `/admin/network-owners` still reads import history through the session
client after the app platform-admin gate.

This branch reimplements BL-006 as forward migration
`20260809123000_gridex_ops_bl_006_contacts_and_lookup_cache_read_isolation.sql`
(checksum `e166d3403f42a65d16f38613321b3719b5add3f294acf29281e808f0aecc5db5`),
switches import history to `supabaseService`, and closes the
`person_number`/`personNumber` log-redaction key gap.

## Still open

- O-008 `actor_readiness_status` authenticated SELECT under-count risk
- Staging/SQL two-tenant rollback for BL-006
- External gaps from PR #90: Actions billing block, unprotected `main`,
  Supabase leaked-password protection, unavailable final empty-database replay
