# Verifiering och produktionsgrind

Statusvärden: `PASS`, `BLOCKED` eller `NOT RUN`. `PASS` används endast för
kommandon som faktiskt kördes i det levererade källträdet.

| Kontroll | Status | Evidens |
| --- | --- | --- |
| `npm ci` | PASS | Installerat från befintlig lockfil med separat skrivbar npm-cache |
| `npm run db:migrations:check` | PASS | 325 filer, 229 versionsgrupper, checksummor verifierade |
| Prisalternativsmigrationens checksumma | PASS | `0ab350f0da6648a497a80aeaedc1688eb5ae88e6279d6ab486526c070ff8c505` |
| Unika migrationstimestamps globalt | BLOCKED | Tre äldre allowlistade dubletter kräver authoritative applied-ledger före säker rename |
| Fresh database apply | NOT RUN | Ingen Supabase CLI/auktoriserad PostgreSQL-miljö |
| Upgrade database apply | NOT RUN | Ingen auktoriserad stagingdatabas |
| Prisalternativ post-apply | NOT RUN | Kräver applicerad migration i PostgreSQL |
| `npm run typecheck` | PASS | App-profil |
| `npm run typecheck:scripts` | PASS | Scriptprofil |
| `npm run typecheck:tests` | PASS | Testprofil |
| `npm run typecheck:ediel-consolidation` | PASS | EDIEL-profil |
| `npm run typecheck:contract-go-live` | PASS | Kontraktsprofil |
| `npm test` | PASS | 58 testfiler, 376 tester |
| `npm run lint` | PASS | 0 fel, 124 befintliga varningar |
| `npm run api:docs` | PASS | Contract, runtime parity, version, exempel och shared boundaries |
| `npm run api:compatibility` | PASS | Kompatibilitetsgrind för `2026-07-30.3` |
| `npm run api:release:verify` | PASS | Båda lokala kontrakten och manifestets SHA-256 matchar |
| `npm run api:error-boundaries` | PASS | 87 routes skannade |
| `npm run api:performance-tenant-gates` | PASS | Tenant-/prestandagrind grön |
| `npm run verify:contract-commercial-selection:static` | PASS | Migration, typer, 6 tester, regression, API och build |
| `npm run verify:contract-channel-publication:static` | PASS | 4 tester, 43 publiceringskontroller och API |
| `npm run verify:canonical-fixed-area-flow` | PASS | 30 kontroller, 19 tester och build |
| `npm run verify:contract-go-live:static` | PASS | Go-live/lifecycle, 41 tester och samtliga kontraktsregressioner |
| `npm run build` | PASS | Next.js 16.2.6; körd med temporär `NODE_OPTIONS=--max-old-space-size=4096` |
| Website OpenAPI SHA-256 | PASS | `fdabd8196ae94482cd22928bf624b69ffe6a246e47b0781d698ec1701c80d6b2` |
| Customer Portal OpenAPI SHA-256 | PASS | `93d4cb523515948dae2f168b8cab629e1ef1d8238ddb8322b8ca75aa8a46d1f9` |
| Live release-manifest/version/hash | NOT RUN | Patchen är inte driftsatt |
| Två tenants/isolation | NOT RUN | API-nycklar och isolerade fixtures saknas |
| Quote/application concurrency och replay | NOT RUN | Auktoriserad databas och fixtures saknas |
| Webhook/provider round trip | NOT RUN | Receiver, secret, provider-sandbox och credentials saknas |
| Gridex Web sync/typecheck/lint/build | BLOCKED | Gridex Web-källkod saknades i underlaget |

## Kvarvarande releaseblockerare

1. Matcha dublettversionerna `20260612193000`, `20260616123000` och
   `20260727150000` mot staging/produktions `schema_migrations`.
2. Kör fresh och upgrade apply genom `20260730220000` och kör post-apply SQL.
3. Deploya OPS och kräv exakt versions- och SHA-paritet för manifestet och båda
   serverade OpenAPI-filerna.
4. Synkronisera det aktuella Gridex Web-repot och kör dess fulla verifiering.
5. Kör två-tenant-, quote/application-concurrency-, webhook- och provider-
   scenarier i staging.

Produktionsstatus är därför **NO-GO**, trots att alla lokala kodgrindar
passerar.
