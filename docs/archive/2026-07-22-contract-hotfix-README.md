# Gridex OPS contract hotfix – 2026-07-22

This patch corrects the failed, rolled-back migration
`20260721170000_contract_graph_api_revision_hardening.sql` and the TypeScript
error in `lib/integrations/ipPolicy.ts`.

## Why the existing migration may be replaced

The migration is wrapped in `begin; ... commit;`. The reported
`immutable_version_locked` exception occurred before `commit`, so PostgreSQL
rolled the migration transaction back. This corrected file must replace the
failed version before it is run again.

## Fixes

- Enables both `gridex.version_transition` and
  `gridex.publication_link_repair` before updating the compatibility-only
  `legacy_public_contract_offer_id` on locked publication versions.
- Applies the same rule in the repair RPC, forward-link synchronization trigger,
  migration data repair and database lifecycle reproducer.
- Adds regression checks for all three executable repair paths.
- Changes `ProxyTrustEnv` to an environment-compatible string map, fixing
  TS2559 for the `process.env` default without changing proxy/IP behavior.
- Updates the migration checksum manifest.

## Sync

```bash
rsync -av gridex-ops-contract-hotfix-20260722/ /Users/hekmath/Projects/gridex-ops-platform/
```

Then run dependency installation and verification from the project directory.
Use `&&` so the chain stops at the first real failure.
