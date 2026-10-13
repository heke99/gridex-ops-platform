# Aktuell Ediel-start

1. Läs [AGENTS](../AGENTS.md), [minnesingången](README.md) och faktisk main. Beräkna godkända ur [coverage.json](../quality/audits/ediel-masterplan-v2/coverage.json): regler VERIFIED, kontrakt PASSED. Daterade antal är historik.
2. Läs senaste [#766](https://github.com/heke99/gridex-ops-platform/issues/766), aktuellt [state](current-state.md), [task](current-task.md), [checkpoint](checkpoint.json), [handover](handover.md), [blockers](open-blockers.md) och [work plan](work-plan.md). Verifiera riktiga PR-heads/refs innan ett nytt steg väljs.
3. Läs [gemensam prompt](masterplan-five-agent-prompt-20261012.md), [workflow](masterplan-agent-workflow.md), [reservationer](masterplan-reservations.md) och ordagranna [rules](../docs/ediel/masterplan-v2/registers/rules.json)/[acceptance tests](../docs/ediel/masterplan-v2/registers/acceptance_tests.json) för berört ID.
4. Hjälp befintlig ägare read-only. Välj inte godkända eller aktivt ägda uppgifter, claima inte ett nytt slot från en gammal prompt och starta inga extra producenter. Writes kräver uttrycklig avgränsad överlämning och verifierad egen custody.
5. Bind två oberoende slutgranskningar och alla obligatoriska kontroller till exakt slutversion. Den befintliga seriella leveransägaren mergar; ökning rapporteras först efter faktisk PR-state, ordered parents/tree och aktuell ledger.

Pensionerade agenter och gamla pausade automationer återupptas inte. #310 förblir PAUSED. Verkliga utskick, persondatagallringar, secrets och produktionsaktiveringar kräver det faktiska behöriga underlaget. Separata obesvarade publiceringsgodkännanden förblir obesvarade.

Historiska baseline-/transitionfiler, gamla prompter, checkpoints och runtimekommandon kan vara originalbevis. De ger inga aktuella uppdrag eller produktionsmandat. [Originalindex](ediel-doc-history-20261013.json).
