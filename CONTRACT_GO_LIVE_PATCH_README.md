# Gridex OPS contract go-live patch – 2026-07-21

Bas: `gridex-ops-platform-main(52).zip`

Patchen bygger en canonical avtalslivscykel med immutable versioner, kanalvis publicering utan webbglapp, säker radering/arkivering, gemensamt fältschema, readiness, RBAC, audit, cacheinvalidisering och releasekontroller.

## Applicera overlay-patch

```bash
rm -rf /tmp/gridex-contract-go-live-v2
unzip ~/Downloads/gridex-ops-contract-go-live-patch-v2-2026-07-21.zip \
  -d /tmp/gridex-contract-go-live-v2
rsync -av \
  /tmp/gridex-contract-go-live-v2/payload/ \
  /Users/hekmath/Projects/gridex-ops-platform/
cd /Users/hekmath/Projects/gridex-ops-platform
npm ci
npm run verify:contract-go-live
npm run db:migrations:check
npm run typecheck
npm run lint
npm run build
```

Använd inte `--delete`; patchen är en overlay.

## Migration

Applicera:

```text
supabase/migrations/20260720233000_contract_product_lifecycle_go_live_completion.sql
```

Kör därefter live-schema-check och staging lifecycle-test enligt:

```text
docs/contract-go-live-implementation-2026-07-21.md
```
