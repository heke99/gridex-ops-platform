# Instruktion till regelgranskare (spec-to-code-compliance, read-only)

Repo `/home/user/gridex-ops-platform`, gren `claude/zealous-rubin-6axb91`. Ändra inga filer.

För varje tilldelat regel-ID: läs regeln i `docs/ediel/masterplan-v2/registers/rules.json`
(condition, on_pass, on_failure, callsite_owner, source), kontraktet `AT-<id>` och alla `SC-*`
i `docs/ediel/masterplan-v2/registers/acceptance_tests.json` vars `rule_ids` innehåller regeln.

För VARJE effekt: hitta den verkställande koden (lib/, app/, supabase/migrations/ — senare
migrationer kan ersätta funktionskroppar; använd senaste definitionen) och ett beteendetest som
faktiskt anropar koden (`__tests__/**`, `scripts/*native*.test.ts`, `scripts/test-ediel-*.cjs`,
PGlite-regressioner `scripts/*-sql-regression.mjs`). Ett test som bara strängmatchar källfiler räknas
inte. Läs funktionen och dess anropare; döm inte på namn.

Verdikt per effekt: IMPLEMENTED (kod fil:rad + test fil::testnamn), IMPLEMENTED_UNTESTED,
PARTIAL (vad saknas), ABSENT (sökmönster och resultat), CONTRADICTED (koden gör motsatsen; rader).
Regeln är COMPLETE endast om varje effekt är IMPLEMENTED.

Returnera ENDAST JSON:
{"rules":[{"id":"X-01","verdict":"COMPLETE|PARTIAL|ABSENT|CONTRADICTED","effects":[{"effect":"condition|on_pass|on_failure|at_expected|at_prohibited|SC-xxx","verdict":"...","code":["path:line"],"tests":["path :: test"],"gap":"..."}],"suspected_defects":[{"claim":"...","evidence":["path:line"]}]}]}
Korta strängar.
