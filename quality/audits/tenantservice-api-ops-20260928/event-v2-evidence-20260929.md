# Avgränsat event-v2-paket — #418 → #422

## Omfattning och ägarskap

Utgångspunkt: #418 `750510b81bb4ff98e20723ae3f97a0e1bbb6d34f`, gren
`codex/tenantservice-api-ops-20260928`. Kontrollerad #422-head:
`a826b5886e7b946ea10164d8f736eac07e8c6ac1`. Det senare API-arbetet och
dess lokala opushade commits bevaras. Skrivaransvaret för endast detta
SQL-/native-/artefaktpaket är dokumenterat i
[#418:s ägarskapskommentar](https://github.com/heke99/gridex-ops-platform/pull/418#issuecomment-5899551938).
Ny head/ägarskapskontroll krävs före varje icke-forcerad refuppdatering.

Isolerad checkout; andra arbetskopior och det delade Ediel-minnet ändras inte.
#422 äger API-routens byte, DTO/guide/release och integration. Här ändras
ingen API-route, kundsynlig eventpolicy, v1-funktion, historisk migration,
produktionsmiljö eller hel T/U-/P0–P8-acceptans. PR förblir draft.

## Bekräftad läsmodellslucka och RPC-kontrakt

`domain_events.event_version` är ett positivt `integer NOT NULL` i tabellen.
`portal_customer_events_page_v1` returnerar sju fält utan versionskolumnen.
Det separata API-spårets senare null-projektion gör frånvaron sanningsenlig,
men kan inte återge den lagrade versionen.

Framåtmigration:
`20260929214729_portal_event_version_read_model_v2.sql`.
Lokalt saknas Supabase CLI; filnamnet skapades enligt projektets verifierade
tidsstämpelformat och den nya checksumman registrerades med befintligt verktyg.
Ingen historisk checksumma ersattes.

```sql
public.portal_customer_events_page_v2(
  p_company_id uuid,
  p_customer_id uuid,
  p_cursor_occurred_at timestamptz DEFAULT NULL,
  p_cursor_source_rank integer DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51
) RETURNS TABLE (
  id uuid,
  source_table text,
  source_rank integer,
  event_type text,
  event_version integer,
  source text,
  occurred_at timestamptz,
  created_at timestamptz
)
```

`STABLE SECURITY INVOKER`, `search_path=public, pg_catalog`. EXECUTE återkallas
från PUBLIC/anon/authenticated och tilldelas service_role. Kundhändelser saknar
egen versionskolumn och får uttrycklig version 1; domänhändelser returnerar
oförändrad lagrad version. Filter, båda källor, `UNION ALL`, mikrosekunder,
`COALESCE(occurred_at,created_at)`, fallande timestamp/rank/UUID och strikt
lexikografisk cursor bevaras. SQL-limit är fortsatt standard 51 och clamp
1–101, inklusive null/negativa värden. API:t använder fortsatt sin egen
limit + 1 för lookahead och sin tenant-/kund-/resursbundna cursor.

## Native-prov och genereringsstrategi

`scripts/portal-event-v2-native.sql` är kopplad till ordinarie
`clean-migration-replay` direkt efter portalens återkallelseprov. Alla fixture-
skrivningar är syntetiska i samma rollback-transaktion på replayens lokala
PostgreSQL. Den nya RPC:n anropas faktiskt under `SET LOCAL ROLE service_role`.

| Prov | Faktiskt native-resultat: PASS |
| --- | --- |
| V1-lucka på samma lagrade rad | version 7 i tabellen; versionsfält saknas i faktisk v1-rad |
| Version och projektion | domänversioner 7/3/2/4, kundversion 1, inga payload-/metadatafält |
| Deterministisk ordning | sex handhärledda första source/ID-par; samma ID:n i två källor vid samma mikrosekund |
| V1-paritet | alla äldre fält identiska på första 101 rader och varje cursor-sida |
| Kund och tenant | två kunder i A och en i B; nyare främmande rader filtreras före limit; felkombinationer/null ger tomt |
| Limit | default/null 51, noll/negativt 1, stort värde 101 |
| Cursor/replay | 116 unika source/ID-par över 58 två-radssidor; identiskt replay även av slutsidan |
| Behörighet | verklig service-läsning; katalog-ACL och verklig 42501 för anon/authenticated |
| Läsande funktion | källrader byte-/JSON-identiska före och efter läsningar |

Lokal miljö saknar PostgreSQL, Docker och Supabase CLI. Native utförande och
autentisk generering utfördes i den automatiska isolerade CI-replayen. Den
första diagnostiska kandidaten publicerades utan regenererade artefakter;
paritetsgrindarna förblev oförändrade. Den nådde samtliga elva eventmarkörer
ovan och övriga befintliga native/browser-prov, och avslutades sedan enbart
med det väntade felet för den gamla typmanifest-hashen. Detta är verkligt
native-bevis för RPC-paketet, inte ett grönt helhetsresultat för den kandidaten.

## Exakta prov- och artefaktversioner

- #418 provad kod-head: `16aa90e59e1770addd2a1095897ab9cb790359a8`.
- CI:s checkout: syntetisk merge `bd02380921fcad54d1e906c4997bd870987d01e3`
  med aktuell `main` `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`.
  Jämförelsen visar identiska migrations-, RPC-, fixture-, typ-/schema- och
  workflow-filer mellan kandidaten och merge-checkouten; hela trädet skiljer
  sig genom senare Ediel-arbete från main och påstås inte vara identiskt.
- [OPS-run 36636567043](https://github.com/heke99/gridex-ops-platform/actions/runs/36636567043),
  native-jobb `109638534974`, [artefakt 11065526805](https://github.com/heke99/gridex-ops-platform/actions/runs/36636567043/artifacts/11065526805).
- Arkiv SHA-256: `f69a0cf484d19dfe6b5f13d63c2b27f85e2ee785562ad491d34ce11fbe2b2f21`.
- Native-logg SHA-256: `dc7591912698d46626206e109722b6f1b61e5533eab65164cca7ec1b1e3f7c0c`.
- Genererade typer SHA-256: `301fcaf283405cf7c9ef71f74363c276bb91269354f678a7c8baffe895bd7664`.
- Genererad `schema.sql` SHA-256: `d30869e71ffba3aaa21285611833931e69336d954f857f903c1930c606a79092`.
- Semantisk schemafingerprint: `dbeb4ba40bffcaf6c0e49b83ffa32417a9429baec3357ee37e8b388887564f86`.

Artefaktens exakta bytes har införts i `database.types.ts`, `schema.sql` och
`schema.fingerprint.json`. Typdiffen tillför endast v2-RPC:n; schemadiffen
endast dess definition och ACL. Endast fingerprintsektionerna `functions`
(+1) och `function_grants` (+2) ändras. Manifestet anger denna körning och
dess begränsning. Inga historiska migrationer eller äldre releasebytes ändras.

Lokal evidens: migrationsintegritet (652 filer/556 versionsgrupper),
workflow-YAML, contract hardening, service-role-ratchet (2397 ≤ 2402),
app-typecheck och sex portalregressionsfiler med 29/29 test passerade.
Typecheck/test kördes på lokal Node 24; CI använder projektets Node 22.
Oberoende läsande granskning fann inga konkreta fel; den ersätter inte
native-provet. `ggshield` saknas, så automatisk hemlighetsskanning påstås inte.

Den efterföljande artefakt-/evidenskandidatens exakta SHA och dess egna CI-
resultat publiceras i #418 och överlämnas till #422 efter körning. Ingen
fasacceptans eller produktionsbehörighet följer av detta avgränsade paket.

## API-handoff och återställning

#422 ska först integrera den exakt verifierade #418-versionen och sedan byta
RPC-namnet i `listPortalEventsPage`, bevara nuvarande kundbevis/scope/cursor och
verifiera att lagrad version >1 når HTTP-svaret. En ny parad release och dess
guide ska återge det nya beteendet; tidigare releasebytes förblir oförändrade.
RPC-beviset kvalificerar inte HTTP-/issuer-/kundsynlighetspolicy eller P4/P6.

Ingen data-backfill behövs. Befintliga v1-anrop fortsätter fungera. Om en
framtida godkänd API-aktivering behöver återställas används v1 igen med
sanningsenlig frånvarande version. Den additiva v2-funktionen behöver inte
raderas för rollback; ingen historisk migration skrivs om.

## Skill routing

Aktiverade: Supabase och Postgres best practices för invoker/grants/keyset,
projektets TDD/testprinciper för handhärledd native-fixture, systematic-debugging
för den faktiska v1-luckan, verification-before-completion och requesting-code-
review för verifierad slutleverans. Arbetsisoleringen är en separat checkout;
ingen annan agents Git-metadata skrivs. Bred Quality Playbook/inventering,
UI/React, performance optimization, skillskapande, hookinstallation och
parallella implementerare är utanför det avgränsade paketet. En enda
oberoende granskare är läsande enligt projektets review-skill. Automatisk
hemlighetsskanning påstås bara om verktyget faktiskt finns och körs.
