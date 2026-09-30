# Ediel #421 — avgränsad CI-rättelse, 2026-09-30

Rättningarna är implementerade och lokalt kvalificerade på kodcommit `32065e595e7d912456899332142aa2bf1ac61b18`, tree `8af948593629935f410eba15cbebbb892b347932`, med bas `1eeeeaff21929038dc2a27d723b977c9ee52a9f7` / tree `def243e2f69c2696430488c1724fa5e2a95ac7dc`. Lokal gren: `codex/ediel-ci-recovery-20260930`.

Remotegrenen `codex/ediel-ci-recovery-handoff-20260930` bevarar endast detta överföringspaket. Den innehåller patch och kvitton, inte en ny integrerad runtimekandidat. Runtime på den grenen är den tidigare publicerade #421-basen `0b8c1c37c0806f99e18c36d8ccd576bbda117442` / tree `523dd00e3802947c785e71af33d8d4b11698134a`. Den skiljer sig från den lokalt provade koden. Paketpubliceringen flyttar inte #421. Alla heads måste kontrolleras igen före integration.

## Bekräftade orsaker och rättningar

1. Ediel-workflow `36747564858`, jobb `109997518245`, stoppade i strip-only-laddaren vid TypeScript parameter properties. De tolv verkliga källmodulladdarna använder nu transform-läge. Ett gemensamt VM-stöd läser exakt det verkliga source_manifest, behåller respektive VM-context/cache och riktig kryptografi samt spärrar fs, subprocess och generell CIS-I/O. En avslutande assertion upptäcker även försök som produktkod fångar. Inga normativa förväntningar togs bort.
2. OPS `36747565198`, quality-jobb `109997520323`, fick ofullständig `EdielDispatchStateResult` i ett test. Andra integratorns redan existerande rättning `14c4a1427815b2cb5ce011b3592f7b82e07b69b5` finns i vår bas och har återanvänts: tre fixtureprov och hela testtypkontrollen passerar. `existing-typed-receipt-fixture.patch` bevarar just den tidigare rättningen; integrera den endast om den faktiskt saknas.
3. Samma OPS-run, clean-replay-jobb `109997520460`, stoppade i retry-SQL före native/type/schema-grindarna: `utilts_new_consumption_requires_v2`. Färska fixtures använder nu v2 och egen fysisk MEA/KWH per syskon. Åtta ursprungliga invariants finns kvar och 22 kontroller kvalificerar kompletta rader/tidsstämplar, oföränderlig bindning, konflikt och retry. Inga produktionsfunktioner, grants eller migrationsgrindar har ändrats i detta paket.
4. OPS verify-jobb `109997519960` fick stale generated-types manifest vid migrationstail `20260930154424`. Autentisk regeneration är fortfarande ÖPPEN: den andra kodfasen ändrar ännu runtime/migrationer, och denna arbetsmiljö saknar Docker, psql och Supabase CLI. Att endast flytta tail eller skriva typer/fingerprint för hand skulle inte bevisa paritet. Integratorn ska generera från verklig tomdatabasreplay efter runtimefrysning, via befintlig OPS clean-replay/typegen/snapshot-kedja. Workflowen är oförändrad.

Det sparade switchprovet kör verklig aktörskontroll/rendering mot explicit deklarerade, scoped mockade serverläsningar. Det behåller wire/ACK/immutabilitetsassertions och provar även återkallad relation, saknad permission och främmande invoicee. Det är inte native RLS-bevis.

## Faktiska lokala kvitton

Node `v22.23.3`. Fulla loggar och SHA-256 per artefakt finns i `verification.json`.

| Kontroll | Resultat | Bevisnivå |
| --- | --- | --- |
| Tolv verkliga källmodulskript | 1253/1253, 0 fail/skip/cancel, exit 0 | Källkörning med deklarerade syntetiska portar |
| Reparerad committed retry-SQL | 22/22, exit 0 | Fokuserad embedded PostgreSQL |
| Faktiskt skapad äldre v1 → migration → retry och exakt färsk v2 | 16/16, exit 0 | Samma avgränsade databasprov |
| `npm run typecheck:tests` | PASS, exit 0 | Statisk kontroll av testsuite |
| Befintlig komplett receiptfixture | 3/3 | Mockad enhet |
| Guide governance i UTC/Stockholm/Apia | 98/98 per tidszon | Källkörning |
| Frysta originals/rules/contracts | 33/121/231, PASS | Specifikationsintegritet; ingen acceptansändring |
| Node syntax | 14 filer, PASS | 13 CJS + 1 MJS |
| ESLint | MJS utan fel, exit 0 | 13 CJS är undantagna i redan befintlig konfiguration |
| Oberoende loader/fixture-granskning | APPROVE; inga kvarvarande materiella fynd | Utanför SQL-/native-/transportscope |

Embedded-runnern använder PGlite 0.3.14, valda verkliga tabeller, ägarfunktioner och guards samt syntetiska company/profile-frön. PostgreSQLs inbyggda SHA256 ersätter den saknade pgcrypto-extensionen i detta fokuserade prov. Historisk v1 skapas genom den verkliga äldre RPC:n före framåtmigrationerna; lagrat avrundat `9007199254740992` förblir oförändrat, medan färsk v2 lagrar `9007199254740993` exakt. Detta bevisar inte full Supabase-replay, pgcrypto-integration, full RLS, PostgREST eller extern ACK-transport.

## Integration för ensam #421-publicerare

Kontrollera först faktisk remote/main/#421, lokala heads/status/diff/opushat och alla aktiva agenters filägarskap. Den separata aktiva integrationsarbetskopian var senast läst på `f1b660707205437090bebcd58c7e2688e7386f42` med ytterligare ocommittade ändringar; detta är orientering, inte en återställningspunkt. Dess minnes-/PR-body topptext var äldre än den faktiska kodfasen. Läs nyaste PR-kommentarer och verkliga CI-loggar.

Om den gemensamma Git-databasen fortfarande finns kan integratorn cherry-picka enbart kodcommit `32065e595e7d912456899332142aa2bf1ac61b18` till en isolerad integrationskandidat efter ägarskapskontroll. Alternativt hämta `recovery.patch` från artefaktgrenen, verifiera hash i `verification.json`, och kör `git apply --check` före `git am`/anpassad integration. Hantera senare ändringar manuellt; ersätt inte hela deras filer. Återanvänd 14c4a142 om den redan finns. Kopiera inte hela återställningsgrenens bas eller dess gamla globala minne in i den aktiva grenen.

Provkommandon finns i `verification.json`. Fokuserad SQL-reproduktion:

```bash
EDIEL_PGLITE_MODULE=/absolute/path/to/pinned-pglite-0.3.14/dist/index.js \
node scripts/ediel-utilts-committed-retry-embedded-check.mjs
```

Frys därefter gemensam runtime och migrationslista. Kör relevanta tester/lint/app-, test- och scripttyper, migrations-/RBAC-grindar, faktisk tomdatabas- och uppgraderingsreplay, native rollback/retry/samtidighet, autentiskt genererade typer/schema/fingerprint samt browser/E2E/build och samtliga fem obligatoriska workflows på den nya exakt publicerade headen. Spara första verkliga fel och rätta med ny hypotes; gröna äldre heads eller artifactbranchens CI kvalificerar inte den integrerade kandidaten.

## Bevarade gränser och kvarvarande arbete

Ingen main-merge, force-push, produktionsmigration, verklig kundkommunikation, staging/TGT/AGT/motpartsprov eller aktiverad Edieltrafik. #310 är orörd. #418/#422 och allt bevarat tenantservicearbete är orört; detta Edielpaket ersätter inte T01–T55/U01–U20 eller tenantservice-masteruppdraget. Formella 121/231-statusar har inte ändrats.

Ny native/full-replay/HTTP/browser och exakt-head CI är ännu inte kvalificerade. Externa issuer/original/archive/retention, positiv LOC175 och full E035 kvarstår tills verkliga underlag finns. `NEXT-CHAT-PROMPT.md` anger nästa konkreta genomförandesteg.
