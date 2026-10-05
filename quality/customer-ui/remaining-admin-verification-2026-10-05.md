# Återstående adminvyer och funktionskontroll — 2026-10-05

Samtliga sju föreslagna grupper är förenklade och verifierade lokalt. Tidigare ändringar i kundregister, kundkort, avtal, kundintag och dagliga adminvyer finns kvar. Sekundära funktioner ligger i menyer eller öppningsbara avsnitt; status, blockerare och nästa steg är fortsatt synliga.

| Område | Färdig ändring |
| --- | --- |
| Informationsförfrågningar | Kompakta sammanfattningar och kort; tre skapandeformulär öppnas vid behov. Behörigheter och Z13/Z14-status är synliga. |
| Anläggningsärenden | Kortare kort och mobilrader; manuell skickning och nätägarsvar öppnas separat. Kundlänken ligger i rubriken. |
| Mätvärden | Kompakt översikt, öppningsbar registrering och statusredigering; åtgärder staplas på mobil. |
| Utgående ärenden | Kompakta filter och kort; sekundär navigation i meny, identifierare och statusredigering öppningsbara. Fel och routningsstatus är synliga. |
| Meddelanden och händelser | Responsiva listor, extra filter och tekniska uppgifter öppningsbara; aktiva filter öppnar sitt avsnitt. Plattformsvyn behåller sin behörighetskontroll. |
| Prissättning och kampanjer | Samlad navigation och öppningsbart skapande; prisblockerare synliga, längre kampanjbeskrivningar öppningsbara. |
| Användare och fakturaintegrationer | Skapande/inbjudan öppnas vid behov; e-poståtgärder i meny. Providerbyte öppningsbart, nuvarande val, beredskap och konsekvens av aktivering synliga. |

## Funktionsfel som hittades och rättades

1. Statusändringar för nätägarförfrågningar och partnerexporter använde formulärets kund-ID vid uppföljning. Uppdatering, loggning och cacheuppdatering använder nu den sparade postens kund-ID. Sessionsbaserad RLS skyddade redan andra bolags data; detta är ett funktionsfel i kundkopplingen.
2. Vissa statusändringar och manuell mätvärdesregistrering saknade bolags-ID i revisionsloggen. Loggningen använder nu den sparade postens bolag.
3. Anläggningssidans relationer gav verkliga PostgREST-fel: flera möjliga kund-/adressrelationer (`PGRST201`) och saknad nätägarrelation (`PGRST200`). Reservläsningen tappade namnuppgifter. Kund och adress läses nu med uttryckliga FK-hänvisningar; nätägarnamn hämtas med ett samlat uppslag genom samma SSR-klient. Bolagsfilter och reservläsning behålls. Ett misslyckat nätägaruppslag tar inte bort kundnamn eller formulär.

Felen reproducerades innan rättning. Beteendetester för de faktiska exporterna och servervyn verifierar rättningarna. Den befintliga UI-agenten granskade dataläsfixen oberoende och körde dess två tester utan invändning.

Webbläsarkontrollen hittade och rättade även en klippt statuskontroll på mobil, för breda KPI-rubriker vid 320 px och otillräcklig kontrast i plattformens händelsepanel. Detaljer finns i `remaining-ui-findings.json`.

## Slutlig verifiering

| Kontroll | Resultat och evidens |
| --- | --- |
| Vitest | **40 filer / 403 tester passerar**, exit 0. Två workers, 15 sekunders testtimeout. `remaining-tests.json`, `remaining-tests.log`, exakt kommando i `remaining-test-command.txt`. |
| Applikationens TypeScript | Exit 0 med Node 22.23.3, `tsc --noEmit --incremental false -p tsconfig.app.json`. `remaining-types.log`. |
| ESLint | 44 ändrade/nya TS/TSX-filer, exit 0, inga fel; 12 befintliga oanvänd-varningarna i kundöversikt, meddelanden och outbound. `remaining-lint.log`, `remaining-lint-files.json`. |
| Formulär och menyer | **42 webbläsarkontroller passerar**, inklusive 30 fångade formulärinskickningar, GET-filter, Escape/fokus/menyplacering, validering, bevarat formulärinnehåll, hashöppning och skrivskyddad vy. Inga fångade sidfel. `remaining-smoke-results.json`. |
| Responsiv layout | **112 tillstånd passerar**: 14 vyvarianter × 320/390/1024/1280 px × grundvy/öppnade avsnitt. Ingen horisontell sidöverbredd. `remaining-layout-results.json`. |
| Tillgänglighet | **56 tillstånd, inga axe WCAG 2/2.1 A/AA-avvikelser**: 14 vyvarianter × mobil/desktop × grundvy/öppnade avsnitt. `remaining-axe-results.json`. |
| Provider-SQL | **10 isolerade beteendekontroller passerar** med faktisk migrations-SQL i PGlite: provider-/miljöval, beredskap, idempotens, exportblockering, bolagsisolering, RPC-behörigheter och transaktionsåterställning vid loggfel. `provider-db-results.json`, `provider-parity.json`. |
| Diff | `git diff --check` exit 0. Verifierade källhashar i `remaining-final-source-sha256.json`. |

Formulärnamn, action-bindningar och sidornas guard-anrop jämfördes på nytt mot HEAD och är bevarade på samtliga elva presentationsfiler. Nio av tio sidors dataladdning före render är oförändrad; anläggningssidans avsiktliga läsfix är dokumenterad separat. Bevis: `remaining-presentation-scope-proof.json`, `remaining-server-load-proof.json`.

## Faktisk databas, endast läsning

Verifierat OPS-projekt: `piidsfebjqjmnepdpnas`, produktion trots projektnamnet `gridex-ops-dev`. Ingen migration eller affärsskrivning utfördes.

- PostgreSQL 17.6; 395 registrerade migrationer, senaste `20261005081122`.
- RLS aktiverad på 19 granskade tabeller; 217 granskade constraints validerade.
- Sex kontroller av kund-/bolagskopplingar och kontroll av dubbletter bland aktuella mätvärden visar 0 avvikelser.
- Faktisk `authenticated`-roll utan medlemskap ser 0 poster i sju kontrollerade tabeller.
- Ett stickprov med aktivt medlemskap ser ett tillåtet bolag och fyra kunder, samt 0 främmande bolagsposter i kontrollerade kund-, förfrågnings-, mätvärdes- och outbound-läsningar. Endast aggregat sparades.
- Restriktiva livscykelpolicyer granskades tillsammans med permissiva policyer. Granskade affärs-RPC:er kräver service role.
- Anläggningsrelationernas fel reproducerades mot faktisk REST-API med `limit=0`. Efter rättningen försvinner relationsfelen; anonym läsning nekas som väntat med `42501`. Detta bevisar att relationssyntaxen är rättad, inte ett autentiserat flöde med HTTP 200.

Evidens: `database-verification-2026-10-05.json`, `facility-postgrest-before.json`, `facility-postgrest-after.json`. Globala Supabase-advisors rapporterade även 103 informationspunkter om RLS utan policy och 33 varningar om autentiserade security-definer-hjälpfunktioner. Dessa är inte en fullständig projektgranskning och har inte ändrats i UI-arbetet.

## Verifieringsgränser och leverans

Webbläsaren renderar riktiga serverträd med syntetiska laddningsdata, de riktiga klientkomponenterna för menyer/avsnitt och vanliga formulär. Routing och serverinskickningar fångas av testadaptrar. Separata action-tester anropar riktiga funktioner med isolerade beroenden. Ingen inbjudan, e-post, Ediel-transmission eller fakturasändning skickades.

Autentiserade resor i en riktig bolagsmiljö har inte körts; inloggningsuppgifter saknas. Rollkontrollerna är stickprov, inte en kontroll av alla användare och bolag. PGlite har minimala föregångartabeller och ersätter inte full migrationsreplay. Produktionsbygge och publicering har inte körts. De fyra äldre statiska smoke-felen från tidigare rapport kvarstår på oförändrade fasader och ska inte räknas som passerade.

Ändringarna ligger i arbetskopian på `work`, bas `498ebd1c31f449630ea2b630cf23381447d71ba6`. Inget är committat eller publicerat. Fortsatt överlämning finns i `.agent-memory/customer-ui-checkpoint.md`; den separata Ediel-kampanjens globala arbetsstatus är bevarad.
