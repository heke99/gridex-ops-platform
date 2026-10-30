# Spår 5, körning t5r1: fynd och utfall (EVENT01, AUTH01, API01)

- **Kampanj:** `20261029-3f1a8ab1`.
- **Arbetare:** `claude-track5`, session `session_01UHTg8KRCLzrvSEoYLm14un`. Startades av samordnaren `session_01UHTg8JiCGMJMf7GUYk6oYL` efter ägarbeslutet 6508595498.
- **Bas:** `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`. Den byggda appen är `6430db75` = bas + harness, utan ändringar i appkoden. Slutkörningens harness är `457a76ac`, grenen `claude/sim-20261029-track5`. Main `c0a7060b` har ingen skillnad mot basen i de berörda filerna (`lib/api/strictRequest.ts`, `supabase/migrations`).
- **Stack:** egen stack i containern `vm`. Ny replay av `c8a19062` kl. 2026-10-30T11:54:28Z med fingeravtryck `5168f69b…782c`, lika med `EXPECTED_FINGERPRINT`. `applied-migrations.tsv` är tom (sha `e3b0c442…`), alltså inga migrationer utöver replayen. `schema-fingerprint.out` har sha `2cb1ad4a…e839`.
- **Versioner och resurser:** PostgreSQL 17.6, Node 22.22.0, Next 16.4.2 (webpack-bygge), supabase CLI 2.101.0. 4 CPU och 16 GB RAM.
- **Klocka:** Auth/JWT använder real tid. Affärstiden är real tid, utom EVENT01.04 där backoffens utgång simuleras med `next_attempt_at = now()`. Det är en kontrollerad klocka, inte verklig väntan.
- **Orakel:** originalet `quality/simulation-register/oracles/all-systems-scenarios.safe.json` (sha `96518c18…29df3`, 41 736 byte, stämmer med registret) har bara beskrivningar per ID och kvittokrav per grupp. Det finns inga designvärden. Varje ID:s orakel är beskrivningens krav tillämpat på spårets egna syntetiska bolag A/B/C, och det prövas mot faktiska HTTP-svar och DB-rader.
- **Evidens:** ligger privat i `/root/sim-evidence/t5r1/claude-track5/final/`. Där finns rapporter, vitest-loggar, fingeravtryck och observationen för API01.03. Varje fil har sha256 i paketens `evidenceRefs`. Råloggar och hemligheter är inte publicerade.

## Fynd

### 20261029-3f1a8ab1/claude-track5/001: partnerskrivningar utan kund ger alltid 500

| | |
|---|---|
| **Kategori** | Produktfel, styrkt. |
| **Allvar** | Hög. Partner-API:ts registreringsflöde fungerar inte. |
| **Scenario-ID** | API01.01, och förutsättningen för EVENT01. |

**Observerat** på 1c0c088c i spårets stack, försök `api01-a2`–`a5`, `event01-a1`–`a4` och `final`:

| Anrop | Svar |
|---|---|
| `POST /api/partner/v1/customer` | HTTP 500 `partner_api_internal_error` |
| `POST /api/partner/v1/contract` | HTTP 500 `partner_api_internal_error` |
| `POST /api/partner/v1/webhooks/subscriptions` | HTTP 500 `partner_api_internal_error` |

Appens logg visar Postgres-felet `23502`: `null value in column "customer_id" of relation "customer_portal_write_idempotency" violates not-null constraint`.

Request-ID:n i slutkörningens loggar:
- `47d4b99e…` (customer) och `b66bd5ca…` (contract) i försök `api01-a5`;
- `26c88672…`, `10363bd9…` och `9eb4d30a…` (webhooks) i försöken `event01-a1`, `a3` och `a4`.

**Rotorsak:**
- `lib/api/strictRequest.ts:95-120` (`claimPortalWriteIdempotency`) skriver `customer_id: input.customerId`.
- Anropen `createCustomer` (`lib/partner-api/simple.ts:547`), `createContract` (`simple.ts:734`) och `createWebhook` (`lib/partner-api/core.ts:789`) skickar alla `customerId: null`.
- Migrationen `20260712100000_gridex_end_to_end_integrity_hardening.sql:968` gör `customer_portal_write_idempotency.customer_id` till `NOT NULL`, vilket också syns i `supabase/schema.sql`.
- Unikindexet på rad 971–972 innehåller `customer_id`. Om kolumnen bara görs nullbar skulle NULL-raderna därför inte deduplicera.

**Inte drabbat:** skrivningar med känd kund, alltså `customer/{id}/site` och `.../powerofattorney`. Där gav API01.02 och API01.04 grönt.

**Rättning:** inte gjord. Det är sim-fixer-område (idempotensledger, migration). Det krävs ett beslut om vägen:
- antingen en migration som tillåter NULL och samtidigt bevarar unikheten (`NULLS NOT DISTINCT` eller en separat partiell index), vilket blir RÄTTAD-VÄNTAR-GEN;
- eller att kundlösa partnerskrivningar använder `integration_api_write_idempotency`.

Beslutet är anmält till samordnaren.

**Hypotes, inte prövad:** att produktionsschemat har samma constraint. `schema.sql` har den.

### 20261029-3f1a8ab1/claude-track5/002: schemadrift i `webhook_subscriptions`

| | |
|---|---|
| **Kategori** | Produktfel, styrkt. |
| **Allvar** | Hög. Inga partner-webhooks kan skapas, och subscriptionens hälsospårning är en tyst no-op. |
| **Scenario-ID** | EVENT01.01–.05 (förutsättningen). |

**Observerat:**
- Det replayade schemat och `supabase/schema.sql` saknar `webhook_subscriptions.api_client_id`, `description`, `metadata`, `last_success_at` och `last_failure_at`.
- Ett direkt anrop av `gridex_create_partner_webhook_subscription_v1` (försök `event01-a1`) gav `42703 column "api_client_id" of relation "webhook_subscriptions" does not exist`. RPC:n i `20260816170000…sql:77-107` skriver till alla tre kolumnerna.
- Retry-subscriptionen hade `failure_count = 0` efter 4 misslyckade försök och dead_letter. `updateSubscriptionFailure` och `updateSubscriptionSuccess` (`lib/integrations/webhooks.ts:435-462`) skriver `last_failure_at`/`last_success_at`, men felet sväljs av `missingSchema`. Följden är att den automatiska pausen efter 10 misslyckanden aldrig utlöses.
- `isPartnerSubscription` (`webhooks.ts:393`) läser `metadata.source`. Utan kolumnen räknas varje subscription som en website-subscription, så partner-payloaden projiceras aldrig.

**Rotorsak (sannolik):** `create table if not exists public.webhook_subscriptions` i `20260609162000_batch_7_website_integration_foundation.sql:225` blir en no-op när tabellen redan finns från en tidigare migration, så kolumnerna läggs aldrig till.

**Påverkan:** utöver partner-API:t inserterar även `lib/integrations/tenantWebsiteProvisioning.ts:230` `api_client_id`. Det är inte prövat i den här körningen.

**Rättning:** inte gjord. Det krävs en framåtmigration som lägger till kolumnerna, och den blir RÄTTAD-VÄNTAR-GEN. Beslutet är anmält.

### Harness- och miljöfel (rättade i harnessen, inte produktfel)

| Försök | Fel | Rättning |
|---|---|---|
| up (1) | `next build` fick slut på minne i typkontrollen (~2 GB). Underprocessen ärver inte `--max-old-space-size`. | `NODE_OPTIONS=--max-old-space-size=6144` (c8a19062) |
| up (2) | `app.env` kunde inte sourcas, eftersom värdet med mellanslag saknade citat. | Kommaseparerat (6430db75) |
| auth01-a1 | Fixturen gav bara `user_permissions`. Appens bolagsscopade motor kräver `user_roles` + `role_permissions`, vilket gav 403. | Rollspegling enligt `scripts/helpers/browserFixture.ts` (`mirrorBrowserRolePermissions`) |
| auth01-a1 | Kontrollen sökte anon-nyckeln i `.next/static`, men klientbundlen innehåller ingen Supabase-nyckel, så kontrollen var ogiltig. | Kontroll mot en känd sträng och storlek |
| api01-a1/a2 | Partnernyckeln var inte launch-ready (403 `api_client_not_launch_ready`). | Fixturen fick installationskvitto, `launch_ready` och capability `api_sales` |
| api01-a3/a4 | Erbjudandefixturen: aktören saknade `contracts.*`/`pricing.*`, och API-kanalen var inte tillåten. | Behörigheter och `tenant_contract_assignments.api_publication_allowed` |
| api01-a3 | Oraklet för återkallad nyckel krävde 401, men appen ger 403 `api_client_inactive`. Det är en nekan i båda fallen. | 401/403 med explicit felkod |
| event01-a2/a3 | Leveransen blev `blocked_tenant_state/capability_not_ready`. Det är en korrekt spärr. | Tenantens capability `webhooks` = ready |

Varje originalförsök finns kvar i evidenskatalogen (`auth01-a1`, `api01-a1`…`a5`, `event01-a1`…`a4`).

## Utfall per ID (slutkörning `final`, harness 457a76ac)

Stegutfallen står i varje `status.json`. Ett ID får PASS först efter oberoende granskning, se respektive paket.

| ID | Steg | Utfall | Kommentar |
|---|---|---|---|
| AUTH01.01–.06 | 6/6 gröna | se paket | Riktig GoTrue-session och appens Set-Cookie för bolagsbyte. AUTH01.05: den gamla cookien avvisas efter logout (401 och redirect till /login). |
| EVENT01.01, .03, .04, .05 | gröna | se paket | Leveranskedjan händelse → kö → dispatch → signerat kvitto är prövad. Subscriptionen kan bara skapas som SQL-fixtur (fynd 001/002). Retry-väntan är simulerad med kontrollerad klocka. |
| EVENT01.02 | grönt | se paket | Inbound `/api/webhooks/resend`: fel signatur ger 401, saknade headers 400, giltig signatur över ändrad kropp 401, korrekt signatur 200. Oberoende av fynden. |
| API01.01 | 1 av 3 delsteg grönt | FAIL | Kund och avtal ger 500 (fynd 001). Site-steget är grönt. |
| API01.02 | grönt | se paket | Kunden skapas som fixtur (fynd 001). Site och POA går via partner-API:t. |
| API01.03 | observation | BLOCKED | Orakel kräver beslut, se nedan. |
| API01.04 | grönt | se paket | Prövat för site- och POA-skrivningar. Kund och avtal går inte att pröva (fynd 001). |
| API01.05 | grönt | se paket | – |

### API01.03: orakel kräver beslut

Partner-API:t har inget begrepp för POA-giltighet. Observationen (`API01.03.json`, sha `acbd6475…`):
- `POST …/powerofattorney` med `valid_to` i det förflutna ger 422 `unsupported_field`.
- En befintlig POA som görs utgången i DB (kontrollerad klocka: `valid_to`, `valid_until` och `expires_at` = 2020-01-01) returneras av `GET …/powerofattorney` med 200, som en vanlig POA utan giltighetsinformation.
- Läsningen är tenantbunden: B:s nyckel får 404.

Det är oklart vilken normal ingång som ska neka en utgången POA: partner-API:ts GET, avtalsskapandet eller leverantörsbytet (Ediel, spår 3). Ingen PASS och ingen ny FAIL ges utan ett kvalificerat kontrakt för den ingången.
