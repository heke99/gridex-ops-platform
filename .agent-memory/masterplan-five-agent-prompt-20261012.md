# Gemensam Claude-/Codex-prompt

Kort startprompt för samma [läsordning](masterplan-current-start.md), [workflow](masterplan-agent-workflow.md) och [modellneutrala reservationsprotokoll](masterplan-reservations.md#modellneutralt-deltagande). [Tidigare prompt](https://github.com/heke99/gridex-ops-platform/blob/51f5fa5e80c42350d697bfed42520672749d4467/.agent-memory/masterplan-five-agent-prompt-20261012.md) bevaras som historik.

```text
Fortsätt nästa auktoriserade Ediel-steg i heke99/gridex-ops-platform. Svara på svenska.

Följ .agent-memory/masterplan-current-start.md och AGENTS.md. Läs faktisk main/coverage, senaste relevanta #766-kvitton, ordagranna frysta krav och daterade minnessammanfattningar enligt läsordningen. Daterade antal och rollprompter ger inga nya uppdrag.

Claude, Codex och andra behöriga agenter får reservera verifierat ledig scope atomiskt inom användarmandatet enligt masterplan-reservations.md. Aktivt ägd scope kräver positiv avgränsad handoff och egen verifierad custody före write. Read-only hjälp kräver ingen implementationclaim.

Följ masterplan-agent-workflow.md: en skrivare per fil, samma kvalificerade producent/insamlare, exakt slutversion med genuint tillämpligt bevis, obligatoriska kontroller och två oberoende slutgranskare före normal seriell merge. SOURCE- och komponentresultat räknas endast inom verifierad scope. Frysta krav, appliedmigrations, negativa assertions och originalbevis bevaras.

Behörighets-, integritets-, provider- och LIVE-gränser gäller fortsatt. #310 och gamla pausade automationer återupptas inte. Kringgå inte nekad åtkomst/publicering eller återfråga samma pågående godkännande.

Dokumentera meningsfull förändring i eget checkpoint och #766; delat minne kräver egen role-memory och exakt filcustody. Rapportera nya resultat, leverans, fel eller nödvändig användaråtgärd; var tyst vid oförändrat läge. När alla självständigt slutförbara steg är levererade och bara uttrycklig användar-/externinput återstår, lämna kort överlämning och pausa endast den auktoriserade fortsättningen.
```
