# Gridex OPS – produktionskorrigering 2026-08-02

## Exekutiv sammanfattning

Den levererade patchen korrigerar de bekräftade P0-felen i public-contract-flödet: tidig `304`, tyst bortfiltrering, partiell framgång, sammanblandning av grafkonsistens och synlighet samt avsaknad av ett verifierat last-known-good-kontrakt. Runtime, OpenAPI och dokumentation använder release `2026-08-02.1`. Fyra framåtriktade migrationer har lagts till för gemensam readiness, tenantinstallation, migrationssanning och SECURITY DEFINER-lockdown.

Arbetet är **inte produktionsklart att applicera ännu**. Den statiska regressionsmatrisen är 22/22 grön och ett fristående runtime-smoke för last-known-good är grönt. Full `npm ci`, lint, typecheck, Vitest och Next-build kunde inte slutföras eftersom körmiljöns interna npm-registry returnerade 404 för `zod-validation-error@4.0.2`; explicit npmjs-installation hängde och avbröts. Dessutom finns tre historiska dubblettversioner i migrationskedjan, så clean reconstruction och live-ledger repair är blockerade. Inga produktionsskrivningar har gjorts.

## Bekräftade defekter som korrigerats

1. `304` utvärderas först efter aktuell dataläsning, DTO-byggnad och canonical representation hash.
2. ETag omfattar semantisk representation: tenant, kanal, kundtyp, schema, avtal, feedstatus, empty-feed-bevis och diagnostik.
3. Enrichment- och serializerfel kan inte längre ge en tyst förkortad `200`-feed.
4. `PUBLIC_CONTRACT_FEED_INCONSISTENT` innehåller request/correlation-kontext och berörda canonical offer/publication-versioner.
5. Feed och diagnostik använder samma kanalneutrala readiness-vy.
6. Grafkonsistens är separerad från tenant-, pris-, juridik-, datum- och kanalblockerare.
7. Tenantens durable last-known-good bevaras vid timeout, HTTP 500, invalid JSON, schemaskevhet och obehörig tom feed.
8. Tom feed kräver canonical source, reason, blockerare, offerreferenser och revision.
9. `power_of_attorney_version_id` hämtas från exakt legal module-version och inte från `document_reference`.
10. Tenant website provisioning är samlad i ett idempotent/resumable service- och RPC-flöde.
11. Nya primärklientdubbletter blockeras i databasen med per-tenant/per-miljö serialisering; befintlig dubblett kräver explicit repair.
12. API error-code registry, OpenAPI, docs och runtimeversion är synkroniserade.
13. Current OpenAPI och release manifest använder `no-store`; versionerade artifacts är immutable.
14. Schema readiness blir fail-closed när manifest, ledger, checksum, freshness eller fingerprint inte stämmer.
15. Trigger-only och utvalda interna SECURITY DEFINER-funktioner får explicit execute-lockdown i forward migration.

## Testklassificering

| Kontroll | Klassificering | Beslut |
|---|---|---|
| Public API route registry | DOCUMENTATION_DRIFT | Immutable versionerade OpenAPI-routes lades in i canonical registry. |
| EDIEL production-send | OBSOLETE_TEST | Testet följde legacy `production_send_locked`; runtime använder granular fail-closed canonical state blockers. |
| UTILTS | OBSOLETE_TEST | Testet pekade på borttagen override-fil i stället för canonical rulebook policy. |
| Grid-owner orchestration | OBSOLETE_TEST | Testet uppdaterades till shared intake + z01 prerequisite path. |
| POA authorization chain | OBSOLETE_TEST | Testet spårar nu den atomiska canonical onboarding-RPC:n. |
| Contract go-live version | DOCUMENTATION_DRIFT | Versionförväntan uppdaterades till 2026-08-02.1 utan att beteendekrav togs bort. |
| `npm ci` | ENVIRONMENT_FAILURE | Intern registry 404 trots npmjs-resolved lockfile; explicit npmjs-försök hängde. |
| Clean Supabase reconstruction | UNVERIFIED | CLI/psql/Docker saknades och tre historiska dubblettversioner blockerar canonical chain. |

## Fortfarande overifierat eller blockerat

- Ren databas har inte byggts från hela migrationskedjan.
- Tre dubblettgrupper måste få en verifierad normaliserings-/aliasplan: `20260612193000`, `20260616123000`, `20260727150000`.
- Live-ledgern har inte reparerats och manifestmallen har inte körts.
- De fyra nya migrationerna har inte applicerats i staging eller live.
- Full install, lint, typecheck, Vitest och Next-build är inte gröna i denna miljö.
- Live Security Advisor har inte kunnat köras efter migrationerna.
- Leaked-password protection är fortfarande avstängt live och kräver Supabase Auth-konfiguration.
- Dubblettklienten har inte reparerats, eftersom operatören måste välja vilken aktiva credential som ska behållas.
- Tenant provisioning och live public-contract smoke har inte körts med en riktig API-nyckel.
- Gridex website-kontraktet är live synligt före patchen, men patchens livebeteende är inte verifierat eftersom ingen deploy gjordes.

## Arkitekturkarta

Se `artifacts/architecture-map-2026-08-02.md`.

## Nya migrationer

| Migration | Syfte | Säkerhetsnotering |
|---|---|---|
| `20260802230000_public_contract_delivery_consistency.sql` | Gemensam kanalneutral readinesskälla för feed och diagnostik. | `security_invoker`; endast service-role select. Måste stagingvalideras mot befintliga viewkolumner. |
| `20260802231000_tenant_website_provisioning_guards.sql` | Installationskvitton, serialiserad primärklientguard, idempotent provisioning och explicit dubblettrepair. | Lagrar aldrig plaintext-secret. Befintliga dubbletter pausas inte automatiskt. |
| `20260802232000_migration_truth_readiness.sql` | Manifestmetadata, ledger/checksum/freshness readiness och schema fingerprint-gate. | Sätter stale/empty readiness till false; manifest-SQL får inte köras före verifiering. |
| `20260802233000_security_definer_execution_lockdown.sql` | Revoke för trigger-only och utvalda interna SECURITY DEFINER-funktioner. | Hög påverkan; kräver stagingtest av backend- och RLS-kedjor före live. |

## Databasverifiering före/efter

### Före, live read-only

- Supabase-projekt: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`).
- Ledger: 18 registrerade versioner; senaste `20260802180000`.
- Repository: 344 SQL-filer, 248 distinkta versionsgrupper, 251 ledger-lämpliga filer.
- Canonical migration manifest: 0 rader.
- `platform_schema_state`: felaktigt `is_ready=true`, verifierad 2026-07-13.
- Två aktiva primära `tenant_website`-klienter för samma tenant.
- Website: 1 synligt canonical avtal.
- API-kanal: 0 synliga; blockerad av prisalternativ/default/fakturaavgift.
- SECURITY DEFINER: 291 totalt; 22 anon-executable, 33 authenticated-executable, 18 exponerade triggerfunktioner.
- Leaked-password protection: avstängt.

### Efter

Ingen live-efterstatus finns eftersom inga DDL/DML-ändringar applicerades. Förväntad efterkontroll finns i `scripts/post-deployment-verification-2026-08-02.sql` och måste köras först efter staging, clean reconstruction och kontrollerad deploy.

## Migration ledger och manifest

- Lokal checksumkontroll: **PASS**, 344/344 registrerade checksummor.
- Lokal inventory: genererad i `artifacts/migration-inventory-2026-08-02.json`.
- Manifest SQL: genererad som **icke-körbar före verifiering** i `artifacts/canonical-migration-manifest-after-verification.sql`.
- Produktionsreadiness: **FAIL avsiktligt** på tre historiska dubblettversioner.
- Live ledger/manifest parity: **FAIL/inte reparerad**.

## Supabase Security Advisor

Pre-deploy Advisor visade externa WARN för flera SECURITY DEFINER-funktioner samt disabled leaked-password protection. Read-only funktionsaudit visade 22 anon-executable, 33 authenticated-executable och 18 triggerfunktioner exponerade. Migrationen förbereder revokes, men post-deploy Advisor-resultat saknas och releasen får därför inte markeras grön.

## API-release och SHA-256

- Release: `2026-08-02.1`.
- Website Integration OpenAPI SHA-256: `971f0f4e00330971c92a37046f54fa7d27416a5b64932c7d37d7892b79691e7a`.
- Customer Portal OpenAPI SHA-256: `921daeb0c1bdfe4f4dc50cbbc3990defce8556bfe7cff0a88a0f4d96f4d6b779`.
- Local runtime/OpenAPI parity: **PASS**.
- Live SHA/parity: **inte körd**.

## Dokumentationsparitet

Följande statiska kontroller är gröna: dokumentationsversion, dokumentationsexempel, shared OpenAPI components, public-contract runtime/OpenAPI och canonical external API parity. Dokumentationen beskriver server-side key, tenantbinding, origins/IP, ETag/no-store, durable LKG, diagnostics scope, fullmakt-ID, canonical errors och installationssteg.

## Tenant provisioning smoke

- Statisk regression: **PASS**.
- Originnormalisering och resumable service: implementerade.
- Live RPC/preflight/feed-verifiering: **inte körd**.
- Dubblettrepair: **inte körd**; kräver explicit `p_keep_client_id`.

## Public-contract durability

- Fristående Node runtime-smoke: **PASS** för fresh snapshot, HTTP 500 fallback, obehörig tom feed och verifierad canonical empty.
- Vitest-filer finns för timeout, invalid JSON, schema mismatch, process restart och cold start.
- Full Vitest suite: **inte körd** på grund av misslyckad dependency installation.

## Kommandoresultat

### Statiska repositorykontroller

22 av 22 passerade. Full output finns i `artifacts/verification/static-*.log` och sammanfattning i `static-regression-summary.tsv`.

### Full releasekedja

| Kommando | Resultat | Orsak |
|---|---|---|
| `npm ci` | FAIL | Intern registry 404 för `zod-validation-error@4.0.2`. |
| `npm run lint` | FAIL | `eslint` saknas efter misslyckad install. |
| `npm run typecheck` | FAIL/otillförlitlig | Partiellt node_modules; Next/Node/Supabase-typer saknas och tusentals följdfel. |
| `npm test` | FAIL | `vitest` saknas. |
| `npm run build` | FAIL | Next binär saknas. |
| `npm run db:migrations:production-readiness` | FAIL avsiktligt | Tre historiska duplicate versions. |

Full output finns i `artifacts/verification/*.log` och `full-command-summary.tsv`.

## Rollbackplan

1. Rulla tillbaka applikationsdeploy till föregående immutable Vercel-build.
2. Behåll versionerade OpenAPI `2026-08-02.1`; peka current routes tillbaka endast om runtime också rullas tillbaka.
3. Migrationerna är forward-only. Skapa vid behov en ny kompensationsmigration; ändra eller radera aldrig applicerade filer.
4. Provisioning migration skapar nya objekt och revokes. Kompensationsmigration kan återställa specifika grants efter dokumenterad säkerhetsbedömning.
5. Återaktivera inte pausade dubblettcredentials automatiskt. Återställ bara efter audit av vilken nyckel som användes.
6. `platform_schema_state` ska förbli false under rollback tills ledger, manifest och fingerprint åter verifierats.
7. Tenantens durable last-known-good ska lämnas orörd under rollback.

## Exakt deploymentordning

1. Synka changed-files ZIP till en ren branch.
2. Kör `npm ci` med fungerande officiell/auktoriserad registry.
3. Kör `bash scripts/verify-production-release-2026-08-02.sh`; den ska först bli helt grön.
4. Lös de tre historiska duplicate migration versions genom en dokumenterad canonical normaliseringsplan utan att ändra redan verifierade SQL-effekter.
5. Bygg en disposable clean DB och applicera hela normaliserade kedjan.
6. Jämför schemafingerprint mot live.
7. Applicera nya migrationer i staging i ordning 230000, 231000, 232000, 233000.
8. Kör post-deployment SQL och Security Advisors i staging.
9. Kör tenant provisioning smoke i staging med ny testtenant.
10. Kör live-lik public-contract durability och OpenAPI SHA-test.
11. Välj vilken befintlig website credential som ska behållas och kör explicit duplicate repair.
12. Deploya applikationskoden.
13. Applicera verifierade migrationer live.
14. Reparera ledger endast för objekt vars exakta effekter och checksums är bevisade, enligt aktuell Supabase CLI `migration repair --help`.
15. Populera canonical manifest med verifierat release-ID/schemafingerprint.
16. Kör `gridex_refresh_platform_schema_state_v2`.
17. Aktivera leaked-password protection i Supabase Auth.
18. Kör Advisors, SQL, API smoke och live OpenAPI SHA-paritet.
19. Markera release grön först när alla blockerare är noll.

## Post-deployment verifiering

- SQL: `scripts/post-deployment-verification-2026-08-02.sql`.
- API/OpenAPI: `scripts/post-deployment-api-verification-2026-08-02.sh`.
- Full gate: `scripts/verify-production-release-2026-08-02.sh`.

## Alla ändrade och tillagda filer

| Fil | Förklaring |
|---|---|
| `__tests__/api-canonical-release.test.ts` | Uppdaterat eller nytt beteendetest för canonical API, cache, juridik, feeddurabilitet eller releaseparitet. |
| `__tests__/contract-channel-publication-completion.test.ts` | Uppdaterat eller nytt beteendetest för canonical API, cache, juridik, feeddurabilitet eller releaseparitet. |
| `__tests__/market-price-api-contract.test.ts` | Uppdaterat eller nytt beteendetest för canonical API, cache, juridik, feeddurabilitet eller releaseparitet. |
| `__tests__/public-contract-api-hardening.test.ts` | Uppdaterat eller nytt beteendetest för canonical API, cache, juridik, feeddurabilitet eller releaseparitet. |
| `__tests__/public-contract-canonical-model.test.ts` | Uppdaterat eller nytt beteendetest för canonical API, cache, juridik, feeddurabilitet eller releaseparitet. |
| `__tests__/public-contract-last-known-good.test.ts` | Uppdaterat eller nytt beteendetest för canonical API, cache, juridik, feeddurabilitet eller releaseparitet. |
| `__tests__/public-contract-route-openapi-regression.test.ts` | Uppdaterat eller nytt beteendetest för canonical API, cache, juridik, feeddurabilitet eller releaseparitet. |
| `app/admin/platform/api-clients/actions.ts` | Adminflödet använder kanonisk idempotent tenant website provisioning. |
| `app/api/v1/openapi/2026-08-02.1/customer-portal-v1.json/route.ts` | Ny immutable OpenAPI-route för release 2026-08-02.1. |
| `app/api/v1/openapi/2026-08-02.1/website-integration-v1.json/route.ts` | Ny immutable OpenAPI-route för release 2026-08-02.1. |
| `app/api/v1/openapi/customer-portal-v1.json/route.ts` | Current OpenAPI-route med no-store och synkroniserad release. |
| `app/api/v1/openapi/website-integration-v1.json/route.ts` | Current OpenAPI-route med no-store och synkroniserad release. |
| `app/api/v1/website/public-contracts/route.ts` | Representation-safe ETag, fail-closed mapping, canonical empty-feed-bevis och no-store. |
| `app/developers/customer-portal-api/page.tsx` | Utvecklarsidan synkroniserad med cache, fullmakt, scopes, fel och release. |
| `artifacts/architecture-map-2026-08-02.md` | Audit-, inventory-, manifest-, klassificerings- eller leveransartefakt. |
| `artifacts/canonical-migration-manifest-after-verification.sql` | Audit-, inventory-, manifest-, klassificerings- eller leveransartefakt. |
| `artifacts/changed-files-2026-08-02.txt` | Audit-, inventory-, manifest-, klassificerings- eller leveransartefakt. |
| `artifacts/gridex-production-correction-report-2026-08-02.md` | Audit-, inventory-, manifest-, klassificerings- eller leveransartefakt. |
| `artifacts/live-readonly-audit-2026-08-02.json` | Audit-, inventory-, manifest-, klassificerings- eller leveransartefakt. |
| `artifacts/migration-inventory-2026-08-02.json` | Audit-, inventory-, manifest-, klassificerings- eller leveransartefakt. |
| `artifacts/openapi-release-manifest-2026-08-02.1.json` | Audit-, inventory-, manifest-, klassificerings- eller leveransartefakt. |
| `artifacts/sync-command-2026-08-02.txt` | Audit-, inventory-, manifest-, klassificerings- eller leveransartefakt. |
| `artifacts/test-classification-2026-08-02.json` | Audit-, inventory-, manifest-, klassificerings- eller leveransartefakt. |
| `artifacts/verification/build.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/full-command-summary.tsv` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/lint.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/lockfile-registry.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/migration-production-readiness.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/npm-ci-official-registry.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/npm-ci.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/npm-registry.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/public-contract-lkg-runtime-smoke.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-1.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-10.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-11.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-12.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-13.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-14.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-15.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-16.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-17.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-18.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-19.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-2.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-20.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-21.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-22.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-3.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-4.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-5.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-6.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-7.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-8.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-9.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/static-regression-summary.tsv` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/test.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `artifacts/verification/typecheck.log` | Full verifieringslogg eller sammanfattning från denna körning. |
| `docs/external-integration-contract-tests.md` | API-/tenant-/smoke-dokumentation synkroniserad med runtime. |
| `docs/external-website-api-integration-guide.md` | API-/tenant-/smoke-dokumentation synkroniserad med runtime. |
| `docs/fixtures/public-contracts-response-2026-08-02.1.json` | Versionsbunden API-fixture för kontraktsvalidering. |
| `docs/gridex-customer-portal-api.md` | API-/tenant-/smoke-dokumentation synkroniserad med runtime. |
| `docs/openapi/customer-portal-v1.json` | Kanonisk OpenAPI uppdaterad till 2026-08-02.1 med scopes, errors, legal och feedmetadata. |
| `docs/openapi/website-integration-v1.json` | Kanonisk OpenAPI uppdaterad till 2026-08-02.1 med scopes, errors, legal och feedmetadata. |
| `docs/single-api-key-tenant-integration.md` | API-/tenant-/smoke-dokumentation synkroniserad med runtime. |
| `docs/staging-smoke-test-checklist.md` | API-/tenant-/smoke-dokumentation synkroniserad med runtime. |
| `lib/api/apiError.ts` | Kanoniskt API-error envelope/route-register. |
| `lib/api/publicRouteRegistry.ts` | Kanoniskt API-error envelope/route-register. |
| `lib/external-contracts/publicContractModel.ts` | Extern kontraktsmodell och legal/fullmakt-validering. |
| `lib/integrations/openApiReleaseManifest.ts` | Kanoniskt release-, scope-, error- eller API-kontrakt. |
| `lib/integrations/public-api-error-registry.json` | Kanoniskt release-, scope-, error- eller API-kontrakt. |
| `lib/integrations/publicApiErrorRegistry.ts` | Kanoniskt release-, scope-, error- eller API-kontrakt. |
| `lib/integrations/publicApiErrors.ts` | Kanoniskt release-, scope-, error- eller API-kontrakt. |
| `lib/integrations/publicContractFeedSnapshot.ts` | Durable last-known-good, timeout och verifierad tom-feed-övergång. |
| `lib/integrations/tenantWebsiteProvisioning.ts` | Ny idempotent och resumable tenant-installation med preflight och kvitto. |
| `lib/integrations/websiteIntegrationContract.ts` | Kanoniskt release-, scope-, error- eller API-kontrakt. |
| `lib/website/publicContractApi.ts` | Deterministisk canonical JSON och representation-baserat ETag. |
| `lib/website/publicContracts.ts` | Gemensam readinesskälla, fail-closed feed och korrekt fullmaktsversion. |
| `package.json` | Nya scripts för error registry, migration inventory/readiness och releaseverifiering. |
| `scripts/canonical-external-api-runtime-parity.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/check-api-compatibility.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/check-api-documentation-examples.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/check-api-documentation-version.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/check-production-migration-readiness.cjs` | Produktionsgate som blockerar historiska dubblettversioner. |
| `scripts/check-public-api-error-registry.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/check-public-contract-runtime-openapi.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/ediel-production-send-guard-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/ediel-utilts-reason-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/energy-resolver-grid-owner-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/finalize-openapi-release.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/generate-canonical-migration-inventory.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-canonical-fixed-area-flow-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-canonical-market-resolution-quote-billing-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-canonical-portfolio-pricing-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-contract-api-signature-visibility-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-contract-commercial-selection-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-contract-go-live-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-contract-security-energy-direction-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-invoice-fee-canonical-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-market-price-api-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/gridex-poa-authorization-chain-regression.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/migration-history-manifest.json` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/post-deployment-api-verification-2026-08-02.sh` | Read-only post-deployment SQL/API-verifiering. |
| `scripts/post-deployment-verification-2026-08-02.sql` | Read-only post-deployment SQL/API-verifiering. |
| `scripts/verify-clean-migration-reconstruction-2026-08-02.sh` | Ny strikt release-/clean-reconstruction-gate. |
| `scripts/verify-openapi-release.cjs` | Regression, versions-, dokumentations-, OpenAPI- eller migrationskontroll synkroniserad. |
| `scripts/verify-production-release-2026-08-02.sh` | Ny strikt release-/clean-reconstruction-gate. |
| `supabase/migrations/20260802230000_public_contract_delivery_consistency.sql` | Ny gemensam kanalneutral public-contract readiness-vy. |
| `supabase/migrations/20260802231000_tenant_website_provisioning_guards.sql` | Installationskvitton, primärklientguard, provisioning- och repair-RPC. |
| `supabase/migrations/20260802232000_migration_truth_readiness.sql` | Fail-closed migration manifest/schema readiness och fingerprint-RPC. |
| `supabase/migrations/20260802233000_security_definer_execution_lockdown.sql` | SECURITY DEFINER execute-lockdown för trigger/interna funktioner. |
