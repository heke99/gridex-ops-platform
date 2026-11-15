# Kundgränssnitt — separat uppdrag 2026-11-15

Användaren begär förenkling av alla bolagssidor/flikar: kundnära svenska, färre knappar, kompakta rutor, payload/workflow bara superadmin, nytt avtal från kundkortet. Arbetet är isolerat från scenariokörning och systemdemo i egen worktree `/workspace/gridex-customer-ui-20261115`, gren `codex/customer-ui-20261115`.

Implementerat och granskat. Se `quality/customer-ui-20261115/VERIFICATION.md`, sidinventering, browserunderlag och `docs/superpowers/plans/2026-11-15-customer-ui.md`. 107 riktade tester, app-typkontroll, scoped lint, RBAC24, continuation och 9 browserfall godkända. Två oberoende slutgranskare har inte kvar några åtgärdskrävande fynd. Testtypkontroll godkänd med 6144 MB efter att första standardheapen överskreds. Inga produktionsåtgärder, databasändringar, riktiga utskick, scenario-/demotjänster eller gemensamma checkpoints ändrades.

Nästa steg: leverera separat granskbar PR utan main-merge; serial leveransägare behåller main. Sidinventeringen är statisk, browserproven syntetiska; inga alla-sidor-liveanspråk.
