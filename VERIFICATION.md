# Verifiering och produktionsgrind

Statusvärdena är `PASS`, `FAIL`, `BLOCKED` eller `NOT RUN`. `PASS` används
endast där kommandot faktiskt kördes i det levererade källträdet.

| Kontroll | Status | Evidens |
| --- | --- | --- |
| Historisk migration återställd | PASS | SHA-256 `881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482` |
| Tidigare forward-reparation registrerad | PASS | `20260730130000...`, SHA-256 `3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b` |
| Customer Portal/API-migration registrerad | PASS | `20260730153000...`, SHA-256 `b5a9f323400a4e3592f3e392bf94695161969c1d5b0ba8d99cace9821338d740` |
| `npm run db:migrations:check` | PASS | 324 filer, 228 versionsgrupper, checksummor verifierade |
| Unika migrationstimestamps globalt | BLOCKED | Tre äldre dubbla versionsgrupper är allowlistade; kräver faktisk applied-ledger före säker rename |
| Fresh database apply | NOT RUN | Ingen Supabase CLI/auktoriserad PostgreSQL-miljö |
| Upgrade database apply | NOT RUN | Ingen auktoriserad stagingdatabas |
| `npm run typecheck` | PASS | App-profil |
| `npm run typecheck:scripts` | PASS | Script-profil |
| `npm run typecheck:tests` | PASS | Testprofil |
| `npm run typecheck:ediel-consolidation` | PASS | EDIEL-profil |
| `npm run typecheck:contract-go-live` | PASS | Kontraktsprofil |
| `npm test` | PASS | 58 testfiler, 373 tester |
| `npm run lint` | PASS | 0 fel, 124 befintliga varningar |
| `npm run api:docs` | PASS | Contract, runtime parity, version, exempel och shared boundaries |
| `npm run api:error-boundaries` | PASS | 87 routes skannade |
| `npm run api:performance-tenant-gates` | PASS | Tenant-/prestandagrind grön |
| `npm run build` | PASS | Next.js 16.2.6 produktionsbuild |
| Exakt lokal OpenAPI-hashning | PASS | Website `920a774c...`; Portal `03712339...` |
| Lokal release-verifiering | PASS | `2026-07-30.2`; båda lokala kontrakten och manifestets SHA-256 matchar |
| Live release-manifest HTTP/version | NOT RUN | Patchen är inte driftsatt från denna arbetsmiljö |
| Live release-manifest SHA-paritet | NOT RUN | Kräver deployment och `GRIDEX_API_BASE_URL` |
| Två tenants/isolation | NOT RUN | API-nycklar och isolerade fixtures saknas |
| Quote concurrency/atomic consumption | NOT RUN | Auktoriserad databas och fixtures saknas |
| Webhook signatur/replay/idempotency round trip | NOT RUN | Receiver, secret och stagingmiljö saknas |
| Provider delivery | NOT RUN | Provider-sandbox/credentials saknas |
| Gridex Web sync/typecheck/lint/build | BLOCKED | Gridex Web-källkod saknades i underlaget |

## Kvarvarande releaseblockerare

1. Jämför de dubbla migrationsversionerna `20260612193000`,
   `20260616123000` och `20260727150000` med staging/produktions
   `schema_migrations`. Döp inte om redan applicerade filer utan denna evidens.
2. Kör fresh och upgrade apply genom `20260730153000`. Den återställda
   historiska migrationens sekventiella function-text-rewrite måste bevisas i
   PostgreSQL; statisk checksumkontroll räcker inte.
3. Deploya OPS och kräv att manifestets hash exakt motsvarar båda nedladdade
   OpenAPI-filerna.
4. Leverera aktuellt Gridex Web-repo, synkronisera specs/types och kör dess
   typecheck, lint, tester och build.
5. Kör full två-tenant-, quote-concurrency-, webhook- och provider-matris.

Produktionsstatus är därför **NO-GO** trots att alla lokala kodgrindar passerar.
