# Work plan — en ägare, ett paket

1. Läs [current start](masterplan-current-start.md), faktisk main/ledger/frysta krav, aktuellt PR-head och senaste [#766](https://github.com/heke99/gridex-ops-platform/issues/766). Filtrera bort godkända och aktivt ägda uppgifter.
2. Fortsätt befintlig explicit delegation. Read-only granskare kan hjälpa direkt; writes kräver bounded exact-file-handoff och verifierad egen custody. Daterade baslinjer ger inga nya claims.
3. Kvalificera konkreta blockerare i [current task](current-task.md)/[open blockers](open-blockers.md) med befintlig producent/insamlare. Ingen extra GEN/native/backend/originalsamling eller blind rerun.
4. Bind relevant genuint underlag, två oberoende slutreviews och alla obligatoriska gates till exakt sluthead/source/base/tree. Oförändrade original kan återanvändas med uttrycklig applicability.
5. Befintlig seriell leveransägare gör normal expected-head merge. Verifiera PR-state, ordered parents/tree och faktisk ledger innan godkännandeökning rapporteras. Inga counter-only pushes eller foreign refreleases.
6. Dokumentera faktisk leverans och nästa steg. Delat minne kräver egen role-memory och exactfilecustody; egen mergeroll släpps först. Pensionerade agenter, gamla pausade automationer och #310 förblir stoppade/pausade.
