# Gridex OPS – available hardening files

This archive contains the four files that were actually persisted from the prior hardening pass:

- `supabase/migrations/20260712100000_gridex_end_to_end_integrity_hardening.sql`
- `docs/openapi/customer-portal-v1.json`
- `scripts/migration-history-manifest.json`
- `scripts/gridex-hardening-static-audit.cjs`

## Install into an existing project

From the parent directory of your project:

```bash
unzip gridex-ops-available-hardening-files.zip -d gridex-ops-patch
rsync -av --backup --suffix=.before-hardening \
  gridex-ops-patch/ gridex-ops-platform-main/
cd gridex-ops-platform-main
git status --short
```

Review the SQL migration before applying it. Apply migrations first to a staging database with outbound sending disabled. Do not run it blindly in production.

This is not the complete previously claimed multi-file patch. Only these four files were available in the persisted workspace.
