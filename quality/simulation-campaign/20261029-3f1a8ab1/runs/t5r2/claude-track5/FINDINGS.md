# Spår 5, körning t5r2: fynd och utfall (EVENT01, AUTH01, API01)

Den här körningen ersätter t5r1 som underlag för utfall. Historiken finns kvar i `../../t5r1/claude-track5/FINDINGS.md`, och originalförsöken finns i den privata evidensen.

## Körningsmiljö

| | |
|---|---|
| **Kampanj** | `20261029-3f1a8ab1` |
| **Arbetare** | `claude-track5`, session `session_01UHTg8KRCLzrvSEoYLm14un` |
| **Bas** | `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56` |
| **Byggd app** | `ee0bb862` = bas plus harness, ingen ändring i appkoden |
| **Slutkörningens harness** | `2c48389b` (gren `claude/sim-20261029-track5`) |
| **Replay** | ny replay av `ee0bb862` 2026-10-30T12:28:57Z |
| **Fingeravtryck** | `5168f69b…782c`, lika med EXPECTED |
| **Applicerade migrationer** | inga utöver replayen (`applied-migrations.tsv` är tom) |
| **schema-fingerprint.out** | sha `2cb1ad4a…e839` |
| **Versioner** | PG 17.6, Node 22.22.0, Next 16.4.2, supabase CLI 2.101.0 |
| **Resurser** | 4 CPU, 16 GB RAM |

**Auth.** Stackens Auth har en verklig men kort livslängd, satt bara i konfigkopian: `jwt_expiry` är 60 s och `sessions.timebox` är 3 min. Tiden är real, och klockan manipuleras inte.

**Affärstid.** Real tid, med kontrollerad klocka på två ställen:
- EVENT01.04: `next_attempt_at = now()`;
- API01.03: `valid_to = current_date - 1`, följt av appens eget svep.

**Orakel.**
- Originalet `quality/simulation-register/oracles/all-systems-scenarios.safe.json` har sha `96518c18…29df3` och 41 736 byte, vilket stämmer med registret.
- Det är byteidentiskt med samordnarens återställda kopia på `claude/adoring-wright-8qbon8@27862b90`.
- Varje ID:s orakel är originalets beskrivning, tillämpad på spårets egna syntetiska bolag.
- API01.03 använder samordningens kvalificerade orakel från 2026-10-30 12:13Z. Inget av T5:s ID har numeriska designvärden.

**Evidens.** Den ligger privat i `/root/sim-evidence/t5r2/claude-track5/final/`:
- rapporter, vitest-loggar och stegkvitton (`*.receipts.jsonl`);
- schemafingeravtryck;
- `attempt1/` med det första försöket för api01 och api01-poa.

Varje status.json listar alla filer med sha256 och innehåller sitt ID:s stegkvitton. Kvittona innehåller HTTP-status, bodySHA, publika ID:n och räknare. De innehåller inga tokens eller secrets.

## Fynd

Fynd-ID har formen `20261029-3f1a8ab1/claude-track5/<n>`.

### 001: partnerskrivningar utan kund ger 500

| | |
|---|---|
| **Kategori** | Produktfel, styrkt |
| **Allvar** | Hög |
| **Berör** | API01.01, API01.04 och förutsättningen för EVENT01 |

**Observerat.** `POST /api/partner/v1/customer`, `/contract` och `/webhooks/subscriptions` gav 500 med `23502` på `customer_portal_write_idempotency.customer_id`. Request-ID:n i slutkörningen:
- `02af7dc4`, för customer;
- `dcf32d1e`, för contract;
- `85ae5f03`, för webhooks.

**Rotorsak.** Migrationen `20260712100000:968` sätter `customer_id` till `set not null`. `claimPortalWriteIdempotency` (`lib/api/strictRequest.ts:95-120`) skriver ändå `customer_id = null` för kundlösa skrivningar. Designen förutsätter NULL, eftersom två mekanismer redan finns för det:
- indexet `customer_portal_write_idempotency_pre_resolution_uidx WHERE customer_id IS NULL` (`20260809180628:26-29`);
- NULL-hanteringen i `strictRequest.ts:133-135`.

**Kundlösa anropare:**
- **partner simple:** `/api/partner/v1/customer`, `/contract` och `/webhook/subscription` (`simple.ts:559`, `:815`, `:1150`);
- **partner core:** `/customers`, `/contracts` och `/webhooks/subscriptions` (`core.ts:448`, `:760`, `:811`);
- **portalen:** `/api/v1/customer-portal/sync`;
- **staff-API:** `/api/v1/staff/users`, där routen är dynamisk (`lib/staff-api/userHandlers.ts:26-67`).

**Beslut.** Godkänt är ett CHECK `customer_id IS NOT NULL OR route IN (exakt lista)` med version `20261030130100`, köad efter #944. Beslut om staff-API:ts dynamiska routes är begärt.

**Status.** Rättningen är inte påbörjad.

### 002: schemadrift i `webhook_subscriptions`

| | |
|---|---|
| **Kategori** | Produktfel, styrkt |
| **Allvar** | Hög |
| **Berör** | EVENT01.01–.05; FAIL för EVENT01.04 |

**Observerat:**
- Kolumnerna `api_client_id`, `description`, `metadata`, `last_success_at` och `last_failure_at` saknas, både i stacken och i `schema.sql`.
- RPC:n för partner-subscription ger 42703.
- Retry-subscriptionen har `failure_count = 0` och saknar `last_failure_at` efter fyra fel och dead_letter, enligt EVENT01.04:s kvitto.

**Rotorsak (rättad efter granskning).** `20260609162000:290-295` lägger till kolumnerna. Den migrationen hör dock till den rekonstruerade legacy-grunden (`scripts/gridex-aud-003-legacy-foundation*.json`), och dess ALTER förs inte in i det kanoniska schemat. Hypotesen om `create table if not exists` är dragen tillbaka. Det är obekräftat om produktion har kolumnerna.

**Rättning.** PR #944 med migration `20261030130000`, som är idempotent. Native-regressionen gav 4/4 efter migrationen och var röd före. Status: **RÄTTAD-VÄNTAR-GEN**, och CI är rött bara på grund av manifestet.

### 003: partnerprojektionen nekas av det publika utdataskyddet

| | |
|---|---|
| **Kategori** | Produktfel, styrkt och latent (dolt av 002) |
| **Allvar** | Hög |
| **Berör** | EVENT01 med en verklig partner-subscription |

**Observerat.** I T5-stacken, efter att 002-migrationen applicerats, misslyckades varje leverans till en partner-subscription med `Public response contains a forbidden internal field at $.event_id`.

**Rotorsak.**
- `partnerWebhookPayload` (`lib/integrations/webhooks.ts:397-423`) lägger `event_id` på toppnivå.
- `assertPublicResponsePayload` (`lib/api/publicPayloadSafety.ts:57-62, 95-99`) tillåter bara `$.data[n].event_id`.
- Värdet kommer från `opaqueReference`, som är `sha256(tenantReference:event:eventId)` trunkerat (`webhooks.ts:77-87`). Det är alltså härlett och inte slumpat.

**Beslut.** Ett undantag krävde ett slumpat ID. Villkoret är inte uppfyllt, så undantaget faller. Beslut om ändrad payload är begärt.

### 004: partner-API:ts GET för POA redovisar inte utgången

| | |
|---|---|
| **Kategori** | Produktfel, styrkt mot kvalificerat orakel |
| **Allvar** | Medel |
| **Berör** | API01.03 |

**Observerat:**
- Efter att POA:n gjorts utgången redovisar `GET /api/partner/v1/customer/{c}/site/{s}/powerofattorney` varken `status` eller `valid_to`. Den routen hanteras av `simple.ts:900-930`, som prövas först.
- `GET /api/partner/v1/powers-of-attorney/{ref}` (`core.ts`) redovisar däremot `status: expired`.
- I DB är `status = expired` efter appens svep.

**Spärr vid leverantörsbyte.** Den fungerar. Z03 med utgången POA stoppas av `canonical switch-gate: supplier_switch_not_ready`, och kontrollen med giltig POA skapar ett Z03-meddelande.

**Rättning.** Inte påbörjad. Förslaget är att simple-GET också redovisar `status`, `valid_from`, `valid_to` och `revoked_at`, på samma sätt som canonical-svaret.

### 005: plattformsadminytan ger 503 i det kanoniska schemat

| | |
|---|---|
| **Kategori** | Produktfel eller schemadrift, styrkt |
| **Allvar** | Hög för plattformsdrift |
| **Berör** | API01.05 (utfärdandevägen) |

**Observerat.** Varje `/admin/platform/*` för en inloggad plattformsadmin ger 503. Appens logg visar `[auth-proxy] provider unavailable { operation: 'platform_admin_roles', code: 'PGRST202' }`.

**Rotorsak.**
- `proxy.ts:81-99` anropar RPC:n `gridex_get_user_roles`.
- Funktionen finns varken i det replayade schemat eller i `schema.sql`. Den finns bara i legacy-migrationerna `20260525_debug_fix_batch_1b…` och `20260526_debug_step1_2c…`.

Det är samma driftklass som 002. Det är obekräftat om produktion har funktionen.

**Rättning.** Inte påbörjad. Det kräver beslut.

## Harness och miljö

| Försök | Fel | Rättning |
|---|---|---|
| t5r2 api01-poa (attempt1) | `Cannot find package 'server-only'` när backendingången laddades | alias som i `scripts/ediel-source-owner-native.config.ts` (`2c48389b`) |
| granskningen av t5r1 | inloggningen gick inte via appens `loginAction`; utgången session saknades; för få kvitton och för svaga assertions | åtgärdat i `ee0bb862` och `615dd209` |

## Utfall per ID

Utfallen gäller slutkörningen med harness `2c48389b` och appen byggd på `ee0bb862`.

| ID | Stegutfall | Föreslaget | Blockerare |
|---|---|---|---|
| AUTH01.01–.06 | alla gröna (7 steg, AUTH01.05 i två delar) | PASS (efter granskning) | – |
| EVENT01.01, .03, .05 | gröna | PARTIAL | 001/002 (subscription bara via fixtur), 003 |
| EVENT01.02 | grönt | PASS (efter granskning) | – |
| EVENT01.04 | rött (`failure_count`) | FAIL | 002 |
| API01.01 | site grönt; kund och avtal röda | FAIL | 001 |
| API01.02 | grönt | PASS (efter granskning) | – |
| API01.03 | Z03-spärren grön; simple-GET röd | FAIL | 004 |
| API01.04 | grönt för site och POA | PARTIAL | 001 (kund och avtal) |
| API01.05 | körtidsnekanden gröna; utfärdandet rött | PARTIAL | 005 |
