# Gridex OPS — avtals- och tenantlivscykel

Datum: 2026-07-26

## 1. Grundorsaker

### Avtalsradering

Adminflödet använder redan `gridex_remove_internal_contract_offer` med
`safe_delete`, men radering är avsiktligt blockerad när
`gridex_preview_delete_unused_contract` hittar affärshistorik, aktiv
publicering, delade canonical-versioner eller en inkonsekvent
publiceringsgraf. UI visade endast en inaktiverad knapp och reason codes.

Den befintliga modellen skilde mellan delete, archive, pause och unpublish men
saknade en separat terminal close-operation. Det gjorde att "stäng" riskerade
att uttryckas som archive, pause eller direkt statusändring.

### Tenantpaus

`lib/integrations/apiAuth.ts` verifierade API-klientens status men hämtade inte
det ägande bolagets `companies.status`. En aktiv nyckel kunde därför fortsätta
in i public contracts, quote och application-routes även när tenantens UI-status
var `paused`, `suspended` eller `archived`.

### Tenantaktivering och onboarding

`company_onboarding_tasks` fanns och visades som readiness, men
`setCompanyOperationalStatusAction` skrev direkt till `companies.status`.
Aktivering var därmed inte kopplad till checklistan. Dessutom kunde
bolagsprofilformuläret ändra status genom en separat RPC, vilket utgjorde en
konkurrerande statusväg.

### Tenantstängning

Det fanns ingen explicit `closed`-status eller atomär stängningsoperation med
preconditions för aktiva kundavtal, pågående leverantörsbyten och ofärdig
fakturering.

## 2. Genomförda korrigeringar

### Databas

- Ny append-only migration:
  `20260726010000_contract_tenant_lifecycle_completion.sql`.
- `closed` tillagd i avtals- och tenantstatusconstraints.
- `gridex_close_contract_product` stänger produktserien, avslutar alla kanaler
  och publiceringar, återkallar oanvända quotes och bevarar historik.
- Delete-trigger hindrar hårdradering av terminalt stängda avtal.
- `company_onboarding_lifecycle` ger en unik, resumable onboardingrad per
  tenant med steg, blockers och aktiveringsdatum.
- `gridex_tenant_activation_readiness` returnerar strukturerade blockers för
  juridik, admin, API-klient, canonical scopes, kontraktskanal,
  kundkommunikation och onboarding tasks.
- `gridex_transition_tenant_lifecycle` är den atomära tenantstatusoperationen.
  Aktivering readiness-gatas. Paus/stängning stoppar API-klienter,
  försäljningskanaler och oanvända quotes. Stängning blockeras av aktiva
  kundavtal, öppna switchar eller ofärdig fakturering.
- Audit och `domain_events`/`event_outbox` skrivs i samma transaktion.

### Backend och API

- Central API-auth hämtar tenantstatus från det company som API-nyckeln redan
  är bunden till.
- Endast `active` tillåts vidare till scopes/rate limiting.
- Stabila fel:
  `tenant_not_operationally_ready`, `tenant_paused`, `tenant_suspended`,
  `tenant_closed`, `tenant_inactive`, `tenant_status_unavailable`.
- Inget externt `company_id` eller tenant-ID används för resolutionen.

### Admin-UI

- Ny explicit "Stäng avtal terminalt" med obligatorisk orsak och
  `contracts.close`.
- Stängt avtal kan inte redigeras, återpubliceras eller raderas.
- Ny "Stäng tenant terminalt" i bolagsstyrningen.
- Bolagsprofilen kan inte längre mutera status; den hänvisar till de auditerade
  styrningsåtgärderna.

### Dokumentation

- Developer-sidan dokumenterar tenantstatusfelen.
- Website- och customer-portal-OpenAPI beskriver auth-felen.
- Extern integrationsguide dokumenterar tenant- och avtalslivscykeln.
- Ny normativ statusmatris:
  `docs/canonical-contract-tenant-lifecycle-2026-07-26.md`.

### Tester

- Ny unitmatris för central tenant API-gate.
- Ny statisk regression som kontrollerar migration, RPC-användning,
  permissions, quote-revocation och att profilvägen inte kan ändra status.

## 3. Ändrade och tillagda filer

- `supabase/migrations/20260726010000_contract_tenant_lifecycle_completion.sql`
- `scripts/migration-history-manifest.json`
- `scripts/gridex-contract-tenant-lifecycle-completion-regression.cjs`
- `package.json`
- `lib/integrations/apiAuth.ts`
- `lib/tenant/governance.ts`
- `lib/contracts/adminContractSchema.ts`
- `lib/contracts/lifecycleErrors.ts`
- `lib/customer-contracts/types.ts`
- `app/admin/contracts/actions.ts`
- `app/admin/contracts/page.tsx`
- `app/admin/companies/actions.ts`
- `app/admin/companies/page.tsx`
- `app/admin/companies/[id]/company-profile-actions.ts`
- `app/admin/companies/[id]/page.tsx`
- `app/developers/customer-portal-api/page.tsx`
- `docs/external-website-api-integration-guide.md`
- `docs/openapi/website-integration-v1.json`
- `docs/openapi/customer-portal-v1.json`
- `docs/canonical-contract-tenant-lifecycle-2026-07-26.md`
- `__tests__/tenant-api-lifecycle-gate.test.ts`
- `GRIDEX_CONTRACT_TENANT_LIFECYCLE_COMPLETION_2026-07-26.md`
- `.agent-memory/*` progress/evidence files

## 4. Migration

Körordning:

1. Tidigare migrationer genom
   `20260725120000_billing_readiness_and_supply_activation_v1.sql`.
2. `20260726010000_contract_tenant_lifecycle_completion.sql`.

Migrationen är additiv och backfillar en onboarding-lifecycle-rad per befintligt
bolag. Ingen affärshistorik raderas. Pausade/stängda resurser får nya
fail-closed-regler först när migration och runtime deployas tillsammans.

## 5. Kanonisk statusmodell

- Avtal: `draft → ready → published ↔ paused`; terminala eller historiska lägen
  är `expired`, `closed`, `archived`, `superseded`.
- Publiceringskanal: `active → paused → ended`.
- Publiceringsversion: `published → ended/archived`; immutable snapshot.
- Tenant: `onboarding → active ↔ paused`; `suspended`, `closed`, `archived` och
  `pending_deletion` blockerar drift. `closed` är terminal.
- Onboarding: `created → legal_setup → admin_setup → energy_setup →
  integration_setup → branding_setup → contracts_setup → review → ready →
  activated`, med `blocked`/`cancelled`.
- API-klient: `active`, `paused`, `revoked`, `expired`; tenantstatus kontrolleras
  dessutom separat.

## 6. API-resultat

Samtliga endpoints som använder `requireIntegrationApiAccess` får den centrala
tenantspärren, inklusive integration context, public contracts, resolver,
market price, quote, quote validation, customer applications, legal bundle och
customer portal.

Normal tenantintegration kräver endast API-URL och API-nyckel. Canonical scopes
ligger kvar server-side. Pausade/stängda avtal returneras inte eftersom feeds
och loaders kräver publicerad aktiv kanal/version; tenantgaten stoppar dessutom
hela externa API-kedjan när bolaget inte är aktivt.

## 7. Verifieringsresultat

| Kontroll | Resultat | Evidens |
|---|---|---|
| typecheck | PASS | `npm run typecheck` |
| lint | PASS | 0 errors; 125 befintliga warnings |
| tests | PASS | 54 filer, 354 tester |
| build | PASS | Next.js 16.2.6 production build |
| migrationskontroll | PASS | 300 filer, 205 versionsgrupper, checksums |
| OpenAPI validation/parity | PASS | 34 route files, 36 registry routes, 38 operationer |
| riktad lifecycle-regression | PASS | Ny statisk regression |
| migration apply mot PostgreSQL | BLOCKED | Ingen `DATABASE_URL`, Supabase CLI eller PostgreSQL-runtime i leveransmiljön |
| staging two-tenant roundtrip | BLOCKED | Kräver auktoriserad stagingdatabas och testidentiteter |

## 8. Kvarvarande risker

- Migrationen är fullständigt statiskverifierad men måste fortfarande
  appliceras och transaction-testas i en auktoriserad stagingdatabas.
- Runtime och migration måste deployas tillsammans. Runtime före migration ger
  saknade RPC:er; migration före runtime lämnar äldre UI utan nya operationer.
- Arkivets `.git` saknas, så branch/commit och tidigare dirty state kan inte
  verifieras.

## 9. Terminalkommandon

```bash
set -euo pipefail

PROJECT="/Users/hekmath/Projects/gridex-ops-platform"
PATCH="$HOME/Downloads/gridex-ops-platform-contract-tenant-lifecycle-2026-07-26"
BACKUP="$HOME/Downloads/gridex-ops-platform-backup-$(date +%Y%m%d-%H%M%S)"

rsync -a --exclude node_modules --exclude .next "$PROJECT/" "$BACKUP/"

rsync -av --checksum --itemize-changes --dry-run \
  "$PATCH/files/" \
  "$PROJECT/"

rsync -av --checksum --itemize-changes \
  "$PATCH/files/" \
  "$PROJECT/"

cd "$PROJECT"
npm ci
npx supabase db push

npm run db:migrations:check
npm run gridex:contract-tenant-lifecycle-completion-regression
npm run api:docs
npm run typecheck
npm test -- --testTimeout=15000
npm run lint
npm run build

npm run dev
```

Kör först `--dry-run` och kontrollera att endast filerna i ändringslistan
berörs. Kör migration och runtime i samma releasefönster.
