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
