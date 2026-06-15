# Batch O3–O6 hardening testplan

## SQL smoke

1. Kör migrationen `20260615130000_batch_o3_o6_actor_registry_certificate_hardening.sql`.
2. Kör `supabase/sql/checks/batch_o3_o6_hardening_checks.sql`.
3. Verifiera att samtliga checks returnerar `ok`.
4. Kör migrationen en gång till i staging för att verifiera idempotens.

## XML-import

- Importera samma XML två gånger. Andra körningen ska återanvända tidigare run eller ge noll nya dubbletter.
- Importera aktör med ny Ediel-ID. Den ska skapa `platform_market_actors`, identifiers, roles och routes.
- Importera aktör med befintlig Ediel-ID. Den ska uppdatera befintlig aktör, inte skapa ny.
- Importera aktör där org.nr motsäger befintlig aktör. Den ska skapa `actor_registry_conflicts` och stoppa auto-apply.
- Importera aktör med tom subadress. Den får inte automatiskt bli verifierad om route inte är entydig.

## Certifikat

- Manuell knapp “Sök certifikat nu” ska skapa refresh job och uppdatera cache/certifikatsammanfattning.
- Utgånget certifikat ska sparas som historik men inte ge readiness.
- Certifikat utan PEM/material ska inte ge readiness.
- Fel environment eller fel purpose ska ge blockerande status/review.
- Samma fingerprint för samma aktör får inte dupliceras.

## Kundflöde och Ediel outbox

- Supplier switch ska blockeras om nätägaren inte är redo.
- Outbound PRODAT/UTILTS ska blockeras om mottagande aktör saknar readiness.
- CONTRL/APERAK/UTILTS_ERR ska inte blockeras av PRODAT-certifikatkravet.
- Tenant mismatch ska fortsätta stoppas av befintliga guards.

## Regression

Kör befintliga relevanta regressioner:

```bash
npm run gridex:actor-registry-intake-hardening-regression
npm run gridex:route-readiness-regression
npm run ediel:routing-security-regression
npm run ediel:production-readiness-regression
npm run ediel:rule-regression
npm run gridex:batch-m-ops-master-regression
```

Kör även build i miljö med installerade dependencies och mer än fem minuters build-timeout:

```bash
npm run typecheck
npm run build
```
