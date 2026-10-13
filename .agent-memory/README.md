# Gridex OPS — en aktiv startpunkt

Börja i [current start](masterplan-current-start.md). Läs faktisk main och [coverage.json](../quality/audits/ediel-masterplan-v2/coverage.json), aktuella [#766-kvitton](https://github.com/heke99/gridex-ops-platform/issues/766), [current state](current-state.md), [current task](current-task.md), [checkpoint](checkpoint.json), [handover](handover.md), [blockers](open-blockers.md) och [work plan](work-plan.md).

[Gemensam prompt](masterplan-five-agent-prompt-20261012.md), [workflow](masterplan-agent-workflow.md) och [reservationsprotokoll](masterplan-reservations.md) beskriver samma arbetssätt. Det finns ingen separat approvalledger eller arbetsfördelning i gamla prompter. Regler VERIFIED och kontrakt PASSED räknas från aktuell main; varje dokumenterad siffra är daterad.

Befintliga ägare behåller sina verifierade scopes. Nya agenter får granska read-only direkt; rättningar kräver bounded exact-file-handoff och egen verifierad custody före write. En skrivare per fil, en producent/insamlare per källa, en seriell leveransägare och två oberoende slutgranskare. GEN-ägare väljs från senaste verifierade handoff, inte från en äldre C2-prompt. Pensionerade agenter och gamla pausade automationer återupptas inte.

[Daterad baslinjeJSON](masterplan-five-agent-baseline-20261012.json), [tidigare PR-inventering](masterplan-five-agent-pr-inventory-20261012.json), [113 äldre minnesfiler](masterplan-five-agent-retired-memory-index-20261012.json) och [originalen före denna rensning](ediel-doc-history-20261013.json) är historik. Återställ endast relevant originalbevis och jämför dess tillämplighet med faktisk källa. Frysta regler/acceptanskrav och originalbevis bevaras.

Sidospår behåller sina scopes: [tenantservice](tenantservice-checkpoint.md), [kundportfölj](customer-portfolio-checkpoint.md), [kund/admin-UI](customer-ui-checkpoint.md). Denna startpunkt gäller Ediel. Inga secrets, produktionskunddata eller fulla privata chattar i minnet.
