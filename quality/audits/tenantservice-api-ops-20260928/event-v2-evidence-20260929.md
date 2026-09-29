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

| Prov | Förväntat bevis |
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
autentisk generering görs därför av den automatiska isolerade CI-replayen på
publicerad kandidat. Kandidatens initiala schema-/typmanifest är uttryckligt
**ej regenererat**; första replayen samlar autentiska artefakter utan att
försvaga eller stänga av paritetsgrindarna. Efter semantisk diffgranskning av
artefakten införs exakt genererade bytes, varefter nästa kandidat måste klara
ordinarie kontroller på sin egen slutversion.

Status vid kodpaketering: migrationsintegritet och workflow-YAML passerar
lokalt; native, autentiska artefakter och slutversionens CI är **väntande**.
Riktad applikationsregression och oberoende läsande granskning redovisas efter
utförande. Inga native PASS eller avslutade krav påstås före körning.

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
