# Verifiering – canonical runtime consistency 2026-08-02

## Samlad status

```text
RELEASE = NO-GO
```

| Kontroll | Status | Resultat |
|---|---|---|
| Migration integrity | PASS (local static) | 340 filer, 244 versionsgrupper, checksummor verifierade |
| Canonical runtime consistency regression | PASS (local static) | Accessatomik, tenantresolution, routeprioritet och delivery uncertainty |
| Emergency access regression | PASS (local static) | Views, RPC, defaults, systemtabeller och global role scope |
| Canonical production hardening regression | PASS (local static) | Permissions, tenant scope, evidence, lifecycle, workers och migrationer |
| OPS behavior regression | PASS (local static) | Address, SSRF, UUID och Ediel claim fail-closed |
| OPS hardening regression | PASS (local static) | 18 kontroller |
| Ediel routing security | PASS (local static) | Routingregression grön |
| Inbound tenant resolution | PASS (local static) | Tenantresolution grön |
| Canonical multitenant platform | PASS (local static) | Full statisk multitenantregression grön |
| Ediel canonical consolidation | PASS (local static) | 309 TypeScript-filer inspekterade |
| RBAC audit | PASS (local static) | 24 checks, 0 warnings |
| Route runtime selection | PASS (local static) | Route scope/environment-kontroller gröna |
| Two-tenant route isolation | PASS (local static) | Tenant-isolerad route materialisering |
| Test/production separation | PASS (local static) | Explicit environment och production guards |
| Ändrade TS/TSX-filer – syntax | PASS (local syntax) | TypeScript `transpileModule`, inga syntaxdiagnoser |
| Live schema dependency check | PASS (read-only) | Nödvändiga tabeller, kolumner och funktioner verifierade mot `gridex-ops-dev` |
| Migration version conflict | PASS (read-only) | `20260802203000` finns inte i remote ledger |
| PL/pgSQL access-wrapper compile | PASS (rollback syntax test) | Korrigerad funktion kompilerad i PostgreSQL 17; transaktionen rullades tillbaka |
| Migration apply | NOT VERIFIED | Migrationen är inte applicerad |
| `npm ci` | NOT VERIFIED / ENVIRONMENT BLOCKED | Registry 404 för `zod-validation-error-4.0.2` |
| Semantic typecheck | NOT VERIFIED / ENVIRONMENT BLOCKED | Next/React/Node/Supabase-typer saknas efter ofullständig installation |
| Lint | NOT VERIFIED / ENVIRONMENT BLOCKED | `eslint` saknas efter ofullständig installation |
| Next.js build | NOT VERIFIED / ENVIRONMENT BLOCKED | `node_modules/next` saknas |
| Production dependency audit | NOT VERIFIED | Komplett dependencyinstallation saknas |
| Clean install | NOT VERIFIED | Ingen isolerad tom PostgreSQL/Supabase körning |
| Staging-upgrade | NOT VERIFIED | Ingen stagingklon applicerad |
| JWT/RLS live regression | NOT VERIFIED | Kräver verifierade JWT-kontexter |
| Concurrency/failure injection | NOT VERIFIED | Kräver verklig PostgreSQL testmiljö |
| Externa transporter | NOT VERIFIED | SMTP, IMAP, S/MIME, Ediel portal och motpartstester saknas |

## Körda lokala kommandon

```text
node scripts/check-migration-versions.cjs
node scripts/canonical-runtime-consistency-regression.cjs
node scripts/canonical-emergency-access-regression.cjs
node scripts/canonical-production-hardening-regression.cjs
node scripts/ops-hardening-behavior-regression.cjs
node scripts/ops-hardening-regression.cjs
node scripts/ediel-routing-security-regression.cjs
node scripts/ediel-inbound-tenant-resolution-regression.cjs
node scripts/canonical-multitenant-platform-regression.cjs
node scripts/ediel-canonical-consolidation-regression.cjs
node scripts/security-audit-rbac.mjs
node scripts/gridex-route-runtime-selection-regression.cjs
node scripts/ediel-two-tenant-route-isolation-regression.cjs
node scripts/gridex-test-production-separation-regression.cjs
```

Samtliga ovan avslutades med exit code `0`.

## Live read-only verifiering

Projekt:

```text
name = gridex-ops-dev
ref  = piidsfebjqjmnepdpnas
PostgreSQL = 17.6.1
```

Verifierat utan databasskrivning:

- senaste registrerade migration är `20260802180000`,
- `20260802203000` har ingen versionskonflikt,
- required invitation/membership/canonical/evidence-kolumner finns,
- `operation_decision_snapshot` saknas på `ediel_outbox` och skapas därför av migrationen,
- required canonical access/hash/permission-funktioner finns,
- actor test attempt-kolumner som pass guards kräver finns,
- den globala constrainten `user_roles_user_id_role_id_key` finns och behöver ersättas för korrekt multitenantrollidentitet,
- befintlig Ediel outbox statusconstraint stödjer redan `delivery_uncertain` och `blocked_tenant_state`.

## SQL-hotfix efter första leveransen

Den första versionen av migrationen saknade deklarationerna:

```text
v_active_user_role_id uuid
v_existing_mapped_role_id uuid
```

PostgreSQL stoppade migrationen transaktionellt med `ERROR 42601` innan den kunde slutföras. Båda variablerna är nu deklarerade i det inre PL/pgSQL-blocket. Regressionen verifierar uttryckligen deklarationerna och den korrigerade funktionsdefinitionen har kompilerats i PostgreSQL 17 i en transaktion som därefter rullades tillbaka.

Korrigerad migrations-SHA-256:

```text
96a4402e5b642453a7358f55f9a5c93b2559a707df66b958a770318d10412930
```

## Loggar

```text
test-runs/canonical-runtime-consistency-2026-08-02/static-regressions.log
test-runs/canonical-runtime-consistency-2026-08-02/typescript-syntax.json
test-runs/canonical-runtime-consistency-2026-08-02/npm-ci.log
test-runs/canonical-runtime-consistency-2026-08-02/typecheck.log
test-runs/canonical-runtime-consistency-2026-08-02/typecheck-scripts.log
test-runs/canonical-runtime-consistency-2026-08-02/typecheck-tests.log
test-runs/canonical-runtime-consistency-2026-08-02/lint.log
test-runs/canonical-runtime-consistency-2026-08-02/build.log
```

## Nästa säkra körordning

1. Kör full dependencyinstallation i användarens normala registry-miljö.
2. Kör lint, samtliga typechecks, tester och build.
3. Kör SQL-verifiering mot en stagingklon.
4. Applicera migrationen först på stagingklon.
5. Kör `scripts/sql/06_canonical_runtime_consistency_verification.sql`.
6. Kör JWT/RLS-, concurrency- och pause-after-claim-tester.
7. Applicera inte live förrän staging-upgrade och rollbackprotokoll är gröna.
