# Spår 5, körning t5r3: fynd och utfall (EVENT01, AUTH01, API01)

Den här körningen ersätter t5r2 som underlag för utfall. Den kördes efter granskningsrunda 2 med rättad harness: skanningen för AUTH01.06 körs efter alla andra scenarier, och API01.02 är självständig med kundkontroll per site och kvitton för alla anrop. Historiken finns kvar i `../../t5r2/claude-track5/FINDINGS.md` och `../../t5r1/claude-track5/FINDINGS.md`.

## Körningsmiljö

| | |
|---|---|
| **Kampanj** | `20261029-3f1a8ab1` |
| **Arbetare** | `claude-track5`, session `session_01UHTg8KRCLzrvSEoYLm14un` |
| **Bas** | `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56` |
| **Byggd app och harness** | `241a29db` (gren `claude/sim-20261029-track5`) = bas plus harness och paket; `git diff 1c0c088c..241a29db` rör bara `scripts/simulation/track5/` och `quality/simulation-campaign/` |
| **Replay** | ny replay av `241a29db` 2026-10-30T12:49:55Z, efter att föregående stack revs med `down.sh` 12:47:14Z |
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

**Evidens.** Den ligger privat i `/root/sim-evidence/t5r3/claude-track5/final/`:
- rapporter, vitest-loggar och stegkvitton (`*.receipts.jsonl`);
- schemafingeravtryck;
- skanningsrapporten `scan-report.json` (AUTH01.06).

Varje status.json listar alla filer med sha256 och innehåller sitt ID:s stegkvitton. Kvittona innehåller HTTP-status, bodySHA, publika ID:n och räknare. De innehåller inga tokens eller secrets.

## Fynd

Fynd-ID har formen `20261029-3f1a8ab1/claude-track5/<n>`.

### 001: partnerskrivningar utan kund ger 500

| | |
|---|---|
| **Kategori** | Produktfel, styrkt |
| **Allvar** | Hög |
| **Berör** | API01.01, API01.04 och förutsättningen för EVENT01 |

**Observerat.** `POST /api/partner/v1/customer`, `/contract` och `/webhooks/subscriptions` gav 500 med `23502` på `customer_portal_write_idempotency.customer_id`. Request-ID:n i t5r3:
- `f1d1c430`, för customer;
- `6b695b29`, för contract;
- webhooks-anropet i EVENT01 SETUP ger samma 500 (se EVENT01.01:s kvitto).

**Rotorsak.** Migrationen `20260712100000:968` sätter `customer_id` till `set not null`. `claimPortalWriteIdempotency` (`lib/api/strictRequest.ts:95-120`) skriver ändå `customer_id = null` för kundlösa skrivningar. Designen förutsätter NULL, eftersom två mekanismer redan finns för det:
- indexet `customer_portal_write_idempotency_pre_resolution_uidx WHERE customer_id IS NULL` (`20260809180628:26-29`);
- NULL-hanteringen i `strictRequest.ts:133-135`.

**Kundlösa anropare:**
- **partner simple:** `/api/partner/v1/customer`, `/contract` och `/webhook/subscription` (`simple.ts:559`, `:815`, `:1150`);
- **partner core:** `/customers`, `/contracts` och `/webhooks/subscriptions` (`core.ts:448`, `:760`, `:811`);
- **portalen:** `/api/v1/customer-portal/sync`;
- **staff-API:** `/api/v1/staff/users`, där routen är dynamisk (`lib/staff-api/userHandlers.ts:26-67`).

**Beslut.** Godkänt är ett CHECK `customer_id IS NOT NULL OR route IN (exakt lista med sju konstanta routes)` med version `20261030130100`, köad efter #944. Staff-API:ts dynamiska routes är fynd 006.

**Rättning.** PR #946. Native-regressionen gav 4/4 efter migrationen och var röd före. Status: **RÄTTAD-VÄNTAR-GEN**.

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

**Evidens.** Den ursprungliga t5r2-observationen sparades inte. Därför reproducerades den 2026-10-30T13:03Z i T5-stacken med #944:s migration applicerad och 003-ändringarna i koden bortplockade, i native-testet `scripts/webhook-public-event-id-native.test.ts` på grenen `claude/sim-20261029-track5-fix003`. Leveransen till en partner-subscription fick `status = failed`, `attempts = 2` och `failure_reason = "Public response contains a forbidden internal field at $.event_id."`. Privat evidens finns i `/root/sim-evidence/t5r3/claude-track5/fix003/`:
- `before-fix-delivery.txt`, sha `53d58c47…2e04`;
- `before-fix.log`, sha `13ba1e7b…c151`.

I t5r3, som körs på ren bas, döljs 003 av 002.

**Beslut.** Alternativ (a): ett slumpat, lagrat `event_id` med unik constraint och format-CHECK, därefter ett smalt undantag i skyddet för exakt `$.event_id` med exakt regex `^event_[a-f0-9]{32}$`, med negativa tester. Version `20261030130200`, köad efter #946.

**Status.** Rättningen pågår på `claude/sim-20261029-track5-fix003`: migration, payload, skydd, enhetstest och native-test. Den är inte pushad ännu.

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
- Funktionen finns varken i det replayade schemat eller i `schema.sql`. Den finns bara i legacy-migrationerna `20260525_debug_fix_batch_1b…`, `20260525_debug_batch_2_rbac_tenant_alignment.sql:156` och `20260526_debug_step1_2c…`.

Det är samma driftklass som 002. Det är obekräftat om produktion har funktionen.

**Observerat i t5r3.** Server action `updateIntegrationApiClientPermissionsAction` mot `/admin/platform/api-clients` ger 503, och klientens scopes är oförändrade efteråt.

**Beslut.** Alternativ B: en SECURITY DEFINER-funktion med `search_path = ''`, som bara svarar för eget id eller service_role. REVOKE ALL FROM PUBLIC och anon; EXECUTE bara till authenticated och service_role. Version `20261030130300`, köad efter 003.

**Rättning.** PR #948. Native-regressionen gav 4/4 efter migrationen och var röd före med `PGRST202`. Status: **RÄTTAD-VÄNTAR-GEN**. I T5-stacken passerar `/admin/platform/api-clients` proxyn efter migrationen, men server action nekas då av fynd 008.

### 006: staff-API:ts kundlösa skrivningar med dynamisk route

| | |
|---|---|
| **Kategori** | Produktfel, sannolikt (samma klass som 001) |
| **Allvar** | Hög |
| **Berör** | Inga T5-ID direkt |

**Observerat.** `lib/staff-api/userHandlers.ts:26-67` skriver kundlösa idempotensrader med en route som beror på anropet. Därför täcks de inte av 001:s konstanta lista.

**Status.** Separat PR enligt beslut. Den är inte påbörjad.

### 007: legacy-versionen av `gridex_get_user_roles` läckte roller till anon

| | |
|---|---|
| **Kategori** | Säkerhetsrisk, ej bekräftad i produktion |
| **Allvar** | Hög tills motsatsen visats |
| **Berör** | Ingen T5-körning; upptäckt vid granskning av 005 |

**Observerat.** Legacy-definitionerna gav EXECUTE till anon (via PUBLIC) och tog ett fritt `p_user_id`, så vem som helst kunde läsa en annan användares roller. Om produktion har den versionen kan produktionen inte kontrolleras från spåret.

**Status.** Registrerat i PR930 (kommentar 6523351793). 005:s migration ersätter funktionen med en självbegränsad version.

### 008: en plattformsadmin som bara finns i `admin_users` nekas av adminguarden

| | |
|---|---|
| **Kategori** | Produktfel eller fixturfråga, styrkt i T5-stacken; kräver beslut |
| **Allvar** | Hög för plattformsdrift |
| **Berör** | API01.05 (utfärdandevägen), synlig först efter 005 |

**Observerat.** Med 005:s migration applicerad i T5-stacken gav server action `updateIntegrationApiClientPermissionsAction` 500, och appens logg visar `Endast platform admin kan utföra den här åtgärden.` (`lib/admin/guards.ts:214`). Scopes var oförändrade. Den privata evidensen ligger i `/root/sim-evidence/t5r3/claude-track5/fix005/api01-after-005-*`.

**Rotorsak.** `canonical_authenticated_tenant_context_v1_scoped` (`schema.sql:39210`) ger `is_platform_admin = true` via `canonical_actor_is_platform_admin`, som godtar `admin_users`. Men `roles` och `permissions` byggs bara från `user_roles` (`schema.sql:39308-39325`), och det kanoniska schemat har ingen roll `platform_admin`. Därför blir `isAdmin` falskt (`guards.ts:164-166`).

**Status.** Beslut är begärt hos samordningen. Fixturen ändras inte för att dölja felet.

## Harness och miljö

| Försök | Fel | Rättning |
|---|---|---|
| granskningen av t5r1 | inloggningen gick inte via appens `loginAction`; utgången session saknades; för få kvitton och för svaga assertions | åtgärdat i `ee0bb862` och `615dd209` |
| t5r2 api01-poa (attempt1) | `Cannot find package 'server-only'` när backendingången laddades | alias, `2c48389b` |
| granskningen av t5r2 | AUTH01.06 skannade innan alla körningar var klara; API01.02 berodde på API01.01 och saknade kundkontroll per site; paketfälten var ofullständiga | `scan.test.ts`, en självständig API01.02 och paketfälten, `241a29db` |
| granskningen av t5r3 | paketskanningen täckte t5r2-katalogen, eftersom t5r3-paketen skrevs efter skanningen; AUTH01.06:s paket redovisade inte skanningskörningen | skanningen körs om efter `packet.py` med `SIM_PACKETS_DIR`, och `additionalRuns` läggs till i paketet |

**Paketfält.** `model` anger sessionen. Det exakta modell-ID:t finns i sessionens metadata och publiceras inte i repot. `cleanupReceipt` anger att stacken behålls för omkörning efter rättningarna.

## Utfall per ID

Utfallen gäller t5r3 med harness och app `241a29db`, och skanningen efter paketen med harness `39f0fd02`. PASS sätts först efter oberoende granskning. Granskningsrunda 3 (13:06Z) godkände PASS för AUTH01.01–.05, EVENT01.02 och API01.02 och underkände AUTH01.06. Efter omkörning mot de levererade paketen godkändes AUTH01.06 vid omgranskning (cirka 13:21Z).

**Bekräftande skanning.** Ett paket kan inte lista en skanning av sig självt. Därför skannas de slutliga paketbytes en gång till efter varje ändring (`scan-confirm/`), och resultatet kvitteras i PR930 med rapportens sha256. Den första bekräftande skanningen (13:20:28Z, sha `fc8aa3df…a599`) gällde `c6aa721d`.

| ID | Stegutfall | Föreslaget | Blockerare |
|---|---|---|---|
| AUTH01.01–.05 | alla gröna (AUTH01.05 i två delar) | **PASS** (godkänt i runda 3) | – |
| AUTH01.06 | gröna: klient-/svarsskanning, och skanning efter alla körningar och efter att paketen skrivits, 0 träffar | **PASS** (godkänt vid omgranskning) | – |
| EVENT01.01, .03, .05 | gröna | PARTIAL | 001/002 (subscription bara via fixtur), 003 |
| EVENT01.02 | grönt | **PASS** (godkänt i runda 3) | – |
| EVENT01.04 | rött (`failure_count` 0) | FAIL | 002 |
| API01.01 | site grönt; kund och avtal röda | FAIL | 001 |
| API01.02 | grönt | **PASS** (godkänt i runda 3) | – |
| API01.03 | Z03-spärren grön; simple-GET röd | FAIL | 004 |
| API01.04 | grönt för site och POA | PARTIAL | 001 (kund och avtal) |
| API01.05 | körtidsnekanden gröna; utfärdandet rött (503) | PARTIAL | 005 |
