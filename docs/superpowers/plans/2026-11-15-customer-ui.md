# Förenklat elbolagsgränssnitt

**Goal:** Kundnära språk, kompakta kort och färre synliga åtgärder genom bolagsgränssnittet. Tekniska uppgifter förbehålls superadmin.
**Architecture:** Befintliga serverbehörigheter och affärsåtgärder behålls. Tekniska JSX-paneler spärras på servern; extra information använder inbyggda details/summary.
**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind.

## Avgränsning och filägande

Egen worktree `/workspace/gridex-customer-ui-20261115`, gren `codex/customer-ui-20261115`, bas f23c1dc0c. Ingen delad backend, databas, producent, simulering, systemdemo eller gemensamt agentminne ändras. Andra chattars status lästes; deras arbete avser demo/finansiella scenarier och native körningar. Ingen driftsättning eller main-merge ingår.

## Arbete

- [x] Inventera alla adminsidors och komponenters synliga strängar. Spara sökträffar som granskningskandidater; en kodträff bevisar inte att innehållet visas för bolagsanvändare.
- [x] Komprimera ansökningskort, samla extra åtgärder och teknisk information. Visa affärsuppgifter i stället för interna UUID.
- [x] Begränsa råa request/response och Edielverktyg på nätägarbegäran till superadmin.
- [x] Förenkla kundintag, navigation och kundkort; tydlig väg till befintlig avtalsregistrering och signering.
- [x] Granska övriga sidor/flikar och rätta kundsynliga tekniska begrepp, utan ändrade API-fält eller datavärden.
- [x] Verifiera serverrendering för bolagsanvändare/superadmin, tenantgränser, navigation och typkontroll. Kör riktad lint och två oberoende slutgranskningar.

## Skill routing

using-superpowers: arbetsrouting; using-git-worktrees: isolering; writing-plans/executing-plans: genomförande; web-design-guidelines: tillgängliga disclosures och kompakta kort; browser-e2e: vid tillgänglig browser; requesting-code-review: två oberoende slutgranskare; verification-before-completion: färska resultat. React-checklistan tillämpas efter TSX-ändringarna. Ingen databas/schema/prestanda/AI-funktion byggs; motsvarande skillkampanjer behövs inte.

## Fortsatt granskning efter ägarens begäran

- [x] Rätta arbetsköns länkar till data-requests som är spärrad för bolagsanvändare; behåll superadminlänkar och använd översiktens befintliga nästa steg för bolag.
- [x] Förenkla leverantörsbytesdetaljen på servern. Behåll status/datum/nätägare/åtgärder men visa endast verkligt tillåtna affärsåtgärder. Saknad kontroll får inte visas som godkänd.
- [x] Förenkla uppgiftsbegärans rubriker/status och begränsa tekniska process-/meddelandeverktyg till plattformsadmin; bevara serverfält och behörigheter.
- [x] Granska motsvarande layout och länk-/rollbeteenden med riktade tester, browser och två oberoende slutgranskare. Följ upp faktiskt CI-fel utan blind omkörning.

Filcustody: samma isolerade gren. Nya huvudfiler operations/switches/[id]/page.tsx, customer-info-requests/page.tsx, work-queue/page.tsx och nya presentations-/testfiler. Inga delade producenter, databasscheman, API- eller Ediel-runtimefiler ändras.

## Fortsatt sökning: inloggning, fakturainställningar och mätvärden

- [x] Separera kundinloggningens affärsstatus från teknisk leverantörs-/nyckelkonfiguration på servern. Läsfel får inte visas som avstängd funktion.
- [x] Ge fakturainställningar en kompakt bolagsvy med befintliga, behörighetsmatchade leverantörsval/utskicksinställningar. Miljövariabler, tekniska testdetaljer och systemhändelser endast superadmin. Visa okänd status vid läsfel.
- [x] Ge mätvärden en bolagsvy med kundnamn, period, energi, rättelser och ärendelänkar; tekniska ID:n och manuella integrationsverktyg endast superadmin.
- [x] Verifiera roller, läsfel, formulärfält och mobil-/tangentbordslayout. Två oberoende slutgranskningar och uppdatering av samma PR; inga verkliga konfigurationsändringar eller utskick.

Filcustody: tre ovanstående sidfiler, nya serverkomponenter/tester och eget quality/checkpoint-underlag. Serveråtgärder och databasstruktur behålls. Avgränsad felhantering uppdateras vid verifierad tyst fallback; mätvärdesvyn kompletteras med bolagsfiltrerade etikettläsningar för kund, anläggning och mätpunkt.
